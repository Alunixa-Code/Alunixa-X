use alunixa_x_core::codex_auto_update::{
    CODEX_UPDATER_DISABLED_VALUE, CODEX_UPDATER_ENV, codex_updater_environment_value,
};
use alunixa_x_core::settings::BackendSettings;

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
fn retired_update_switch_does_not_return_as_an_available_gui_capability() {
    let source = include_str!("../../../apps/alunixa-x-manager/src/App.tsx");
    assert!(!source.contains("setPersistedEnhanceFlag(\"codexAppDisableAutoUpdate\""));
    assert!(source.contains("check_update"));
}

#[test]
fn retired_update_preference_is_not_replayed_by_the_new_launcher() {
    let source = include_str!("../src/launcher.rs");
    assert!(!source.contains("apply_codex_auto_update_policy"));
    assert!(source.contains("isolated_multi_instance"));
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
fn removed_wss_toggle_is_not_advertised_as_an_effective_native_control() {
    let source = include_str!("../../../apps/alunixa-x-manager/src/App.tsx");
    assert!(!source.contains("editNative(\"codexAppDisableWss\""));
    let manager = include_str!("../../../apps/alunixa-x-manager/src-tauri/src/commands.rs");
    assert!(manager.contains("apply_wss_policy_to_home("));
}

#[test]
fn launcher_never_replays_stale_native_capability_values_over_external_edits() {
    let source = include_str!("../src/launcher.rs");
    assert!(!source.contains("apply_wss_policy_to_home("));
    assert!(!source.contains("set_codex_sub_agent_max_threads_in_home("));
    let manager = include_str!("../../../apps/alunixa-x-manager/src-tauri/src/commands.rs");
    assert!(
        manager.contains("apply_wss_policy_to_home("),
        "explicit manager edits still apply"
    );
    assert!(manager.contains("set_codex_sub_agent_max_threads_in_home("));
}
