use alunixa_x_core::settings::{BackendSettings, SettingsStore};
use serde_json::json;

#[test]
fn native_fast_unlock_requires_explicit_opt_in() {
    let defaults = BackendSettings::default();
    assert!(!defaults.codex_app_native_fast_unlock);
    assert_eq!(
        serde_json::to_value(defaults).unwrap()["codexAppNativeFastUnlock"],
        false
    );
    let legacy: BackendSettings =
        serde_json::from_value(json!({ "codexAppServiceTierControls": true })).unwrap();
    assert!(!legacy.codex_app_native_fast_unlock);
    assert_eq!(serde_json::to_value(legacy).unwrap()["codexAppServiceTierControls"], true);

    let imported: BackendSettings = serde_json::from_value(json!({
        "codexAppNativeFastUnlock": true,
        "codexAppServiceTierControls": false,
    }))
    .unwrap();
    assert!(imported.codex_app_native_fast_unlock);
    assert_eq!(serde_json::to_value(imported).unwrap()["codexAppServiceTierControls"], false);
}

#[test]
fn native_fast_unlock_and_retained_controls_persist_independently() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let store = SettingsStore::new(path.clone());
    let legacy = json!({ "codexAppServiceTierControls": true, "customField": 1 });
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();

    let settings = store
        .update(json!({ "codexAppServiceTierControls": true }))
        .unwrap();
    assert!(!settings.codex_app_native_fast_unlock);
    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(saved["codexAppServiceTierControls"], true);
    assert_eq!(saved["customField"], 1);

    let settings = store
        .update(json!({ "codexAppNativeFastUnlock": true }))
        .unwrap();
    assert!(settings.codex_app_native_fast_unlock);
    assert!(store.load().unwrap().codex_app_native_fast_unlock);

    let settings = store
        .update(json!({ "codexAppServiceTierControls": false }))
        .unwrap();
    assert!(settings.codex_app_native_fast_unlock);
    let settings = store
        .update(json!({ "codexAppNativeFastUnlock": false }))
        .unwrap();
    assert!(!settings.codex_app_native_fast_unlock);
    assert!(!store.load().unwrap().codex_app_native_fast_unlock);
    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(saved["codexAppServiceTierControls"], false);
}

#[test]
fn saving_retained_service_tier_does_not_enable_native_fast() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let legacy = json!({ "codexAppServiceTierControls": true, "customField": 1 });
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let store = SettingsStore::new(path.clone());
    let settings = store.load().unwrap();
    assert!(!settings.codex_app_native_fast_unlock);
    store.save(&settings).unwrap();

    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(saved["codexAppServiceTierControls"], true);
    assert_eq!(saved["codexAppNativeFastUnlock"], false);
    assert_eq!(saved["customField"], 1);
}
