//! Isolated development fixture: never reads default settings or starts Codex/WE.
use alunixa_x_core::{
    assets, bridge, relay_config, settings::BackendSettings, wallpaper, wallpaper_scene,
};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    anyhow::ensure!(
        args.len() == 2,
        "wallpaper_fixture <serve|repair|attach|scene-script> <explicit fixture path>"
    );
    if args[0] == "repair" {
        println!(
            "REPAIRED={}",
            relay_config::repair_stale_feature_entries_in_home(Path::new(&args[1]))?
        );
        return Ok(());
    }
    if args[0] == "scene-script" {
        let input: Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
        println!(
            "{}",
            wallpaper_scene::capture_script(
                Path::new(input["engine"].as_str().unwrap()),
                Path::new(input["project"].as_str().unwrap()),
                input["title"].as_str().unwrap(),
                true,
            )
        );
        return Ok(());
    }
    if args[0] == "attach" {
        // Explicit fixture settings only: no default home/config, no launcher,
        // no real WE control. The Electron harness owns any native scene window.
        let input: Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
        let settings = BackendSettings {
            codex_app_image_overlay_enabled: true,
            codex_app_image_overlay_path: input["path"].as_str().unwrap().into(),
            codex_app_image_overlay_opacity: 100,
            codex_app_wallpaper_engine_path: input["engine"].as_str().unwrap_or("").into(),
            ..Default::default()
        };
        if let Some(port) = input["inspectorPort"].as_u64() {
            wallpaper_scene::start(u16::try_from(port)?, &settings);
        }
        let source = assets::renderer_script();
        let start = source
            .find("  function installAlunixaXImageOverlay()")
            .unwrap();
        let end = source
            .find("  function scheduleAlunixaXImageOverlay()")
            .unwrap();
        let script = format!(
            "window.__ALUNIXA_X_IMAGE_OVERLAY__={};\n\
             (()=>{{ const alunixaXImageOverlayId='alunixa-x-image-overlay';\n\
             const sendAlunixaXDiagnostic=(event,payload)=>{{window.fixtureEvents??=[];window.fixtureEvents.push({{event,payload}})}};\n\
             {}\nwindow.installWallpaper=installAlunixaXImageOverlay;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installAlunixaXImageOverlay,{{once:true}});else installAlunixaXImageOverlay();}})();",
            assets::image_overlay_config(1, &settings),
            &source[start..end],
        );
        let websocket = input["websocketUrl"].as_str().unwrap().to_owned();
        // This must be the same entry point used by the real data-aware
        // launcher, not a fixture-only wallpaper dispatcher.
        let disconnected = bridge::install_renderer_bridge_with_disconnect(
            &websocket,
            Arc::new(move |_, _| Box::pin(async { Ok(json!({"status":"ok"})) })),
            &[script],
            &settings,
        )
        .await?;
        println!("READY");
        if let Ok(reason) = disconnected.await {
            println!("DISCONNECTED: {reason}");
        }
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
