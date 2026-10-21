use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static PROXIED_CLIENTS: OnceLock<Mutex<HashMap<String, reqwest::Client>>> = OnceLock::new();
const MAX_PROXIED_CLIENTS: usize = 64;

pub fn proxied_client(user_agent: &str) -> anyhow::Result<reqwest::Client> {
    let ua = if user_agent.trim().is_empty() {
        format!("AlunixaX/{}", env!("CARGO_PKG_VERSION"))
    } else {
        user_agent.trim().to_string()
    };
    let clients = PROXIED_CLIENTS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut clients = clients
        .lock()
        .map_err(|_| anyhow::anyhow!("HTTP client cache lock poisoned"))?;
    if let Some(client) = clients.get(&ua) {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .pool_max_idle_per_host(16)
        .user_agent(&ua)
        .build()?;
    if clients.len() >= MAX_PROXIED_CLIENTS {
        clients.clear();
    }
    clients.insert(ua, client.clone());
    Ok(client)
}

/// VLM 专用 HTTP client（带超时）。
/// 不复用通用 proxied_client，避免 VLM 服务无响应时永久阻塞整个代理。
pub fn vlm_http_client() -> anyhow::Result<reqwest::Client> {
    vlm_http_client_with_timeout(
        std::time::Duration::from_secs(5),
        std::time::Duration::from_secs(30),
    )
}

pub(crate) fn vlm_http_client_with_timeout(
    connect: std::time::Duration,
    total: std::time::Duration,
) -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(format!("AlunixaX-VLM/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect)
        .timeout(total)
        .build()?)
}
