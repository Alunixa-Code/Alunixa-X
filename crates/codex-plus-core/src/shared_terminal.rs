use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, anyhow};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::{Mutex, oneshot};

use crate::status::StatusStore;

const MAX_COMMAND_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_LEASE: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedTerminalRequest {
    pub request_id: String,
    pub thread_id: String,
    pub cwd: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedTerminalResult {
    pub request_id: String,
    pub exit_code: i32,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub error: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedTerminalWork {
    #[serde(flatten)]
    pub request: SharedTerminalRequest,
    pub started: bool,
    pub terminal_session_id: Option<String>,
}

struct BrokerEntry {
    request: SharedTerminalRequest,
    response: oneshot::Sender<SharedTerminalResult>,
    lease_until: Option<Instant>,
    started: bool,
    terminal_session_id: Option<String>,
}

#[derive(Default)]
struct BrokerState {
    queue: VecDeque<String>,
    entries: HashMap<String, BrokerEntry>,
}

#[derive(Default)]
pub struct SharedTerminalBroker {
    state: Mutex<BrokerState>,
}

impl SharedTerminalBroker {
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub async fn submit(
        &self,
        request: SharedTerminalRequest,
    ) -> anyhow::Result<SharedTerminalResult> {
        validate_request(&request)?;
        let request_id = request.request_id.clone();
        let (response, receiver) = oneshot::channel();
        {
            let mut state = self.state.lock().await;
            if state.entries.contains_key(&request_id) {
                anyhow::bail!("共享终端请求 ID 重复");
            }
            state.queue.push_back(request_id.clone());
            state.entries.insert(
                request_id,
                BrokerEntry {
                    request,
                    response,
                    lease_until: None,
                    started: false,
                    terminal_session_id: None,
                },
            );
        }
        receiver
            .await
            .map_err(|_| anyhow!("共享终端请求在完成前已关闭"))
    }

    pub async fn next(&self) -> Option<SharedTerminalWork> {
        let mut state = self.state.lock().await;
        reclaim_expired(&mut state);
        while let Some(request_id) = state.queue.pop_front() {
            let Some(entry) = state.entries.get_mut(&request_id) else {
                continue;
            };
            if entry.response.is_closed() {
                state.entries.remove(&request_id);
                continue;
            }
            if entry.lease_until.is_some() {
                continue;
            }
            entry.lease_until = Some(Instant::now() + REQUEST_LEASE);
            return Some(SharedTerminalWork {
                request: entry.request.clone(),
                started: entry.started,
                terminal_session_id: entry.terminal_session_id.clone(),
            });
        }
        None
    }

    pub async fn started(&self, request_id: &str, terminal_session_id: &str) -> anyhow::Result<()> {
        let mut state = self.state.lock().await;
        let entry = state
            .entries
            .get_mut(request_id)
            .context("共享终端请求不存在")?;
        let terminal_session_id = terminal_session_id.trim();
        if terminal_session_id.is_empty() || terminal_session_id.len() > 200 {
            anyhow::bail!("共享终端 session ID 无效");
        }
        entry.started = true;
        entry.terminal_session_id = Some(terminal_session_id.to_string());
        entry.lease_until = Some(Instant::now() + REQUEST_LEASE);
        Ok(())
    }

    pub async fn heartbeat(&self, request_id: &str) -> anyhow::Result<()> {
        let mut state = self.state.lock().await;
        let entry = state
            .entries
            .get_mut(request_id)
            .context("共享终端请求不存在")?;
        entry.lease_until = Some(Instant::now() + REQUEST_LEASE);
        Ok(())
    }

    pub async fn complete(&self, result: SharedTerminalResult) -> anyhow::Result<()> {
        validate_result(&result)?;
        let response = {
            let mut state = self.state.lock().await;
            let entry = state
                .entries
                .remove(&result.request_id)
                .context("共享终端请求不存在或已完成")?;
            state.queue.retain(|queued| queued != &result.request_id);
            entry.response
        };
        let _ = response.send(result);
        Ok(())
    }

    #[cfg(test)]
    async fn pending_count(&self) -> usize {
        self.state.lock().await.entries.len()
    }
}

fn reclaim_expired(state: &mut BrokerState) {
    let now = Instant::now();
    let expired = state
        .entries
        .iter_mut()
        .filter_map(|(request_id, entry)| {
            if entry.response.is_closed() {
                return Some((request_id.clone(), true));
            }
            entry
                .lease_until
                .is_some_and(|lease_until| lease_until <= now)
                .then(|| (request_id.clone(), false))
        })
        .collect::<Vec<_>>();
    for (request_id, closed) in expired {
        if closed {
            state.entries.remove(&request_id);
        } else if let Some(entry) = state.entries.get_mut(&request_id) {
            entry.lease_until = None;
            if !state.queue.contains(&request_id) {
                state.queue.push_back(request_id);
            }
        }
    }
}

fn validate_request(request: &SharedTerminalRequest) -> anyhow::Result<()> {
    if request.request_id.trim().is_empty() || request.request_id.len() > 200 {
        anyhow::bail!("共享终端请求 ID 无效");
    }
    if request.thread_id.trim().is_empty() || request.thread_id.len() > 200 {
        anyhow::bail!("共享终端 thread ID 无效");
    }
    if request.cwd.trim().is_empty() || request.cwd.len() > 32 * 1024 {
        anyhow::bail!("共享终端工作目录无效");
    }
    let command_len = request.command.len();
    if command_len == 0 || command_len > MAX_COMMAND_BYTES {
        anyhow::bail!("共享终端命令为空或超过大小限制");
    }
    Ok(())
}

fn validate_result(result: &SharedTerminalResult) -> anyhow::Result<()> {
    if result.request_id.trim().is_empty() || result.request_id.len() > 200 {
        anyhow::bail!("共享终端完成请求 ID 无效");
    }
    if result.output.len() > MAX_OUTPUT_BYTES || result.error.len() > 64 * 1024 {
        anyhow::bail!("共享终端输出超过大小限制");
    }
    Ok(())
}

pub fn proxy_command(
    launcher_path: &Path,
    request_id: &str,
    thread_id: &str,
    cwd: &str,
    command: &str,
) -> Option<String> {
    if command.trim().is_empty() || thread_id.trim().is_empty() || cwd.trim().is_empty() {
        return None;
    }
    let encode =
        |value: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.as_bytes());
    #[cfg(windows)]
    let executable = format!("\"{}\"", launcher_path.to_string_lossy().replace('"', ""));
    #[cfg(not(windows))]
    let executable = format!(
        "'{}'",
        launcher_path.to_string_lossy().replace('\'', "'\"'\"'")
    );
    Some(format!(
        "{executable} --codex-plus-shared-terminal --request {} --thread {} --cwd {} --command {}",
        encode(request_id),
        encode(thread_id),
        encode(cwd),
        encode(command)
    ))
}

pub fn parse_proxy_request<I, S>(args: I) -> anyhow::Result<SharedTerminalRequest>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut request_id = None;
    let mut thread_id = None;
    let mut cwd = None;
    let mut command = None;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let target = match arg.as_ref() {
            "--request" => &mut request_id,
            "--thread" => &mut thread_id,
            "--cwd" => &mut cwd,
            "--command" => &mut command,
            _ => continue,
        };
        if let Some(value) = args.next() {
            *target = Some(decode_proxy_arg(value.as_ref())?);
        }
    }
    let request = SharedTerminalRequest {
        request_id: request_id.context("共享终端代理缺少 request")?,
        thread_id: thread_id.context("共享终端代理缺少 thread")?,
        cwd: cwd.context("共享终端代理缺少 cwd")?,
        command: command.context("共享终端代理缺少 command")?,
    };
    validate_request(&request)?;
    Ok(request)
}

fn decode_proxy_arg(value: &str) -> anyhow::Result<String> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .context("共享终端代理参数不是有效 Base64URL")?;
    String::from_utf8(bytes).context("共享终端代理参数不是 UTF-8")
}

pub async fn run_proxy(request: SharedTerminalRequest) -> anyhow::Result<SharedTerminalResult> {
    let status = StatusStore::default()
        .load_latest()?
        .context("未找到 Codex++ 启动状态，请用 Codex++ 启动器重新打开 Codex")?;
    if !matches!(status.status.as_str(), "running" | "running_degraded") {
        anyhow::bail!("Codex++ 后端未运行，请用 Codex++ 启动器重新打开 Codex");
    }
    let helper_port = status.helper_port.context("Codex++ Helper 端口不可用")?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()?;
    let response = client
        .post(format!(
            "http://127.0.0.1:{helper_port}/shared-terminal/submit"
        ))
        .json(&request)
        .send()
        .await
        .context("连接 Codex++ 共享终端失败")?;
    let status_code = response.status();
    let body = response
        .bytes()
        .await
        .context("读取 Codex++ 共享终端响应失败")?;
    if !status_code.is_success() {
        let payload = serde_json::from_slice::<Value>(&body).unwrap_or_else(|_| json!({}));
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("共享终端后端请求失败");
        anyhow::bail!(message.to_string());
    }
    serde_json::from_slice(&body).context("解析 Codex++ 共享终端响应失败")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str) -> SharedTerminalRequest {
        SharedTerminalRequest {
            request_id: id.to_string(),
            thread_id: "thread-1".to_string(),
            cwd: "C:/work".to_string(),
            command: "Write-Output ok".to_string(),
        }
    }

    #[tokio::test]
    async fn broker_round_trip_preserves_output_and_exit_code() {
        let broker = SharedTerminalBroker::shared();
        let submitter = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.submit(request("request-1")).await.unwrap() })
        };
        tokio::task::yield_now().await;
        let work = broker.next().await.unwrap();
        assert_eq!(work.request.command, "Write-Output ok");
        broker.started("request-1", "terminal-1").await.unwrap();
        broker.heartbeat("request-1").await.unwrap();
        broker
            .complete(SharedTerminalResult {
                request_id: "request-1".to_string(),
                exit_code: 7,
                output: "hello".to_string(),
                error: String::new(),
            })
            .await
            .unwrap();
        let result = submitter.await.unwrap();
        assert_eq!(result.exit_code, 7);
        assert_eq!(result.output, "hello");
        assert_eq!(broker.pending_count().await, 0);
    }

    #[test]
    fn proxy_command_round_trips_sensitive_characters_without_plaintext() {
        let command = "Write-Output '空 格 & yes?'";
        let wrapped = proxy_command(
            Path::new(r"C:\Program Files\Codex++\codex-plus-plus.exe"),
            "request-1",
            "thread-1",
            r"D:\work dir",
            command,
        )
        .unwrap();
        assert!(!wrapped.contains(command));
        let request = parse_proxy_request(wrapped.split_whitespace().skip(2)).unwrap();
        assert_eq!(request.command, command);
        assert_eq!(request.cwd, r"D:\work dir");
    }
}
