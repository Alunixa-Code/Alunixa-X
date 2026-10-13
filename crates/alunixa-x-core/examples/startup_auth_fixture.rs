//! Exercise real launch preparation in an explicitly marked disposable home.
use alunixa_x_core::launcher::{DefaultLaunchHooks, LaunchHooks};
use alunixa_x_core::relay_config::normalize_relay_profile_for_storage;
use alunixa_x_core::settings::{BackendSettings, RelayProfile};
use serde_json::{Value, json};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let home = PathBuf::from(std::env::var("CODEX_HOME")?);
    anyhow::ensure!(home.is_absolute() && home.join("fixture-owned").is_file());
    anyhow::ensure!(std::env::var("ALUNIXA_X_AUTH_FIXTURE").as_deref() == Ok("1"));
    let mut profile: RelayProfile =
        serde_json::from_slice(&std::fs::read(home.join("profile.json"))?)?;
    normalize_relay_profile_for_storage(&mut profile)?;
    let settings = BackendSettings {
        relay_profiles_enabled: true,
        active_relay_id: profile.id.clone(),
        relay_profiles: vec![profile],
        ..Default::default()
    };
    let hooks = DefaultLaunchHooks::default();
    hooks.apply_active_relay_profile(&settings).await?;
    hooks.ensure_active_protocol_proxy_config(&settings).await?;
    let auth: Value = serde_json::from_slice(&std::fs::read(home.join("auth.json"))?)?;
    println!(
        "{}",
        json!({
            "authMode":auth["auth_mode"],
            "apiKeyPresent":auth["OPENAI_API_KEY"].as_str().is_some_and(|key| !key.is_empty())
        })
    );
    Ok(())
}
