use alunixa_x_core::install::{
    InstallOptions, MANAGER_BUNDLE_ID, SILENT_BINARY, SILENT_BUNDLE_ID, app_bundle_names,
    build_macos_app_bundle, build_windows_entrypoint_plan, companion_binary_path_from_exe,
    default_install_root_strategy, macos_companion_bundle_identifier_from_exe, shortcut_names,
};

#[test]
fn release_requires_tests_and_versioned_notes_before_publication() {
    let workflow = include_str!("../../../.github/workflows/release-assets.yml");
    assert_eq!(workflow.matches("- name: Validate frontend").count(), 2);
    assert_eq!(
        workflow.matches("cargo test --workspace --locked").count(),
        2
    );
    let notes = include_str!("../../../scripts/release/prepare-notes.sh");
    assert!(notes.contains("docs/releases/${RELEASE_TAG}.md"));
    assert!(workflow.contains("--notes-file \"$NOTES\""));
    assert!(notes.contains("cd dist/release && sha256sum *"));
    assert!(workflow.contains("test \"$(find dist/release -maxdepth 1 -type f | wc -l)\" -eq 6"));
    assert!(notes.contains("test \"$GITHUB_REPOSITORY\" = \"Alunixa-Code/Alunixa-X\""));
    assert!(!workflow.contains("Verify API-only context with isolated official CLI"));
    assert!(workflow.contains("Rust workspace regression tests"));
    let preview = include_str!("../../../.github/workflows/pr-build.yml");
    assert_eq!(preview.matches("run: npm ci").count(), 2);
    assert_eq!(preview.matches("run: npm test").count(), 2);
    assert_eq!(preview.matches("run: npm run check").count(), 2);
    assert_eq!(
        preview.matches("cargo test --workspace --locked").count(),
        2
    );
    assert!(!preview.contains("npm install --package-lock=false"));
}

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

    assert!(silent.app_path.ends_with("Alunixa X Launch (AX).app"));
    assert!(manager.app_path.ends_with("Alunixa X (AX).app"));
    assert!(
        silent
            .info_plist
            .contains("<string>Alunixa X Launch (AX)</string>")
    );
    assert!(
        manager
            .info_plist
            .contains("<string>Alunixa X (AX)</string>")
    );
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
        ("Alunixa X Launch (AX).app", "Alunixa X (AX).app")
    );
}

#[test]
fn macos_dmg_includes_applications_shortcut_for_drag_install() {
    let script = std::fs::read_to_string("../../scripts/installer/macos/package-dmg.sh")
        .expect("read macOS DMG packaging script");

    assert!(script.contains("ln -s /Applications \"$STAGE/Applications\""));
    assert!(script.contains(
        "cp \"$BINARY_DIR/alunixa-x-imagegen-mcp\" \"$STAGE/Alunixa X Launch (AX).app/Contents/MacOS/alunixa-x-imagegen-mcp\""
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

#[test]
fn ax_windows_shortcuts_are_installed_repaired_and_uninstalled_by_name() {
    use alunixa_x_core::install::{AX_MANAGER_SHORTCUT, AX_SILENT_SHORTCUT};
    let nsis = include_str!("../../../scripts/installer/windows/AlunixaX.nsi");
    for name in [AX_MANAGER_SHORTCUT, AX_SILENT_SHORTCUT] {
        assert!(nsis.contains(&format!(
            "CreateShortcut \"$SMPROGRAMS\\Alunixa X\\{name}\""
        )));
        assert!(nsis.contains(&format!("Delete \"$SMPROGRAMS\\Alunixa X\\{name}\"")));
    }
    let runtime = include_str!("../src/install/windows.rs");
    assert!(runtime.contains("programs_dir()"));
    assert!(runtime.contains("programs.join(AX_MANAGER_SHORTCUT)"));
    assert!(runtime.contains("programs.join(AX_SILENT_SHORTCUT)"));
    assert!(runtime.contains("remove_file(folder.join(name))"));
}

#[test]
fn ax_macos_bundle_names_and_all_build_paths_remain_consistent() {
    let (launcher, manager) = app_bundle_names();
    let script = include_str!("../../../scripts/installer/macos/package-dmg.sh");
    for app in [launcher, manager] {
        assert!(app.contains("(AX)"));
        assert!(script.contains(app));
        assert!(include_str!("../../../.github/workflows/release-assets.yml").contains(app));
        assert!(include_str!("../../../.github/workflows/pr-build.yml").contains(app));
        assert!(
            include_str!("../../../.github/workflows/release-recovery-self-hosted.yml")
                .contains(app)
        );
    }
    let exe = std::path::Path::new("/Applications/Alunixa X (AX).app/Contents/MacOS/AlunixaX");
    assert_eq!(
        macos_companion_bundle_identifier_from_exe(exe, SILENT_BINARY),
        Some(SILENT_BUNDLE_ID)
    );
    assert_eq!(
        companion_binary_path_from_exe(exe, SILENT_BINARY),
        std::path::PathBuf::from(
            "/Applications/Alunixa X Launch (AX).app/Contents/MacOS/AlunixaXLauncher"
        )
    );
}

#[test]
fn ax_macos_mixed_old_and_new_bundle_paths_find_the_installed_companion() {
    let temp = tempfile::tempdir().unwrap();
    let legacy_launcher = temp.path().join("Alunixa X Launch.app/Contents/MacOS");
    std::fs::create_dir_all(&legacy_launcher).unwrap();
    let manager = temp
        .path()
        .join("Alunixa X (AX).app/Contents/MacOS/AlunixaX");
    assert_eq!(
        companion_binary_path_from_exe(&manager, SILENT_BINARY),
        legacy_launcher.join("AlunixaXLauncher")
    );
    let new_launcher = temp.path().join("Alunixa X Launch (AX).app/Contents/MacOS");
    std::fs::create_dir_all(&new_launcher).unwrap();
    let legacy_manager = temp.path().join("Alunixa X.app/Contents/MacOS/AlunixaX");
    assert_eq!(
        companion_binary_path_from_exe(&legacy_manager, SILENT_BINARY),
        new_launcher.join("AlunixaXLauncher")
    );
}
