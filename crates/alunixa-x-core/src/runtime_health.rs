use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererError {
    pub kind: String,
    pub asset: String,
    pub line: u64,
    pub column: u64,
}

static FIRST_ERRORS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<u16, RendererError>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

pub fn clear_renderer_error(port: u16) {
    if let Ok(mut errors) = FIRST_ERRORS.lock() {
        errors.remove(&port);
    }
}

pub(crate) fn remember_renderer_error(target: &str, event: &Value) {
    let Some(port) = url::Url::parse(target).ok().and_then(|u| u.port()) else {
        return;
    };
    let Some(error) = sanitized_renderer_error(event) else {
        return;
    };
    if let Ok(mut errors) = FIRST_ERRORS.lock() {
        if errors.len() >= 16 && !errors.contains_key(&port) {
            return;
        }
        if let std::collections::hash_map::Entry::Vacant(entry) = errors.entry(port) {
            entry.insert(error.clone());
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.first_renderer_exception",
                serde_json::json!({"stage": "native_renderer", "debugPort": port, "error": error}),
            );
        }
    }
}

fn first_renderer_error(port: u16) -> Option<RendererError> {
    FIRST_ERRORS.lock().ok()?.get(&port).cloned()
}

fn sanitized_renderer_error(event: &Value) -> Option<RendererError> {
    if event.get("method")?.as_str()? != "Runtime.exceptionThrown" {
        return None;
    }
    let details = event.pointer("/params/exceptionDetails")?;
    // Never record exception text/description, argument values, URL queries or local paths.
    let kind = details
        .pointer("/exception/className")
        .and_then(Value::as_str)
        .unwrap_or("Error");
    let kind = if [
        "Error",
        "TypeError",
        "ReferenceError",
        "SyntaxError",
        "RangeError",
        "URIError",
        "EvalError",
        "AggregateError",
    ]
    .contains(&kind)
    {
        kind
    } else {
        "Error"
    };
    let frame = details.pointer("/stackTrace/callFrames/0");
    let url = details
        .get("url")
        .and_then(Value::as_str)
        .or_else(|| frame?.get("url")?.as_str())
        .unwrap_or("");
    let asset = url::Url::parse(url)
        .ok()
        .filter(|u| u.scheme() == "app" && u.host_str() == Some("-"))
        .and_then(|u| u.path().strip_prefix("/assets/").map(ToOwned::to_owned))
        .filter(|s| {
            s.len() <= 128
                && s.ends_with(".js")
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
        .unwrap_or_else(|| "unattributed-script".into());
    Some(RendererError {
        kind: kind.into(),
        asset,
        line: details
            .get("lineNumber")
            .or_else(|| frame?.get("lineNumber"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + 1,
        column: details
            .get("columnNumber")
            .or_else(|| frame?.get("columnNumber"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + 1,
    })
}

pub const RENDERER_HEALTH_SCRIPT: &str = r#"(() => {
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const native = selector => [...document.querySelectorAll(selector)].some(el =>
    !el.closest('[id^="alunixa-"],[class^="alunixa-"],[data-alunixa-x]') && visible(el));
  return {
    readyState: document.readyState,
    hasElectronBridge: !!window.electronBridge,
    hasNativeSurface: native('.ProseMirror[contenteditable="true"],main [contenteditable="true"],[data-testid="composer"],[data-testid="thread-composer"],[data-testid="conversation-turn"]'),
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
        self.ready_state == "complete" && self.has_electron_bridge && self.has_native_surface
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
    pub first_error: Option<RendererError>,
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
        first_error: None,
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
        report.first_error = first_renderer_error(port);
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
                report.reason = if view.ready() && view.adapter_failures > 0 {
                    "原生界面可见，但部分增强适配器失败；模型请求未验证。"
                } else if view.ready() {
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
            let first_error = first_renderer_error(debug_port);
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.native_ui_unconfirmed",
                serde_json::json!({"stage": "native_renderer", "observation": view, "firstError": first_error}),
            );
            if let Some(error) = first_error {
                anyhow::bail!(
                    "原生界面未就绪；首次捕获异常：{}，{}:{}:{}；请查看启动诊断或关闭增强后重试",
                    error.kind,
                    error.asset,
                    error.line,
                    error.column
                );
            }
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
        // An optional adapter failure does not turn a usable native UI into a white screen.
        assert!(view.ready());
    }
    #[tokio::test]
    async fn missing_status_keeps_real_requests_unknown() {
        let report = inspect(None).await;
        assert_eq!(report.model_request, "not_tested");
        assert_eq!(report.app_server, "not_tested");
        assert_eq!(report.helper, "unknown");
    }

    #[test]
    fn first_exception_metadata_never_exposes_messages_tokens_or_paths() {
        let event = serde_json::json!({"method":"Runtime.exceptionThrown","params":{"exceptionDetails":{
            "text":"fixture-secret", "exception":{"className":"TypeError", "description":"fixture-secret"},
            "url":"app://-/assets/app-shared-fixture.js?token=fixture-secret", "lineNumber":4, "columnNumber":8
        }}});
        let value = sanitized_renderer_error(&event).unwrap();
        assert_eq!(value.asset, "app-shared-fixture.js");
        assert_eq!(value.line, 5);
        assert!(!serde_json::to_string(&value).unwrap().contains("secret"));
        let mut external = event;
        external["params"]["exceptionDetails"]["url"] = Value::from("file:///private/secret.js");
        assert_eq!(
            sanitized_renderer_error(&external).unwrap().asset,
            "unattributed-script"
        );
    }
}
