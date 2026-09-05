use std::path::Path;

use anyhow::Context;
use toml_edit::{DocumentMut, InlineTable, Item, Table, Value};

use crate::settings::BackendSettings;

/// This is an opt-in Codex setting, not an account entitlement or context-limit override.
pub fn apply_experimental_context_policy(
    home: &Path,
    settings: &BackendSettings,
) -> anyhow::Result<bool> {
    let enabled = settings.enhancements_enabled && settings.codex_app_experimental_context;
    let config_path = home.join("config.toml");
    let existing = match std::fs::read_to_string(&config_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error).context("读取实验性上下文配置失败，未修改原配置");
        }
    };
    let updated = update_config(&existing, enabled)?;
    let api_enabled = enabled && use_local_api_context(home, settings, &updated);
    let companion = crate::context_api_config::companion_path()?;
    let (updated, restore) =
        crate::context_api_config::prepare_config(home, &updated, api_enabled, &companion)?;
    // Persist rollback information before modifying the user's live TOML.
    if let Some(restore) = &restore {
        crate::context_api_config::save_restore(home, restore)?;
    }
    if updated == existing {
        if !api_enabled {
            crate::context_api_config::clear_restore(home)?;
        }
        return Ok(false);
    }
    crate::settings::atomic_write(&config_path, updated.as_bytes())
        .context("保存实验性上下文配置失败")?;
    if !api_enabled {
        crate::context_api_config::clear_restore(home)?;
    }
    Ok(true)
}

fn use_local_api_context(home: &Path, settings: &BackendSettings, config: &str) -> bool {
    if settings.relay_profiles_enabled {
        let relay = settings.active_relay_profile();
        if relay.relay_mode != crate::settings::RelayMode::Official || relay.official_mix_api_key {
            return true;
        }
    }
    let doc = config
        .trim_start_matches('\u{feff}')
        .parse::<DocumentMut>()
        .ok();
    let provider = doc
        .as_ref()
        .and_then(|doc| doc.get("model_provider"))
        .and_then(Item::as_str);
    if provider.is_some_and(|id| id != "openai") {
        return true;
    }
    // Only choose the cloud path for an actual ChatGPT session, never just an API key.
    let auth = std::fs::read(home.join("auth.json"))
        .ok()
        .filter(|bytes| bytes.len() <= 128 * 1024)
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    !auth.as_ref().is_some_and(|auth| {
        auth.get("OPENAI_API_KEY")
            .and_then(serde_json::Value::as_str)
            .is_none_or(|key| key.is_empty())
            && auth
                .pointer("/tokens/access_token")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|token| !token.is_empty())
    })
}

pub fn validate_local_context_companion(
    home: &Path,
    settings: &BackendSettings,
) -> anyhow::Result<()> {
    if !(settings.enhancements_enabled && settings.codex_app_experimental_context) {
        return Ok(());
    }
    let config = std::fs::read_to_string(home.join("config.toml"))?;
    if use_local_api_context(home, settings, &config)
        && !crate::context_api_config::companion_path()?.is_file()
    {
        anyhow::bail!("本地实验性上下文工具缺失，请使用完整 Alunixa X 安装包");
    }
    Ok(())
}

fn update_config(existing: &str, enabled: bool) -> anyhow::Result<String> {
    let has_bom = existing.starts_with('\u{feff}');
    let mut doc = match existing
        .trim_start_matches('\u{feff}')
        .parse::<DocumentMut>()
    {
        Ok(doc) => doc,
        // A disabled, optional feature must not repair or rewrite malformed user config.
        Err(_) if !enabled => return Ok(existing.to_string()),
        Err(error) => {
            return Err(error).context("实验性上下文：config.toml 格式无效，未修改原配置");
        }
    };

    if enabled {
        if !doc.contains_key("features") {
            let mut table = Table::new();
            table.set_implicit(true);
            doc["features"] = Item::Table(table);
        }
        let features = doc.get_mut("features").expect("features inserted");
        let inline = features.is_inline_table();
        let features = features
            .as_table_like_mut()
            .context("实验性上下文：features 必须是 TOML table，未覆盖原值")?;
        if !features.contains_key("context_management") {
            let item = if inline {
                Item::Value(Value::InlineTable(InlineTable::new()))
            } else {
                Item::Table(Table::new())
            };
            features.insert("context_management", item);
        }
        let context = features
            .get_mut("context_management")
            .and_then(Item::as_table_like_mut)
            .context("实验性上下文：features.context_management 必须是 TOML table，未覆盖原值")?;
        if context.get("experimental_mode").and_then(Item::as_bool) == Some(true) {
            return Ok(existing.to_string());
        }
        context.insert("experimental_mode", toml_edit::value(true));
    } else {
        let Some(features) = doc.get_mut("features").and_then(Item::as_table_like_mut) else {
            return Ok(existing.to_string());
        };
        let Some(context) = features
            .get_mut("context_management")
            .and_then(Item::as_table_like_mut)
        else {
            return Ok(existing.to_string());
        };
        if context.remove("experimental_mode").is_none() {
            return Ok(existing.to_string());
        }
        if context.is_empty() {
            features.remove("context_management");
        }
        if features.is_empty() {
            doc.remove("features");
        }
    }

    let mut updated = doc.to_string();
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    if existing.contains("\r\n") {
        updated = updated.replace("\r\n", "\n").replace('\n', "\r\n");
    }
    if has_bom {
        updated.insert(0, '\u{feff}');
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_settings() -> BackendSettings {
        BackendSettings {
            codex_app_experimental_context: true,
            ..BackendSettings::default()
        }
    }

    fn parse(contents: &str) -> toml::Value {
        contents.trim_start_matches('\u{feff}').parse().unwrap()
    }

    #[test]
    fn disabled_default_does_not_create_a_home_or_rewrite_config() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("unused");
        assert!(!apply_experimental_context_policy(&home, &BackendSettings::default()).unwrap());
        assert!(!home.exists());
        for original in [
            "# untouched\n",
            "[features]\ngoals = true\n",
            "invalid TOML [",
        ] {
            assert_eq!(update_config(original, false).unwrap(), original);
        }
    }

    #[test]
    fn enable_is_nested_boolean_idempotent_and_preserves_other_settings() {
        let original = r#"# user configuration
model = "custom-model"
model_provider = "custom"
model_context_window = 1000000
model_auto_compact_token_limit = 990000
[model_providers.custom]
base_url = "https://provider.example/v1"
requires_openai_auth = true
[features]
goals = true
[features.context_management]
future_option = "keep"
[mcp_servers.local]
command = "example-tool"
"#;
        let updated = update_config(original, true).unwrap();
        let mut enabled = parse(&updated);
        assert_eq!(
            enabled["features"]["context_management"]["experimental_mode"].as_bool(),
            Some(true)
        );
        enabled["features"]["context_management"]
            .as_table_mut()
            .unwrap()
            .remove("experimental_mode");
        assert_eq!(enabled, parse(original));
        assert!(updated.starts_with("# user configuration\n"));
        assert_eq!(update_config(&updated, true).unwrap(), updated);
        assert_eq!(
            parse(&update_config(&updated, false).unwrap()),
            parse(original)
        );
    }

    #[test]
    fn supports_dotted_keys_nested_tables_and_inline_tables_without_losing_siblings() {
        for original in [
            "features.context_management.experimental_mode = false\nfeatures.goals = true\n",
            "[features.context_management]\nexperimental_mode = false\n[features]\ngoals = true\n",
            "[features]\ngoals = true\ncontext_management = { experimental_mode = false, extra = 42 }\n",
            "features = { goals = true, context_management = { experimental_mode = false, extra = 42 } }\n",
            "features = { goals = true }\n",
        ] {
            let updated = update_config(original, true).unwrap();
            let parsed = parse(&updated);
            assert_eq!(
                parsed["features"]["context_management"]["experimental_mode"].as_bool(),
                Some(true)
            );
            assert_eq!(parsed["features"]["goals"].as_bool(), Some(true));
            assert_eq!(update_config(&updated, true).unwrap(), updated);
            let disabled = update_config(&updated, false).unwrap();
            let parsed = parse(&disabled);
            assert_eq!(parsed["features"]["goals"].as_bool(), Some(true));
            assert!(
                parsed["features"]
                    .get("context_management")
                    .and_then(|context| context.get("experimental_mode"))
                    .is_none()
            );
            if original.contains("extra = 42") {
                assert_eq!(
                    parsed["features"]["context_management"]["extra"].as_integer(),
                    Some(42)
                );
            }
        }
    }

    #[test]
    fn disabling_removes_only_the_managed_flag_and_empty_parent_tables() {
        for original in [
            "",
            "# keep\nmodel = \"test\"\n",
            "[features]\ngoals = true\n",
            "[features.context_management]\nfuture_option = true\n",
        ] {
            let enabled = update_config(original, true).unwrap();
            let disabled = update_config(&enabled, false).unwrap();
            assert_eq!(parse(&disabled), parse(original));
            assert_eq!(update_config(&disabled, false).unwrap(), disabled);
        }
    }

    #[test]
    fn preserves_bom_crlf_and_existing_enabled_bytes() {
        let original = "\u{feff}# keep\r\n[features]\r\ngoals = true\r\n";
        let updated = update_config(original, true).unwrap();
        assert!(updated.starts_with("\u{feff}# keep\r\n"));
        assert!(!updated.replace("\r\n", "").contains('\n'));
        assert_eq!(update_config(&updated, true).unwrap(), updated);
        let disabled = update_config(&updated, false).unwrap();
        assert!(disabled.starts_with("\u{feff}"));
        assert_eq!(parse(&disabled), parse(original));
    }

    #[test]
    fn invalid_toml_or_conflicting_table_types_are_not_overwritten() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.toml");
        for original in [
            "broken = [\n",
            "features = false\n",
            "[features]\ncontext_management = true\n",
        ] {
            std::fs::write(&config, original).unwrap();
            assert!(apply_experimental_context_policy(temp.path(), &enabled_settings()).is_err());
            assert_eq!(std::fs::read_to_string(&config).unwrap(), original);
        }
        std::fs::remove_file(&config).unwrap();
        std::fs::create_dir(&config).unwrap();
        assert!(apply_experimental_context_policy(temp.path(), &enabled_settings()).is_err());
    }

    #[test]
    fn saved_flag_survives_reload_and_master_switch_removes_the_effective_flag() {
        let temp = tempfile::tempdir().unwrap();
        let store = crate::settings::SettingsStore::new(temp.path().join("settings.json"));
        let home = temp.path().join("codex");
        store.save(&enabled_settings()).unwrap();
        let settings = store.load().unwrap();
        assert!(settings.codex_app_experimental_context);
        assert!(apply_experimental_context_policy(&home, &settings).unwrap());
        assert!(!apply_experimental_context_policy(&home, &settings).unwrap());
        let mut disabled_master = settings.clone();
        disabled_master.enhancements_enabled = false;
        assert!(apply_experimental_context_policy(&home, &disabled_master).unwrap());
        assert!(
            !std::fs::read_to_string(home.join("config.toml"))
                .unwrap()
                .contains("experimental_mode")
        );
        assert!(apply_experimental_context_policy(&home, &settings).unwrap());
        store
            .update(serde_json::json!({"codexAppExperimentalContext": false}))
            .unwrap();
        let settings = store.load().unwrap();
        assert!(!settings.codex_app_experimental_context);
        assert!(apply_experimental_context_policy(&home, &settings).unwrap());
    }

    #[test]
    fn legacy_settings_default_to_disabled_and_use_the_same_json_key_as_the_ui() {
        let legacy: BackendSettings = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(!legacy.codex_app_experimental_context);
        assert_eq!(
            serde_json::to_value(enabled_settings()).unwrap()["codexAppExperimentalContext"],
            true
        );
    }

    #[test]
    fn api_key_and_signed_out_modes_use_local_context_but_official_login_keeps_cloud_mode() {
        let temp = tempfile::tempdir().unwrap();
        let mut settings = enabled_settings();
        settings.relay_profiles_enabled = false;
        assert!(use_local_api_context(temp.path(), &settings, ""));
        std::fs::write(
            temp.path().join("auth.json"),
            r#"{"OPENAI_API_KEY":"fixture-only"}"#,
        )
        .unwrap();
        assert!(use_local_api_context(temp.path(), &settings, ""));
        std::fs::write(
            temp.path().join("auth.json"),
            r#"{"tokens":{"access_token":"fixture-only"}}"#,
        )
        .unwrap();
        assert!(!use_local_api_context(temp.path(), &settings, ""));
        assert!(use_local_api_context(
            temp.path(),
            &settings,
            "model_provider = 'custom'\n"
        ));
    }
}
