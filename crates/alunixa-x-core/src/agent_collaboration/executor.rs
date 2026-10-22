//! 将协作任务交给原生 CLI；这里只管理我们启动的进程和明确的会话身份。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};

use super::{AgentConfig, MAX_OUTPUT_BYTES, MAX_PROMPT_BYTES, Store, TaskRecord};

const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_STDOUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 2 * 1024 * 1024;
const MAX_ANSWER_BYTES: usize = MAX_OUTPUT_BYTES;
const STDERR_TAIL_BYTES: usize = 8192;
const MAX_PROGRESS_CHARS: usize = 1200;

struct OwnedTask {
    handle: tokio::task::JoinHandle<()>,
    store: Store,
    id: String,
}

#[derive(Default)]
struct OwnedTasks {
    shutting_down: bool,
    tasks: Vec<OwnedTask>,
}

fn owned_tasks() -> &'static Mutex<OwnedTasks> {
    static OWNED: OnceLock<Mutex<OwnedTasks>> = OnceLock::new();
    OWNED.get_or_init(|| Mutex::new(OwnedTasks::default()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Codex,
    Claude,
    DeepSeek,
}

impl Provider {
    fn from_id(id: &str) -> anyhow::Result<Self> {
        match id {
            "codex" => Ok(Self::Codex),
            "claude" => Ok(Self::Claude),
            "deepseek" => Ok(Self::DeepSeek),
            _ => bail!("不支持的协作 Agent：{id}"),
        }
    }
}

/// 只定位可执行文件，不读取登录状态，也不运行检测命令。
pub fn resolve_executable(agent: &AgentConfig) -> Option<PathBuf> {
    let provider = Provider::from_id(&agent.id).ok()?;
    let configured = agent.executable.trim();
    if !configured.is_empty() {
        return resolve_command(configured);
    }

    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        match provider {
            Provider::Codex => {
                for app in ["ChatGPT.app", "Codex.app"] {
                    let resources = PathBuf::from("/Applications")
                        .join(app)
                        .join("Contents/Resources");
                    candidates.push(resources.join("codex-cli/bin/codex"));
                    candidates.push(resources.join("codex-cli/CodexCLI.app/Contents/MacOS/codex"));
                    candidates.push(resources.join("codex"));
                }
            }
            Provider::DeepSeek => candidates.push(PathBuf::from(
                "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
            )),
            Provider::Claude => {}
        }
    }
    let command = match provider {
        Provider::Codex => "codex",
        Provider::Claude => "claude",
        Provider::DeepSeek => "dsh",
    };
    if let Some(home) = directories::BaseDirs::new() {
        candidates.push(home.home_dir().join(".local/bin").join(command));
        candidates.push(home.home_dir().join(".cargo/bin").join(command));
    }
    candidates
        .into_iter()
        .find(|path| is_executable(path))
        .or_else(|| resolve_command(command))
}

fn resolve_command(command: &str) -> Option<PathBuf> {
    if command.contains('\0') {
        return None;
    }
    let path = Path::new(command);
    if path.is_absolute() || command.contains('/') || command.contains('\\') {
        return is_executable(path)
            .then(|| std::fs::canonicalize(path).ok())
            .flatten();
    }
    let search_path = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&search_path) {
        // 桌面进程不能通过空 PATH 项误启动工作目录中的同名文件。
        if !directory.is_absolute() {
            continue;
        }
        let candidate = directory.join(command);
        if is_executable(&candidate) {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let candidate = directory.join(format!("{command}.exe"));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// submit 的调用方在持久化成功后调用；claim 避免多个入口重复执行同一任务。
pub fn spawn_task(store: Store, id: String) {
    // 登记和关闭入口共用一个锁，防止 shutdown 取走列表后又启动漏管的 CLI。
    let mut owned = owned_tasks()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if owned.shutting_down {
        drop(owned);
        let _ = store.finish(
            &id,
            "interrupted",
            "",
            "协作执行进程正在退出，CLI 未启动",
            "",
        );
        return;
    }
    owned.tasks.retain(|task| !task.handle.is_finished());
    let retained_store = store.clone();
    let retained_id = id.clone();
    let handle = tokio::spawn(async move {
        let claimed = match store.claim(&id) {
            Ok(claimed) => claimed,
            Err(_) => {
                let _ = store.finish(&id, "failed", "", "无法认领协作任务，CLI 未启动", "");
                return;
            }
        };
        if !claimed {
            return;
        }
        let outcome = match run_task(&store, &id).await {
            Ok(outcome) => outcome,
            Err(error) => Outcome {
                status: "failed",
                answer: String::new(),
                error: safe_text(&error.to_string(), 1600),
                session_id: String::new(),
            },
        };
        let _ = store.finish(
            &id,
            outcome.status,
            &outcome.answer,
            &outcome.error,
            &outcome.session_id,
        );
    });
    owned.tasks.push(OwnedTask {
        handle,
        store: retained_store,
        id: retained_id,
    });
}

/// 只中止当前进程登记的任务；其他 manager/MCP 进程拥有的任务不受影响。
pub async fn shutdown_owned_tasks() {
    let tasks = {
        let mut owned = owned_tasks()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        owned.shutting_down = true;
        std::mem::take(&mut owned.tasks)
    };
    stop_owned_tasks(tasks).await;
}

async fn stop_owned_tasks(tasks: Vec<OwnedTask>) {
    for task in &tasks {
        task.handle.abort();
    }
    for task in tasks {
        // await 完成意味着 run_task 的 future 已析构，独立进程组 guard 已发送终止信号。
        let _ = task.handle.await;
        let _ = task.store.finish(
            &task.id,
            "interrupted",
            "",
            "协作执行进程已退出，CLI 已终止；请检查工作区中可能已发生的操作",
            "",
        );
    }
}

struct Outcome {
    status: &'static str,
    answer: String,
    error: String,
    session_id: String,
}

async fn run_task(store: &Store, id: &str) -> anyhow::Result<Outcome> {
    let task = store.task(id)?;
    if store.worker_should_stop(id)? {
        return Ok(stopped_outcome(
            &task.session_id,
            "任务已取消或协作功能已关闭",
        ));
    }
    let config = store.config()?;
    let agent = config
        .agents
        .iter()
        .find(|agent| agent.id == task.agent_id && agent.enabled)
        .context("协作 Agent 已停用或不存在")?;
    let provider = Provider::from_id(&agent.id)?;
    let executable =
        resolve_executable(agent).context("未找到原生 CLI，请在协作设置中填写可执行文件路径")?;
    if task.prompt.trim().is_empty() || task.prompt.len() > MAX_PROMPT_BYTES {
        bail!("协作提示词为空或超过 64 KiB 限制");
    }
    let requested_cwd = Path::new(&task.cwd);
    if !requested_cwd.is_absolute() {
        bail!("协作工作目录必须是绝对路径");
    }
    let cwd = requested_cwd
        .canonicalize()
        .context("协作工作目录不存在或不可访问")?;
    if !cwd.is_dir() {
        bail!("协作工作目录不是文件夹");
    }
    if !task.session_id.is_empty() {
        validate_session_id(&task.session_id)?;
    }

    let overlay = if provider == Provider::DeepSeek {
        super::dsh::prepare_overlay(store, &task, agent)?
    } else {
        None
    };
    let mut command = Command::new(executable);
    configure_cli(
        &mut command,
        provider,
        &task.session_id,
        &agent.model,
        overlay.as_deref(),
    );
    command
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::windows_integration::CREATE_NO_WINDOW);
    #[cfg(unix)]
    command.process_group(0);

    let child = command
        .spawn()
        .context("无法启动原生 CLI，请检查路径和执行权限")?;
    let runtime_limit = Duration::from_secs(u64::from(config.max_runtime_minutes) * 60);
    supervise(store, &task, provider, child, runtime_limit).await
}

fn configure_cli(
    command: &mut Command,
    provider: Provider,
    session_id: &str,
    model: &str,
    overlay: Option<&Path>,
) {
    let args = cli_args(provider, session_id, model);
    if let Some(overlay) = overlay.filter(|_| provider == Provider::DeepSeek) {
        // --patch 是 launcher 参数，必须位于 headless 的 --json 之前。
        command
            .args(&args[..2])
            .arg("--patch")
            .arg(overlay)
            .args(&args[2..]);
    } else {
        command.args(args);
    }
}

fn cli_args(provider: Provider, session_id: &str, model: &str) -> Vec<String> {
    let values: Vec<&str> = match provider {
        Provider::Codex if session_id.is_empty() => vec![
            "exec",
            "--json",
            "--color",
            "never",
            "-c",
            "approval_policy=\"never\"",
            "-",
        ],
        Provider::Codex => vec![
            "exec",
            "resume",
            "--json",
            "-c",
            "approval_policy=\"never\"",
            session_id,
            "-",
        ],
        Provider::Claude => {
            let mut args = vec![
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "dontAsk",
            ];
            if !session_id.is_empty() {
                args.extend(["--resume", session_id]);
            }
            args
        }
        Provider::DeepSeek => {
            let mut args = vec!["--profile", "headless", "--json"];
            if !session_id.is_empty() {
                args.extend(["--session-id", session_id]);
            }
            args.push("-");
            args
        }
    };
    let mut args: Vec<String> = values.into_iter().map(str::to_owned).collect();
    if !model.is_empty() && provider != Provider::DeepSeek {
        let position = if provider == Provider::Codex && !session_id.is_empty() {
            2
        } else {
            1
        };
        args.splice(
            position..position,
            ["--model".to_string(), model.to_string()],
        );
    }
    args
}

fn validate_session_id(value: &str) -> anyhow::Result<()> {
    if value.is_empty()
        || value.len() > 200
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        || value.starts_with('-')
    {
        bail!("CLI 返回了无效的会话身份，不能安全续聊");
    }
    Ok(())
}

async fn supervise(
    store: &Store,
    task: &TaskRecord,
    provider: Provider,
    mut child: Child,
    runtime_limit: Duration,
) -> anyhow::Result<Outcome> {
    let mut process_group = ProcessGroup::new(&child);
    let mut stdout = child.stdout.take().context("无法读取 CLI stdout")?;
    let mut stderr = child.stderr.take().context("无法读取 CLI stderr")?;
    let mut stdin = child.stdin.take().context("无法写入 CLI stdin")?;
    let prompt = task.prompt.clone();
    let mut writer = tokio::spawn(async move {
        stdin.write_all(prompt.as_bytes()).await?;
        stdin.shutdown().await
    });
    let mut writer_done = false;
    let mut state = ProtocolState::new(provider, task.session_id.clone());
    let mut pending = Vec::new();
    let mut stdout_buf = [0_u8; 8192];
    let mut stderr_buf = [0_u8; 4096];
    let mut stderr_tail = VecDeque::new();
    let mut stdout_size = 0_usize;
    let mut stderr_size = 0_usize;
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    let mut exit_status = None;
    let deadline = tokio::time::Instant::now() + runtime_limit;
    let mut tick = tokio::time::interval(Duration::from_millis(300));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_touch = Instant::now();
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let mut published_progress = String::new();

    let timeout_message = format!(
        "任务超过 {} 分钟上限，已终止 CLI；可在协作设置中调整运行上限，并检查工作区中可能已完成的操作",
        (runtime_limit.as_secs() / 60).max(1)
    );
    let stop_reason: Option<(&str, &'static str)> = loop {
        if exit_status.is_some() && stdout_closed && stderr_closed {
            break None;
        }
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                break Some((timeout_message.as_str(), "interrupted"));
            }
            _ = tick.tick() => {
                match store.worker_should_stop(&task.id) {
                    Ok(true) => break Some(("任务已取消、Agent 已停用或协作功能已关闭；CLI 已终止", "interrupted")),
                    Ok(false) => {}
                    Err(_) => break Some(("无法读取协作任务控制状态，已停止 CLI", "failed")),
                }
                if last_touch.elapsed() >= Duration::from_secs(10) {
                    if store.touch(&task.id).is_err() {
                        break Some(("无法保存任务心跳，已停止 CLI", "failed"));
                    }
                    last_touch = Instant::now();
                }
                if exit_status.is_none() {
                    match child.try_wait() {
                        Ok(status) => exit_status = status,
                        Err(_) => break Some(("无法取得 CLI 退出状态", "failed")),
                    }
                }
                if !state.progress.is_empty()
                    && state.progress != published_progress
                    && last_progress.elapsed() >= Duration::from_millis(500)
                {
                    if store.update_progress(&task.id, &state.progress).is_err() {
                        break Some(("无法保存任务进度，已停止 CLI", "failed"));
                    }
                    published_progress.clone_from(&state.progress);
                    last_progress = Instant::now();
                }
            }
            result = &mut writer, if !writer_done => {
                writer_done = true;
                if !matches!(result, Ok(Ok(()))) {
                    break Some(("无法将提示词交给 CLI；请检查原生 CLI 是否能够正常启动", "failed"));
                }
            }
            result = stdout.read(&mut stdout_buf), if !stdout_closed => {
                let count = match result {
                    Ok(count) => count,
                    Err(_) => break Some(("读取 CLI 输出失败", "failed")),
                };
                if count == 0 {
                    stdout_closed = true;
                    if !pending.is_empty() {
                        if state.parse_line(&pending).is_err() {
                            break Some(("CLI 输出不是有效的 NDJSON 协议", "failed"));
                        }
                        pending.clear();
                    }
                } else {
                    stdout_size += count;
                    if stdout_size > MAX_STDOUT_BYTES {
                        break Some(("CLI 输出超过 16 MiB 限制，已停止任务", "failed"));
                    }
                    let mut invalid = false;
                    for byte in &stdout_buf[..count] {
                        if *byte == b'\n' {
                            if state.parse_line(&pending).is_err() {
                                invalid = true;
                                break;
                            }
                            pending.clear();
                        } else {
                            pending.push(*byte);
                            if pending.len() > MAX_LINE_BYTES {
                                invalid = true;
                                break;
                            }
                        }
                    }
                    if invalid {
                        break Some(("CLI 输出无效、答案过长或单行超过 1 MiB 限制，已停止任务", "failed"));
                    }
                }
            }
            result = stderr.read(&mut stderr_buf), if !stderr_closed => {
                let count = match result {
                    Ok(count) => count,
                    Err(_) => break Some(("读取 CLI 诊断输出失败", "failed")),
                };
                if count == 0 {
                    stderr_closed = true;
                } else {
                    stderr_size += count;
                    if stderr_size > MAX_STDERR_BYTES {
                        break Some(("CLI 诊断输出超过 2 MiB 限制，已停止任务", "failed"));
                    }
                    stderr_tail.extend(&stderr_buf[..count]);
                    while stderr_tail.len() > STDERR_TAIL_BYTES {
                        stderr_tail.pop_front();
                    }
                }
            }
        }
        if stdout_closed && !state.succeeded && state.failure.is_none() {
            break Some((
                "CLI 输出提前结束，未收到明确完成结果；请检查原生登录和模型配置",
                "failed",
            ));
        }
        if stdout_closed && state.failure.is_some() && exit_status.is_none() {
            // 已无协议输出却仍等待其他交互时，不让 GUI 中的任务一直挂起。
            break Some(("CLI 已报告失败，已停止剩余进程", "failed"));
        }
    };

    writer.abort();
    if !writer_done {
        let _ = writer.await;
    }
    if let Some((reason, status)) = stop_reason {
        terminate(&mut child, &mut process_group).await;
        return Ok(Outcome {
            status,
            answer: String::new(),
            error: state.failure.unwrap_or_else(|| reason.to_owned()),
            session_id: state.session_id,
        });
    }
    // try_wait 已经回收正常退出的进程；错误路径也统一 kill + wait。
    let success_exit = exit_status.is_some_and(|status| status.success());
    if success_exit
        && state.succeeded
        && state.failure.is_none()
        && !state.answer.trim().is_empty()
        && !state.session_id.is_empty()
    {
        process_group.disarm();
        if !state.progress.is_empty() {
            let _ = store.update_progress(&task.id, &state.progress);
        }
        return Ok(Outcome {
            status: "completed",
            answer: state.answer,
            error: String::new(),
            session_id: state.session_id,
        });
    }
    let error = state.failure.unwrap_or_else(|| {
        let diagnostic = String::from_utf8_lossy(stderr_tail.make_contiguous()).to_lowercase();
        if diagnostic.contains("auth") || diagnostic.contains("login") || diagnostic.contains("api key") || diagnostic.contains("sign in") {
            "CLI 未成功完成，请检查原生登录与模型路由。DeepSeek 账户登录可在子 Agent 设置中启用复用 DSH 已保存认证，并指定 deepseek-account 模型路由。".to_owned()
        } else if !success_exit {
            format!("CLI 异常退出（{}），请检查原生登录、模型配置和权限；已执行的工作区操作可能仍然保留", exit_status.map(|status| status.to_string()).unwrap_or_else(|| "未知退出状态".to_owned()))
        } else {
            "CLI 未返回明确成功事件和最终答案，任务结果不确定".to_owned()
        }
    });
    Ok(Outcome {
        status: "failed",
        answer: String::new(),
        error,
        session_id: state.session_id,
    })
}

/// 只管理以 process_group(0) 创建的本次任务组，不向用户现有 CLI/桌面进程发信号。
struct ProcessGroup {
    #[cfg(unix)]
    id: Option<i32>,
    armed: bool,
}

impl ProcessGroup {
    fn new(child: &Child) -> Self {
        #[cfg(not(unix))]
        let _ = child;
        Self {
            #[cfg(unix)]
            id: child
                .id()
                .and_then(|id| i32::try_from(id).ok())
                .filter(|id| *id > 1),
            armed: true,
        }
    }

    fn kill(&self) {
        #[cfg(unix)]
        if self.armed {
            if let Some(id) = self.id {
                unsafe extern "C" {
                    fn kill(pid: i32, signal: i32) -> i32;
                }
                // id 来自本次已创建的独立进程组；负数只指向该组，SIGKILL=9。
                unsafe {
                    kill(-id, 9);
                }
            }
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        self.kill();
    }
}

async fn terminate(child: &mut Child, process_group: &mut ProcessGroup) {
    process_group.kill();
    let _ = child.start_kill();
    let _ = child.wait().await;
    process_group.disarm();
}

fn stopped_outcome(session_id: &str, reason: &str) -> Outcome {
    Outcome {
        status: "interrupted",
        answer: String::new(),
        error: reason.to_owned(),
        session_id: session_id.to_owned(),
    }
}

struct ProtocolState {
    provider: Provider,
    session_id: String,
    answer: String,
    progress: String,
    succeeded: bool,
    failure: Option<String>,
}

impl ProtocolState {
    fn new(provider: Provider, session_id: String) -> Self {
        Self {
            provider,
            session_id,
            answer: String::new(),
            progress: String::new(),
            succeeded: false,
            failure: None,
        }
    }

    fn set_session(&mut self, value: Option<&str>) -> anyhow::Result<()> {
        if let Some(value) = value {
            validate_session_id(value)?;
            if !self.session_id.is_empty() && self.session_id != value {
                bail!("CLI 返回了其他会话身份，停止本次续聊");
            }
            self.session_id = value.to_owned();
        }
        Ok(())
    }

    fn set_answer(&mut self, answer: &str) -> anyhow::Result<()> {
        if answer.len() > MAX_ANSWER_BYTES {
            bail!("CLI 答案超过 256 KiB 限制");
        }
        self.answer = answer.to_owned();
        self.progress = safe_text(answer, MAX_PROGRESS_CHARS);
        Ok(())
    }

    fn parse_line(&mut self, bytes: &[u8]) -> anyhow::Result<()> {
        if bytes.len() > MAX_LINE_BYTES {
            bail!("CLI 协议行过长");
        }
        let text = std::str::from_utf8(bytes)?.trim();
        if text.is_empty() {
            return Ok(());
        }
        // 当前 DSH 账户适配器会把这一条模型列表诊断写入 stdout；其余内容仍须为 NDJSON。
        if self.provider == Provider::DeepSeek && is_deepseek_model_listing_diagnostic(text) {
            return Ok(());
        }
        let event: Value = serde_json::from_str(text)?;
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .context("CLI 事件缺少 type")?;
        match self.provider {
            Provider::Codex => self.codex_event(kind, &event),
            Provider::Claude => self.claude_event(kind, &event),
            Provider::DeepSeek => self.deepseek_event(kind, &event),
        }
    }

    fn codex_event(&mut self, kind: &str, event: &Value) -> anyhow::Result<()> {
        match kind {
            "thread.started" => self.set_session(event.get("thread_id").and_then(Value::as_str))?,
            "item.completed" => {
                if event["item"]["type"] == "agent_message" {
                    let answer = event["item"]["text"]
                        .as_str()
                        .context("Codex 答案缺少 text")?;
                    self.set_answer(answer)?;
                }
            }
            "item.started" => self.progress = "Codex 正在处理工具或文件操作…".to_owned(),
            "turn.completed" => self.succeeded = true,
            "turn.failed" => self.failure = Some(error_text(&event["error"], "Codex 任务失败")),
            "error" => self.failure = Some(error_text(event, "Codex 执行失败")),
            _ => {}
        }
        Ok(())
    }

    fn claude_event(&mut self, kind: &str, event: &Value) -> anyhow::Result<()> {
        // 子 Agent 的流式消息不能替代根会话的身份和答案。
        if event
            .get("parent_tool_use_id")
            .is_some_and(|value| !value.is_null())
        {
            return Ok(());
        }
        self.set_session(event.get("session_id").and_then(Value::as_str))?;
        match kind {
            "assistant" => {
                if let Some(blocks) = event["message"]["content"].as_array() {
                    let mut text = String::new();
                    for block in blocks {
                        if block["type"] == "text" {
                            if let Some(value) = block["text"].as_str() {
                                if text.len().saturating_add(value.len()) > MAX_ANSWER_BYTES {
                                    bail!("Claude 消息过长");
                                }
                                text.push_str(value);
                            }
                        } else if block["type"] == "tool_use" {
                            self.progress = "Claude Code 正在调用工具…".to_owned();
                        }
                    }
                    if !text.is_empty() {
                        self.progress = safe_text(&text, MAX_PROGRESS_CHARS);
                    }
                }
            }
            "result" => {
                if event["subtype"] == "success" && event["is_error"] != true {
                    self.set_answer(
                        event["result"]
                            .as_str()
                            .context("Claude 完成事件缺少 result")?,
                    )?;
                    self.succeeded = true;
                } else {
                    self.failure = Some(error_text(
                        event,
                        "Claude Code 任务失败；请检查原生登录、权限和模型配置",
                    ));
                }
            }
            "error" => self.failure = Some(error_text(event, "Claude Code 执行失败")),
            _ => {}
        }
        Ok(())
    }

    fn deepseek_event(&mut self, kind: &str, event: &Value) -> anyhow::Result<()> {
        match kind {
            "session" => self.set_session(event.get("sessionId").and_then(Value::as_str))?,
            "text" => {
                if let Some(text) = event["text"].as_str() {
                    self.progress = safe_text(text, MAX_PROGRESS_CHARS);
                }
            }
            "tool_call" => self.progress = "DeepSeek Harness 正在调用工具…".to_owned(),
            "status" if event["phase"] == "turn_end" => {
                if event["reason"]["kind"] == "completed" {
                    self.succeeded = true;
                    // 一个活动区间可含子任务唤醒后的多轮；以最后一轮终态为准。
                    self.failure = None;
                } else {
                    self.succeeded = false;
                    self.failure = Some(error_text(
                        &event["reason"]["error"],
                        "DeepSeek Harness 未完成任务",
                    ));
                }
            }
            "final" => self.set_answer(event["text"].as_str().context("DSH 最终事件缺少 text")?)?,
            "error" => self.failure = Some(error_text(event, "DeepSeek Harness 执行失败")),
            _ => {}
        }
        Ok(())
    }
}

fn is_deepseek_model_listing_diagnostic(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("[llm-deepseek-account] model listing from ") else {
        return false;
    };
    let Some((address, counts)) = rest.rsplit_once(" loaded ") else {
        return false;
    };
    let Ok(address) = reqwest::Url::parse(address) else {
        return false;
    };
    if !matches!(address.scheme(), "https" | "http")
        || !address.has_host()
        || !address.username().is_empty()
        || address.password().is_some()
    {
        return false;
    }
    let Some((loaded, skipped)) = counts.split_once(" model(s), skipped ") else {
        return false;
    };
    let Some(skipped) = skipped.strip_suffix(" row(s)") else {
        return false;
    };
    [loaded, skipped].iter().all(|count| {
        !count.is_empty()
            && count.bytes().all(|byte| byte.is_ascii_digit())
            && count.parse::<u64>().is_ok()
    })
}

fn error_text(value: &Value, fallback: &str) -> String {
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| value.get("result").and_then(Value::as_str))
        .or_else(|| {
            value
                .get("errors")
                .and_then(Value::as_array)
                .and_then(|errors| errors.first())
                .and_then(Value::as_str)
        });
    message
        .filter(|text| !text.trim().is_empty())
        .map(|text| safe_text(text, 1600))
        .unwrap_or_else(|| fallback.to_owned())
}

/// 不展示 stderr 原文；协议中的消息仍对常见凭据前缀进行脱敏。
fn safe_text(value: &str, max_chars: usize) -> String {
    let bounded: String = value.chars().take(max_chars).collect();
    let mut output = String::new();
    for piece in bounded.split_inclusive(char::is_whitespace) {
        let lower = piece.to_ascii_lowercase();
        if lower.contains("sk-")
            || lower.contains("api_key=")
            || lower.contains("api-key:")
            || lower.contains("authorization:")
            || lower.starts_with("bearer")
        {
            output.push_str("[凭据已隐藏] ");
        } else {
            output.push_str(piece);
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(state: &mut ProtocolState, event: Value) {
        state
            .parse_line(serde_json::to_string(&event).unwrap().as_bytes())
            .unwrap();
    }

    #[test]
    fn each_provider_requires_its_own_explicit_terminal_contract() {
        let mut codex = ProtocolState::new(Provider::Codex, String::new());
        parse(
            &mut codex,
            serde_json::json!({"type":"thread.started","thread_id":"thread-123"}),
        );
        parse(
            &mut codex,
            serde_json::json!({"type":"item.completed","item":{"type":"agent_message","text":"done"}}),
        );
        assert!(!codex.succeeded);
        parse(
            &mut codex,
            serde_json::json!({"type":"turn.completed","usage":{}}),
        );
        assert!(codex.succeeded);
        assert_eq!(codex.session_id, "thread-123");
        assert_eq!(codex.answer, "done");

        let mut claude = ProtocolState::new(Provider::Claude, String::new());
        parse(
            &mut claude,
            serde_json::json!({"type":"result","subtype":"error_during_execution","is_error":true,"result":"partial","session_id":"claude-123"}),
        );
        assert!(!claude.succeeded);
        assert!(claude.failure.is_some());

        let mut dsh = ProtocolState::new(Provider::DeepSeek, String::new());
        parse(
            &mut dsh,
            serde_json::json!({"type":"session","sessionId":"session-123","cwd":"/tmp"}),
        );
        parse(
            &mut dsh,
            serde_json::json!({"type":"status","phase":"turn_end","reason":{"kind":"error","error":{"message":"denied"}}}),
        );
        parse(
            &mut dsh,
            serde_json::json!({"type":"final","text":"partial answer"}),
        );
        assert!(!dsh.succeeded);
        assert_eq!(dsh.failure.as_deref(), Some("denied"));
    }

    #[test]
    fn claude_child_messages_cannot_replace_root_session_or_answer() {
        let mut state = ProtocolState::new(Provider::Claude, "root-123".to_owned());
        parse(
            &mut state,
            serde_json::json!({"type":"result","session_id":"child-123","parent_tool_use_id":"tool-123","subtype":"success","result":"child"}),
        );
        assert_eq!(state.session_id, "root-123");
        assert!(!state.succeeded);
        parse(
            &mut state,
            serde_json::json!({"type":"result","session_id":"root-123","parent_tool_use_id":null,"subtype":"success","is_error":false,"result":"root"}),
        );
        assert_eq!(state.answer, "root");
        assert!(state.succeeded);
    }

    #[test]
    fn resume_uses_the_exact_session_and_stdin_without_bypass_flags() {
        for provider in [Provider::Codex, Provider::Claude, Provider::DeepSeek] {
            let args = cli_args(provider, "session-123", "");
            assert!(args.iter().any(|arg| arg == "session-123"));
            assert!(
                !args
                    .iter()
                    .any(|arg| arg.contains("dangerous") || arg == "--last" || arg == "--continue")
            );
        }
        assert_eq!(
            cli_args(Provider::Codex, "session-123", "")[..3],
            ["exec", "resume", "--json"]
        );
        assert!(validate_session_id("--last").is_err());
        assert!(validate_session_id("session with space").is_err());
        assert!(validate_session_id("session-123").is_ok());
    }

    #[test]
    fn configured_models_are_single_arguments_and_empty_models_preserve_native_defaults() {
        for provider in [Provider::Codex, Provider::Claude] {
            for session in ["", "session-123"] {
                let original = cli_args(provider, session, "");
                assert!(!original.iter().any(|value| value == "--model"));
                let custom = cli_args(provider, session, "provider/custom model");
                let index = custom.iter().position(|value| value == "--model").unwrap();
                assert_eq!(custom[index + 1], "provider/custom model");
                let mut stripped = custom.clone();
                stripped.drain(index..index + 2);
                assert_eq!(stripped, original);
            }
        }
        assert!(
            !cli_args(Provider::DeepSeek, "", "")
                .iter()
                .any(|value| value == "--model")
        );
    }

    #[test]
    fn deepseek_overlay_is_a_single_launcher_argument_for_new_and_resumed_sessions() {
        let patch = Path::new("/private/task with spaces/overlay.json");
        for session in ["", "session-123"] {
            let mut command = Command::new("dsh");
            configure_cli(
                &mut command,
                Provider::DeepSeek,
                session,
                "deepseek-account/deepseek-flash",
                Some(patch),
            );
            let args: Vec<_> = command
                .as_std()
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert_eq!(
                &args[..5],
                [
                    "--profile",
                    "headless",
                    "--patch",
                    patch.to_str().unwrap(),
                    "--json"
                ]
            );
            assert_eq!(args.last().unwrap(), "-");
            assert!(!args.iter().any(|arg| arg == "--model"));
            if !session.is_empty() {
                assert_eq!(&args[5..7], ["--session-id", session]);
            }
            let mut unpatched = Command::new("dsh");
            configure_cli(&mut unpatched, Provider::DeepSeek, session, "", None);
            assert_eq!(
                unpatched
                    .as_std()
                    .get_args()
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect::<Vec<_>>(),
                cli_args(Provider::DeepSeek, session, "")
            );
        }
    }

    #[test]
    fn only_the_exact_deepseek_account_model_listing_diagnostic_can_bypass_json() {
        let diagnostic = "[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 3 model(s), skipped 0 row(s)";
        let mut dsh = ProtocolState::new(Provider::DeepSeek, "session-123".to_owned());
        dsh.parse_line(diagnostic.as_bytes()).unwrap();
        assert_eq!(dsh.session_id, "session-123");
        assert!(!dsh.succeeded);
        assert!(dsh.answer.is_empty());
        for other in [Provider::Codex, Provider::Claude] {
            assert!(
                ProtocolState::new(other, String::new())
                    .parse_line(diagnostic.as_bytes())
                    .is_err()
            );
        }
        for invalid in [
            "[llm-deepseek-account] something else",
            "[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded bad model(s), skipped 0 row(s)",
            "[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 3 model(s), skipped 0 row(s) extra",
            "[llm-deepseek-account] model listing from file:///models loaded 3 model(s), skipped 0 row(s)",
            "[llm-deepseek-account] model listing from https://user:pass@example.invalid/models loaded 3 model(s), skipped 0 row(s)",
        ] {
            assert!(dsh.parse_line(invalid.as_bytes()).is_err());
        }
        parse(&mut dsh, serde_json::json!({"type":"final","text":"2"}));
        parse(
            &mut dsh,
            serde_json::json!({"type":"status","phase":"turn_end","reason":{"kind":"completed"}}),
        );
        assert!(dsh.succeeded);
        assert_eq!(dsh.answer, "2");
    }

    #[test]
    fn invalid_or_oversized_output_and_changed_identity_are_rejected() {
        let mut state = ProtocolState::new(Provider::DeepSeek, "expected-123".to_owned());
        assert!(state.parse_line(b"not json").is_err());
        assert!(state.parse_line(&vec![b'x'; MAX_LINE_BYTES + 1]).is_err());
        assert!(state.set_answer(&"x".repeat(MAX_ANSWER_BYTES + 1)).is_err());
        assert!(state.set_session(Some("other-123")).is_err());
        assert_eq!(state.session_id, "expected-123");
    }

    #[cfg(unix)]
    fn fixture(script: &str) -> (tempfile::TempDir, Store, TaskRecord, Command) {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::Builder::new()
            .prefix("collaboration fixture ")
            .tempdir()
            .unwrap();
        let executable = directory.path().join("controlled-cli");
        // 测试创建并逐字定义的可控程序，不启动真实 agent，也不读取登录状态。
        std::fs::write(&executable, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let store = Store::new(directory.path().join("state.sqlite3"));
        let mut config = super::super::CollaborationConfig::default();
        config.enabled = true;
        let agent = config
            .agents
            .iter_mut()
            .find(|agent| agent.id == "codex")
            .unwrap();
        agent.enabled = true;
        agent.executable = executable.to_string_lossy().into_owned();
        store.save_config(config).unwrap();
        let task = store
            .submit(super::super::TaskRequest {
                agent_id: "codex".to_owned(),
                prompt: "literal $(do-not-run) `no-command` \" ' $HOME\n第二行".to_owned(),
                cwd: directory.path().to_string_lossy().into_owned(),
                continue_task_id: None,
            })
            .unwrap();
        assert!(store.claim(&task.id).unwrap());
        let mut command = Command::new(executable);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("COLLAB_FIXTURE_STDIN", directory.path().join("input.txt"))
            .env(
                "COLLAB_FIXTURE_MARKER",
                directory.path().join("escaped.txt"),
            )
            .current_dir(directory.path())
            .process_group(0)
            .kill_on_drop(true);
        (directory, store, task, command)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn controlled_cli_receives_literal_stdin_and_nonzero_exit_cannot_succeed() {
        for (exit, expected) in [(0, "completed"), (2, "failed")] {
            let script = format!(
                "/bin/cat > \"$COLLAB_FIXTURE_STDIN\"\nprintf '%s\\n' '{{\"type\":\"thread.started\",\"thread_id\":\"native-123\"}}' '{{\"type\":\"item.completed\",\"item\":{{\"type\":\"agent_message\",\"text\":\"done\"}}}}' '{{\"type\":\"turn.completed\",\"usage\":{{}}}}'\nexit {exit}"
            );
            let (directory, store, task, mut command) = fixture(&script);
            let result = supervise(
                &store,
                &task,
                Provider::Codex,
                command.spawn().unwrap(),
                Duration::from_secs(3),
            )
            .await
            .unwrap();
            assert_eq!(result.status, expected);
            assert_eq!(result.session_id, "native-123");
            assert_eq!(
                std::fs::read_to_string(directory.path().join("input.txt")).unwrap(),
                task.prompt
            );
            if exit == 0 {
                assert_eq!(result.answer, "done");
            } else {
                assert!(result.answer.is_empty());
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_and_cancellation_stop_the_owned_process_group() {
        for cancel in [false, true] {
            let script = "/bin/cat > /dev/null\nprintf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"native-123\"}'\n(/bin/sleep 0.8; printf survived > \"$COLLAB_FIXTURE_MARKER\") &\nwait";
            let (directory, store, task, mut command) = fixture(script);
            let cancel_job = if cancel {
                let store = store.clone();
                let id = task.id.clone();
                Some(tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(30)).await;
                    store.cancel(&id).unwrap();
                }))
            } else {
                None
            };
            let limit = if cancel {
                Duration::from_secs(3)
            } else {
                Duration::from_millis(70)
            };
            let result = tokio::time::timeout(
                Duration::from_secs(2),
                supervise(
                    &store,
                    &task,
                    Provider::Codex,
                    command.spawn().unwrap(),
                    limit,
                ),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(result.status, "interrupted");
            if let Some(job) = cancel_job {
                job.await.unwrap();
            }
            tokio::time::sleep(Duration::from_millis(900)).await;
            assert!(
                !directory.path().join("escaped.txt").exists(),
                "已取消的后代不应继续写工作区"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_kills_owned_group_and_marks_only_its_record_interrupted() {
        let script = "/bin/cat > /dev/null\n(/bin/sleep 0.8; printf survived > \"$COLLAB_FIXTURE_MARKER\") &\nprintf ready > \"$COLLAB_FIXTURE_STDIN\"\nwait";
        let (directory, store, task, mut command) = fixture(script);
        // 另一个执行进程的记录即使在相同测试中存在，也不属于本进程的登记列表。
        let (_other_directory, other_store, other_task, _other_command) = fixture(":");
        let child = command.spawn().unwrap();
        let worker_store = store.clone();
        let worker_task = task.clone();
        let handle = tokio::spawn(async move {
            let outcome = supervise(
                &worker_store,
                &worker_task,
                Provider::Codex,
                child,
                Duration::from_secs(10),
            )
            .await
            .expect("受控 CLI 应持续运行直到退出测试取消它");
            panic!("受控 CLI 提前结束：{}（{}）", outcome.status, outcome.error);
        });
        // 等待 CLI 启动就绪，不把高负载下的进程调度延迟误判为退出清理失败。
        tokio::time::timeout(Duration::from_secs(5), async {
            while !directory.path().join("input.txt").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();

        // 不触碰全局注册表，避免同进程并行测试彼此取消。
        stop_owned_tasks(vec![OwnedTask {
            handle,
            store: store.clone(),
            id: task.id.clone(),
        }])
        .await;
        assert_eq!(store.task(&task.id).unwrap().status, "interrupted");
        assert_eq!(other_store.task(&other_task.id).unwrap().status, "running");
        assert!(store.config().unwrap().enabled);
        tokio::time::sleep(Duration::from_millis(900)).await;
        assert!(
            !directory.path().join("escaped.txt").exists(),
            "退出后登记的子进程组不能继续写文件"
        );
    }
}
