use anyhow::Context;
use tokio::process::Command;

pub const CODEX_UPDATER_ENV: &str = "CODEX_SPARKLE_ENABLED";
pub const CODEX_UPDATER_DISABLED_VALUE: &str = "false";

pub fn codex_updater_environment_value(disabled: bool) -> Option<&'static str> {
    disabled.then_some(CODEX_UPDATER_DISABLED_VALUE)
}

pub fn configure_codex_process_command(command: &mut Command, disabled: bool) {
    if let Some(value) = codex_updater_environment_value(disabled) {
        command.env(CODEX_UPDATER_ENV, value);
    } else {
        command.env_remove(CODEX_UPDATER_ENV);
    }
}

pub fn apply_codex_auto_update_policy(disabled: bool) -> anyhow::Result<()> {
    apply_platform_policy(disabled)
}

#[cfg(windows)]
fn apply_platform_policy(disabled: bool) -> anyhow::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command as StdCommand, Stdio};

    const USER_ENV_KEY: &str = r"HKCU\Environment";
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut command = StdCommand::new("reg.exe");
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let status = if disabled {
        command
            .args([
                "add",
                USER_ENV_KEY,
                "/v",
                CODEX_UPDATER_ENV,
                "/t",
                "REG_SZ",
                "/d",
                CODEX_UPDATER_DISABLED_VALUE,
                "/f",
            ])
            .status()
            .context("failed to start reg.exe while disabling Codex updates")?
    } else {
        let query_status = StdCommand::new("reg.exe")
            .args(["query", USER_ENV_KEY, "/v", CODEX_UPDATER_ENV])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .context("failed to query the Codex updater environment setting")?;
        if !query_status.success() {
            broadcast_windows_environment_change();
            return Ok(());
        }
        command
            .args(["delete", USER_ENV_KEY, "/v", CODEX_UPDATER_ENV, "/f"])
            .status()
            .context("failed to start reg.exe while enabling Codex updates")?
    };

    if !status.success() {
        anyhow::bail!(
            "failed to {} the current-user Codex updater environment setting",
            if disabled { "write" } else { "remove" }
        );
    }
    broadcast_windows_environment_change();
    Ok(())
}

#[cfg(windows)]
fn broadcast_windows_environment_change() {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
    };
    use windows::core::PCWSTR;

    let environment = std::ffi::OsStr::new("Environment")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut result = 0_usize;
    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(PCWSTR(environment.as_ptr()).0 as isize),
            SMTO_ABORTIFHUNG,
            5_000,
            Some(&mut result),
        );
    }
}

#[cfg(target_os = "macos")]
fn apply_platform_policy(disabled: bool) -> anyhow::Result<()> {
    use std::process::{Command as StdCommand, Stdio};

    let mut command = StdCommand::new("/bin/launchctl");
    command.stdout(Stdio::null()).stderr(Stdio::null());
    if disabled {
        command.args(["setenv", CODEX_UPDATER_ENV, CODEX_UPDATER_DISABLED_VALUE]);
    } else {
        command.args(["unsetenv", CODEX_UPDATER_ENV]);
    }
    let status = command
        .status()
        .context("failed to start launchctl while applying the Codex update policy")?;
    if !status.success() {
        anyhow::bail!(
            "launchctl failed to {} the Codex updater environment setting",
            if disabled { "set" } else { "unset" }
        );
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn apply_platform_policy(_disabled: bool) -> anyhow::Result<()> {
    Ok(())
}
