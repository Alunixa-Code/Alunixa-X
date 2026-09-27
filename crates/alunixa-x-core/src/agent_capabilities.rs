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

pub async fn discover_features(cli: Option<&std::path::Path>) -> BTreeMap<String, Feature> {
    let mut features = BTreeMap::new();
    if let Some(cli) = cli {
        // Feature defaults come from the installed binary, with no user/project overrides.
        let Ok(tmp) = tempfile::tempdir() else {
            return features;
        };
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
    features
}

pub async fn supports_profile_files(cli: Option<&std::path::Path>) -> Option<bool> {
    let cli = cli?;
    let tmp = tempfile::tempdir().ok()?;
    std::fs::write(tmp.path().join("ax-probe.config.toml"), "").ok()?;
    let mut command = tokio::process::Command::new(cli);
    command.args(["--profile", "ax-probe", "features", "list"])
        .env("CODEX_HOME", tmp.path()).current_dir(tmp.path()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::windows_create_no_window());
    let output = tokio::time::timeout(std::time::Duration::from_secs(6), command.output()).await.ok()?.ok()?;
    if output.status.success() { Some(true) }
    else if String::from_utf8_lossy(&output.stderr).contains("not found") { Some(false) }
    else { None }
}

pub fn selected_profile_argument(args: &[String]) -> anyhow::Result<Option<String>> {
    let mut selected = None;
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if arg == "--" { break; }
        let name = if arg == "--profile" || arg == "-p" {
            Some(args.next().map(String::as_str).ok_or_else(|| anyhow::anyhow!("profile 参数缺少名称"))?)
        } else { arg.strip_prefix("--profile=").or_else(|| arg.strip_prefix("-p=").filter(|n| !n.is_empty())) };
        if let Some(name) = name {
            if name.is_empty() || name.len() > 128 || !name.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) {
                anyhow::bail!("profile 名称无法安全解析，状态未知");
            }
            selected = Some(name.to_owned());
        }
    }
    Ok(selected)
}

pub fn overlay_profile_for_audit(
    home: &std::path::Path, settings: &BackendSettings, doc: &toml::Value,
) -> anyhow::Result<(toml::Value, Option<String>)> {
    let Some(name) = selected_profile_argument(&settings.codex_extra_args)? else {
        return Ok((doc.clone(), None));
    };
    let path = home.join(format!("{name}.config.toml"));
    let profile = match std::fs::read_to_string(&path) {
        Ok(text) => text.parse::<toml::Value>().map_err(|_| anyhow::anyhow!("独立 profile 配置无法解析，状态未知"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            doc.get("profiles").and_then(|p| p.get(&name)).cloned()
                .ok_or_else(|| anyhow::anyhow!("所选 profile 配置无法读取，状态未知"))?
        }
        Err(_) => anyhow::bail!("所选 profile 配置无法读取，状态未知"),
    };
    // Internal read-only view reuses field-level override inspection; never serialize to disk.
    let mut effective = doc.clone();
    effective["profile"] = toml::Value::String(name.clone());
    let mut profiles = toml::map::Map::new();
    profiles.insert(name, profile);
    effective["profiles"] = toml::Value::Table(profiles);
    Ok((effective, Some(path.display().to_string())))
}

pub fn validate_native_feature_changes(
    previous: &BackendSettings,
    next: &BackendSettings,
    features: &BTreeMap<String, Feature>,
) -> anyhow::Result<()> {
    for (feature, changed) in [
        (
            "fast_mode",
            previous.codex_app_fast_mode != next.codex_app_fast_mode,
        ),
        (
            "goals",
            previous.codex_goals_enabled != next.codex_goals_enabled,
        ),
    ] {
        if changed && !features.get(feature).is_some_and(|f| f.stage != "removed") {
            anyhow::bail!(
                "当前 Codex 未确认支持 features.{feature}，未写入；请核对所选桌面后台并刷新能力检测"
            );
        }
    }
    Ok(())
}

pub fn validate_profile_feature_change(
    doc: &toml::Value, feature: &str, enabled: bool,
) -> anyhow::Result<()> {
    if let Some(value) = doc.get("profile").and_then(toml::Value::as_str)
        .and_then(|profile| doc.get("profiles")?.get(profile)?.get("features")?.get(feature))
    {
        if value.as_bool() != Some(enabled) {
            anyhow::bail!("当前 profile 覆盖 features.{feature}；请先编辑该 profile，未将根级保存伪装为已生效");
        }
    }
    Ok(())
}

pub fn validate_profile_feature_changes_in_home(
    home: &std::path::Path, previous: &BackendSettings, next: &BackendSettings,
) -> anyhow::Result<()> {
    let config = match std::fs::read_to_string(home.join("config.toml")) {
        Ok(config) => config,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => anyhow::bail!("Codex 配置无法读取，未保存"),
    };
    let doc = config.parse::<toml::Value>()
        .map_err(|_| anyhow::anyhow!("Codex 配置无法解析，未保存"))?;
    let (doc, _) = overlay_profile_for_audit(home, next, &doc)?;
    for (feature, before, after) in [
        ("fast_mode", previous.codex_app_fast_mode, next.codex_app_fast_mode),
        ("goals", previous.codex_goals_enabled, next.codex_goals_enabled),
    ] {
        if before != after { validate_profile_feature_change(&doc, feature, after)?; }
    }
    Ok(())
}

pub async fn inspect() -> anyhow::Result<CapabilityAudit> {
    let settings = crate::settings::SettingsStore::default().load()?;
    let home = crate::codex_home::default_codex_home_dir();
    let cli = crate::official_remote::find_codex_cli_executable(Some(&settings.codex_app_path));
    let features = discover_features(cli.as_deref()).await;
    let profile_files = supports_profile_files(cli.as_deref()).await;
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
    if profile_files == Some(true) && (doc.get("profile").is_some() || doc.get("profiles").is_some()) {
        anyhow::bail!("当前 Codex 已移除内嵌 profile/profiles；请备份后迁移到独立 *.config.toml 文件，未自动覆盖用户配置");
    }
    let (doc, profile_path) = overlay_profile_for_audit(&home, &settings, &doc)?;
    let mut audit = inspect_values(&settings, &doc, &features)?;
    if let Some(path) = profile_path {
        audit.overrides.push(format!("profile file (launcher selection; running task unverified): {path}"));
        for item in &mut audit.entries {
            if item.state == "overridden" { item.source.push_str(&format!(" / {path}")); }
        }
    }
    if settings.codex_app_instructions_enabled
        && crate::codex_instructions::audit_model_instructions_before_launch(
            &home,
            true,
            &settings.codex_app_instructions,
        )
        .is_err()
    {
        if let Some(entry) = audit
            .entries
            .iter_mut()
            .find(|entry| entry.key == "codexAppInstructionsEnabled")
        {
            entry.state = "missing_dependency".into();
            entry.dependency = "提示词引用、文件内容或读取权限检查未通过".into();
        }
    }
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
    if settings.codex_extra_args.iter().any(|a| {
        a.starts_with("-c")
            || a.starts_with("-p")
            || a.starts_with("--config")
            || a.starts_with("--profile")
    }) {
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
            let scoped = selected_doc
                .and_then(|d| d.get("agents"))
                .and_then(|v| v.get("max_threads"));
            item.disk = scoped
                .or_else(|| doc.get("agents").and_then(|v| v.get("max_threads")))
                .and_then(toml::Value::as_integer)
                .map(Value::from);
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
            let scoped = selected_doc.and_then(|d| d.get("model_instructions_file"));
            item.disk = Some(Value::Bool(
                scoped
                    .or_else(|| doc.get("model_instructions_file"))
                    .and_then(toml::Value::as_str)
                    .is_some_and(|v| !v.trim().is_empty()),
            ));
            item.dependency = "提示词文件存在且没有 profile/项目/参数覆盖".into();
            item.state = if scoped.is_some() {
                "overridden"
            } else if item.disk.as_ref() == Some(&item.desired) {
                "saved_pending_restart"
            } else {
                "different"
            }
            .into();
        } else if key == "codexAppDisableWss" {
            item.source = "config.toml: model_providers.<active>.supports_websockets".into();
            let provider = selected_doc
                .and_then(|d| d.get("model_provider"))
                .or_else(|| doc.get("model_provider"))
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

    #[test]
    fn removed_or_unavailable_native_capabilities_refuse_edits_but_not_unrelated_saves() {
        let previous = BackendSettings::default();
        let mut next = previous.clone();
        assert!(validate_native_feature_changes(&previous, &next, &BTreeMap::new()).is_ok());
        next.codex_app_fast_mode = !previous.codex_app_fast_mode;
        assert!(validate_native_feature_changes(&previous, &next, &BTreeMap::new()).is_err());
        assert!(
            validate_native_feature_changes(
                &previous,
                &next,
                &parse_features("fast_mode removed false")
            )
            .is_err()
        );
        assert!(
            validate_native_feature_changes(
                &previous,
                &next,
                &parse_features("fast_mode stable true")
            )
            .is_ok()
        );
    }

    #[test]
    fn explicit_edit_cannot_claim_to_disable_a_feature_overridden_by_profile() {
        let doc = "profile='work'\n[profiles.work.features]\nfast_mode=true".parse().unwrap();
        assert!(validate_profile_feature_change(&doc, "fast_mode", false).is_err());
        assert!(validate_profile_feature_change(&doc, "fast_mode", true).is_ok());
        assert!(validate_profile_feature_change(&doc, "goals", false).is_ok());
    }

    #[test]
    fn every_boolean_capability_survives_save_reload_and_accurate_audit() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::settings::SettingsStore::new(dir.path().join("settings.json"));
        let defaults = serde_json::to_value(BackendSettings::default()).unwrap();
        let features = parse_features("fast_mode stable true\ngoals stable true");
        for &key in KEYS {
            if !defaults[key].is_boolean() { continue; }
            for enabled in [true, false] {
                let mut json = defaults.clone();
                json[key] = Value::Bool(enabled);
                let settings: BackendSettings = serde_json::from_value(json).unwrap();
                store.save(&settings).unwrap();
                let reloaded = crate::settings::SettingsStore::new(store.path().to_path_buf()).load().unwrap();
                let doc = format!("[features]\nfast_mode={}\ngoals={}\n",
                    reloaded.codex_app_fast_mode, reloaded.codex_goals_enabled).parse().unwrap();
                let report = inspect_values(&reloaded, &doc, &features).unwrap();
                let entry = report.entries.iter().find(|e| e.key == key).unwrap();
                assert_eq!(entry.desired, Value::Bool(enabled), "{key}");
                assert!(!["enabled", "ready", "running"].contains(&entry.state.as_str()), "{key}");
                if ["codexAppFastMode", "codexGoalsEnabled"].contains(&key) {
                    assert_eq!(entry.disk, Some(Value::Bool(enabled)), "{key}");
                }
            }
        }
    }

    #[test]
    fn profile_overrides_threads_and_instructions_without_claiming_live_effect() {
        let audit = inspect_values(
            &BackendSettings::default(),
            &r#"
profile="work"
[agents]
max_threads=6
[profiles.work]
model_instructions_file="profile.md"
[profiles.work.agents]
max_threads=2
"#
            .parse()
            .unwrap(),
            &BTreeMap::new(),
        )
        .unwrap();
        for key in ["codexAppSubAgentMaxThreads", "codexAppInstructionsEnabled"] {
            assert_eq!(
                audit
                    .entries
                    .iter()
                    .find(|entry| entry.key == key)
                    .unwrap()
                    .state,
                "overridden"
            );
        }
        assert_eq!(
            audit
                .entries
                .iter()
                .find(|entry| entry.key == "codexAppSubAgentMaxThreads")
                .unwrap()
                .disk,
            Some(Value::from(2))
        );
    }
}
