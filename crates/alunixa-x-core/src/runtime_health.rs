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
  const nativeElement = el => !el.closest('[id^="alunixa-"],[class^="alunixa-"],[data-alunixa-x]') && visible(el);
  const native = selector => [...document.querySelectorAll(selector)].some(nativeElement);
  const loading = native('[role="progressbar"],[data-testid="loading-spinner"],[aria-busy="true"]');
  const composer = native('.ProseMirror[contenteditable="true"],main [contenteditable="true"],[data-testid="composer"],[data-testid="thread-composer"],[data-testid="conversation-turn"]');
  const shell = native('main,[role="main"],nav,[role="navigation"],aside,[data-testid*="sidebar"],[data-testid*="settings"],[data-testid*="login"]');
  const recoveryLabel = value => /^(try again|retry|重试|再试一次|повторить|попробовать снова)$/i.test((value || '').replace(/\s+/g, ' ').trim());
  const recoveryAction = [...document.querySelectorAll('button,[role="button"]')].some(el =>
    nativeElement(el) && (recoveryLabel(el.getAttribute('aria-label')) || recoveryLabel(el.textContent)));

  return {
    readyState: document.readyState,
    hasElectronBridge: !!window.electronBridge,
    hasNativeSurface: !recoveryAction && (composer || (shell && !loading)),
    loading,
    adapterFailures: Array.isArray(window.__alunixaXModelPatchFailures) ? window.__alunixaXModelPatchFailures.length : 0,
    rootChildren: (document.getElementById('root') || document.getElementById('app'))?.childElementCount ?? 0
  };
})()"#;

// Uses the preload IPC contract, not an AX injection global or a dynamically
// imported app module (either can be unavailable during a native white screen).
// Only enum metadata leaves the renderer; never return error text or config.
const LOCAL_APP_SERVER_RECOVERY_SCRIPT: &str = r#"(async () => {
  const bridge = window.electronBridge;
  if (typeof bridge?.sendMessageFromView !== 'function') return JSON.stringify({ status: 'unavailable', state: 'unknown' });
  const marker = '__alunixaXNativeStartupRecovery';
  const runtime = window[marker] ||= { attempted: false, outcome: 'not_requested' };
  const query = () => new Promise(resolve => {
    const requestId = `ax-startup-${globalThis.crypto.randomUUID()}`;
    let timer;
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = event => {
      const message = event?.data;
      if (message?.type !== 'fetch-response' || message.requestId !== requestId) return;
      if (message.responseType !== 'success') return finish(null);
      try { finish(JSON.parse(message.bodyJsonString)); } catch { finish(null); }
    };
    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => finish(null), 2000);
    try {
      Promise.resolve(bridge.sendMessageFromView({
        type: 'fetch', requestId, method: 'POST',
        url: 'vscode://codex/app-server-connection-state',
        body: JSON.stringify({ hostId: 'local' })
      })).catch(() => finish(null));
    } catch { finish(null); }
  });
  const raw = await query();
  const state = ['connected', 'connecting', 'restarting', 'disconnected', 'error'].includes(raw?.state) ? raw.state : 'unknown';
  const code = raw?.error?.code;
  const errorCode = code == null ? null : ['connection-failed', 'restart-required', 'login-required', 'update-required'].includes(code) ? code : 'other';
  const report = status => JSON.stringify({ status, state, errorCode });
  if (state === 'connected') return report('connected');
  // A login/version/config problem is not a stalled transport. Do not loop it.
  if (state === 'unknown' || (errorCode != null && !['connection-failed', 'restart-required'].includes(errorCode))) return report('unavailable');
  if (runtime.attempted) return report(runtime.outcome);
  if (state === 'restarting') return report('already_restarting');
  if (state === 'error' && errorCode == null) return report('unavailable');
  // Claim before invoking IPC, so concurrent checks cannot dispatch twice.
  runtime.attempted = true;
  runtime.outcome = 'requested';
  try {
    Promise.resolve(bridge.sendMessageFromView({
      type: 'codex-app-server-restart', hostId: 'local', intent: 'restart', errorMessage: null
    })).then(() => { runtime.outcome = 'completed'; }, () => { runtime.outcome = 'failed'; });
  } catch { runtime.outcome = 'failed'; }
  return report(runtime.outcome);
})()"#;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRecoveryObservation {
    status: String,
    state: String,
    error_code: Option<String>,
}

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

async fn wait_for_native_ui_until(
    debug_port: u16,
    deadline: tokio::time::Instant,
) -> Option<RendererHealth> {
    wait_for_native_ui_with(deadline, || probe_renderer(debug_port)).await
}

async fn wait_for_native_ui_with<P, F>(
    deadline: tokio::time::Instant,
    mut probe: P,
) -> Option<RendererHealth>
where
    P: FnMut() -> F,
    F: std::future::Future<Output = anyhow::Result<RendererHealth>>,
{
    let mut last_view = None;
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout_at(deadline, probe()).await {
            Ok(Ok(view)) => {
                let ready = view.ready();
                last_view = Some(view);
                if ready {
                    return last_view;
                }
            }
            Ok(Err(_)) => {}
            Err(_) => break,
        }
        tokio::time::sleep_until(
            (tokio::time::Instant::now() + Duration::from_millis(700)).min(deadline),
        )
        .await;
    }
    last_view
}

async fn request_local_app_server_restart(
    debug_port: u16,
) -> anyhow::Result<NativeRecoveryObservation> {
    let targets = crate::cdp::list_targets(debug_port).await?;
    let target = crate::cdp::pick_injectable_codex_page_target(&targets)?;
    let socket = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("CDP target unavailable"))?;
    let reply = tokio::time::timeout(
        Duration::from_secs(6),
        crate::bridge::evaluate_script_with_await_promise(
            socket,
            LOCAL_APP_SERVER_RECOVERY_SCRIPT,
            true,
        ),
    )
    .await??;
    let value = reply
        .pointer("/result/result/value")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("app-server recovery returned no result"))?;
    let result: NativeRecoveryObservation = serde_json::from_str(value)?;
    if ![
        "unavailable",
        "connected",
        "already_restarting",
        "requested",
        "completed",
        "failed",
    ]
    .contains(&result.status.as_str())
        || ![
            "unknown",
            "connected",
            "connecting",
            "restarting",
            "disconnected",
            "error",
        ]
        .contains(&result.state.as_str())
        || result.error_code.as_deref().is_some_and(|code| {
            ![
                "connection-failed",
                "restart-required",
                "login-required",
                "update-required",
                "other",
            ]
            .contains(&code)
        })
    {
        anyhow::bail!("app-server recovery returned invalid metadata");
    }
    Ok(result)
}

pub async fn wait_for_native_ui(debug_port: u16) -> anyhow::Result<()> {
    let initial = wait_for_native_ui_until(
        debug_port,
        tokio::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    if initial.as_ref().is_some_and(RendererHealth::ready) {
        return Ok(());
    }

    let mut observation = None;
    // A renderer exception does not prove the backend is healthy. Probe the
    // actual native connection, and restart only an eligible local transport.
    match tokio::time::timeout(
        Duration::from_secs(8),
        request_local_app_server_restart(debug_port),
    )
    .await
    {
        Ok(Ok(result)) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.local_app_server_recovery_observed",
                serde_json::json!({"stage": "app_server", "observation": result}),
            );
            observation = Some(result);
        }
        _ => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "launcher.local_app_server_restart_unavailable",
                serde_json::json!({"stage": "app_server"}),
            );
        }
    }
    let recovery_attempted = observation.as_ref().is_some_and(|result| {
        matches!(result.status.as_str(), "requested" | "completed" | "failed")
    });
    // Wait even when IPC was unavailable or the backend was already connected:
    // a slowly rendering UI must not be turned into another restart loop.
    let recovered = wait_for_native_ui_until(
        debug_port,
        tokio::time::Instant::now() + Duration::from_secs(25),
    )
    .await;
    if recovered.as_ref().is_some_and(RendererHealth::ready) {
        let _ = crate::diagnostic_log::append_diagnostic_log(
            "launcher.native_ui_recovered",
            serde_json::json!({"stage": "native_renderer", "appServerRecoveryAttempted": recovery_attempted}),
        );
        return Ok(());
    }

    let first_error = first_renderer_error(debug_port);
    let final_view = recovered.or(initial);
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "launcher.native_ui_unconfirmed",
        serde_json::json!({
            "stage": "native_renderer",
            "observation": final_view,
            "firstError": first_error.clone(),
            "appServerRecoveryAttempted": recovery_attempted
        }),
    );
    if let Some(error) = first_error {
        anyhow::bail!(
            "原生界面未就绪；首次捕获异常：{}，{}:{}:{}；Codex 已保留打开，请查看启动诊断后重试",
            error.kind,
            error.asset,
            error.line,
            error.column
        );
    }
    if recovery_attempted {
        anyhow::bail!(
            "已请求 Codex 内置 app-server 重启，但界面仍未确认；窗口已保留，可在原生错误页点击 Try again"
        );
    }
    anyhow::bail!(
        "原生界面尚未确认，未自动重启本地 app-server（已连接、正在重启或状态不支持/无法确认）；窗口已保留，可在原生错误页点击 Try again"
    )
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

    #[tokio::test]
    async fn native_wait_retains_last_observation_at_deadline() {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(20);
        let result = wait_for_native_ui_with(deadline, || async {
            Ok(RendererHealth {
                ready_state: "complete".into(),
                has_electron_bridge: true,
                has_native_surface: false,
                loading: true,
                adapter_failures: 0,
                root_children: 2,
            })
        })
        .await
        .expect("deadline must preserve the last successful non-ready observation");
        assert!(result.loading);
        assert_eq!(result.root_children, 2);
        assert!(!result.ready());
    }

    #[tokio::test]
    async fn native_wait_bounds_a_hanging_probe() {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(20);
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            wait_for_native_ui_with(deadline, || {
                std::future::pending::<anyhow::Result<RendererHealth>>()
            }),
        )
        .await
        .expect("probe must respect the overall deadline");
        assert!(result.is_none());
    }

    #[test]
    fn recovery_uses_native_app_server_restart_without_process_termination() {
        assert!(LOCAL_APP_SERVER_RECOVERY_SCRIPT.contains("app-server-connection-state"));
        assert!(LOCAL_APP_SERVER_RECOVERY_SCRIPT.contains("codex-app-server-restart"));
        assert!(!LOCAL_APP_SERVER_RECOVERY_SCRIPT.contains("__alunixaXRecoverLocalAppServer"));
        assert!(!LOCAL_APP_SERVER_RECOVERY_SCRIPT.contains("TerminateProcess"));
        assert!(!LOCAL_APP_SERVER_RECOVERY_SCRIPT.contains("taskkill"));
    }
}
