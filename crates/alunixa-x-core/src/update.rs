use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_REPOSITORY: &str = "Alunixa-Code/Alunixa-X";
pub const DEFAULT_LATEST_RELEASE_API_URL: &str =
    "https://api.github.com/repos/Alunixa-Code/Alunixa-X/releases/latest";
pub const DEFAULT_RELEASES_PAGE_URL: &str =
    "https://github.com/Alunixa-Code/Alunixa-X/releases/latest";
pub const MAX_RELEASE_SUMMARY_CHARS: usize = 1200;
pub const MAX_RELEASE_SUMMARY_LINES: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Release {
    pub version: String,
    pub url: String,
    pub body: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_summary: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateInstall {
    pub release: Release,
    pub installer_path: PathBuf,
    pub launched: bool,
}

pub fn parse_version_tag(value: &str) -> anyhow::Result<Vec<u64>> {
    let normalized = value.trim().trim_start_matches(['v', 'V']);
    if normalized.is_empty() {
        anyhow::bail!("Invalid version tag: {value}");
    }

    let core_end = normalized.find(['-', '+']).unwrap_or(normalized.len());
    let core = &normalized[..core_end];
    let suffix = &normalized[core_end..];
    if core.is_empty()
        || core.starts_with('.')
        || core.ends_with('.')
        || !core.chars().all(|ch| ch.is_ascii_digit() || ch == '.')
        || suffix.chars().any(char::is_whitespace)
    {
        anyhow::bail!("Invalid version tag: {value}");
    }

    core.split('.')
        .map(|part| part.parse::<u64>().map_err(Into::into))
        .collect()
}

pub fn is_newer_version(candidate: &str, current: &str) -> anyhow::Result<bool> {
    let mut left = parse_version_tag(candidate)?;
    let mut right = parse_version_tag(current)?;
    let len = left.len().max(right.len());
    left.resize(len, 0);
    right.resize(len, 0);
    Ok(left > right)
}

pub fn release_from_github_payload(payload: &Value) -> anyhow::Result<Release> {
    if payload.get("draft").and_then(Value::as_bool) == Some(true) {
        anyhow::bail!("latest GitHub release is a draft");
    }
    if payload.get("prerelease").and_then(Value::as_bool) == Some(true) {
        anyhow::bail!("latest GitHub release is a prerelease");
    }
    let version = payload
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("release payload missing tag_name"))?
        .to_string();
    let assets = payload
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|asset| {
            Some((
                asset.get("name")?.as_str()?.to_string(),
                asset.get("browser_download_url")?.as_str()?.to_string(),
            ))
        })
        .collect::<Vec<_>>();
    let selected = select_update_asset(&assets);
    Ok(Release {
        version,
        url: payload
            .get("html_url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        body: bounded_release_summary(
            payload
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        asset_name: selected.as_ref().map(|asset| asset.name.clone()),
        asset_url: selected.map(|asset| asset.browser_download_url),
    })
}

pub fn release_from_latest_json_payload(payload: &Value) -> anyhow::Result<Release> {
    let version = payload
        .get("version")
        .or_else(|| payload.get("tag_name"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("latest.json missing version"))?
        .to_string();
    let assets = payload
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|asset| {
            let name = asset.get("name")?.as_str()?.to_string();
            let url = asset
                .get("url")
                .or_else(|| asset.get("browser_download_url"))?
                .as_str()?
                .to_string();
            Some((name, url))
        })
        .collect::<Vec<_>>();
    let selected = select_update_asset(&assets);
    Ok(Release {
        version,
        url: payload
            .get("url")
            .or_else(|| payload.get("html_url"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        body: payload
            .get("body")
            .or_else(|| payload.get("release_summary"))
            .or_else(|| payload.get("notes"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        asset_name: selected.as_ref().map(|asset| asset.name.clone()),
        asset_url: selected.map(|asset| asset.browser_download_url),
    })
}

pub fn select_update_asset(assets: &[(String, String)]) -> Option<ReleaseAsset> {
    let named = assets
        .iter()
        .filter(|(name, url)| !name.trim().is_empty() && !url.trim().is_empty());
    let mut best: Option<(u8, &str, &str)> = None;
    for (name, url) in named {
        let Some(rank) = platform_asset_rank(&name.to_ascii_lowercase()) else {
            continue;
        };
        if best.map_or(true, |(r, _, _)| rank < r) {
            best = Some((rank, name.as_str(), url.as_str()));
        }
    }
    best.map(|(_, name, url)| ReleaseAsset {
        name: name.to_string(),
        browser_download_url: url.to_string(),
    })
}

pub async fn fetch_latest_release(api_url: &str) -> anyhow::Result<Release> {
    let client =
        crate::http_client::proxied_client(&format!("Alunixa X/{}", crate::version::VERSION))?;
    let payload = client
        .get(api_url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?;
    release_from_github_payload(&payload)
}

pub async fn check_for_update(current_version: &str) -> anyhow::Result<UpdateCheck> {
    let release = fetch_latest_release(DEFAULT_LATEST_RELEASE_API_URL).await?;
    let update_available = is_newer_version(&release.version, current_version)?;
    Ok(UpdateCheck {
        current_version: current_version.to_string(),
        latest_version: Some(release.version),
        release_summary: release.body,
        asset_name: release.asset_name,
        asset_url: release.asset_url,
        update_available,
    })
}

pub async fn perform_update(
    release: &Release,
    download_dir: &Path,
) -> anyhow::Result<UpdateInstall> {
    if !is_newer_version(&release.version, crate::version::VERSION)? {
        anyhow::bail!(
            "Release {} is not newer than the installed version {}",
            release.version,
            crate::version::VERSION
        );
    }
    let url = release
        .asset_url
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("没有可下载的 Release asset"))?;
    let bytes =
        crate::http_client::proxied_client(&format!("Alunixa X/{}", crate::version::VERSION))?
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
    let installer_path = download_asset_to(release, &bytes, download_dir)?;
    launch_installer(&installer_path)?;
    Ok(UpdateInstall {
        release: release.clone(),
        installer_path,
        launched: true,
    })
}

pub fn download_asset_to(
    release: &Release,
    bytes: &[u8],
    download_dir: &Path,
) -> anyhow::Result<PathBuf> {
    let name = release
        .asset_name
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("没有可下载的 Release asset"))?;
    let safe = safe_asset_name(name)?;
    std::fs::create_dir_all(download_dir)?;
    let path = download_dir.join(safe);
    std::fs::write(&path, bytes)?;
    Ok(path)
}

pub fn safe_asset_name(name: &str) -> anyhow::Result<String> {
    if name.trim().is_empty() {
        anyhow::bail!("非法 Release asset 文件名: {name}");
    }
    let path = Path::new(name);
    if path.components().count() != 1 {
        anyhow::bail!("非法 Release asset 文件名: {name}");
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow::anyhow!("非法 Release asset 文件名: {name}"))?;
    if file_name == "." || file_name == ".." {
        anyhow::bail!("非法 Release asset 文件名: {name}");
    }
    Ok(file_name.to_string())
}

pub fn bounded_release_summary(body: &str) -> String {
    let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
    let mut output = String::new();
    let mut line_count = 0usize;
    let mut char_count = 0usize;
    let mut previous_blank = false;
    let mut truncated = false;

    for raw_line in normalized.lines() {
        let line = raw_line.trim();
        let blank = line.is_empty();
        if blank && (previous_blank || output.is_empty()) {
            continue;
        }
        if line_count >= MAX_RELEASE_SUMMARY_LINES {
            truncated = true;
            break;
        }
        let separator_chars = usize::from(!output.is_empty());
        let available = MAX_RELEASE_SUMMARY_CHARS.saturating_sub(char_count + separator_chars);
        if available == 0 {
            truncated = true;
            break;
        }
        if !output.is_empty() {
            output.push('\n');
            char_count += 1;
        }
        let line_chars = line.chars().count();
        if line_chars > available {
            output.extend(line.chars().take(available));
            truncated = true;
            break;
        }
        output.push_str(line);
        char_count += line_chars;
        line_count += 1;
        previous_blank = blank;
    }

    let output = output.trim_end();
    if truncated {
        format!("{output}\n\n[Release notes truncated]")
    } else {
        output.to_string()
    }
}

fn platform_asset_rank(name: &str) -> Option<u8> {
    if cfg!(target_os = "macos") {
        if !is_macos_installer_asset(name) {
            return None;
        }
        if is_macos_native_arch_asset(name) {
            return Some(0);
        }
        return None;
    }
    if cfg!(windows) {
        return windows_asset_rank(name);
    }
    None
}

fn is_macos_native_arch_asset(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let has_x64 = lower.contains("x64") || lower.contains("x86_64") || lower.contains("amd64");
    let has_arm64 = lower.contains("arm64") || lower.contains("aarch64");
    if !has_x64 && !has_arm64 {
        return true;
    }
    match std::env::consts::ARCH {
        "x86_64" => has_x64 && !has_arm64,
        "aarch64" => has_arm64 && !has_x64,
        _ => false,
    }
}

fn windows_asset_rank(name: &str) -> Option<u8> {
    if !is_alunixa_x_asset(name) || windows_asset_is_wrong_arch(name) {
        return None;
    }
    if name.ends_with(".msi") {
        return Some(0);
    }
    if name.ends_with(".exe")
        && (name.contains("setup") || name.contains("installer") || name.contains("install"))
    {
        return Some(1);
    }
    None
}

fn is_macos_installer_asset(name: &str) -> bool {
    is_alunixa_x_asset(name) && (name.ends_with(".dmg") || name.ends_with(".pkg"))
}

fn is_alunixa_x_asset(name: &str) -> bool {
    let compact = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>();
    compact.to_ascii_lowercase().contains("alunixax")
}

fn windows_asset_is_wrong_arch(name: &str) -> bool {
    match std::env::consts::ARCH {
        "x86_64" => name.contains("arm64") || name.contains("aarch64"),
        "aarch64" => name.contains("x64") || name.contains("x86_64") || name.contains("amd64"),
        _ => true,
    }
}

pub fn launch_installer(path: &Path) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(path)
            .creation_flags(crate::windows_integration::CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("启动安装包失败：{error}"))
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("打开 DMG 失败：{error}"))
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = path;
        anyhow::bail!("当前平台不支持启动安装包")
    }
}
