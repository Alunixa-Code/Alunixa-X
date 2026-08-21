use alunixa_x_core::install::{
    InstallOptions, MANAGER_BUNDLE_ID, SILENT_BINARY, SILENT_BUNDLE_ID, app_bundle_names,
    build_macos_app_bundle, build_windows_entrypoint_plan, companion_binary_path_from_exe,
    default_install_root_strategy, macos_companion_bundle_identifier_from_exe, shortcut_names,
};

#[test]
fn windows_entrypoint_plan_contains_silent_and_manager_entrypoints() {
    let options = InstallOptions {
        install_root: Some("C:/Users/A/Desktop".into()),
        launcher_path: Some("C:/Tools/alunixa-x.exe".into()),
        manager_path: Some("C:/Tools/alunixa-x-manager.exe".into()),
        remove_owned_data: false,
    };

    let plan = build_windows_entrypoint_plan(&options);

    assert!(plan.silent_shortcut.ends_with("Alunixa X Launch.lnk"));
    assert!(plan.manager_shortcut.ends_with("Alunixa X.lnk"));
    assert_eq!(plan.launcher_path, "C:/Tools/alunixa-x.exe");
    assert_eq!(plan.manager_path, "C:/Tools/alunixa-x-manager.exe");
    assert_eq!(plan.silent_icon_path, "C:/Tools/alunixa-x.exe");
    assert_eq!(plan.manager_icon_path, "C:/Tools/alunixa-x-manager.exe");
    assert_eq!(plan.uninstall_key, "AlunixaX");
    assert_eq!(plan.legacy_uninstall_key, "AlunixaXLegacy");
    assert_eq!(
        plan.uninstaller_path.replace('\\', "/"),
        "C:/Tools/uninstall.exe"
    );
    assert_eq!(
        plan.uninstall_command.replace('\\', "/"),
        "\"C:/Tools/uninstall.exe\""
    );
    assert_eq!(
        plan.quiet_uninstall_command.replace('\\', "/"),
        "\"C:/Tools/uninstall.exe\" /S"
    );
    assert_ne!(plan.uninstall_command, "\"C:/Tools/alunixa-x-manager.exe\"");
}

#[test]
fn windows_entrypoint_plan_can_request_owned_data_removal_without_shell_script() {
    let options = InstallOptions {
        install_root: Some("C:/Users/A/Desktop".into()),
        launcher_path: None,
        manager_path: None,
        remove_owned_data: true,
    };

    let plan = build_windows_entrypoint_plan(&options);

    assert!(plan.silent_shortcut.ends_with("Alunixa X Launch.lnk"));
    assert!(plan.manager_shortcut.ends_with("Alunixa X.lnk"));
    assert!(plan.remove_owned_data);
}

#[test]
fn macos_bundle_metadata_contains_silent_and_manager_apps() {
    let options = InstallOptions {
        install_root: Some("/Applications".into()),
        launcher_path: Some("/opt/Alunixa X/alunixa-x".into()),
        manager_path: Some("/opt/Alunixa X/alunixa-x-manager".into()),
        remove_owned_data: false,
    };

    let silent = build_macos_app_bundle(&options, false);
    let manager = build_macos_app_bundle(&options, true);

    assert!(silent.app_path.ends_with("Alunixa X Launch.app"));
    assert!(manager.app_path.ends_with("Alunixa X.app"));
    assert!(
        silent
            .info_plist
            .contains("<string>Alunixa X Launch</string>")
    );
    assert!(manager.info_plist.contains("<string>Alunixa X</string>"));
    assert_eq!(silent.binary_target_name.as_deref(), Some("alunixa-x"));
    assert_eq!(
        manager.binary_target_name.as_deref(),
        Some("alunixa-x-manager")
    );
    assert!(silent.launch_script.contains("$DIR/alunixa-x"));
    assert!(manager.launch_script.contains("$DIR/alunixa-x-manager"));
}

#[test]
fn installer_exports_expected_two_entrypoint_names() {
    assert_eq!(shortcut_names(), ("Alunixa X Launch.lnk", "Alunixa X.lnk"));
    assert_eq!(
        app_bundle_names(),
        ("Alunixa X Launch.app", "Alunixa X.app")
    );
}

#[test]
fn macos_dmg_includes_applications_shortcut_for_drag_install() {
    let script = std::fs::read_to_string("../../scripts/installer/macos/package-dmg.sh")
        .expect("read macOS DMG packaging script");

    assert!(script.contains("ln -s /Applications \"$STAGE/Applications\""));
    assert!(script.contains(
        "cp \"$BINARY_DIR/alunixa-x-imagegen-mcp\" \"$STAGE/Alunixa X Launch.app/Contents/MacOS/alunixa-x-imagegen-mcp\""
    ));
    assert!(script.contains("for binary_path in \"$app_dir/Contents/MacOS/\"*"));
}

#[test]
fn windows_ci_stages_the_imagegen_companion_before_building_installers() {
    for workflow_path in [
        "../../.github/workflows/pr-build.yml",
        "../../.github/workflows/release-assets.yml",
    ] {
        let workflow = std::fs::read_to_string(workflow_path)
            .unwrap_or_else(|error| panic!("read {workflow_path}: {error}"));
        let stage_index = workflow
            .find("Copy-Item target/release/alunixa-x-imagegen-mcp.exe dist/windows/app/")
            .unwrap_or_else(|| panic!("{workflow_path} should stage the imagegen companion"));
        let installer_index = workflow
            .find("AlunixaX.nsi")
            .unwrap_or_else(|| panic!("{workflow_path} should build the Windows installer"));

        assert!(
            stage_index < installer_index,
            "{workflow_path} must stage the imagegen companion before invoking NSIS"
        );
    }
}

#[test]
fn companion_binary_path_resolves_macos_silent_app_next_to_manager_app() {
    let manager_exe = std::path::Path::new("/Applications/Alunixa X.app/Contents/MacOS/AlunixaX");

    let companion = companion_binary_path_from_exe(manager_exe, SILENT_BINARY);

    assert_eq!(
        companion,
        std::path::PathBuf::from(
            "/Applications/Alunixa X Launch.app/Contents/MacOS/AlunixaXLauncher"
        )
    );
    assert_ne!(
        companion,
        std::path::PathBuf::from("/Applications/Alunixa X.app/Contents/MacOS/alunixa-x")
    );
}

#[test]
fn companion_binary_path_resolves_macos_manager_app_next_to_silent_app() {
    let silent_exe =
        std::path::Path::new("/Applications/Alunixa X Launch.app/Contents/MacOS/AlunixaXLauncher");

    let companion =
        companion_binary_path_from_exe(silent_exe, alunixa_x_core::install::MANAGER_BINARY);

    assert_eq!(
        companion,
        std::path::PathBuf::from("/Applications/Alunixa X.app/Contents/MacOS/AlunixaX")
    );
}

#[test]
fn macos_companion_launch_uses_bundle_ids_from_app_translocation() {
    let manager_exe = std::path::Path::new(
        "/private/var/folders/x/AppTranslocation/manager-id/d/Alunixa X.app/Contents/MacOS/AlunixaX",
    );
    let silent_exe = std::path::Path::new(
        "/private/var/folders/x/AppTranslocation/silent-id/d/Alunixa X Launch.app/Contents/MacOS/AlunixaXLauncher",
    );

    assert_eq!(
        macos_companion_bundle_identifier_from_exe(manager_exe, SILENT_BINARY),
        Some(SILENT_BUNDLE_ID)
    );
    assert_eq!(
        macos_companion_bundle_identifier_from_exe(
            silent_exe,
            alunixa_x_core::install::MANAGER_BINARY,
        ),
        Some(MANAGER_BUNDLE_ID)
    );
}

#[test]
fn macos_companion_launch_keeps_bare_binary_development_mode() {
    let manager_exe = std::path::Path::new("/tmp/target/debug/alunixa-x-manager");

    assert_eq!(
        macos_companion_bundle_identifier_from_exe(manager_exe, SILENT_BINARY),
        None
    );
}

#[test]
fn macos_bundle_does_not_wrap_the_bundle_executable_in_itself() {
    let options = InstallOptions {
        install_root: Some("/Applications".into()),
        launcher_path: Some(
            "/Applications/Alunixa X Launch.app/Contents/MacOS/AlunixaXLauncher".into(),
        ),
        manager_path: Some("/Applications/Alunixa X.app/Contents/MacOS/AlunixaX".into()),
        remove_owned_data: false,
    };

    let silent = build_macos_app_bundle(&options, false);
    let manager = build_macos_app_bundle(&options, true);

    assert_eq!(
        silent.binary_source,
        Some(std::path::PathBuf::from(
            "/Applications/Alunixa X Launch.app/Contents/MacOS/AlunixaXLauncher"
        ))
    );
    assert_eq!(
        manager.binary_source,
        Some(std::path::PathBuf::from(
            "/Applications/Alunixa X.app/Contents/MacOS/AlunixaX"
        ))
    );
    assert!(silent.launch_script.contains("$DIR/alunixa-x"));
    assert!(manager.launch_script.contains("$DIR/alunixa-x-manager"));
}

#[test]
fn windows_default_install_root_uses_known_folder_before_userprofile_desktop() {
    let strategy = default_install_root_strategy();

    if cfg!(windows) {
        assert_eq!(strategy, "windows-known-folder");
    } else if cfg!(target_os = "macos") {
        assert_eq!(strategy, "macos-applications");
    } else {
        assert_eq!(strategy, "user-dirs-desktop");
    }
}
