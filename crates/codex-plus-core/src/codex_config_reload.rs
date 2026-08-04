use std::time::Duration;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::settings::{BackendSettings, SettingsStore};
use crate::status::{LaunchStatus, StatusStore};

const RELOAD_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeModelApplyResult {
    pub debug_port: u16,
    pub helper_port: u16,
    pub selected_model: String,
    pub model_count: usize,
    pub provider_name: String,
    pub native_refresh: bool,
    pub native_selection: bool,
    pub native_selection_status: String,
    pub query_cache_refresh: bool,
    pub query_client_count: usize,
    pub react_state_patched: bool,
    pub models: Vec<String>,
    pub native_models: Vec<String>,
    pub missing_native_models: Vec<String>,
}

pub fn current_runtime_ports() -> anyhow::Result<Option<(u16, u16)>> {
    runtime_ports_from_status(StatusStore::default().load_latest()?)
}

fn runtime_ports_from_status(status: Option<LaunchStatus>) -> anyhow::Result<Option<(u16, u16)>> {
    let Some(status) = status else {
        return Ok(None);
    };
    if !matches!(status.status.as_str(), "running" | "running_degraded") {
        return Ok(None);
    }
    let debug_port = status
        .debug_port
        .filter(|port| *port > 0)
        .context("Codex++ 运行状态缺少动态调试端口")?;
    let helper_port = status
        .helper_port
        .filter(|port| *port > 0)
        .context("Codex++ 运行状态缺少 Helper 端口")?;
    Ok(Some((debug_port, helper_port)))
}

pub async fn apply_current_runtime_config_and_models(
    max_threads: u8,
) -> anyhow::Result<Option<RuntimeModelApplyResult>> {
    let Some((debug_port, helper_port)) = current_runtime_ports()? else {
        return Ok(None);
    };
    let settings = SettingsStore::default()
        .load()
        .context("读取动态注入设置失败")?;
    apply_runtime_config_and_models(debug_port, helper_port, max_threads, &settings)
        .await
        .map(Some)
}

pub async fn apply_runtime_config_and_models(
    debug_port: u16,
    helper_port: u16,
    max_threads: u8,
    settings: &BackendSettings,
) -> anyhow::Result<RuntimeModelApplyResult> {
    let target = current_codex_target(debug_port).await?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .context("Codex CDP target has no websocket URL")?;

    let reload_script = config_reload_script(max_threads);
    tokio::time::timeout(
        RELOAD_TIMEOUT,
        crate::bridge::evaluate_script_with_await_promise(websocket_url, &reload_script, true),
    )
    .await
    .context("Codex config hot reload timed out")??;

    // Re-inject the current runtime so an already-open older Codex++ page gains
    // the latest dynamic model adapter without requiring a Codex restart.
    let injection = crate::assets::injection_script_with_runtime(helper_port, debug_port, settings);
    tokio::time::timeout(
        RELOAD_TIMEOUT,
        crate::bridge::evaluate_script_with_await_promise(websocket_url, &injection, true),
    )
    .await
    .context("Codex runtime reinjection timed out")??;

    let preferred_model = if settings.relay_profiles_enabled {
        settings.active_relay_profile().preferred_model_name()
    } else {
        String::new()
    };
    let refresh_script = model_refresh_script(&preferred_model);
    let response = tokio::time::timeout(
        RELOAD_TIMEOUT,
        crate::bridge::evaluate_script_with_await_promise(websocket_url, &refresh_script, true),
    )
    .await
    .context("Codex model runtime refresh timed out")??;
    let result = parse_runtime_model_apply_response(&response)?;
    if result.debug_port != debug_port || result.helper_port != helper_port {
        bail!("Codex 动态模型注入返回了不一致的运行端口");
    }
    if settings.relay_profiles_enabled {
        let expected_models = settings.active_relay_profile().ordered_model_names();
        if result.model_count != expected_models.len()
            || !same_models_ignore_ascii_case(&result.models, &expected_models)
        {
            bail!(
                "Codex 动态模型目录未同步：期望 {} 个，实际 {} 个",
                expected_models.len(),
                result.model_count
            );
        }
        if !models_are_subset_ignore_ascii_case(&expected_models, &result.native_models) {
            bail!(
                "Codex 原生模型目录未接收供应商模型：缺少 {}",
                result.missing_native_models.join(", ")
            );
        }
    }
    if !preferred_model.is_empty() && !result.selected_model.eq_ignore_ascii_case(&preferred_model)
    {
        bail!(
            "Codex 动态模型选择未同步：期望 {}，实际 {}",
            preferred_model,
            result.selected_model
        );
    }
    if !result.native_refresh {
        bail!("Codex 原生模型目录刷新失败");
    }
    if !result.query_cache_refresh {
        bail!(
            "Codex 原生模型界面缓存刷新失败：未发现可失效的模型查询缓存（候选 {} 个）",
            result.query_client_count
        );
    }
    if !preferred_model.is_empty() && !result.native_selection {
        bail!(
            "Codex 原生默认模型切换失败：状态 {}",
            result.native_selection_status
        );
    }
    Ok(result)
}

fn same_models_ignore_ascii_case(left: &[String], right: &[String]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut left = left
        .iter()
        .map(|model| model.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut right = right
        .iter()
        .map(|model| model.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    left.sort_unstable();
    right.sort_unstable();
    left == right
}

fn models_are_subset_ignore_ascii_case(expected: &[String], actual: &[String]) -> bool {
    expected.iter().all(|expected_model| {
        actual
            .iter()
            .any(|actual_model| actual_model.eq_ignore_ascii_case(expected_model))
    })
}

pub async fn reload_user_config_with_sub_agent_limit(
    debug_port: u16,
    max_threads: u8,
) -> anyhow::Result<()> {
    let target = current_codex_target(debug_port).await?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .context("Codex CDP target has no websocket URL")?;
    let script = config_reload_script(max_threads);
    tokio::time::timeout(
        RELOAD_TIMEOUT,
        crate::bridge::evaluate_script_with_await_promise(websocket_url, &script, true),
    )
    .await
    .context("Codex config hot reload timed out")??;
    Ok(())
}

async fn current_codex_target(debug_port: u16) -> anyhow::Result<crate::cdp::CdpTarget> {
    let targets = crate::cdp::list_targets(debug_port)
        .await
        .with_context(|| format!("failed to list Codex CDP targets on port {debug_port}"))?;
    crate::cdp::pick_injectable_codex_page_target(&targets)
}

fn config_reload_script(max_threads: u8) -> String {
    let max_threads = crate::settings::clamp_codex_sub_agent_max_threads(max_threads);
    format!(
        r#"(async () => {{
  const urls = [
    ...Array.from(document.scripts || []).map((script) => script.src),
    ...Array.from(document.querySelectorAll("link[href]") || []).map((link) => link.href),
    ...performance.getEntriesByType("resource").map((entry) => entry.name),
  ].filter((url) => url && url.includes("/assets/") && url.split("?")[0].endsWith(".js"));
  const sourceOf = (candidate) => {{
    try {{ return typeof candidate === "function" ? candidate.toString().replace(/\s+/g, "") : ""; }} catch {{ return ""; }}
  }};
  const rpcFromModule = (module, legacy) => {{
    if (legacy && typeof module?.n === "function") return module.n;
    return Object.values(module || {{}}).find((candidate) => {{
      const source = sourceOf(candidate);
      return source.startsWith("asyncfunction")
        && source.includes("params")
        && source.includes("select")
        && source.includes("signal")
        && source.includes("source");
    }}) || null;
  }};
  const findAsset = (prefix) => urls.find((url) => url.includes(prefix)) || "";
  const errors = [];
  let call = null;
  let assetPrefix = "";
  for (const prefix of ["vscode-api-", "app-initial-"]) {{
    try {{
      const url = findAsset(prefix);
      if (!url) throw new Error(`asset ${{prefix}} unavailable`);
      const module = await import(url);
      call = rpcFromModule(module, prefix !== "app-initial-");
      if (call) {{ assetPrefix = prefix; break; }}
      errors.push(`${{prefix}}: host RPC export unavailable`);
    }} catch (error) {{
      errors.push(`${{prefix}}: ${{error?.message || String(error)}}`);
    }}
  }}
  if (!call) throw new Error(`Codex state API unavailable (${{errors.join("; ")}})`);
  const payload = {{
    hostId: "local",
    edits: [{{
      keyPath: "agents.max_threads",
      value: {max_threads},
      mergeStrategy: "upsert",
    }}],
    filePath: null,
    expectedVersion: null,
    reloadUserConfig: true,
  }};
  const result = await call(
    "batch-write-config-value",
    assetPrefix === "vscode-api-" ? {{ params: payload }} : payload,
  );
  return JSON.stringify({{ status: "ok", assetPrefix, result: result ?? null }});
}})()"#
    )
}

fn model_refresh_script(preferred_model: &str) -> String {
    let preferred_model = serde_json::to_string(preferred_model).expect("model should serialize");
    format!(
        r#"(async () => {{
  const runtime = window.__codexPlusDynamicModelRuntime;
  if (!runtime || typeof runtime.refresh !== "function") {{
    throw new Error("Codex++ dynamic model runtime is unavailable after reinjection");
  }}
  const result = await runtime.refresh({{
    reason: "manager-provider-switch",
    preferredModel: {preferred_model},
    debugPort: Number(window.__CODEX_PLUS_RUNTIME_DEBUG_PORT__ || 0),
    helperPort: Number(new URL(window.__CODEX_SESSION_DELETE_HELPER__).port) || 0,
  }});
  return JSON.stringify(result);
}})()"#,
    )
}

fn parse_runtime_model_apply_response(response: &Value) -> anyhow::Result<RuntimeModelApplyResult> {
    let value = response
        .pointer("/result/result/value")
        .and_then(Value::as_str)
        .context("Codex 动态模型注入没有返回可验证结果")?;
    let result: RuntimeModelApplyResult =
        serde_json::from_str(value).context("解析 Codex 动态模型注入结果失败")?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(status: &str, debug_port: Option<u16>, helper_port: Option<u16>) -> LaunchStatus {
        LaunchStatus {
            status: status.to_string(),
            message: String::new(),
            started_at_ms: 1,
            debug_port,
            helper_port,
            codex_app: None,
        }
    }

    #[test]
    fn runtime_ports_use_latest_running_launcher_ports_instead_of_fixed_9229() {
        assert_eq!(
            runtime_ports_from_status(Some(status("running", Some(57351), Some(57321)))).unwrap(),
            Some((57351, 57321))
        );
        assert_eq!(
            runtime_ports_from_status(Some(status("running_degraded", Some(57351), Some(57321))))
                .unwrap(),
            Some((57351, 57321))
        );
        assert_eq!(
            runtime_ports_from_status(Some(status("failed", Some(9229), Some(57321)))).unwrap(),
            None
        );
    }

    #[test]
    fn runtime_ports_reject_incomplete_running_status() {
        assert!(runtime_ports_from_status(Some(status("running", None, Some(57321)))).is_err());
        assert!(runtime_ports_from_status(Some(status("running", Some(57351), None))).is_err());
    }

    #[test]
    fn config_reload_discovers_legacy_and_bundled_state_apis() {
        let script = config_reload_script(12);
        assert!(script.contains("[\"vscode-api-\", \"app-initial-\"]"));
        assert!(script.contains("rpcFromModule"));
        assert!(script.contains("reloadUserConfig: true"));
        assert!(script.contains("value: 12"));
        assert!(script.contains("assetPrefix === \"vscode-api-\" ? { params: payload } : payload"));
        assert!(!script.contains("module.n(\"batch-write-config-value\""));
    }

    #[test]
    fn model_refresh_requires_dynamic_runtime_and_passes_preferred_model() {
        let script = model_refresh_script("vendor/gpt-5.6-sol");
        assert!(script.contains("__codexPlusDynamicModelRuntime"));
        assert!(script.contains("manager-provider-switch"));
        assert!(script.contains("vendor/gpt-5.6-sol"));
        assert!(script.contains("__CODEX_PLUS_RUNTIME_DEBUG_PORT__"));
    }

    #[test]
    fn runtime_apply_response_is_verified_from_cdp_value() {
        let response = serde_json::json!({
            "result": { "result": { "value": serde_json::json!({
                "debugPort": 57351,
                "helperPort": 57321,
                "selectedModel": "gpt-5.6-sol",
                "modelCount": 10,
                "providerName": "9527",
                "nativeRefresh": true,
                "nativeSelection": true,
                "nativeSelectionStatus": "ok",
                "queryCacheRefresh": true,
                "queryClientCount": 1,
                "reactStatePatched": true,
                "models": ["gpt-5.6-sol"],
                "nativeModels": ["gpt-5.6-sol", "official-model"],
                "missingNativeModels": []
            }).to_string() } }
        });
        let result = parse_runtime_model_apply_response(&response).unwrap();
        assert_eq!(result.debug_port, 57351);
        assert_eq!(result.model_count, 10);
        assert_eq!(result.selected_model, "gpt-5.6-sol");
        assert!(result.native_selection);
        assert_eq!(result.models, vec!["gpt-5.6-sol"]);
        assert_eq!(result.native_models, vec!["gpt-5.6-sol", "official-model"]);
    }

    #[test]
    fn runtime_model_verification_is_case_insensitive_but_rejects_stale_models() {
        assert!(same_models_ignore_ascii_case(
            &[
                "Vendor/GPT-5.6-Sol".to_string(),
                "gpt-5.6-terra".to_string()
            ],
            &[
                "GPT-5.6-TERRA".to_string(),
                "vendor/gpt-5.6-sol".to_string()
            ]
        ));
        assert!(!same_models_ignore_ascii_case(
            &["gpt-5.6-sol".to_string(), "retired-model".to_string()],
            &["gpt-5.6-sol".to_string()]
        ));
        assert!(models_are_subset_ignore_ascii_case(
            &["GPT-5.6-SOL".to_string()],
            &["official-model".to_string(), "gpt-5.6-sol".to_string()]
        ));
        assert!(!models_are_subset_ignore_ascii_case(
            &["gpt-5.6-sol".to_string(), "missing-model".to_string()],
            &["gpt-5.6-sol".to_string()]
        ));
    }
}
