use serde::Serialize;
use std::ffi::OsString;
use std::path::PathBuf;

const WINDOWS_USER_ENV_KEY: &str = "Environment";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConflict {
    pub name: String,
    pub source: EnvConflictSource,
    pub value_present: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EnvConflictSource {
    Process,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConflictRemoval {
    pub name: String,
    pub removed_process: bool,
    pub removed_user: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConflictRemovalResult {
    pub removed: Vec<EnvConflictRemoval>,
    pub backup_path: Option<String>,
}

pub fn is_codex_env_conflict_name(name: &str) -> bool {
    let name = name.trim();
    name.starts_with("OPENAI_")
}

pub fn detected_env_conflicts_from_pairs<I, K, V>(
    pairs: I,
    source: EnvConflictSource,
) -> Vec<EnvConflict>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<str>,
    V: AsRef<str>,
{
    detected_env_conflicts_from_pairs_except(pairs, source, &[])
}

/// 与 [`detected_env_conflicts_from_pairs`] 相同，但 `OPENAI_API_KEY` 的值若等于
/// 当前生效凭据之一就不算冲突：值相同时它覆盖不了任何东西，过去照样提示，
/// 用户把系统变量改成和 auth.json 一致后仍被反复警告（#2074）。
pub fn detected_env_conflicts_from_pairs_except<I, K, V>(
    pairs: I,
    source: EnvConflictSource,
    active_credentials: &[String],
) -> Vec<EnvConflict>
where
    I: IntoIterator<Item = (K, V)>,
    K: AsRef<str>,
    V: AsRef<str>,
{
    let mut conflicts = pairs
        .into_iter()
        .filter_map(|(name, value)| {
            let name = name.as_ref().trim();
            if !is_codex_env_conflict_name(name) {
                return None;
            }
            let trimmed = value.as_ref().trim();
            if name == "OPENAI_API_KEY"
                && !trimmed.is_empty()
                && active_credentials
                    .iter()
                    .any(|credential| credential == trimmed)
            {
                return None;
            }
            Some(EnvConflict {
                name: name.to_string(),
                source,
                value_present: !value.as_ref().trim().is_empty(),
            })
        })
        .collect::<Vec<_>>();
    conflicts.sort_by(|left, right| left.name.cmp(&right.name));
    conflicts.dedup_by(|left, right| left.name == right.name && left.source == right.source);
    conflicts
}

pub fn detect_env_conflicts() -> Vec<EnvConflict> {
    detect_env_conflicts_except(&[])
}

/// 以 Codex home 里当前生效的凭据为基准检测冲突（与这些凭据相同的 `OPENAI_API_KEY` 不报）。
pub fn detect_env_conflicts_for_home(home: &std::path::Path) -> Vec<EnvConflict> {
    detect_env_conflicts_except(&crate::relay_config::active_api_credentials_in_home(home))
}

fn detect_env_conflicts_except(active_credentials: &[String]) -> Vec<EnvConflict> {
    let mut conflicts = detected_env_conflicts_from_os_pairs(
        std::env::vars_os(),
        EnvConflictSource::Process,
        active_credentials,
    );
    conflicts.extend(detect_user_env_conflicts(active_credentials));
    conflicts.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| source_order(left.source).cmp(&source_order(right.source)))
    });
    conflicts.dedup_by(|left, right| left.name == right.name && left.source == right.source);
    conflicts
}

fn detected_env_conflicts_from_os_pairs<I>(
    pairs: I,
    source: EnvConflictSource,
    active_credentials: &[String],
) -> Vec<EnvConflict>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let pairs = pairs.into_iter().filter_map(|(name, value)| {
        let name = name.into_string().ok()?;
        Some((name, value.to_string_lossy().into_owned()))
    });
    detected_env_conflicts_from_pairs_except(pairs, source, active_credentials)
}

pub fn remove_env_conflicts(
    names: &[String],
    backup_dir: PathBuf,
) -> anyhow::Result<EnvConflictRemovalResult> {
    remove_env_conflicts_with_user_env(names, backup_dir, true)
}

pub fn remove_process_env_conflicts_for_tests(
    names: &[String],
    backup_dir: PathBuf,
) -> anyhow::Result<EnvConflictRemovalResult> {
    remove_env_conflicts_with_user_env(names, backup_dir, false)
}

fn remove_env_conflicts_with_user_env(
    names: &[String],
    backup_dir: PathBuf,
    remove_user_env: bool,
) -> anyhow::Result<EnvConflictRemovalResult> {
    let names = normalized_conflict_names(names);
    if names.is_empty() {
        return Ok(EnvConflictRemovalResult {
            removed: Vec::new(),
            backup_path: None,
        });
    }

    std::fs::create_dir_all(&backup_dir)?;
    let backup_path = backup_dir.join(format!("env-conflicts-{}.json", timestamp_millis()));
    let before = detect_env_conflicts()
        .into_iter()
        .filter(|conflict| names.iter().any(|name| name == &conflict.name))
        .collect::<Vec<_>>();
    std::fs::write(&backup_path, serde_json::to_vec_pretty(&before)?)?;

    let mut removed = Vec::new();
    for name in names {
        let had_process = std::env::var_os(&name).is_some();
        unsafe {
            std::env::remove_var(&name);
        }
        let removed_user = remove_user_env && remove_user_env_value(&name)?;
        removed.push(EnvConflictRemoval {
            name,
            removed_process: had_process,
            removed_user,
        });
    }

    Ok(EnvConflictRemovalResult {
        removed,
        backup_path: Some(backup_path.to_string_lossy().to_string()),
    })
}

fn normalized_conflict_names(names: &[String]) -> Vec<String> {
    let mut names = names
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| is_codex_env_conflict_name(name))
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

fn source_order(source: EnvConflictSource) -> u8 {
    match source {
        EnvConflictSource::Process => 0,
        EnvConflictSource::User => 1,
    }
}

fn timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(windows)]
fn detect_user_env_conflicts(active_credentials: &[String]) -> Vec<EnvConflict> {
    crate::windows_integration::read_current_user_string_values(WINDOWS_USER_ENV_KEY)
        .unwrap_or_default()
        .into_iter()
        .map(|(name, value)| (name, value.unwrap_or_default()))
        .pipe(|pairs| {
            detected_env_conflicts_from_pairs_except(
                pairs,
                EnvConflictSource::User,
                active_credentials,
            )
        })
}

#[cfg(not(windows))]
fn detect_user_env_conflicts(_active_credentials: &[String]) -> Vec<EnvConflict> {
    Vec::new()
}

#[cfg(windows)]
fn remove_user_env_value(name: &str) -> anyhow::Result<bool> {
    crate::windows_integration::delete_current_user_value(WINDOWS_USER_ENV_KEY, name)?;
    Ok(true)
}

#[cfg(not(windows))]
fn remove_user_env_value(_name: &str) -> anyhow::Result<bool> {
    Ok(false)
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_openai_prefixed_conflicts_but_not_codex_home() {
        let conflicts = detected_env_conflicts_from_pairs(
            [
                ("OPENAI_API_KEY", "sk-test"),
                ("OPENAI_BASE_URL", "https://example.test/v1"),
                ("CODEX_HOME", "C:/Users/me/.codex"),
                ("CUSTOM_OPENAI_API_KEY", "sk-custom"),
            ],
            EnvConflictSource::Process,
        );

        assert_eq!(
            conflicts
                .iter()
                .map(|conflict| conflict.name.as_str())
                .collect::<Vec<_>>(),
            vec!["OPENAI_API_KEY", "OPENAI_BASE_URL"]
        );
    }

    #[test]
    fn api_key_matching_the_active_credential_is_not_a_conflict() {
        let active = vec!["sk-active".to_string()];
        let conflicts = detected_env_conflicts_from_pairs_except(
            [
                ("OPENAI_API_KEY", " sk-active "),
                ("OPENAI_BASE_URL", "https://example.test/v1"),
            ],
            EnvConflictSource::User,
            &active,
        );
        assert_eq!(
            conflicts
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            vec!["OPENAI_BASE_URL"],
            "值与当前凭据相同的 OPENAI_API_KEY 不应报冲突；其它变量照常"
        );

        let conflicts = detected_env_conflicts_from_pairs_except(
            [("OPENAI_API_KEY", "sk-stale")],
            EnvConflictSource::User,
            &active,
        );
        assert_eq!(conflicts.len(), 1, "不同值仍是冲突");

        let conflicts = detected_env_conflicts_from_pairs_except(
            [("OPENAI_API_KEY", "")],
            EnvConflictSource::Process,
            &[String::new()],
        );
        assert_eq!(conflicts.len(), 1, "空值不能因为凭据也为空而被放过");
    }

    #[test]
    fn active_credentials_come_from_auth_json_and_active_provider_token() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(
            home.path().join("auth.json"),
            r#"{"OPENAI_API_KEY":"sk-auth"}"#,
        )
        .unwrap();
        std::fs::write(
            home.path().join("config.toml"),
            "model_provider = \"custom\"\n\n[model_providers.custom]\nexperimental_bearer_token = \"sk-bearer\"\n",
        )
        .unwrap();
        assert_eq!(
            crate::relay_config::active_api_credentials_in_home(home.path()),
            vec!["sk-auth".to_string(), "sk-bearer".to_string()]
        );
    }

    #[test]
    fn removal_normalization_only_keeps_conflict_names() {
        assert_eq!(
            normalized_conflict_names(&[
                "CODEX_HOME".to_string(),
                "OPENAI_API_KEY".to_string(),
                " OPENAI_BASE_URL ".to_string(),
                "OPENAI_API_KEY".to_string(),
            ]),
            vec!["OPENAI_API_KEY", "OPENAI_BASE_URL"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn os_pairs_ignore_non_unicode_names_and_tolerate_non_unicode_values() {
        use std::os::unix::ffi::OsStringExt;

        let conflicts = detected_env_conflicts_from_os_pairs(
            [
                (
                    OsString::from("OPENAI_API_KEY"),
                    OsString::from_vec(vec![b's', b'k', b'-', 0xFF]),
                ),
                (OsString::from_vec(vec![0xFF]), OsString::from("ignored")),
            ],
            EnvConflictSource::Process,
            &[],
        );

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].name, "OPENAI_API_KEY");
        assert!(conflicts[0].value_present);
    }
}
