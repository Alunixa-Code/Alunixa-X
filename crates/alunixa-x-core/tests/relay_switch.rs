use alunixa_x_core::relay_switch::switch_relay_profile_in_home;

#[test]
fn retired_context_cannot_return_after_provider_switch_even_with_master_disabled() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let mut profile = pure_profile("custom", "https://provider.example/v1", "test-key");
    profile.config_contents.push_str("\n[features.token_budget]\nenabled = true\n[features.context_management]\nexperimental_mode = true\n[mcp_servers.alunixa-x-context]\ncommand = 'retired'\n");
    let mut settings = BackendSettings {
        active_relay_id: "custom".to_string(),
        relay_profiles: vec![profile],
        ..BackendSettings::default()
    };
    store.save(&settings).unwrap();
    let result = switch_relay_profile_in_home(&store, &home, settings.clone(), "").unwrap();
    assert!(
        !result.settings.relay_profiles[0]
            .config_contents
            .contains("token_budget")
    );
    let config: toml::Value = std::fs::read_to_string(home.join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert!(!config.to_string().contains("experimental_mode"));
    assert!(!config.to_string().contains("token_budget"));
    assert!(!config.to_string().contains("alunixa-x-context"));
    assert!(config.get("model_provider").is_some());

    settings.enhancements_enabled = false;
    switch_relay_profile_in_home(&store, &home, settings, "").unwrap();
    let config = std::fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(!config.contains("experimental_mode"));
    assert!(
        serde_json::to_value(store.load().unwrap())
            .unwrap()
            .get("codexAppExperimentalContext")
            .is_none()
    );
}
use alunixa_x_core::settings::{
    AggregateRelayMember, AggregateRelayProfile, AggregateRelayStrategy, BackendSettings,
    CustomRelayModel, LaunchMode, RelayMode, RelayProfile, SettingsStore,
};

#[test]
fn switch_rolls_back_active_settings_when_live_write_fails() {
    let temp = tempfile::tempdir().unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let original = BackendSettings {
        active_relay_id: "a".to_string(),
        relay_profiles: vec![pure_profile("a", "https://a.example/v1", "sk-a")],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();
    std::fs::create_dir(temp.path().join("codex")).unwrap();
    std::fs::write(
        temp.path().join("codex").join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-a"}"#,
    )
    .unwrap();
    std::fs::write(
        temp.path().join("codex").join("config.toml"),
        r#"model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "https://a.example/v1"
"#,
    )
    .unwrap();
    let next = BackendSettings {
        active_relay_id: "b".to_string(),
        relay_profiles: vec![
            pure_profile("a", "https://a.example/v1", "sk-a"),
            RelayProfile {
                id: "b".to_string(),
                name: "B".to_string(),
                relay_mode: RelayMode::PureApi,
                config_contents: "model_provider = \"custom\"\n".to_string(),
                auth_contents: "{bad json".to_string(),
                ..RelayProfile::default()
            },
        ],
        ..BackendSettings::default()
    };

    let error = switch_relay_profile_in_home(&store, &temp.path().join("codex"), next, "a")
        .expect_err("invalid auth should fail switch");

    assert!(error.to_string().contains("auth.json"));
    assert_eq!(store.load().unwrap().active_relay_id, "a");
    let live_config =
        std::fs::read_to_string(temp.path().join("codex").join("config.toml")).unwrap();
    let live_auth = std::fs::read_to_string(temp.path().join("codex").join("auth.json")).unwrap();
    assert!(live_config.contains("https://a.example/v1"));
    assert_eq!(live_auth, r#"{"OPENAI_API_KEY":"sk-a"}"#);
}

#[test]
fn switch_backfills_previous_profile_from_live_before_selecting_target() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        r#"model = "edited-live-model"
model_provider = "manual_a"
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.manual_a]
name = "manual_a"
wire_api = "responses"
requires_openai_auth = true
base_url = "https://edited-a.example/v1"
"#,
    )
    .unwrap();
    std::fs::write(
        home.join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-edited-a"}"#,
    )
    .unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let original = BackendSettings {
        active_relay_id: "a".to_string(),
        relay_profiles: vec![
            pure_profile("a", "https://a.example/v1", "sk-a"),
            pure_profile("b", "https://b.example/v1", "sk-b"),
        ],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();
    let next = BackendSettings {
        active_relay_id: "b".to_string(),
        relay_profiles: original.relay_profiles.clone(),
        ..BackendSettings::default()
    };

    switch_relay_profile_in_home(&store, &home, next, "a").unwrap();

    let stored = store.load().unwrap();
    let previous = stored
        .relay_profiles
        .iter()
        .find(|profile| profile.id == "a")
        .unwrap();
    assert!(previous.config_contents.contains("edited-live-model"));
    assert!(previous.config_contents.contains("manual_a"));
    assert_eq!(previous.context_window, "1000000");
    assert_eq!(previous.auto_compact_limit, "900000");
    assert_eq!(stored.active_relay_id, "b");
    assert_eq!(stored.launch_mode, LaunchMode::Patch);
}

#[test]
fn switch_to_aggregate_relay_allows_empty_config_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let api = pure_profile("api", "https://api.example/v1", "sk-api");
    let aggregate = RelayProfile {
        id: "agg".to_string(),
        name: "聚合供应商 1".to_string(),
        relay_mode: RelayMode::Aggregate,
        config_contents: String::new(),
        auth_contents: String::new(),
        ..RelayProfile::default()
    };
    let original = BackendSettings {
        active_relay_id: "api".to_string(),
        relay_profiles: vec![api.clone(), aggregate.clone()],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();
    let next = BackendSettings {
        active_relay_id: "agg".to_string(),
        relay_profiles: vec![api, aggregate],
        aggregate_relay_profiles: vec![AggregateRelayProfile {
            id: "agg".to_string(),
            name: "聚合供应商 1".to_string(),
            strategy: AggregateRelayStrategy::Failover,
            members: vec![AggregateRelayMember {
                relay_id: "api".to_string(),
                weight: 1,
            }],
        }],
        active_aggregate_relay_id: "agg".to_string(),
        ..BackendSettings::default()
    };

    let result = switch_relay_profile_in_home(&store, &home, next, "api").unwrap();
    let live = std::fs::read_to_string(home.join("config.toml")).unwrap();

    assert!(result.configured);
    assert_eq!(store.load().unwrap().active_relay_id, "agg");
    assert!(live.contains(r#"base_url = "http://127.0.0.1:57321/v1""#));
}

#[test]
fn switch_returns_normalized_previous_official_profile_after_backfill() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        r#"model = "gpt-5.5"
model_reasoning_effort = "high"
model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "https://third-party.example/v1"

[features]
goals = true
"#,
    )
    .unwrap();
    std::fs::write(
        home.join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-third-party"}"#,
    )
    .unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let official = RelayProfile {
        id: "official".to_string(),
        name: "官方".to_string(),
        relay_mode: RelayMode::Official,
        official_mix_api_key: false,
        auth_contents: r#"{"auth_mode":"chatgpt","tokens":{"access_token":"official"}}"#
            .to_string(),
        ..RelayProfile::default()
    };
    let pure = pure_profile("api", "https://third-party.example/v1", "sk-third-party");
    let original = BackendSettings {
        active_relay_id: "official".to_string(),
        relay_profiles: vec![official.clone(), pure.clone()],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();
    let next = BackendSettings {
        active_relay_id: "api".to_string(),
        relay_profiles: vec![official, pure],
        ..BackendSettings::default()
    };

    let result = switch_relay_profile_in_home(&store, &home, next, "official").unwrap();
    let returned = result
        .settings
        .relay_profiles
        .iter()
        .find(|profile| profile.id == "official")
        .unwrap();

    assert_eq!(returned.relay_mode, RelayMode::Official);
    assert!(!returned.official_mix_api_key);
    assert!(returned.config_contents.is_empty());
    assert!(returned.api_key.is_empty());
}

#[test]
fn switch_does_not_backfill_custom_models_profile_from_proxy_live_files() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        r#"model = "grok-4.5"
model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:57321/v1"
experimental_bearer_token = "alunixa-x-custom"
"#,
    )
    .unwrap();
    std::fs::write(
        home.join("auth.json"),
        r#"{"auth_mode":"apikey","OPENAI_API_KEY":"alunixa-x-custom"}"#,
    )
    .unwrap();

    let custom = custom_models_profile("custom-models");
    let pure = pure_profile("api", "https://api.example/v1", "sk-api");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let original = BackendSettings {
        active_relay_id: "custom-models".to_string(),
        relay_profiles: vec![custom.clone(), pure.clone()],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();

    let next = BackendSettings {
        active_relay_id: "api".to_string(),
        relay_profiles: vec![custom, pure],
        ..BackendSettings::default()
    };
    switch_relay_profile_in_home(&store, &home, next, "custom-models").unwrap();

    let stored = store.load().unwrap();
    let preserved = stored
        .relay_profiles
        .iter()
        .find(|profile| profile.id == "custom-models")
        .unwrap();
    assert_eq!(preserved.relay_mode, RelayMode::CustomModels);
    assert_eq!(preserved.custom_models.len(), 2);
    assert_eq!(preserved.custom_models[0].model, "grok-4.5");
    assert_eq!(preserved.custom_models[0].api_key, "provider-key");
    assert_eq!(preserved.custom_models[1].model, "gpt-5.6-sol");
    assert_eq!(preserved.default_custom_model_id, "grok");
}

#[test]
fn reselecting_active_custom_models_profile_does_not_wipe_custom_models() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        r#"model = "grok-4.5"
model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:57321/v1"
experimental_bearer_token = "alunixa-x-custom"
"#,
    )
    .unwrap();
    std::fs::write(
        home.join("auth.json"),
        r#"{"auth_mode":"apikey","OPENAI_API_KEY":"alunixa-x-custom"}"#,
    )
    .unwrap();

    let custom = custom_models_profile("custom-models");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let settings = BackendSettings {
        active_relay_id: "custom-models".to_string(),
        relay_profiles: vec![custom.clone()],
        ..BackendSettings::default()
    };
    store.save(&settings).unwrap();

    // Frontend used to backfill the same active profile before re-applying it.
    let mut corrupted = settings.clone();
    let previous = corrupted
        .relay_profiles
        .iter_mut()
        .find(|profile| profile.id == "custom-models")
        .unwrap();
    alunixa_x_core::relay_config::backfill_relay_profile_from_home_with_common(
        &home,
        previous,
        &mut corrupted.relay_context_config_contents,
    )
    .unwrap();
    assert_eq!(previous.relay_mode, RelayMode::CustomModels);
    assert_eq!(previous.custom_models.len(), 2);

    switch_relay_profile_in_home(&store, &home, corrupted, "custom-models").unwrap();

    let stored = store.load().unwrap();
    let preserved = stored
        .relay_profiles
        .iter()
        .find(|profile| profile.id == "custom-models")
        .unwrap();
    assert_eq!(stored.active_relay_id, "custom-models");
    assert_eq!(preserved.relay_mode, RelayMode::CustomModels);
    assert_eq!(preserved.custom_models.len(), 2);
    assert_eq!(preserved.custom_models[1].model, "gpt-5.6-sol");
}

#[test]
fn explicit_default_model_selection_wins_over_older_runtime_selection() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let mut original_profile = custom_models_profile("custom");
    original_profile.record_last_used_model("grok-4.5");
    let original = BackendSettings {
        active_relay_id: "custom".to_string(),
        relay_profiles: vec![original_profile],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();

    let mut selected_profile = custom_models_profile("custom");
    selected_profile.record_last_used_model("gpt-5.6-sol");
    let next = BackendSettings {
        active_relay_id: "custom".to_string(),
        relay_profiles: vec![selected_profile],
        ..BackendSettings::default()
    };

    switch_relay_profile_in_home(&store, &home, next, "custom").unwrap();

    let stored = store.load().unwrap();
    let selected = stored.active_relay_profile();
    assert_eq!(selected.last_used_model, "gpt-5.6-sol");
    assert_eq!(selected.model, "gpt-5.6-sol");
    assert_eq!(selected.default_custom_model_id, "sol");
    let live = std::fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(live.contains(r#"model = "gpt-5.6-sol""#));
}

#[test]
fn switch_captures_safe_app_state_before_writing_provider_config() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(
        home.join(".codex-global-state.json"),
        serde_json::json!({
            "electron-saved-workspace-roots": ["C:/work/app"],
            "prompt-history": ["do-not-copy"],
            "electron-persisted-atom-state": {
                "default-service-tier": "priority",
                "provider-token-cache": "do-not-copy"
            }
        })
        .to_string(),
    )
    .unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let original = BackendSettings {
        active_relay_id: "a".to_string(),
        relay_profiles: vec![
            pure_profile("a", "https://a.example/v1", "sk-a"),
            pure_profile("b", "https://b.example/v1", "sk-b"),
        ],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();
    let next = BackendSettings {
        active_relay_id: "b".to_string(),
        relay_profiles: original.relay_profiles.clone(),
        ..BackendSettings::default()
    };

    switch_relay_profile_in_home(&store, &home, next, "a").unwrap();

    let snapshot: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            home.join("backups_state")
                .join("app-state-sync")
                .join("latest-safe-state.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        snapshot["state"]["electron-saved-workspace-roots"],
        serde_json::json!(["C:\\work\\app"])
    );
    assert_eq!(
        snapshot["state"]["electron-persisted-atom-state"]["default-service-tier"],
        "priority"
    );
    assert!(snapshot["state"].get("prompt-history").is_none());
    assert!(
        snapshot["state"]["electron-persisted-atom-state"]
            .get("provider-token-cache")
            .is_none()
    );
}

fn pure_profile(id: &str, base_url: &str, key: &str) -> RelayProfile {
    RelayProfile {
        id: id.to_string(),
        name: id.to_uppercase(),
        relay_mode: RelayMode::PureApi,
        config_contents: format!(
            r#"model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "{base_url}"
"#
        ),
        auth_contents: format!(r#"{{"OPENAI_API_KEY":"{key}"}}"#),
        ..RelayProfile::default()
    }
}

fn custom_models_profile(id: &str) -> RelayProfile {
    RelayProfile {
        id: id.to_string(),
        name: "Custom Models".to_string(),
        relay_mode: RelayMode::CustomModels,
        model: "grok-4.5".to_string(),
        config_contents: r#"model = "grok-4.5"
model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:57321/v1"
experimental_bearer_token = "alunixa-x-custom"
"#
        .to_string(),
        auth_contents: r#"{"auth_mode":"apikey","OPENAI_API_KEY":"alunixa-x-custom"}"#.to_string(),
        custom_models: vec![
            CustomRelayModel {
                id: "grok".to_string(),
                model: "grok-4.5".to_string(),
                base_url: "https://example.test/v1".to_string(),
                api_key: "provider-key".to_string(),
                context_window: "500000".to_string(),
                auto_compact_enabled: true,
                auto_compact_percent: 80,
                ..CustomRelayModel::default()
            },
            CustomRelayModel {
                id: "sol".to_string(),
                model: "gpt-5.6-sol".to_string(),
                base_url: "https://example.test/v1".to_string(),
                api_key: "provider-key".to_string(),
                context_window: "353000".to_string(),
                auto_compact_enabled: true,
                auto_compact_percent: 80,
                ..CustomRelayModel::default()
            },
        ],
        default_custom_model_id: "grok".to_string(),
        ..RelayProfile::default()
    }
}

#[test]
fn saving_active_custom_window_updates_catalog_and_preserves_external_instructions() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let settings = BackendSettings {
        active_relay_id: "custom".into(),
        relay_profiles: vec![custom_models_profile("custom")],
        ..BackendSettings::default()
    };
    switch_relay_profile_in_home(&store, &home, settings, "").unwrap();
    let config_path = home.join("config.toml");
    let original = std::fs::read_to_string(&config_path).unwrap();
    let manual = format!(
        "model_instructions_file = 'external.md'\nmodel_context_window = 777000\n{}",
        original
    );
    std::fs::write(&config_path, manual).unwrap();
    std::fs::write(home.join("external.md"), "Keep this external prompt.").unwrap();
    let mut edited = store.load().unwrap();
    edited.relay_profiles[0].custom_models[0].context_window = "1050000".into();
    edited.relay_profiles[0].custom_models[0].auto_compact_limit = "1000000".into();

    let result = switch_relay_profile_in_home(&store, &home, edited, "custom").unwrap();
    let live: toml::Value = std::fs::read_to_string(&config_path)
        .unwrap()
        .parse()
        .unwrap();
    assert!(live.get("model_context_window").is_none());
    assert!(live.get("model_auto_compact_token_limit").is_none());
    assert_eq!(
        live["model_instructions_file"].as_str(),
        Some("external.md")
    );
    assert!(result.backup_path.is_some());
    assert_eq!(
        store.load().unwrap().relay_profiles[0].context_window,
        "1050000"
    );
    let catalog: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(home.join(live["model_catalog_json"].as_str().unwrap())).unwrap(),
    )
    .unwrap();
    let selected = catalog["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|model| model["slug"] == "grok-4.5")
        .unwrap();
    assert_eq!(selected["context_window"], 1_050_000);
    assert_eq!(selected["auto_compact_token_limit"], 1_000_000);
    assert_eq!(
        std::fs::read_to_string(home.join("external.md")).unwrap(),
        "Keep this external prompt."
    );
}

#[test]
fn clearing_selected_custom_window_removes_stale_root_and_summary() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let settings = BackendSettings {
        active_relay_id: "custom".into(),
        relay_profiles: vec![custom_models_profile("custom")],
        ..BackendSettings::default()
    };
    switch_relay_profile_in_home(&store, &home, settings, "").unwrap();
    let mut edited = store.load().unwrap();
    let model = &mut edited.relay_profiles[0].custom_models[0];
    model.context_window.clear();
    model.auto_compact_enabled = false;
    model.auto_compact_limit.clear();
    switch_relay_profile_in_home(&store, &home, edited, "custom").unwrap();
    let live: toml::Value = std::fs::read_to_string(home.join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert!(live.get("model_context_window").is_none());
    assert!(live.get("model_auto_compact_token_limit").is_none());
    let saved = store.load().unwrap().active_relay_profile();
    assert!(saved.context_window.is_empty());
    assert!(!saved.auto_compact_enabled);
    assert!(saved.auto_compact_limit.is_empty());
}

#[test]
fn custom_window_units_save_as_numeric_catalog_when_compaction_is_disabled() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let mut profile = custom_models_profile("custom");
    profile.custom_models[0].context_window = "1.05M".into();
    profile.custom_models[0].auto_compact_enabled = false;
    let settings = BackendSettings {
        active_relay_id: "custom".into(),
        relay_profiles: vec![profile],
        ..BackendSettings::default()
    };
    switch_relay_profile_in_home(&store, &home, settings, "").unwrap();
    let live: toml::Value = std::fs::read_to_string(home.join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert!(live.get("model_context_window").is_none());
    assert!(live.get("model_auto_compact_token_limit").is_none());
    let catalog: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(home.join(live["model_catalog_json"].as_str().unwrap())).unwrap(),
    )
    .unwrap();
    let selected = catalog["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|model| model["slug"] == "grok-4.5")
        .unwrap();
    assert_eq!(selected["context_window"], 1_050_000);
    assert!(selected["auto_compact_token_limit"].is_null());
    let saved = store.load().unwrap().active_relay_profile();
    assert_eq!(saved.context_window, "1050000");
    assert!(!saved.auto_compact_enabled);
    assert!(saved.auto_compact_limit.is_empty());
}

#[test]
fn editing_other_custom_model_updates_its_catalog_without_switching_startup_model() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let settings = BackendSettings {
        active_relay_id: "custom".into(),
        relay_profiles: vec![custom_models_profile("custom")],
        ..BackendSettings::default()
    };
    switch_relay_profile_in_home(&store, &home, settings, "").unwrap();
    let mut edited = store.load().unwrap();
    edited.relay_profiles[0].custom_models[1].context_window = "1050000".into();
    edited.relay_profiles[0].custom_models[1].auto_compact_limit = "1000000".into();
    switch_relay_profile_in_home(&store, &home, edited, "custom").unwrap();
    let live: toml::Value = std::fs::read_to_string(home.join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(live["model"].as_str(), Some("grok-4.5"));
    assert!(live.get("model_context_window").is_none());
    assert!(live.get("model_auto_compact_token_limit").is_none());
    let catalog: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(home.join(live["model_catalog_json"].as_str().unwrap())).unwrap(),
    )
    .unwrap();
    let other = catalog["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["slug"] == "gpt-5.6-sol")
        .unwrap();
    assert_eq!(other["context_window"], 1_050_000);
    assert_eq!(other["auto_compact_token_limit"], 1_000_000);
}
