//! Explicit, deletion-only migration utility; does not start Codex, helper or MCP.
use alunixa_x_core::retired_context;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let args = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    anyhow::ensure!(
        args.len() == 2,
        "Usage: retire_context <CODEX_HOME> <settings.json>"
    );
    // Preflight both files before the first write.
    if let Ok(text) = std::fs::read_to_string(args[0].join("config.toml")) {
        retired_context::strip_config(&text)?;
    }
    if let Ok(text) = std::fs::read_to_string(&args[1]) {
        let mut value = serde_json::from_str(text.trim_start_matches('\u{feff}'))?;
        retired_context::strip_settings_value(&mut value)?;
    }
    let config = retired_context::remove_from_home(&args[0])?;
    let settings =
        alunixa_x_core::settings::SettingsStore::new(args[1].clone()).remove_retired_context()?;
    println!("CodexConfigCleaned={config}\nSettingsCleaned={settings}");
    Ok(())
}
