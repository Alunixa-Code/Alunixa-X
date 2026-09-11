//! Deletion-only migration for the removed experimental context feature.
//! Never enables window rollover, registers tools, or reads conversation history.
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use serde_json::Value;
use toml_edit::{DocumentMut, TableLike};

const LEGACY_SERVER: &str = "alunixa-x-context";
const LEGACY_SETTING: &str = "codexAppExperimentalContext";
const MAX_CONFIG_BYTES: u64 = 32 * 1024 * 1024;

pub fn strip_config(contents: &str) -> anyhow::Result<String> {
    if !["context_management", "token_budget", LEGACY_SERVER]
        .iter()
        .any(|marker| contents.contains(marker))
    {
        return Ok(contents.to_string());
    }
    // Do not include parser diagnostics: they can quote provider credentials.
    let mut doc = contents
        .trim_start_matches('\u{feff}')
        .parse::<DocumentMut>()
        .map_err(|_| anyhow::anyhow!("退役上下文清理：配置不是有效 TOML，未修改原文件"))?;
    if !strip_scope(doc.as_table_mut()) {
        return Ok(contents.to_string());
    }
    let mut result = doc.to_string();
    if contents.contains("\r\n") {
        result = result.replace("\r\n", "\n").replace('\n', "\r\n");
    }
    if contents.starts_with('\u{feff}') {
        result.insert(0, '\u{feff}');
    }
    Ok(result)
}

fn strip_scope(scope: &mut dyn TableLike) -> bool {
    let mut changed = false;
    if let Some(features) = scope
        .get_mut("features")
        .and_then(|v| v.as_table_like_mut())
    {
        changed |= features.remove("token_budget").is_some();
        if let Some(context) = features
            .get_mut("context_management")
            .and_then(|v| v.as_table_like_mut())
        {
            changed |= context.remove("experimental_mode").is_some();
            if context.is_empty() {
                features.remove("context_management");
                changed = true;
            }
        }
        if features.is_empty() {
            scope.remove("features");
            changed = true;
        }
    }
    if let Some(servers) = scope
        .get_mut("mcp_servers")
        .and_then(|v| v.as_table_like_mut())
    {
        changed |= servers.remove(LEGACY_SERVER).is_some();
        if servers.is_empty() {
            scope.remove("mcp_servers");
            changed = true;
        }
    }
    if let Some(profiles) = scope
        .get_mut("profiles")
        .and_then(|v| v.as_table_like_mut())
    {
        for (_, profile) in profiles.iter_mut() {
            if let Some(profile) = profile.as_table_like_mut() {
                changed |= strip_scope(profile);
            }
        }
    }
    changed
}

/// Scrub only known configuration snapshots; never walk auth, instructions or arbitrary strings.
pub fn strip_settings_value(value: &mut Value) -> anyhow::Result<bool> {
    let object = value
        .as_object_mut()
        .context("退役上下文清理：settings 必须是 JSON object")?;
    let mut changed = object.remove(LEGACY_SETTING).is_some();
    for key in ["relayCommonConfigContents", "relayContextConfigContents"] {
        if let Some(Value::String(config)) = object.get_mut(key) {
            let cleaned = strip_config(config)?;
            changed |= cleaned != *config;
            *config = cleaned;
        }
    }
    if let Some(profiles) = object
        .get_mut("relayProfiles")
        .and_then(Value::as_array_mut)
    {
        for profile in profiles {
            if let Some(Value::String(config)) = profile.get_mut("configContents") {
                let cleaned = strip_config(config)?;
                changed |= cleaned != *config;
                *config = cleaned;
            }
        }
    }
    Ok(changed)
}

pub fn remove_from_home(home: &Path) -> anyhow::Result<bool> {
    edit_file(&home.join("config.toml"), |text| strip_config(text))
}

pub fn remove_from_settings_file(path: &Path) -> anyhow::Result<bool> {
    edit_file(path, |text| {
        let mut value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| anyhow::anyhow!("退役上下文清理：settings JSON 无效，未修改原文件"))?;
        if !strip_settings_value(&mut value)? {
            return Ok(text.to_string());
        }
        let mut updated = serde_json::to_string_pretty(&value)?;
        if text.starts_with('\u{feff}') {
            updated.insert(0, '\u{feff}');
        }
        Ok(updated)
    })
}

fn checked_file(path: &Path) -> anyhow::Result<Option<Vec<u8>>> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    reject_link(path)?;
    if let Some(parent) = path.parent() {
        reject_link(parent)?;
    }
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
        bail!("退役上下文清理：配置不是普通文件或超过大小限制");
    }
    Ok(Some(std::fs::read(path)?))
}

fn edit_file(
    path: &Path,
    transform: impl FnOnce(&str) -> anyhow::Result<String>,
) -> anyhow::Result<bool> {
    let Some(original) = checked_file(path)? else {
        return Ok(false);
    };
    let text = std::str::from_utf8(&original).context("退役上下文清理：配置不是 UTF-8")?;
    let updated = transform(text)?;
    if updated.as_bytes() == original {
        return Ok(false);
    }
    // Keep rollback copies alongside the user's protected configuration, never in a repository.
    let backup = backup_original(path, &original)?;
    if checked_file(path)?.as_deref() != Some(original.as_slice()) {
        bail!("退役上下文清理：配置被其他进程更新，已停止覆盖");
    }
    crate::settings::atomic_write(path, updated.as_bytes())
        .with_context(|| format!("保存清理配置失败；原始备份：{}", backup.display()))?;
    Ok(true)
}

fn backup_original(path: &Path, contents: &[u8]) -> anyhow::Result<PathBuf> {
    let parent = path.parent().context("配置路径缺少父目录")?;
    reject_link(parent)?;
    let directory = parent.join("alunixa-x-retirement-backups");
    std::fs::create_dir_all(&directory)?;
    reject_link(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    let name = path
        .file_name()
        .context("配置路径缺少文件名")?
        .to_string_lossy();
    let backup = directory.join(format!("{name}.{}.bak", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&backup)?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(backup)
}

fn reject_link(path: &Path) -> anyhow::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        bail!("退役上下文清理不跟随符号链接");
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            bail!("退役上下文清理不跟随重解析点");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const OLD: &str = r#"# preserve this
model = "custom"
model_context_window = 200000
model_auto_compact_token_limit = 180000
[features]
goals = true
[features.context_management]
experimental_mode = true
other_option = "keep"
[features.token_budget]
enabled = true
guidance_message = "old rollover guidance"
reminder_threshold_tokens = 16384
[mcp_servers.alunixa-x-context]
command = "old-companion"
args = ["--context-management"]
[mcp_servers.other]
command = "keep"
[model_providers.custom]
base_url = "https://example.test/v1"
experimental_bearer_token = "fixture-only"
"#;

    #[test]
    fn deletion_only_preserves_standard_compaction_and_unrelated_config() {
        let cleaned = strip_config(OLD).unwrap();
        let parsed: toml::Value = cleaned.parse().unwrap();
        let mut expected: toml::Value = OLD.parse().unwrap();
        expected["features"]
            .as_table_mut()
            .unwrap()
            .remove("token_budget");
        expected["features"]["context_management"]
            .as_table_mut()
            .unwrap()
            .remove("experimental_mode");
        expected["mcp_servers"]
            .as_table_mut()
            .unwrap()
            .remove(LEGACY_SERVER);
        assert_eq!(parsed, expected);
        assert!(cleaned.starts_with("# preserve this\n"));
        assert!(!cleaned.contains("old rollover guidance"));
        assert_eq!(strip_config(&cleaned).unwrap(), cleaned);
    }

    #[test]
    fn supports_boolean_dotted_inline_and_profile_overrides() {
        for original in [
            "[features]\ntoken_budget = true\ncontext_management.experimental_mode = true\n",
            "features.token_budget.enabled = true\nfeatures.context_management.experimental_mode = true\n",
            "features = {token_budget = {enabled = true}, context_management = {experimental_mode = true}}\n",
            "[profiles.work.features]\ntoken_budget = true\ncontext_management.experimental_mode = true\n[profiles.work.mcp_servers.alunixa-x-context]\ncommand = 'old'\n",
        ] {
            let cleaned = strip_config(original).unwrap();
            assert!(!cleaned.contains("token_budget"), "{cleaned}");
            assert!(!cleaned.contains("experimental_mode"), "{cleaned}");
            assert!(!cleaned.contains(LEGACY_SERVER), "{cleaned}");
            let _: toml::Value = cleaned.parse().unwrap();
        }
    }

    #[test]
    fn preserves_bom_crlf_and_unchanged_bytes() {
        let original = format!("\u{feff}{}", OLD.replace('\n', "\r\n"));
        let cleaned = strip_config(&original).unwrap();
        assert!(cleaned.starts_with('\u{feff}'));
        assert!(!cleaned.replace("\r\n", "").contains('\n'));
        assert_eq!(strip_config(&cleaned).unwrap(), cleaned);
        assert_eq!(
            strip_config("# token_budget mentioned in comment\nmodel='x'").unwrap(),
            "# token_budget mentioned in comment\nmodel='x'"
        );
    }

    #[test]
    fn scrubs_legacy_settings_and_snapshots_but_not_auth_or_instructions() {
        let mut raw = json!({
            "codexAppExperimentalContext": true, "unknownKey": "keep",
            "relayCommonConfigContents": OLD, "relayContextConfigContents": OLD,
            "relayProfiles": [{"configContents": OLD, "authContents": "keep auth bytes"}],
            "codexAppInstructions": "User text about context_management must stay",
        });
        assert!(strip_settings_value(&mut raw).unwrap());
        assert!(raw.get(LEGACY_SETTING).is_none());
        assert_eq!(raw["unknownKey"], "keep");
        assert_eq!(raw["relayProfiles"][0]["authContents"], "keep auth bytes");
        assert_eq!(
            raw["codexAppInstructions"],
            "User text about context_management must stay"
        );
        for text in [
            &raw["relayCommonConfigContents"],
            &raw["relayContextConfigContents"],
            &raw["relayProfiles"][0]["configContents"],
        ] {
            assert!(!text.as_str().unwrap().contains("token_budget"));
        }
        assert!(!strip_settings_value(&mut raw).unwrap());
    }

    #[test]
    fn home_migration_is_backed_up_once_and_retains_notes_and_history() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("config.toml");
        std::fs::write(&path, OLD).unwrap();
        std::fs::create_dir_all(temp.path().join("alunixa-x-context")).unwrap();
        let notes = temp.path().join("alunixa-x-context/notes.sqlite3");
        std::fs::write(&notes, b"retained").unwrap();
        assert!(remove_from_home(temp.path()).unwrap());
        assert!(!remove_from_home(temp.path()).unwrap());
        assert_eq!(std::fs::read(&notes).unwrap(), b"retained");
        let backups = std::fs::read_dir(temp.path().join("alunixa-x-retirement-backups"))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read(backups[0].path()).unwrap(), OLD.as_bytes());
    }

    #[test]
    fn missing_home_is_noop_and_malformed_config_is_not_overwritten_or_leaked() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!remove_from_home(&temp.path().join("missing")).unwrap());
        assert!(!temp.path().join("missing").exists());
        let text = "features.token_budget = [ secret_credential";
        std::fs::write(temp.path().join("config.toml"), text).unwrap();
        let error = remove_from_home(temp.path()).unwrap_err().to_string();
        assert!(!error.contains("secret_credential"));
        assert_eq!(
            std::fs::read_to_string(temp.path().join("config.toml")).unwrap(),
            text
        );
        assert!(!temp.path().join("alunixa-x-retirement-backups").exists());
    }

    #[test]
    fn settings_file_migration_keeps_unknown_fields_and_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let before = json!({"codexAppExperimentalContext":false, "relayProfiles":[{"configContents":OLD}], "custom":123});
        std::fs::write(&path, before.to_string()).unwrap();
        assert!(remove_from_settings_file(&path).unwrap());
        assert!(!remove_from_settings_file(&path).unwrap());
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["custom"], 123);
        assert!(after.get(LEGACY_SETTING).is_none());
    }
}
