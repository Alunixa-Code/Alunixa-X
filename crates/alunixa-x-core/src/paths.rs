use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const APP_STATE_DIR: &str = ".codex-session-delete";
const PENDING_SESSION_SHARE_FILE: &str = "pending-session-share.txt";
const SKILLS_STATE_FILE: &str = "skills.json";
const SKILLS_DIR: &str = "skills";
const SKILL_BACKUPS_DIR: &str = "skill-backups";
const PENDING_MANAGER_NAVIGATION_FILE: &str = "pending-manager-navigation.json";
const SETTINGS_FILE: &str = "settings.json";
const LATEST_STATUS_FILE: &str = "latest-status.json";
const DIAGNOSTIC_LOG_FILE: &str = "alunixa-x.log";
const PENDING_PROVIDER_IMPORT_FILE: &str = "pending-provider-import.json";
const PENDING_REMOTE_CONTROL_RECOVERY_FILE: &str = "pending-remote-control-recovery.json";

/// 显式指定状态目录的环境变量（Windows 多开隔离的必需项）。
///
/// 多开实例各自需要独立的 `settings.json` / `latest-status.json` / 诊断日志，
/// 早先靠给 worker 换 `HOME` 实现。该做法只在 Unix 成立：`directories` 在
/// Windows 上走 `SHGetKnownFolderPath(FOLDERID_Profile)`，**完全不读 `HOME`**
/// （见 `directories-6.0.0/src/win.rs`），于是 worker 读写的仍是主实例的状态目录，
/// 多开专用设置（含 `--user-data-dir`）从来没有被读取过。
///
/// 因此这里提供平台无关的显式覆盖：设置后该进程（及其子进程）的状态目录整体
/// 挪到指定位置，不依赖任何平台特有的家目录语义。
pub const STATE_DIR_ENV: &str = "ALUNIXA_X_STATE_DIR";

/// 解析显式状态目录覆盖；未设置或设置为空时返回 `None`。
pub fn state_dir_override_from(value: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let value = value?;
    let text = value.to_string_lossy();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| PathBuf::from(trimmed))
}

pub fn state_dir_override() -> Option<PathBuf> {
    state_dir_override_from(std::env::var_os(STATE_DIR_ENV).as_deref())
}

pub fn default_app_state_dir() -> PathBuf {
    // Windows Known Folder APIs ignore HOME. A multi-worker must never borrow
    // the main manager's provider, launch status or diagnostic files.
    if let Some(path) = multi_state_dir_from_env(
        std::env::var_os("ALUNIXA_X_MULTI_INSTANCE").as_deref(),
        std::env::var_os("ALUNIXA_X_STATE_HOME").as_deref(),
    ) {
        return path;
    }
    // 显式覆盖优先于家目录推导：多开实例与宿主 set 的路径必须权威，
    // 否则 Windows 上 HOME 失效会把实例状态写回主实例目录。
    if let Some(state_dir) = state_dir_override() {
        return state_dir;
    }

    if let Some(home_dir) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
        return home_dir.join(APP_STATE_DIR);
    }

    PathBuf::from(APP_STATE_DIR)
}

pub fn default_settings_path() -> PathBuf {
    if let Some(path) = settings_path_for_tests() {
        return path;
    }
    default_app_state_dir().join(SETTINGS_FILE)
}

pub fn default_latest_status_path() -> PathBuf {
    default_app_state_dir().join(LATEST_STATUS_FILE)
}

pub fn default_diagnostic_log_path() -> PathBuf {
    default_app_state_dir().join(DIAGNOSTIC_LOG_FILE)
}

pub fn default_pending_provider_import_path() -> PathBuf {
    default_app_state_dir().join(PENDING_PROVIDER_IMPORT_FILE)
}

pub fn default_pending_remote_control_recovery_path() -> PathBuf {
    default_app_state_dir().join(PENDING_REMOTE_CONTROL_RECOVERY_FILE)
}

fn settings_path_for_tests() -> Option<PathBuf> {
    SETTINGS_PATH_FOR_TESTS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|path| path.clone())
}

static SETTINGS_PATH_FOR_TESTS: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(test)]
static SETTINGS_PATH_TEST_GUARD: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn settings_path_test_guard() -> std::sync::MutexGuard<'static, ()> {
    SETTINGS_PATH_TEST_GUARD
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap()
}

pub fn set_settings_path_for_tests(path: Option<PathBuf>) -> Option<PathBuf> {
    SETTINGS_PATH_FOR_TESTS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|mut current| std::mem::replace(&mut *current, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_path_uses_app_state_directory() {
        let _guard = settings_path_test_guard();
        let path = default_settings_path();

        assert!(path.ends_with(".codex-session-delete/settings.json"));
    }

    #[test]
    fn default_latest_status_path_uses_app_state_directory() {
        let path = default_latest_status_path();

        assert!(path.ends_with(".codex-session-delete/latest-status.json"));
    }

    #[test]
    fn default_diagnostic_log_path_uses_app_state_directory() {
        let path = default_diagnostic_log_path();

        assert!(path.ends_with(".codex-session-delete/alunixa-x.log"));
    }

    #[test]
    fn default_pending_provider_import_path_uses_app_state_directory() {
        let path = default_pending_provider_import_path();

        assert!(path.ends_with(".codex-session-delete/pending-provider-import.json"));
    }

    #[test]
    fn default_pending_remote_control_recovery_path_uses_app_state_directory() {
        let path = default_pending_remote_control_recovery_path();

        assert!(path.ends_with(".codex-session-delete/pending-remote-control-recovery.json"));
    }
}

pub fn default_pending_session_share_path() -> PathBuf {
    default_app_state_dir().join(PENDING_SESSION_SHARE_FILE)
}

pub fn default_skills_source_dir() -> PathBuf {
    default_app_state_dir().join(SKILLS_DIR)
}

pub fn default_skills_state_path() -> PathBuf {
    default_app_state_dir().join(SKILLS_STATE_FILE)
}

pub fn default_skill_backups_dir() -> PathBuf {
    default_app_state_dir().join(SKILL_BACKUPS_DIR)
}

pub fn default_pending_manager_navigation_path() -> PathBuf {
    default_app_state_dir().join(PENDING_MANAGER_NAVIGATION_FILE)
}

fn multi_state_dir_from_env(
    instance: Option<&std::ffi::OsStr>,
    state: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    if instance != Some(std::ffi::OsStr::new("1")) {
        return None;
    }
    let path = PathBuf::from(state?);
    (path.is_absolute() && path.parent().is_some()).then_some(path)
}

#[cfg(test)]
mod multi_state_tests {
    use super::*;
    use std::ffi::OsStr;
    #[test]
    fn override_is_worker_scoped_and_rejects_relative_or_root_paths() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("worker-home/.codex-session-delete");
        assert_eq!(
            multi_state_dir_from_env(Some(OsStr::new("1")), Some(path.as_os_str())),
            Some(path.clone())
        );
        assert_eq!(multi_state_dir_from_env(None, Some(path.as_os_str())), None);
        assert_eq!(
            multi_state_dir_from_env(Some(OsStr::new("1")), Some(OsStr::new("relative"))),
            None
        );
        let root = path.ancestors().last().unwrap();
        assert_eq!(
            multi_state_dir_from_env(Some(OsStr::new("1")), Some(root.as_os_str())),
            None
        );
    }

    // 显式状态目录覆盖是 Windows 多开隔离的前提：平台无关的环境变量，
    // 不依赖 HOME（Windows 上 directories 走 SHGetKnownFolderPath，不读 HOME）。
    #[test]
    fn state_dir_override_accepts_non_empty_paths_only() {
        assert_eq!(
            state_dir_override_from(Some(std::ffi::OsStr::new("/tmp/instance-state"))),
            Some(PathBuf::from("/tmp/instance-state"))
        );
        assert_eq!(
            state_dir_override_from(Some(std::ffi::OsStr::new("  /tmp/padded  "))),
            Some(PathBuf::from("/tmp/padded"))
        );
        assert_eq!(
            state_dir_override_from(Some(std::ffi::OsStr::new(""))),
            None
        );
        assert_eq!(
            state_dir_override_from(Some(std::ffi::OsStr::new("   "))),
            None
        );
        assert_eq!(state_dir_override_from(None), None);
    }

    #[test]
    fn default_app_state_dir_honours_explicit_override() {
        // `ALUNIXA_X_STATE_DIR` 是进程级环境变量，用作用域守卫保证并行测试看不到它。
        let _guard = settings_path_test_guard();
        let scope = StateDirEnvScope::set("/tmp/alunixa-x-instance-state");

        assert_eq!(
            default_app_state_dir(),
            PathBuf::from("/tmp/alunixa-x-instance-state")
        );

        drop(scope);
        assert!(default_app_state_dir().ends_with(".codex-session-delete"));
    }

    /// 测试用：临时设置 `ALUNIXA_X_STATE_DIR`，Drop 时恢复原值。
    struct StateDirEnvScope {
        previous: Option<std::ffi::OsString>,
    }

    impl StateDirEnvScope {
        fn set(value: &str) -> Self {
            let previous = std::env::var_os(STATE_DIR_ENV);
            unsafe { std::env::set_var(STATE_DIR_ENV, value) };
            Self { previous }
        }
    }

    impl Drop for StateDirEnvScope {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(previous) => unsafe { std::env::set_var(STATE_DIR_ENV, previous) },
                None => unsafe { std::env::remove_var(STATE_DIR_ENV) },
            }
        }
    }
}
