//! User-selected local media and Wallpaper Engine projects. No arbitrary file route.
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, bail};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

pub const MEDIA_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const PROJECT_LIMIT: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperSource {
    pub kind: String,
    pub title: String,
    pub path: PathBuf,
    pub entry: PathBuf,
    pub root: PathBuf,
}

pub fn media_type(path: &Path) -> Option<(&'static str, &'static str)> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" | "apng" => Some(("image", "image/png")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        "bmp" => Some(("image", "image/bmp")),
        "mp4" | "m4v" => Some(("video", "video/mp4")),
        "webm" => Some(("video", "video/webm")),
        "mov" => Some(("video", "video/quicktime")),
        "ogv" => Some(("video", "video/ogg")),
        _ => None,
    }
}

fn regular_file(path: &Path, limit: u64) -> anyhow::Result<u64> {
    let m = std::fs::symlink_metadata(path).context("壁纸文件不存在或无法读取")?;
    if !m.is_file() || m.file_type().is_symlink() || m.len() == 0 || m.len() > limit {
        bail!("壁纸必须是非空普通文件，媒体不超过 2 GiB，project.json 不超过 1 MiB");
    }
    Ok(m.len())
}

pub fn resolve(path: &Path) -> anyhow::Result<WallpaperSource> {
    if path.as_os_str().is_empty() {
        bail!("请选择壁纸文件或项目目录");
    }
    let selected = if path.is_dir() {
        path.join("project.json")
    } else {
        path.to_owned()
    };
    if media_type(&selected).is_some() {
        regular_file(&selected, MEDIA_LIMIT)?;
        let entry = selected.canonicalize()?;
        return Ok(WallpaperSource {
            kind: media_type(&entry).unwrap().0.into(),
            title: entry
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            path: entry.clone(),
            root: entry.parent().context("壁纸路径无效")?.into(),
            entry,
        });
    }
    if selected.file_name().and_then(|v| v.to_str()) != Some("project.json") {
        bail!("请选择媒体文件或含 project.json 的单个 Wallpaper Engine 壁纸目录");
    }
    regular_file(&selected, PROJECT_LIMIT)?;
    let project = selected.canonicalize()?;
    let root = project.parent().context("项目路径无效")?.to_owned();
    let value: Value =
        serde_json::from_slice(&std::fs::read(&project)?).context("project.json 格式无效")?;
    let kind = value["type"].as_str().unwrap_or("").to_ascii_lowercase();
    let file = value["file"].as_str().context("project.json 缺少 file")?;
    // Workshop scenes keep "file": "scene.json" in project.json even when the
    // entry is inside scene.pkg. Let the native engine read its own archive.
    let entry = if kind == "scene"
        && file.eq_ignore_ascii_case("scene.json")
        && !root.join(file).exists()
    {
        contained_file(&root, "scene.pkg")?
    } else {
        contained_file(&root, file)?
    };
    let actual_kind = match kind.as_str() {
        "video" if media_type(&entry).is_some_and(|(kind, _)| kind == "video") => "video",
        "web"
            if entry.extension().and_then(|s| s.to_str()).is_some_and(|s| {
                s.eq_ignore_ascii_case("html") || s.eq_ignore_ascii_case("htm")
            }) =>
        {
            "web"
        }
        "scene" => "scene",
        _ => bail!("不支持此 Wallpaper Engine 项目类型或入口文件；不执行 Application 类型壁纸"),
    };
    Ok(WallpaperSource {
        kind: actual_kind.into(),
        title: value["title"]
            .as_str()
            .unwrap_or("Wallpaper Engine")
            .chars()
            .take(160)
            .collect(),
        path: project,
        entry,
        root,
    })
}

pub fn contained_file(root: &Path, relative: &str) -> anyhow::Result<PathBuf> {
    let relative = relative.replace('\\', "/");
    let path = Path::new(&relative);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || relative.contains(':')
    {
        bail!("项目资源路径不能越过所选壁纸目录");
    }
    let canonical_root = root.canonicalize()?;
    let candidate = root.join(path);
    regular_file(&candidate, MEDIA_LIMIT)?;
    let canonical = candidate.canonicalize()?;
    if !canonical.starts_with(&canonical_root) {
        bail!("项目资源不在所选壁纸目录内");
    }
    Ok(canonical)
}

pub fn import_media(source: &Path, state_dir: &Path) -> anyhow::Result<WallpaperSource> {
    let resolved = resolve(source)?;
    if media_type(source).is_none() {
        bail!("项目目录请使用选择目录，不需要上传");
    }
    let directory = state_dir.join("wallpapers");
    std::fs::create_dir_all(&directory)?;
    let mut temp = tempfile::NamedTempFile::new_in(&directory)?;
    let input = std::fs::File::open(&resolved.entry)?;
    let copied = std::io::copy(&mut std::io::Read::take(input, MEDIA_LIMIT + 1), &mut temp)?;
    if copied == 0 || copied > MEDIA_LIMIT {
        bail!("媒体为空或超过 2 GiB，未导入");
    }
    temp.as_file().sync_all()?;
    let ext = source
        .extension()
        .context("壁纸扩展名无效")?
        .to_string_lossy()
        .to_ascii_lowercase();
    let path = directory.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    temp.persist(&path).map_err(|e| e.error)?;
    let mut imported = resolve(&path)?;
    imported.title = resolved.title;
    Ok(imported)
}

pub fn runtime_config(helper_port: u16, settings: &crate::settings::BackendSettings) -> Value {
    let resolved = (settings.enhancements_enabled && settings.codex_app_image_overlay_enabled)
        .then(|| resolve(Path::new(settings.codex_app_image_overlay_path.trim())));
    let mut config = json!({
        "enabled": false, "dataUrl": "", "imageUrl": format!("http://127.0.0.1:{helper_port}/overlay/image"),
        "opacity": f64::from(settings.codex_app_image_overlay_opacity.clamp(1,100))/100.0,
        "fitMode": settings.codex_app_image_overlay_fit_mode,
        "muted": settings.codex_app_wallpaper_muted, "paused": settings.codex_app_wallpaper_paused,
        "kind": "image", "error": "",
    });
    if let Some(result) = resolved {
        match result {
            Ok(source) => {
                let version = std::fs::metadata(&source.entry)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|t| t.as_nanos())
                    .unwrap_or(0);
                let relative = source
                    .entry
                    .strip_prefix(&source.root)
                    .unwrap_or(Path::new(""));
                let web_path = relative
                    .components()
                    .map(|s| {
                        url::form_urlencoded::byte_serialize(
                            s.as_os_str().to_string_lossy().as_bytes(),
                        )
                        .collect::<String>()
                        .replace('+', "%20")
                    })
                    .collect::<Vec<_>>()
                    .join("/");
                config["enabled"] = json!(true);
                // Web projects also need the native host: custom-scheme CSP
                // cannot reliably serve their scripts after the page has loaded.
                // WE itself provides its complete Web APIs in an owned window.
                config["kind"] = json!(if source.kind == "web" {
                    "scene"
                } else {
                    &source.kind
                });
                config["sourceUrl"] = json!(if source.kind == "web" {
                    format!("http://127.0.0.1:{helper_port}/wallpaper/web/{web_path}?v={version}")
                } else {
                    format!("http://127.0.0.1:{helper_port}/wallpaper/media?v={version}")
                });
                config["sceneUrl"] =
                    json!(format!("http://127.0.0.1:{helper_port}/wallpaper/scene"));
            }
            Err(_) => {
                config["error"] = json!("壁纸文件或项目入口不可用，请在 Alunixa X 中重新选择")
            }
        }
    }
    config
}

/// Routes have no renderer-supplied file/path/URL parameters. Only the selected
/// media or the exact owned native scene may be requested.
pub async fn handle_bridge_request(
    route: &str,
    websocket_url: &str,
    settings: &crate::settings::BackendSettings,
) -> anyhow::Result<Value> {
    anyhow::ensure!(
        settings.enhancements_enabled && settings.codex_app_image_overlay_enabled,
        "wallpaper disabled"
    );
    let source = resolve(Path::new(settings.codex_app_image_overlay_path.trim()))?;
    match route {
        "/wallpaper/media" if matches!(source.kind.as_str(), "image" | "video") => {
            let url = crate::bridge::local_file_blob_url(websocket_url, &source.entry).await?;
            Ok(json!({"status":"ok","sourceUrl":url}))
        }
        "/wallpaper/scene" if matches!(source.kind.as_str(), "scene" | "web") => {
            Ok(crate::wallpaper_scene::state(&source.path))
        }
        _ => bail!("unsupported wallpaper resource"),
    }
}

/// Single-range requests support seeking without buffering entire videos.
pub fn byte_range(header: Option<&str>, length: u64) -> anyhow::Result<(u64, u64, bool)> {
    if length == 0 {
        bail!("empty file");
    }
    let Some(header) = header else {
        return Ok((0, length - 1, false));
    };
    let range = header
        .strip_prefix("bytes=")
        .context("invalid range unit")?;
    let (start, end) = range.split_once('-').context("invalid range")?;
    if range.contains(',') {
        bail!("multiple ranges unsupported");
    }
    let (start, end) = if start.is_empty() {
        let suffix: u64 = end.parse()?;
        if suffix == 0 {
            bail!("empty suffix");
        }
        (length.saturating_sub(suffix), length - 1)
    } else {
        let start: u64 = start.parse()?;
        let end = if end.is_empty() {
            length - 1
        } else {
            end.parse::<u64>()?.min(length - 1)
        };
        (start, end)
    };
    if start > end || start >= length {
        bail!("unsatisfiable range");
    }
    Ok((start, end, true))
}

pub async fn serve(
    stream: &mut tokio::net::TcpStream,
    method: &str,
    raw_path: &str,
    range: Option<&str>,
    settings: &crate::settings::BackendSettings,
) -> anyhow::Result<()> {
    if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
        return error_response(stream, "405 Method Not Allowed", "").await;
    }
    if method == "OPTIONS" {
        return error_response(stream, "204 No Content", "").await;
    }
    let path = raw_path.split('?').next().unwrap_or(raw_path);
    let result = if settings.enhancements_enabled && settings.codex_app_image_overlay_enabled {
        resolve(Path::new(settings.codex_app_image_overlay_path.trim()))
    } else {
        Err(anyhow::anyhow!("disabled"))
    };
    let Ok(source) = result else {
        return error_response(stream, "404 Not Found", "").await;
    };
    if path == "/wallpaper/scene" {
        let state = crate::wallpaper_scene::state(&source.path);
        let bytes = serde_json::to_vec(&state)?;
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        stream.write_all(head.as_bytes()).await?;
        if method != "HEAD" {
            stream.write_all(&bytes).await?;
        }
        return Ok(());
    }
    let file = if path == "/wallpaper/media" && matches!(source.kind.as_str(), "image" | "video") {
        source.entry.clone()
    } else if source.kind == "web" && path.starts_with("/wallpaper/web/") {
        let encoded = path.trim_start_matches("/wallpaper/web/");
        let relative = match url::form_urlencoded::parse(
            format!("p={}", encoded.replace('+', "%2B").replace('&', "%26")).as_bytes(),
        )
        .next()
        {
            Some((_, value)) => value.into_owned(),
            None => return error_response(stream, "404 Not Found", "").await,
        };
        match contained_file(&source.root, &relative) {
            Ok(file) => file,
            Err(_) => return error_response(stream, "404 Not Found", "").await,
        }
    } else {
        return error_response(stream, "404 Not Found", "").await;
    };
    let mime = media_type(&file).map(|(_, mime)| mime).or_else(|| {
        match file.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "html" | "htm" => Some("text/html; charset=utf-8"),
            "js" | "mjs" => Some("text/javascript; charset=utf-8"),
            "css" => Some("text/css; charset=utf-8"),
            "json" => Some("application/json"),
            "woff2" => Some("font/woff2"),
            "woff" => Some("font/woff"),
            "ttf" => Some("font/ttf"),
            "svg" => Some("image/svg+xml"),
            "mp3" => Some("audio/mpeg"),
            "ogg" => Some("audio/ogg"),
            "wav" => Some("audio/wav"),
            _ => None,
        }
    });
    let Some(mime) = mime else {
        return error_response(stream, "404 Not Found", "").await;
    };
    let mut file = tokio::fs::File::open(file).await?;
    let length = file.metadata().await?.len();
    let (start, end, partial) = match byte_range(range, length) {
        Ok(range) => range,
        Err(_) => {
            return error_response(
                stream,
                "416 Range Not Satisfiable",
                &format!("Content-Range: bytes */{length}\r\n"),
            )
            .await;
        }
    };
    // An opaque-origin sandbox alone is not enough: 'self' also allows resource
    // GETs against unrelated Helper routes. Limit all network sources to the
    // selected project's read-only route, including local JSON/shader fetches.
    let resources = format!(
        "http://127.0.0.1:{}/wallpaper/web/",
        stream.local_addr()?.port()
    );
    let security = format!(
        "Content-Security-Policy: default-src 'none'; script-src {resources} 'unsafe-inline'; style-src {resources} 'unsafe-inline'; img-src {resources} data: blob:; media-src {resources} data: blob:; font-src {resources} data:; connect-src {resources}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts\r\n"
    );
    let head = format!(
        "HTTP/1.1 {}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n{}Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n{security}Connection: close\r\n\r\n",
        if partial {
            "206 Partial Content"
        } else {
            "200 OK"
        },
        end - start + 1,
        if partial {
            format!("Content-Range: bytes {start}-{end}/{length}\r\n")
        } else {
            String::new()
        },
    );
    stream.write_all(head.as_bytes()).await?;
    if method != "HEAD" {
        file.seek(std::io::SeekFrom::Start(start)).await?;
        tokio::io::copy(&mut file.take(end - start + 1), stream).await?;
    }
    Ok(())
}

async fn error_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    extra: &str,
) -> anyhow::Result<()> {
    stream.write_all(format!("HTTP/1.1 {status}\r\n{extra}Content-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nConnection: close\r\n\r\n").as_bytes()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn range_contract() {
        assert_eq!(byte_range(None, 100).unwrap(), (0, 99, false));
        assert_eq!(byte_range(Some("bytes=12-"), 100).unwrap(), (12, 99, true));
        assert_eq!(byte_range(Some("bytes=-5"), 100).unwrap(), (95, 99, true));
        assert_eq!(byte_range(Some("bytes=2-999"), 100).unwrap(), (2, 99, true));
        for range in [
            "bytes=100-",
            "bytes=-0",
            "bytes=8-4",
            "bytes=0-1,3-5",
            "wat=1-2",
        ] {
            assert!(byte_range(Some(range), 100).is_err());
        }
    }
    #[test]
    fn resolves_projects_but_rejects_escape_and_application() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("project");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("video.mp4"), b"video fixture").unwrap();
        std::fs::write(tmp.path().join("secret.mp4"), b"outside").unwrap();
        for (kind, file, valid) in [
            ("video", "video.mp4", true),
            ("video", "../secret.mp4", false),
            ("application", "video.mp4", false),
            ("scene", "video.mp4", true),
        ] {
            std::fs::write(
                root.join("project.json"),
                serde_json::to_vec(&json!({"type":kind,"file":file,"title":"测试"})).unwrap(),
            )
            .unwrap();
            assert_eq!(resolve(&root).is_ok(), valid);
        }
        assert!(contained_file(&root, r"..\secret.mp4").is_err());
    }
    #[test]
    fn imports_animated_bytes_without_flattening() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("animated.gif");
        let bytes = b"GIF89a-original-multiple-frames";
        std::fs::write(&source, bytes).unwrap();
        let imported = import_media(&source, &tmp.path().join("state")).unwrap();
        assert_eq!(std::fs::read(imported.entry).unwrap(), bytes);
        assert_eq!(std::fs::read(&source).unwrap(), bytes);
    }
}
