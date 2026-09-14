#[cfg(target_os = "macos")]
use super::{MANAGER_NAME, SILENT_NAME};
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::{
    InstallOptions, MACOS_MANAGER_NAME, MACOS_SILENT_NAME, MANAGER_BINARY, MacosAppBundle,
    SILENT_BINARY, install_root_or_default, option_or_current_exe,
};

pub fn build_app_bundle(options: &InstallOptions, manager: bool) -> MacosAppBundle {
    let install_root = install_root_or_default(options);
    let display_name = if manager {
        MACOS_MANAGER_NAME
    } else {
        MACOS_SILENT_NAME
    };
    let executable_name = if manager {
        "AlunixaX"
    } else {
        "AlunixaXLauncher"
    };
    let binary = if manager {
        MANAGER_BINARY
    } else {
        SILENT_BINARY
    };
    let binary_source = install_binary_source(
        option_or_current_exe(
            if manager {
                &options.manager_path
            } else {
                &options.launcher_path
            },
            binary,
        ),
        binary,
    );
    let identifier_suffix = if manager { "" } else { ".launcher" };
    MacosAppBundle {
        app_path: install_root.join(format!("{display_name}.app")),
        info_plist: info_plist(display_name, executable_name, identifier_suffix),
        launch_script: launch_script(binary),
        binary_source: Some(binary_source),
        binary_target_name: Some(binary.to_string()),
    }
}

fn launch_script(binary: &str) -> String {
    format!(
        "#!/bin/sh\nDIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\nexec \"$DIR/{binary}\" \"$@\"\n"
    )
}

fn install_binary_source(target: std::path::PathBuf, binary: &str) -> std::path::PathBuf {
    if is_bundle_macos_target(&target) {
        let sidecar = target
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(binary);
        if sidecar.exists() {
            return sidecar;
        }
    }
    target
}

fn is_bundle_macos_target(target: &Path) -> bool {
    target
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        == Some("MacOS")
        && target
            .parent()
            .and_then(|parent| parent.parent())
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            == Some("Contents")
}

#[cfg(target_os = "macos")]
pub fn install_app_bundles(options: &InstallOptions) -> anyhow::Result<()> {
    write_bundle(&build_app_bundle(options, false))?;
    write_bundle(&build_app_bundle(options, true))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn uninstall_app_bundles(options: &InstallOptions) -> anyhow::Result<()> {
    let install_root = install_root_or_default(options);
    for name in [
        MACOS_SILENT_NAME,
        MACOS_MANAGER_NAME,
        SILENT_NAME,
        MANAGER_NAME,
    ] {
        let app = install_root.join(format!("{name}.app"));
        if app.exists() {
            fs::remove_dir_all(app)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install_app_bundles(_options: &InstallOptions) -> anyhow::Result<()> {
    anyhow::bail!("macOS app bundles are only supported on macOS")
}

#[cfg(not(target_os = "macos"))]
pub fn uninstall_app_bundles(_options: &InstallOptions) -> anyhow::Result<()> {
    anyhow::bail!("macOS app bundles are only supported on macOS")
}

#[cfg(target_os = "macos")]
fn write_bundle(bundle: &MacosAppBundle) -> anyhow::Result<()> {
    let (source, target_name) = match (&bundle.binary_source, &bundle.binary_target_name) {
        (Some(source), Some(target_name)) => (source, target_name),
        _ => anyhow::bail!("macOS bundle is missing its binary source"),
    };
    validate_binary_source(source)?;
    let imagegen_source = if target_name == SILENT_BINARY {
        let companion = source
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("alunixa-x-imagegen-mcp");
        // Validate all required inputs before modifying an existing app bundle.
        validate_binary_source(&companion)?;
        Some(companion)
    } else {
        None
    };
    let contents = bundle.app_path.join("Contents");
    let macos = contents.join("MacOS");
    let resources = contents.join("Resources");
    fs::create_dir_all(&macos)?;
    fs::create_dir_all(&resources)?;
    fs::write(contents.join("Info.plist"), &bundle.info_plist)?;
    copy_bundle_binary(source, &macos.join(target_name))?;
    if let Some(companion) = imagegen_source {
        copy_bundle_binary(&companion, &macos.join("alunixa-x-imagegen-mcp"))?;
    }
    let executable = macos.join(executable_name_from_plist(&bundle.info_plist));
    fs::write(&executable, &bundle.launch_script)?;
    let mut permissions = fs::metadata(&executable)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(executable, permissions)?;
    copy_icon(&resources)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_bundle_binary(source: &Path, target: &Path) -> anyhow::Result<()> {
    if source != target {
        fs::copy(source, target)?;
    }
    validate_binary_source(target)?;
    let mut permissions = fs::metadata(target)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(target, permissions)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn validate_binary_source(path: &Path) -> anyhow::Result<()> {
    let metadata = fs::metadata(path).map_err(|error| {
        anyhow::anyhow!(
            "macOS bundle binary is unavailable at {}: {error}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        anyhow::bail!(
            "macOS bundle binary is not a regular file: {}",
            path.display()
        );
    }
    if metadata.len() < 1024 {
        anyhow::bail!(
            "macOS bundle binary is unexpectedly small: {}",
            path.display()
        );
    }
    let mut header = [0_u8; 2];
    let mut file = fs::File::open(path)?;
    use std::io::Read;
    let read = file.read(&mut header)?;
    if read == header.len() && header == *b"#!" {
        anyhow::bail!(
            "macOS bundle binary points to a shell script: {}",
            path.display()
        );
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_icon(resources: &Path) -> anyhow::Result<()> {
    let source = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| path.join("alunixa-x.png"));
    if let Some(source) = source.filter(|path| path.exists()) {
        fs::copy(source, resources.join("alunixa-x.png"))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn executable_name_from_plist(plist: &str) -> String {
    plist
        .split("<key>CFBundleExecutable</key>")
        .nth(1)
        .and_then(|tail| tail.split("<string>").nth(1))
        .and_then(|tail| tail.split("</string>").next())
        .unwrap_or("AlunixaX")
        .to_string()
}

fn info_plist(display_name: &str, executable_name: &str, identifier_suffix: &str) -> String {
    let version = crate::version::VERSION;
    let url_types = if identifier_suffix.is_empty() {
        r#"  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>Alunixa X Provider Import</string>
      <key>CFBundleURLSchemes</key>
      <array><string>alunixax</string></array>
    </dict>
    <dict>
      <key>CFBundleURLName</key>
      <string>DreamSkin Community Theme</string>
      <key>CFBundleURLSchemes</key>
      <array><string>dreamskin</string></array>
    </dict>
  </array>
"#
    } else {
        ""
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>{display_name}</string>
  <key>CFBundleDisplayName</key>
  <string>{display_name}</string>
  <key>CFBundleIdentifier</key>
  <string>io.github.alunixacode.alunixax{identifier_suffix}</string>
  <key>CFBundleVersion</key>
  <string>{version}</string>
  <key>CFBundleShortVersionString</key>
  <string>{version}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>{executable_name}</string>
  <key>CFBundleIconFile</key>
  <string>alunixa-x.png</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
{url_types}
</dict>
</plist>"#
    )
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn maintenance_installs_ax_launcher_with_executable_imagegen_companion() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        let launcher = source.join(SILENT_BINARY);
        let companion = source.join("alunixa-x-imagegen-mcp");
        fs::write(&launcher, vec![0xab; 2048]).unwrap();
        fs::write(&companion, vec![0xcd; 2048]).unwrap();
        let bundle = build_app_bundle(
            &InstallOptions {
                install_root: Some(temp.path().join("Applications")),
                launcher_path: Some(launcher),
                ..Default::default()
            },
            false,
        );
        write_bundle(&bundle).unwrap();
        let installed = bundle
            .app_path
            .join("Contents/MacOS/alunixa-x-imagegen-mcp");
        assert_eq!(fs::read(&installed).unwrap(), fs::read(&companion).unwrap());
        assert_eq!(
            fs::metadata(installed).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(bundle.app_path.ends_with("Alunixa X Launch (AX).app"));
    }

    #[test]
    fn missing_imagegen_companion_does_not_modify_existing_bundle() {
        let temp = tempfile::tempdir().unwrap();
        let launcher = temp.path().join(SILENT_BINARY);
        fs::write(&launcher, vec![0xab; 2048]).unwrap();
        let bundle = build_app_bundle(
            &InstallOptions {
                install_root: Some(temp.path().join("Applications")),
                launcher_path: Some(launcher),
                ..Default::default()
            },
            false,
        );
        let contents = bundle.app_path.join("Contents");
        fs::create_dir_all(&contents).unwrap();
        fs::write(contents.join("Info.plist"), "keep-existing").unwrap();
        assert!(write_bundle(&bundle).is_err());
        assert_eq!(
            fs::read_to_string(contents.join("Info.plist")).unwrap(),
            "keep-existing"
        );
        assert!(!contents.join("MacOS").exists());
    }
}
