use alunixa_x_core::update::{
    DEFAULT_LATEST_RELEASE_API_URL, DEFAULT_RELEASES_PAGE_URL, DEFAULT_REPOSITORY,
    MAX_RELEASE_SUMMARY_CHARS, MAX_RELEASE_SUMMARY_LINES, Release, bounded_release_summary,
    download_asset_to, is_newer_version, parse_version_tag, release_from_github_payload,
    release_from_latest_json_payload, safe_asset_name, select_update_asset,
};
use serde_json::json;

#[test]
fn default_update_source_targets_migrated_repository() {
    assert_eq!(DEFAULT_REPOSITORY, "Alunixa-Code/Alunixa-X");
    assert_eq!(
        DEFAULT_LATEST_RELEASE_API_URL,
        "https://api.github.com/repos/Alunixa-Code/Alunixa-X/releases/latest"
    );
    assert_eq!(
        DEFAULT_RELEASES_PAGE_URL,
        "https://github.com/Alunixa-Code/Alunixa-X/releases/latest"
    );
}

#[test]
fn parse_version_tag_accepts_prefix_and_suffix() {
    assert_eq!(parse_version_tag("v1.2.3").unwrap(), vec![1, 2, 3]);
    assert_eq!(parse_version_tag("1.2.3").unwrap(), vec![1, 2, 3]);
    assert_eq!(parse_version_tag("v1.2.3-beta.1").unwrap(), vec![1, 2, 3]);
    assert_eq!(
        parse_version_tag("1.2.3.0+build.4").unwrap(),
        vec![1, 2, 3, 0]
    );
    assert!(parse_version_tag("release-1.2.3").is_err());
    assert!(parse_version_tag("v1.2.3windows").is_err());
    assert!(parse_version_tag("v1..3").is_err());
}

#[test]
fn version_comparison_uses_numeric_segments() {
    assert!(is_newer_version("v1.0.10", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.0.4", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.0.3", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.2.36.0", "1.2.36").unwrap());
}

#[test]
fn release_summary_is_bounded_by_lines_and_characters() {
    let long = (0..30)
        .map(|index| format!("line {index}: {}", "x".repeat(150)))
        .collect::<Vec<_>>()
        .join("\r\n");
    let summary = bounded_release_summary(&long);

    assert!(summary.lines().count() <= MAX_RELEASE_SUMMARY_LINES + 2);
    assert!(summary.chars().count() <= MAX_RELEASE_SUMMARY_CHARS + 32);
    assert!(summary.contains("[Release notes truncated]"));
    assert!(!summary.contains('\r'));
}

#[test]
fn github_payload_selects_platform_installer() {
    let release = release_from_github_payload(&json!({
        "tag_name": "v1.0.9",
        "html_url": "https://github.com/Alunixa-Code/Alunixa-X/releases/tag/v1.0.9",
        "body": "fixes",
        "assets": [
            {"name": "source.zip", "browser_download_url": "https://example.test/source.zip"},
            {"name": "alunixa-x-manager.exe", "browser_download_url": "https://example.test/manager.exe"},
            {"name": "AlunixaX_1.0.9_x64-setup.exe", "browser_download_url": "https://example.test/setup.exe"},
            {"name": "AlunixaX_1.0.9_x64.dmg", "browser_download_url": "https://example.test/app.dmg"}
        ]
    }))
    .unwrap();

    assert_eq!(release.version, "v1.0.9");
    if cfg!(windows) {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("AlunixaX_1.0.9_x64-setup.exe")
        );
    } else if cfg!(target_os = "macos") {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("AlunixaX_1.0.9_x64.dmg")
        );
    } else {
        assert_eq!(release.asset_name.as_deref(), None);
    }
}

#[test]
fn github_payload_rejects_non_stable_releases() {
    let draft = json!({
        "tag_name": "v9.0.0",
        "draft": true,
        "prerelease": false,
        "assets": []
    });
    let prerelease = json!({
        "tag_name": "v9.0.0-beta.1",
        "draft": false,
        "prerelease": true,
        "assets": []
    });

    assert!(release_from_github_payload(&draft).is_err());
    assert!(release_from_github_payload(&prerelease).is_err());
}

#[test]
fn latest_json_payload_selects_platform_installer_without_github_api_shape() {
    let release = release_from_latest_json_payload(&json!({
        "version": "v1.1.6",
        "url": "https://github.com/Alunixa-Code/Alunixa-X/releases/tag/v1.1.6",
        "body": "静态更新描述",
        "assets": [
            {"name": "source.zip", "url": "https://example.test/source.zip"},
            {"name": "AlunixaX-1.1.6-windows-x64-setup.exe", "url": "https://example.test/setup.exe"},
            {"name": "AlunixaX-1.1.6-macos-x64.dmg", "url": "https://example.test/app.dmg"}
        ]
    }))
    .unwrap();

    assert_eq!(release.version, "v1.1.6");
    assert_eq!(release.body, "静态更新描述");
    if cfg!(windows) {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("AlunixaX-1.1.6-windows-x64-setup.exe")
        );
    } else if cfg!(target_os = "macos") {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("AlunixaX-1.1.6-macos-x64.dmg")
        );
    } else {
        assert_eq!(release.asset_name.as_deref(), None);
    }
}

#[test]
fn asset_selection_prefers_current_platform_artifacts() {
    let assets = vec![
        (
            "AlunixaX.zip".to_string(),
            "https://example.test/source.zip".to_string(),
        ),
        (
            "alunixa-x-manager.exe".to_string(),
            "https://example.test/manager.exe".to_string(),
        ),
        (
            "AlunixaX_1.0.9_x64-setup.exe".to_string(),
            "https://example.test/setup.exe".to_string(),
        ),
        (
            "AlunixaX_1.0.9_x64.dmg".to_string(),
            "https://example.test/app.dmg".to_string(),
        ),
    ];

    if cfg!(windows) {
        let selected = select_update_asset(&assets).unwrap();
        assert_eq!(selected.name, "AlunixaX_1.0.9_x64-setup.exe");
    } else if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets).unwrap();
        assert_eq!(selected.name, "AlunixaX_1.0.9_x64.dmg");
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn asset_selection_distinguishes_x64_and_arm64_macos_dmgs() {
    // Regression test for the bug where an x86_64 Mac user could be handed
    // the arm64 DMG (or vice versa) because `is_macos_installer_asset` did
    // not check the arch token in the filename.
    let assets = vec![
        (
            "AlunixaX-1.2.17-macos-arm64.dmg".to_string(),
            "https://example.test/app-arm64.dmg".to_string(),
        ),
        (
            "AlunixaX-1.2.17-macos-x64.dmg".to_string(),
            "https://example.test/app-x64.dmg".to_string(),
        ),
    ];

    if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets)
            .expect("a macOS DMG should be selected for the running arch");
        let expected = match std::env::consts::ARCH {
            "x86_64" => "AlunixaX-1.2.17-macos-x64.dmg",
            "aarch64" => "AlunixaX-1.2.17-macos-arm64.dmg",
            other => panic!("unexpected target arch in test: {other}"),
        };
        assert_eq!(
            selected.name, expected,
            "x86_64 binary must select x64 DMG, aarch64 binary must select arm64 DMG"
        );
    } else {
        // Non-macOS platforms should not pick either macOS DMG.
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn asset_selection_understands_alternative_macos_arch_names() {
    let assets = vec![
        (
            "AlunixaX-macos-aarch64.dmg".to_string(),
            "https://example.test/app-aarch64.dmg".to_string(),
        ),
        (
            "AlunixaX-macos-amd64.dmg".to_string(),
            "https://example.test/app-amd64.dmg".to_string(),
        ),
    ];

    if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets).unwrap();
        let expected = match std::env::consts::ARCH {
            "x86_64" => "AlunixaX-macos-amd64.dmg",
            "aarch64" => "AlunixaX-macos-aarch64.dmg",
            other => panic!("unexpected target arch in test: {other}"),
        };
        assert_eq!(selected.name, expected);
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn safe_asset_name_rejects_path_traversal() {
    assert_eq!(safe_asset_name("pkg.zip").unwrap(), "pkg.zip");
    assert!(safe_asset_name("../pkg.zip").is_err());
    assert!(safe_asset_name("").is_err());
}

#[test]
fn download_asset_to_writes_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let release = Release {
        version: "v1.0.9".to_string(),
        url: "https://example.test".to_string(),
        body: "fixes".to_string(),
        asset_name: Some("pkg.zip".to_string()),
        asset_url: Some("https://example.test/pkg.zip".to_string()),
    };

    let path = download_asset_to(&release, b"abcdef", dir.path()).unwrap();

    assert_eq!(path, dir.path().join("pkg.zip"));
    assert_eq!(std::fs::read(path).unwrap(), b"abcdef");
}
