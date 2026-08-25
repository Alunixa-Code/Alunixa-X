use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdout, Command};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const TURN_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_LAUNCH_ERROR_CHARS: usize = 480;

#[derive(Debug, Clone)]
pub struct AppServerConfig {
    pub executable: String,
    pub work_dir: PathBuf,
    pub model: String,
    pub sandbox: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TurnUsage {
    /// The active context size reported by app-server for the latest turn.
    pub context_used: Option<u64>,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppServerTurnResult {
    pub reply: String,
    pub model: String,
    pub usage: TurnUsage,
}

pub struct CodexAppServer {
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
    running: bool,
    config: AppServerConfig,
}

#[derive(Debug, Clone)]
struct AppServerLaunchCandidate {
    executable: PathBuf,
    arguments: Vec<OsString>,
    environment: Vec<(OsString, OsString)>,
    source: &'static str,
}

impl AppServerLaunchCandidate {
    fn standard(executable: PathBuf, source: &'static str) -> Self {
        Self {
            executable,
            arguments: vec![OsString::from("app-server")],
            environment: Vec::new(),
            source,
        }
    }
}

#[derive(Debug)]
struct AppServerStartFailure {
    stage: &'static str,
    message: String,
    os_error_code: Option<i32>,
}

impl CodexAppServer {
    pub async fn start(config: AppServerConfig) -> anyhow::Result<Self> {
        let candidates = app_server_launch_candidates(&config.executable);
        Self::start_with_candidates(config, candidates).await
    }

    async fn start_with_candidates(
        config: AppServerConfig,
        candidates: Vec<AppServerLaunchCandidate>,
    ) -> anyhow::Result<Self> {
        let mut failures = Vec::new();
        for candidate in candidates {
            match Self::start_candidate(config.clone(), &candidate).await {
                Ok(server) => {
                    append_launch_diagnostic("connect.weixin_app_server_spawned", &candidate, None);
                    return Ok(server);
                }
                Err(error) => {
                    append_launch_diagnostic(
                        "connect.weixin_app_server_candidate_failed",
                        &candidate,
                        Some(&error),
                    );
                    let os_error = error
                        .os_error_code
                        .map(|code| format!("，os error {code}"))
                        .unwrap_or_default();
                    failures.push(format!(
                        "{}（{}，{}{}）：{}",
                        candidate.executable.display(),
                        candidate.source,
                        error.stage,
                        os_error,
                        bounded_launch_error(&error.message)
                    ));
                }
            }
        }
        let detail = if failures.is_empty() {
            "没有解析到任何 Codex CLI 候选".to_string()
        } else {
            failures.join("；")
        };
        bail!("无法启动 Codex app-server；已尝试的 CLI 均失败：{detail}")
    }

    async fn start_candidate(
        mut config: AppServerConfig,
        candidate: &AppServerLaunchCandidate,
    ) -> Result<Self, AppServerStartFailure> {
        let mut command = Command::new(&candidate.executable);
        command
            .args(&candidate.arguments)
            .envs(candidate.environment.iter().cloned())
            .current_dir(&config.work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| AppServerStartFailure {
            stage: "创建进程",
            message: error.to_string(),
            os_error_code: error.raw_os_error(),
        })?;
        let stdin = child.stdin.take().ok_or_else(|| AppServerStartFailure {
            stage: "连接 stdin",
            message: "子进程没有提供 stdin 管道".to_string(),
            os_error_code: None,
        })?;
        let stdout = child.stdout.take().ok_or_else(|| AppServerStartFailure {
            stage: "连接 stdout",
            message: "子进程没有提供 stdout 管道".to_string(),
            os_error_code: None,
        })?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while matches!(lines.next_line().await, Ok(Some(_))) {}
            });
        }

        config.executable = candidate.executable.to_string_lossy().into_owned();
        let mut server = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            next_id: 1,
            running: true,
            config,
        };
        server
            .initialize()
            .await
            .map_err(|error| AppServerStartFailure {
                stage: "初始化",
                message: format!("{error:#}"),
                os_error_code: None,
            })?;
        Ok(server)
    }

    pub fn is_running(&self) -> bool {
        self.running
    }

    pub async fn prepare_thread(&mut self, thread_id: Option<&str>) -> anyhow::Result<String> {
        let mut params = self.thread_params();
        let method = if let Some(thread_id) = thread_id.filter(|id| !id.trim().is_empty()) {
            params["threadId"] = Value::String(thread_id.trim().to_string());
            params["persistExtendedHistory"] = Value::Bool(true);
            "thread/resume"
        } else {
            "thread/start"
        };
        let result = self.request(method, params, REQUEST_TIMEOUT).await?;
        extract_thread_id(&result)
            .with_context(|| format!("Codex app-server {method} 未返回 thread id"))
    }

    pub async fn run_turn(
        &mut self,
        thread_id: &str,
        prompt: &str,
    ) -> anyhow::Result<AppServerTurnResult> {
        let id = self.take_request_id();
        let mut params = json!({
            "threadId": thread_id,
            "input": [{
                "type": "text",
                "text": prompt,
                "text_elements": []
            }],
            "approvalPolicy": "never"
        });
        if !self.config.model.trim().is_empty() {
            params["model"] = Value::String(self.config.model.trim().to_string());
        }
        self.write_json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "turn/start",
            "params": params
        }))
        .await?;

        let mut response_received = false;
        let mut turn_completed = false;
        let mut reply_parts = Vec::new();
        let mut model = self.config.model.trim().to_string();
        let mut usage = TurnUsage::default();
        let deadline = tokio::time::Instant::now() + TURN_TIMEOUT;
        while !response_received || !turn_completed {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                bail!("等待 Codex 回复超时");
            }
            let message = self.read_message(remaining).await?;
            if is_server_request(&message) {
                self.reject_server_request(&message).await?;
                continue;
            }
            if response_id(&message) == Some(id) {
                if let Some(error) = rpc_error(&message) {
                    bail!("Codex turn/start 失败：{error}");
                }
                let result = message.get("result").cloned().unwrap_or(Value::Null);
                if extract_turn_id(&result).is_none() {
                    bail!("Codex turn/start 未返回 turn id");
                }
                if model.is_empty() {
                    model = extract_model(&result).unwrap_or_default();
                }
                if let Some(reported_usage) = extract_turn_usage(&result) {
                    usage = reported_usage;
                }
                response_received = true;
                continue;
            }

            if model.is_empty() {
                model = extract_model(&message).unwrap_or_default();
            }
            if let Some(reported_usage) = extract_turn_usage(&message) {
                usage = reported_usage;
            }

            match message.get("method").and_then(Value::as_str) {
                Some("item/completed") => {
                    if let Some(text) = extract_completed_agent_text(&message) {
                        if !reply_parts.iter().any(|part| part == &text) {
                            reply_parts.push(text);
                        }
                    }
                }
                Some("turn/completed") => turn_completed = true,
                Some("thread/status/changed") if thread_status_is_idle(&message) => {
                    turn_completed = true;
                }
                Some("error") => {
                    let error = deep_string(message.get("params"), &["message", "error"])
                        .unwrap_or_else(|| "Codex app-server 返回未知错误".to_string());
                    bail!("{error}");
                }
                _ => {}
            }
        }
        Ok(AppServerTurnResult {
            reply: reply_parts.join("\n\n"),
            model,
            usage,
        })
    }

    pub async fn close(&mut self) {
        self.running = false;
        let _ = self.stdin.shutdown().await;
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }

    async fn initialize(&mut self) -> anyhow::Result<()> {
        self.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "alunixa-x-weixin",
                    "title": "Alunixa X Weixin Connect",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "optOutNotificationMethods": [
                        "command/exec/outputDelta",
                        "item/agentMessage/delta",
                        "item/plan/delta",
                        "item/fileChange/outputDelta",
                        "item/reasoning/summaryTextDelta",
                        "item/reasoning/textDelta"
                    ]
                }
            }),
            REQUEST_TIMEOUT,
        )
        .await
        .context("初始化 Codex app-server 失败")?;
        self.write_json(&json!({
            "jsonrpc": "2.0",
            "method": "initialized"
        }))
        .await
    }

    fn thread_params(&self) -> Value {
        let mut params = json!({
            "cwd": self.config.work_dir.to_string_lossy(),
            "experimentalRawEvents": false,
            "persistExtendedHistory": false,
            "approvalPolicy": "never",
            "sandbox": normalize_sandbox(&self.config.sandbox)
        });
        if !self.config.model.trim().is_empty() {
            params["model"] = Value::String(self.config.model.trim().to_string());
        }
        params
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> anyhow::Result<Value> {
        let id = self.take_request_id();
        self.write_json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .await?;
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                bail!("Codex app-server {method} 请求超时");
            }
            let message = self.read_message(remaining).await?;
            if is_server_request(&message) {
                self.reject_server_request(&message).await?;
                continue;
            }
            if response_id(&message) != Some(id) {
                continue;
            }
            if let Some(error) = rpc_error(&message) {
                bail!("Codex app-server {method} 失败：{error}");
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    async fn read_message(&mut self, timeout: Duration) -> anyhow::Result<Value> {
        loop {
            let line = tokio::time::timeout(timeout, self.stdout.next_line())
                .await
                .context("等待 Codex app-server 响应超时")??;
            let Some(line) = line else {
                self.running = false;
                let exit = self.child.try_wait().ok().flatten();
                bail!(
                    "Codex app-server 已关闭{}",
                    exit.map(|status| format!("：{status}")).unwrap_or_default()
                );
            };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str(line) {
                Ok(message) => return Ok(message),
                Err(_) => continue,
            }
        }
    }

    async fn reject_server_request(&mut self, message: &Value) -> anyhow::Result<()> {
        let Some(id) = message.get("id") else {
            return Ok(());
        };
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let result = match method {
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                json!({ "decision": "decline" })
            }
            "item/permissions/requestApproval" => json!({ "permissions": {} }),
            "item/tool/requestUserInput" => json!({ "answers": {} }),
            "item/tool/call" => json!({
                "success": false,
                "contentItems": [{
                    "type": "inputText",
                    "text": "tool not available on this client"
                }]
            }),
            _ => {
                return self
                    .write_json(&json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": "method not found" }
                    }))
                    .await;
            }
        };
        self.write_json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        }))
        .await
    }

    async fn write_json(&mut self, value: &Value) -> anyhow::Result<()> {
        let mut bytes = serde_json::to_vec(value)?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .context("写入 Codex app-server 失败")?;
        self.stdin.flush().await?;
        Ok(())
    }

    fn take_request_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        id
    }
}

fn app_server_launch_candidates(configured: &str) -> Vec<AppServerLaunchCandidate> {
    let configured = (!configured.trim().is_empty()).then(|| PathBuf::from(configured.trim()));
    let cached = crate::app_paths::find_cached_codex_cli_candidates();
    let bundled = crate::app_paths::resolve_codex_app_dir_with_saved(None, None)
        .and_then(|app_dir| crate::app_paths::find_bundled_codex_cli(&app_dir));
    let on_path = crate::app_paths::find_codex_cli_on_path();
    assemble_app_server_launch_candidates(configured, cached, bundled, on_path)
}

fn assemble_app_server_launch_candidates(
    configured: Option<PathBuf>,
    cached: Vec<PathBuf>,
    bundled: Option<PathBuf>,
    on_path: Option<PathBuf>,
) -> Vec<AppServerLaunchCandidate> {
    let configured_is_store = configured
        .as_deref()
        .is_some_and(crate::app_paths::is_windows_store_codex_cli);
    let mut candidates = Vec::new();
    if !configured_is_store {
        if let Some(configured) = configured.clone() {
            push_launch_candidate(&mut candidates, configured, "configured");
        }
    }
    for executable in cached {
        push_launch_candidate(&mut candidates, executable, "desktop-cache");
    }
    if configured_is_store {
        if let Some(configured) = configured {
            push_launch_candidate(&mut candidates, configured, "configured-store");
        }
    }
    if let Some(bundled) = bundled {
        push_launch_candidate(&mut candidates, bundled, "desktop-bundle");
    }
    let has_path_candidate = on_path.is_some();
    if let Some(on_path) = on_path {
        push_launch_candidate(&mut candidates, on_path, "path");
    }
    if !has_path_candidate {
        push_launch_candidate(
            &mut candidates,
            PathBuf::from(if cfg!(windows) { "codex.exe" } else { "codex" }),
            "command-search",
        );
    }
    candidates
}

fn push_launch_candidate(
    candidates: &mut Vec<AppServerLaunchCandidate>,
    executable: PathBuf,
    source: &'static str,
) {
    let key = launch_executable_key(&executable);
    if candidates
        .iter()
        .any(|candidate| launch_executable_key(&candidate.executable) == key)
    {
        return;
    }
    candidates.push(AppServerLaunchCandidate::standard(executable, source));
}

fn launch_executable_key(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn bounded_launch_error(message: &str) -> String {
    let mut value = message
        .chars()
        .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
        .take(MAX_LAUNCH_ERROR_CHARS)
        .collect::<String>();
    if message.chars().count() > MAX_LAUNCH_ERROR_CHARS {
        value.push_str("...");
    }
    value
}

#[cfg(not(test))]
fn append_launch_diagnostic(
    event: &str,
    candidate: &AppServerLaunchCandidate,
    failure: Option<&AppServerStartFailure>,
) {
    let _ = crate::diagnostic_log::append_diagnostic_log(
        event,
        json!({
            "source": candidate.source,
            "executable": candidate.executable.to_string_lossy(),
            "stage": failure.map(|failure| failure.stage),
            "osErrorCode": failure.and_then(|failure| failure.os_error_code),
            "message": failure.map(|failure| bounded_launch_error(&failure.message))
        }),
    );
}

#[cfg(test)]
fn append_launch_diagnostic(
    _event: &str,
    _candidate: &AppServerLaunchCandidate,
    _failure: Option<&AppServerStartFailure>,
) {
}

impl Drop for CodexAppServer {
    fn drop(&mut self) {
        if self.running {
            let _ = self.child.start_kill();
        }
    }
}

fn normalize_sandbox(value: &str) -> &'static str {
    match value.trim() {
        "workspace-write" => "workspace-write",
        "danger-full-access" => "danger-full-access",
        _ => "read-only",
    }
}

fn response_id(message: &Value) -> Option<u64> {
    message.get("id").and_then(Value::as_u64)
}

fn rpc_error(message: &Value) -> Option<String> {
    let error = message.get("error")?;
    deep_string(Some(error), &["message", "error"]).or_else(|| Some(error.to_string()))
}

fn is_server_request(message: &Value) -> bool {
    message.get("id").is_some() && message.get("method").and_then(Value::as_str).is_some()
}

fn extract_thread_id(result: &Value) -> Option<String> {
    deep_string(Some(result), &["threadId", "id"]).or_else(|| {
        result
            .get("thread")
            .and_then(|thread| deep_string(Some(thread), &["id", "threadId"]))
    })
}

fn extract_turn_id(result: &Value) -> Option<String> {
    deep_string(Some(result), &["turnId", "id"]).or_else(|| {
        result
            .get("turn")
            .and_then(|turn| deep_string(Some(turn), &["id", "turnId"]))
    })
}

fn extract_model(value: &Value) -> Option<String> {
    deep_string(
        Some(value),
        &["model", "modelSlug", "model_slug", "modelId", "model_id"],
    )
    .map(|model| model.trim().to_string())
    .filter(|model| !model.is_empty())
}

fn extract_turn_usage(value: &Value) -> Option<TurnUsage> {
    if let Some(usage) = value.get("tokenUsage").or_else(|| value.get("token_usage")) {
        if let Some(parsed) = parse_turn_usage(usage) {
            return Some(parsed);
        }
    }
    if value.get("method").and_then(Value::as_str) == Some("thread/tokenUsage/updated") {
        return value.get("params").and_then(extract_turn_usage);
    }
    value
        .as_object()
        .and_then(|object| object.values().find_map(extract_turn_usage))
}

fn parse_turn_usage(value: &Value) -> Option<TurnUsage> {
    let object = value.as_object()?;
    let window = object
        .get("modelContextWindow")
        .or_else(|| object.get("model_context_window"))
        .and_then(value_as_u64);
    let last = object
        .get("last")
        .or_else(|| object.get("last_token_usage"));
    let context_used = last
        .and_then(|last| {
            last.get("totalTokens")
                .or_else(|| last.get("total_tokens"))
                .and_then(value_as_u64)
        })
        .or_else(|| {
            object
                .get("contextUsed")
                .or_else(|| object.get("context_used"))
                .and_then(value_as_u64)
        });
    if context_used.is_none() && window.is_none() {
        return None;
    }
    Some(TurnUsage {
        context_used,
        context_window: window,
    })
}

fn value_as_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|value| u64::try_from(value).ok()))
}

fn extract_completed_agent_text(message: &Value) -> Option<String> {
    let item = message.get("params")?.get("item")?;
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
    if !matches!(
        item_type,
        "agentMessage" | "assistantMessage" | "output_text"
    ) {
        return None;
    }
    deep_string(Some(item), &["text", "content", "output_text"])
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn thread_status_is_idle(message: &Value) -> bool {
    message
        .get("params")
        .and_then(|params| params.get("status"))
        .and_then(|status| status.get("type").or(Some(status)))
        .and_then(Value::as_str)
        == Some("idle")
}

fn deep_string(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(items) = value.as_array() {
        let parts = items
            .iter()
            .filter_map(|item| deep_string(Some(item), keys))
            .collect::<Vec<_>>();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    let object = value.as_object()?;
    for key in keys {
        if let Some(text) = object
            .get(*key)
            .and_then(|value| deep_string(Some(value), keys))
        {
            return Some(text);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};

    #[test]
    fn explicit_custom_cli_keeps_priority_before_automatic_fallbacks() {
        let candidates = assemble_app_server_launch_candidates(
            Some(PathBuf::from("custom-codex")),
            vec![PathBuf::from("cached-codex")],
            Some(PathBuf::from("bundled-codex")),
            Some(PathBuf::from("path-codex")),
        );
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.source)
                .collect::<Vec<_>>(),
            vec!["configured", "desktop-cache", "desktop-bundle", "path"]
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_store_cli_prefers_the_same_version_user_cache() {
        let configured = PathBuf::from(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.814.5517.0_x64__publisher\app\resources\codex.exe",
        );
        let cached =
            PathBuf::from(r"C:\Users\tester\AppData\Local\OpenAI\Codex\bin\hash\codex.exe");
        let candidates = assemble_app_server_launch_candidates(
            Some(configured.clone()),
            vec![cached.clone()],
            Some(configured),
            Some(PathBuf::from(r"C:\Tools\codex.exe")),
        );
        assert_eq!(candidates[0].executable, cached);
        assert_eq!(candidates[0].source, "desktop-cache");
        assert_eq!(candidates[1].source, "configured-store");
        assert_eq!(candidates.len(), 3);
    }

    #[tokio::test]
    async fn app_server_retries_a_second_isolated_cli_after_spawn_failure() {
        let temp = tempfile::tempdir().unwrap();
        let current_test_exe = std::env::current_exe().unwrap();
        let missing = AppServerLaunchCandidate::standard(
            temp.path().join("missing-codex-do-not-create"),
            "missing-test",
        );
        let fake = AppServerLaunchCandidate {
            executable: current_test_exe.clone(),
            arguments: vec![
                OsString::from("connect::app_server::tests::fake_codex_app_server_process"),
                OsString::from("--exact"),
                OsString::from("--ignored"),
                OsString::from("--nocapture"),
                OsString::from("--test-threads=1"),
            ],
            environment: vec![(
                OsString::from("ALUNIXA_X_FAKE_APP_SERVER"),
                OsString::from("1"),
            )],
            source: "fake-test",
        };
        let config = AppServerConfig {
            executable: missing.executable.to_string_lossy().into_owned(),
            work_dir: temp.path().to_path_buf(),
            model: String::new(),
            sandbox: "read-only".to_string(),
        };

        let mut server = CodexAppServer::start_with_candidates(config, vec![missing, fake])
            .await
            .unwrap();
        assert_eq!(PathBuf::from(&server.config.executable), current_test_exe);
        server.close().await;
    }

    #[test]
    #[ignore = "isolated JSON-RPC child used by app-server fallback tests"]
    fn fake_codex_app_server_process() {
        if std::env::var("ALUNIXA_X_FAKE_APP_SERVER").as_deref() != Ok("1") {
            return;
        }
        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout().lock();
        writeln!(stdout).unwrap();
        stdout.flush().unwrap();
        for line in stdin.lock().lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = message.get("id").cloned() else {
                continue;
            };
            let method = message
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let response = match method {
                "initialize" => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {"serverInfo": {"name": "isolated-fake-codex"}}
                }),
                _ => json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {"code": -32601, "message": "method not found"}
                }),
            };
            writeln!(stdout, "{response}").unwrap();
            stdout.flush().unwrap();
        }
    }

    #[test]
    fn extracts_ids_from_current_app_server_shapes() {
        assert_eq!(
            extract_thread_id(&json!({"thread": {"id": "thread-1"}})).as_deref(),
            Some("thread-1")
        );
        assert_eq!(
            extract_turn_id(&json!({"turn": {"id": "turn-1"}})).as_deref(),
            Some("turn-1")
        );
    }

    #[test]
    fn extracts_completed_agent_message_only() {
        let message = json!({
            "method": "item/completed",
            "params": {"item": {"type": "agentMessage", "text": "done"}}
        });
        assert_eq!(
            extract_completed_agent_text(&message).as_deref(),
            Some("done")
        );
        let user = json!({
            "method": "item/completed",
            "params": {"item": {"type": "userMessage", "text": "input"}}
        });
        assert_eq!(extract_completed_agent_text(&user), None);
    }

    #[test]
    fn extracts_current_context_usage_event() {
        let message = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "last": {"totalTokens": 41772},
                    "total": {"totalTokens": 50000},
                    "modelContextWindow": 1000000
                }
            }
        });
        assert_eq!(
            extract_turn_usage(&message),
            Some(TurnUsage {
                context_used: Some(41772),
                context_window: Some(1000000)
            })
        );
    }
}
