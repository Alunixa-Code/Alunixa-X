use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const RENDERER_HEALTH_SCRIPT: &str = r#"(() => {
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const native = selector => [...document.querySelectorAll(selector)].some(el =>
    !el.closest('[id^="alunixa-"],[class^="alunixa-"],[data-alunixa-x]') && visible(el));
  return {
    readyState: document.readyState,
    hasElectronBridge: !!window.electronBridge,
    hasNativeSurface: native('main [contenteditable="true"],[data-testid="composer"],[data-testid="thread-composer"],[data-testid="conversation-turn"]'),
    loading: native('[role="progressbar"],[data-testid="loading-spinner"],[aria-busy="true"]'),
    adapterFailures: Array.isArray(window.__alunixaXModelPatchFailures) ? window.__alunixaXModelPatchFailures.length : 0,
    rootChildren: (document.getElementById('root') || document.getElementById('app'))?.childElementCount ?? 0
  };
})()"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererHealth {
    pub ready_state: String,
    pub has_electron_bridge: bool,
    pub has_native_surface: bool,
    pub loading: bool,
    pub adapter_failures: usize,
    pub root_children: usize,
}
impl RendererHealth {
    pub fn ready(&self) -> bool {
        self.ready_state == "complete"
            && self.has_electron_bridge
            && self.has_native_surface
            && self.adapter_failures == 0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub checked_at_ms: u64,
    pub cdp: String,
    pub helper: String,
    pub renderer: String,
    pub app_server: String,
    pub model_request: String,
    pub renderer_detail: Option<RendererHealth>,
    pub reason: String,
}

pub async fn probe_renderer(debug_port: u16) -> anyhow::Result<RendererHealth> {
    let targets = crate::cdp::list_targets(debug_port).await?;
    let target = crate::cdp::pick_injectable_codex_page_target(&targets)?;
    let socket = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("CDP target unavailable"))?;
    let reply = tokio::time::timeout(
        Duration::from_secs(4),
        crate::bridge::evaluate_script_with_await_promise(socket, RENDERER_HEALTH_SCRIPT, false),
    )
    .await??;
    serde_json::from_value(
        reply
            .pointer("/result/result/value")
            .cloned()
            .unwrap_or(Value::Null),
    )
    .map_err(|_| anyhow::anyhow!("Codex 原生界面状态无法读取"))
}

pub async fn inspect(status: Option<&crate::status::LaunchStatus>) -> RuntimeHealth {
    let mut report = RuntimeHealth {
        checked_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        cdp: "unknown".into(),
        helper: "unknown".into(),
        renderer: "unknown".into(),
        app_server: "not_tested".into(),
        model_request: "not_tested".into(),
        renderer_detail: None,
        reason: "尚未取得运行时证据。".into(),
    };
    let Some(status) = status else {
        return report;
    };
    if let Some(port) = status.helper_port {
        if let Ok(client) = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
        {
            report.helper = match client
                .get(format!("http://127.0.0.1:{port}/backend/status"))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    match response.json::<Value>().await {
                        Ok(value)
                            if value.get("status").and_then(Value::as_str) == Some("ok")
                                && value.get("transport").and_then(Value::as_str)
                                    == Some("http-helper")
                                && value.get("processId").and_then(Value::as_u64).is_some()
                                && value.get("version").and_then(Value::as_str).is_some() =>
                        {
                            "ready"
                        }
                        _ => "unverified",
                    }
                }
                _ => "unavailable",
            }
            .into();
        }
    }
    if let Some(port) = status.debug_port {
        match probe_renderer(port).await {
            Ok(view) => {
                report.cdp = "ready".into();
                report.renderer = if view.ready() {
                    "ready"
                } else if view.loading {
                    "loading"
                } else {
                    "unverified"
                }
                .into();
                report.reason = if view.ready() {
                    "已确认原生界面可见；app-server 与模型请求未作真实调用验证。"
                } else {
                    "调试端口有响应，但未确认原生界面就绪；可重试或关闭增强后重新启动。"
                }
                .into();
                report.renderer_detail = Some(view);
            }
            Err(_) => {
                report.cdp = "unavailable".into();
                report.reason =
                    "无法连接当前记录的 Codex 调试端口；历史端口记录不代表进程在线。".into();
            }
        }
    }
    report
}

pub async fn wait_for_native_ui(debug_port: u16) -> anyhow::Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let view = probe_renderer(debug_port).await.ok();
        if view.as_ref().is_some_and(RendererHealth::ready) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.native_ui_unconfirmed",
                serde_json::json!({"stage": "native_renderer", "observation": view}),
            );
            anyhow::bail!(
                "原生界面初始化未通过：菜单注入不等于界面可用；请检查启动诊断或关闭增强后重试"
            );
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn port_and_injected_menu_alone_cannot_establish_ui_readiness() {
        let mut view = RendererHealth {
            ready_state: "complete".into(),
            has_electron_bridge: true,
            has_native_surface: false,
            loading: true,
            root_children: 1,
            adapter_failures: 0,
        };
        assert!(!view.ready());
        view.loading = false;
        view.has_native_surface = true;
        assert!(view.ready());
        view.adapter_failures = 1;
        assert!(!view.ready());
    }
    #[tokio::test]
    async fn missing_status_keeps_real_requests_unknown() {
        let report = inspect(None).await;
        assert_eq!(report.model_request, "not_tested");
        assert_eq!(report.app_server, "not_tested");
        assert_eq!(report.helper, "unknown");
    }
}
