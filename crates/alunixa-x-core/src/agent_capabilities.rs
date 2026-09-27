use crate::settings::BackendSettings;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

pub const KEYS: &[&str] = &[
    "enhancementsEnabled",
    "computerUseGuardEnabled",
    "codexAppPackagedProxyRepair",
    "codexAppPluginMarketplaceUnlock",
    "codexAppPluginAutoExpand",
    "codexAppModelWhitelistUnlock",
    "codexAppServiceTierControls",
    "codexAppFastMode",
    "codexAppSessionDelete",
    "codexAppMarkdownExport",
    "codexAppPasteFix",
    "codexAppProjectMove",
    "codexAppThreadIdBadge",
    "codexAppConversationView",
    "codexAppThreadScrollRestore",
    "codexAppInstructionsEnabled",
    "codexAppStepwiseEnabled",
    "codexAppStepwiseDirectSend",
    "codexAppMemoryEmbeddingEnabled",
    "codexAppAiShell",
    "codexAppSharedTerminal",
    "codexAppSharedTerminalRetentionMinutes",
    "codexAppPetRealMouseLook",
    "codexAppForceChineseLocale",
    "codexAppFastStartup",
    "codexAppDisableAutoUpdate",
    "codexAppDisableWss",
    "codexAppPerformanceProtection",
    "codexAppNativeMenuPlacement",
    "codexAppNativeMenuLocalization",
    "codexAppZedRemoteOpen",
    "zedRemoteProjectRegistryEnabled",
    "zedRemoteSyncToZedSettings",
    "zedRemoteOpenStrategy",
    "codexAppUpstreamWorktreeCreate",
    "codexAppResponsesIdNegotiation",
    "codexGoalsEnabled",
    "codexAppSubAgentMaxThreads",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEntry {
    pub key: String,
    pub desired: Value,
    pub disk: Option<Value>,
    pub state: String,
    pub source: String,
    pub dependency: String,
    pub effect: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityAudit {
    pub revision: String,
    pub config_path: String,
    pub cli_path: Option<String>,
    pub scope: String,
    pub overrides: Vec<String>,
    pub entries: Vec<CapabilityEntry>,
}

#[derive(Clone, Debug)]
pub struct Feature {
    pub stage: String,
    pub default: bool,
}

pub fn parse_features(output: &str) -> BTreeMap<String, Feature> {
    output
        .lines()
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 3 {
                return None;
            }
            let default = fields.last()?.parse::<bool>().ok()?;
            Some((
                fields[0].to_owned(),
                Feature {
                    stage: fields[1..fields.len() - 1].join(" "),
                    default,
                },
            ))
        })
        .collect()
}

pub async fn inspect() -> anyhow::Result<CapabilityAudit> {
    let settings = crate::settings::SettingsStore::default().load()?;
    let home = crate::codex_home::default_codex_home_dir();
    let cli = crate::official_remote::find_codex_cli_executable(Some(&settings.codex_app_path));
    let mut features = BTreeMap::new();
    if let Some(cli) = &cli {
        // Feature defaults come from the installed binary, with no user/project overrides.
        let tmp = tempfile::tempdir()?;
        let mut command = tokio::process::Command::new(cli);
        command
            .args(["features", "list"])
            .env("CODEX_HOME", tmp.path())
            .current_dir(tmp.path())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(crate::windows_create_no_window());
        if let Ok(Ok(output)) =
            tokio::time::timeout(std::time::Duration::from_secs(6), command.output()).await
        {
            if output.status.success() {
                features = parse_features(&String::from_utf8_lossy(&output.stdout));
            }
        }
    }
    let _lock = crate::config_transaction::ConfigLock::acquire(&home)?;
    let settings = crate::settings::SettingsStore::default().load()?;
    let config_path = home.join("config.toml");
    let config = match std::fs::read_to_string(&config_path) {
        Ok(config) => config,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => anyhow::bail!("Codex 配置无法读取，能力状态未知"),
    };
    let doc = config
        .parse::<toml::Value>()
        .map_err(|_| anyhow::anyhow!("Codex 配置无法解析，能力状态未知"))?;
    let mut audit = inspect_values(&settings, &doc, &features)?;
    audit.revision =
        crate::config_transaction::revision(&crate::paths::default_settings_path(), &home)?;
    audit.config_path = config_path.display().to_string();
    audit.cli_path = cli.map(|p| p.display().to_string());
    if let Ok(cwd) = std::env::current_dir() {
        for parent in cwd.ancestors() {
            if parent.join(".codex/config.toml").is_file() {
                audit.overrides.push(format!(
                    "project: {}",
                    parent.join(".codex/config.toml").display()
                ));
            }
        }
    }
    for name in [
        "CODEX_HOME",
        "CODEX_PROFILE",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
    ] {
        if std::env::var_os(name).is_some() {
            audit.overrides.push(format!("environment: {name}"));
        }
    }
    Ok(audit)
}

pub fn inspect_values(
    settings: &BackendSettings,
    doc: &toml::Value,
    features: &BTreeMap<String, Feature>,
) -> anyhow::Result<CapabilityAudit> {
    let desired = serde_json::to_value(settings)?;
    let mut entries = Vec::new();
    let mut overrides = Vec::new();
    let selected = doc.get("profile").and_then(toml::Value::as_str);
    let selected_doc = selected.and_then(|name| doc.get("profiles")?.get(name));
    if selected.is_some() {
        overrides.push("config.toml: profile".into());
    }
    if settings
        .codex_extra_args
        .iter()
        .any(|a| a == "-c" || a == "-p" || a.starts_with("--config") || a.starts_with("--profile"))
    {
        overrides.push("launcher: config/profile arguments".into());
    }
    for &key in KEYS {
        let mut item = CapabilityEntry {
            key: key.into(),
            desired: desired.get(key).cloned().unwrap_or(Value::Null),
            disk: None,
            state: "unverified".into(),
            source: "AX settings.json / renderer".into(),
            dependency: "需要当前 Codex 界面适配器；未通过运行时检查不视为已生效".into(),
            effect: "restart".into(),
        };
        let native = match key {
            "codexAppFastMode" => Some("fast_mode"),
            "codexGoalsEnabled" => Some("goals"),
            _ => None,
        };
        if let Some(feature) = native {
            item.source = format!("config.toml: features.{feature}");
            item.dependency = format!("CLI feature: {feature}");
            if let Some(info) = features.get(feature) {
                if info.stage == "removed" {
                    item.state = "unsupported".into();
                } else {
                    let root = doc.get("features").and_then(|v| v.get(feature));
                    let scoped = selected_doc
                        .and_then(|d| d.get("features"))
                        .and_then(|v| v.get(feature));
                    let value = scoped.or(root);
                    item.disk = value
                        .and_then(toml::Value::as_bool)
                        .map(Value::Bool)
                        .or_else(|| value.is_none().then_some(Value::Bool(info.default)));
                    item.state = if item.disk.is_none() {
                        "unknown"
                    } else if scoped.is_some() {
                        "overridden"
                    } else if item.disk.as_ref() == Some(&item.desired) {
                        "saved_pending_restart"
                    } else {
                        "different"
                    }
                    .into();
                    if root.is_none() && scoped.is_none() {
                        item.source.push_str(" (CLI default)");
                    }
                }
            } else {
                item.state = "unknown".into();
            }
        } else if key == "codexAppSubAgentMaxThreads" {
            item.source = "config.toml: agents.max_threads".into();
            item.disk = doc
                .get("agents")
                .and_then(|v| v.get("max_threads"))
                .and_then(toml::Value::as_integer)
                .map(Value::from);
            item.state = if item.disk.as_ref() == Some(&item.desired) {
                "saved_pending_restart"
            } else {
                "different"
            }
            .into();
        } else if key == "zedRemoteSyncToZedSettings" {
            item.state = "unsupported".into();
            item.dependency = "未实现 Zed settings 写入".into();
        } else if key == "codexAppPackagedProxyRepair" {
            item.source = "AX settings.json / packaged Internet Settings".into();
            item.dependency = "Windows 应用包身份；明确拒绝连接的本机代理".into();
            item.state = if cfg!(windows) {
                "saved_pending_restart"
            } else {
                "unsupported"
            }
            .into();
        } else if key == "codexAppInstructionsEnabled" {
            item.source = "config.toml: model_instructions_file".into();
            item.disk = Some(Value::Bool(
                doc.get("model_instructions_file")
                    .and_then(toml::Value::as_str)
                    .is_some_and(|v| !v.trim().is_empty()),
            ));
            item.dependency = "提示词文件存在且没有 profile/项目/参数覆盖".into();
            item.state = if item.disk.as_ref() == Some(&item.desired) {
                "saved_pending_restart"
            } else {
                "different"
            }
            .into();
        } else if key == "codexAppDisableWss" {
            item.source = "config.toml: model_providers.<active>.supports_websockets".into();
            let provider = doc
                .get("model_provider")
                .and_then(toml::Value::as_str)
                .unwrap_or("openai");
            item.disk = doc
                .get("model_providers")
                .and_then(|p| p.get(provider))
                .and_then(|p| p.get("supports_websockets"))
                .and_then(toml::Value::as_bool)
                .map(|v| Value::Bool(!v));
            item.state = if item.disk.as_ref() == Some(&item.desired) {
                "saved_pending_restart"
            } else if item.disk.is_some() {
                "different"
            } else {
                "unknown"
            }
            .into();
        } else if key == "codexAppResponsesIdNegotiation" {
            item.source = "AX settings.json / protocol proxy".into();
            item.effect = "next_request".into();
            item.dependency = "请求必须经过 AX 协议代理".into();
            item.state = if settings.active_relay_uses_protocol_proxy() {
                "saved"
            } else {
                "missing_dependency"
            }
            .into();
        } else if key == "codexAppMemoryEmbeddingEnabled" {
            item.source = "AX settings.json / hooks.json".into();
            item.dependency = "已信任 UserPromptSubmit hook、嵌入地址与模型".into();
            if settings
                .codex_app_memory_embedding_base_url
                .trim()
                .is_empty()
                || settings.codex_app_memory_embedding_model.trim().is_empty()
            {
                item.state = "missing_dependency".into();
            }
        } else if key == "codexAppStepwiseEnabled" || key == "codexAppStepwiseDirectSend" {
            item.source = "AX settings.json / helper / floating panel".into();
            item.dependency = "Stepwise 地址、模型、凭据及浮层适配器".into();
            if settings.codex_app_stepwise_base_url.trim().is_empty()
                || settings.codex_app_stepwise_model.trim().is_empty()
            {
                item.state = "missing_dependency".into();
            }
        } else if [
            "computerUseGuardEnabled",
            "codexAppSharedTerminal",
            "codexAppAiShell",
            "codexAppPetRealMouseLook",
        ]
        .contains(&key)
        {
            item.source = "AX settings.json / hooks.json / Windows runtime".into();
            item.dependency = "Windows、所选 shell 或官方插件/原生 V2 组件、hook 信任".into();
            if !cfg!(windows) {
                item.state = "unsupported".into();
            }
        }
        entries.push(item);
    }
    Ok(CapabilityAudit {
        revision: String::new(),
        config_path: String::new(),
        cli_path: None,
        scope: "global_profile_only_runtime_unknown".into(),
        overrides,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_defaults_false_and_profile_override_are_distinct() {
        let settings = BackendSettings::default();
        let features =
            parse_features("fast_mode stable true\ngoals stable true\nold removed false");
        let empty = inspect_values(&settings, &"".parse().unwrap(), &features).unwrap();
        assert_eq!(
            empty
                .entries
                .iter()
                .find(|r| r.key == "codexAppFastMode")
                .unwrap()
                .state,
            "different"
        );
        let disabled = inspect_values(
            &settings,
            &"[features]\nfast_mode=false".parse().unwrap(),
            &features,
        )
        .unwrap();
        assert_eq!(
            disabled
                .entries
                .iter()
                .find(|r| r.key == "codexAppFastMode")
                .unwrap()
                .disk,
            Some(Value::Bool(false))
        );
        let scoped = inspect_values(
            &settings,
            &"profile='x'\n[features]\nfast_mode=false\n[profiles.x.features]\nfast_mode=true"
                .parse()
                .unwrap(),
            &features,
        )
        .unwrap();
        assert_eq!(
            scoped
                .entries
                .iter()
                .find(|r| r.key == "codexAppFastMode")
                .unwrap()
                .state,
            "overridden"
        );
        assert_eq!(empty.entries.len(), KEYS.len());
    }
    #[test]
    fn unavailable_feature_discovery_is_unknown_not_disabled() {
        let audit = inspect_values(
            &BackendSettings::default(),
            &"".parse().unwrap(),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            audit
                .entries
                .iter()
                .find(|r| r.key == "codexAppFastMode")
                .unwrap()
                .state,
            "unknown"
        );
        assert_eq!(
            audit
                .entries
                .iter()
                .find(|r| r.key == "zedRemoteSyncToZedSettings")
                .unwrap()
                .state,
            "unsupported"
        );
    }
}
