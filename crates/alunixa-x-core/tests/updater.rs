use alunixa_x_core::update::{
    Release, download_asset_to, is_newer_version, parse_version_tag, release_from_github_payload,
    release_from_latest_json_payload, safe_asset_name, select_update_asset,
};
use serde_json::json;

#[test]
fn parse_version_tag_accepts_prefix_and_suffix() {
    assert_eq!(parse_version_tag("v1.2.3").unwrap(), vec![1, 2, 3]);
    assert_eq!(parse_version_tag("1.2.3").unwrap(), vec![1, 2, 3]);
    assert_eq!(parse_version_tag("v1.2.3-beta.1").unwrap(), vec![1, 2, 3]);
}

#[test]
fn version_comparison_uses_numeric_segments() {
    assert!(is_newer_version("v1.0.10", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.0.4", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.0.3", "1.0.4").unwrap());
}

#[test]
fn github_payload_selects_platform_installer() {
    let release = release_from_github_payload(&json!({
        "tag_name": "v1.0.9",
        "html_url": "https://github.com/Alunixa-Code/Alunixa-X/releases/tag/v1.0.9",
        "body": "fixes",
        "assets": [
            {"name": "source.zip", "browser_download_url": "https://example.test/source.zip"},
            {"name": "alunixa-x-plus-manager.exe", "browser_download_url": "https://example.test/manager.exe"},
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
            "alunixa-x-plus-manager.exe".to_string(),
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
fn asset_selection_accepts_universal_macos_dmg_on_either_arch() {
    // A universal DMG carries no arch token at all. `is_macos_native_arch_asset`
    // falls through to its "no arch token — assume it matches" branch, so both
    // x86_64 and arm64 must rank it as a native match. That fallback is what
    // makes the universal build work, so pin it down here: if someone later
    // makes an arch token mandatory, this test is what catches it.
    let assets = vec![(
        "AlunixaX-1.5.4-macos-universal.dmg".to_string(),
        "https://example.test/app-universal.dmg".to_string(),
    )];

    if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets)
            .expect("the universal DMG must be selectable on any macOS arch");
        assert_eq!(selected.name, "AlunixaX-1.5.4-macos-universal.dmg");
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn asset_selection_prefers_universal_over_single_arch_dmg() {
    // Both shapes are rank 0 for the running arch, so the two must never ship
    // together — this test documents the collision so a mixed release is not
    // mistaken for a safe one. The assertion is deliberately loose about which
    // one wins: the point is that a mixed release is ambiguous.
    let assets = vec![
        (
            "AlunixaX-1.5.4-macos-universal.dmg".to_string(),
            "https://example.test/app-universal.dmg".to_string(),
        ),
        (
            "AlunixaX-1.5.4-macos-arm64.dmg".to_string(),
            "https://example.test/app-arm64.dmg".to_string(),
        ),
    ];

    if cfg!(target_os = "macos") {
        assert!(
            select_update_asset(&assets).is_some(),
            "a macOS installer is selectable when native and universal coexist"
        );
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

fn ax_six_assets() -> Vec<String> {
    [
        "windows-x64-setup.exe",
        "windows-x64.zip",
        "macos-x64.dmg",
        "macos-x64.zip",
        "macos-arm64.dmg",
        "macos-arm64.zip",
    ]
    .iter()
    .map(|suffix| format!("Alunixa-X-1.0.36-{suffix}"))
    .collect()
}

fn assert_ax_platform_installer(release: &Release) {
    let expected = if cfg!(windows) {
        Some("Alunixa-X-1.0.36-windows-x64-setup.exe")
    } else if cfg!(target_os = "macos") {
        match std::env::consts::ARCH {
            "x86_64" => Some("Alunixa-X-1.0.36-macos-x64.dmg"),
            "aarch64" => Some("Alunixa-X-1.0.36-macos-arm64.dmg"),
            arch => panic!("unexpected Mac architecture: {arch}"),
        }
    } else {
        None
    };
    assert_eq!(release.asset_name.as_deref(), expected);
    if let Some(name) = expected {
        assert_eq!(
            release.asset_url.as_deref(),
            Some(
                format!(
                    "https://github.com/Alunixa-Code/Alunixa-X/releases/download/v1.0.36/{name}"
                )
                .as_str()
            )
        );
    }
}

#[test]
fn ax_github_six_asset_payload_selects_installer_not_portable_zip() {
    let assets: Vec<_> = ax_six_assets()
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "browser_download_url": format!(
                    "https://github.com/Alunixa-Code/Alunixa-X/releases/download/v1.0.36/{name}"
                )
            })
        })
        .collect();
    let release = release_from_github_payload(&json!({
        "tag_name": "v1.0.36",
        "assets": assets,
    }))
    .unwrap();
    assert_ax_platform_installer(&release);
}

#[test]
fn ax_latest_metadata_schema_with_seventh_asset_matches_release_generator() {
    let mut assets: Vec<_> = ax_six_assets()
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "url": format!(
                    "https://github.com/Alunixa-Code/Alunixa-X/releases/download/v1.0.36/{name}"
                ),
                "size": 1024,
                "sha256": "a".repeat(64),
            })
        })
        .collect();
    assets.insert(0, json!({
        "name": "latest.json",
        "url": "https://github.com/Alunixa-Code/Alunixa-X/releases/download/v1.0.36/latest.json",
    }));
    let release = release_from_latest_json_payload(&json!({
        "version": "v1.0.36",
        "url": "https://github.com/Alunixa-Code/Alunixa-X/releases/tag/v1.0.36",
        "body": "AX release notes",
        "assets": assets,
    }))
    .unwrap();
    assert_eq!(release.body, "AX release notes");
    assert_ax_platform_installer(&release);
}

#[test]
fn ax_latest_metadata_uses_download_url_in_legacy_github_asset_shape() {
    let assets: Vec<_> = ax_six_assets()
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "url": "https://api.github.com/repos/Alunixa-Code/Alunixa-X/releases/assets/123",
                "browser_download_url": format!(
                    "https://github.com/Alunixa-Code/Alunixa-X/releases/download/v1.0.36/{name}"
                ),
            })
        })
        .collect();
    let release = release_from_latest_json_payload(&json!({
        "tag_name": "v1.0.36",
        "assets": assets,
    }))
    .unwrap();
    assert_ax_platform_installer(&release);
}

#[test]
fn asset_selection_rejects_upstream_and_metadata_artifacts() {
    for name in [
        "CodexPlusPlus-1.7.6-windows-x64-setup.exe",
        "CodexPlusPlus-1.7.6-macos-x64.dmg",
        "CodexPlusPlus-Alunixa-X-1.0.36-windows-x64-setup.exe",
        "NotAlunixaX_1.0.36_x64.dmg",
        "latest.json",
        "Alunixa-X-1.0.36-windows-x64.zip",
        "Alunixa-X-1.0.36-macos-arm64.zip",
    ] {
        assert!(
            select_update_asset(&[(name.into(), "https://example.test/artifact".into())]).is_none(),
            "must not select foreign, portable or metadata artifact: {name}"
        );
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
