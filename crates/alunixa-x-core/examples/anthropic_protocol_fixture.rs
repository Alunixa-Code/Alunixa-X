//! Isolated loopback fixture for exercising the production Helper with a Codex CLI.
use alunixa_x_core::launcher::{DefaultLaunchHooks, LaunchHooks};
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let state = PathBuf::from(std::env::var("ALUNIXA_X_STATE_HOME")?);
    let home = PathBuf::from(std::env::var("CODEX_HOME")?);
    anyhow::ensure!(std::env::var("ALUNIXA_X_MULTI_INSTANCE").as_deref() == Ok("1"));
    anyhow::ensure!(state.is_absolute() && home.is_absolute() && state != home);
    anyhow::ensure!(state.join("settings.json").is_file());
    anyhow::ensure!(home.join("config.toml").is_file());
    anyhow::ensure!(std::env::var("ALUNIXA_X_HELPER_BIND").as_deref() == Ok("127.0.0.1"));
    let port: u16 = std::env::args().nth(1).ok_or_else(|| anyhow::anyhow!("missing fixture port"))?.parse()?;
    anyhow::ensure!(port != 0);
    let hooks = DefaultLaunchHooks::default();
    hooks.start_helper(port).await?;
    println!("READY http://127.0.0.1:{port}/v1");
    let mut line = String::new();
    let _ = BufReader::new(tokio::io::stdin()).read_line(&mut line).await;
    hooks.shutdown_helper(port).await;
    Ok(())
}
