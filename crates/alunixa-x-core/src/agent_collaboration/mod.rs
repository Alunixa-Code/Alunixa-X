//! 本机 CLI 协作记录。每次状态转换均在 SQLite 写事务中完成；读取不会启动 agent。

mod dsh;
pub mod executor;
pub mod integration;
pub mod mcp;
pub mod native_refresh;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, bail};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const MAX_PROMPT_BYTES: usize = 64 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_TASKS: usize = 1000;
const WORKER_LEASE_MS: u64 = 30 * 1000;
const QUEUED_LEASE_MS: u64 = 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub enabled: bool,
    /// 空值沿用原生 CLI 的模型配置，不修改供应商配置。
    #[serde(default)]
    pub model: String,
    /// 仅 DSH 可选择由原生 CLI 复用已保存的认证，本工具不保存凭据。
    #[serde(default, skip_serializing_if = "is_false")]
    pub reuse_saved_auth: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// DSH 的临时模型配置需要同时指定供应商与模型，不能推测桌面当前选中的路由。
pub(super) fn parse_deepseek_model(value: &str) -> anyhow::Result<Option<(&str, &str)>> {
    if value.is_empty() {
        return Ok(None);
    }
    let (provider, model) = value
        .split_once('/')
        .context("DeepSeek 模型路由必须为 provider/model；留空沿用 headless 默认模型")?;
    if provider.is_empty()
        || !provider
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || model.is_empty()
        || model.starts_with('-')
        || model.chars().any(char::is_control)
    {
        bail!("DeepSeek 模型路由格式无效，需填写有效的 provider/model");
    }
    Ok(Some((provider, model)))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollaborationConfig {
    pub enabled: bool,
    #[serde(default = "default_agent_id")]
    pub default_agent_id: String,
    pub agents: Vec<AgentConfig>,
}

fn default_agent_id() -> String {
    "deepseek".to_string()
}

impl Default for CollaborationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            default_agent_id: default_agent_id(),
            agents: [
                ("codex", "Codex"),
                ("deepseek", "DeepSeek Harness"),
                ("claude", "Claude Code"),
            ]
            .into_iter()
            .map(|(id, name)| AgentConfig {
                id: id.to_string(),
                name: name.to_string(),
                executable: String::new(),
                enabled: false,
                model: String::new(),
                reuse_saved_auth: false,
            })
            .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskRequest {
    pub agent_id: String,
    pub prompt: String,
    pub cwd: String,
    #[serde(default)]
    pub continue_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub agent_id: String,
    pub prompt: String,
    pub cwd: String,
    pub status: String,
    pub answer: String,
    pub error: String,
    pub session_id: String,
    pub parent_task_id: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub cancel_requested: bool,
    pub progress: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct State {
    config: CollaborationConfig,
    tasks: Vec<TaskRecord>,
}

#[derive(Debug, Clone)]
pub struct Store {
    path: PathBuf,
}

impl Default for Store {
    fn default() -> Self {
        Self::new(crate::paths::default_app_state_dir().join("agent-collaboration.sqlite3"))
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

pub fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled" | "interrupted")
}

impl Store {
    /// path 是独立的协作 SQLite 文件，不是 Codex 的会话或凭据数据库。
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn connect(&self) -> anyhow::Result<Connection> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent).context("无法创建协作记录目录")?;
        }
        if std::fs::symlink_metadata(&self.path)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            bail!("协作状态文件不能是符号链接");
        }
        // 首次创建即使用私有权限，避免任务提示词短暂暴露在默认可读文件中。
        let mut options = std::fs::OpenOptions::new();
        options.create(true).read(true).write(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        drop(options.open(&self.path).context("无法打开协作记录")?);
        let connection = Connection::open(&self.path).context("无法连接协作数据库")?;
        connection.busy_timeout(Duration::from_secs(10))?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS collaboration_state (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 payload TEXT NOT NULL
             );",
        )?;
        Ok(connection)
    }

    fn with_state<T>(
        &self,
        change: impl FnOnce(&mut State) -> anyhow::Result<T>,
    ) -> anyhow::Result<T> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let payload: Option<String> = transaction
            .query_row(
                "SELECT payload FROM collaboration_state WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let mut state: State = match payload.as_deref() {
            Some(payload) => {
                serde_json::from_str(payload).context("协作记录损坏，未覆盖现有数据")?
            }
            None => State::default(),
        };
        expire_abandoned_tasks(&mut state);
        let result = change(&mut state)?;
        let updated = serde_json::to_string(&state)?;
        // 状态轮询仍经同一事务读取，但内容未变时不反复重写完整任务记录。
        if payload.as_deref() != Some(updated.as_str()) {
            transaction.execute(
                "INSERT INTO collaboration_state(id, payload) VALUES(1, ?1)
                 ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
                params![updated],
            )?;
        }
        transaction.commit()?;
        Ok(result)
    }

    pub fn config(&self) -> anyhow::Result<CollaborationConfig> {
        self.with_state(|state| Ok(state.config.clone()))
    }

    pub fn save_config(&self, config: CollaborationConfig) -> anyhow::Result<CollaborationConfig> {
        let config = normalize_config(config)?;
        self.with_state(|state| {
            for task in &mut state.tasks {
                if !is_terminal(&task.status)
                    && (!config.enabled
                        || !config
                            .agents
                            .iter()
                            .any(|agent| agent.id == task.agent_id && agent.enabled))
                {
                    task.cancel_requested = true;
                    task.updated_at_ms = now_ms();
                    if task.status == "queued" {
                        task.status = "cancelled".to_string();
                        task.progress = "协作已关闭，任务未启动".to_string();
                    }
                }
            }
            state.config = config;
            Ok(state.config.clone())
        })
    }

    pub fn snapshot(&self) -> anyhow::Result<Value> {
        self.with_state(|state| {
            let availability: Vec<Value> = state
                .config
                .agents
                .iter()
                .map(|agent| {
                    let path = executor::resolve_executable(agent);
                    json!({"id": agent.id, "available": path.is_some(),
                    "path": path.map(|path| path.to_string_lossy().into_owned())})
                })
                .collect();
            let mut tasks = state.tasks.clone();
            tasks.sort_by(|left, right| {
                is_terminal(&left.status)
                    .cmp(&is_terminal(&right.status))
                    .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
                    .then_with(|| right.id.cmp(&left.id))
            });
            let active_count = tasks
                .iter()
                .filter(|task| !is_terminal(&task.status))
                .count();
            tasks.truncate(50.max(active_count));
            Ok(
                json!({"config": state.config, "availability": availability, "tasks": tasks,
                "capabilities": {"cliTasks": true, "desktopSessionWake": false}}),
            )
        })
    }

    pub fn submit(&self, request: TaskRequest) -> anyhow::Result<TaskRecord> {
        if request.prompt.trim().is_empty()
            || request.prompt.len() > MAX_PROMPT_BYTES
            || request.prompt.contains('\0')
        {
            bail!("任务内容不能为空，且不能超过 64 KiB 或包含空字符");
        }
        if !matches!(request.agent_id.as_str(), "codex" | "deepseek" | "claude") {
            bail!("不支持的 agent；仅支持 codex、deepseek、claude");
        }
        let path = Path::new(&request.cwd);
        if !path.is_absolute() || !path.is_dir() {
            bail!("工作目录必须是已存在的绝对目录");
        }
        let cwd = std::fs::canonicalize(path).context("无法确认任务工作目录")?;
        let cwd = cwd
            .to_str()
            .context("工作目录必须是有效 UTF-8 路径")?
            .to_string();
        self.with_state(|state| {
            if !state.config.enabled {
                bail!("请先在 Alunixa X 中开启 agent 协作");
            }
            let agent = state
                .config
                .agents
                .iter()
                .find(|agent| agent.id == request.agent_id && agent.enabled)
                .context("此 agent 尚未启用")?;
            executor::resolve_executable(agent).context("未找到此 agent 的 CLI 可执行文件")?;
            if state.tasks.len() >= MAX_TASKS {
                bail!("协作记录已达到 1000 条上限，请使用新的协作状态文件");
            }
            if state
                .tasks
                .iter()
                .any(|task| task.agent_id == request.agent_id && !is_terminal(&task.status))
            {
                bail!("此 agent 已有排队或运行中的任务，请等待结束后再提交");
            }
            let (parent_task_id, session_id) =
                if let Some(parent_id) = request.continue_task_id.as_deref() {
                    let parent = state
                        .tasks
                        .iter()
                        .find(|task| task.id == parent_id)
                        .context("找不到要继续的任务")?;
                    if parent.agent_id != request.agent_id || parent.cwd != cwd {
                        bail!("续聊必须使用同一个 agent 和工作目录");
                    }
                    if parent.status != "completed" || parent.session_id.is_empty() {
                        bail!("只能继续有原生会话 ID 的已完成任务");
                    }
                    if state.tasks.iter().any(|task| {
                        task.agent_id == parent.agent_id
                            && task.session_id == parent.session_id
                            && !is_terminal(&task.status)
                    }) {
                        bail!("此原生会话已有待执行或运行中的任务，请等待其结束");
                    }
                    (Some(parent.id.clone()), parent.session_id.clone())
                } else {
                    (None, String::new())
                };
            let timestamp = now_ms();
            let task = TaskRecord {
                id: uuid::Uuid::new_v4().to_string(),
                agent_id: request.agent_id,
                prompt: request.prompt,
                cwd,
                status: "queued".to_string(),
                answer: String::new(),
                error: String::new(),
                session_id,
                parent_task_id,
                created_at_ms: timestamp,
                updated_at_ms: timestamp,
                cancel_requested: false,
                progress: "等待启动 CLI".to_string(),
            };
            state.tasks.push(task.clone());
            Ok(task)
        })
    }

    pub fn task(&self, id: &str) -> anyhow::Result<TaskRecord> {
        self.with_state(|state| Ok(find_task(state, id)?.clone()))
    }

    /// 事务内竞争唯一执行权，重复 spawn 不会重复运行同一任务。
    pub fn claim(&self, id: &str) -> anyhow::Result<bool> {
        self.with_state(|state| {
            let enabled = state.config.enabled
                && state.config.agents.iter().any(|agent| {
                    agent.enabled
                        && state
                            .tasks
                            .iter()
                            .any(|task| task.id == id && task.agent_id == agent.id)
                });
            let task = find_task(state, id)?;
            if task.status != "queued" || task.cancel_requested || !enabled {
                return Ok(false);
            }
            task.status = "running".to_string();
            task.progress = "正在启动 CLI".to_string();
            task.updated_at_ms = now_ms();
            Ok(true)
        })
    }

    pub fn update_progress(&self, id: &str, text: &str) -> anyhow::Result<()> {
        self.with_state(|state| {
            let task = find_task(state, id)?;
            if !is_terminal(&task.status) {
                task.progress = bounded_text(text, 4096);
                task.updated_at_ms = now_ms();
            }
            Ok(())
        })
    }

    pub fn finish(
        &self,
        id: &str,
        status: &str,
        answer: &str,
        error: &str,
        session_id: &str,
    ) -> anyhow::Result<TaskRecord> {
        if !is_terminal(status) {
            bail!("任务结束状态无效");
        }
        if session_id.len() > 512 || session_id.chars().any(|value| value.is_control()) {
            bail!("CLI 会话 ID 格式无效");
        }
        self.with_state(|state| {
            let task = find_task(state, id)?;
            // 完成和取消并发时保留已提交的终态；取消一旦进入事务就不能被完成覆盖。
            if !is_terminal(&task.status) {
                let oversized = answer.len() > MAX_OUTPUT_BYTES;
                task.status = if task.cancel_requested {
                    "cancelled"
                } else if oversized {
                    "failed"
                } else {
                    status
                }
                .to_string();
                task.answer = if oversized {
                    String::new()
                } else {
                    answer.to_string()
                };
                task.error = if oversized {
                    "CLI 输出超过 256 KiB 上限，未保存不完整结果。".to_string()
                } else {
                    bounded_text(error, 8192)
                };
                if !session_id.is_empty() {
                    task.session_id = session_id.to_string();
                }
                task.updated_at_ms = now_ms();
                task.progress = match task.status.as_str() {
                    "completed" => "任务已完成",
                    "cancelled" => "任务已取消",
                    _ => "任务失败",
                }
                .to_string();
            }
            Ok(task.clone())
        })
    }

    pub fn cancel(&self, id: &str) -> anyhow::Result<TaskRecord> {
        self.with_state(|state| {
            let task = find_task(state, id)?;
            if !is_terminal(&task.status) {
                task.cancel_requested = true;
                task.updated_at_ms = now_ms();
                if task.status == "queued" {
                    task.status = "cancelled".to_string();
                    task.progress = "任务尚未启动，已取消".to_string();
                } else {
                    task.progress = "正在停止 CLI；已发生的操作不会撤销".to_string();
                }
            }
            Ok(task.clone())
        })
    }

    pub fn worker_should_stop(&self, id: &str) -> anyhow::Result<bool> {
        self.with_state(|state| {
            let task = state
                .tasks
                .iter()
                .find(|task| task.id == id)
                .context("找不到协作任务")?;
            Ok(task.cancel_requested
                || is_terminal(&task.status)
                || !state.config.enabled
                || !state
                    .config
                    .agents
                    .iter()
                    .any(|agent| agent.id == task.agent_id && agent.enabled))
        })
    }

    pub fn touch(&self, id: &str) -> anyhow::Result<()> {
        self.with_state(|state| {
            let task = find_task(state, id)?;
            if !is_terminal(&task.status) {
                task.updated_at_ms = now_ms();
            }
            Ok(())
        })
    }
}

fn find_task<'a>(state: &'a mut State, id: &str) -> anyhow::Result<&'a mut TaskRecord> {
    state
        .tasks
        .iter_mut()
        .find(|task| task.id == id)
        .context("找不到协作任务")
}

fn normalize_config(config: CollaborationConfig) -> anyhow::Result<CollaborationConfig> {
    let mut normalized = CollaborationConfig::default();
    normalized.enabled = config.enabled;
    normalized.default_agent_id = config.default_agent_id.trim().to_string();
    if !matches!(
        normalized.default_agent_id.as_str(),
        "codex" | "deepseek" | "claude"
    ) {
        bail!("默认子 Agent 必须是 Codex、DeepSeek Harness 或 Claude Code");
    }
    let mut seen = std::collections::HashSet::new();
    for mut agent in config.agents {
        if !seen.insert(agent.id.clone()) {
            bail!("agent 配置不能重复");
        }
        let target = normalized
            .agents
            .iter_mut()
            .find(|value| value.id == agent.id)
            .context("不支持的 agent 配置")?;
        agent.name = agent.name.trim().to_string();
        agent.executable = agent.executable.trim().to_string();
        agent.model = agent.model.trim().to_string();
        if agent.id != "deepseek" && agent.reuse_saved_auth {
            bail!("仅 DeepSeek Harness 支持复用 DSH 已保存的认证");
        }
        if agent.name.len() > 160 || agent.name.chars().any(|value| value.is_control()) {
            bail!("agent 名称格式无效");
        }
        if agent.executable.len() > 4096 || agent.executable.chars().any(|value| value.is_control())
        {
            bail!("CLI 路径格式无效");
        }
        if !agent.executable.is_empty() && !Path::new(&agent.executable).is_absolute() {
            bail!("CLI 只能填写绝对可执行文件路径；留空自动探测，不能包含参数或 shell 表达式");
        }
        if agent.model.len() > 256
            || agent.model.starts_with('-')
            || agent.model.chars().any(char::is_control)
        {
            bail!("模型名称格式无效，不能超过 256 字节或包含控制字符");
        }
        if agent.id == "deepseek" {
            parse_deepseek_model(&agent.model)?;
        }
        if agent.name.is_empty() {
            agent.name.clone_from(&target.name);
        }
        *target = agent;
    }
    Ok(normalized)
}

fn bounded_text(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn expire_abandoned_tasks(state: &mut State) {
    let timestamp = now_ms();
    for task in &mut state.tasks {
        let lease = if task.status == "queued" {
            QUEUED_LEASE_MS
        } else {
            WORKER_LEASE_MS
        };
        if !is_terminal(&task.status) && timestamp.saturating_sub(task.updated_at_ms) > lease {
            task.status = if task.cancel_requested {
                "cancelled"
            } else {
                "interrupted"
            }
            .to_string();
            task.error =
                "执行进程已失联；任务结果不确定，请先检查工作目录，不会自动重试。".to_string();
            task.progress = "执行进程已失联".to_string();
            task.updated_at_ms = timestamp;
        }
    }
}
