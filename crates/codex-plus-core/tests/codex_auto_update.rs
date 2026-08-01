use codex_plus_core::codex_auto_update::{
    CODEX_UPDATER_DISABLED_VALUE, CODEX_UPDATER_ENV, codex_updater_environment_value,
};
use codex_plus_core::settings::BackendSettings;

#[test]
fn codex_auto_update_disable_defaults_to_false() {
    let settings = BackendSettings::default();
    assert!(!settings.codex_app_disable_auto_update);

    let json = serde_json::to_value(&settings).expect("serialize default settings");
    assert_eq!(
        json.get("codexAppDisableAutoUpdate")
            .and_then(|value| value.as_bool()),
        Some(false)
    );
}

#[test]
fn old_settings_without_codex_auto_update_control_keep_updates_enabled() {
    let settings: BackendSettings = serde_json::from_value(serde_json::json!({
        "codexAppPath": "",
        "enhancementsEnabled": true
    }))
    .expect("deserialize old settings");

    assert!(!settings.codex_app_disable_auto_update);
}

#[test]
fn codex_auto_update_disable_round_trips_through_json() {
    let settings = BackendSettings {
        codex_app_disable_auto_update: true,
        ..BackendSettings::default()
    };

    let json = serde_json::to_value(&settings).expect("serialize settings");
    assert_eq!(json["codexAppDisableAutoUpdate"], true);
    let parsed: BackendSettings = serde_json::from_value(json).expect("deserialize settings");
    assert!(parsed.codex_app_disable_auto_update);
}

#[test]
fn codex_auto_update_control_uses_the_official_codex_environment_gate() {
    assert_eq!(CODEX_UPDATER_ENV, "CODEX_SPARKLE_ENABLED");
    assert_eq!(CODEX_UPDATER_DISABLED_VALUE, "false");
    assert_eq!(
        codex_updater_environment_value(true),
        Some(CODEX_UPDATER_DISABLED_VALUE)
    );
    assert_eq!(codex_updater_environment_value(false), None);
}

#[test]
fn manager_exposes_a_persisted_codex_only_auto_update_switch() {
    let source = include_str!("../../../apps/codex-plus-manager/src/App.tsx");

    assert!(source.contains("codexAppDisableAutoUpdate: boolean"));
    assert!(source.contains("codexAppDisableAutoUpdate: false"));
    assert!(source.contains("关闭 Codex 自动更新"));
    assert!(source.contains("setPersistedEnhanceFlag(\"codexAppDisableAutoUpdate\", value)"));
    assert!(source.contains("不影响 Codex++ 自身的 GitHub Release 更新"));
}

#[test]
fn launcher_applies_the_codex_update_policy_before_starting_any_codex_variant() {
    let source = include_str!("../src/launcher.rs");

    let policy_index = source
        .find("apply_codex_auto_update_policy")
        .expect("launcher should apply the Codex update policy");
    let windows_activation_index = source
        .find("if cfg!(windows)")
        .expect("launcher should contain Windows packaged activation");
    assert!(policy_index < windows_activation_index);
    assert_eq!(
        source.matches("configure_codex_process_command").count(),
        2,
        "macOS open and portable/direct launches should both receive the updater environment"
    );
}

#[test]
fn disable_wss_setting_defaults_and_round_trips() {
    let settings = BackendSettings::default();
    assert!(!settings.codex_app_disable_wss);

    let mut enabled = settings.clone();
    enabled.codex_app_disable_wss = true;
    let json = serde_json::to_value(&enabled).expect("serialize settings");
    assert_eq!(json["codexAppDisableWss"], true);
    let parsed: BackendSettings = serde_json::from_value(json).expect("deserialize settings");
    assert!(parsed.codex_app_disable_wss);
}

#[test]
fn manager_exposes_persisted_disable_wss_switch() {
    let source = include_str!("../../../apps/codex-plus-manager/src/App.tsx");
    assert!(source.contains("codexAppDisableWss: boolean"));
    assert!(source.contains("禁用 WSS"));
    assert!(source.contains("setPersistedEnhanceFlag(\"codexAppDisableWss\", value)"));
}

#[test]
fn launcher_only_applies_disable_wss_when_codex_config_exists() {
    let source = include_str!("../src/launcher.rs");
    assert!(source.contains("settings.codex_app_disable_wss"));
    assert!(source.contains("home.join(\"config.toml\").is_file()"));
}
