//! Read-only validation and narrow reconciliation immediately before Codex starts.
//!
//! This module is intentionally limited to configuration owned by Alunixa X.
//! User-owned providers, credentials, hooks, and external instruction files are
//! parsed and checked, but are never replaced speculatively.

use anyhow::{Context, bail};
use serde_json::Value;
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item};

use crate::settings::BackendSettings;

const MAX_CONFIG_BYTES: u64 = 32 * 1024 * 1024;
const IMAGEGEN_SERVER: &str = "alunixa-x-imagegen";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StartupAuditReport {
    pub checked_files: usize,
    pub checked_config_sections: usize,
    pub advanced_instruction_files: usize,
    pub repaired_items: usize,
}

impl StartupAuditReport {
    fn checked_file(&mut self) {
        self.checked_files += 1;
    }

    fn checked_section(&mut self) {
        self.checked_config_sections += 1;
    }

    fn repaired(&mut self, changed: bool) {
        if changed {
            self.repaired_items += 1;
        }
    }
}

/// Reconcile owned files, then validate every live Codex configuration source
/// that can affect the next launch.
pub fn audit_and_repair_before_launch(
    home: &Path,
    settings: &BackendSettings,
    helper_port: u16,
    launcher_path: &Path,
) -> anyhow::Result<StartupAuditReport> {
    let mut report = StartupAuditReport::default();

    report.repaired(crate::retired_context::remove_from_home(home)?);
    report.repaired(crate::relay_config::repair_stale_feature_entries_in_home(
        home,
    )?);
    report.repaired(crate::relay_config::sync_codex_agent_capabilities_in_home(
        home, settings,
    )?);

    let hooks = crate::codex_hooks::apply_alunixa_x_hooks_in_home(settings, launcher_path, home)?;
    report.repaired(hooks.installed > 0 || hooks.removed > 0);

    report.repaired(
        crate::codex_instructions::ensure_model_instructions_before_launch(
            home,
            settings.codex_app_instructions_enabled,
            &settings.codex_app_instructions,
        )?,
    );

    let config = read_optional_file(&home.join("config.toml"), MAX_CONFIG_BYTES)?;
    if let Some(config) = config {
        report.checked_file();
        let config =
            std::str::from_utf8(&config).context("启动前配置校验失败：config.toml 不是 UTF-8")?;
        audit_config(home, settings, helper_port, config, &mut report)?;
    }

    let auth_path = home.join("auth.json");
    if let Some(auth) = read_optional_file(&auth_path, MAX_CONFIG_BYTES)? {
        report.checked_file();
        audit_json_object(&auth, &auth_path, "auth.json")?;
    }

    let hooks_path = home.join("hooks.json");
    if let Some(hooks) = read_optional_file(&hooks_path, MAX_CONFIG_BYTES)? {
        report.checked_file();
        audit_hooks(&hooks, settings)?;
    }

    audit_saved_config_sections(settings, &mut report)?;
    let instruction_scan = crate::codex_instructions::audit_model_instructions_before_launch(
        home,
        settings.codex_app_instructions_enabled,
        &settings.codex_app_instructions,
    )?;
    report.advanced_instruction_files += instruction_scan.files_scanned;
    report.checked_config_sections += instruction_scan.references_checked;

    Ok(report)
}

fn audit_config(
    home: &Path,
    settings: &BackendSettings,
    helper_port: u16,
    contents: &str,
    report: &mut StartupAuditReport,
) -> anyhow::Result<()> {
    let doc = parse_config(contents)?;
    audit_retired_context(&doc)?;
    audit_agent_capability_config(&doc, settings, report)?;

    let expected_threads = crate::settings::clamp_codex_sub_agent_max_threads(
        settings.codex_app_sub_agent_max_threads,
    ) as i64;
    let actual_threads = doc
        .get("agents")
        .and_then(Item::as_table_like)
        .and_then(|table| table.get("max_threads"))
        .and_then(Item::as_integer)
        .context("启动前配置校验失败：agents.max_threads 缺失或不是整数")?;
    report.checked_section();
    if actual_threads != expected_threads {
        bail!("启动前配置校验失败：agents.max_threads={actual_threads}，期望={expected_threads}");
    }

    audit_imagegen_config(&doc, settings, helper_port)?;
    report.checked_section();

    audit_wss_config(&doc, settings)?;
    report.checked_section();

    if settings.relay_profiles_enabled {
        let profile = settings.active_relay_profile();
        crate::relay_config::verify_profile_context_limits_in_config(&profile, contents)?;
        report.checked_section();
        let status = crate::relay_config::relay_config_status_from_home(home);
        match profile.relay_mode {
            crate::settings::RelayMode::Official if !profile.official_mix_api_key => {
                if status.configured {
                    bail!("启动前配置校验失败：官方登录模式仍残留 Alunixa X 供应商配置");
                }
            }
            crate::settings::RelayMode::MixedApi
            | crate::settings::RelayMode::PureApi
            | crate::settings::RelayMode::Aggregate
            | crate::settings::RelayMode::CustomModels => {
                if !status.configured {
                    bail!("启动前配置校验失败：当前供应商配置不完整");
                }
            }
            crate::settings::RelayMode::Official => {}
        }
        report.checked_section();
    }

    Ok(())
}

fn audit_agent_capability_config(
    doc: &DocumentMut,
    settings: &BackendSettings,
    report: &mut StartupAuditReport,
) -> anyhow::Result<()> {
    let actual_fast_mode = if let Some(features_item) = doc.get("features") {
        let features = features_item
            .as_table_like()
            .context("启动前 Agent 能力校验失败：features 必须是 TOML table")?;
        features.get("fast_mode").and_then(Item::as_bool)
    } else {
        None
    };
    report.checked_section();
    if settings.codex_app_fast_mode {
        if actual_fast_mode != Some(true) {
            bail!("启动前 Agent 能力校验失败：Fast 模式已开启但 features.fast_mode 不为 true");
        }
    } else if actual_fast_mode.is_some() {
        bail!("启动前 Agent 能力校验失败：Fast 模式已关闭但 features.fast_mode 仍残留");
    }
    Ok(())
}

fn audit_retired_context(doc: &DocumentMut) -> anyhow::Result<()> {
    let serialized = doc.to_string();
    let cleaned = crate::retired_context::strip_config(&serialized)?;
    if cleaned != serialized {
        bail!("启动前配置校验失败：检测到已退役的实验性上下文配置");
    }
    Ok(())
}

fn audit_imagegen_config(
    doc: &DocumentMut,
    settings: &BackendSettings,
    helper_port: u16,
) -> anyhow::Result<()> {
    let expected_enabled = crate::image_models::mcp_enabled(settings);
    let server = doc
        .get("mcp_servers")
        .and_then(Item::as_table_like)
        .and_then(|servers| servers.get(IMAGEGEN_SERVER));

    if !expected_enabled {
        if server.is_some() {
            bail!("启动前配置校验失败：image_gen 功能已关闭但 MCP 配置仍存在");
        }
        return Ok(());
    }

    let server = server
        .and_then(Item::as_table_like)
        .context("启动前配置校验失败：image_gen MCP 配置缺失")?;
    let command = server
        .get("command")
        .and_then(Item::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("启动前配置校验失败：image_gen MCP command 缺失")?;
    let command_path = PathBuf::from(command);
    if !command_path.is_file() {
        bail!("启动前配置校验失败：image_gen MCP companion 不存在");
    }
    if server.get("enabled").and_then(Item::as_bool) != Some(true) {
        bail!("启动前配置校验失败：image_gen MCP 未启用");
    }
    let expected_url = format!("http://127.0.0.1:{helper_port}");
    let actual_url = server
        .get("env")
        .and_then(Item::as_table_like)
        .and_then(|env| env.get("ALUNIXA_X_HELPER_URL"))
        .and_then(Item::as_str)
        .unwrap_or_default();
    if actual_url != expected_url {
        bail!("启动前配置校验失败：image_gen MCP helper 地址不一致");
    }
    Ok(())
}

fn audit_wss_config(doc: &DocumentMut, settings: &BackendSettings) -> anyhow::Result<()> {
    if !(settings.relay_profiles_enabled && settings.codex_app_disable_wss) {
        return Ok(());
    }
    if doc.get("model_provider").and_then(Item::as_str) != Some("openai_http") {
        bail!("启动前配置校验失败：禁用 WSS 时 model_provider 不一致");
    }
    let provider = doc
        .get("model_providers")
        .and_then(Item::as_table_like)
        .and_then(|providers| providers.get("openai_http"))
        .and_then(Item::as_table_like)
        .context("启动前配置校验失败：禁用 WSS 时 openai_http 配置缺失")?;
    if provider.get("supports_websockets").and_then(Item::as_bool) != Some(false) {
        bail!("启动前配置校验失败：禁用 WSS 时 supports_websockets 不为 false");
    }
    Ok(())
}

fn audit_saved_config_sections(
    settings: &BackendSettings,
    report: &mut StartupAuditReport,
) -> anyhow::Result<()> {
    let mut sections = vec![
        (
            "relayCommonConfigContents".to_string(),
            settings.relay_common_config_contents.clone(),
        ),
        (
            "relayContextConfigContents".to_string(),
            settings.relay_context_config_contents.clone(),
        ),
    ];
    for (index, profile) in settings.relay_profiles.iter().enumerate() {
        sections.push((
            format!("relayProfiles[{index}].configContents"),
            profile.config_contents.clone(),
        ));
    }

    for (name, contents) in sections {
        if contents.trim().is_empty() {
            continue;
        }
        report.checked_section();
        let doc = parse_config(&contents)
            .with_context(|| format!("启动前配置校验失败：{name} 不是有效 TOML"))?;
        audit_retired_context(&doc)?;
    }
    Ok(())
}

fn audit_hooks(contents: &[u8], settings: &BackendSettings) -> anyhow::Result<()> {
    let value: Value =
        serde_json::from_slice(contents).context("启动前配置校验失败：hooks.json 不是有效 JSON")?;
    let hooks = value
        .get("hooks")
        .and_then(Value::as_object)
        .context("启动前配置校验失败：hooks.json 的 hooks 字段不是对象")?;
    let owned = hooks
        .values()
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|group| group.get("hooks"))
        .filter_map(Value::as_array)
        .flatten()
        .filter(|hook| {
            hook.get("command")
                .and_then(Value::as_str)
                .is_some_and(|command| {
                    command.split_whitespace().any(|part| {
                        part.trim_matches(|character| matches!(character, '"' | '\''))
                            == "--alunixa-x-hook"
                    })
                })
        })
        .count();
    let expected = if settings.enhancements_enabled {
        if cfg!(windows) { 3 } else { 1 }
    } else {
        0
    };
    if owned != expected {
        bail!("启动前配置校验失败：Alunixa X Hook 数量为 {owned}，期望为 {expected}");
    }
    Ok(())
}

fn audit_json_object(contents: &[u8], path: &Path, label: &str) -> anyhow::Result<()> {
    let value: Value = serde_json::from_slice(contents)
        .with_context(|| format!("启动前配置校验失败：{label} 不是有效 JSON"))?;
    if !value.is_object() {
        bail!("启动前配置校验失败：{} 根节点必须是对象", path.display());
    }
    Ok(())
}

fn parse_config(contents: &str) -> anyhow::Result<DocumentMut> {
    contents
        .trim_start_matches('\u{feff}')
        .parse::<DocumentMut>()
        .map_err(|_| anyhow::anyhow!("启动前配置校验失败：config.toml 不是有效 TOML"))
}

fn read_optional_file(path: &Path, maximum: u64) -> anyhow::Result<Option<Vec<u8>>> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).with_context(|| format!("读取 {} 失败", path.display())),
    };
    if !metadata.is_file() {
        bail!("启动前配置校验失败：{} 不是普通文件", path.display());
    }
    if metadata.len() > maximum {
        bail!("启动前配置校验失败：{} 超过大小限制", path.display());
    }
    Ok(Some(std::fs::read(path).with_context(|| {
        format!("读取 {} 失败", path.display())
    })?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::BackendSettings;
    use tempfile::tempdir;

    fn settings_without_owned_runtime_features() -> BackendSettings {
        BackendSettings {
            enhancements_enabled: false,
            relay_profiles_enabled: false,
            ..BackendSettings::default()
        }
    }

    #[test]
    fn audit_repairs_retired_context_and_checks_owned_files() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        std::fs::write(
            home.join("config.toml"),
            "[features.token_budget]\nenabled = true\n[mcp_servers.alunixa-x-context]\ncommand = 'old'\n",
        )
        .unwrap();
        let settings = settings_without_owned_runtime_features();

        let report =
            audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher")).unwrap();

        let config = std::fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(!config.contains("token_budget"));
        assert!(!config.contains("alunixa-x-context"));
        assert!(config.contains("max_threads"));
        assert!(home.join("hooks.json").is_file());
        assert!(report.checked_files >= 2);
        assert!(report.repaired_items >= 1);
    }

    #[test]
    fn audit_rejects_disabled_imagegen_that_survived_a_toggle() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        std::fs::write(
            home.join("config.toml"),
            "[agents]\nmax_threads = 3\n[mcp_servers.alunixa-x-imagegen]\ncommand = 'stale'\nenabled = true\n",
        )
        .unwrap();
        let settings = settings_without_owned_runtime_features();

        let error = audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("image_gen"));
        assert!(!error.contains("stale"));
    }

    #[test]
    fn audit_accepts_enabled_imagegen_and_official_login_configuration() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        let companion = home.join("alunixa-x-imagegen-mcp.exe");
        std::fs::write(&companion, b"fixture").unwrap();
        std::fs::write(
            home.join("config.toml"),
            format!(
                "[agents]\nmax_threads = 3\n\
                 [mcp_servers.alunixa-x-imagegen]\n\
                 command = '{}'\n\
                 startup_timeout_sec = 20\n\
                 tool_timeout_sec = 900\n\
                 enabled = true\n\
                 [mcp_servers.alunixa-x-imagegen.env]\n\
                 ALUNIXA_X_HELPER_URL = 'http://127.0.0.1:57321'\n",
                companion.display()
            ),
        )
        .unwrap();
        let mut settings = BackendSettings::default();
        settings.relay_profiles[0].relay_mode = crate::settings::RelayMode::Official;
        settings.relay_profiles[0].official_mix_api_key = false;

        let report =
            audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher")).unwrap();

        assert!(report.checked_files >= 2);
        assert!(report.advanced_instruction_files == 0);
    }

    #[test]
    fn audit_scans_managed_advanced_prompt_before_launch() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        let settings = BackendSettings {
            enhancements_enabled: false,
            relay_profiles_enabled: false,
            codex_app_instructions_enabled: true,
            codex_app_instructions: "Verify the task and report the result.".to_string(),
            ..BackendSettings::default()
        };

        let report =
            audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher")).unwrap();

        assert!(report.advanced_instruction_files >= 2);
        assert!(crate::codex_instructions::managed_instructions_path(home).is_file());
        let config = std::fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(config.contains("model_instructions_file"));
    }

    #[test]
    fn audit_repairs_fast_mode_and_keeps_other_agent_features() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        std::fs::write(
            home.join("config.toml"),
            "[features]\ngoals = true\nfast_mode = false\n",
        )
        .unwrap();
        let settings = BackendSettings {
            enhancements_enabled: false,
            relay_profiles_enabled: false,
            codex_app_fast_mode: true,
            ..BackendSettings::default()
        };

        let report =
            audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher")).unwrap();

        let config = std::fs::read_to_string(home.join("config.toml")).unwrap();
        let parsed = config.parse::<toml::Value>().unwrap();
        assert_eq!(parsed["features"]["fast_mode"].as_bool(), Some(true));
        assert_eq!(parsed["features"]["goals"].as_bool(), Some(true));
        assert!(report.repaired_items >= 1);
    }

    #[test]
    fn audit_removes_fast_mode_when_agent_capability_is_disabled() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        std::fs::write(home.join("config.toml"), "[features]\nfast_mode = true\n").unwrap();
        let settings = settings_without_owned_runtime_features();

        audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher")).unwrap();

        let config = std::fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(!config.contains("fast_mode"));
    }

    #[test]
    fn audit_rejects_malformed_features_table() {
        let temp = tempdir().unwrap();
        let home = temp.path();
        std::fs::write(home.join("config.toml"), "features = \"invalid\"\n").unwrap();
        let settings = settings_without_owned_runtime_features();

        let error = audit_and_repair_before_launch(home, &settings, 57321, Path::new("launcher"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("features 必须是 TOML table"));
    }

    #[test]
    fn startup_audit_rejects_global_context_overrides_for_custom_models() {
        use crate::relay_config::verify_profile_context_limits_in_config as verify;
        let profile = crate::settings::RelayProfile {
            relay_mode: crate::settings::RelayMode::CustomModels,
            custom_models: vec![crate::settings::CustomRelayModel {
                id: "large".into(),
                model: "large".into(),
                context_window: "1.05M".into(),
                auto_compact_enabled: true,
                auto_compact_limit: "1000000".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        for text in [
            "model_context_window = 272000\nmodel_auto_compact_token_limit = 271000\n",
            "model_context_window = '1050000'\nmodel_auto_compact_token_limit = 1000000\n",
            "model_context_window = 1050000\n",
            "model_auto_compact_token_limit = 1000000\n",
        ] {
            assert!(
                verify(&profile, text)
                    .unwrap_err()
                    .to_string()
                    .contains("回读校验失败")
            );
        }
        verify(&profile, "model = 'large'\n").unwrap();
    }
}
