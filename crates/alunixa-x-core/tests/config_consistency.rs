use alunixa_x_core::relay_config::{
    ensure_active_protocol_proxy_config_in_home, normalize_config_text,
};
use alunixa_x_core::settings::{BackendSettings, RelayMode, RelayProfile};

#[test]
fn disabled_context_entries_remain_explicit_in_live_config() {
    let common = "[mcp_servers.fixture]\ncommand='not-executed'\ndisabled=true\n\
                  [plugins.'fixture@local']\nenabled=false\n";
    let text = alunixa_x_core::relay_config::sync_live_config_context_entries(
        "model='retained'\n",
        common,
    )
    .unwrap();
    let doc: toml::Value = text.parse().unwrap();
    let mcp = doc.get("mcp_servers").and_then(|v| v.get("fixture"));
    assert_eq!(
        mcp.and_then(|v| v.get("enabled"))
            .and_then(toml::Value::as_bool),
        Some(false)
    );
    assert!(mcp.and_then(|v| v.get("disabled")).is_none());
    assert_eq!(
        doc["plugins"]["fixture@local"]["enabled"].as_bool(),
        Some(false)
    );
}

#[test]
fn provider_switch_uses_live_hook_state_not_stale_profile_trust() {
    let dir = tempfile::tempdir().unwrap();
    let live = "model='old'\n[hooks.state.fixture]\ntrusted_hash='new-local-hash'\nenabled=false\n";
    std::fs::write(dir.path().join("config.toml"), live).unwrap();
    let profile = RelayProfile {
        config_contents:
            "model='new'\n[hooks.state.fixture]\ntrusted_hash='stale-hash'\nenabled=true\n\
                          [hooks.state.revoked]\ntrusted_hash='revoked-hash'\nenabled=true\n"
                .into(),
        ..Default::default()
    };
    alunixa_x_core::relay_config::apply_relay_profile_config_to_home_with_context(
        dir.path(),
        &profile,
        "",
    )
    .unwrap();
    let doc: toml::Value = std::fs::read_to_string(dir.path().join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(
        doc["hooks"]["state"]["fixture"]["trusted_hash"].as_str(),
        Some("new-local-hash")
    );
    assert_eq!(
        doc["hooks"]["state"]["fixture"]["enabled"].as_bool(),
        Some(false)
    );
    assert!(doc["hooks"]["state"].get("revoked").is_none());
}

#[test]
fn provider_switch_preserves_absence_of_native_preferences_and_hook_trust() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("config.toml"), "model='old'\n").unwrap();
    let profile = RelayProfile {
        config_contents: "model='new'\n[features]\nfast_mode=false\ngoals=false\n\
                          [agents]\nmax_threads=7\n[hooks.state.revoked]\nenabled=true\n"
            .into(),
        ..Default::default()
    };
    alunixa_x_core::relay_config::apply_relay_profile_config_to_home_with_context(
        dir.path(),
        &profile,
        "",
    )
    .unwrap();
    let doc: toml::Value = std::fs::read_to_string(dir.path().join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    for (section, key) in [
        ("features", "fast_mode"),
        ("features", "goals"),
        ("agents", "max_threads"),
        ("hooks", "state"),
    ] {
        assert!(
            doc.get(section).and_then(|v| v.get(key)).is_none(),
            "{section}.{key} was resurrected"
        );
    }
}

#[test]
fn raw_config_editor_can_revoke_hook_trust_without_automatic_restoration() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("config.toml"),
        "[hooks.state.fixture]\nenabled=true\n",
    )
    .unwrap();
    alunixa_x_core::relay_config::apply_relay_config_file_to_home(
        dir.path(),
        "model='user-edit'\n",
    )
    .unwrap();
    let doc: toml::Value = std::fs::read_to_string(dir.path().join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert!(doc.get("hooks").is_none());
}

#[test]
fn launch_and_login_reconciliation_preserve_native_defaults_and_external_values() {
    let dir = tempfile::tempdir().unwrap();
    let settings = BackendSettings {
        codex_app_fast_mode: false,
        codex_goals_enabled: false,
        codex_app_disable_wss: true,
        ..Default::default()
    };
    let config = "model_provider='custom'\n[features]\nfast_mode=true\ngoals=true\n[agents]\nmax_threads=3\n[model_providers.custom]\nsupports_websockets=true\n";
    std::fs::write(dir.path().join("config.toml"), config).unwrap();
    std::fs::write(dir.path().join("auth.json"), b"{\"fixture\":\"retained\"}").unwrap();
    for _ in 0..2 {
        alunixa_x_core::relay_config::sync_codex_agent_capabilities_in_home(dir.path(), &settings)
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("config.toml")).unwrap(),
            config
        );
        assert_eq!(
            std::fs::read(dir.path().join("auth.json")).unwrap(),
            b"{\"fixture\":\"retained\"}"
        );
    }
}

#[test]
fn repeated_mcp_tables_merge_instead_of_dropping_transport_fields() {
    let input = "[mcp_servers.node]\ncommand='node'\n[mcp_servers.node]\nargs=['repl']\n[mcp_servers.node.env]\nCUSTOM='retained'\n[mcp_servers]\n";
    let doc: toml::Value = normalize_config_text(input).parse().unwrap();
    assert_eq!(doc["mcp_servers"]["node"]["command"].as_str(), Some("node"));
    assert_eq!(doc["mcp_servers"]["node"]["args"][0].as_str(), Some("repl"));
    assert_eq!(
        doc["mcp_servers"]["node"]["env"]["CUSTOM"].as_str(),
        Some("retained")
    );
}

#[test]
fn valid_multiline_literals_and_arrays_of_tables_are_not_split() {
    let input = "x='''\n[not.a.table]\nhello\n'''\n[[agents.test]]\nx=1\n[[agents.test]]\nx=2\n";
    let before: toml::Value = input.parse().unwrap();
    let after: toml::Value = normalize_config_text(input).parse().unwrap();
    assert_eq!(before, after);
}

#[test]
fn invalid_text_is_retained_and_duplicate_root_last_value_wins() {
    assert_eq!(
        normalize_config_text("[unclosed\napi_key='fixture'"),
        "[unclosed\napi_key='fixture'"
    );
    let doc: toml::Value = normalize_config_text("model='old'\nmodel='new'\n")
        .parse()
        .unwrap();
    assert_eq!(doc["model"].as_str(), Some("new"));
}

#[test]
fn protocol_proxy_preflight_repairs_only_managed_transport_without_touching_auth() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("config.toml"), "model='fixture'\nmodel_provider='example'\n[model_providers.example]\nbase_url='https://upstream.test/v1'\nexperimental_bearer_token='fixture-only'\n").unwrap();
    std::fs::write(
        dir.path().join("auth.json"),
        b"{\"tokens\":\"fixture-only\"}",
    )
    .unwrap();
    let settings = BackendSettings {
        active_relay_id: "fixture".into(),
        relay_profiles: vec![RelayProfile {
            id: "fixture".into(),
            relay_mode: RelayMode::CustomModels,
            ..Default::default()
        }],
        ..Default::default()
    };
    assert!(ensure_active_protocol_proxy_config_in_home(dir.path(), &settings).unwrap());
    assert!(!ensure_active_protocol_proxy_config_in_home(dir.path(), &settings).unwrap());
    let after: toml::Value = std::fs::read_to_string(dir.path().join("config.toml"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(after["model_provider"].as_str(), Some("example"));
    assert_eq!(
        after["model_providers"]["example"]["experimental_bearer_token"].as_str(),
        Some("fixture-only")
    );
    assert_eq!(
        std::fs::read(dir.path().join("auth.json")).unwrap(),
        b"{\"tokens\":\"fixture-only\"}"
    );
    let disabled = BackendSettings {
        relay_profiles_enabled: false,
        ..settings
    };
    assert!(disabled.active_relay_uses_protocol_proxy());
    assert!(!ensure_active_protocol_proxy_config_in_home(dir.path(), &disabled).unwrap());
}
