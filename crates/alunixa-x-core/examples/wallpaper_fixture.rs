//! Isolated development fixture: never reads default settings or starts Codex/WE.
use alunixa_x_core::{relay_config, settings::BackendSettings, wallpaper};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(
        args.len() == 2,
        "wallpaper_fixture <serve|repair> <explicit fixture path>"
    );
    if args[0] == "repair" {
        println!(
            "REPAIRED={}",
            relay_config::repair_stale_feature_entries_in_home(Path::new(&args[1]))?
        );
        return Ok(());
    }
    anyhow::ensure!(args[0] == "serve", "unknown mode");
    let source = wallpaper::resolve(Path::new(&args[1]))?;
    let settings = BackendSettings {
        codex_app_image_overlay_enabled: true,
        codex_app_image_overlay_path: source.path.to_string_lossy().into(),
        ..Default::default()
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    println!("{}", listener.local_addr()?.port());
    loop {
        let (mut stream, _) = listener.accept().await?;
        let settings = settings.clone();
        tokio::spawn(async move {
            let mut buffer = vec![0; 16384];
            let mut length = 0;
            loop {
                let read = stream.read(&mut buffer[length..]).await?;
                length += read;
                if read == 0
                    || buffer[..length].windows(4).any(|v| v == b"\r\n\r\n")
                    || length == buffer.len()
                {
                    break;
                }
            }
            let header = String::from_utf8_lossy(&buffer[..length]);
            let mut request = header.lines().next().unwrap_or("").split_whitespace();
            let method = request.next().unwrap_or("");
            let path = request.next().unwrap_or("");
            let range = header
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.eq_ignore_ascii_case("range"))
                .map(|(_, v)| v.trim());
            wallpaper::serve(&mut stream, method, path, range, &settings).await?;
            stream.shutdown().await?;
            Ok::<(), anyhow::Error>(())
        });
    }
}
