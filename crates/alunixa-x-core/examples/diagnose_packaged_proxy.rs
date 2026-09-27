#![cfg_attr(windows, windows_subsystem = "windows")]

use std::path::Path;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("--alunixa-x-proxy-probe") {
        return alunixa_x_core::packaged_proxy::run_probe_request(Path::new(&args[1]));
    }
    // Read-only; explicit app path prevents this harness from ever modifying normal configuration.
    let app = args
        .first()
        .ok_or_else(|| anyhow::anyhow!("Usage: diagnose_packaged_proxy <app-directory>"))?;
    let result = alunixa_x_core::packaged_proxy::inspect_or_repair(
        Path::new(app),
        &std::env::current_exe()?,
        "inspect",
        None,
        None,
    )
    .await;
    println!("{}", serde_json::to_string_pretty(&result)?);
    if result.packaged.is_none() {
        anyhow::bail!("packaged_view_unverified");
    }
    Ok(())
}
