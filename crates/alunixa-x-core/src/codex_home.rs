use std::path::{Path, PathBuf};

pub fn default_codex_home_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .filter(|path| codex_home_env_dir_is_valid(path))
        .unwrap_or_else(default_user_codex_home_dir)
}

fn codex_home_env_dir_is_valid(path: &PathBuf) -> bool {
    !path.as_os_str().is_empty() && !path.to_string_lossy().trim().is_empty()
}

fn default_user_codex_home_dir() -> PathBuf {
    directories::BaseDirs::new()
        .map(|dirs| dirs.home_dir().join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::path::Path;
    use std::sync::Mutex;

    static CODEX_HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    struct CodexHomeEnvGuard {
        previous: Option<OsString>,
    }

    impl CodexHomeEnvGuard {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("CODEX_HOME");
            unsafe {
                std::env::set_var("CODEX_HOME", path);
            }
            Self { previous }
        }

        fn set_raw(value: &str) -> Self {
            let previous = std::env::var_os("CODEX_HOME");
            unsafe {
                std::env::set_var("CODEX_HOME", value);
            }
            Self { previous }
        }
    }

    impl Drop for CodexHomeEnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.previous {
                    Some(value) => std::env::set_var("CODEX_HOME", value),
                    None => std::env::remove_var("CODEX_HOME"),
                }
            }
        }
    }

    #[test]
    fn default_codex_home_dir_uses_existing_codex_home_env_dir() {
        let _lock = CODEX_HOME_ENV_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let codex_home = temp.path().join("custom-codex-home");
        std::fs::create_dir_all(&codex_home).unwrap();
        let _guard = CodexHomeEnvGuard::set(&codex_home);

        assert_eq!(default_codex_home_dir(), codex_home);
        assert_eq!(crate::relay_config::default_codex_home_dir(), codex_home);
        assert_eq!(crate::codex_sqlite::default_codex_home_dir(), codex_home);
    }

    #[test]
    fn default_codex_home_dir_honors_uncreated_home_but_ignores_empty_value() {
        let _lock = CODEX_HOME_ENV_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing-codex-home");
        let expected = default_user_codex_home_dir();

        {
            let _guard = CodexHomeEnvGuard::set_raw("   ");
            assert_eq!(default_codex_home_dir(), expected);
            assert_eq!(crate::relay_config::default_codex_home_dir(), expected);
            assert_eq!(crate::codex_sqlite::default_codex_home_dir(), expected);
        }

        {
            let _guard = CodexHomeEnvGuard::set(&missing);
            assert_eq!(default_codex_home_dir(), missing);
            assert_eq!(crate::relay_config::default_codex_home_dir(), missing);
            assert_eq!(crate::codex_sqlite::default_codex_home_dir(), missing);
        }
    }
}

pub fn ensure_safe_recursive_removal(target: &Path, codex_home: &Path) -> anyhow::Result<()> {
    let target = normalize_for_comparison(target);

    // 根路径 = 有根前缀且没有父目录，覆盖 POSIX 根（`/`）与 Windows 的各种写法
    // （`C:\`、`\\?\C:\`、UNC `\\server\share\`）。
    //
    // 不能只与 `Path::new("/")` 比较：Windows 上 `/` 不是绝对路径，会被 normalize
    // 成当前盘符根（如 `C:\`），相等比较拦不住它——也就是说递归删除盘符根本可以
    // 绕过这道守卫。`has_root()` 这一半也不可省：没有它 `C:` 会被误判成根。
    if target.as_os_str().is_empty() || is_filesystem_root(&target) {
        anyhow::bail!("拒绝删除文件系统根目录：{}", target.display());
    }
    let home = normalize_for_comparison(codex_home);
    if target == home {
        anyhow::bail!(
            "拒绝递归删除 CODEX_HOME 本身（{}）——这会连同全部会话历史一起丢失",
            target.display()
        );
    }
    if home.starts_with(&target) {
        anyhow::bail!(
            "拒绝删除 CODEX_HOME 的祖先目录 {}（CODEX_HOME = {}）",
            target.display(),
            home.display()
        );
    }
    Ok(())
}

fn is_filesystem_root(path: &Path) -> bool {
    path.has_root() && path.parent().is_none()
}

/// 规范化到可比较的形态。
///
/// 关键点：**必须两边用同一种方式规范化**。如果待删路径能 canonicalize、而 home
/// 不存在只能走词法，两边就会一个带 `/private` 前缀一个不带（macOS 的 `/var` →
/// `/private/var` 就是这种），比较直接失效、守卫形同虚设。
///
/// 所以先 canonicalize **最深的已存在祖先**，再把剩下还不存在的部分按词法拼回去。
/// 这样无论路径存在与否，结果都稳定在同一形态；`..` 也在词法阶段消掉。
fn normalize_for_comparison(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    let lexical = lexically_normalize(&absolute);
    if is_filesystem_root(&lexical) {
        return lexical;
    }

    // 找到最深的、真实存在的祖先，用它拿到 canonical 前缀
    let mut ancestor = lexical.as_path();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(canonical) = ancestor.canonicalize() {
            let mut result = canonical;
            for component in tail.iter().rev() {
                result.push(component);
            }
            return result;
        }
        let Some(name) = ancestor.file_name() else {
            return lexical;
        };
        tail.push(name.to_os_string());
        let Some(parent) = ancestor.parent() else {
            return lexical;
        };
        ancestor = parent;
    }
}

/// 纯词法规范化：消掉 `.` 与 `..`、重复分隔符，不做任何文件系统访问。
fn lexically_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}
