use alunixa_x_core::relay_config::{
    ensure_active_protocol_proxy_config_in_home, normalize_config_text,
};
use alunixa_x_core::settings::{BackendSettings, RelayMode, RelayProfile};

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
