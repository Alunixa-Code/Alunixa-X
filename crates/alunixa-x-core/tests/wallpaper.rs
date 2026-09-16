use alunixa_x_core::{
    assets,
    settings::{BackendSettings, SettingsStore},
    wallpaper,
};
use base64::Engine;
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
async fn web_projects_are_sandboxed_and_cannot_read_outside_resources() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("web");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("index.html"), b"<html>fixture</html>").unwrap();
    std::fs::write(
        root.join("project.json"),
        br#"{"type":"web","file":"index.html"}"#,
    )
    .unwrap();
    std::fs::write(tmp.path().join("secret.json"), b"DO-NOT-SERVE").unwrap();
    let settings = BackendSettings {
        codex_app_image_overlay_enabled: true,
        codex_app_image_overlay_path: root.to_string_lossy().into(),
        ..Default::default()
    };
    let html = String::from_utf8(
        request(settings.clone(), "GET", "/wallpaper/web/index.html", None).await,
    )
    .unwrap();
    assert!(html.contains("sandbox allow-scripts"));
    assert!(html.contains("connect-src http://127.0.0.1:"));
    assert!(html.contains("/wallpaper/web/; frame-src 'none'"));
    assert!(!html.contains("'self'"));
    assert!(!html.contains("allow-same-origin"));
    for path in [
        "/wallpaper/web/../secret.json",
        "/wallpaper/web/%2e%2e/secret.json",
        "/wallpaper/web/%2e%2e%5csecret.json",
        "/wallpaper/media",
    ] {
        let response = request(settings.clone(), "GET", path, None).await;
        assert!(response.starts_with(b"HTTP/1.1 404"));
        assert!(!String::from_utf8_lossy(&response).contains("DO-NOT-SERVE"));
    }
}

fn header<'a>(response: &'a serde_json::Value, name: &str) -> Option<&'a str> {
    response["responseHeaders"]
        .as_array()?
        .iter()
        .find(|h| h["name"] == name)?["value"]
        .as_str()
}

async fn cdp_resource(
    settings: &BackendSettings,
    method: &str,
    url: &str,
    range: &str,
) -> serde_json::Value {
    wallpaper::cdp_response(
        &json!({
            "requestId":"fixture",
            "request":{"method":method,"url":url,"headers":{"rAnGe":range}},
        }),
        settings,
    )
    .await
}

#[tokio::test]
async fn same_origin_transport_bounds_media_and_preserves_seek_head_and_disabled_access() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("clip.webm");
    let bytes = vec![42; wallpaper::CDP_MEDIA_CHUNK as usize + 23];
    std::fs::write(&file, &bytes).unwrap();
    let mut settings = BackendSettings {
        codex_app_image_overlay_enabled: true,
        codex_app_image_overlay_path: file.to_string_lossy().into(),
        ..Default::default()
    };
    let config = assets::image_overlay_config(1234, &settings);
    let url = config["sourceUrl"].as_str().unwrap();
    assert!(url.starts_with(wallpaper::APP_RESOURCE_BASE));
    assert!(!url.contains("http:"));
    assert_eq!(config["dataUrl"], "");
    let first = cdp_resource(&settings, "GET", url, "bytes=0-").await;
    assert_eq!(first["responseCode"], 206);
    assert_eq!(header(&first, "Content-Length"), Some("4194304"));
    let body = base64::engine::general_purpose::STANDARD
        .decode(first["body"].as_str().unwrap())
        .unwrap();
    assert_eq!(body, bytes[..wallpaper::CDP_MEDIA_CHUNK as usize]);
    let tail = cdp_resource(&settings, "GET", url, "bytes=4194304-").await;
    assert_eq!(
        header(&tail, "Content-Range"),
        Some("bytes 4194304-4194326/4194327")
    );
    let head = cdp_resource(&settings, "HEAD", url, "bytes=0-").await;
    assert_eq!(header(&head, "Content-Length"), Some("4194327"));
    assert_eq!(head["body"], "");
    assert_eq!(
        cdp_resource(&settings, "GET", url, "bytes=99999999-").await["responseCode"],
        416
    );
    assert_eq!(
        cdp_resource(&settings, "POST", url, "").await["responseCode"],
        405
    );
    assert_ne!(
        cdp_resource(&settings, "GET", "file:///secrets", "").await["responseCode"],
        200
    );
    settings.codex_app_image_overlay_enabled = false;
    assert_eq!(
        cdp_resource(&settings, "GET", url, "bytes=0-").await["responseCode"],
        404
    );
}

#[tokio::test]
async fn large_images_use_host_origin_without_truncation_and_web_keeps_path_sandbox() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("large.png");
    let bytes = vec![123; 17 * 1024 * 1024];
    std::fs::write(&path, &bytes).unwrap();
    let mut settings = BackendSettings {
        codex_app_image_overlay_enabled: true,
        codex_app_image_overlay_path: path.to_string_lossy().into(),
        ..Default::default()
    };
    let config = assets::image_overlay_config(1, &settings);
    assert_eq!(config["dataUrl"], "");
    let response = wallpaper::cdp_response(
        &json!({
            "requestId":"large","request":{"method":"GET","url":config["sourceUrl"],"headers":{}}
        }),
        &settings,
    )
    .await;
    assert_eq!(response["responseCode"], 200);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(response["body"].as_str().unwrap())
            .unwrap(),
        bytes
    );
    std::fs::write(tmp.path().join("index.html"), "<html>isolated</html>").unwrap();
    std::fs::write(
        tmp.path().join("project.json"),
        r#"{"type":"web","file":"index.html"}"#,
    )
    .unwrap();
    settings.codex_app_image_overlay_path = tmp.path().to_string_lossy().into();
    let url = format!("{}web/index.html", wallpaper::APP_RESOURCE_BASE);
    let response = cdp_resource(&settings, "GET", &url, "bytes=0-").await;
    let csp = header(&response, "Content-Security-Policy").unwrap();
    assert!(csp.contains("connect-src app://-/_alunixa-x-wallpaper/web/;"));
    assert!(csp.contains("sandbox allow-scripts"));
    assert!(!csp.contains("allow-same-origin"));
    for path in [
        "../secret.json",
        "%2e%2e/secret.json",
        "%2e%2e%5csecret.json",
        "file:///secret.json",
    ] {
        let url = format!("{}web/{path}", wallpaper::APP_RESOURCE_BASE);
        assert_eq!(
            cdp_resource(&settings, "GET", &url, "bytes=0-").await["responseCode"],
            404
        );
    }
}

#[test]
fn workshop_packaged_scenes_do_not_require_an_unpacked_scene_json() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::write(root.join("scene.pkg"), b"opaque native engine archive").unwrap();
    std::fs::write(
        root.join("project.json"),
        br#"{"type":"scene","file":"scene.json","title":"Packaged scene"}"#,
    )
    .unwrap();
    let source = wallpaper::resolve(root).unwrap();
    assert_eq!(source.kind, "scene");
    assert_eq!(source.entry.file_name().unwrap(), "scene.pkg");
    assert_eq!(source.path.file_name().unwrap(), "project.json");
    // A package must never hide an unsafe or arbitrary project entry.
    for entry in ["../scene.json", r"..\scene.json", "absent.json"] {
        std::fs::write(
            root.join("project.json"),
            serde_json::to_vec(&json!({"type":"scene","file":entry})).unwrap(),
        )
        .unwrap();
        assert!(wallpaper::resolve(root).is_err());
    }
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
