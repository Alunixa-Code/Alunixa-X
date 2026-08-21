use serde::Serialize;
use std::path::{Path, PathBuf};

pub const MANAGER_AUTOSTART_VALUE_NAME: &str = "AlunixaXManager";
pub const MANAGER_AUTOSTART_RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartStatus {
    pub supported: bool,
    pub enabled: bool,
    pub executable_path: String,
}

pub fn manager_autostart_command(executable_path: &Path) -> String {
    format!("\"{}\" --hidden", executable_path.display())
}

pub fn get_manager_autostart_status() -> AutostartStatus {
    let executable_path = current_manager_executable_path();
    #[cfg(windows)]
    {
        let enabled = manager_autostart_enabled_for_path(&executable_path);
        return AutostartStatus {
            supported: true,
            enabled,
            executable_path: executable_path.to_string_lossy().to_string(),
        };
    }
    #[cfg(not(windows))]
    {
        AutostartStatus {
            supported: false,
            enabled: false,
            executable_path: executable_path.to_string_lossy().to_string(),
        }
    }
}

pub fn set_manager_autostart_enabled(enabled: bool) -> anyhow::Result<AutostartStatus> {
    #[cfg(windows)]
    {
        let executable_path = current_manager_executable_path();
        if enabled {
            let command = manager_autostart_command(&executable_path);
            crate::windows_integration::set_current_user_string_value(
                MANAGER_AUTOSTART_RUN_SUBKEY,
                MANAGER_AUTOSTART_VALUE_NAME,
                &command,
            )?;
        } else {
            crate::windows_integration::delete_current_user_value(
                MANAGER_AUTOSTART_RUN_SUBKEY,
                MANAGER_AUTOSTART_VALUE_NAME,
            )?;
        }
        return Ok(get_manager_autostart_status());
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Ok(get_manager_autostart_status())
    }
}

fn current_manager_executable_path() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("alunixa-x-manager.exe"))
}

#[cfg(windows)]
fn manager_autostart_enabled_for_path(executable_path: &Path) -> bool {
    let expected = manager_autostart_command(executable_path);
    match crate::windows_integration::read_current_user_string_values(MANAGER_AUTOSTART_RUN_SUBKEY)
    {
        Ok(values) => values.into_iter().any(|(name, value)| {
            name == MANAGER_AUTOSTART_VALUE_NAME
                && value.as_deref().map(str::trim) == Some(expected.as_str())
        }),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn quotes_paths_with_spaces_and_appends_hidden_flag() {
        let path = PathBuf::from(r"C:\Program Files\Alunixa X\alunixa-x-manager.exe");
        assert_eq!(
            manager_autostart_command(&path),
            r#""C:\Program Files\Alunixa X\alunixa-x-manager.exe" --hidden"#
        );
    }

    #[test]
    fn non_windows_status_is_unsupported() {
        let status = get_manager_autostart_status();
        if cfg!(windows) {
            assert!(status.supported);
        } else {
            assert!(!status.supported);
            assert!(!status.enabled);
        }
    }
}
