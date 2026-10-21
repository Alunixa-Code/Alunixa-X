use alunixa_x_core::assets::injection_script_with_settings;
use alunixa_x_core::settings::{BackendSettings, SettingsStore};
use serde_json::{Value, json};

const RESTORED_AX_KEYS: &[&str] = &[
    "codexAppFastStartup",
    "codexAppForceChineseLocale",
    "codexAppNativeMenuLocalization",
    "codexAppZedRemoteOpen",
    "zedRemoteOpenStrategy",
    "zedRemoteProjectRegistryEnabled",
    "zedRemoteSyncToZedSettings",
    "codexAppUpstreamWorktreeCreate",
];

fn old_settings() -> Value {
    json!({
        "codexAppFastStartup": true,
        "codexAppForceChineseLocale": true, "codexAppNativeMenuLocalization": true,
        "codexAppZedRemoteOpen": true, "zedRemoteOpenStrategy": "addToFocusedWorkspace",
        "zedRemoteProjectRegistryEnabled": true, "zedRemoteSyncToZedSettings": true,
        "codexAppUpstreamWorktreeCreate": true, "codexAppNativeMenuPlacement": true,
        "codexAppStepwiseEnabled": true, "dictation": {"enabled": true},
        "preservedUnknownSetting": "keep",
    })
}

#[test]
fn restored_ax_preferences_survive_legacy_settings_loading() {
    let settings: BackendSettings = serde_json::from_value(old_settings()).unwrap();
    let serialized = serde_json::to_value(&settings).unwrap();
    for key in RESTORED_AX_KEYS {
        assert_eq!(serialized.get(*key), old_settings().get(*key), "{key}");
    }
    assert!(settings.codex_app_native_menu_placement);
    assert!(settings.codex_app_stepwise_enabled);
    assert!(settings.dictation.enabled);
    assert_eq!(serialized["codexAppFastStartup"], true);
    assert_eq!(serialized["codexAppForceChineseLocale"], true);
}

#[test]
fn updates_preserve_restored_ax_preferences_and_unrelated_user_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, serde_json::to_vec(&old_settings()).unwrap()).unwrap();
    let store = SettingsStore::new(path.clone());
    let updated = store.update(old_settings()).unwrap();
    let raw: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let serialized = serde_json::to_value(&updated).unwrap();
    for key in RESTORED_AX_KEYS {
        assert_eq!(serialized.get(*key), old_settings().get(*key), "{key}");
        assert_eq!(raw.get(*key), old_settings().get(*key), "{key}");
    }
    assert_eq!(raw["codexAppFastStartup"], true);
    assert_eq!(raw["codexAppForceChineseLocale"], true);
    assert_eq!(raw["preservedUnknownSetting"], "keep");
    assert!(updated.codex_app_native_menu_placement);
    assert!(updated.codex_app_stepwise_enabled);
    assert!(updated.dictation.enabled);
}

#[test]
fn explicit_language_and_fast_startup_settings_reach_guarded_runtime_configuration() {
    let settings: BackendSettings = serde_json::from_value(old_settings()).unwrap();
    let script = injection_script_with_settings(0, &settings);
    assert!(script.contains("__ALUNIXA_X_FORCE_CHINESE_LOCALE__"));
    assert!(script.contains("__alunixaXForceChineseLocaleInstalled"));
    assert!(!script.contains("installForceChineseLocalePatch"));
    assert!(script.contains("__ALUNIXA_X_FAST_STARTUP__"));
    assert!(script.contains("__alunixaXFastStartupInstalled"));
    assert!(script.contains("statsigTimeoutMs"));
    let disabled = injection_script_with_settings(
        0,
        &BackendSettings {
            enhancements_enabled: false,
            ..settings
        },
    );
    assert!(disabled.contains(r#"__ALUNIXA_X_FORCE_CHINESE_LOCALE__ = {"enabled":false"#));
}

#[test]
fn force_chinese_locale_defaults_to_false() {
    let settings = BackendSettings::default();
    assert!(!settings.codex_app_force_chinese_locale);

    let json = serde_json::to_value(&settings).expect("serialize default settings");
    assert_eq!(
        json.get("codexAppForceChineseLocale")
            .and_then(|v| v.as_bool()),
        Some(false),
        "default BackendSettings JSON should include codexAppForceChineseLocale = false"
    );
    assert_eq!(json["codexAppFastStartup"], false);
}

#[test]
fn force_chinese_locale_missing_from_old_json_defaults_to_false() {
    let json = serde_json::json!({
        "codexAppPath": "",
        "enhancementsEnabled": true,
    });

    let parsed: BackendSettings = serde_json::from_value(json)
        .expect("old settings JSON without codexAppForceChineseLocale should still load");
    assert!(
        !parsed.codex_app_force_chinese_locale,
        "用户从没勾过这个开关，升级后不该被替他们打开"
    );
}

#[test]
fn force_chinese_locale_true_round_trips_through_json() {
    let mut settings = BackendSettings::default();
    settings.codex_app_force_chinese_locale = true;

    let json = serde_json::to_value(&settings).expect("serialize");
    assert_eq!(
        json.get("codexAppForceChineseLocale")
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    let parsed: BackendSettings =
        serde_json::from_value(json).expect("deserialize codexAppForceChineseLocale");
    assert!(parsed.codex_app_force_chinese_locale);
}

#[test]
fn force_chinese_locale_config_follows_the_switch() {
    let mut settings = BackendSettings::default();
    settings.codex_app_force_chinese_locale = true;
    assert_eq!(
        alunixa_x_core::assets::force_chinese_locale_config(&settings),
        json!({ "enabled": true, "locale": "zh-CN" })
    );

    settings.codex_app_force_chinese_locale = false;
    assert_eq!(
        alunixa_x_core::assets::force_chinese_locale_config(&settings),
        json!({ "enabled": false, "locale": "zh-CN" })
    );
}

#[test]
fn force_chinese_locale_is_injected_and_retained_fast_startup_remains_explicit() {
    let settings: BackendSettings = serde_json::from_value(old_settings()).unwrap();
    let script = injection_script_with_settings(0, &settings);
    assert!(script.contains("window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__ = {\"enabled\":true,\"locale\":\"zh-CN\"}"));
    assert!(script.contains("installCodexPlusForceChineseLocale"));
    // 撤下后没有回来：清理 shim 和快速启动都不得再出现在产物里。
    assert!(script.contains("restoreCodexPlusManagedLocale"));
    assert!(script.contains("__ALUNIXA_X_FAST_STARTUP__"));
    assert!(script.contains("__alunixaXFastStartupInstalled"));
    assert!(!script.contains("window.__statsigReady = true"));
}
