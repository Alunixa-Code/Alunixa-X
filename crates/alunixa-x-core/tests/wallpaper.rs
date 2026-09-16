use alunixa_x_core::{
    assets,
    settings::{BackendSettings, SettingsStore},
    wallpaper,
};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn request(
    settings: BackendSettings,
    method: &str,
    path: &str,
    range: Option<&str>,
) -> Vec<u8> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let method = method.to_owned();
    let path = path.to_owned();
    let range = range.map(str::to_owned);
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        wallpaper::serve(&mut stream, &method, &path, range.as_deref(), &settings)
            .await
            .unwrap();
        stream.shutdown().await.unwrap();
    });
    let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).await.unwrap();
    server.await.unwrap();
    response
}

#[tokio::test]
async fn media_is_streamed_with_ranges_head_and_disabled_access() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("clip.webm");
    std::fs::write(&file, b"0123456789").unwrap();
    let mut settings = BackendSettings {
        codex_app_image_overlay_enabled: true,
        codex_app_image_overlay_path: file.to_string_lossy().into(),
        ..Default::default()
    };
    let config = assets::image_overlay_config(1234, &settings);
    assert_eq!(config["kind"], "video");
    assert_eq!(config["dataUrl"], "");
    assert_eq!(config["muted"], true);
    let range = String::from_utf8(
        request(
            settings.clone(),
            "GET",
            "/wallpaper/media",
            Some("bytes=2-5"),
        )
        .await,
    )
    .unwrap();
    assert!(range.starts_with("HTTP/1.1 206"));
    assert!(range.contains("Content-Range: bytes 2-5/10"));
    assert!(range.ends_with("\r\n\r\n2345"));
    let head = String::from_utf8(request(settings.clone(), "HEAD", "/wallpaper/media", None).await)
        .unwrap();
    assert!(head.contains("Content-Length: 10"));
    assert!(head.ends_with("\r\n\r\n"));
    let invalid = String::from_utf8(
        request(
            settings.clone(),
            "GET",
            "/wallpaper/media",
            Some("bytes=10-"),
        )
        .await,
    )
    .unwrap();
    assert!(invalid.starts_with("HTTP/1.1 416"));
    assert!(invalid.contains("Content-Range: bytes */10"));
    settings.codex_app_image_overlay_enabled = false;
    assert!(
        request(settings, "GET", "/wallpaper/media", None)
            .await
            .starts_with(b"HTTP/1.1 404")
    );
}

#[tokio::test]
async fn media_bridge_rejects_disabled_or_wrong_kind_without_connecting_to_cdp() {
    let tmp = tempfile::tempdir().unwrap();
    let media = tmp.path().join("selected.mp4");
    std::fs::write(&media, b"fixture").unwrap();
    let mut settings = BackendSettings {
        codex_app_image_overlay_path: media.to_string_lossy().into(),
        codex_app_image_overlay_enabled: false,
        ..Default::default()
    };
    let invalid_target = "not-a-cdp-target";
    assert!(
        wallpaper::handle_bridge_request("/wallpaper/media", invalid_target, &settings)
            .await
            .unwrap_err()
            .to_string()
            .contains("disabled")
    );
    settings.codex_app_image_overlay_enabled = true;
    for route in [
        "/wallpaper/scene",
        "/wallpaper/media?path=secret",
        "/wallpaper/other",
    ] {
        assert!(
            wallpaper::handle_bridge_request(route, invalid_target, &settings)
                .await
                .unwrap_err()
                .to_string()
                .contains("unsupported wallpaper resource")
        );
    }
}

#[tokio::test]
async fn retired_projects_only_serve_preview_images_never_scripts_or_window_ids() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("legacy");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("preview.jpg"), b"preview image bytes").unwrap();
    std::fs::write(root.join("index.html"), b"DO-NOT-EXECUTE").unwrap();
    std::fs::write(tmp.path().join("secret.jpg"), b"DO-NOT-SERVE").unwrap();
    for kind in ["Scene", "Web"] {
        std::fs::write(
            root.join("project.json"),
            serde_json::to_vec(&json!({
                "type":kind,"file":"index.html","preview":"preview.jpg"
            }))
            .unwrap(),
        )
        .unwrap();
        let resolved = wallpaper::resolve(&root).unwrap();
        assert_eq!(resolved.kind, "image");
        assert!(resolved.static_preview);
        let settings = BackendSettings {
            codex_app_image_overlay_enabled: true,
            codex_app_image_overlay_path: root.to_string_lossy().into(),
            ..Default::default()
        };
        let config = assets::image_overlay_config(1234, &settings);
        assert_eq!(config["kind"], "image");
        assert_eq!(config["staticPreview"], true);
        assert!(config.get("sceneUrl").is_none());
        let response = request(settings.clone(), "GET", "/wallpaper/media", None).await;
        assert!(response.starts_with(b"HTTP/1.1 200"));
        assert!(response.ends_with(b"preview image bytes"));
        for path in [
            "/wallpaper/scene",
            "/wallpaper/web/index.html",
            "/wallpaper/web/../secret.jpg",
            "/wallpaper/web/%2e%2e/secret.jpg",
        ] {
            let response = request(settings.clone(), "GET", path, None).await;
            assert!(response.starts_with(b"HTTP/1.1 404"));
            assert!(!String::from_utf8_lossy(&response).contains("DO-NOT-"));
        }
    }
}

#[test]
fn legacy_scene_preview_is_read_only_and_rejects_escape_or_non_images() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("scene");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("preview.png"), b"preview").unwrap();
    std::fs::write(root.join("index.html"), b"script").unwrap();
    std::fs::write(tmp.path().join("secret.png"), b"outside").unwrap();
    let project = root.join("project.json");
    let bytes = br#"{"type":"scene","file":"scene.json"}"#;
    std::fs::write(&project, bytes).unwrap();
    let source = wallpaper::resolve(&root).unwrap();
    assert!(source.static_preview);
    assert_eq!(source.entry.file_name().unwrap(), "preview.png");
    assert_eq!(std::fs::read(&project).unwrap(), bytes);
    // No scene.pkg/scene.json is opened or needed for the static fallback.
    for preview in [
        "../secret.png",
        r"..\secret.png",
        "index.html",
        "missing.png",
    ] {
        std::fs::write(
            &project,
            serde_json::to_vec(&json!({"type":"scene","preview":preview})).unwrap(),
        )
        .unwrap();
        assert!(wallpaper::resolve(&root).is_err(), "{preview}");
    }
}

#[test]
fn legacy_scene_without_preview_is_disabled_with_actionable_error() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("project.json"),
        br#"{"type":"scene","file":"scene.pkg"}"#,
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("scene.pkg"),
        b"native archive must not be opened",
    )
    .unwrap();
    let error = wallpaper::resolve(tmp.path()).unwrap_err().to_string();
    assert!(error.contains("上传图片或视频"));
    let settings = BackendSettings {
        codex_app_image_overlay_enabled: true,
        codex_app_image_overlay_path: tmp.path().to_string_lossy().into(),
        ..Default::default()
    };
    assert_eq!(assets::image_overlay_config(1, &settings)["enabled"], false);
}

#[test]
fn wallpaper_options_survive_partial_updates_and_reset_does_not_touch_providers() {
    let tmp = tempfile::tempdir().unwrap();
    let store = SettingsStore::new(tmp.path().join("settings.json"));
    let value = store
        .update(json!({
            "codexAppWallpaperMuted":false,"codexAppWallpaperPaused":true,
            "codexAppWallpaperEnginePath":"D:\\Steam\\wallpaper64.exe",
            "codexAppImageOverlayPath":"D:\\clip.mp4","codexAppImageOverlayEnabled":true
        }))
        .unwrap();
    assert!(!value.codex_app_wallpaper_muted);
    assert!(value.codex_app_wallpaper_paused);
    assert_eq!(store.load().unwrap(), value);
    let next = store
        .update(json!({"codexAppImageOverlayOpacity":42}))
        .unwrap();
    assert_eq!(
        next.codex_app_wallpaper_engine_path,
        value.codex_app_wallpaper_engine_path
    );
    assert!(!next.codex_app_wallpaper_muted);
}

#[test]
fn guardian_repairs_are_backed_up_and_provider_writes_cannot_restore_invalid_tables() {
    let tmp = tempfile::tempdir().unwrap();
    let source = "# keep\n[features.guardianv2]\nenabled=true\nthread_context='bad'\n[profiles.work.features]\nguardianv2={enabled=false, invalid=true}\n";
    std::fs::write(tmp.path().join("config.toml"), source).unwrap();
    assert!(
        alunixa_x_core::relay_config::repair_stale_feature_entries_in_home(tmp.path()).unwrap()
    );
    let backups: Vec<_> = std::fs::read_dir(tmp.path().join("alunixa-x-config-repair-backups"))
        .unwrap()
        .collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(
        std::fs::read_to_string(backups[0].as_ref().unwrap().path()).unwrap(),
        source
    );
    assert!(
        !alunixa_x_core::relay_config::repair_stale_feature_entries_in_home(tmp.path()).unwrap()
    );
    alunixa_x_core::relay_config::apply_relay_config_file_to_home(tmp.path(), source).unwrap();
    let text = std::fs::read_to_string(tmp.path().join("config.toml")).unwrap();
    assert!(!text.contains("thread_context"));
    assert!(!text.contains("invalid=true"));
    let value: toml::Value = text.parse().unwrap();
    assert_eq!(
        value["features"]["guardianv2"]["enabled"].as_bool(),
        Some(true)
    );
    assert_eq!(
        value["profiles"]["work"]["features"]["guardianv2"]["enabled"].as_bool(),
        Some(false)
    );
}
