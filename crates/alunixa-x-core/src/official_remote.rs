use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime};

use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use crate::relay_config::{
    chatgpt_auth_status_from_home, normalize_relay_profile_for_storage, relay_profile_api_key,
};
use crate::settings::{BackendSettings, RelayMode, SettingsStore};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const LOGIN_URL: &str = "https://chatgpt.com/";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptLoginStart {
    pub login_id: String,
    pub auth_url: String,
    pub chatgpt_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptDeviceLoginStart {
    pub login_id: String,
    pub verification_url: String,
    pub user_code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptLoginProgress {
    pub login_id: Option<String>,
    pub state: String,
    pub message: String,
    pub settings: Option<BackendSettings>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlSnapshot {
    pub account_type: String,
    pub account_label: Option<String>,
    pub plan_type: Option<String>,
    pub requires_openai_auth: bool,
    pub status: String,
    pub server_name: String,
    pub installation_id: String,
    pub environment_id: Option<String>,
    pub clients: Vec<RemoteControlClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlClient {
    pub client_id: String,
    pub display_name: Option<String>,
    pub device_type: Option<String>,
    pub platform: Option<String>,
    pub os_version: Option<String>,
    pub device_model: Option<String>,
    pub app_version: Option<String>,
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlPairing {
    pub pairing_code: String,
    pub manual_pairing_code: Option<String>,
    pub environment_id: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
struct LoginCompletion {
    success: bool,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingLogin {
    login_id: String,
    mode: PendingLoginMode,
    backup: LoginBackup,
}

#[derive(Debug, Clone, Copy)]
enum PendingLoginMode {
    Browser,
    DeviceCode,
}

#[derive(Debug, Clone)]
pub struct LoginBackup {
    settings: BackendSettings,
    config_contents: Option<Vec<u8>>,
    auth_contents: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct OfficialRemoteRuntime {
    client: Option<AppServerClient>,
    pending_login: Option<PendingLogin>,
}

impl OfficialRemoteRuntime {
    pub async fn login_start(
        &mut self,
        saved_app_path: Option<&str>,
        store: &SettingsStore,
        home: &Path,
    ) -> anyhow::Result<ChatGptLoginStart> {
        if self.pending_login.is_some() {
            anyhow::bail!("已有 ChatGPT 登录正在等待完成");
        }
        let backup = capture_login_backup(store, home)?;
        let client = self.ensure_client(saved_app_path).await?;
        match client.start_chatgpt_login().await {
            Ok(start) => {
                self.pending_login = Some(PendingLogin {
                    login_id: start.login_id.clone(),
                    mode: PendingLoginMode::Browser,
                    backup,
                });
                Ok(start)
            }
            Err(error) => {
                let _ = restore_login_backup(store, home, &backup);
                self.client = None;
                Err(error)
            }
        }
    }

    pub async fn device_login_start(
        &mut self,
        saved_app_path: Option<&str>,
        store: &SettingsStore,
        home: &Path,
    ) -> anyhow::Result<ChatGptDeviceLoginStart> {
        if self.pending_login.is_some() {
            anyhow::bail!("已有 ChatGPT 登录正在等待完成");
        }
        let backup = capture_login_backup(store, home)?;
        let client = self.ensure_client(saved_app_path).await?;
        match client.start_chatgpt_device_login().await {
            Ok(start) => {
                self.pending_login = Some(PendingLogin {
                    login_id: start.login_id.clone(),
                    mode: PendingLoginMode::DeviceCode,
                    backup,
                });
                Ok(start)
            }
            Err(error) => {
                let _ = restore_login_backup(store, home, &backup);
                self.client = None;
                Err(error)
            }
        }
    }

    pub async fn login_status(
        &mut self,
        login_id: &str,
        store: &SettingsStore,
        home: &Path,
    ) -> anyhow::Result<ChatGptLoginProgress> {
        let Some(pending) = self.pending_login.as_ref() else {
            return Ok(ChatGptLoginProgress {
                login_id: None,
                state: "idle".to_string(),
                message: "当前没有等待完成的 ChatGPT 登录。".to_string(),
                settings: None,
            });
        };
        if pending.login_id != login_id {
            anyhow::bail!("登录任务标识不匹配");
        }
        let client = self
            .client
            .as_mut()
            .context("ChatGPT 登录会话已关闭，请重新发起登录")?;
        let Some(completion) = client.take_login_completion(login_id)? else {
            let message = match pending.mode {
                PendingLoginMode::Browser => "正在等待浏览器完成 ChatGPT 登录。",
                PendingLoginMode::DeviceCode => "正在等待设备码授权，可在手机或其他设备完成验证。",
            };
            return Ok(ChatGptLoginProgress {
                login_id: Some(login_id.to_string()),
                state: "pending".to_string(),
                message: message.to_string(),
                settings: None,
            });
        };

        let pending = self.pending_login.take().expect("pending login checked");
        if !completion.success {
            let _ = restore_login_backup(store, home, &pending.backup);
            self.client = None;
            return Ok(ChatGptLoginProgress {
                login_id: Some(login_id.to_string()),
                state: "failed".to_string(),
                message: completion
                    .error
                    .as_deref()
                    .map(sanitize_server_message)
                    .filter(|message| !message.is_empty())
                    .unwrap_or_else(|| "ChatGPT 登录未完成。".to_string()),
                settings: None,
            });
        }

        match migrate_active_profile_after_chatgpt_login(store, home) {
            Ok(settings) => Ok(ChatGptLoginProgress {
                login_id: Some(login_id.to_string()),
                state: "succeeded".to_string(),
                message: "ChatGPT 登录已完成，当前 API 供应商已保留并切换为官方登录混合模式。"
                    .to_string(),
                settings: Some(settings),
            }),
            Err(error) => {
                let restore_error = restore_login_backup(store, home, &pending.backup).err();
                self.client = None;
                let suffix = restore_error
                    .map(|error| format!("；回滚也失败：{error}"))
                    .unwrap_or_default();
                Err(anyhow!("登录后的供应商迁移失败：{error}{suffix}"))
            }
        }
    }

    pub async fn login_cancel(
        &mut self,
        login_id: &str,
        store: &SettingsStore,
        home: &Path,
    ) -> anyhow::Result<ChatGptLoginProgress> {
        let Some(pending) = self.pending_login.take() else {
            return Ok(ChatGptLoginProgress {
                login_id: None,
                state: "idle".to_string(),
                message: "当前没有等待取消的 ChatGPT 登录。".to_string(),
                settings: None,
            });
        };
        if pending.login_id != login_id {
            self.pending_login = Some(pending);
            anyhow::bail!("登录任务标识不匹配");
        }
        if let Some(client) = self.client.as_mut() {
            let _ = client.cancel_login(login_id).await;
        }
        restore_login_backup(store, home, &pending.backup)?;
        Ok(ChatGptLoginProgress {
            login_id: Some(login_id.to_string()),
            state: "canceled".to_string(),
            message: "ChatGPT 登录已取消，原配置已恢复。".to_string(),
            settings: Some(store.load().context("重新读取已恢复的供应商设置失败")?),
        })
    }

    pub async fn status(
        &mut self,
        saved_app_path: Option<&str>,
    ) -> anyhow::Result<RemoteControlSnapshot> {
        let result = self.ensure_client(saved_app_path).await?.snapshot().await;
        if result.is_err() {
            self.client = None;
        }
        result
    }

    pub async fn logout(
        &mut self,
        saved_app_path: Option<&str>,
        store: &SettingsStore,
        home: &Path,
    ) -> anyhow::Result<BackendSettings> {
        if self.pending_login.is_some() {
            anyhow::bail!("请先取消正在等待的 ChatGPT 登录");
        }
        let remote_logout = match self.ensure_client(saved_app_path).await {
            Ok(client) => client.request("account/logout", None).await.err(),
            Err(error) => Some(error),
        };
        let result = clear_chatgpt_login_after_logout(store, home).map_err(|local_error| {
            if let Some(remote_error) = remote_logout.as_ref() {
                anyhow::anyhow!(
                    "app-server 退出失败：{remote_error}；本地登录态清理也失败：{local_error}"
                )
            } else {
                local_error
            }
        });
        if let Some(error) = remote_logout {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "official_remote.logout.remote_failed_local_cleared",
                json!({ "error": error.to_string() }),
            );
        }
        self.client = None;
        result
    }

    pub async fn enable(
        &mut self,
        saved_app_path: Option<&str>,
    ) -> anyhow::Result<RemoteControlSnapshot> {
        let result = async {
            let client = self.ensure_client(saved_app_path).await?;
            client
                .request("remoteControl/enable", Some(json!({ "ephemeral": false })))
                .await?;
            client.snapshot().await
        }
        .await;
        if result.is_err() {
            self.client = None;
        }
        result
    }

    pub async fn disable(
        &mut self,
        saved_app_path: Option<&str>,
    ) -> anyhow::Result<RemoteControlSnapshot> {
        let result = async {
            let client = self.ensure_client(saved_app_path).await?;
            client
                .request("remoteControl/disable", Some(json!({ "ephemeral": false })))
                .await?;
            client.snapshot().await
        }
        .await;
        if result.is_err() {
            self.client = None;
        }
        result
    }

    pub async fn pairing_start(
        &mut self,
        saved_app_path: Option<&str>,
    ) -> anyhow::Result<RemoteControlPairing> {
        let result = async {
            let client = self.ensure_client(saved_app_path).await?;
            let value = client
                .request(
                    "remoteControl/pairing/start",
                    Some(json!({ "manualCode": true })),
                )
                .await?;
            serde_json::from_value(value).context("解析手机配对结果失败")
        }
        .await;
        if result.is_err() {
            self.client = None;
        }
        result
    }

    pub async fn pairing_status(
        &mut self,
        saved_app_path: Option<&str>,
        pairing_code: Option<&str>,
        manual_pairing_code: Option<&str>,
    ) -> anyhow::Result<bool> {
        let result = async {
            let client = self.ensure_client(saved_app_path).await?;
            let value = client
                .request(
                    "remoteControl/pairing/status",
                    Some(json!({
                        "pairingCode": pairing_code,
                        "manualPairingCode": manual_pairing_code
                    })),
                )
                .await?;
            Ok(value
                .get("claimed")
                .and_then(Value::as_bool)
                .unwrap_or(false))
        }
        .await;
        if result.is_err() {
            self.client = None;
        }
        result
    }

    pub async fn revoke_client(
        &mut self,
        saved_app_path: Option<&str>,
        environment_id: &str,
        client_id: &str,
    ) -> anyhow::Result<RemoteControlSnapshot> {
        let result = async {
            let client = self.ensure_client(saved_app_path).await?;
            client
                .request(
                    "remoteControl/client/revoke",
                    Some(json!({
                        "environmentId": environment_id,
                        "clientId": client_id
                    })),
                )
                .await?;
            client.snapshot().await
        }
        .await;
        if result.is_err() {
            self.client = None;
        }
        result
    }

    async fn ensure_client(
        &mut self,
        saved_app_path: Option<&str>,
    ) -> anyhow::Result<&mut AppServerClient> {
        if self.client.is_none() {
            self.client = Some(AppServerClient::connect(saved_app_path).await?);
        }
        self.client
            .as_mut()
            .context("无法创建 Codex app-server 会话")
    }
}

pub fn capture_login_backup(store: &SettingsStore, home: &Path) -> anyhow::Result<LoginBackup> {
    Ok(LoginBackup {
        settings: store.load().context("读取供应商设置失败")?,
        config_contents: read_optional_bytes(&home.join("config.toml"))?,
        auth_contents: read_optional_bytes(&home.join("auth.json"))?,
    })
}

pub fn restore_login_backup(
    store: &SettingsStore,
    home: &Path,
    backup: &LoginBackup,
) -> anyhow::Result<()> {
    restore_optional_file(&home.join("config.toml"), backup.config_contents.as_deref())?;
    restore_optional_file(&home.join("auth.json"), backup.auth_contents.as_deref())?;
    store.save(&backup.settings).context("恢复供应商设置失败")
}

pub fn migrate_active_profile_after_chatgpt_login(
    store: &SettingsStore,
    home: &Path,
) -> anyhow::Result<BackendSettings> {
    let auth_status = chatgpt_auth_status_from_home(home);
    if !auth_status.authenticated {
        anyhow::bail!("app-server 未写入有效的 ChatGPT 登录态");
    }
    let auth_contents =
        std::fs::read_to_string(home.join("auth.json")).context("读取 ChatGPT 登录态失败")?;
    let mut settings = store.load().context("读取供应商设置失败")?;
    let active_id = settings.active_relay_id.clone();
    let profile = settings
        .relay_profiles
        .iter_mut()
        .find(|profile| profile.id == active_id)
        .context("当前供应商已不在配置列表中")?;
    if matches!(
        profile.relay_mode,
        RelayMode::Aggregate | RelayMode::CustomModels
    ) {
        anyhow::bail!("聚合和自定义模型模式暂不支持自动迁移，请先切换到单一 API 供应商");
    }

    let api_key = relay_profile_api_key(profile);
    let should_mix = matches!(profile.relay_mode, RelayMode::PureApi | RelayMode::MixedApi)
        || profile.official_mix_api_key
        || !api_key.trim().is_empty();
    profile.relay_mode = RelayMode::Official;
    profile.official_mix_api_key = should_mix;
    profile.auth_contents = auth_contents;
    if should_mix {
        if api_key.trim().is_empty() {
            anyhow::bail!("当前 API 供应商缺少可迁移的 API Key");
        }
        profile.api_key = api_key;
    }
    normalize_relay_profile_for_storage(profile).context("整理官方混合供应商失败")?;

    let common_config = [
        settings.relay_common_config_contents.trim(),
        settings.relay_context_config_contents.trim(),
    ]
    .into_iter()
    .filter(|section| !section.is_empty())
    .collect::<Vec<_>>()
    .join("\n\n");
    crate::relay_config::apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard(
        home,
        profile,
        &common_config,
        settings.computer_use_guard_enabled,
    )
    .context("写入官方混合供应商失败")?;
    store.save(&settings).context("保存官方混合供应商失败")?;
    Ok(settings)
}

pub fn clear_chatgpt_login_after_logout(
    store: &SettingsStore,
    home: &Path,
) -> anyhow::Result<BackendSettings> {
    let mut settings = store.load().context("读取供应商设置失败")?;
    for profile in &mut settings.relay_profiles {
        if !auth_contents_has_chatgpt_login(&profile.auth_contents) {
            continue;
        }
        let api_key = relay_profile_api_key(profile);
        profile.auth_contents = api_key_auth_contents(&api_key)?;
        if profile.relay_mode == RelayMode::Official {
            profile.official_mix_api_key = false;
            if !api_key.trim().is_empty() {
                profile.relay_mode = RelayMode::PureApi;
                profile.api_key = api_key;
            }
        }
        normalize_relay_profile_for_storage(profile)
            .context("清理供应商中的 ChatGPT 登录副本失败")?;
    }

    // The live file can contain an auth_mode-only session that was never copied
    // into a saved profile. Clear it independently before reapplying the provider.
    let live_auth_path = home.join("auth.json");
    let live_auth = std::fs::read_to_string(&live_auth_path).unwrap_or_default();
    if auth_contents_has_chatgpt_login(&live_auth) {
        let active_api_key = relay_profile_api_key(&settings.active_relay_profile());
        let replacement = api_key_auth_contents(&active_api_key)?;
        restore_optional_file(
            &live_auth_path,
            (!replacement.is_empty()).then_some(replacement.as_bytes()),
        )
        .context("清理本地 ChatGPT 登录态失败")?;
    }

    if settings.relay_profiles_enabled {
        let active = settings.active_relay_profile();
        let common_config = [
            settings.relay_common_config_contents.trim(),
            settings.relay_context_config_contents.trim(),
        ]
        .into_iter()
        .filter(|section| !section.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
        crate::relay_config::apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard(
            home,
            &active,
            &common_config,
            settings.computer_use_guard_enabled,
        )
        .context("恢复退出登录后的当前供应商失败")?;
    }
    store
        .save(&settings)
        .context("保存退出登录后的供应商设置失败")?;
    Ok(settings)
}

fn auth_contents_has_chatgpt_login(contents: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(contents) else {
        return false;
    };
    let mode_is_chatgpt = value
        .get("auth_mode")
        .and_then(Value::as_str)
        .is_some_and(|mode| mode.eq_ignore_ascii_case("chatgpt"));
    let has_tokens = value
        .get("tokens")
        .and_then(Value::as_object)
        .is_some_and(|tokens| {
            ["access_token", "id_token", "refresh_token"]
                .iter()
                .any(|key| {
                    tokens
                        .get(*key)
                        .and_then(Value::as_str)
                        .is_some_and(|token| !token.trim().is_empty())
                })
        });
    mode_is_chatgpt || has_tokens
}

fn api_key_auth_contents(api_key: &str) -> anyhow::Result<String> {
    if api_key.trim().is_empty() {
        return Ok(String::new());
    }
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "auth_mode": "apikey",
            "OPENAI_API_KEY": api_key.trim()
        }))?
    ))
}

struct AppServerClient {
    _child: Child,
    stdin: ChildStdin,
    messages: UnboundedReceiver<Value>,
    next_id: u64,
    login_completions: HashMap<String, LoginCompletion>,
}

impl AppServerClient {
    async fn connect(saved_app_path: Option<&str>) -> anyhow::Result<Self> {
        let executable = find_codex_cli_executable(saved_app_path)
            .context("未找到可运行的 Codex CLI，请先安装或启动一次 Codex 桌面应用")?;
        let mut command = Command::new(&executable);
        command
            .arg("app-server")
            .arg("--stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(crate::windows_create_no_window());
        let mut child = command
            .spawn()
            .with_context(|| format!("启动 Codex app-server 失败：{}", executable.display()))?;
        let stdin = child
            .stdin
            .take()
            .context("Codex app-server stdin 不可用")?;
        let stdout = child
            .stdout
            .take()
            .context("Codex app-server stdout 不可用")?;
        let (sender, messages) = unbounded_channel();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Ok(message) = serde_json::from_str::<Value>(&line) {
                            if sender.send(message).is_err() {
                                break;
                            }
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
        });
        let mut client = Self {
            _child: child,
            stdin,
            messages,
            next_id: 1,
            login_completions: HashMap::new(),
        };
        client
            .request(
                "initialize",
                Some(json!({
                    "clientInfo": {
                        "name": "Alunixa X",
                        "title": "Alunixa X",
                        "version": crate::version::VERSION
                    },
                    "capabilities": {
                        "experimentalApi": true,
                        "requestAttestation": false,
                        "optOutNotificationMethods": []
                    }
                })),
            )
            .await
            .context("初始化 Codex app-server 失败")?;
        Ok(client)
    }

    async fn start_chatgpt_login(&mut self) -> anyhow::Result<ChatGptLoginStart> {
        let value = self
            .request(
                "account/login/start",
                Some(json!({
                    "type": "chatgpt",
                    "useHostedLoginSuccessPage": false,
                    "appBrand": "chatgpt"
                })),
            )
            .await?;
        let login_id = required_string(&value, "loginId")?;
        let auth_url = required_string(&value, "authUrl")?;
        if !(auth_url.starts_with("https://auth.openai.com/")
            || auth_url.starts_with("https://chatgpt.com/"))
        {
            anyhow::bail!("app-server 返回了非 OpenAI 官方登录地址");
        }
        Ok(ChatGptLoginStart {
            login_id,
            auth_url,
            chatgpt_url: LOGIN_URL.to_string(),
        })
    }

    async fn start_chatgpt_device_login(&mut self) -> anyhow::Result<ChatGptDeviceLoginStart> {
        let value = self
            .request(
                "account/login/start",
                Some(json!({
                    "type": "chatgptDeviceCode"
                })),
            )
            .await?;
        parse_chatgpt_device_login_start(&value)
    }

    async fn cancel_login(&mut self, login_id: &str) -> anyhow::Result<()> {
        self.request("account/login/cancel", Some(json!({ "loginId": login_id })))
            .await
            .map(|_| ())
    }

    fn take_login_completion(&mut self, login_id: &str) -> anyhow::Result<Option<LoginCompletion>> {
        self.drain_notifications()?;
        Ok(self.login_completions.remove(login_id))
    }

    async fn snapshot(&mut self) -> anyhow::Result<RemoteControlSnapshot> {
        let account = self
            .request("account/read", Some(json!({ "refreshToken": false })))
            .await?;
        let remote = self.request("remoteControl/status/read", None).await?;
        let account_value = account.get("account").cloned().unwrap_or(Value::Null);
        let account_type = account_value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("none")
            .to_string();
        let account_label = account_value
            .get("email")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let plan_type = account_value
            .get("planType")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let environment_id = remote
            .get("environmentId")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let clients = if let Some(environment_id) = environment_id.as_deref() {
            self.list_clients(environment_id).await.unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(RemoteControlSnapshot {
            account_type,
            account_label,
            plan_type,
            requires_openai_auth: account
                .get("requiresOpenaiAuth")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            status: remote
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("disabled")
                .to_string(),
            server_name: remote
                .get("serverName")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            installation_id: remote
                .get("installationId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            environment_id,
            clients,
        })
    }

    async fn list_clients(
        &mut self,
        environment_id: &str,
    ) -> anyhow::Result<Vec<RemoteControlClient>> {
        let value = self
            .request(
                "remoteControl/client/list",
                Some(json!({
                    "environmentId": environment_id,
                    "limit": 100,
                    "order": "desc"
                })),
            )
            .await?;
        serde_json::from_value(
            value
                .get("data")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        )
        .context("解析已连接手机列表失败")
    }

    async fn request(&mut self, method: &str, params: Option<Value>) -> anyhow::Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let mut request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method
        });
        if let Some(params) = params {
            request["params"] = params;
        }
        let mut bytes = serde_json::to_vec(&request)?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .context("写入 Codex app-server 请求失败")?;
        self.stdin.flush().await?;

        tokio::time::timeout(REQUEST_TIMEOUT, async {
            loop {
                let message = self
                    .messages
                    .recv()
                    .await
                    .context("Codex app-server 已关闭")?;
                if message.get("id").and_then(Value::as_u64) == Some(id) {
                    if let Some(error) = message.get("error") {
                        let code = error
                            .get("code")
                            .and_then(Value::as_i64)
                            .unwrap_or_default();
                        let message = error
                            .get("message")
                            .and_then(Value::as_str)
                            .map(sanitize_server_message)
                            .unwrap_or_else(|| "未知 app-server 错误".to_string());
                        return Err(anyhow!("app-server {code}: {message}"));
                    }
                    return Ok(message.get("result").cloned().unwrap_or(Value::Null));
                }
                self.handle_notification(message);
            }
        })
        .await
        .map_err(|_| anyhow!("{method} 请求超时"))?
    }

    fn drain_notifications(&mut self) -> anyhow::Result<()> {
        loop {
            match self.messages.try_recv() {
                Ok(message) => self.handle_notification(message),
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => return Ok(()),
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                    anyhow::bail!("Codex app-server 已关闭");
                }
            }
        }
    }

    fn handle_notification(&mut self, message: Value) {
        if message.get("method").and_then(Value::as_str) != Some("account/login/completed") {
            return;
        }
        let Some(params) = message.get("params") else {
            return;
        };
        let Some(login_id) = params.get("loginId").and_then(Value::as_str) else {
            return;
        };
        self.login_completions.insert(
            login_id.to_string(),
            LoginCompletion {
                success: params
                    .get("success")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                error: params
                    .get("error")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            },
        );
    }
}

pub fn find_codex_cli_executable(saved_app_path: Option<&str>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        let root = PathBuf::from(local_appdata)
            .join("OpenAI")
            .join("Codex")
            .join("bin");
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let candidate =
                    entry
                        .path()
                        .join(if cfg!(windows) { "codex.exe" } else { "codex" });
                if candidate.is_file() {
                    let modified = candidate
                        .metadata()
                        .and_then(|metadata| metadata.modified())
                        .unwrap_or(SystemTime::UNIX_EPOCH);
                    candidates.push((modified, candidate));
                }
            }
        }
    }
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    if let Some((_, candidate)) = candidates.into_iter().next() {
        return Some(candidate);
    }

    if let Some(app_dir) = crate::app_paths::resolve_codex_app_dir_with_saved(None, saved_app_path)
    {
        let resources = if app_dir
            .extension()
            .is_some_and(|extension| extension == "app")
        {
            app_dir.join("Contents").join("Resources")
        } else {
            app_dir.join("resources")
        };
        let candidate = resources.join(if cfg!(windows) { "codex.exe" } else { "codex" });
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    executable_on_path(if cfg!(windows) { "codex.exe" } else { "codex" })
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|path| path.join(name))
        .find(|candidate| candidate.is_file())
}

fn required_string(value: &Value, key: &str) -> anyhow::Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("app-server 响应缺少 {key}"))
}

fn parse_chatgpt_device_login_start(value: &Value) -> anyhow::Result<ChatGptDeviceLoginStart> {
    if value.get("type").and_then(Value::as_str) != Some("chatgptDeviceCode") {
        anyhow::bail!("app-server 返回了非设备码登录结果");
    }
    let login_id = required_string(value, "loginId")?;
    let verification_url = required_string(value, "verificationUrl")?;
    let user_code = required_string(value, "userCode")?;
    if !is_openai_login_url(&verification_url) {
        anyhow::bail!("app-server 返回了非 OpenAI 官方设备验证地址");
    }
    Ok(ChatGptDeviceLoginStart {
        login_id,
        verification_url,
        user_code,
    })
}

fn is_openai_login_url(url: &str) -> bool {
    url.starts_with("https://auth.openai.com/") || url.starts_with("https://chatgpt.com/")
}

fn sanitize_server_message(message: &str) -> String {
    let normalized = message
        .chars()
        .filter(|character| !character.is_control() || *character == '\n')
        .take(400)
        .collect::<String>()
        .trim()
        .to_string();
    normalized
        .split_whitespace()
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            if part.len() > 160
                || part.starts_with("eyJ")
                || part.starts_with("sk-")
                || lower.contains("access_token")
                || lower.contains("refresh_token")
                || lower.contains("session-token")
            {
                return "[redacted]".to_string();
            }
            if part.starts_with("https://") || part.starts_with("http://") {
                return part.split('?').next().unwrap_or(part).to_string();
            }
            part.to_string()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn read_optional_bytes(path: &Path) -> anyhow::Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("读取 {} 失败", path.display())),
    }
}

fn restore_optional_file(path: &Path, contents: Option<&[u8]>) -> anyhow::Result<()> {
    if let Some(contents) = contents {
        crate::settings::atomic_write(path, contents)
    } else {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error).with_context(|| format!("删除 {} 失败", path.display())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{RelayProfile, RelayProtocol};

    #[test]
    fn migration_keeps_api_provider_and_chatgpt_auth() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join(".codex");
        let store = SettingsStore::new(temp.path().join("settings.json"));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("auth.json"),
            r#"{"auth_mode":"chatgpt","tokens":{"access_token":"account-token","refresh_token":"refresh-token"},"last_refresh":"2026-07-19T00:00:00Z"}"#,
        )
        .unwrap();
        let settings = BackendSettings {
            active_relay_id: "api".to_string(),
            relay_profiles: vec![RelayProfile {
                id: "api".to_string(),
                name: "API".to_string(),
                base_url: "https://example.test/v1".to_string(),
                api_key: "sk-provider".to_string(),
                protocol: RelayProtocol::Responses,
                relay_mode: RelayMode::PureApi,
                auth_contents: r#"{"auth_mode":"apikey","OPENAI_API_KEY":"sk-provider"}"#
                    .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };
        store.save(&settings).unwrap();

        let migrated = migrate_active_profile_after_chatgpt_login(&store, &home).unwrap();
        let profile = &migrated.relay_profiles[0];
        assert_eq!(profile.relay_mode, RelayMode::Official);
        assert!(profile.official_mix_api_key);
        assert_eq!(profile.api_key, "sk-provider");
        assert!(
            profile
                .config_contents
                .contains("experimental_bearer_token = \"sk-provider\"")
        );
        assert!(profile.auth_contents.contains("\"auth_mode\": \"chatgpt\""));
        assert!(!profile.auth_contents.contains("OPENAI_API_KEY"));
        let live_auth = std::fs::read_to_string(home.join("auth.json")).unwrap();
        assert!(live_auth.contains("\"auth_mode\": \"chatgpt\""));
        assert!(!live_auth.contains("OPENAI_API_KEY"));
    }

    #[test]
    fn logout_clears_chatgpt_copies_and_restores_active_api_provider() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join(".codex");
        let store = SettingsStore::new(temp.path().join("settings.json"));
        std::fs::create_dir_all(&home).unwrap();
        let chatgpt_auth = r#"{"auth_mode":"chatgpt","tokens":{"access_token":"account-token","refresh_token":"refresh-token"}}"#;
        std::fs::write(home.join("auth.json"), chatgpt_auth).unwrap();
        let settings = BackendSettings {
            active_relay_id: "mixed".to_string(),
            relay_profiles: vec![
                RelayProfile {
                    id: "mixed".to_string(),
                    name: "Mixed".to_string(),
                    model: "gpt-test".to_string(),
                    model_list: "gpt-test".to_string(),
                    base_url: "https://example.test/v1".to_string(),
                    api_key: "sk-provider".to_string(),
                    protocol: RelayProtocol::Responses,
                    relay_mode: RelayMode::Official,
                    official_mix_api_key: true,
                    auth_contents: chatgpt_auth.to_string(),
                    ..RelayProfile::default()
                },
                RelayProfile {
                    id: "official".to_string(),
                    name: "Official".to_string(),
                    relay_mode: RelayMode::Official,
                    auth_contents: chatgpt_auth.to_string(),
                    ..RelayProfile::default()
                },
            ],
            ..BackendSettings::default()
        };
        store.save(&settings).unwrap();

        let logged_out = clear_chatgpt_login_after_logout(&store, &home).unwrap();

        let mixed = &logged_out.relay_profiles[0];
        assert_eq!(mixed.relay_mode, RelayMode::PureApi);
        assert!(!mixed.official_mix_api_key);
        assert_eq!(mixed.api_key, "sk-provider");
        assert!(mixed.auth_contents.contains("OPENAI_API_KEY"));
        assert!(!mixed.auth_contents.contains("access_token"));
        assert!(logged_out.relay_profiles[1].auth_contents.is_empty());
        let live_auth = std::fs::read_to_string(home.join("auth.json")).unwrap();
        assert!(live_auth.contains("OPENAI_API_KEY"));
        assert!(!live_auth.contains("account-token"));
    }

    #[test]
    fn logout_clears_auth_mode_only_live_session_when_profiles_are_disabled() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join(".codex");
        let store = SettingsStore::new(temp.path().join("settings.json"));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join("auth.json"), r#"{"auth_mode":"chatgpt"}"#).unwrap();
        store
            .save(&BackendSettings {
                relay_profiles_enabled: false,
                ..BackendSettings::default()
            })
            .unwrap();

        clear_chatgpt_login_after_logout(&store, &home).unwrap();

        assert!(!home.join("auth.json").exists());
    }

    #[test]
    fn backup_restore_recovers_files_and_settings() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join(".codex");
        let store = SettingsStore::new(temp.path().join("settings.json"));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join("config.toml"), "model = \"before\"\n").unwrap();
        std::fs::write(home.join("auth.json"), "{\"auth_mode\":\"apikey\"}\n").unwrap();
        let settings = BackendSettings {
            active_relay_id: "before".to_string(),
            ..BackendSettings::default()
        };
        store.save(&settings).unwrap();
        let backup = capture_login_backup(&store, &home).unwrap();

        std::fs::write(home.join("config.toml"), "model = \"after\"\n").unwrap();
        std::fs::write(home.join("auth.json"), "{\"auth_mode\":\"chatgpt\"}\n").unwrap();
        store.save(&BackendSettings::default()).unwrap();
        restore_login_backup(&store, &home, &backup).unwrap();

        assert_eq!(
            std::fs::read_to_string(home.join("config.toml")).unwrap(),
            "model = \"before\"\n"
        );
        assert_eq!(
            std::fs::read_to_string(home.join("auth.json")).unwrap(),
            "{\"auth_mode\":\"apikey\"}\n"
        );
        assert_eq!(store.load().unwrap().active_relay_id, "before");
    }

    #[test]
    fn server_error_sanitization_removes_url_queries_and_token_like_values() {
        let sanitized = sanitize_server_message(
            "login failed https://auth.openai.com/oauth?code=secret eyJabcdefghijklmnopqrstuvwxyz",
        );

        assert_eq!(
            sanitized,
            "login failed https://auth.openai.com/oauth [redacted]"
        );
        assert!(!sanitized.contains("secret"));
    }

    #[test]
    fn parses_official_device_login_response() {
        let parsed = parse_chatgpt_device_login_start(&json!({
            "type": "chatgptDeviceCode",
            "loginId": "login-1",
            "verificationUrl": "https://auth.openai.com/codex/device",
            "userCode": "ABCD-EFGH"
        }))
        .unwrap();

        assert_eq!(parsed.login_id, "login-1");
        assert_eq!(
            parsed.verification_url,
            "https://auth.openai.com/codex/device"
        );
        assert_eq!(parsed.user_code, "ABCD-EFGH");
    }

    #[test]
    fn rejects_non_openai_device_login_response() {
        let error = parse_chatgpt_device_login_start(&json!({
            "type": "chatgptDeviceCode",
            "loginId": "login-1",
            "verificationUrl": "https://example.test/device",
            "userCode": "ABCD-EFGH"
        }))
        .unwrap_err();

        assert!(error.to_string().contains("非 OpenAI 官方设备验证地址"));
    }

    #[test]
    fn rejects_non_device_login_response() {
        let error = parse_chatgpt_device_login_start(&json!({
            "type": "chatgpt",
            "loginId": "login-1",
            "verificationUrl": "https://auth.openai.com/codex/device",
            "userCode": "ABCD-EFGH"
        }))
        .unwrap_err();

        assert!(error.to_string().contains("非设备码登录结果"));
    }
}
