use alunixa_x_core::launcher::{DefaultLaunchHooks, LaunchHooks};
use alunixa_x_core::relay_config::{
    apply_relay_profile_to_home_with_switch_rules,
    apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard,
    ensure_active_protocol_proxy_config_in_home, normalize_relay_profile_for_storage,
};
use alunixa_x_core::settings::{BackendSettings, RelayProfile};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::path::Path;
use std::sync::Mutex;

static HOME_LOCK: Mutex<()> = Mutex::new(());

struct FixtureHome(Option<OsString>);
impl FixtureHome {
    fn set(home: &Path) -> Self {
        let old = std::env::var_os("CODEX_HOME");
        unsafe { std::env::set_var("CODEX_HOME", home) };
        Self(old)
    }
}
impl Drop for FixtureHome {
    fn drop(&mut self) {
        unsafe {
            if let Some(old) = self.0.take() {
                std::env::set_var("CODEX_HOME", old);
            } else {
                std::env::remove_var("CODEX_HOME");
            }
        }
    }
}

fn custom_profile() -> RelayProfile {
    let mut profile: RelayProfile = serde_json::from_value(json!({
        "id":"startup-custom","name":"Isolated startup auth fixture",
        "relayMode":"customModels","defaultCustomModelId":"model",
        "customModels":[{
            "id":"model","model":"fixture-claude","baseUrl":"http://127.0.0.1:1/v1",
            "apiKey":"fixture-upstream-only","protocol":"anthropicMessages",
            "contextWindow":"200000"
        }]
    }))
    .unwrap();
    normalize_relay_profile_for_storage(&mut profile).unwrap();
    profile
}

fn auth(home: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(home.join("auth.json")).unwrap()).unwrap()
}

#[tokio::test]
async fn real_startup_hook_preserves_custom_model_api_login() {
    let _lock = HOME_LOCK.lock().unwrap();
    let home = tempfile::tempdir().unwrap();
    let _home = FixtureHome::set(home.path());
    let profile = custom_profile();
    let expected: Value = serde_json::from_str(&profile.auth_contents).unwrap();
    let settings = BackendSettings {
        relay_profiles_enabled: true,
        active_relay_id: profile.id.clone(),
        relay_profiles: vec![profile],
        ..Default::default()
    };
    DefaultLaunchHooks::default()
        .apply_active_relay_profile(&settings)
        .await
        .unwrap();
    assert_eq!(
        auth(home.path())["OPENAI_API_KEY"],
        expected["OPENAI_API_KEY"]
    );
    assert_eq!(auth(home.path())["auth_mode"], "apikey");
}

#[test]
fn custom_model_auth_survives_repeated_startup_and_proxy_preparation() {
    let home = tempfile::tempdir().unwrap();
    let profile = custom_profile();
    let expected: Value = serde_json::from_str(&profile.auth_contents).unwrap();
    let settings = BackendSettings {
        relay_profiles_enabled: true,
        active_relay_id: profile.id.clone(),
        relay_profiles: vec![profile.clone()],
        ..Default::default()
    };
    for _ in 0..3 {
        apply_relay_profile_to_home_with_switch_rules(home.path(), &profile, "").unwrap();
        ensure_active_protocol_proxy_config_in_home(home.path(), &settings).unwrap();
        assert_eq!(
            auth(home.path())["OPENAI_API_KEY"],
            expected["OPENAI_API_KEY"]
        );
        assert_eq!(auth(home.path())["auth_mode"], "apikey");
    }
}

#[test]
fn startup_and_manager_custom_model_apply_have_the_same_auth_contract() {
    let startup = tempfile::tempdir().unwrap();
    let manager = tempfile::tempdir().unwrap();
    let profile = custom_profile();
    apply_relay_profile_to_home_with_switch_rules(startup.path(), &profile, "").unwrap();
    apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard(
        manager.path(),
        &profile,
        "",
        false,
    )
    .unwrap();
    assert_eq!(auth(startup.path()), auth(manager.path()));
}

#[test]
fn startup_restores_custom_model_api_auth_in_a_fresh_home() {
    let home = tempfile::tempdir().unwrap();
    let profile = custom_profile();
    assert!(!home.path().join("auth.json").exists());
    apply_relay_profile_to_home_with_switch_rules(home.path(), &profile, "").unwrap();
    assert!(auth(home.path())["OPENAI_API_KEY"].as_str().unwrap().len() > 1);
    assert_eq!(auth(home.path())["auth_mode"], "apikey");
}

#[test]
fn legacy_custom_model_auth_without_mode_is_normalized_on_startup() {
    let home = tempfile::tempdir().unwrap();
    let mut profile = custom_profile();
    profile.auth_contents = json!({"OPENAI_API_KEY":"fixture-local-only"}).to_string();
    apply_relay_profile_to_home_with_switch_rules(home.path(), &profile, "").unwrap();
    assert_eq!(auth(home.path())["OPENAI_API_KEY"], "fixture-local-only");
    assert_eq!(auth(home.path())["auth_mode"], "apikey");
}

#[test]
fn invalid_custom_model_auth_does_not_overwrite_current_credentials() {
    let home = tempfile::tempdir().unwrap();
    let previous = json!({
        "auth_mode":"chatgpt","tokens":{"access_token":"fixture-preserved"},
        "fixtureMarker":"keep"
    });
    std::fs::write(home.path().join("auth.json"), previous.to_string()).unwrap();
    let mut profile = custom_profile();
    profile.auth_contents = "invalid-fixture-json".into();
    assert!(apply_relay_profile_to_home_with_switch_rules(home.path(), &profile, "").is_err());
    assert_eq!(auth(home.path()), previous);
}
