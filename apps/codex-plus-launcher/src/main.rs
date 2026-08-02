#![cfg_attr(windows, windows_subsystem = "windows")]

use anyhow::{Context, Result};
use codex_plus_core::launcher::{
    DefaultLaunchHooks, LaunchHooks, LaunchOptions, launch_and_inject_with_hooks,
};
use codex_plus_core::models::{DeleteResult, ExportResult, SessionRef};
use codex_plus_core::routes::{BridgeContext, BridgeDataService, BridgeRuntimeService};
use codex_plus_core::status::LaunchStatus;
use codex_plus_core::user_scripts::UserScriptManager;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
struct LauncherHooks {
    core: Arc<DefaultLaunchHooks>,
    data: Arc<LauncherDataService>,
    runtime: Arc<LauncherRuntimeService>,
    bridge_context: Arc<Mutex<Option<BridgeContext>>>,
}

impl Default for LauncherHooks {
    fn default() -> Self {
        let core = Arc::new(DefaultLaunchHooks::default());
        let shared_terminal = core.shared_terminal_broker();
        Self {
            core,
            data: Arc::new(LauncherDataService::default()),
            runtime: Arc::new(LauncherRuntimeService::new(
                9229,
                default_user_script_manager(),
                shared_terminal,
            )),
            bridge_context: Arc::new(Mutex::new(None)),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--codex-plus-hook") {
        return codex_plus_core::codex_hooks::run_hook_from_stdio().await;
    }
    if args.iter().any(|arg| arg == "--codex-plus-shared-terminal") {
        return run_shared_terminal_proxy(args).await;
    }
    let helper_only = args.iter().any(|arg| arg == "--helper-only");
    let options = parse_launch_options(args.iter());
    if helper_only {
        let hooks = LauncherHooks::default();
        hooks.start_helper(options.helper_port).await?;
        std::future::pending::<()>().await;
        hooks.shutdown_helper(options.helper_port).await;
        return Ok(());
    }
    let Some(_guard) = acquire_single_instance_guard(options.debug_port)? else {
        activate_existing_codex_app(&options).await?;
        return Ok(());
    };
    spawn_rollout_image_cleanup_nonfatal();
    if let Ok(settings) = codex_plus_core::settings::SettingsStore::default().load() {
        ensure_codex_plus_hooks(&settings).await;
    }
    tokio::spawn(async {
        let _ = notify_manager_when_update_available().await;
    });
    let hooks = LauncherHooks::default();
    let handle = launch_and_inject_with_hooks(options, &hooks).await?;
    handle.wait_for_codex_exit().await?;
    Ok(())
}

async fn run_shared_terminal_proxy(args: Vec<String>) -> Result<()> {
    use std::io::Write;

    let request = codex_plus_core::shared_terminal::parse_proxy_request(args.iter())?;
    match codex_plus_core::shared_terminal::run_proxy(request).await {
        Ok(result) => {
            let mut stdout = std::io::stdout().lock();
            stdout.write_all(result.output.as_bytes())?;
            if !result.error.is_empty() {
                let mut stderr = std::io::stderr().lock();
                stderr.write_all(result.error.as_bytes())?;
                if !result.error.ends_with('\n') {
                    stderr.write_all(b"\n")?;
                }
            }
            stdout.flush()?;
            std::process::exit(result.exit_code.clamp(0, 255));
        }
        Err(error) => {
            eprintln!("Codex++ shared terminal failed: {error:#}");
            std::process::exit(1);
        }
    }
}

fn spawn_rollout_image_cleanup_nonfatal() {
    tokio::spawn(async {
        let result = tokio::task::spawn_blocking(|| {
            let home = codex_plus_core::codex_sqlite::default_codex_home_dir();
            codex_plus_data::rollout_image_cleanup::run_rollout_image_cleanup_in_home(&home, false)
        })
        .await;
        log_rollout_image_cleanup_result(result);
    });
}

fn log_rollout_image_cleanup_result(
    result: std::result::Result<
        anyhow::Result<codex_plus_data::RolloutImageCleanupResult>,
        tokio::task::JoinError,
    >,
) {
    match result {
        Ok(Ok(cleanup)) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.rollout_image_cleanup.completed",
                json!({
                    "status": cleanup.status,
                    "scanned_files": cleanup.scanned_files,
                    "changed_files": cleanup.changed_files,
                    "image_copies": cleanup.image_copies,
                    "bytes_reclaimed": cleanup.bytes_reclaimed,
                    "skipped_active_sessions": cleanup.skipped_active_sessions,
                    "rollback_protected_files": cleanup.rollback_protected_files,
                    "invalid_files": cleanup.invalid_files
                }),
            );
        }
        Ok(Err(error)) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.rollout_image_cleanup.failed",
                json!({ "error": error.to_string() }),
            );
        }
        Err(error) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.rollout_image_cleanup.task_failed",
                json!({ "error": error.to_string() }),
            );
        }
    }
}

async fn ensure_codex_plus_hooks(settings: &codex_plus_core::settings::BackendSettings) {
    let launcher_path =
        std::env::current_exe().unwrap_or_else(|_| PathBuf::from("codex-plus-plus"));
    match codex_plus_core::codex_hooks::apply_codex_plus_hooks(settings, &launcher_path) {
        Ok(result) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.codex_hooks.applied",
                json!({
                    "path": result.path,
                    "installed": result.installed,
                    "removed": result.removed
                }),
            );
        }
        Err(error) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.codex_hooks.apply_failed",
                json!({ "error": error.to_string() }),
            );
            return;
        }
    }
    match codex_plus_core::codex_hooks::trust_codex_plus_hooks(Some(
        settings.codex_app_path.as_str(),
    ))
    .await
    {
        Ok(result) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.codex_hooks.trusted",
                json!({ "trusted": result.trusted }),
            );
        }
        Err(error) => {
            let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
                "launcher.codex_hooks.trust_failed",
                json!({ "error": error.to_string() }),
            );
        }
    }
}

fn acquire_single_instance_guard(
    debug_port: u16,
) -> anyhow::Result<Option<codex_plus_core::ports::LoopbackPortGuard>> {
    acquire_single_instance_guard_with_retry(debug_port, true)
}

fn acquire_single_instance_guard_with_retry(
    debug_port: u16,
    allow_stale_recovery: bool,
) -> anyhow::Result<Option<codex_plus_core::ports::LoopbackPortGuard>> {
    match try_acquire_single_instance_guard() {
        Ok(guard) => {
            if let Some(fallback_lock_path) = guard.fallback_path() {
                log_launcher_guard_fallback(fallback_lock_path);
            }
            Ok(Some(guard))
        }
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
            log_launcher_already_running(debug_port);
            Ok(None)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            log_launcher_already_running(debug_port);
            if allow_stale_recovery && should_recover_stale_launcher(debug_port) {
                codex_plus_core::watcher::stop_launcher_processes();
                std::thread::sleep(std::time::Duration::from_millis(250));
                return acquire_single_instance_guard_with_retry(debug_port, false);
            }
            Ok(None)
        }
        Err(error) => Err(error)
            .with_context(|| {
                format!(
                    "failed to acquire launcher guard port {}",
                    codex_plus_core::ports::launcher_guard_port()
                )
            })
            .map(Some),
    }
}

fn try_acquire_single_instance_guard() -> std::io::Result<codex_plus_core::ports::LoopbackPortGuard>
{
    codex_plus_core::ports::acquire_resilient_loopback_port_guard(
        codex_plus_core::ports::launcher_guard_port(),
    )
}

fn log_launcher_guard_fallback(fallback_lock_path: &Path) {
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
        "launcher.guard_fallback",
        json!({
            "requested_guard_port": codex_plus_core::ports::launcher_guard_port(),
            "fallback_lock_path": fallback_lock_path
        }),
    );
}

fn should_recover_stale_launcher(debug_port: u16) -> bool {
    let has_codex_process = !codex_plus_core::watcher::find_codex_processes().is_empty();
    let cdp_listening = codex_plus_core::watcher::cdp_listening(debug_port);
    let recover =
        codex_plus_core::watcher::should_recover_stale_launcher(has_codex_process, cdp_listening);
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
        "launcher.stale_recovery_check",
        json!({
            "debug_port": debug_port,
            "has_codex_process": has_codex_process,
            "cdp_listening": cdp_listening,
            "recover": recover
        }),
    );
    recover
}

async fn activate_existing_codex_app(options: &LaunchOptions) -> anyhow::Result<()> {
    let hooks = LauncherHooks::default();
    let settings = hooks.load_settings().await?;
    ensure_codex_plus_hooks(&settings).await;
    let app_dir = hooks.resolve_app_dir(options.app_dir.as_deref(), &settings)?;
    save_existing_launch_status(
        &options,
        &app_dir,
        "starting",
        "Codex++ is reconnecting to the existing Codex app.",
    );
    let launch_result = hooks
        .launch_codex(
            &app_dir,
            options.debug_port,
            &settings,
            &settings.codex_extra_args,
        )
        .await;
    if settings.enhancements_enabled {
        hooks.start_helper(options.helper_port).await?;
    }
    let process_ids = codex_plus_core::watcher::find_codex_processes();
    let mut activated = false;
    #[cfg(windows)]
    {
        for process_id in &process_ids {
            if codex_plus_core::windows_activate_process_window(*process_id) {
                activated = true;
                break;
            }
        }
    }
    let injection_ready = if settings.enhancements_enabled {
        hooks
            .ensure_injection(options.debug_port, options.helper_port, &app_dir)
            .await
    } else {
        false
    };
    let (status, message) = if injection_ready {
        hooks
            .start_bridge_watchdog(options.debug_port, options.helper_port)
            .await?;
        hooks.write_status("running").await;
        ("running", "Codex++ reconnected to the existing Codex app.")
    } else if settings.enhancements_enabled {
        hooks.write_status("running_degraded").await;
        (
            "running_degraded",
            "Codex is running; Codex++ is still waiting for the injection bridge.",
        )
    } else if launch_result.is_ok() {
        hooks.write_status("running").await;
        ("running", "Codex is running with enhancements disabled.")
    } else {
        hooks.write_status("failed").await;
        (
            "failed",
            "Codex++ could not reactivate the existing Codex app.",
        )
    };
    save_existing_launch_status(&options, &app_dir, status, message);
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
        "launcher.activate_existing_codex",
        json!({
            "app_dir": app_dir.to_string_lossy(),
            "debug_port": options.debug_port,
            "helper_port": options.helper_port,
            "process_ids": process_ids,
            "activated": activated,
            "injection_ready": injection_ready,
            "launch_ok": launch_result.is_ok(),
            "launch_error": launch_result.as_ref().err().map(|error| error.to_string())
        }),
    );
    launch_result.map(|_| ())
}

fn save_existing_launch_status(
    options: &LaunchOptions,
    app_dir: &Path,
    status: &str,
    message: &str,
) {
    let started_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = options.status_store.save_latest(&LaunchStatus {
        status: status.to_string(),
        message: message.to_string(),
        started_at_ms,
        debug_port: Some(options.debug_port),
        helper_port: Some(options.helper_port),
        codex_app: Some(app_dir.to_string_lossy().to_string()),
    });
}

fn log_launcher_already_running(debug_port: u16) {
    let _ = codex_plus_core::diagnostic_log::append_diagnostic_log(
        "launcher.already_running",
        json!({
            "guard_port": codex_plus_core::ports::launcher_guard_port(),
            "debug_port": debug_port
        }),
    );
}

async fn notify_manager_when_update_available() -> anyhow::Result<bool> {
    let update =
        codex_plus_core::update::check_for_update(codex_plus_core::version::VERSION).await?;
    if !update.update_available {
        return Ok(false);
    }
    open_manager_with_update_prompt()?;
    Ok(true)
}

fn open_manager_with_update_prompt() -> anyhow::Result<()> {
    codex_plus_core::install::spawn_companion(
        codex_plus_core::install::MANAGER_BINARY,
        ["--show-update"],
    )
    .map(|_| ())
    .map_err(|error| anyhow::anyhow!("启动管理工具失败：{error}"))
}

fn parse_launch_options<I, S>(args: I) -> LaunchOptions
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut options = LaunchOptions::default();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_ref() {
            "--app-path" => {
                if let Some(value) = iter.next() {
                    let value = value.as_ref().trim();
                    if !value.is_empty() {
                        options.app_dir = Some(PathBuf::from(value));
                    }
                }
            }
            "--debug-port" => {
                if let Some(value) = iter.next() {
                    if let Ok(port) = value.as_ref().parse::<u16>() {
                        options.debug_port = port;
                    }
                }
            }
            "--helper-port" => {
                if let Some(value) = iter.next() {
                    if let Ok(port) = value.as_ref().parse::<u16>() {
                        options.helper_port = port;
                    }
                }
            }
            _ => {}
        }
    }
    options
}

#[async_trait::async_trait(?Send)]
impl LaunchHooks for LauncherHooks {
    fn resolve_app_dir(
        &self,
        app_dir: Option<&std::path::Path>,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> anyhow::Result<std::path::PathBuf> {
        self.core.resolve_app_dir(app_dir, settings)
    }

    fn select_debug_port(&self, requested: u16) -> u16 {
        self.core.select_debug_port(requested)
    }

    fn select_helper_port(&self, requested: u16) -> u16 {
        self.core.select_helper_port(requested)
    }

    async fn load_settings(&self) -> anyhow::Result<codex_plus_core::settings::BackendSettings> {
        self.core.load_settings().await
    }

    async fn run_provider_sync(&self) -> anyhow::Result<()> {
        let _ = tokio::task::spawn_blocking(|| codex_plus_data::run_provider_sync(None))
            .await
            .map_err(|error| anyhow::anyhow!("provider sync task failed: {error}"))?;
        Ok(())
    }

    async fn apply_active_relay_profile(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> anyhow::Result<()> {
        self.core.apply_active_relay_profile(settings).await
    }

    async fn ensure_computer_use_config(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> anyhow::Result<()> {
        self.core.ensure_computer_use_config(settings).await
    }

    async fn ensure_plugin_marketplace_config(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> anyhow::Result<()> {
        self.core.ensure_plugin_marketplace_config(settings).await
    }

    async fn start_helper(&self, helper_port: u16) -> anyhow::Result<()> {
        self.core.start_helper(helper_port).await?;
        self.runtime.set_helper_port(helper_port);
        Ok(())
    }

    async fn launch_codex(
        &self,
        app_dir: &Path,
        debug_port: u16,
        settings: &codex_plus_core::settings::BackendSettings,
        extra_args: &[String],
    ) -> anyhow::Result<codex_plus_core::launcher::CodexLaunch> {
        self.core
            .launch_codex(app_dir, debug_port, settings, extra_args)
            .await
    }

    async fn bridge_context(
        &self,
        debug_port: u16,
        app_dir: &Path,
    ) -> anyhow::Result<Option<BridgeContext>> {
        self.runtime.set_debug_port(debug_port);
        Ok(Some(BridgeContext::core_with_data_and_app_dir(
            self.runtime.clone(),
            self.data.clone(),
            app_dir.to_path_buf(),
        )))
    }

    async fn inject_bridge(
        &self,
        debug_port: u16,
        helper_port: u16,
        ctx: BridgeContext,
    ) -> anyhow::Result<()> {
        *self.bridge_context.lock().unwrap() = Some(ctx.clone());
        let disconnect =
            inject_with_context(debug_port, helper_port, ctx, self.runtime.clone()).await?;
        self.core.set_bridge_disconnect(disconnect).await;
        Ok(())
    }

    async fn inject(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
        self.core.inject(debug_port, helper_port).await
    }

    async fn start_bridge_watchdog(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
        let bridge_context = self
            .bridge_context
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| anyhow::anyhow!("bridge context is unavailable for reconnect"))?;
        let runtime = self.runtime.clone();
        let reconnect: codex_plus_core::launcher::BridgeReconnectHandler = Arc::new(move || {
            let bridge_context = bridge_context.clone();
            let runtime = runtime.clone();
            Box::pin(async move {
                inject_with_context(debug_port, helper_port, bridge_context, runtime).await
            })
        });
        self.core
            .start_bridge_connection_watchdog(debug_port, helper_port, reconnect)
            .await
    }

    async fn start_computer_use_guard_watchdog(
        &self,
        settings: &codex_plus_core::settings::BackendSettings,
    ) -> anyhow::Result<()> {
        self.core.start_computer_use_guard_watchdog(settings).await
    }

    async fn write_status(&self, status: &str) {
        self.core.write_status(status).await;
    }

    async fn wait_for_codex_exit(
        &self,
        launch: &codex_plus_core::launcher::CodexLaunch,
    ) -> anyhow::Result<()> {
        self.core.wait_for_codex_exit(launch).await
    }

    async fn shutdown_helper(&self, helper_port: u16) {
        self.core.shutdown_helper(helper_port).await;
    }

    async fn terminate_codex(&self, launch: &codex_plus_core::launcher::CodexLaunch) {
        self.core.terminate_codex(launch).await;
    }
}

#[derive(Debug, Clone)]
struct LauncherDataService {
    db_path: PathBuf,
    backup_dir: PathBuf,
}

impl Default for LauncherDataService {
    fn default() -> Self {
        Self {
            db_path: default_codex_db_path(),
            backup_dir: codex_plus_core::paths::default_app_state_dir().join("backups"),
        }
    }
}

#[async_trait::async_trait]
impl BridgeDataService for LauncherDataService {
    async fn delete(&self, session: SessionRef) -> anyhow::Result<DeleteResult> {
        let db_paths = self.candidate_db_paths();
        let backup_store = codex_plus_data::BackupStore::new(self.backup_dir.clone());
        tokio::task::spawn_blocking(move || {
            codex_plus_data::delete_local_from_paths(db_paths, backup_store, &session)
        })
        .await
        .map_err(|error| anyhow::anyhow!("delete task failed: {error}"))
    }

    async fn undo(&self, undo_token: String) -> anyhow::Result<DeleteResult> {
        let adapter = self.storage_adapter();
        tokio::task::spawn_blocking(move || adapter.undo(&undo_token))
            .await
            .map_err(|error| anyhow::anyhow!("undo task failed: {error}"))
    }

    async fn export_markdown(&self, session: SessionRef) -> anyhow::Result<ExportResult> {
        let db_paths = self.candidate_db_paths();
        tokio::task::spawn_blocking(move || {
            codex_plus_data::export_markdown_from_paths(db_paths, &session)
        })
        .await
        .map_err(|error| anyhow::anyhow!("export markdown task failed: {error}"))
    }

    async fn thread_usage_history(&self, session: SessionRef) -> anyhow::Result<Value> {
        let adapter = self.storage_adapter();
        tokio::task::spawn_blocking(move || adapter.codex_thread_usage_history(&session))
            .await
            .map_err(|error| anyhow::anyhow!("thread usage history task failed: {error}"))
    }

    async fn find_archived_thread_by_title(
        &self,
        title: String,
    ) -> anyhow::Result<Option<SessionRef>> {
        let adapter = self.storage_adapter();
        tokio::task::spawn_blocking(move || adapter.find_archived_thread_by_title(&title))
            .await
            .map_err(|error| anyhow::anyhow!("archived lookup task failed: {error}"))
    }

    async fn move_thread_workspace(
        &self,
        session: SessionRef,
        target_cwd: String,
    ) -> anyhow::Result<Value> {
        let db_paths = self.candidate_db_paths();
        let backup_store = codex_plus_data::BackupStore::new(self.backup_dir.clone());
        tokio::task::spawn_blocking(move || {
            codex_plus_data::move_codex_thread_workspace_from_paths(
                db_paths,
                backup_store,
                &session,
                &target_cwd,
            )
        })
        .await
        .map_err(|error| anyhow::anyhow!("move thread workspace task failed: {error}"))
    }

    async fn thread_sort_key(&self, session: SessionRef) -> anyhow::Result<Value> {
        let adapter = self.storage_adapter();
        tokio::task::spawn_blocking(move || adapter.codex_thread_sort_key(&session))
            .await
            .map_err(|error| anyhow::anyhow!("thread sort key task failed: {error}"))
    }

    async fn thread_sort_keys(&self, sessions: Vec<SessionRef>) -> anyhow::Result<Value> {
        let adapter = self.storage_adapter();
        tokio::task::spawn_blocking(move || adapter.codex_thread_sort_keys(&sessions))
            .await
            .map_err(|error| anyhow::anyhow!("thread sort keys task failed: {error}"))
    }
}

impl LauncherDataService {
    fn candidate_db_paths(&self) -> Vec<PathBuf> {
        let mut paths = vec![self.db_path.clone()];
        for path in codex_plus_core::codex_sqlite::codex_session_db_paths_from_home(
            &codex_plus_core::codex_sqlite::default_codex_home_dir(),
        ) {
            if !paths.iter().any(|candidate| candidate == &path) {
                paths.push(path);
            }
        }
        paths
    }

    fn storage_adapter(&self) -> codex_plus_data::SQLiteStorageAdapter {
        let allowed_db_paths = self.candidate_db_paths();
        codex_plus_data::SQLiteStorageAdapter::new(
            self.db_path.clone(),
            codex_plus_data::BackupStore::new(self.backup_dir.clone()),
        )
        .with_allowed_db_paths(allowed_db_paths)
    }
}

struct LauncherRuntimeService {
    debug_port: Mutex<u16>,
    helper_port: Mutex<Option<u16>>,
    websocket_url: Mutex<Option<String>>,
    user_scripts: UserScriptManager,
    shared_terminal: Arc<codex_plus_core::shared_terminal::SharedTerminalBroker>,
}

impl LauncherRuntimeService {
    fn new(
        debug_port: u16,
        user_scripts: UserScriptManager,
        shared_terminal: Arc<codex_plus_core::shared_terminal::SharedTerminalBroker>,
    ) -> Self {
        Self {
            debug_port: Mutex::new(debug_port),
            helper_port: Mutex::new(None),
            websocket_url: Mutex::new(None),
            user_scripts,
            shared_terminal,
        }
    }

    fn set_debug_port(&self, debug_port: u16) {
        *self.debug_port.lock().unwrap() = debug_port;
    }

    fn set_websocket_url(&self, websocket_url: &str) {
        *self.websocket_url.lock().unwrap() = Some(websocket_url.to_string());
    }

    fn set_helper_port(&self, helper_port: u16) {
        *self.helper_port.lock().unwrap() = Some(helper_port);
    }
}

#[async_trait::async_trait]
impl BridgeRuntimeService for LauncherRuntimeService {
    async fn user_script_inventory(&self) -> anyhow::Result<Value> {
        self.user_scripts.inventory()
    }

    async fn set_user_scripts_enabled(&self, enabled: bool) -> anyhow::Result<Value> {
        self.user_scripts.set_global_enabled(enabled)?;
        self.user_scripts.inventory()
    }

    async fn set_user_script_enabled(&self, key: String, enabled: bool) -> anyhow::Result<Value> {
        self.user_scripts.set_script_enabled(&key, enabled)?;
        self.user_scripts.inventory()
    }

    async fn delete_user_script(&self, key: String) -> anyhow::Result<Value> {
        self.user_scripts.delete_user_script(&key)?;
        self.user_scripts.inventory()
    }

    async fn reload_user_scripts(&self) -> anyhow::Result<Value> {
        let bundle = self.user_scripts.build_enabled_bundle()?;
        let websocket_url = self.websocket_url.lock().unwrap().clone();
        if let Some(websocket_url) = websocket_url.filter(|_| !bundle.trim().is_empty()) {
            codex_plus_core::bridge::evaluate_script(&websocket_url, &bundle).await?;
        }
        self.user_scripts.inventory()
    }

    async fn open_devtools(&self) -> anyhow::Result<Value> {
        let debug_port = *self.debug_port.lock().unwrap();
        let targets = codex_plus_core::cdp::list_targets(debug_port).await?;
        let target = codex_plus_core::cdp::pick_page_target(&targets)?;
        let url = codex_plus_core::routes::devtools_url(debug_port, &target.id);
        open_url(&url)?;
        Ok(json!({
            "status": "ok",
            "target_id": target.id,
            "url": url
        }))
    }

    async fn open_manager(&self) -> anyhow::Result<Value> {
        let target = codex_plus_core::install::spawn_companion(
            codex_plus_core::install::MANAGER_BINARY,
            std::iter::empty::<&str>(),
        )
        .map_err(|error| anyhow::anyhow!("启动管理工具失败：{error}"))?;
        Ok(json!({
            "status": "ok",
            "path": target
        }))
    }

    async fn backend_status(&self) -> anyhow::Result<Value> {
        let helper_port = *self.helper_port.lock().unwrap();
        let Some(helper_port) = helper_port else {
            return Ok(backend_status_failed("本地 Helper 尚未启动"));
        };
        match probe_owned_helper(helper_port).await {
            Ok(helper_status) => Ok(json!({
                "status": "ok",
                "message": "后端已连接",
                "version": codex_plus_core::version::VERSION,
                "transport": "verified",
                "processId": std::process::id(),
                "bridgeTransport": "cdp-bridge",
                "helperTransport": helper_status.get("transport").and_then(Value::as_str).unwrap_or("http-helper")
            })),
            Err(error) => Ok(backend_status_failed(&error.to_string())),
        }
    }

    async fn codex_model_catalog(&self) -> anyhow::Result<Value> {
        Ok(codex_plus_core::model_catalog::read_codex_model_catalog().await)
    }

    async fn ads(&self) -> anyhow::Result<Value> {
        codex_plus_core::ads::fetch_ad_list().await
    }

    async fn zed_remote_status(&self) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::zed_remote_status())
    }

    async fn resolve_zed_remote_host(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::resolve_ssh_target_response(
            &payload,
        ))
    }

    async fn fallback_zed_remote_request(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::fallback_open_request_response(
            &payload,
        ))
    }

    async fn open_zed_remote(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::open_zed_remote(&payload))
    }

    async fn list_zed_remote_projects(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::list_zed_remote_projects_response(&payload))
    }

    async fn remember_zed_remote_project(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::remember_zed_remote_project_response(&payload))
    }

    async fn forget_zed_remote_project(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::zed_remote::forget_zed_remote_project_response(&payload))
    }

    async fn upstream_worktree_status(&self) -> anyhow::Result<Value> {
        Ok(codex_plus_core::upstream_worktree::status_response())
    }

    async fn upstream_worktree_defaults(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::upstream_worktree::defaults_response(
            &payload,
        ))
    }

    async fn upstream_worktree_prepare(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::upstream_worktree::prepare_response(
            &payload,
        ))
    }

    async fn upstream_worktree_create(&self, payload: Value) -> anyhow::Result<Value> {
        Ok(codex_plus_core::upstream_worktree::create_response(
            &payload,
        ))
    }

    async fn shared_terminal_next(&self) -> anyhow::Result<Value> {
        Ok(match self.shared_terminal.next().await {
            Some(work) => serde_json::to_value(work)?,
            None => json!({ "status": "idle" }),
        })
    }

    async fn shared_terminal_started(&self, payload: Value) -> anyhow::Result<Value> {
        let request_id = required_payload_string(&payload, "requestId")?;
        let terminal_session_id = required_payload_string(&payload, "terminalSessionId")?;
        self.shared_terminal
            .started(request_id, terminal_session_id)
            .await?;
        Ok(json!({ "status": "ok" }))
    }

    async fn shared_terminal_heartbeat(&self, payload: Value) -> anyhow::Result<Value> {
        let request_id = required_payload_string(&payload, "requestId")?;
        self.shared_terminal.heartbeat(request_id).await?;
        Ok(json!({ "status": "ok" }))
    }

    async fn shared_terminal_complete(&self, payload: Value) -> anyhow::Result<Value> {
        let result =
            serde_json::from_value::<codex_plus_core::shared_terminal::SharedTerminalResult>(
                payload,
            )
            .context("共享终端完成载荷无效")?;
        self.shared_terminal.complete(result).await?;
        Ok(json!({ "status": "ok" }))
    }
}

fn required_payload_string<'a>(payload: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("共享终端载荷缺少 {key}"))
}

fn backend_status_failed(message: &str) -> Value {
    json!({
        "status": "failed",
        "message": message,
        "version": codex_plus_core::version::VERSION,
        "transport": "verification",
        "processId": std::process::id()
    })
}

async fn probe_owned_helper(helper_port: u16) -> anyhow::Result<Value> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let address = ("127.0.0.1", helper_port);
    let mut stream = tokio::time::timeout(
        std::time::Duration::from_millis(750),
        tokio::net::TcpStream::connect(address),
    )
    .await
    .context("本地 Helper 检查超时")?
    .context("本地 Helper 未连接")?;
    let request = format!(
        "GET /backend/status HTTP/1.1\r\nHost: 127.0.0.1:{helper_port}\r\nConnection: close\r\n\r\n"
    );
    tokio::time::timeout(
        std::time::Duration::from_millis(750),
        stream.write_all(request.as_bytes()),
    )
    .await
    .context("本地 Helper 写入超时")??;
    let mut response = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_millis(750),
        stream.read_to_end(&mut response),
    )
    .await
    .context("本地 Helper 响应超时")??;
    let body_offset = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|offset| offset + 4)
        .context("本地 Helper 响应无效")?;
    let status = serde_json::from_slice::<Value>(&response[body_offset..])
        .context("本地 Helper 状态无效")?;
    let expected_process_id = u64::from(std::process::id());
    let matches_owner = status.get("status").and_then(Value::as_str) == Some("ok")
        && status.get("version").and_then(Value::as_str) == Some(codex_plus_core::version::VERSION)
        && status.get("transport").and_then(Value::as_str) == Some("http-helper")
        && status.get("processId").and_then(Value::as_u64) == Some(expected_process_id);
    if !matches_owner {
        anyhow::bail!("本地 Helper 与当前启动器不一致，请重启 Codex")
    }
    Ok(status)
}

async fn inject_with_context(
    debug_port: u16,
    helper_port: u16,
    ctx: BridgeContext,
    runtime: Arc<LauncherRuntimeService>,
) -> anyhow::Result<codex_plus_core::bridge::BridgeDisconnect> {
    let mut last_error = None;
    for _ in 0..20 {
        match try_inject_with_context(debug_port, helper_port, ctx.clone(), runtime.clone()).await {
            Ok(disconnect) => return Ok(disconnect),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Codex injection failed")))
}

async fn try_inject_with_context(
    debug_port: u16,
    helper_port: u16,
    ctx: BridgeContext,
    runtime: Arc<LauncherRuntimeService>,
) -> anyhow::Result<codex_plus_core::bridge::BridgeDisconnect> {
    let targets = codex_plus_core::cdp::list_targets(debug_port).await?;
    let target = codex_plus_core::cdp::pick_injectable_codex_page_target(&targets)?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("selected CDP target has no websocket URL"))?;
    runtime.set_websocket_url(websocket_url);
    let settings = codex_plus_core::settings::SettingsStore::default()
        .load()
        .unwrap_or_default();
    let script = codex_plus_core::assets::injection_script_with_settings(helper_port, &settings);
    let user_bundle = runtime
        .user_scripts
        .build_enabled_bundle()
        .unwrap_or_default();
    let new_document_scripts = if user_bundle.is_empty() {
        vec![script]
    } else {
        vec![script, user_bundle]
    };
    codex_plus_core::bridge::install_bridge_with_disconnect(
        websocket_url,
        codex_plus_core::bridge::BRIDGE_BINDING_NAME,
        Arc::new(move |path, payload| {
            let ctx = ctx.clone();
            Box::pin(async move {
                Ok(codex_plus_core::routes::handle_bridge_request(ctx, &path, payload).await)
            })
        }),
        &new_document_scripts,
    )
    .await
}

fn default_codex_db_path() -> PathBuf {
    codex_plus_core::codex_sqlite::codex_session_db_path()
}

fn open_url(url: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        codex_plus_core::windows_open_url(url)
            .map_err(|error| anyhow::anyhow!("failed to open DevTools URL: {error}"))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("failed to open DevTools URL: {error}"))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("failed to open DevTools URL: {error}"))
    }

    #[cfg(not(any(windows, target_os = "macos", unix)))]
    {
        let _ = url;
        anyhow::bail!("opening DevTools URL is not supported on this platform")
    }
}

fn default_user_script_manager() -> UserScriptManager {
    let config_dir = default_user_scripts_config_dir();
    UserScriptManager::new(
        builtin_user_scripts_dir(),
        config_dir.join("user_scripts"),
        config_dir.join("user_scripts.json"),
    )
}

fn default_user_scripts_config_dir() -> PathBuf {
    if cfg!(windows) {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            return PathBuf::from(roaming).join("Codex++");
        }
        if let Some(home) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
            return home.join("AppData").join("Roaming").join("Codex++");
        }
    }
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".config")))
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("Codex++")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_launch_options_accepts_manager_forwarded_ports_and_app_path() {
        let options = parse_launch_options([
            "--app-path",
            "C:/Codex/App",
            "--debug-port",
            "9333",
            "--helper-port",
            "57322",
        ]);

        assert_eq!(options.app_dir, Some(PathBuf::from("C:/Codex/App")));
        assert_eq!(options.debug_port, 9333);
        assert_eq!(options.helper_port, 57322);
    }

    #[test]
    fn parse_launch_options_ignores_invalid_ports() {
        let options = parse_launch_options(["--debug-port", "nope", "--helper-port", "70000"]);

        assert_eq!(options.debug_port, LaunchOptions::default().debug_port);
        assert_eq!(options.helper_port, LaunchOptions::default().helper_port);
    }

    #[tokio::test]
    async fn bridge_status_checks_the_helper_owned_by_the_same_launcher() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let helper_port = listener.local_addr().unwrap().port();
        drop(listener);
        let hooks = LauncherHooks::default();

        hooks.start_helper(helper_port).await.unwrap();
        let connected = hooks.runtime.backend_status().await.unwrap();
        assert_eq!(connected["status"], "ok");
        assert_eq!(connected["transport"], "verified");
        assert_eq!(connected["processId"], std::process::id());

        hooks.shutdown_helper(helper_port).await;
        let disconnected = hooks.runtime.backend_status().await.unwrap();
        assert_eq!(disconnected["status"], "failed");
    }

    #[test]
    fn launcher_uses_single_instance_guard_before_launching() {
        let source = include_str!("main.rs");

        assert!(source.contains("acquire_single_instance_guard(options.debug_port)?"));
        assert!(source.contains("launcher_guard_port"));
        assert!(source.contains("launcher.already_running"));
    }

    #[test]
    fn launcher_hooks_forward_runtime_watchdogs_and_computer_use_guard_methods() {
        let source = include_str!("main.rs");

        assert!(source.contains("async fn start_bridge_watchdog"));
        assert!(source.contains(".start_bridge_watchdog(debug_port, helper_port)"));
        assert!(source.contains("async fn ensure_computer_use_config"));
        assert!(source.contains("self.core.ensure_computer_use_config(settings).await"));
        assert!(source.contains("async fn ensure_plugin_marketplace_config"));
        assert!(source.contains("self.core.ensure_plugin_marketplace_config(settings).await"));
        assert!(source.contains("async fn start_computer_use_guard_watchdog"));
        assert!(source.contains("self.core"));
        assert!(source.contains(".start_computer_use_guard_watchdog(settings)"));
    }
}

fn builtin_user_scripts_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| path.join("user_scripts"))
        .unwrap_or_else(|| PathBuf::from("user_scripts"))
}
