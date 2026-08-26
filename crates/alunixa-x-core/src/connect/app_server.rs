use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::mpsc::UnboundedSender;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AppServerProgressKind {
    Status,
    Reasoning,
    Plan,
    WebSearch,
    Command,
    FileChange,
    Tool,
    Collaboration,
    Image,
    Review,
    Compaction,
    Reply,
    Error,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppServerProgressPhase {
    Started,
    Delta,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppServerProgressEvent {
    pub item_id: String,
    pub kind: AppServerProgressKind,
    pub phase: AppServerProgressPhase,
    pub title: String,
    pub detail: String,
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
        self.run_turn_with_progress(thread_id, prompt, None).await
    }

    pub async fn run_turn_with_progress(
        &mut self,
        thread_id: &str,
        prompt: &str,
        progress: Option<UnboundedSender<AppServerProgressEvent>>,
    ) -> anyhow::Result<AppServerTurnResult> {
        emit_progress(
            progress.as_ref(),
            AppServerProgressEvent {
                item_id: "turn".to_string(),
                kind: AppServerProgressKind::Status,
                phase: AppServerProgressPhase::Started,
                title: "Codex 已收到任务".to_string(),
                detail: "正在准备会话并开始处理。".to_string(),
            },
        );
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
                for event in progress_events_from_server_request(&message) {
                    emit_progress(progress.as_ref(), event);
                }
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

            for event in progress_events_from_message(&message) {
                emit_progress(progress.as_ref(), event);
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
                        "item/agentMessage/delta",
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

fn emit_progress(
    sender: Option<&UnboundedSender<AppServerProgressEvent>>,
    event: AppServerProgressEvent,
) {
    if let Some(sender) = sender {
        let _ = sender.send(event);
    }
}

fn progress_events_from_server_request(message: &Value) -> Vec<AppServerProgressEvent> {
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = message.get("params").unwrap_or(&Value::Null);
    let item_id = string_field(params, &["itemId", "item_id"]).unwrap_or_else(|| method.into());
    let (title, detail) = match method {
        "item/commandExecution/requestApproval" => (
            "命令请求授权".to_string(),
            "微信连接使用 approvalPolicy=never，已自动拒绝该授权请求。".to_string(),
        ),
        "item/fileChange/requestApproval" => (
            "文件修改请求授权".to_string(),
            "微信连接使用 approvalPolicy=never，已自动拒绝该授权请求。".to_string(),
        ),
        "item/permissions/requestApproval" => (
            "权限请求".to_string(),
            "微信连接不会扩大权限，已返回空权限集合。".to_string(),
        ),
        "item/tool/requestUserInput" => (
            "工具等待用户输入".to_string(),
            "当前微信桥接不支持结构化输入表单，已返回空答案。".to_string(),
        ),
        "item/tool/call" => (
            "客户端工具调用".to_string(),
            "该客户端工具在微信桥接中不可用，已向 Codex 返回失败。".to_string(),
        ),
        _ => return Vec::new(),
    };
    vec![AppServerProgressEvent {
        item_id,
        kind: AppServerProgressKind::Error,
        phase: AppServerProgressPhase::Failed,
        title,
        detail,
    }]
}

fn progress_events_from_message(message: &Value) -> Vec<AppServerProgressEvent> {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Vec::new();
    };
    let params = message.get("params").unwrap_or(&Value::Null);
    match method {
        "turn/started" => vec![progress_event(
            "turn",
            AppServerProgressKind::Status,
            AppServerProgressPhase::Started,
            "任务开始执行",
            "Codex 已创建本轮任务。",
        )],
        "turn/completed" => {
            let status = deep_string(Some(params), &["type", "status"])
                .unwrap_or_else(|| "completed".to_string());
            let failed = matches!(status.as_str(), "failed" | "interrupted" | "cancelled");
            vec![progress_event(
                "turn",
                if failed {
                    AppServerProgressKind::Error
                } else {
                    AppServerProgressKind::Status
                },
                if failed {
                    AppServerProgressPhase::Failed
                } else {
                    AppServerProgressPhase::Completed
                },
                if failed {
                    "任务执行结束"
                } else {
                    "任务处理完成"
                },
                &format!("状态：{}", translated_status(&status)),
            )]
        }
        "item/started" => params
            .get("item")
            .and_then(|item| progress_event_from_item(item, false))
            .into_iter()
            .collect(),
        "item/completed" => params
            .get("item")
            .and_then(|item| progress_event_from_item(item, true))
            .into_iter()
            .collect(),
        "item/reasoning/summaryTextDelta" => delta_event(
            params,
            AppServerProgressKind::Reasoning,
            "思考摘要",
            "delta",
        ),
        "item/reasoning/summaryPartAdded" => {
            delta_event_with_text(params, AppServerProgressKind::Reasoning, "思考摘要", "\n")
        }
        "item/plan/delta" => delta_event(params, AppServerProgressKind::Plan, "计划更新", "delta"),
        "item/commandExecution/outputDelta" | "command/exec/outputDelta" => {
            delta_event(params, AppServerProgressKind::Command, "命令输出", "delta")
        }
        "item/fileChange/outputDelta" => delta_event(
            params,
            AppServerProgressKind::FileChange,
            "文件修改输出",
            "delta",
        ),
        "item/fileChange/patchUpdated" => {
            let detail = format_file_changes(params.get("changes"));
            if detail.is_empty() {
                Vec::new()
            } else {
                vec![progress_event(
                    &progress_item_id(params),
                    AppServerProgressKind::FileChange,
                    AppServerProgressPhase::Delta,
                    "文件修改更新",
                    &detail,
                )]
            }
        }
        "item/mcpToolCall/progress" => delta_event(
            params,
            AppServerProgressKind::Tool,
            "工具执行进度",
            "message",
        ),
        "error" => {
            let detail = deep_string(Some(params), &["message", "error"])
                .unwrap_or_else(|| "Codex app-server 返回未知错误".to_string());
            vec![progress_event(
                "error",
                AppServerProgressKind::Error,
                AppServerProgressPhase::Failed,
                "Codex 执行错误",
                &detail,
            )]
        }
        _ => Vec::new(),
    }
}

fn progress_event_from_item(item: &Value, completed: bool) -> Option<AppServerProgressEvent> {
    let item_type = item.get("type").and_then(Value::as_str)?;
    if matches!(item_type, "userMessage" | "hookPrompt") {
        return None;
    }
    let id = string_field(item, &["id"]).unwrap_or_else(|| item_type.to_string());
    let status = string_field(item, &["status"]).unwrap_or_default();
    let failed = completed && matches!(status.as_str(), "failed" | "declined" | "interrupted");
    let phase = if failed {
        AppServerProgressPhase::Failed
    } else if completed {
        AppServerProgressPhase::Completed
    } else {
        AppServerProgressPhase::Started
    };
    let (kind, started_title, completed_title, detail) = match item_type {
        "reasoning" => (
            AppServerProgressKind::Reasoning,
            "思考中",
            "思考阶段完成",
            join_string_array(item.get("summary")),
        ),
        "plan" => (
            AppServerProgressKind::Plan,
            "正在制定计划",
            "计划已更新",
            string_field(item, &["text"]).unwrap_or_default(),
        ),
        "webSearch" | "web_search" => (
            AppServerProgressKind::WebSearch,
            "正在搜索网页",
            "网页搜索完成",
            format_web_search(item),
        ),
        "commandExecution" | "command_execution" => (
            AppServerProgressKind::Command,
            "正在执行命令",
            if failed {
                "命令执行失败"
            } else {
                "命令执行完成"
            },
            format_command_item(item, completed),
        ),
        "fileChange" | "file_change" => (
            AppServerProgressKind::FileChange,
            "正在修改文件",
            if failed {
                "文件修改失败"
            } else {
                "文件修改完成"
            },
            format_file_changes(item.get("changes")),
        ),
        "mcpToolCall" | "mcp_tool_call" => (
            AppServerProgressKind::Tool,
            "正在调用 MCP 工具",
            if failed {
                "MCP 工具调用失败"
            } else {
                "MCP 工具调用完成"
            },
            format_mcp_item(item, completed),
        ),
        "dynamicToolCall" | "dynamic_tool_call" => (
            AppServerProgressKind::Tool,
            "正在调用工具",
            if failed {
                "工具调用失败"
            } else {
                "工具调用完成"
            },
            format_dynamic_tool_item(item, completed),
        ),
        "collabAgentToolCall"
        | "collab_agent_tool_call"
        | "subAgentActivity"
        | "sub_agent_activity" => (
            AppServerProgressKind::Collaboration,
            "正在执行 Agent 协作",
            if failed {
                "Agent 协作失败"
            } else {
                "Agent 协作完成"
            },
            format_collaboration_item(item),
        ),
        "imageGeneration" | "image_generation" => (
            AppServerProgressKind::Image,
            "正在生成图片",
            if failed {
                "图片生成失败"
            } else {
                "图片生成完成"
            },
            format_image_generation_item(item),
        ),
        "imageView" | "image_view" => (
            AppServerProgressKind::Image,
            "正在查看图片",
            "图片查看完成",
            string_field(item, &["path"]).unwrap_or_default(),
        ),
        "sleep" => (
            AppServerProgressKind::Status,
            "正在等待",
            "等待完成",
            item.get("durationMs")
                .and_then(Value::as_u64)
                .map(|value| format!("{} 毫秒", value))
                .unwrap_or_default(),
        ),
        "enteredReviewMode" | "entered_review_mode" => (
            AppServerProgressKind::Review,
            "进入审查模式",
            "审查模式已进入",
            string_field(item, &["review"]).unwrap_or_default(),
        ),
        "exitedReviewMode" | "exited_review_mode" => (
            AppServerProgressKind::Review,
            "退出审查模式",
            "审查模式已退出",
            string_field(item, &["review"]).unwrap_or_default(),
        ),
        "contextCompaction" | "context_compaction" => (
            AppServerProgressKind::Compaction,
            "正在压缩上下文",
            "上下文压缩完成",
            String::new(),
        ),
        "agentMessage" | "assistantMessage" | "output_text" => (
            AppServerProgressKind::Reply,
            "正在生成最终回复",
            "最终回复已生成",
            String::new(),
        ),
        _ => (
            AppServerProgressKind::Other,
            "正在执行操作",
            "操作完成",
            format!("类型：{item_type}"),
        ),
    };
    Some(AppServerProgressEvent {
        item_id: id,
        kind,
        phase,
        title: if completed {
            completed_title
        } else {
            started_title
        }
        .to_string(),
        detail: sanitize_progress_text(&detail),
    })
}

fn progress_event(
    item_id: &str,
    kind: AppServerProgressKind,
    phase: AppServerProgressPhase,
    title: &str,
    detail: &str,
) -> AppServerProgressEvent {
    AppServerProgressEvent {
        item_id: item_id.to_string(),
        kind,
        phase,
        title: title.to_string(),
        detail: sanitize_progress_text(detail),
    }
}

fn delta_event(
    params: &Value,
    kind: AppServerProgressKind,
    title: &str,
    field: &str,
) -> Vec<AppServerProgressEvent> {
    let detail = params
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default();
    delta_event_with_text(params, kind, title, detail)
}

fn delta_event_with_text(
    params: &Value,
    kind: AppServerProgressKind,
    title: &str,
    detail: &str,
) -> Vec<AppServerProgressEvent> {
    let detail = sanitize_progress_text(detail);
    if detail.is_empty() {
        return Vec::new();
    }
    vec![AppServerProgressEvent {
        item_id: progress_item_id(params),
        kind,
        phase: AppServerProgressPhase::Delta,
        title: title.to_string(),
        detail,
    }]
}

fn progress_item_id(params: &Value) -> String {
    string_field(params, &["itemId", "item_id", "id"]).unwrap_or_else(|| "progress".to_string())
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

fn join_string_array(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn format_command_item(item: &Value, completed: bool) -> String {
    let mut parts = Vec::new();
    if !completed {
        if let Some(command) = string_field(item, &["command"]) {
            parts.push(format!("命令：{command}"));
        }
        if let Some(cwd) = string_field(item, &["cwd"]) {
            parts.push(format!("目录：{cwd}"));
        }
    } else {
        if let Some(status) = string_field(item, &["status"]) {
            parts.push(format!("状态：{}", translated_status(&status)));
        }
        if let Some(exit_code) = item.get("exitCode").and_then(Value::as_i64) {
            parts.push(format!("退出码：{exit_code}"));
        }
        if let Some(duration) = item.get("durationMs").and_then(Value::as_i64) {
            parts.push(format!("耗时：{duration} ms"));
        }
    }
    parts.join("\n")
}

fn format_file_changes(value: Option<&Value>) -> String {
    let Some(changes) = value.and_then(Value::as_array) else {
        return String::new();
    };
    changes
        .iter()
        .take(24)
        .map(|change| {
            let path = string_field(change, &["path"]).unwrap_or_else(|| "未知文件".to_string());
            let kind = change
                .get("kind")
                .and_then(|kind| kind.get("type").or(Some(kind)))
                .and_then(Value::as_str)
                .unwrap_or("update");
            format!("- {}：{path}", translated_status(kind))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_web_search(item: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(query) = string_field(item, &["query"]) {
        parts.push(format!("查询：{query}"));
    }
    if let Some(action) = item.get("action") {
        if let Some(action_type) = string_field(action, &["type"]) {
            parts.push(format!("操作：{}", translated_status(&action_type)));
        }
        if let Some(url) = string_field(action, &["url"]) {
            parts.push(format!("页面：{url}"));
        }
        if let Some(pattern) = string_field(action, &["pattern"]) {
            parts.push(format!("查找：{pattern}"));
        }
    }
    if let Some(results) = item.get("results").and_then(Value::as_array) {
        for (index, result) in results.iter().take(8).enumerate() {
            let title = string_field(result, &["title", "name"])
                .unwrap_or_else(|| format!("结果 {}", index + 1));
            let url = string_field(result, &["url", "link"]).unwrap_or_default();
            let snippet =
                string_field(result, &["snippet", "description", "text"]).unwrap_or_default();
            let mut line = format!("{}. {title}", index + 1);
            if !url.is_empty() {
                line.push_str(&format!("\n   {url}"));
            }
            if !snippet.is_empty() {
                line.push_str(&format!("\n   {snippet}"));
            }
            parts.push(line);
        }
    }
    parts.join("\n")
}

fn format_mcp_item(item: &Value, completed: bool) -> String {
    let server = string_field(item, &["server"]).unwrap_or_else(|| "MCP".to_string());
    let tool = string_field(item, &["tool"]).unwrap_or_else(|| "tool".to_string());
    let mut parts = vec![format!("工具：{server}/{tool}")];
    if !completed {
        if let Some(arguments) = item.get("arguments") {
            parts.push(format!("参数：{}", safe_json_preview(arguments)));
        }
    } else if let Some(error) = item.get("error") {
        parts.push(format!("错误：{}", safe_json_preview(error)));
    } else if let Some(result) = item.get("result") {
        parts.push(format!("结果：{}", safe_json_preview(result)));
    }
    parts.join("\n")
}

fn format_dynamic_tool_item(item: &Value, completed: bool) -> String {
    let namespace = string_field(item, &["namespace"]).unwrap_or_default();
    let tool = string_field(item, &["tool"]).unwrap_or_else(|| "tool".to_string());
    let full_tool = if namespace.is_empty() {
        tool
    } else {
        format!("{namespace}/{tool}")
    };
    let mut parts = vec![format!("工具：{full_tool}")];
    if !completed {
        if let Some(arguments) = item.get("arguments") {
            parts.push(format!("参数：{}", safe_json_preview(arguments)));
        }
    } else if let Some(content) = item.get("contentItems") {
        parts.push(format!("结果：{}", safe_json_preview(content)));
    }
    parts.join("\n")
}

fn format_collaboration_item(item: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(tool) = string_field(item, &["tool", "kind"]) {
        parts.push(format!("操作：{}", translated_status(&tool)));
    }
    if let Some(model) = string_field(item, &["model"]) {
        parts.push(format!("模型：{model}"));
    }
    if let Some(path) = string_field(item, &["agentPath"]) {
        parts.push(format!("Agent：{path}"));
    }
    if let Some(states) = item.get("agentsStates") {
        parts.push(format!("状态：{}", safe_json_preview(states)));
    }
    parts.join("\n")
}

fn format_image_generation_item(item: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(status) = string_field(item, &["status"]) {
        parts.push(format!("状态：{}", translated_status(&status)));
    }
    if let Some(prompt) = string_field(item, &["revisedPrompt"]) {
        parts.push(format!("优化提示词：{prompt}"));
    }
    if let Some(path) = string_field(item, &["savedPath"]) {
        parts.push(format!("保存位置：{path}"));
    }
    if let Some(failure) = item.get("failure") {
        parts.push(format!("错误：{}", safe_json_preview(failure)));
    }
    parts.join("\n")
}

fn safe_json_preview(value: &Value) -> String {
    fn sanitized(value: &Value) -> Value {
        match value {
            Value::Object(object) => Value::Object(
                object
                    .iter()
                    .map(|(key, value)| {
                        let lower = key.to_ascii_lowercase();
                        let value = if [
                            "token",
                            "secret",
                            "password",
                            "authorization",
                            "cookie",
                            "api_key",
                            "apikey",
                            "access_token",
                            "refresh_token",
                        ]
                        .iter()
                        .any(|needle| lower.contains(needle))
                        {
                            Value::String("[redacted]".to_string())
                        } else {
                            sanitized(value)
                        };
                        (key.clone(), value)
                    })
                    .collect(),
            ),
            Value::Array(values) => Value::Array(values.iter().take(24).map(sanitized).collect()),
            Value::String(value) => Value::String(sanitize_progress_text(value)),
            other => other.clone(),
        }
    }
    sanitize_progress_text(&serde_json::to_string(&sanitized(value)).unwrap_or_default())
}

fn sanitize_progress_text(value: &str) -> String {
    let mut without_ansi = String::new();
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        if !character.is_control() || matches!(character, '\n' | '\r' | '\t') {
            without_ansi.push(character);
        }
    }
    without_ansi
        .lines()
        .map(|line| {
            line.split_whitespace()
                .map(|part| {
                    let lower = part.to_ascii_lowercase();
                    if part.len() > 512
                        || part.starts_with("sk-")
                        || part.starts_with("ghp_")
                        || part.starts_with("github_pat_")
                        || part.starts_with("cfat_")
                        || part.starts_with("eyJ")
                        || lower.contains("access_token=")
                        || lower.contains("refresh_token=")
                        || lower.contains("authorization:")
                        || lower.contains("api_key=")
                        || lower.contains("apikey=")
                        || lower.contains("password=")
                    {
                        "[redacted]".to_string()
                    } else {
                        part.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn translated_status(status: &str) -> &str {
    match status {
        "inProgress" | "in_progress" => "进行中",
        "completed" | "success" => "完成",
        "failed" | "error" => "失败",
        "declined" => "已拒绝",
        "interrupted" | "cancelled" => "已中断",
        "add" => "新增",
        "delete" => "删除",
        "update" => "更新",
        "search" => "搜索",
        "openPage" | "open_page" => "打开网页",
        "findInPage" | "find_in_page" => "页内查找",
        "spawnAgent" | "spawn_agent" => "创建 Agent",
        "sendInput" | "send_input" => "发送输入",
        "sendMessage" | "send_message" => "发送消息",
        "followupTask" | "followup_task" => "追加任务",
        "interruptAgent" | "interrupt_agent" => "中断 Agent",
        "listAgents" | "list_agents" => "列出 Agent",
        "wait" => "等待",
        "closeAgent" | "close_agent" => "关闭 Agent",
        "resumeAgent" | "resume_agent" => "恢复 Agent",
        other => other,
    }
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

    #[tokio::test]
    async fn app_server_streams_visible_progress_from_isolated_fake_process() {
        let temp = tempfile::tempdir().unwrap();
        let fake = AppServerLaunchCandidate {
            executable: std::env::current_exe().unwrap(),
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
            source: "fake-progress-test",
        };
        let config = AppServerConfig {
            executable: fake.executable.to_string_lossy().into_owned(),
            work_dir: temp.path().to_path_buf(),
            model: "gpt-test".to_string(),
            sandbox: "read-only".to_string(),
        };
        let mut server = CodexAppServer::start_with_candidates(config, vec![fake])
            .await
            .unwrap();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let result = server
            .run_turn_with_progress("thread-1", "test progress", Some(sender))
            .await
            .unwrap();
        assert_eq!(result.reply, "fake final reply");
        let mut events = Vec::new();
        while let Ok(event) = receiver.try_recv() {
            events.push(event);
        }
        assert!(events.iter().any(|event| {
            event.kind == AppServerProgressKind::Reasoning
                && event.phase == AppServerProgressPhase::Delta
                && event.detail.contains("检查配置")
        }));
        assert!(events.iter().any(|event| {
            event.kind == AppServerProgressKind::WebSearch
                && event.phase == AppServerProgressPhase::Completed
                && event.detail.contains("Example result")
        }));
        assert!(events.iter().any(|event| {
            event.kind == AppServerProgressKind::Command
                && event.phase == AppServerProgressPhase::Delta
                && event.detail.contains("command output")
        }));
        assert!(events.iter().any(|event| {
            event.kind == AppServerProgressKind::Tool
                && event.phase == AppServerProgressPhase::Completed
                && event.detail.contains("tool result")
        }));
        assert!(events.iter().any(|event| {
            event.kind == AppServerProgressKind::FileChange
                && event.phase == AppServerProgressPhase::Completed
                && event.detail.contains("src/main.rs")
        }));
        assert!(events.iter().any(|event| {
            event.kind == AppServerProgressKind::Status
                && event.phase == AppServerProgressPhase::Completed
        }));
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
            if method == "turn/start" {
                let messages = [
                    json!({"jsonrpc":"2.0","id":id,"result":{"turn":{"id":"turn-1"},"model":"gpt-test"}}),
                    json!({"jsonrpc":"2.0","method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"reasoning","id":"reason-1","summary":[],"content":[]}}}),
                    json!({"jsonrpc":"2.0","method":"item/reasoning/summaryTextDelta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"reason-1","summaryIndex":0,"delta":"正在检查配置"}}),
                    json!({"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"reasoning","id":"reason-1","summary":["检查配置完成"],"content":[]}}}),
                    json!({"jsonrpc":"2.0","method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"webSearch","id":"web-1","query":"Codex docs","action":{"type":"search","query":"Codex docs"},"results":null}}}),
                    json!({"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"webSearch","id":"web-1","query":"Codex docs","action":{"type":"search","query":"Codex docs"},"results":[{"title":"Example result","url":"https://example.test","snippet":"result summary"}]}}}),
                    json!({"jsonrpc":"2.0","method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"commandExecution","id":"cmd-1","command":"echo test","cwd":"C:/workspace","status":"inProgress","commandActions":[],"aggregatedOutput":null,"exitCode":null,"durationMs":null}}}),
                    json!({"jsonrpc":"2.0","method":"item/commandExecution/outputDelta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"cmd-1","delta":"command output\n"}}),
                    json!({"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"commandExecution","id":"cmd-1","command":"echo test","cwd":"C:/workspace","status":"completed","commandActions":[],"aggregatedOutput":"command output\n","exitCode":0,"durationMs":10}}}),
                    json!({"jsonrpc":"2.0","method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"mcpToolCall","id":"tool-1","server":"demo","tool":"lookup","status":"inProgress","arguments":{"query":"safe","api_key":"secret"},"result":null,"error":null}}}),
                    json!({"jsonrpc":"2.0","method":"item/mcpToolCall/progress","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"tool-1","message":"tool working"}}),
                    json!({"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"mcpToolCall","id":"tool-1","server":"demo","tool":"lookup","status":"completed","arguments":{"query":"safe"},"result":{"content":[{"type":"text","text":"tool result"}]},"error":null}}}),
                    json!({"jsonrpc":"2.0","method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"fileChange","id":"patch-1","changes":[{"path":"src/main.rs","kind":{"type":"update"},"diff":"@@"}],"status":"inProgress"}}}),
                    json!({"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"fileChange","id":"patch-1","changes":[{"path":"src/main.rs","kind":{"type":"update"},"diff":"@@"}],"status":"completed"}}}),
                    json!({"jsonrpc":"2.0","method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"agentMessage","id":"msg-1","text":""}}}),
                    json!({"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"agentMessage","id":"msg-1","text":"fake final reply"}}}),
                    json!({"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed","items":[]}}}),
                ];
                for response in messages {
                    writeln!(stdout, "{response}").unwrap();
                }
                stdout.flush().unwrap();
                continue;
            }
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

    #[test]
    fn visible_progress_ignores_raw_reasoning_and_redacts_tool_secrets() {
        assert!(
            progress_events_from_message(&json!({
                "method": "item/reasoning/textDelta",
                "params": {"itemId":"reason-1","delta":"hidden raw reasoning"}
            }))
            .is_empty()
        );
        let event = progress_event_from_item(
            &json!({
                "type":"mcpToolCall",
                "id":"tool-1",
                "server":"demo",
                "tool":"fetch",
                "status":"inProgress",
                "arguments":{"query":"hello","api_key":"sk-secret-value"}
            }),
            false,
        )
        .unwrap();
        assert!(event.detail.contains("hello"));
        assert!(event.detail.contains("[redacted]"));
        assert!(!event.detail.contains("sk-secret-value"));
    }
}
