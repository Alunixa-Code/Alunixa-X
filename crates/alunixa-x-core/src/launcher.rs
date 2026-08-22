use std::future::Future;
use std::io::{Seek, SeekFrom, Write as _};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio_util::io::ReaderStream;

use crate::settings::{BackendSettings, SettingsStore, normalize_codex_extra_args};
use crate::status::{LaunchStatus, StatusStore};

#[cfg(windows)]
const POST_LAUNCH_COMPUTER_USE_GUARD_SECONDS: &[u64] = &[0, 5, 15, 30, 60, 120, 180, 240, 300];
#[cfg_attr(not(windows), allow(dead_code))]
const POST_LAUNCH_COMPUTER_USE_GUARD_STABLE_ATTEMPTS: usize = 3;
static PET_OVERLAY_SYNC_FAILED: AtomicBool = AtomicBool::new(false);
static PET_CURSOR_DRIVER_FAILED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexLaunch {
    Process {
        command: Vec<String>,
        wait_strategy: ProcessWaitStrategy,
        macos_cleanup_policy: Option<MacosCleanupPolicy>,
    },
    PackagedActivation {
        app_user_model_id: String,
        arguments: String,
        process_id: Option<u32>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessWaitStrategy {
    TrackedChild,
    ExternalWaitCommand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacosCleanupPolicy {
    QuitIfNotPreviouslyRunning,
    SkipQuitBecauseAlreadyRunning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowsProcessControlStrategy {
    NativeWindowsApi,
}

#[cfg(windows)]
pub fn windows_process_control_strategy() -> WindowsProcessControlStrategy {
    WindowsProcessControlStrategy::NativeWindowsApi
}

impl CodexLaunch {
    pub fn process_id(&self) -> Option<u32> {
        match self {
            Self::PackagedActivation { process_id, .. } => *process_id,
            Self::Process { .. } => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LaunchOptions {
    pub app_dir: Option<PathBuf>,
    pub debug_port: u16,
    pub helper_port: u16,
    pub status_store: StatusStore,
}

impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            app_dir: None,
            debug_port: 9229,
            helper_port: 57321,
            status_store: StatusStore::default(),
        }
    }
}

#[derive(Clone)]
pub struct LaunchHandle {
    pub debug_port: u16,
    pub helper_port: u16,
    pub app_dir: PathBuf,
    pub launch: CodexLaunch,
    pub status_store: StatusStore,
    helper_started: bool,
    hooks: Arc<dyn LaunchHooks>,
}

impl std::fmt::Debug for LaunchHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LaunchHandle")
            .field("debug_port", &self.debug_port)
            .field("helper_port", &self.helper_port)
            .field("app_dir", &self.app_dir)
            .field("launch", &self.launch)
            .field("status_store", &self.status_store)
            .finish_non_exhaustive()
    }
}

impl LaunchHandle {
    pub async fn wait_for_codex_exit(&self) -> anyhow::Result<()> {
        let result = self
            .hooks
            .wait_for_codex_exit(&self.launch, self.debug_port)
            .await;
        if self.helper_started {
            self.hooks.shutdown_helper(self.helper_port).await;
        }
        result
    }
}

#[async_trait(?Send)]
pub trait LaunchHooks: Send + Sync {
    fn resolve_app_dir(
        &self,
        app_dir: Option<&Path>,
        settings: &BackendSettings,
    ) -> anyhow::Result<PathBuf>;
    fn select_debug_port(&self, requested: u16) -> u16;
    fn select_helper_port(&self, requested: u16) -> u16;
    async fn load_settings(&self) -> anyhow::Result<BackendSettings>;
    async fn run_provider_sync(&self) -> anyhow::Result<()>;
    fn has_pending_remote_control_session_recoveries(&self) -> bool {
        false
    }
    fn remote_control_session_recovery_is_safe_to_run(&self) -> bool {
        true
    }
    async fn run_remote_control_session_recovery(&self) -> anyhow::Result<()> {
        Ok(())
    }
    async fn apply_active_relay_profile(&self, _settings: &BackendSettings) -> anyhow::Result<()> {
        Ok(())
    }
    async fn ensure_computer_use_config(&self, _settings: &BackendSettings) -> anyhow::Result<()> {
        Ok(())
    }
    async fn ensure_plugin_marketplace_config(
        &self,
        _settings: &BackendSettings,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn ensure_imagegen_mcp_config(
        &self,
        _settings: &BackendSettings,
        _helper_port: u16,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn start_helper(&self, helper_port: u16) -> anyhow::Result<()>;
    async fn launch_codex(
        &self,
        app_dir: &Path,
        debug_port: u16,
        settings: &BackendSettings,
        extra_args: &[String],
    ) -> anyhow::Result<CodexLaunch>;
    async fn bridge_context(
        &self,
        _debug_port: u16,
        _app_dir: &Path,
    ) -> anyhow::Result<Option<crate::routes::BridgeContext>> {
        Ok(None)
    }
    async fn inject(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()>;
    async fn inject_bridge(
        &self,
        debug_port: u16,
        helper_port: u16,
        _ctx: crate::routes::BridgeContext,
    ) -> anyhow::Result<()> {
        self.inject(debug_port, helper_port).await
    }
    async fn ensure_injection(&self, debug_port: u16, helper_port: u16, app_dir: &Path) -> bool {
        for attempt in 1..=120 {
            let result = match self.bridge_context(debug_port, app_dir).await {
                Ok(Some(ctx)) => self.inject_bridge(debug_port, helper_port, ctx).await,
                Ok(None) => self.inject(debug_port, helper_port).await,
                Err(error) => Err(error),
            };
            match result {
                Ok(()) => return true,
                Err(error) => {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.ensure_injection_retry_failed",
                        serde_json::json!({
                            "debug_port": debug_port,
                            "helper_port": helper_port,
                            "attempt": attempt,
                            "message": error.to_string()
                        }),
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
        false
    }
    async fn verify_startup_injection(
        &self,
        _debug_port: u16,
        _helper_port: u16,
        _settings: &BackendSettings,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn start_bridge_watchdog(
        &self,
        _debug_port: u16,
        _helper_port: u16,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn start_computer_use_guard_watchdog(
        &self,
        _settings: &BackendSettings,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn write_status(&self, status: &str);
    async fn wait_for_codex_exit(
        &self,
        launch: &CodexLaunch,
        debug_port: u16,
    ) -> anyhow::Result<()>;
    async fn shutdown_helper(&self, helper_port: u16);
    async fn terminate_codex(&self, launch: &CodexLaunch);
}

#[derive(Default)]
pub struct DefaultLaunchHooks {
    child: Mutex<Option<Child>>,
    helper: Mutex<Option<HelperRuntime>>,
    shared_terminal: Arc<crate::shared_terminal::SharedTerminalBroker>,
    bridge_disconnect: Mutex<Option<crate::bridge::BridgeDisconnect>>,
    bridge_watchdog: Mutex<Option<BridgeWatchdogRuntime>>,
    computer_use_guard_watchdog: Mutex<Option<ComputerUseGuardWatchdogRuntime>>,
    computer_use_guard_artifacts: Mutex<Option<crate::computer_use_guard::GuardArtifacts>>,
}

struct HelperRuntime {
    shutdown: tokio::sync::oneshot::Sender<()>,
    connection_shutdown: tokio::sync::broadcast::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

struct BridgeWatchdogRuntime {
    shutdown: tokio::sync::oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

struct ComputerUseGuardWatchdogRuntime {
    shutdown: tokio::sync::oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

pub type BridgeReconnectFuture =
    Pin<Box<dyn Future<Output = anyhow::Result<crate::bridge::BridgeDisconnect>> + Send>>;
pub type BridgeReconnectHandler = Arc<dyn Fn() -> BridgeReconnectFuture + Send + Sync + 'static>;

pub async fn launch_and_inject(options: LaunchOptions) -> anyhow::Result<LaunchHandle> {
    launch_and_inject_with_hooks(options, DefaultLaunchHooks::shared()).await
}

pub async fn launch_and_inject_with_hooks<H>(
    options: LaunchOptions,
    hooks: H,
) -> anyhow::Result<LaunchHandle>
where
    H: IntoLaunchHooks,
{
    let hooks = hooks.into_launch_hooks();
    let debug_port = hooks.select_debug_port(options.debug_port);
    let mut helper_port = hooks.select_helper_port(options.helper_port);
    let mut settings = hooks.load_settings().await?;
    let mut app_dir = hooks.resolve_app_dir(options.app_dir.as_deref(), &settings)?;
    let status_store = options.status_store.clone();
    status_store.save_latest(&launch_status(
        "starting",
        "Alunixa X launcher is preparing the app and injection bridge.",
        debug_port,
        helper_port,
        &app_dir,
    ))?;
    let mut helper_started = false;
    let mut launched = None;
    let mut keep_launched_on_error = false;

    let result: anyhow::Result<LaunchHandle> = async {
        let home = crate::relay_config::default_codex_home_dir();
        crate::codex_instructions::apply_model_instructions_policy(
            &home,
            settings.codex_app_instructions_enabled,
            &settings.codex_app_instructions,
        )
        .context("failed to apply Codex model instructions")?;
        if settings.provider_sync_enabled {
            crate::codex_app_state::capture_app_state_snapshot_nonfatal(&home, "launcher.before");
            hooks.run_provider_sync().await?;
            settings = hooks
                .load_settings()
                .await
                .context("failed to reload settings after provider sync")?;
            app_dir = hooks.resolve_app_dir(options.app_dir.as_deref(), &settings)?;
            crate::codex_app_state::sync_app_state_after_provider_switch_nonfatal(
                &home,
                "launcher.after_provider_sync",
            );
        }
        let pending_remote_recovery = hooks.has_pending_remote_control_session_recoveries();
        if pending_remote_recovery && hooks.remote_control_session_recovery_is_safe_to_run() {
            hooks.run_remote_control_session_recovery().await?;
        } else if pending_remote_recovery {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.remote_control_session_finalization_deferred",
                serde_json::json!({"reason": "desktop_writer_active"}),
            );
        }
        if settings.codex_app_performance_protection {
            match crate::workspace_performance::prune_broad_saved_workspace_roots() {
                Ok(result) if !result.removed.is_empty() => {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.performance_workspace_roots_pruned",
                        serde_json::json!({ "removed": result.removed }),
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.performance_workspace_prune_failed",
                        serde_json::json!({ "message": error.to_string() }),
                    );
                }
            }
        }
        if settings.relay_profiles_enabled {
            hooks.apply_active_relay_profile(&settings).await?;
        }
        if settings.relay_profiles_enabled
            && settings.codex_app_disable_wss
            && home.join("config.toml").is_file()
        {
            crate::relay_config::apply_wss_policy_to_home(&home, true)?;
        }
        if settings.relay_profiles_enabled {
            crate::relay_config::apply_preferred_model_to_home(
                &home,
                &settings.active_relay_profile(),
            )?;
        }
        if let Err(error) = crate::relay_config::set_codex_sub_agent_max_threads_in_home(
            &home,
            settings.codex_app_sub_agent_max_threads,
        ) {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.sub_agent_limit_config_failed_nonfatal",
                serde_json::json!({
                    "max_threads": settings.codex_app_sub_agent_max_threads,
                    "message": error.to_string()
                }),
            );
        }
        if let Err(error) = hooks.ensure_plugin_marketplace_config(&settings).await {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.plugin_marketplace_config_failed_nonfatal",
                serde_json::json!({
                    "message": error.to_string()
                }),
            );
        }
        if settings.computer_use_guard_enabled {
            hooks.ensure_computer_use_config(&settings).await?;
        }
        match crate::codex_sqlite::sanitize_historical_model_suffixes(&home) {
            Ok(result) if result.updated > 0 => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "launcher.sanitize_historical_model_suffixes",
                    serde_json::json!({
                        "scanned": result.scanned,
                        "updated": result.updated
                    }),
                );
            }
            Ok(_) => {}
            Err(error) => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "launcher.sanitize_historical_model_suffixes_failed",
                    serde_json::json!({
                        "error": error.to_string()
                    }),
                );
            }
        }
        let protocol_proxy_enabled = relay_protocol_proxy_enabled(&settings);
        if protocol_proxy_enabled {
            helper_port = crate::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT;
        }
        hooks
            .ensure_imagegen_mcp_config(&settings, helper_port)
            .await
            .context("failed to configure the Alunixa X image_gen tool")?;
        if settings.enhancements_enabled || protocol_proxy_enabled {
            hooks.start_helper(helper_port).await?;
            helper_started = true;
        }

        let launch = hooks
            .launch_codex(&app_dir, debug_port, &settings, &settings.codex_extra_args)
            .await?;
        launched = Some(launch.clone());
        keep_launched_on_error = true;
        if settings.computer_use_guard_enabled {
            hooks.start_computer_use_guard_watchdog(&settings).await?;
        }

        if settings.enhancements_enabled {
            let injection_ready = hooks
                .ensure_injection(debug_port, helper_port, &app_dir)
                .await;
            if injection_ready {
                keep_launched_on_error = false;
                hooks
                    .verify_startup_injection(debug_port, helper_port, &settings)
                    .await
                    .context("Alunixa X startup injection verification failed")?;
                // 注入成功后页面已加载，此时可以通过 CDP 清理 Electron Local Storage
                // 中残留的带后缀模型名，避免模型选择器继续显示废弃项。
                crate::codex_local_storage::sanitize_local_storage_model_suffixes_nonfatal(
                    debug_port,
                )
                .await;
                hooks.start_bridge_watchdog(debug_port, helper_port).await?;
            } else {
                keep_launched_on_error = false;
                anyhow::bail!(
                    "Alunixa X startup injection failed; Codex was closed to avoid running with stale provider or model state"
                );
            }
        }

        let status = launch_status(
            "running",
            "Alunixa X launcher ready",
            debug_port,
            helper_port,
            &app_dir,
        );
        options.status_store.save_latest(&status)?;
        hooks.write_status("running").await;

        Ok(LaunchHandle {
            debug_port,
            helper_port,
            app_dir: app_dir.clone(),
            launch,
            status_store: status_store.clone(),
            helper_started,
            hooks: Arc::clone(&hooks),
        })
    }
    .await;

    match result {
        Ok(handle) => Ok(handle),
        Err(error) => {
            if helper_started {
                hooks.shutdown_helper(helper_port).await;
            }
            if let Some(launch) = &launched {
                if !keep_launched_on_error {
                    hooks.terminate_codex(launch).await;
                }
            }
            let message = error.to_string();
            let failure = launch_status("failed", &message, debug_port, helper_port, &app_dir);
            let _ = status_store.save_latest(&failure);
            hooks.write_status("failed").await;
            Err(error)
        }
    }
}

fn relay_protocol_proxy_enabled(settings: &BackendSettings) -> bool {
    settings.active_relay_uses_protocol_proxy()
}

fn imagegen_mcp_executable_path(launcher_path: &Path) -> PathBuf {
    let file_name = if cfg!(windows) {
        "alunixa-x-imagegen-mcp.exe"
    } else {
        "alunixa-x-imagegen-mcp"
    };
    launcher_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(file_name)
}

fn select_native_menu_inspector_port(debug_port: u16) -> u16 {
    let requested = debug_port.saturating_add(100);
    crate::ports::select_platform_loopback_port(requested)
}

fn start_native_menu_localizer(inspector_port: u16) {
    if inspector_port == 0 {
        return;
    }
    tokio::spawn(async move {
        if let Err(error) = crate::native_menu::install_native_menu_localizer(inspector_port).await
        {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "native_menu.localization_failed",
                serde_json::json!({
                    "inspector_port": inspector_port,
                    "message": error.to_string()
                }),
            );
        }
    });
}

#[cfg(windows)]
fn apply_codexplusplus_window_icon_after_launch(process_id: u32) {
    let icon_resource_path =
        std::env::current_exe().unwrap_or_else(|_| PathBuf::from("alunixa-x.exe"));
    tokio::spawn(async move {
        for attempt in 1..=30 {
            if crate::windows_apply_codexplusplus_icon_to_process_window(
                process_id,
                icon_resource_path.clone(),
            ) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if attempt == 30 {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "launcher.window_icon.apply_failed",
                    serde_json::json!({
                        "process_id": process_id,
                        "icon_resource_path": icon_resource_path.to_string_lossy()
                    }),
                );
            }
        }
    });
}

#[cfg(not(windows))]
fn apply_codexplusplus_window_icon_after_launch(_process_id: u32) {}

pub trait IntoLaunchHooks {
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks>;
}

impl<T> IntoLaunchHooks for &T
where
    T: LaunchHooks + Clone + 'static,
{
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks> {
        Arc::new(self.clone())
    }
}

impl IntoLaunchHooks for Arc<dyn LaunchHooks> {
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks> {
        self
    }
}

impl IntoLaunchHooks for DefaultLaunchHooks {
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks> {
        Arc::new(self)
    }
}

impl DefaultLaunchHooks {
    pub fn shared() -> Arc<dyn LaunchHooks> {
        Arc::new(Self::default())
    }

    pub async fn set_bridge_disconnect(&self, disconnect: crate::bridge::BridgeDisconnect) {
        *self.bridge_disconnect.lock().await = Some(disconnect);
    }

    pub fn shared_terminal_broker(&self) -> Arc<crate::shared_terminal::SharedTerminalBroker> {
        self.shared_terminal.clone()
    }

    pub async fn start_bridge_connection_watchdog(
        &self,
        debug_port: u16,
        helper_port: u16,
        reconnect: BridgeReconnectHandler,
    ) -> anyhow::Result<()> {
        let mut disconnect = self
            .bridge_disconnect
            .lock()
            .await
            .take()
            .ok_or_else(|| anyhow::anyhow!("CDP bridge disconnect signal is unavailable"))?;
        let (shutdown, mut shutdown_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            #[cfg(windows)]
            let pet_cursor_task = tokio::spawn(run_pet_real_mouse_cursor_driver(debug_port));
            'watchdog: loop {
                let reason = tokio::select! {
                    _ = &mut shutdown_rx => break,
                    result = &mut disconnect => result.unwrap_or_else(|_| "CDP bridge monitor stopped".to_string()),
                };
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "bridge.connection_disconnected",
                    serde_json::json!({
                        "debug_port": debug_port,
                        "helper_port": helper_port,
                        "message": reason
                    }),
                );

                let mut retry_delay = std::time::Duration::ZERO;
                loop {
                    if !retry_delay.is_zero() {
                        tokio::select! {
                            _ = &mut shutdown_rx => break 'watchdog,
                            _ = tokio::time::sleep(retry_delay) => {}
                        }
                    }
                    let reconnect_result = tokio::select! {
                        _ = &mut shutdown_rx => break 'watchdog,
                        result = reconnect() => result,
                    };
                    match reconnect_result {
                        Ok(next_disconnect) => {
                            disconnect = next_disconnect;
                            let _ = crate::diagnostic_log::append_diagnostic_log(
                                "bridge.connection_reconnected",
                                serde_json::json!({
                                    "debug_port": debug_port,
                                    "helper_port": helper_port
                                }),
                            );
                            break;
                        }
                        Err(error) => {
                            let _ = crate::diagnostic_log::append_diagnostic_log(
                                "bridge.connection_reconnect_failed",
                                serde_json::json!({
                                    "debug_port": debug_port,
                                    "helper_port": helper_port,
                                    "message": error.to_string()
                                }),
                            );
                            retry_delay = match retry_delay.as_millis() {
                                0 => std::time::Duration::from_millis(250),
                                1..=499 => std::time::Duration::from_millis(500),
                                500..=999 => std::time::Duration::from_secs(1),
                                1000..=1999 => std::time::Duration::from_secs(2),
                                _ => std::time::Duration::from_secs(5),
                            };
                        }
                    }
                }
            }
            #[cfg(windows)]
            {
                pet_cursor_task.abort();
                let _ = pet_cursor_task.await;
            }
        });
        if let Some(runtime) = self
            .bridge_watchdog
            .lock()
            .await
            .replace(BridgeWatchdogRuntime { shutdown, task })
        {
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
        Ok(())
    }
}

fn helper_bind_host() -> String {
    std::env::var("ALUNIXA_X_HELPER_BIND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[async_trait(?Send)]
impl LaunchHooks for DefaultLaunchHooks {
    fn resolve_app_dir(
        &self,
        app_dir: Option<&Path>,
        settings: &BackendSettings,
    ) -> anyhow::Result<PathBuf> {
        crate::app_paths::resolve_codex_app_dir_with_saved(
            app_dir,
            Some(settings.codex_app_path.as_str()),
        )
        .ok_or_else(|| anyhow::anyhow!("Codex App directory not found"))
    }

    fn select_debug_port(&self, requested: u16) -> u16 {
        crate::ports::select_packaged_codex_debug_port(requested)
    }

    fn select_helper_port(&self, requested: u16) -> u16 {
        crate::ports::select_platform_loopback_port(requested)
    }

    async fn load_settings(&self) -> anyhow::Result<BackendSettings> {
        SettingsStore::default().load()
    }

    async fn run_provider_sync(&self) -> anyhow::Result<()> {
        anyhow::bail!("provider sync requires launcher hooks with alunixa-x-data integration")
    }

    async fn apply_active_relay_profile(&self, settings: &BackendSettings) -> anyhow::Result<()> {
        if !settings.relay_profiles_enabled {
            return Ok(());
        }
        let mut profile = settings.active_relay_profile();
        crate::relay_config::normalize_relay_profile_for_storage(&mut profile)
            .context("failed to validate the active provider before Codex startup")?;
        let home = crate::relay_config::default_codex_home_dir();
        let common_config = crate::relay_config::normalize_config_text(
            &[
                settings.relay_common_config_contents.as_str(),
                settings.relay_context_config_contents.as_str(),
            ]
            .into_iter()
            .map(str::trim)
            .filter(|section| !section.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        );
        if profile.relay_mode == crate::settings::RelayMode::Official
            && !profile.official_mix_api_key
        {
            let auth_contents = (!profile.auth_contents.trim().is_empty())
                .then_some(profile.auth_contents.as_str());
            crate::relay_config::clear_relay_config_to_home_with_auth_and_computer_use_guard(
                &home,
                auth_contents,
                settings.computer_use_guard_enabled,
            )?;
            return Ok(());
        }
        crate::relay_config::apply_relay_profile_config_to_home_with_switch_rules_and_computer_use_guard(
            &home,
            &profile,
            &common_config,
            settings.computer_use_guard_enabled,
        )?;
        Ok(())
    }

    async fn ensure_computer_use_config(&self, settings: &BackendSettings) -> anyhow::Result<()> {
        if !settings.computer_use_guard_enabled {
            return Ok(());
        }
        let home = crate::relay_config::default_codex_home_dir();
        let artifacts = crate::computer_use_guard::resolve_computer_use_guard_artifacts(&home)?;
        crate::computer_use_guard::ensure_computer_use_config_with_artifacts(&home, &artifacts)?;
        *self.computer_use_guard_artifacts.lock().await = Some(artifacts);
        Ok(())
    }

    async fn ensure_plugin_marketplace_config(
        &self,
        settings: &BackendSettings,
    ) -> anyhow::Result<()> {
        if !settings.codex_app_plugin_marketplace_unlock {
            return Ok(());
        }
        let home = crate::relay_config::default_codex_home_dir();
        match crate::plugin_marketplace::ensure_openai_curated_marketplace_config(&home) {
            Ok(configured) => {
                if configured {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.openai_curated_marketplace_configured",
                        serde_json::json!({
                            "home": home,
                        }),
                    );
                }
            }
            Err(error) => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "launcher.openai_curated_marketplace_config_failed",
                    serde_json::json!({
                        "home": home,
                        "message": error.to_string(),
                    }),
                );
            }
        }
        match crate::plugin_marketplace::ensure_role_specific_plugins_marketplace_config(&home) {
            Ok(configured) => {
                if configured {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.role_specific_plugins_marketplace_configured",
                        serde_json::json!({
                            "home": home,
                        }),
                    );
                }
            }
            Err(error) => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "launcher.role_specific_plugins_marketplace_config_failed",
                    serde_json::json!({
                        "home": home,
                        "message": error.to_string(),
                    }),
                );
            }
        }
        Ok(())
    }

    async fn ensure_imagegen_mcp_config(
        &self,
        settings: &BackendSettings,
        helper_port: u16,
    ) -> anyhow::Result<()> {
        let home = crate::relay_config::default_codex_home_dir();
        let launcher_path = std::env::current_exe().context("无法解析 Alunixa X launcher 路径")?;
        let enabled = settings.enhancements_enabled && settings.relay_profiles_enabled;
        let imagegen_mcp_path = imagegen_mcp_executable_path(&launcher_path);
        if enabled && !imagegen_mcp_path.is_file() {
            anyhow::bail!(
                "Alunixa X image_gen MCP companion 不存在：{}",
                imagegen_mcp_path.display()
            );
        }
        let changed = crate::relay_config::set_codex_imagegen_mcp_in_home(
            &home,
            &imagegen_mcp_path,
            helper_port,
            enabled,
        )?;
        if changed {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.imagegen_mcp_config_updated",
                serde_json::json!({
                    "enabled": enabled,
                    "helper_port": helper_port,
                    "home": home
                }),
            );
        }
        Ok(())
    }

    async fn start_helper(&self, helper_port: u16) -> anyhow::Result<()> {
        let bind_host = helper_bind_host();
        let listener = tokio::net::TcpListener::bind((bind_host.as_str(), helper_port))
            .await
            .with_context(|| {
                format!("failed to bind helper runtime on {bind_host}:{helper_port}")
            })?;
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "helper.listening",
            serde_json::json!({
                "helper_port": helper_port,
                "bind_host": bind_host,
                "address": format!("http://{bind_host}:{helper_port}")
            }),
        );
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
        let (connection_shutdown, _) = tokio::sync::broadcast::channel(1);
        let accepted_connection_shutdown = connection_shutdown.clone();
        let shared_terminal = self.shared_terminal.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        if let Ok((stream, addr)) = accepted {
                            let connection_shutdown = accepted_connection_shutdown.subscribe();
                            let shared_terminal = shared_terminal.clone();
                            tokio::spawn(async move {
                                let _ = handle_helper_connection(
                                    stream,
                                    Some(addr),
                                    connection_shutdown,
                                    shared_terminal,
                                )
                                .await;
                            });
                        }
                    }
                }
            }
        });
        let runtime = HelperRuntime {
            shutdown: shutdown_tx,
            connection_shutdown,
            task,
        };
        let previous = self.helper.lock().await.replace(runtime);
        if let Some(previous) = previous {
            let _ = previous.connection_shutdown.send(());
            let _ = previous.shutdown.send(());
            let _ = previous.task.await;
        }
        Ok(())
    }

    async fn launch_codex(
        &self,
        app_dir: &Path,
        debug_port: u16,
        settings: &BackendSettings,
        extra_args: &[String],
    ) -> anyhow::Result<CodexLaunch> {
        crate::codex_auto_update::apply_codex_auto_update_policy(
            settings.codex_app_disable_auto_update,
        )
        .context("failed to apply Codex automatic update policy")?;
        if settings.enhancements_enabled {
            let home = crate::relay_config::default_codex_home_dir();
            crate::codex_app_state::prepare_projectless_main_window_nonfatal(
                &home,
                "launcher.prelaunch",
            );
        }
        let native_menu_localization_enabled = settings.codex_app_native_menu_localization;
        let native_menu_inspector_port =
            native_menu_localization_enabled.then(|| select_native_menu_inspector_port(debug_port));
        let launch_extra_args = codex_extra_args_for_launch(settings, extra_args);
        if cfg!(windows) {
            let activation = if let Some(inspector_port) = native_menu_inspector_port {
                build_packaged_activation_with_native_menu_inspector(
                    app_dir,
                    debug_port,
                    inspector_port,
                    &launch_extra_args,
                )
            } else {
                build_packaged_activation(app_dir, debug_port, &launch_extra_args)
            };
            if let Some(activation) = activation {
                let CodexLaunch::PackagedActivation {
                    app_user_model_id,
                    arguments,
                    ..
                } = &activation
                else {
                    unreachable!();
                };
                let process_id = activate_packaged_app(app_user_model_id, arguments).await?;
                apply_codexplusplus_window_icon_after_launch(process_id);
                if let Some(inspector_port) = native_menu_inspector_port {
                    start_native_menu_localizer(inspector_port);
                }
                return Ok(match activation {
                    CodexLaunch::PackagedActivation {
                        app_user_model_id,
                        arguments,
                        ..
                    } => CodexLaunch::PackagedActivation {
                        app_user_model_id,
                        arguments,
                        process_id: Some(process_id),
                    },
                    CodexLaunch::Process { .. } => unreachable!(),
                });
            }
        }

        if app_dir.extension().and_then(|value| value.to_str()) == Some("app") {
            let cleanup_policy = if is_macos_app_running(app_dir).await {
                MacosCleanupPolicy::SkipQuitBecauseAlreadyRunning
            } else {
                MacosCleanupPolicy::QuitIfNotPreviouslyRunning
            };
            let command = if let Some(inspector_port) = native_menu_inspector_port {
                build_macos_open_command_with_native_menu_inspector(
                    app_dir,
                    debug_port,
                    inspector_port,
                    &launch_extra_args,
                )
            } else {
                build_macos_open_command(app_dir, debug_port, &launch_extra_args)
            };
            let executable = command
                .first()
                .ok_or_else(|| anyhow::anyhow!("macOS open command is empty"))?;
            let mut child_command = Command::new(executable);
            crate::codex_auto_update::configure_codex_process_command(
                &mut child_command,
                settings.codex_app_disable_auto_update,
            );
            let child = child_command
                .args(&command[1..])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .context("failed to launch macOS Codex app")?;
            *self.child.lock().await = Some(child);
            if let Some(inspector_port) = native_menu_inspector_port {
                start_native_menu_localizer(inspector_port);
            }
            return Ok(CodexLaunch::Process {
                command,
                wait_strategy: ProcessWaitStrategy::ExternalWaitCommand,
                macos_cleanup_policy: Some(cleanup_policy),
            });
        }

        let command = if let Some(inspector_port) = native_menu_inspector_port {
            build_codex_command_with_native_menu_inspector(
                app_dir,
                debug_port,
                inspector_port,
                &launch_extra_args,
            )
        } else {
            build_codex_command(app_dir, debug_port, &launch_extra_args)
        };
        let executable = command
            .first()
            .ok_or_else(|| anyhow::anyhow!("Codex command is empty"))?;
        let mut child_command = Command::new(executable);
        crate::codex_auto_update::configure_codex_process_command(
            &mut child_command,
            settings.codex_app_disable_auto_update,
        );
        child_command
            .args(&command[1..])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        child_command.creation_flags(crate::windows_integration::CREATE_NO_WINDOW);
        let child = child_command
            .spawn()
            .with_context(|| format!("failed to launch Codex executable {executable}"))?;
        *self.child.lock().await = Some(child);
        if let Some(inspector_port) = native_menu_inspector_port {
            start_native_menu_localizer(inspector_port);
        }
        Ok(CodexLaunch::Process {
            command,
            wait_strategy: ProcessWaitStrategy::TrackedChild,
            macos_cleanup_policy: None,
        })
    }

    async fn inject(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
        let disconnect = retry_injection(debug_port, helper_port).await?;
        self.set_bridge_disconnect(disconnect).await;
        Ok(())
    }

    async fn verify_startup_injection(
        &self,
        debug_port: u16,
        helper_port: u16,
        settings: &BackendSettings,
    ) -> anyhow::Result<()> {
        verify_startup_model_injection(debug_port, helper_port, settings).await
    }
    async fn start_bridge_watchdog(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
        let reconnect: BridgeReconnectHandler = Arc::new(move || {
            Box::pin(async move {
                let disconnect = retry_injection(debug_port, helper_port).await?;
                let pet_result = sync_pet_real_mouse_overlay(debug_port, helper_port).await;
                record_pet_overlay_sync_result(debug_port, helper_port, pet_result);
                Ok(disconnect)
            })
        });
        self.start_bridge_connection_watchdog(debug_port, helper_port, reconnect)
            .await
    }

    async fn start_computer_use_guard_watchdog(
        &self,
        settings: &BackendSettings,
    ) -> anyhow::Result<()> {
        #[cfg(windows)]
        {
            if !settings.computer_use_guard_enabled {
                return Ok(());
            }
            let home = crate::relay_config::default_codex_home_dir();
            let artifacts = self.computer_use_guard_artifacts.lock().await.clone();
            let (shutdown, mut shutdown_rx) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(async move {
                run_post_launch_computer_use_guard(home, artifacts, &mut shutdown_rx).await;
            });
            if let Some(runtime) = self
                .computer_use_guard_watchdog
                .lock()
                .await
                .replace(ComputerUseGuardWatchdogRuntime { shutdown, task })
            {
                let _ = runtime.shutdown.send(());
                let _ = runtime.task.await;
            }
        }
        #[cfg(target_os = "macos")]
        {
            let _ = &settings;
            let (shutdown, mut shutdown_rx) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = &mut shutdown_rx => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(120)) => {
                            crate::computer_use_guard::kill_orphaned_computer_use_processes();
                        }
                    }
                }
            });
            if let Some(runtime) = self
                .computer_use_guard_watchdog
                .lock()
                .await
                .replace(ComputerUseGuardWatchdogRuntime { shutdown, task })
            {
                let _ = runtime.shutdown.send(());
                let _ = runtime.task.await;
            }
        }
        Ok(())
    }

    async fn write_status(&self, _status: &str) {}

    async fn wait_for_codex_exit(
        &self,
        launch: &CodexLaunch,
        debug_port: u16,
    ) -> anyhow::Result<()> {
        match launch {
            CodexLaunch::Process { .. } => {
                if let Some(mut child) = self.child.lock().await.take() {
                    let _ = child.wait().await;
                }
            }
            CodexLaunch::PackagedActivation { process_id, .. } => {
                if let Some(process_id) = process_id {
                    wait_for_windows_process_id(*process_id).await?;
                }
            }
        }
        let mut empty_streak = 0u32;
        loop {
            let has_codex_process = !crate::watcher::find_codex_processes().is_empty();
            let cdp_available = should_probe_launcher_cdp(cfg!(windows), has_codex_process)
                && crate::ports::is_existing_codex_cdp_port(debug_port);
            if !launcher_target_alive(has_codex_process, cdp_available) {
                empty_streak = empty_streak.saturating_add(1);
                if empty_streak >= 3 {
                    break;
                }
            } else {
                empty_streak = 0;
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        Ok(())
    }

    async fn shutdown_helper(&self, _helper_port: u16) {
        if let Some(runtime) = self.computer_use_guard_watchdog.lock().await.take() {
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
        if let Some(runtime) = self.bridge_watchdog.lock().await.take() {
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
        if let Some(runtime) = self.helper.lock().await.take() {
            let _ = runtime.connection_shutdown.send(());
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
    }

    async fn terminate_codex(&self, launch: &CodexLaunch) {
        match launch {
            CodexLaunch::Process {
                wait_strategy: ProcessWaitStrategy::ExternalWaitCommand,
                command,
                macos_cleanup_policy,
            } => {
                if let Some(mut child) = self.child.lock().await.take() {
                    let _ = child.kill().await;
                }
                if let (Some(app_dir), Some(cleanup_policy)) = (
                    macos_app_dir_from_open_command(command),
                    *macos_cleanup_policy,
                ) {
                    let _ = run_macos_cleanup_command(&app_dir, cleanup_policy).await;
                }
            }
            CodexLaunch::Process { .. } => {
                if let Some(mut child) = self.child.lock().await.take() {
                    let _ = child.kill().await;
                }
            }
            CodexLaunch::PackagedActivation {
                process_id: Some(process_id),
                ..
            } => {
                let _ = terminate_windows_process_id(*process_id).await;
            }
            CodexLaunch::PackagedActivation {
                process_id: None, ..
            } => {}
        }
    }
}

fn launcher_target_alive(has_codex_process: bool, cdp_available: bool) -> bool {
    has_codex_process || cdp_available
}

fn should_probe_launcher_cdp(is_windows: bool, has_codex_process: bool) -> bool {
    is_windows && !has_codex_process
}

async fn handle_helper_connection(
    mut stream: tokio::net::TcpStream,
    remote_addr: Option<SocketAddr>,
    mut connection_shutdown: tokio::sync::broadcast::Receiver<()>,
    shared_terminal: Arc<crate::shared_terminal::SharedTerminalBroker>,
) -> anyhow::Result<()> {
    let request = match read_http_request(&mut stream).await {
        Ok(request) => request,
        Err(error) => {
            let body = serde_json::to_vec(&serde_json::json!({
                "status": "failed",
                "message": error.to_string()
            }))?;
            write_http_response(
                &mut stream,
                error.status(),
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            stream.shutdown().await?;
            return Ok(());
        }
    };
    let request_headers = String::from_utf8_lossy(&request.headers);
    let request_line = request_headers.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let raw_path = parts.next().unwrap_or_default();
    let path = raw_path.split('?').next().unwrap_or(raw_path);
    let request_user_agent = header_value_from_headers(&request_headers, "user-agent");
    let remote_addr_text = remote_addr.map(|addr| addr.to_string());

    let quiet_status_request = matches!(
        path,
        "/backend/status"
            | "/backend/events"
            | "/shared-terminal/submit"
            | "/shared-terminal/next"
            | "/shared-terminal/started"
            | "/shared-terminal/heartbeat"
            | "/shared-terminal/complete"
    );
    if !quiet_status_request {
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "helper.request",
            serde_json::json!({
                "method": method,
                "path": path,
                "request_line": request_line,
                "remote_addr": remote_addr_text,
                "body_bytes": request.body.len()
            }),
        );
    }

    if path == "/backend/events"
        && method == "GET"
        && header_value_from_headers(&request_headers, "upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
    {
        return handle_backend_events_websocket(stream, &request_headers, &mut connection_shutdown)
            .await;
    }
    if crate::protocol_proxy::is_transparent_api_proxy_path(path)
        && method == "GET"
        && header_value_from_headers(&request_headers, "upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
    {
        let forward_headers = header_pairs_from_headers(&request_headers);
        return handle_transparent_api_websocket(
            stream,
            &request_headers,
            raw_path,
            &forward_headers,
            request_user_agent.as_deref(),
            remote_addr_text,
            &mut connection_shutdown,
        )
        .await;
    }

    let request_body_bytes = request.body.as_bytes();
    let request_body = request_body_bytes.map(String::from_utf8_lossy);
    if path.starts_with("/shared-terminal/")
        && !remote_addr.is_some_and(|address| address.ip().is_loopback())
    {
        let body = serde_json::to_vec(&serde_json::json!({
            "status": "failed",
            "message": "共享终端仅允许本机访问"
        }))?;
        write_http_response(
            &mut stream,
            "403 Forbidden",
            "application/json; charset=utf-8",
            &body,
        )
        .await?;
        stream.shutdown().await?;
        return Ok(());
    }
    if path == "/shared-terminal/submit" && method == "POST" {
        let request = serde_json::from_slice::<crate::shared_terminal::SharedTerminalRequest>(
            request_body_bytes.context("共享终端请求体过大")?,
        )
        .context("共享终端提交请求无效")?;
        let response = shared_terminal.submit(request).await?;
        let body = serde_json::to_vec(&response)?;
        write_http_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            &body,
        )
        .await?;
        stream.shutdown().await?;
        return Ok(());
    }
    if crate::protocol_proxy::is_responses_proxy_path(path)
        && method == "POST"
        && request_body.is_some()
    {
        return handle_protocol_proxy_connection(
            &mut stream,
            request_body.as_deref().unwrap_or_default(),
            request_user_agent.as_deref(),
            method,
            path,
            remote_addr_text,
        )
        .await;
    }
    if crate::protocol_proxy::is_chat_completions_proxy_path(path)
        && method == "POST"
        && request_body.is_some()
    {
        return handle_chat_completions_proxy_connection(
            &mut stream,
            request_body.as_deref().unwrap_or_default(),
            request_user_agent.as_deref(),
            method,
            path,
            remote_addr_text,
        )
        .await;
    }
    if crate::protocol_proxy::is_models_proxy_path(path) && matches!(method, "GET" | "OPTIONS") {
        return handle_models_proxy_connection(
            &mut stream,
            request_user_agent.as_deref(),
            method,
            path,
            remote_addr_text,
        )
        .await;
    }
    if crate::protocol_proxy::is_transparent_api_proxy_path(path)
        && matches!(
            method,
            "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
        )
    {
        if method == "OPTIONS" {
            write_http_cors_preflight_response(&mut stream).await?;
            stream.shutdown().await?;
            return Ok(());
        }
        let forward_headers = header_pairs_from_headers(&request_headers);
        let request_body_len = request.body.len();
        let request_body = request.body.into_reqwest_body()?;
        return handle_transparent_proxy_connection(
            &mut stream,
            method,
            raw_path,
            &forward_headers,
            request_body,
            (request_body_len > 0).then_some(request_body_len),
            request_user_agent.as_deref(),
            remote_addr_text,
        )
        .await;
    }

    let (status, body, content_type, log_event) = if path == "/backend/status"
        && matches!(method, "GET" | "POST" | "OPTIONS")
    {
        (
            "200 OK".to_string(),
            serde_json::to_vec(&backend_status_payload("http-helper"))?,
            "application/json; charset=utf-8".to_string(),
            "helper.backend_status_ok",
        )
    } else if path == "/diagnostics/log" && matches!(method, "POST" | "OPTIONS") {
        if method == "POST" {
            let detail = serde_json::from_str::<serde_json::Value>(
                request_body.as_deref().unwrap_or_default(),
            )
            .unwrap_or_else(|error| {
                serde_json::json!({
                    "parse_error": error.to_string(),
                    "raw": request_body.as_deref().unwrap_or_default()
                })
            });
            let event = detail
                .get("event")
                .and_then(serde_json::Value::as_str)
                .map(sanitize_diagnostic_event)
                .unwrap_or_else(|| "event".to_string());
            let _ =
                crate::diagnostic_log::append_diagnostic_log(&format!("renderer.{event}"), detail);
        }
        (
            "200 OK".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "status": "ok",
                "message": "日志已记录"
            }))?,
            "application/json; charset=utf-8".to_string(),
            "helper.diagnostics_log_ok",
        )
    } else if path == "/overlay/image" && matches!(method, "GET" | "OPTIONS") {
        if method == "OPTIONS" {
            (
                "200 OK".to_string(),
                Vec::new(),
                "application/octet-stream".to_string(),
                "helper.overlay_image_options",
            )
        } else {
            overlay_image_response()
        }
    } else {
        (
            "404 Not Found".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "status": "failed",
                "message": "未知后端路径"
            }))?,
            "application/json; charset=utf-8".to_string(),
            "helper.unknown_path",
        )
    };
    if !quiet_status_request {
        let _ = crate::diagnostic_log::append_diagnostic_log(
            log_event,
            serde_json::json!({
                "method": method,
                "path": path,
                "status": status,
                "remote_addr": remote_addr_text
            }),
        );
    }
    let response = if method == "OPTIONS" {
        format!(
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
    } else {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
    };
    stream.write_all(response.as_bytes()).await?;
    if method != "OPTIONS" {
        stream.write_all(&body).await?;
    }
    stream.shutdown().await?;
    Ok(())
}

fn backend_status_payload(transport: &str) -> Value {
    serde_json::json!({
        "status": "ok",
        "message": "后端已连接",
        "version": crate::version::VERSION,
        "transport": transport,
        "processId": std::process::id()
    })
}

async fn handle_backend_events_websocket(
    mut stream: tokio::net::TcpStream,
    request: &str,
    connection_shutdown: &mut tokio::sync::broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    let key = header_value_from_headers(request, "sec-websocket-key")
        .ok_or_else(|| anyhow::anyhow!("WebSocket upgrade is missing Sec-WebSocket-Key"))?;
    let version = header_value_from_headers(request, "sec-websocket-version")
        .unwrap_or_else(|| "13".to_string());
    if version != "13" {
        anyhow::bail!("unsupported WebSocket version {version}");
    }
    let accept_key = tokio_tungstenite::tungstenite::handshake::derive_accept_key(key.as_bytes());
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: {accept_key}\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;

    let mut websocket = tokio_tungstenite::WebSocketStream::from_raw_socket(
        stream,
        tokio_tungstenite::tungstenite::protocol::Role::Server,
        None,
    )
    .await;
    websocket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            backend_status_payload("websocket").to_string().into(),
        ))
        .await?;
    loop {
        let message = tokio::select! {
            _ = connection_shutdown.recv() => {
                let _ = websocket.close(None).await;
                break;
            }
            message = websocket.next() => message,
        };
        let Some(message) = message else {
            break;
        };
        match message? {
            tokio_tungstenite::tungstenite::Message::Text(text)
                if text.eq_ignore_ascii_case("status") =>
            {
                websocket
                    .send(tokio_tungstenite::tungstenite::Message::Text(
                        backend_status_payload("websocket").to_string().into(),
                    ))
                    .await?;
            }
            tokio_tungstenite::tungstenite::Message::Ping(payload) => {
                websocket
                    .send(tokio_tungstenite::tungstenite::Message::Pong(payload))
                    .await?;
            }
            tokio_tungstenite::tungstenite::Message::Close(_) => break,
            _ => {}
        }
    }
    Ok(())
}

async fn handle_transparent_api_websocket(
    mut stream: tokio::net::TcpStream,
    request: &str,
    request_path: &str,
    request_headers: &[(String, String)],
    request_user_agent: Option<&str>,
    remote_addr_text: Option<String>,
    connection_shutdown: &mut tokio::sync::broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    let key = header_value_from_headers(request, "sec-websocket-key")
        .ok_or_else(|| anyhow::anyhow!("WebSocket upgrade is missing Sec-WebSocket-Key"))?;
    let version = header_value_from_headers(request, "sec-websocket-version")
        .unwrap_or_else(|| "13".to_string());
    if version != "13" {
        anyhow::bail!("unsupported WebSocket version {version}");
    }
    let (mut upstream, upstream_response) =
        match crate::protocol_proxy::open_transparent_websocket_request(
            request_path,
            request_headers,
            request_user_agent,
        )
        .await
        {
            Ok(connected) => connected,
            Err(error) => {
                log_proxy_open_failure(
                    "helper.transparent_websocket_open_failed",
                    "GET",
                    request_path,
                    remote_addr_text.as_deref(),
                    None,
                    &error,
                );
                let body = serde_json::to_vec(&serde_json::json!({
                    "error": {
                        "type": "alunixa_x_proxy_error",
                        "message": error.to_string()
                    }
                }))?;
                write_http_response(
                    &mut stream,
                    "502 Bad Gateway",
                    "application/json; charset=utf-8",
                    &body,
                )
                .await?;
                stream.shutdown().await?;
                return Ok(());
            }
        };
    let accept_key = tokio_tungstenite::tungstenite::handshake::derive_accept_key(key.as_bytes());
    let mut response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: {accept_key}\r\n"
    );
    if let Some(protocol) = upstream_response
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
    {
        response.push_str("Sec-WebSocket-Protocol: ");
        response.push_str(protocol);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes()).await?;
    let mut downstream = tokio_tungstenite::WebSocketStream::from_raw_socket(
        stream,
        tokio_tungstenite::tungstenite::protocol::Role::Server,
        None,
    )
    .await;
    loop {
        tokio::select! {
            _ = connection_shutdown.recv() => {
                let _ = downstream.close(None).await;
                let _ = upstream.close(None).await;
                break;
            }
            message = downstream.next() => {
                let Some(message) = message else { break; };
                let message = message?;
                let close = matches!(message, tokio_tungstenite::tungstenite::Message::Close(_));
                upstream.send(message).await?;
                if close {
                    break;
                }
            }
            message = upstream.next() => {
                let Some(message) = message else { break; };
                let message = message?;
                let close = matches!(message, tokio_tungstenite::tungstenite::Message::Close(_));
                downstream.send(message).await?;
                if close {
                    break;
                }
            }
        }
    }
    log_helper_response(
        "helper.transparent_websocket_closed",
        "GET",
        request_path,
        "101 Switching Protocols",
        remote_addr_text,
    );
    Ok(())
}

fn overlay_image_response() -> (String, Vec<u8>, String, &'static str) {
    let not_found = || {
        (
            "404 Not Found".to_string(),
            serde_json::to_vec(&serde_json::json!({
                "status": "failed",
                "message": "图片覆盖层未启用或图片不可用"
            }))
            .unwrap_or_default(),
            "application/json; charset=utf-8".to_string(),
            "helper.overlay_image_not_found",
        )
    };
    let settings = SettingsStore::default().load().unwrap_or_default();
    if !settings.codex_app_image_overlay_enabled {
        return not_found();
    }
    let image_path = PathBuf::from(settings.codex_app_image_overlay_path.trim());
    if image_path.as_os_str().is_empty() || !image_path.is_file() {
        return not_found();
    }
    let Some(content_type) = overlay_image_content_type(&image_path) else {
        return not_found();
    };
    match std::fs::read(&image_path) {
        Ok(bytes) => (
            "200 OK".to_string(),
            bytes,
            content_type.to_string(),
            "helper.overlay_image_ok",
        ),
        Err(_) => not_found(),
    }
}

#[cfg(windows)]
fn windows_logical_cursor_position() -> anyhow::Result<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::HiDpi::{
        DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED, SetThreadDpiAwarenessContext,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let previous = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED) };
    if previous.0.is_null() {
        anyhow::bail!("SetThreadDpiAwarenessContext failed");
    }
    let mut point = POINT::default();
    let result = unsafe { GetCursorPos(&mut point) };
    unsafe {
        SetThreadDpiAwarenessContext(previous);
    }
    result.ok().context("GetCursorPos failed")?;
    Ok((point.x, point.y))
}

fn overlay_image_content_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        Some("bmp") => Some("image/bmp"),
        _ => None,
    }
}

async fn handle_models_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    request_user_agent: Option<&str>,
    method: &str,
    path: &str,
    remote_addr_text: Option<String>,
) -> anyhow::Result<()> {
    if method == "OPTIONS" {
        write_http_response(
            stream,
            "204 No Content",
            "application/json; charset=utf-8",
            &[],
        )
        .await?;
        stream.shutdown().await?;
        return Ok(());
    }
    let settings = crate::settings::SettingsStore::default()
        .load()
        .unwrap_or_default();
    let active = settings.active_relay_profile();
    if active.relay_mode == crate::settings::RelayMode::CustomModels {
        let body = serde_json::to_vec(&crate::protocol_proxy::custom_models_list_payload(&active))?;
        write_http_response(stream, "200 OK", "application/json; charset=utf-8", &body).await?;
        log_helper_response(
            "helper.models_proxy_ok",
            method,
            path,
            "200 OK",
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }
    let upstream = match crate::protocol_proxy::open_models_proxy_request(request_user_agent).await
    {
        Ok(upstream) => upstream,
        Err(error) => {
            log_proxy_open_failure(
                "helper.models_proxy_open_failed",
                method,
                path,
                remote_addr_text.as_deref(),
                None,
                &error,
            );
            let body = serde_json::to_vec(
                &serde_json::json!({                 "status": "failed",                 "message": error.to_string()             }),
            )?;
            write_http_response(
                stream,
                "502 Bad Gateway",
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            log_helper_response(
                "helper.models_proxy_failed",
                method,
                path,
                "502 Bad Gateway",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    };
    let status = upstream.status();
    let is_success = upstream.is_success();
    let content_type = if upstream.content_type.is_empty() {
        "application/json; charset=utf-8".to_string()
    } else {
        upstream.content_type.clone()
    };
    let mut body = upstream.response.bytes().await?.to_vec();
    if is_success
        && matches!(
            upstream.wire_api,
            crate::protocol_proxy::UpstreamWireApi::AnthropicMessages
                | crate::protocol_proxy::UpstreamWireApi::GeminiGenerateContent
        )
    {
        if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) {
            body = serde_json::to_vec(&crate::protocol_proxy::normalize_models_payload(&payload))?;
        }
    }
    write_http_response(stream, &status, &content_type, &body).await?;
    log_helper_response(
        if is_success {
            "helper.models_proxy_ok"
        } else {
            "helper.models_proxy_upstream_error"
        },
        method,
        path,
        &status,
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}
async fn handle_protocol_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    request_body: &str,
    request_user_agent: Option<&str>,
    method: &str,
    path: &str,
    remote_addr_text: Option<String>,
) -> anyhow::Result<()> {
    let request_json = serde_json::from_str::<serde_json::Value>(request_body).ok();
    let upstream = match crate::protocol_proxy::open_responses_proxy_request_for_path(
        request_body,
        request_user_agent,
        path,
    )
    .await
    {
        Ok(upstream) => upstream,
        Err(error) => {
            log_proxy_open_failure(
                "helper.protocol_proxy_open_failed",
                method,
                path,
                remote_addr_text.as_deref(),
                request_json
                    .as_ref()
                    .and_then(|request| request.get("model"))
                    .and_then(serde_json::Value::as_str),
                &error,
            );
            let body = serde_json::to_vec(
                &serde_json::json!({                     "status": "failed",                     "message": error.to_string()                 }),
            )?;
            write_http_response(
                stream,
                "502 Bad Gateway",
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            log_helper_response(
                "helper.protocol_proxy_failed",
                method,
                path,
                "502 Bad Gateway",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    };
    if !upstream.is_success() {
        let status = upstream.status();
        let upstream_content_type = upstream.content_type.clone();
        let upstream_body = upstream.response.bytes().await?.to_vec();
        let error = crate::protocol_proxy::responses_error_from_upstream(
            upstream.status_code,
            &upstream_content_type,
            &upstream_body,
        );
        let body = serde_json::to_vec(&error)?;
        write_http_response(stream, &status, "application/json; charset=utf-8", &body).await?;
        log_helper_response(
            "helper.protocol_proxy_upstream_error",
            method,
            path,
            &status,
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }
    if upstream.is_stream {
        if upstream.wire_api == crate::protocol_proxy::UpstreamWireApi::Responses {
            let negotiation_enabled = SettingsStore::default()
                .load()
                .map(|settings| {
                    settings.enhancements_enabled && settings.codex_app_responses_id_negotiation
                })
                .unwrap_or(false);
            if !negotiation_enabled {
                write_http_stream_headers(stream, "200 OK", "text/event-stream; charset=utf-8")
                    .await?;
                let mut bytes_stream = upstream.response.bytes_stream();
                while let Some(chunk) = bytes_stream.next().await {
                    if let Ok(bytes) = chunk {
                        stream.write_all(&bytes).await?;
                    } else {
                        break;
                    }
                }
                log_helper_response(
                    "helper.protocol_proxy_stream_ok",
                    method,
                    path,
                    "200 OK",
                    remote_addr_text,
                );
                stream.shutdown().await?;
                return Ok(());
            }
            let mut upstream_response = upstream.response;
            let mut prefix = read_responses_stream_prefix(&mut upstream_response).await?;
            let mut retry_applied = false;
            if let Some(repair) =
                crate::protocol_proxy::repair_responses_item_ids_for_upstream_error(
                    request_body,
                    &String::from_utf8_lossy(&prefix),
                )
            {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "protocol_proxy.responses_item_id_prefix_retry",
                    serde_json::json!({
                        "sourcePrefix": repair.source_prefix,
                        "expectedPrefix": repair.expected_prefix,
                        "changedItemCount": repair.changed_count
                    }),
                );
                match crate::protocol_proxy::open_responses_proxy_request_for_path(
                    &repair.body,
                    request_user_agent,
                    path,
                )
                .await
                {
                    Ok(retry)
                        if retry.is_success()
                            && retry.is_stream
                            && retry.wire_api
                                == crate::protocol_proxy::UpstreamWireApi::Responses =>
                    {
                        upstream_response = retry.response;
                        prefix = read_responses_stream_prefix(&mut upstream_response).await?;
                        retry_applied = true;
                    }
                    Ok(_) => {
                        let _ = crate::diagnostic_log::append_diagnostic_log(
                            "protocol_proxy.responses_item_id_prefix_retry_rejected",
                            serde_json::json!({ "reason": "unexpected_retry_response" }),
                        );
                    }
                    Err(error) => {
                        let _ = crate::diagnostic_log::append_diagnostic_log(
                            "protocol_proxy.responses_item_id_prefix_retry_failed",
                            serde_json::json!({
                                "error": error.to_string().chars().take(512).collect::<String>()
                            }),
                        );
                    }
                }
            }
            write_http_stream_headers(stream, "200 OK", "text/event-stream; charset=utf-8").await?;
            if !prefix.is_empty() {
                stream.write_all(&prefix).await?;
            }
            while let Some(bytes) = upstream_response.chunk().await? {
                stream.write_all(&bytes).await?;
            }
            log_helper_response(
                if retry_applied {
                    "helper.protocol_proxy_stream_retry_ok"
                } else {
                    "helper.protocol_proxy_stream_ok"
                },
                method,
                path,
                "200 OK",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
        write_http_stream_headers(stream, "200 OK", "text/event-stream; charset=utf-8").await?;
        let fallback_request = serde_json::json!({});
        let original_request = request_json.as_ref().unwrap_or(&fallback_request);
        let mut converter = crate::protocol_proxy::UpstreamSseToResponsesConverter::with_request(
            upstream.wire_api,
            original_request,
        )
        .ok_or_else(|| anyhow::anyhow!("无法为上游协议创建流转换器"))?;
        let mut bytes_stream = upstream.response.bytes_stream();
        let mut stream_failed = false;
        loop {
            let next = match tokio::time::timeout(
                crate::protocol_proxy::upstream_stream_idle_timeout(),
                bytes_stream.next(),
            )
            .await
            {
                Ok(next) => next,
                Err(_) => {
                    let failed = converter.fail(
                        format!(
                            "上游流超过 {} 秒没有新数据",
                            crate::protocol_proxy::upstream_stream_idle_timeout().as_secs()
                        ),
                        Some("stream_idle_timeout".to_string()),
                    );
                    if !failed.is_empty() {
                        stream.write_all(&failed).await?;
                    }
                    stream_failed = true;
                    break;
                }
            };
            let Some(chunk) = next else {
                break;
            };
            match chunk {
                Ok(bytes) => {
                    let converted = converter.push_bytes(&bytes);
                    if !converted.is_empty() {
                        stream.write_all(&converted).await?;
                    }
                    if converter.is_completed() {
                        break;
                    }
                }
                Err(error) => {
                    let failed = converter.fail(
                        format!("Stream error: {error}"),
                        Some("stream_error".to_string()),
                    );
                    if !failed.is_empty() {
                        stream.write_all(&failed).await?;
                    }
                    stream_failed = true;
                    break;
                }
            }
        }
        if !stream_failed {
            let tail = converter.finish();
            if !tail.is_empty() {
                stream.write_all(&tail).await?;
            }
        }
        log_helper_response(
            "helper.protocol_proxy_stream_ok",
            method,
            path,
            "200 OK",
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }
    let upstream_body = upstream.response.bytes().await?;
    if upstream.wire_api == crate::protocol_proxy::UpstreamWireApi::Responses {
        write_http_response(
            stream,
            "200 OK",
            if upstream.content_type.is_empty() {
                "application/json; charset=utf-8"
            } else {
                &upstream.content_type
            },
            &upstream_body,
        )
        .await?;
        log_helper_response(
            "helper.protocol_proxy_ok",
            method,
            path,
            "200 OK",
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }
    let upstream_json: serde_json::Value = serde_json::from_slice(&upstream_body)?;
    let fallback_request = serde_json::json!({});
    let original_request = request_json.as_ref().unwrap_or(&fallback_request);
    let response_json = match upstream.wire_api {
        crate::protocol_proxy::UpstreamWireApi::ChatCompletions => {
            crate::protocol_proxy::chat_completion_to_response_with_request(
                upstream_json,
                original_request,
            )?
        }
        crate::protocol_proxy::UpstreamWireApi::Completions => {
            crate::protocol_proxy::completion_to_response_with_request(
                upstream_json,
                original_request,
            )?
        }
        crate::protocol_proxy::UpstreamWireApi::AnthropicMessages => {
            crate::protocol_proxy::anthropic_message_to_response_with_request(
                upstream_json,
                original_request,
            )?
        }
        crate::protocol_proxy::UpstreamWireApi::GeminiGenerateContent => {
            crate::protocol_proxy::gemini_generate_content_to_response_with_request(
                upstream_json,
                original_request,
            )?
        }
        crate::protocol_proxy::UpstreamWireApi::Responses
        | crate::protocol_proxy::UpstreamWireApi::AudioTranscriptions
        | crate::protocol_proxy::UpstreamWireApi::Transparent => upstream_json,
    };
    let body = serde_json::to_vec(&response_json)?;
    write_http_response(stream, "200 OK", "application/json; charset=utf-8", &body).await?;
    log_helper_response(
        "helper.protocol_proxy_ok",
        method,
        path,
        "200 OK",
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}

const RESPONSES_STREAM_PREFIX_LIMIT: usize = 64 * 1024;

async fn read_responses_stream_prefix(response: &mut reqwest::Response) -> anyhow::Result<Vec<u8>> {
    let mut prefix = Vec::new();
    while prefix.len() < RESPONSES_STREAM_PREFIX_LIMIT {
        let Some(chunk) = response
            .chunk()
            .await
            .context("读取 Responses 上游流首段失败")?
        else {
            break;
        };
        prefix.extend_from_slice(&chunk);
        if responses_stream_prefix_is_decidable(&prefix) {
            break;
        }
    }
    Ok(prefix)
}

fn responses_stream_prefix_is_decidable(prefix: &[u8]) -> bool {
    if prefix.len() >= RESPONSES_STREAM_PREFIX_LIMIT {
        return true;
    }
    let text = String::from_utf8_lossy(prefix).replace("\r\n", "\n");
    let Some(complete_end) = text.rfind("\n\n") else {
        return false;
    };
    for block in text[..complete_end].split("\n\n") {
        if block.contains("invalid_id_prefix") {
            return true;
        }
        let event = block
            .lines()
            .find_map(|line| line.strip_prefix("event:"))
            .map(str::trim)
            .unwrap_or("");
        // Providers may prepend vendor metadata such as codex.rate_limits and
        // codex.response.metadata. Keep buffering those, but stop as soon as
        // the actual Responses lifecycle starts or a complete failure arrives.
        if event.starts_with("response.") {
            return true;
        }
    }
    false
}
async fn handle_chat_completions_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    request_body: &str,
    request_user_agent: Option<&str>,
    method: &str,
    path: &str,
    remote_addr_text: Option<String>,
) -> anyhow::Result<()> {
    let request_json = serde_json::from_str::<serde_json::Value>(request_body).ok();
    let upstream = match crate::protocol_proxy::open_chat_completions_proxy_request(
        request_body,
        request_user_agent,
    )
    .await
    {
        Ok(upstream) => upstream,
        Err(error) => {
            log_proxy_open_failure(
                "helper.chat_completions_proxy_open_failed",
                method,
                path,
                remote_addr_text.as_deref(),
                request_json
                    .as_ref()
                    .and_then(|request| request.get("model"))
                    .and_then(serde_json::Value::as_str),
                &error,
            );
            let body = serde_json::to_vec(
                &serde_json::json!({                 "status": "failed",                 "message": error.to_string()             }),
            )?;
            write_http_response(
                stream,
                "502 Bad Gateway",
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            log_helper_response(
                "helper.chat_completions_proxy_failed",
                method,
                path,
                "502 Bad Gateway",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    };
    let status = upstream.status();
    let is_success = upstream.is_success();
    let content_type = if upstream.content_type.is_empty() {
        "application/json; charset=utf-8".to_string()
    } else {
        upstream.content_type.clone()
    };
    if upstream.is_stream && is_success {
        write_http_stream_headers(stream, &status, &content_type).await?;
        let mut bytes_stream = upstream.response.bytes_stream();
        while let Some(chunk) = bytes_stream.next().await {
            stream.write_all(&chunk?).await?;
        }
        log_helper_response(
            "helper.chat_completions_proxy_stream_ok",
            method,
            path,
            &status,
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }
    let body = upstream.response.bytes().await?.to_vec();
    write_http_response(stream, &status, &content_type, &body).await?;
    log_helper_response(
        if is_success {
            "helper.chat_completions_proxy_ok"
        } else {
            "helper.chat_completions_proxy_upstream_error"
        },
        method,
        path,
        &status,
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}

async fn handle_transparent_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    method: &str,
    path: &str,
    request_headers: &[(String, String)],
    request_body: reqwest::Body,
    request_body_len: Option<u64>,
    request_user_agent: Option<&str>,
    remote_addr_text: Option<String>,
) -> anyhow::Result<()> {
    let upstream = match crate::protocol_proxy::open_transparent_proxy_request(
        method,
        path,
        request_headers,
        request_body,
        request_body_len,
        request_user_agent,
    )
    .await
    {
        Ok(upstream) => upstream,
        Err(error) => {
            log_proxy_open_failure(
                "helper.transparent_proxy_open_failed",
                method,
                path,
                remote_addr_text.as_deref(),
                None,
                &error,
            );
            let body = serde_json::to_vec(&serde_json::json!({
                "error": {
                    "type": "alunixa_x_proxy_error",
                    "message": error.to_string()
                }
            }))?;
            write_http_response(
                stream,
                "502 Bad Gateway",
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            log_helper_response(
                "helper.transparent_proxy_failed",
                method,
                path,
                "502 Bad Gateway",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    };
    let status = upstream.status();
    let is_success = upstream.is_success();
    let response_headers = upstream.response.headers().clone();
    write_http_proxy_headers(stream, &status, &response_headers).await?;
    if method != "HEAD" {
        let mut bytes_stream = upstream.response.bytes_stream();
        while let Some(chunk) = bytes_stream.next().await {
            stream.write_all(&chunk?).await?;
        }
    }
    log_helper_response(
        if is_success {
            "helper.transparent_proxy_ok"
        } else {
            "helper.transparent_proxy_upstream_error"
        },
        method,
        path,
        &status,
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}

async fn write_http_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> anyhow::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(body).await?;
    Ok(())
}

async fn write_http_cors_preflight_response(
    stream: &mut tokio::net::TcpStream,
) -> anyhow::Result<()> {
    stream
        .write_all(
            b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await?;
    Ok(())
}

async fn write_http_proxy_headers(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    upstream_headers: &reqwest::header::HeaderMap,
) -> anyhow::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Expose-Headers: *\r\n"
    );
    for (name, value) in upstream_headers {
        if !transparent_response_header_allowed(name.as_str()) {
            continue;
        }
        let Ok(value) = value.to_str() else {
            continue;
        };
        response.push_str(name.as_str());
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("Connection: close\r\n\r\n");
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

fn transparent_response_header_allowed(name: &str) -> bool {
    !matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "access-control-allow-credentials"
            | "access-control-allow-headers"
            | "access-control-allow-methods"
            | "access-control-allow-origin"
            | "access-control-expose-headers"
            | "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "set-cookie"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

async fn write_http_stream_headers(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    content_type: &str,
) -> anyhow::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

fn log_helper_response(
    event: &str,
    method: &str,
    path: &str,
    status: &str,
    remote_addr_text: Option<String>,
) {
    let _ = crate::diagnostic_log::append_diagnostic_log(
        event,
        serde_json::json!({
            "method": method,
            "path": path,
            "status": status,
            "remote_addr": remote_addr_text
        }),
    );
}

fn log_proxy_open_failure(
    event: &str,
    method: &str,
    path: &str,
    remote_addr: Option<&str>,
    request_model: Option<&str>,
    error: &anyhow::Error,
) {
    let settings = crate::settings::SettingsStore::default()
        .load()
        .unwrap_or_default();
    let relay = settings.active_relay_profile();
    let custom_model = request_model.and_then(|model| {
        relay
            .custom_models
            .iter()
            .find(|candidate| candidate.model.eq_ignore_ascii_case(model))
    });
    let (base_url, protocol) = custom_model
        .map(|model| (model.base_url.as_str(), model.protocol))
        .unwrap_or((relay.base_url.as_str(), relay.protocol));
    let parsed_url = reqwest::Url::parse(base_url).ok();
    let mut error_message = error.to_string();
    let mut secrets = relay
        .custom_models
        .iter()
        .map(|model| model.api_key.as_str())
        .chain(std::iter::once(relay.api_key.as_str()))
        .filter(|secret| !secret.trim().is_empty())
        .collect::<Vec<_>>();
    secrets.sort_unstable_by_key(|secret| std::cmp::Reverse(secret.len()));
    for secret in secrets {
        error_message = error_message.replace(secret, "[REDACTED]");
    }
    if error_message.len() > 2048 {
        error_message.truncate(2048);
        error_message.push_str("...");
    }
    let _ = crate::diagnostic_log::append_diagnostic_log(
        event,
        serde_json::json!({
            "method": method,
            "path": path,
            "remote_addr": remote_addr,
            "relayId": relay.id,
            "relayName": relay.name,
            "requestModel": request_model,
            "protocol": protocol,
            "targetScheme": parsed_url.as_ref().map(reqwest::Url::scheme),
            "targetHost": parsed_url.as_ref().and_then(reqwest::Url::host_str),
            "error": error_message
        }),
    );
}

#[cfg(test)]
mod computer_use_tests {
    use super::{header_value_from_headers, overlay_image_content_type};
    use std::path::Path;

    #[test]
    fn overlay_image_content_type_accepts_common_images_only() {
        assert_eq!(
            overlay_image_content_type(Path::new("overlay.PNG")),
            Some("image/png")
        );
        assert_eq!(
            overlay_image_content_type(Path::new("overlay.jpeg")),
            Some("image/jpeg")
        );
        assert_eq!(
            overlay_image_content_type(Path::new("overlay.webp")),
            Some("image/webp")
        );
        assert_eq!(overlay_image_content_type(Path::new("overlay.txt")), None);
    }

    #[test]
    fn header_value_from_request_reads_user_agent_case_insensitively() {
        let request = "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nUser-Agent: Codex/26.614\r\nContent-Length: 2\r\n\r\n{}";

        assert_eq!(
            header_value_from_headers(request, "user-agent").as_deref(),
            Some("Codex/26.614")
        );
    }
}

const MAX_HTTP_HEADER_BYTES: usize = 64 * 1024;
#[cfg(not(test))]
const HTTP_BODY_MEMORY_THRESHOLD: usize = 64 * 1024 * 1024;
#[cfg(test)]
const HTTP_BODY_MEMORY_THRESHOLD: usize = 64 * 1024;
const MAX_HTTP_BODY_BYTES: u64 = 8 * 1024 * 1024 * 1024;

struct HttpRequest {
    headers: Vec<u8>,
    body: HttpRequestBody,
}

enum HttpRequestBody {
    Memory(Vec<u8>),
    TempFile {
        file: tempfile::NamedTempFile,
        len: u64,
    },
}

impl HttpRequestBody {
    fn len(&self) -> u64 {
        match self {
            Self::Memory(body) => body.len() as u64,
            Self::TempFile { len, .. } => *len,
        }
    }

    fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Self::Memory(body) => Some(body),
            Self::TempFile { .. } => None,
        }
    }

    fn into_reqwest_body(self) -> anyhow::Result<reqwest::Body> {
        match self {
            Self::Memory(body) => Ok(reqwest::Body::from(body)),
            Self::TempFile { mut file, .. } => {
                file.as_file_mut().seek(SeekFrom::Start(0))?;
                let file = file.into_file();
                let file = tokio::fs::File::from_std(file);
                Ok(reqwest::Body::wrap_stream(ReaderStream::new(file)))
            }
        }
    }

    #[cfg(test)]
    fn into_vec(self) -> Result<Vec<u8>, HttpRequestReadError> {
        match self {
            Self::Memory(body) => Ok(body),
            Self::TempFile { mut file, len } => {
                file.as_file_mut().seek(SeekFrom::Start(0))?;
                let mut body = Vec::with_capacity(usize::try_from(len).unwrap_or(0));
                std::io::Read::read_to_end(file.as_file_mut(), &mut body)?;
                Ok(body)
            }
        }
    }
}

struct HttpRequestBodySink {
    body: HttpRequestBody,
}

impl HttpRequestBodySink {
    fn new() -> Self {
        Self {
            body: HttpRequestBody::Memory(Vec::new()),
        }
    }

    fn write(&mut self, bytes: &[u8]) -> Result<(), HttpRequestReadError> {
        if bytes.is_empty() {
            return Ok(());
        }
        let new_len = self
            .body
            .len()
            .checked_add(bytes.len() as u64)
            .ok_or_else(HttpRequestReadError::payload_too_large)?;
        if new_len > MAX_HTTP_BODY_BYTES {
            return Err(HttpRequestReadError::payload_too_large());
        }
        match &mut self.body {
            HttpRequestBody::Memory(body)
                if body.len().saturating_add(bytes.len()) <= HTTP_BODY_MEMORY_THRESHOLD =>
            {
                body.extend_from_slice(bytes);
            }
            HttpRequestBody::Memory(body) => {
                let mut file = tempfile::NamedTempFile::new()
                    .map_err(|error| HttpRequestReadError::internal(error.to_string()))?;
                file.write_all(body)?;
                file.write_all(bytes)?;
                self.body = HttpRequestBody::TempFile { file, len: new_len };
            }
            HttpRequestBody::TempFile { file, len } => {
                file.write_all(bytes)?;
                *len = new_len;
            }
        }
        Ok(())
    }

    fn finish(self) -> HttpRequestBody {
        self.body
    }
}

#[derive(Debug)]
struct HttpRequestReadError {
    status: &'static str,
    message: String,
}

impl HttpRequestReadError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: "400 Bad Request",
            message: message.into(),
        }
    }

    fn payload_too_large() -> Self {
        Self {
            status: "413 Payload Too Large",
            message: format!("HTTP 请求体超过 {MAX_HTTP_BODY_BYTES} 字节限制"),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: "500 Internal Server Error",
            message: message.into(),
        }
    }

    fn status(&self) -> &'static str {
        self.status
    }
}

impl std::fmt::Display for HttpRequestReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for HttpRequestReadError {}

impl From<std::io::Error> for HttpRequestReadError {
    fn from(error: std::io::Error) -> Self {
        Self::bad_request(format!("读取 HTTP 请求失败: {error}"))
    }
}

#[derive(Debug)]
enum HttpBodyFraming {
    Empty,
    ContentLength(u64),
    Chunked,
}

#[cfg(test)]
#[derive(Debug)]
enum ChunkedBody {
    Incomplete,
    Complete(Vec<u8>),
}

#[derive(Debug)]
enum ChunkedBodyScan {
    Incomplete,
    Complete,
}

#[derive(Default)]
struct ChunkedScanState {
    buffer: Vec<u8>,
    state: ChunkedDecodeState,
    trailer_bytes: usize,
    complete: bool,
}

#[derive(Default)]
enum ChunkedDecodeState {
    #[default]
    Size,
    Data(u64),
    DataCrLf,
    Trailers,
}

impl ChunkedScanState {
    fn advance(
        &mut self,
        encoded: &[u8],
        sink: &mut HttpRequestBodySink,
    ) -> Result<ChunkedBodyScan, HttpRequestReadError> {
        if self.complete {
            return Ok(ChunkedBodyScan::Complete);
        }
        self.buffer.extend_from_slice(encoded);
        loop {
            match self.state {
                ChunkedDecodeState::Size => {
                    let Some(line_end) =
                        self.buffer.windows(2).position(|window| window == b"\r\n")
                    else {
                        if self.buffer.len() > MAX_HTTP_HEADER_BYTES {
                            return Err(HttpRequestReadError::bad_request("chunk size 行过大"));
                        }
                        return Ok(ChunkedBodyScan::Incomplete);
                    };
                    if line_end > MAX_HTTP_HEADER_BYTES {
                        return Err(HttpRequestReadError::bad_request("chunk size 行过大"));
                    }
                    let size_text =
                        std::str::from_utf8(&self.buffer[..line_end]).map_err(|_| {
                            HttpRequestReadError::bad_request("chunk size 不是有效 ASCII")
                        })?;
                    let size_token = size_text.split(';').next().unwrap_or_default().trim();
                    let chunk_size = u64::from_str_radix(size_token, 16)
                        .map_err(|_| HttpRequestReadError::bad_request("chunk size 无效"))?;
                    if sink
                        .body
                        .len()
                        .checked_add(chunk_size)
                        .is_none_or(|length| length > MAX_HTTP_BODY_BYTES)
                    {
                        return Err(HttpRequestReadError::payload_too_large());
                    }
                    self.buffer.drain(..line_end + 2);
                    self.state = if chunk_size == 0 {
                        ChunkedDecodeState::Trailers
                    } else {
                        ChunkedDecodeState::Data(chunk_size)
                    };
                }
                ChunkedDecodeState::Data(remaining) => {
                    if self.buffer.is_empty() {
                        return Ok(ChunkedBodyScan::Incomplete);
                    }
                    let take = usize::try_from(remaining.min(self.buffer.len() as u64))
                        .unwrap_or(self.buffer.len());
                    sink.write(&self.buffer[..take])?;
                    self.buffer.drain(..take);
                    let remaining = remaining - take as u64;
                    self.state = if remaining == 0 {
                        ChunkedDecodeState::DataCrLf
                    } else {
                        ChunkedDecodeState::Data(remaining)
                    };
                }
                ChunkedDecodeState::DataCrLf => {
                    if self.buffer.len() < 2 {
                        return Ok(ChunkedBodyScan::Incomplete);
                    }
                    if &self.buffer[..2] != b"\r\n" {
                        return Err(HttpRequestReadError::bad_request("chunk 数据后缺少 CRLF"));
                    }
                    self.buffer.drain(..2);
                    self.state = ChunkedDecodeState::Size;
                }
                ChunkedDecodeState::Trailers => {
                    let Some(line_end) =
                        self.buffer.windows(2).position(|window| window == b"\r\n")
                    else {
                        if self.trailer_bytes.saturating_add(self.buffer.len())
                            > MAX_HTTP_HEADER_BYTES
                        {
                            return Err(HttpRequestReadError::bad_request("chunk trailer 过大"));
                        }
                        return Ok(ChunkedBodyScan::Incomplete);
                    };
                    self.trailer_bytes = self
                        .trailer_bytes
                        .checked_add(line_end + 2)
                        .ok_or_else(|| HttpRequestReadError::bad_request("chunk trailer 过大"))?;
                    if self.trailer_bytes > MAX_HTTP_HEADER_BYTES {
                        return Err(HttpRequestReadError::bad_request("chunk trailer 过大"));
                    }
                    self.buffer.drain(..line_end + 2);
                    if line_end == 0 {
                        self.complete = true;
                        return Ok(ChunkedBodyScan::Complete);
                    }
                }
            }
        }
    }
}

async fn read_http_request(
    stream: &mut tokio::net::TcpStream,
) -> Result<HttpRequest, HttpRequestReadError> {
    let mut buffer = Vec::new();
    let mut chunk = vec![0_u8; 16 * 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(HttpRequestReadError::bad_request("HTTP 请求头不完整"));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(end) = find_header_end(&buffer) {
            if end > MAX_HTTP_HEADER_BYTES {
                return Err(HttpRequestReadError::bad_request("HTTP 请求头过大"));
            }
            break end;
        }
        if buffer.len() > MAX_HTTP_HEADER_BYTES {
            return Err(HttpRequestReadError::bad_request("HTTP 请求头过大"));
        }
    };
    if buffer.is_empty() || header_end + 4 > buffer.len() {
        return Err(HttpRequestReadError::bad_request("HTTP 请求头不完整"));
    }
    let headers = buffer[..header_end].to_vec();
    let framing = http_body_framing(&headers)?;
    let initial_body = buffer[header_end + 4..].to_vec();
    let mut sink = HttpRequestBodySink::new();
    let body = match framing {
        HttpBodyFraming::Empty => sink.finish(),
        HttpBodyFraming::ContentLength(content_length) => {
            if content_length > MAX_HTTP_BODY_BYTES {
                return Err(HttpRequestReadError::payload_too_large());
            }
            let initial_take = usize::try_from(content_length.min(initial_body.len() as u64))
                .unwrap_or(initial_body.len());
            sink.write(&initial_body[..initial_take])?;
            while sink.body.len() < content_length {
                let read = stream.read(&mut chunk).await?;
                if read == 0 {
                    return Err(HttpRequestReadError::bad_request("HTTP 请求体不完整"));
                }
                let remaining = content_length - sink.body.len();
                let take = usize::try_from(remaining.min(read as u64)).unwrap_or(read);
                sink.write(&chunk[..take])?;
            }
            sink.finish()
        }
        HttpBodyFraming::Chunked => {
            let mut decoder = ChunkedScanState::default();
            let mut status = decoder.advance(&initial_body, &mut sink)?;
            while matches!(status, ChunkedBodyScan::Incomplete) {
                let read = stream.read(&mut chunk).await?;
                if read == 0 {
                    return Err(HttpRequestReadError::bad_request(
                        "chunked HTTP 请求体不完整",
                    ));
                }
                status = decoder.advance(&chunk[..read], &mut sink)?;
            }
            sink.finish()
        }
    };

    Ok(HttpRequest { headers, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn http_body_framing(headers: &[u8]) -> Result<HttpBodyFraming, HttpRequestReadError> {
    let text = String::from_utf8_lossy(headers);
    let mut content_length = None;
    let mut transfer_encoding: Option<String> = None;
    for line in text.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            let parsed = value
                .trim()
                .parse::<u64>()
                .map_err(|_| HttpRequestReadError::bad_request("Content-Length 无效"))?;
            if content_length
                .replace(parsed)
                .is_some_and(|existing| existing != parsed)
            {
                return Err(HttpRequestReadError::bad_request(
                    "存在冲突的 Content-Length 请求头",
                ));
            }
        } else if name.trim().eq_ignore_ascii_case("transfer-encoding") {
            let value = value.trim().to_ascii_lowercase();
            if let Some(existing) = transfer_encoding.as_mut() {
                existing.push(',');
                existing.push_str(&value);
            } else {
                transfer_encoding = Some(value);
            }
        }
    }

    if transfer_encoding.is_some() && content_length.is_some() {
        return Err(HttpRequestReadError::bad_request(
            "Transfer-Encoding 与 Content-Length 不能同时使用",
        ));
    }
    match transfer_encoding.as_deref() {
        Some("chunked") => Ok(HttpBodyFraming::Chunked),
        Some(_) => Err(HttpRequestReadError::bad_request(
            "仅支持 Transfer-Encoding: chunked",
        )),
        None => Ok(content_length
            .map(HttpBodyFraming::ContentLength)
            .unwrap_or(HttpBodyFraming::Empty)),
    }
}

#[cfg(test)]
fn content_length_body(
    encoded: &[u8],
    content_length: u64,
) -> Result<Vec<u8>, HttpRequestReadError> {
    if content_length > MAX_HTTP_BODY_BYTES {
        return Err(HttpRequestReadError::payload_too_large());
    }
    let content_length =
        usize::try_from(content_length).map_err(|_| HttpRequestReadError::payload_too_large())?;
    if encoded.len() < content_length {
        return Err(HttpRequestReadError::bad_request("HTTP 请求体不完整"));
    }
    Ok(encoded[..content_length].to_vec())
}

#[cfg(test)]
fn decode_chunked_body(encoded: &[u8]) -> Result<ChunkedBody, HttpRequestReadError> {
    let mut sink = HttpRequestBodySink::new();
    let mut decoder = ChunkedScanState::default();
    match decoder.advance(encoded, &mut sink)? {
        ChunkedBodyScan::Incomplete => Ok(ChunkedBody::Incomplete),
        ChunkedBodyScan::Complete => Ok(ChunkedBody::Complete(sink.finish().into_vec()?)),
    }
}

#[cfg(test)]
fn scan_chunked_body(encoded: &[u8]) -> Result<ChunkedBodyScan, HttpRequestReadError> {
    ChunkedScanState::default().advance(encoded, &mut HttpRequestBodySink::new())
}

fn header_value_from_headers(headers: &str, header_name: &str) -> Option<String> {
    headers
        .lines()
        .skip(1)
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case(header_name)
                .then(|| value.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}

fn header_pairs_from_headers(headers: &str) -> Vec<(String, String)> {
    headers
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            let name = name.trim();
            let value = value.trim();
            (!name.is_empty() && !value.is_empty()).then(|| (name.to_string(), value.to_string()))
        })
        .collect()
}

fn sanitize_diagnostic_event(event: &str) -> String {
    let sanitized = event
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "event".to_string()
    } else {
        sanitized
    }
}

pub fn build_codex_arguments(debug_port: u16, extra_args: &[String]) -> Vec<String> {
    let mut args = vec![
        format!("--remote-debugging-port={debug_port}"),
        format!("--remote-allow-origins=http://127.0.0.1:{debug_port}"),
    ];
    args.extend(normalize_codex_extra_args(extra_args));
    args
}

pub fn build_codex_arguments_for_settings(
    debug_port: u16,
    settings: &BackendSettings,
) -> Vec<String> {
    build_codex_arguments(
        debug_port,
        &codex_extra_args_for_launch(settings, &settings.codex_extra_args),
    )
}

fn codex_extra_args_for_launch(settings: &BackendSettings, extra_args: &[String]) -> Vec<String> {
    let mut args = Vec::new();
    if settings.codex_app_fast_startup && !has_host_resolver_rules(extra_args) {
        args.push(statsig_fast_fail_host_resolver_rule());
    }
    args.extend(normalize_codex_extra_args(extra_args));
    args
}

fn has_host_resolver_rules(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg.trim().starts_with("--host-resolver-rules"))
}

fn statsig_fast_fail_host_resolver_rule() -> String {
    [
        "--host-resolver-rules=MAP ab.chatgpt.com 127.0.0.1",
        "MAP featureassets.org 127.0.0.1",
        "MAP prodregistryv2.org 127.0.0.1",
        "MAP api.statsigcdn.com 127.0.0.1",
        "MAP statsigapi.net 127.0.0.1",
        "MAP cloudflare-dns.com 127.0.0.1",
    ]
    .join(",")
}

pub fn build_codex_arguments_with_native_menu_inspector(
    debug_port: u16,
    inspector_port: u16,
    extra_args: &[String],
) -> Vec<String> {
    let mut args = build_codex_arguments(debug_port, &[]);
    if inspector_port != 0 {
        args.push(format!("--inspect=127.0.0.1:{inspector_port}"));
    }
    args.extend(normalize_codex_extra_args(extra_args));
    args
}

pub fn build_codex_command(app_dir: &Path, debug_port: u16, extra_args: &[String]) -> Vec<String> {
    let mut command = vec![
        crate::app_paths::build_codex_executable(app_dir)
            .to_string_lossy()
            .to_string(),
    ];
    command.extend(build_codex_arguments(debug_port, extra_args));
    command
}

pub fn build_codex_command_with_native_menu_inspector(
    app_dir: &Path,
    debug_port: u16,
    inspector_port: u16,
    extra_args: &[String],
) -> Vec<String> {
    let mut command = vec![
        crate::app_paths::build_codex_executable(app_dir)
            .to_string_lossy()
            .to_string(),
    ];
    command.extend(build_codex_arguments_with_native_menu_inspector(
        debug_port,
        inspector_port,
        extra_args,
    ));
    command
}

pub fn build_packaged_activation(
    app_dir: &Path,
    debug_port: u16,
    extra_args: &[String],
) -> Option<CodexLaunch> {
    Some(CodexLaunch::PackagedActivation {
        app_user_model_id: crate::app_paths::packaged_app_user_model_id(app_dir)?,
        arguments: command_line_arguments(&build_codex_arguments(debug_port, extra_args)),
        process_id: None,
    })
}

pub fn build_packaged_activation_with_native_menu_inspector(
    app_dir: &Path,
    debug_port: u16,
    inspector_port: u16,
    extra_args: &[String],
) -> Option<CodexLaunch> {
    Some(CodexLaunch::PackagedActivation {
        app_user_model_id: crate::app_paths::packaged_app_user_model_id(app_dir)?,
        arguments: command_line_arguments(&build_codex_arguments_with_native_menu_inspector(
            debug_port,
            inspector_port,
            extra_args,
        )),
        process_id: None,
    })
}

async fn retry_injection(
    debug_port: u16,
    helper_port: u16,
) -> anyhow::Result<crate::bridge::BridgeDisconnect> {
    let mut last_error = None;
    for _ in 0..20 {
        match try_inject(debug_port, helper_port).await {
            Ok(disconnect) => return Ok(disconnect),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Codex injection failed")))
}

async fn verify_startup_model_injection(
    debug_port: u16,
    helper_port: u16,
    settings: &BackendSettings,
) -> anyhow::Result<()> {
    let targets = crate::cdp::list_targets(debug_port)
        .await
        .with_context(|| format!("failed to list Codex CDP targets on port {debug_port}"))?;
    let target = crate::cdp::pick_injectable_codex_page_target(&targets)?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .context("selected CDP target has no websocket URL")?;
    let script = r#"(async () => {
  const result = await window.__alunixaXStartupModelInjection;
  return JSON.stringify(result || { status: "failed", message: "startup injection result missing" });
})()"#;
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        crate::bridge::evaluate_script_with_await_promise(websocket_url, script, true),
    )
    .await
    .context("Alunixa X startup model injection verification timed out")??;
    let value = response
        .pointer("/result/result/value")
        .and_then(Value::as_str)
        .context("Alunixa X startup model injection returned no result")?;
    let result: Value = serde_json::from_str(value)
        .context("failed to parse Alunixa X startup model injection result")?;
    if result.get("status").and_then(Value::as_str) != Some("ok") {
        anyhow::bail!(
            "Alunixa X startup model injection failed: {}",
            result
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        );
    }
    if result.get("debugPort").and_then(Value::as_u64) != Some(u64::from(debug_port))
        || result.get("helperPort").and_then(Value::as_u64) != Some(u64::from(helper_port))
    {
        anyhow::bail!("Alunixa X startup injection returned inconsistent runtime ports");
    }
    if settings.relay_profiles_enabled {
        let profile = settings.active_relay_profile();
        let expected_models = profile.ordered_model_names();
        let actual_models = result
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        let missing = expected_models
            .iter()
            .filter(|expected| {
                !actual_models
                    .iter()
                    .any(|actual| actual.eq_ignore_ascii_case(expected))
            })
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            anyhow::bail!(
                "Alunixa X startup model injection is missing configured models: {}",
                missing.join(", ")
            );
        }
        let preferred_model = profile.preferred_model_name();
        if !preferred_model.is_empty()
            && !result
                .get("selectedModel")
                .and_then(Value::as_str)
                .is_some_and(|selected| selected.eq_ignore_ascii_case(&preferred_model))
        {
            anyhow::bail!(
                "Alunixa X startup model selection is inconsistent; expected {preferred_model}"
            );
        }
        if settings.codex_app_model_whitelist_unlock
            && !expected_models.is_empty()
            && (!result
                .get("responsePatchInstalled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || !result
                    .get("messagePatchInstalled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false))
        {
            anyhow::bail!("Alunixa X startup model unlock adapters were not installed");
        }
    }
    Ok(())
}

fn runtime_evaluate_result_is_true(result: &Value) -> bool {
    result
        .get("result")
        .and_then(|result| result.get("result"))
        .and_then(|result| result.get("value"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

async fn try_inject(
    debug_port: u16,
    helper_port: u16,
) -> anyhow::Result<crate::bridge::BridgeDisconnect> {
    let targets = crate::cdp::list_targets(debug_port).await?;
    let target = crate::cdp::pick_injectable_codex_page_target(&targets)?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("selected CDP target has no websocket URL"))?;
    let settings = SettingsStore::default()
        .load()
        .context("failed to load settings for Alunixa X startup injection")?;
    let script = crate::assets::injection_script_with_runtime(helper_port, debug_port, &settings);
    let ctx = crate::routes::BridgeContext::core(Arc::new(crate::routes::CoreRuntimeService::new(
        debug_port,
        StatusStore::default(),
    )));
    crate::bridge::install_bridge_with_disconnect(
        websocket_url,
        crate::bridge::BRIDGE_BINDING_NAME,
        Arc::new(move |path, payload| {
            let ctx = ctx.clone();
            Box::pin(
                async move { Ok(crate::routes::handle_bridge_request(ctx, &path, payload).await) },
            )
        }),
        &[script],
    )
    .await
}

async fn confirmed_pet_overlay_targets(
    debug_port: u16,
) -> anyhow::Result<Vec<crate::cdp::CdpTarget>> {
    let targets = crate::cdp::list_targets(debug_port).await?;
    let mut confirmed = Vec::new();
    for target in targets
        .into_iter()
        .filter(crate::cdp::is_avatar_overlay_page_target)
    {
        let Some(websocket_url) = target.web_socket_debugger_url.as_deref() else {
            continue;
        };
        if pet_overlay_supports_v2_cursor(websocket_url).await {
            confirmed.push(target);
        }
    }
    Ok(confirmed)
}

async fn pet_overlay_supports_v2_cursor(websocket_url: &str) -> bool {
    crate::bridge::evaluate_script_with_await_promise(
        websocket_url,
        &crate::assets::pet_real_mouse_capability_probe_script(),
        true,
    )
    .await
    .as_ref()
    .is_ok_and(runtime_evaluate_result_is_true)
}

async fn sync_pet_real_mouse_overlay(debug_port: u16, _helper_port: u16) -> anyhow::Result<()> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let enabled = settings.enhancements_enabled && settings.codex_app_pet_real_mouse_look;
    if !enabled {
        return Ok(());
    }
    let targets = crate::cdp::list_targets(debug_port).await?;
    for target in targets
        .iter()
        .filter(|target| crate::cdp::is_avatar_overlay_page_target(target))
    {
        let Some(websocket_url) = target.web_socket_debugger_url.as_deref() else {
            continue;
        };
        let supports_v2 = enabled && pet_overlay_supports_v2_cursor(websocket_url).await;
        let script = if supports_v2 {
            crate::assets::pet_real_mouse_script()
        } else {
            crate::assets::pet_real_mouse_stop_script()
        };
        crate::bridge::evaluate_script(websocket_url, script)
            .await
            .with_context(|| {
                format!(
                    "failed to evaluate pet overlay script in target {} ({})",
                    target.id, target.url
                )
            })?;
    }
    Ok(())
}

#[cfg(windows)]
async fn run_pet_real_mouse_cursor_driver(debug_port: u16) {
    loop {
        let settings = SettingsStore::default().load().unwrap_or_default();
        if !settings.enhancements_enabled || !settings.codex_app_pet_real_mouse_look {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }

        let targets = confirmed_pet_overlay_targets(debug_port)
            .await
            .unwrap_or_default();
        if targets.is_empty() {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }
        let mut drivers = tokio::task::JoinSet::new();
        for target in targets.iter().cloned() {
            drivers.spawn(run_pet_real_mouse_target_driver(debug_port, target));
        }
        if let Some(result) = drivers.join_next().await {
            if let Err(error) = result {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "pet.real_mouse_cursor_driver_join_failed",
                    serde_json::json!({
                        "debug_port": debug_port,
                        "message": error.to_string()
                    }),
                );
            }
        }
        for target in &targets {
            if let Some(websocket_url) = target.web_socket_debugger_url.as_deref() {
                let _ = crate::bridge::evaluate_script(
                    websocket_url,
                    crate::assets::pet_real_mouse_stop_script(),
                )
                .await;
            }
        }
        drivers.abort_all();
        while drivers.join_next().await.is_some() {}
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

#[cfg(windows)]
async fn run_pet_real_mouse_target_driver(debug_port: u16, target: crate::cdp::CdpTarget) {
    let Some(websocket_url) = target.web_socket_debugger_url.as_deref() else {
        return;
    };
    if let Err(error) =
        crate::bridge::evaluate_script(websocket_url, crate::assets::pet_real_mouse_script()).await
    {
        record_pet_cursor_driver_failure(debug_port, &target, error);
        return;
    }

    let mut ticks_until_settings_check = 10_u8;
    let result = crate::bridge::run_periodic_evaluations(
        websocket_url,
        std::time::Duration::from_millis(100),
        || {
            if ticks_until_settings_check == 0 {
                let settings = SettingsStore::default().load().unwrap_or_default();
                if !settings.enhancements_enabled || !settings.codex_app_pet_real_mouse_look {
                    return Ok(None);
                }
                ticks_until_settings_check = 10;
            }
            ticks_until_settings_check -= 1;
            let (x, y) = windows_logical_cursor_position()?;
            Ok(Some(crate::assets::pet_real_mouse_update_script(x, y)))
        },
    )
    .await;

    let _ =
        crate::bridge::evaluate_script(websocket_url, crate::assets::pet_real_mouse_stop_script())
            .await;
    match result {
        Ok(()) => {
            PET_CURSOR_DRIVER_FAILED.store(false, Ordering::Relaxed);
        }
        Err(error) => record_pet_cursor_driver_failure(debug_port, &target, error),
    }
}

#[cfg(windows)]
fn record_pet_cursor_driver_failure(
    debug_port: u16,
    target: &crate::cdp::CdpTarget,
    error: anyhow::Error,
) {
    if !PET_CURSOR_DRIVER_FAILED.swap(true, Ordering::Relaxed) {
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "pet.real_mouse_cursor_driver_disconnected",
            serde_json::json!({
                "debug_port": debug_port,
                "target_id": target.id,
                "target_url": target.url,
                "message": format!("{error:#}")
            }),
        );
    }
}

fn record_pet_overlay_sync_result(debug_port: u16, helper_port: u16, result: anyhow::Result<()>) {
    match result {
        Ok(()) => {
            if PET_OVERLAY_SYNC_FAILED.swap(false, Ordering::Relaxed) {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "pet.real_mouse_overlay_sync_recovered",
                    serde_json::json!({
                        "debug_port": debug_port,
                        "helper_port": helper_port
                    }),
                );
            }
        }
        Err(error) => {
            if !PET_OVERLAY_SYNC_FAILED.swap(true, Ordering::Relaxed) {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "pet.real_mouse_overlay_sync_failed",
                    serde_json::json!({
                        "debug_port": debug_port,
                        "helper_port": helper_port,
                        "message": format!("{error:#}")
                    }),
                );
            }
        }
    }
}

pub fn build_macos_open_command(
    app_dir: &Path,
    debug_port: u16,
    extra_args: &[String],
) -> Vec<String> {
    let mut command = vec![
        "open".to_string(),
        "-W".to_string(),
        "-a".to_string(),
        app_dir.to_string_lossy().to_string(),
        "--args".to_string(),
    ];
    command.extend(build_codex_arguments(debug_port, extra_args));
    command
}

pub fn build_macos_open_command_with_native_menu_inspector(
    app_dir: &Path,
    debug_port: u16,
    inspector_port: u16,
    extra_args: &[String],
) -> Vec<String> {
    let mut command = vec![
        "open".to_string(),
        "-W".to_string(),
        "-a".to_string(),
        app_dir.to_string_lossy().to_string(),
        "--args".to_string(),
    ];
    command.extend(build_codex_arguments_with_native_menu_inspector(
        debug_port,
        inspector_port,
        extra_args,
    ));
    command
}

pub fn build_macos_cleanup_command(
    app_dir: &Path,
    policy: MacosCleanupPolicy,
) -> Option<Vec<String>> {
    if policy == MacosCleanupPolicy::SkipQuitBecauseAlreadyRunning {
        return None;
    }
    let app_name = app_dir
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Codex");
    Some(vec![
        "osascript".to_string(),
        "-e".to_string(),
        format!(
            r#"tell application "{}" to quit"#,
            app_name.replace('"', "\\\"")
        ),
    ])
}

async fn run_macos_cleanup_command(
    app_dir: &Path,
    policy: MacosCleanupPolicy,
) -> anyhow::Result<()> {
    let Some(command) = build_macos_cleanup_command(app_dir, policy) else {
        return Ok(());
    };
    let Some(executable) = command.first() else {
        return Ok(());
    };
    let _ = Command::new(executable)
        .args(&command[1..])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .with_context(|| format!("failed to request macOS app quit for {}", app_dir.display()))?;
    Ok(())
}

fn macos_app_dir_from_open_command(command: &[String]) -> Option<PathBuf> {
    let app_index = command.iter().position(|part| part == "-a")?;
    command.get(app_index + 1).map(PathBuf::from)
}

async fn is_macos_app_running(app_dir: &Path) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let app_name = app_dir
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Codex");
    let script = format!(
        r#"application "{}" is running"#,
        app_name.replace('"', "\\\"")
    );
    let Ok(output) = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return false;
    };
    output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true")
}

#[cfg_attr(not(windows), allow(dead_code))]
fn post_launch_guard_artifacts_ready(
    artifacts: &crate::computer_use_guard::GuardArtifacts,
) -> bool {
    artifacts.notify_exe.is_some()
        && artifacts.marketplace_path.is_some()
        && (!artifacts.runtime_exports_needed || artifacts.sky_package_json.is_some())
}

#[cfg_attr(not(windows), allow(dead_code))]
fn should_stop_post_launch_computer_use_guard(
    stable_unchanged_attempts: usize,
    artifacts: &crate::computer_use_guard::GuardArtifacts,
) -> bool {
    stable_unchanged_attempts >= POST_LAUNCH_COMPUTER_USE_GUARD_STABLE_ATTEMPTS
        && post_launch_guard_artifacts_ready(artifacts)
}

#[cfg(windows)]
async fn run_post_launch_computer_use_guard(
    home: PathBuf,
    mut artifacts: Option<crate::computer_use_guard::GuardArtifacts>,
    shutdown_rx: &mut tokio::sync::oneshot::Receiver<()>,
) {
    let mut previous_delay = 0_u64;
    let mut stable_unchanged_attempts = 0_usize;
    for (index, delay) in POST_LAUNCH_COMPUTER_USE_GUARD_SECONDS
        .iter()
        .copied()
        .enumerate()
    {
        let wait_seconds = delay.saturating_sub(previous_delay);
        previous_delay = delay;
        if wait_seconds > 0 {
            tokio::select! {
                _ = &mut *shutdown_rx => return,
                _ = tokio::time::sleep(std::time::Duration::from_secs(wait_seconds)) => {}
            }
        }
        let attempt = index + 1;
        let resolved_artifacts = match artifacts.take() {
            Some(artifacts) => artifacts,
            None => match crate::computer_use_guard::resolve_computer_use_guard_artifacts(&home) {
                Ok(resolved) => resolved,
                Err(error) => {
                    stable_unchanged_attempts = 0;
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "computer_use_guard.post_launch_failed",
                        serde_json::json!({
                            "attempt": attempt,
                            "delay_seconds": delay,
                            "phase": "resolve_artifacts",
                            "message": error.to_string()
                        }),
                    );
                    continue;
                }
            },
        };
        let artifacts_ready = post_launch_guard_artifacts_ready(&resolved_artifacts);
        artifacts = artifacts_ready.then_some(resolved_artifacts.clone());
        match crate::computer_use_guard::ensure_computer_use_config_with_artifacts(
            &home,
            &resolved_artifacts,
        ) {
            Ok(result) => {
                if !result.changed && artifacts_ready {
                    stable_unchanged_attempts += 1;
                } else {
                    stable_unchanged_attempts = 0;
                }
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "computer_use_guard.post_launch_ok",
                    serde_json::json!({
                        "attempt": attempt,
                        "delay_seconds": delay,
                        "changed": result.changed,
                        "stable_unchanged_attempts": stable_unchanged_attempts,
                        "notify_exe": result
                            .notify_exe
                            .map(|path| path.to_string_lossy().to_string())
                    }),
                );
                if should_stop_post_launch_computer_use_guard(
                    stable_unchanged_attempts,
                    &resolved_artifacts,
                ) {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "computer_use_guard.post_launch_stable_stop",
                        serde_json::json!({
                            "attempt": attempt,
                            "delay_seconds": delay,
                            "stable_unchanged_attempts": stable_unchanged_attempts
                        }),
                    );
                    return;
                }
            }
            Err(error) => {
                stable_unchanged_attempts = 0;
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "computer_use_guard.post_launch_failed",
                    serde_json::json!({
                        "attempt": attempt,
                        "delay_seconds": delay,
                        "message": error.to_string()
                    }),
                );
            }
        }
    }
}

#[cfg(windows)]
async fn wait_for_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || wait_for_windows_process_id_blocking(process_id))
        .await
        .context("Windows process wait task failed")?
}

#[cfg(windows)]
async fn terminate_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || terminate_windows_process_id_blocking(process_id))
        .await
        .context("Windows process termination task failed")?
}

#[cfg(windows)]
fn wait_for_windows_process_id_blocking(process_id: u32) -> anyhow::Result<()> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_FAILED};
    use windows::Win32::System::Threading::{
        INFINITE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        WaitForSingleObject,
    };

    unsafe {
        let handle = OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            process_id,
        )
        .with_context(|| format!("failed to open Windows process id {process_id}"))?;
        let wait_result = WaitForSingleObject(handle, INFINITE);
        let _ = CloseHandle(handle);
        if wait_result == WAIT_FAILED {
            anyhow::bail!("failed to wait for Windows process id {process_id}");
        }
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_windows_process_id_blocking(process_id: u32) -> anyhow::Result<()> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
    };

    unsafe {
        let handle = OpenProcess(
            PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            process_id,
        )
        .with_context(|| format!("failed to open Windows process id {process_id}"))?;
        let terminate_result = TerminateProcess(handle, 1);
        let _ = CloseHandle(handle);
        terminate_result
            .with_context(|| format!("failed to terminate Windows process id {process_id}"))?;
    }
    Ok(())
}

#[cfg(not(windows))]
async fn wait_for_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    anyhow::bail!("cannot wait for Windows process id {process_id} on this platform")
}

#[cfg(not(windows))]
async fn terminate_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    anyhow::bail!("cannot terminate Windows process id {process_id} on this platform")
}

fn launch_status(
    status: &str,
    message: &str,
    debug_port: u16,
    helper_port: u16,
    app_dir: &Path,
) -> LaunchStatus {
    LaunchStatus {
        status: status.to_string(),
        message: message.to_string(),
        started_at_ms: now_ms(),
        debug_port: Some(debug_port),
        helper_port: Some(helper_port),
        codex_app: Some(app_dir.to_string_lossy().to_string()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn command_line_arguments(args: &[String]) -> String {
    args.iter()
        .map(|arg| quote_windows_argument(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_windows_argument(arg: &str) -> String {
    if !arg.is_empty() && !arg.bytes().any(|byte| matches!(byte, b' ' | b'\t' | b'"')) {
        return arg.to_string();
    }
    let mut output = String::from("\"");
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                output.push_str(&"\\".repeat(backslashes * 2 + 1));
                output.push('"');
                backslashes = 0;
            }
            _ => {
                output.push_str(&"\\".repeat(backslashes));
                output.push(ch);
                backslashes = 0;
            }
        }
    }
    output.push_str(&"\\".repeat(backslashes * 2));
    output.push('"');
    output
}

#[cfg(not(windows))]
pub async fn activate_packaged_app(
    _app_user_model_id: &str,
    _arguments: &str,
) -> anyhow::Result<u32> {
    anyhow::bail!("Packaged app activation is only supported on Windows")
}

#[cfg(windows)]
pub async fn activate_packaged_app(
    app_user_model_id: &str,
    arguments: &str,
) -> anyhow::Result<u32> {
    let app_user_model_id = app_user_model_id.to_string();
    let arguments = arguments.to_string();
    tokio::task::spawn_blocking(move || {
        activate_packaged_app_blocking(&app_user_model_id, &arguments)
    })
    .await
    .context("packaged app activation task failed")?
}

#[cfg(windows)]
fn activate_packaged_app_blocking(app_user_model_id: &str, arguments: &str) -> anyhow::Result<u32> {
    use windows::Win32::System::Com::{
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoUninitialize,
    };
    use windows::Win32::UI::Shell::{ApplicationActivationManager, IApplicationActivationManager};
    use windows::core::HSTRING;

    unsafe {
        let coinit = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninitialize = coinit.is_ok();
        coinit.ok().or_else(|error| {
            const RPC_E_CHANGED_MODE: i32 = -2147417850;
            if error.code().0 == RPC_E_CHANGED_MODE {
                Ok(())
            } else {
                Err(error)
            }
        })?;

        let result: windows::core::Result<u32> = (|| {
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)?;
            let process_id = manager.ActivateApplication(
                &HSTRING::from(app_user_model_id),
                &HSTRING::from(arguments),
                windows::Win32::UI::Shell::ACTIVATEOPTIONS(0),
            )?;
            Ok(process_id)
        })();

        if should_uninitialize {
            CoUninitialize();
        }
        result.map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_negotiation_skips_vendor_prelude_until_real_failure() {
        let rate_limits = b"event: codex.rate_limits\ndata: {}\n\n";
        let metadata = b"event: codex.response.metadata\ndata: {}\n\n";
        let failed = b"event: response.failed\ndata: {\"error\":{\"message\":\"[invalid_id_prefix] Invalid 'input[17].id': 'ctco_real'. Expected an ID that begins with 'fc'.\"}}\n\n";

        let mut prefix = rate_limits.to_vec();
        assert!(!responses_stream_prefix_is_decidable(&prefix));
        prefix.extend_from_slice(metadata);
        assert!(!responses_stream_prefix_is_decidable(&prefix));
        prefix.extend_from_slice(failed);
        assert!(responses_stream_prefix_is_decidable(&prefix));
        assert!(String::from_utf8_lossy(&prefix).contains("invalid_id_prefix"));
    }

    #[test]
    fn responses_negotiation_releases_normal_stream_at_first_response_event() {
        let mut prefix = b"event: codex.rate_limits\ndata: {}\n\n".to_vec();
        prefix.extend_from_slice(
            b"event: response.created\ndata: {\"type\":\"response.created\"}\n\n",
        );

        assert!(responses_stream_prefix_is_decidable(&prefix));
    }

    #[test]
    fn responses_negotiation_waits_for_a_complete_sse_block() {
        assert!(!responses_stream_prefix_is_decidable(
            b"event: response.failed\ndata: {\"error\":\"invalid_id_prefix\"}"
        ));
        assert!(responses_stream_prefix_is_decidable(
            b"event: response.failed\ndata: {\"error\":\"invalid_id_prefix\"}\n\n"
        ));
    }

    #[test]
    fn launcher_stays_alive_while_an_existing_cdp_endpoint_is_available() {
        assert!(launcher_target_alive(false, true));
        assert!(launcher_target_alive(true, false));
        assert!(!launcher_target_alive(false, false));
    }

    #[test]
    fn launcher_only_probes_cdp_for_unrecognized_windows_processes() {
        assert!(should_probe_launcher_cdp(true, false));
        assert!(!should_probe_launcher_cdp(true, true));
        assert!(!should_probe_launcher_cdp(false, false));
    }

    #[test]
    fn imagegen_mcp_companion_is_resolved_next_to_the_launcher() {
        let launcher = if cfg!(windows) {
            PathBuf::from(r"C:\Program Files\Alunixa X\alunixa-x.exe")
        } else {
            PathBuf::from("/Applications/Alunixa X.app/Contents/MacOS/AlunixaX")
        };
        let expected = launcher.parent().unwrap().join(if cfg!(windows) {
            "alunixa-x-imagegen-mcp.exe"
        } else {
            "alunixa-x-imagegen-mcp"
        });
        assert_eq!(imagegen_mcp_executable_path(&launcher), expected);
    }

    #[test]
    fn http_body_framing_rejects_ambiguous_or_unsupported_headers() {
        let conflict = http_body_framing(
            b"POST / HTTP/1.1\r\nContent-Length: 4\r\nTransfer-Encoding: chunked",
        )
        .unwrap_err();
        assert_eq!(conflict.status(), "400 Bad Request");

        let unsupported =
            http_body_framing(b"POST / HTTP/1.1\r\nTransfer-Encoding: gzip").unwrap_err();
        assert_eq!(unsupported.status(), "400 Bad Request");

        let multiple = http_body_framing(
            b"POST / HTTP/1.1\r\nTransfer-Encoding: gzip\r\nTransfer-Encoding: chunked",
        )
        .unwrap_err();
        assert_eq!(multiple.status(), "400 Bad Request");
    }

    #[test]
    fn chunked_decoder_rejects_a_declared_chunk_larger_than_the_body_limit() {
        let oversized = format!("{:X}\r\n", MAX_HTTP_BODY_BYTES + 1).into_bytes();
        let error = decode_chunked_body(&oversized).unwrap_err();
        assert_eq!(error.status(), "413 Payload Too Large");
    }

    #[test]
    fn chunked_decoder_handles_extensions_trailers_and_every_partial_prefix() {
        let encoded = b"3;name=value\r\n\x00\x80\xff\r\n2\r\nAB\r\n0\r\nX-Trace: yes\r\n\r\n";
        for prefix_len in 0..encoded.len() {
            assert!(matches!(
                scan_chunked_body(&encoded[..prefix_len]).unwrap(),
                ChunkedBodyScan::Incomplete
            ));
        }

        assert!(matches!(
            scan_chunked_body(encoded).unwrap(),
            ChunkedBodyScan::Complete
        ));
        let ChunkedBody::Complete(decoded) = decode_chunked_body(encoded).unwrap() else {
            panic!("expected complete chunked body");
        };
        assert_eq!(decoded, [0x00, 0x80, 0xff, b'A', b'B']);
    }

    #[test]
    fn chunked_decoder_rejects_oversized_size_lines_and_trailers() {
        let oversized_size_line = vec![b'f'; MAX_HTTP_HEADER_BYTES + 1];
        let error = scan_chunked_body(&oversized_size_line).unwrap_err();
        assert_eq!(error.status(), "400 Bad Request");

        let mut oversized_trailer = b"0\r\nX-Large: ".to_vec();
        oversized_trailer.resize(MAX_HTTP_HEADER_BYTES + 16, b'a');
        let error = scan_chunked_body(&oversized_trailer).unwrap_err();
        assert_eq!(error.status(), "400 Bad Request");
    }

    #[test]
    fn content_length_body_distinguishes_incomplete_and_oversized_bodies() {
        let incomplete = content_length_body(&[], MAX_HTTP_BODY_BYTES).unwrap_err();
        assert_eq!(incomplete.status(), "400 Bad Request");
        let error = content_length_body(&[], MAX_HTTP_BODY_BYTES + 1).unwrap_err();
        assert_eq!(error.status(), "413 Payload Too Large");
    }

    #[test]
    fn request_body_sink_spills_large_bodies_to_a_temporary_file_without_data_loss() {
        let expected = vec![b'x'; HTTP_BODY_MEMORY_THRESHOLD + 1];
        let mut sink = HttpRequestBodySink::new();
        for chunk in expected.chunks(4093) {
            sink.write(chunk).unwrap();
        }
        let body = sink.finish();
        assert!(matches!(body, HttpRequestBody::TempFile { .. }));
        assert_eq!(body.into_vec().unwrap(), expected);
    }

    #[tokio::test]
    async fn helper_returns_400_for_ambiguous_body_framing() {
        let response = send_raw_helper_request(
            b"POST /v1/audio/transcriptions HTTP/1.1\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
        )
        .await;

        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 400 Bad Request"));
    }

    #[tokio::test]
    async fn helper_returns_413_before_reading_oversized_content_length_body() {
        let request = format!(
            "POST /v1/audio/transcriptions HTTP/1.1\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: {}\r\n\r\n",
            MAX_HTTP_BODY_BYTES + 1
        );
        let response = send_raw_helper_request(request.as_bytes()).await;

        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 413 Payload Too Large"));
    }

    #[tokio::test]
    async fn helper_returns_400_for_oversized_headers() {
        let mut request = b"GET /backend/status HTTP/1.1\r\nX-Large: ".to_vec();
        request.resize(MAX_HTTP_HEADER_BYTES + 1, b'a');
        request.extend_from_slice(b"\r\n\r\n");
        let response = send_raw_helper_request(&request).await;

        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 400 Bad Request"));
    }

    async fn send_raw_helper_request(request: &[u8]) -> Vec<u8> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let helper = tokio::spawn(async move {
            let (stream, remote_addr) = listener.accept().await.unwrap();
            let (_connection_shutdown_tx, connection_shutdown) = tokio::sync::broadcast::channel(1);
            handle_helper_connection(
                stream,
                Some(remote_addr),
                connection_shutdown,
                crate::shared_terminal::SharedTerminalBroker::shared(),
            )
            .await
            .unwrap();
        });
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        client.write_all(request).await.unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        helper.await.unwrap();
        response
    }

    #[tokio::test]
    async fn helper_decodes_fragmented_chunked_binary_multipart_body() {
        let _settings_guard = crate::paths::settings_path_test_guard();
        let temp = tempfile::tempdir().unwrap();
        let settings_path = temp.path().join("settings.json");
        let previous_settings_path =
            crate::paths::set_settings_path_for_tests(Some(settings_path.clone()));
        let upstream_listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let upstream_addr = upstream_listener.local_addr().unwrap();
        let settings = serde_json::json!({
            "relayProfiles": [{
                "id": "audio",
                "name": "Audio",
                "baseUrl": format!("http://{upstream_addr}/v1"),
                "upstreamBaseUrl": format!("http://{upstream_addr}/v1"),
                "apiKey": "sk-test",
                "protocol": "chatCompletions",
                "relayMode": "mixedApi"
            }],
            "activeRelayId": "audio"
        });
        std::fs::write(settings_path, serde_json::to_vec_pretty(&settings).unwrap()).unwrap();

        let boundary = "codex-binary-boundary";
        let mut multipart = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-4o-mini-transcribe\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"binary.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .into_bytes();
        multipart.extend_from_slice(&[0x00, 0x80, 0xff, b'A', b'B']);
        multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let expected_body = multipart.clone();

        let upstream = tokio::spawn(async move {
            let (mut stream, _) = upstream_listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let mut expected_len = None;
            loop {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0, "upstream request ended before body completed");
                request.extend_from_slice(&buffer[..read]);
                if expected_len.is_none() {
                    if let Some(header_end) = find_header_end(&request) {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_length = header_value_from_headers(&headers, "content-length")
                            .unwrap()
                            .parse::<usize>()
                            .unwrap();
                        expected_len = Some(header_end + 4 + content_length);
                    }
                }
                if expected_len.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }
            let header_end = find_header_end(&request).unwrap();
            let body = request[header_end + 4..].to_vec();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"text\":\"ok\"}",
                )
                .await
                .unwrap();
            body
        });

        let helper_listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let helper_addr = helper_listener.local_addr().unwrap();
        let helper = tokio::spawn(async move {
            let (stream, remote_addr) = helper_listener.accept().await.unwrap();
            let (_connection_shutdown_tx, connection_shutdown) = tokio::sync::broadcast::channel(1);
            handle_helper_connection(
                stream,
                Some(remote_addr),
                connection_shutdown,
                crate::shared_terminal::SharedTerminalBroker::shared(),
            )
            .await
            .unwrap();
        });
        let mut client = tokio::net::TcpStream::connect(helper_addr).await.unwrap();
        let headers = format!(
            "POST /v1/audio/transcriptions HTTP/1.1\r\nHost: {helper_addr}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
        );
        for fragment in headers.as_bytes().chunks(7) {
            client.write_all(fragment).await.unwrap();
        }
        for fragment in multipart.chunks(11) {
            let chunk_header = format!("{:X}\r\n", fragment.len());
            client.write_all(chunk_header.as_bytes()).await.unwrap();
            client.write_all(fragment).await.unwrap();
            client.write_all(b"\r\n").await.unwrap();
        }
        client.write_all(b"0\r\n\r\n").await.unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200 OK"));

        helper.await.unwrap();
        assert_eq!(upstream.await.unwrap(), expected_body);
        crate::paths::set_settings_path_for_tests(previous_settings_path);
    }

    #[test]
    fn post_launch_guard_stops_after_stable_ready_artifacts() {
        let artifacts = crate::computer_use_guard::GuardArtifacts {
            notify_exe: Some(PathBuf::from("codex-computer-use.exe")),
            marketplace_path: Some(PathBuf::from("openai-bundled")),
            sky_package_json: None,
            runtime_exports_needed: false,
        };

        assert!(!should_stop_post_launch_computer_use_guard(2, &artifacts));
        assert!(should_stop_post_launch_computer_use_guard(3, &artifacts));
    }

    #[test]
    fn post_launch_guard_keeps_retrying_until_artifacts_are_ready() {
        let missing_notify = crate::computer_use_guard::GuardArtifacts {
            notify_exe: None,
            marketplace_path: Some(PathBuf::from("openai-bundled")),
            sky_package_json: None,
            runtime_exports_needed: false,
        };
        let missing_marketplace = crate::computer_use_guard::GuardArtifacts {
            notify_exe: Some(PathBuf::from("codex-computer-use.exe")),
            marketplace_path: None,
            sky_package_json: None,
            runtime_exports_needed: false,
        };
        let missing_runtime_package = crate::computer_use_guard::GuardArtifacts {
            notify_exe: Some(PathBuf::from("codex-computer-use.exe")),
            marketplace_path: Some(PathBuf::from("openai-bundled")),
            sky_package_json: None,
            runtime_exports_needed: true,
        };

        assert!(!should_stop_post_launch_computer_use_guard(
            3,
            &missing_notify
        ));
        assert!(!should_stop_post_launch_computer_use_guard(
            3,
            &missing_marketplace
        ));
        assert!(!should_stop_post_launch_computer_use_guard(
            3,
            &missing_runtime_package
        ));
    }
}
