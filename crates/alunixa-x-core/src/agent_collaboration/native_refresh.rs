//! 管理器固定操作：重新加载已接入的本机 MCP 配置并刷新原生状态缓存。
//! 不接收表达式/RPC 方法，不打开或发送任何会话回合。

use std::collections::HashSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const REFRESH_SCRIPT: &str =
    include_str!("../../../../assets/inject/agent-collaboration-refresh.js");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefreshReport {
    pub status: String,
    pub message: String,
    pub reload_succeeded: bool,
    pub tools_ready: bool,
    pub tool_count: usize,
    pub thread_verified: bool,
    pub cache_refreshed: bool,
}

impl RefreshReport {
    fn unavailable() -> Self {
        Self {
            status: "unavailable".to_string(),
            message: "未找到可安全刷新的已连接 Codex 页面，配置未在此处重读。".to_string(),
            reload_succeeded: false,
            tools_ready: false,
            tool_count: 0,
            thread_verified: false,
            cache_refreshed: false,
        }
    }

    fn uncertain() -> Self {
        Self {
            status: "error".to_string(),
            message: "刷新结果未确认，请稍后检查当前 Codex；未重复发送配置重读请求。".to_string(),
            ..Self::unavailable()
        }
    }
}

/// 候选端口只能来自管理器信任的本机实例记录。最多检查三个不同端口，总等待至多 12 秒。
pub async fn refresh_in_codex(debug_ports: &[u16]) -> RefreshReport {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
    let mut seen = HashSet::new();
    let mut last = RefreshReport::unavailable();
    for port in debug_ports
        .iter()
        .copied()
        .filter(|port| *port != 0 && seen.insert(*port))
        .take(3)
    {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let Ok(Ok(targets)) = tokio::time::timeout(
            remaining.min(Duration::from_millis(900)),
            crate::cdp::list_targets(port),
        )
        .await
        else {
            continue;
        };
        let Ok(target) = crate::cdp::pick_injectable_codex_page_target(&targets) else {
            continue;
        };
        let Some(websocket_url) = target.web_socket_debugger_url.as_deref() else {
            continue;
        };
        if crate::cdp::validate_cdp_websocket_url(websocket_url, port).is_err() {
            continue;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        // 一旦表达式发送出去，断线/超时也不能断言 reload 未执行；不转到另一端口重发。
        let response = match tokio::time::timeout(
            remaining,
            crate::bridge::evaluate_script_with_await_promise(websocket_url, REFRESH_SCRIPT, true),
        )
        .await
        {
            Ok(Ok(response)) => response,
            _ => return RefreshReport::uncertain(),
        };
        let Some(value) = response
            .pointer("/result/result/value")
            .and_then(serde_json::Value::as_str)
        else {
            return RefreshReport::uncertain();
        };
        let Ok(mut report) = serde_json::from_str::<RefreshReport>(value) else {
            return RefreshReport::uncertain();
        };
        if !matches!(
            report.status.as_str(),
            "ready" | "partial" | "unavailable" | "error"
        ) || report.tool_count > 10000
            || (report.status == "ready"
                && (!report.reload_succeeded || !report.tools_ready || !report.cache_refreshed))
        {
            return RefreshReport::uncertain();
        }
        report.message = report
            .message
            .chars()
            .filter(|value| !value.is_control())
            .take(240)
            .collect();
        if report.status == "unavailable" && !report.reload_succeeded {
            last = report;
            continue;
        }
        return report;
    }
    last
}
