use std::path::{Path, PathBuf};

use anyhow::Context;
use toml_edit::{DocumentMut, Item};

pub const MANAGED_MODEL_INSTRUCTIONS_FILE: &str = "~/.codex/TSC_ZYL_PJ/do_special.md";
const MANAGED_DIRECTORY: &str = "TSC_ZYL_PJ";
const MANAGED_FILE: &str = "do_special.md";
const BACKUP_FILE: &str = "do_special.md.last-good";
const DEFAULT_INSTRUCTIONS: &str = "# Global instructions\n\nFollow the user's task requirements, verify your work, and report results accurately.\n";
const MAX_INSTRUCTIONS_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ModelInstructionsAudit {
    pub files_scanned: usize,
    pub references_checked: usize,
}

pub fn managed_instructions_path(home: &Path) -> PathBuf {
    home.join(MANAGED_DIRECTORY).join(MANAGED_FILE)
}

pub fn apply_model_instructions_policy(
    home: &Path,
    enabled: bool,
    instructions: &str,
) -> anyhow::Result<()> {
    sync_model_instructions(home, enabled, instructions, true).map(|_| ())
}

/// Run after all launch-time config writers. Existing text always wins over
/// stale settings during automatic repair; an explicit editor save can replace it.
pub fn ensure_model_instructions_before_launch(
    home: &Path,
    enabled: bool,
    instructions: &str,
) -> anyhow::Result<bool> {
    sync_model_instructions(home, enabled, instructions, false)
}

/// Scan every advanced-instruction source before launch without changing
/// user-owned external files or logging their contents.
pub fn audit_model_instructions_before_launch(
    home: &Path,
    enabled: bool,
    instructions: &str,
) -> anyhow::Result<ModelInstructionsAudit> {
    let config_path = home.join("config.toml");
    let config = read_optional_text(&config_path)?.unwrap_or_default();
    let doc = parse_config(&config)?;
    let reference = doc
        .get("model_instructions_file")
        .and_then(Item::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let managed_reference = is_managed_reference(&reference, home);
    if enabled && reference.is_empty() {
        anyhow::bail!("启动前高级提示词扫描失败：已启用但 model_instructions_file 缺失");
    }
    if !enabled && managed_reference {
        anyhow::bail!("启动前高级提示词扫描失败：功能已关闭但托管提示词引用仍存在");
    }

    let mut audit = ModelInstructionsAudit::default();
    if !reference.is_empty() {
        audit.references_checked += 1;
        scan_instruction_file(&resolve_instruction_reference(home, &reference))?;
        audit.files_scanned += 1;
    }

    for path in [
        managed_instructions_path(home),
        home.join(MANAGED_DIRECTORY).join(BACKUP_FILE),
    ] {
        if path.is_file() {
            scan_instruction_file(&path)?;
            audit.files_scanned += 1;
        }
    }
    if !instructions.trim().is_empty() {
        scan_instruction_text(instructions)?;
    }
    Ok(audit)
}

pub fn sync_model_instructions_after_settings_save(
    home: &Path,
    previous: &crate::settings::BackendSettings,
    settings: &crate::settings::BackendSettings,
) -> anyhow::Result<()> {
    if previous.codex_app_instructions_enabled != settings.codex_app_instructions_enabled
        || previous.codex_app_instructions != settings.codex_app_instructions
    {
        apply_model_instructions_policy(
            home,
            settings.codex_app_instructions_enabled,
            &settings.codex_app_instructions,
        )
    } else {
        ensure_model_instructions_before_launch(
            home,
            settings.codex_app_instructions_enabled,
            &settings.codex_app_instructions,
        )
        .map(|_| ())
    }
}

fn sync_model_instructions(
    home: &Path,
    enabled: bool,
    instructions: &str,
    explicit_save: bool,
) -> anyhow::Result<bool> {
    let config_path = home.join("config.toml");
    let existing = read_optional_text(&config_path)?.unwrap_or_default();
    let mut doc = parse_config(&existing)?;
    let current = doc
        .get("model_instructions_file")
        .and_then(Item::as_str)
        .unwrap_or_default()
        .to_string();
    let current_is_managed = is_managed_reference(&current, home);
    let mut changed = false;

    if enabled || (!explicit_save && current_is_managed) {
        // Automatic launch repair must not replace a user-selected external file.
        if !explicit_save && !current.trim().is_empty() && !current_is_managed {
            return Ok(false);
        }
        let instructions_path = managed_instructions_path(home);
        let backup_path = home.join(MANAGED_DIRECTORY).join(BACKUP_FILE);
        let current_text = read_optional_text(&instructions_path)?;
        let backup_text = read_optional_text(&backup_path)?;
        let text = if explicit_save && !instructions.trim().is_empty() {
            instructions
        } else {
            current_text
                .as_deref()
                .filter(|text| !text.trim().is_empty())
                .or_else(|| {
                    backup_text
                        .as_deref()
                        .filter(|text| !text.trim().is_empty())
                })
                .or_else(|| (!instructions.trim().is_empty()).then_some(instructions))
                .unwrap_or(DEFAULT_INSTRUCTIONS)
        };
        changed |= write_if_changed(&instructions_path, current_text.as_deref(), text)?;
        changed |= write_if_changed(&backup_path, backup_text.as_deref(), text)?;
        let reference = std::path::absolute(&instructions_path)?
            .to_string_lossy()
            .replace('\\', "/");
        if current != reference {
            doc["model_instructions_file"] = toml_edit::value(reference);
        }
    } else if explicit_save && current_is_managed {
        // Disabling detaches the opt-in, but keeps the user's text for re-enabling.
        doc.as_table_mut().remove("model_instructions_file");
    }

    let updated = normalize_config(doc.to_string());
    if updated != normalize_config(existing.clone()) {
        changed |= write_if_changed(&config_path, Some(&existing), &updated)?;
    }
    Ok(changed)
}

fn is_managed_reference(value: &str, home: &Path) -> bool {
    let normalize = |path: &str| {
        let path = path.replace('\\', "/");
        if cfg!(windows) {
            path.to_lowercase()
        } else {
            path
        }
    };
    normalize(value) == normalize(MANAGED_MODEL_INSTRUCTIONS_FILE)
        || normalize(value) == normalize(&format!("{MANAGED_DIRECTORY}/{MANAGED_FILE}"))
        || std::path::absolute(managed_instructions_path(home))
            .is_ok_and(|path| normalize(value) == normalize(&path.to_string_lossy()))
}

fn resolve_instruction_reference(home: &Path, value: &str) -> PathBuf {
    let value = value.replace('\\', "/");
    if let Some(relative) = value.strip_prefix("~/") {
        return home
            .parent()
            .unwrap_or(home)
            .join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    }
    let path = PathBuf::from(&value);
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

fn scan_instruction_file(path: &Path) -> anyhow::Result<()> {
    let metadata = std::fs::metadata(path)
        .with_context(|| format!("启动前高级提示词扫描失败：无法读取 {}", path.display()))?;
    if !metadata.is_file() {
        anyhow::bail!("启动前高级提示词扫描失败：{} 不是普通文件", path.display());
    }
    if metadata.len() > MAX_INSTRUCTIONS_BYTES {
        anyhow::bail!("启动前高级提示词扫描失败：提示词文件超过大小限制");
    }
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("启动前高级提示词扫描失败：无法读取 {}", path.display()))?;
    scan_instruction_text(&text)
}

fn scan_instruction_text(text: &str) -> anyhow::Result<()> {
    if text.as_bytes().len() as u64 > MAX_INSTRUCTIONS_BYTES {
        anyhow::bail!("启动前高级提示词扫描失败：提示词内容超过大小限制");
    }
    if text.trim().is_empty() {
        anyhow::bail!("启动前高级提示词扫描失败：提示词文件内容为空");
    }
    if text.contains('\0') {
        anyhow::bail!("启动前高级提示词扫描失败：提示词内容包含 NUL 字符");
    }
    Ok(())
}

fn read_optional_text(path: &Path) -> anyhow::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn write_if_changed(path: &Path, previous: Option<&str>, text: &str) -> anyhow::Result<bool> {
    if previous == Some(text) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    crate::settings::atomic_write(path, text.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(true)
}

pub fn preserve_model_instructions_file(existing: &str, incoming: &str) -> anyhow::Result<String> {
    let existing_doc = parse_config(existing)?;
    let Some(value) = existing_doc
        .get("model_instructions_file")
        .and_then(Item::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(normalize_config(incoming.to_string()));
    };
    let mut incoming_doc = parse_config(incoming)?;
    if incoming_doc
        .get("model_instructions_file")
        .and_then(Item::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        incoming_doc["model_instructions_file"] = toml_edit::value(value);
    }
    Ok(normalize_config(incoming_doc.to_string()))
}

pub fn strip_managed_model_instructions_file(config: &str) -> anyhow::Result<String> {
    let mut doc = parse_config(config)?;
    if doc
        .get("model_instructions_file")
        .and_then(Item::as_str)
        .is_some_and(|value| {
            is_managed_reference(value, &crate::relay_config::default_codex_home_dir())
        })
    {
        doc.as_table_mut().remove("model_instructions_file");
    }
    Ok(normalize_config(doc.to_string()))
}

fn parse_config(config: &str) -> anyhow::Result<DocumentMut> {
    let config = config.strip_prefix('\u{feff}').unwrap_or(config);
    if config.trim().is_empty() {
        return Ok(DocumentMut::new());
    }
    config
        .parse::<DocumentMut>()
        .map_err(|_| anyhow::anyhow!("config.toml TOML parse failed"))
}

fn normalize_config(mut config: String) -> String {
    if !config.is_empty() && !config.ends_with('\n') {
        config.push('\n');
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_writes_managed_file_and_preserves_other_config() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("config.toml"), "model = \"gpt-test\"\n").unwrap();

        apply_model_instructions_policy(temp.path(), true, "Always verify output.").unwrap();

        let config = std::fs::read_to_string(temp.path().join("config.toml")).unwrap();
        assert!(config.contains("model = \"gpt-test\""));
        let doc = parse_config(&config).unwrap();
        assert!(is_managed_reference(
            doc["model_instructions_file"].as_str().unwrap(),
            temp.path()
        ));
        assert!(
            !doc["model_instructions_file"]
                .as_str()
                .unwrap()
                .starts_with('~')
        );
        assert_eq!(
            std::fs::read_to_string(managed_instructions_path(temp.path())).unwrap(),
            "Always verify output."
        );
    }

    #[test]
    fn disabling_only_removes_alunixa_x_managed_path() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("config.toml"),
            "model_instructions_file = \"~/mine.md\"\n",
        )
        .unwrap();

        apply_model_instructions_policy(temp.path(), false, "").unwrap();

        let config = std::fs::read_to_string(temp.path().join("config.toml")).unwrap();
        assert!(config.contains("~/mine.md"));
    }

    #[test]
    fn provider_rewrite_preserves_existing_instruction_path() {
        let existing = format!(
            "model_instructions_file = \"{MANAGED_MODEL_INSTRUCTIONS_FILE}\"\nmodel = \"old\"\n"
        );
        let updated = preserve_model_instructions_file(&existing, "model = \"new\"\n").unwrap();

        assert!(updated.contains(MANAGED_MODEL_INSTRUCTIONS_FILE));
        assert!(updated.contains("model = \"new\""));
    }

    #[test]
    fn startup_restores_missing_file_reference_and_last_good_custom_text() {
        let temp = tempfile::tempdir().unwrap();
        let file = managed_instructions_path(temp.path());
        apply_model_instructions_policy(temp.path(), true, "saved text").unwrap();
        std::fs::write(&file, "newer text edited directly").unwrap();
        assert!(ensure_model_instructions_before_launch(temp.path(), true, "saved text").unwrap());
        std::fs::remove_file(&file).unwrap();
        std::fs::write(
            temp.path().join("config.toml"),
            "model = \"after-update\"\n",
        )
        .unwrap();
        assert!(ensure_model_instructions_before_launch(temp.path(), true, "saved text").unwrap());
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "newer text edited directly"
        );
        assert!(!ensure_model_instructions_before_launch(temp.path(), true, "").unwrap());
        assert!(
            std::fs::read_to_string(temp.path().join("config.toml"))
                .unwrap()
                .contains("after-update")
        );
    }

    #[test]
    fn agent_capability_save_does_not_erase_existing_instructions() {
        let temp = tempfile::tempdir().unwrap();
        let previous = crate::settings::BackendSettings {
            codex_app_instructions_enabled: true,
            codex_app_instructions: "editor snapshot".to_string(),
            ..Default::default()
        };
        apply_model_instructions_policy(temp.path(), true, "editor snapshot").unwrap();
        let file = managed_instructions_path(temp.path());
        std::fs::write(&file, "custom file content").unwrap();
        let mut updated = previous.clone();
        updated.codex_app_shared_terminal = !updated.codex_app_shared_terminal;
        sync_model_instructions_after_settings_save(temp.path(), &previous, &updated).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "custom file content"
        );
        updated.codex_app_instructions = "explicit editor change".to_string();
        sync_model_instructions_after_settings_save(temp.path(), &previous, &updated).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "explicit editor change"
        );
    }

    #[test]
    fn disabling_retains_text_and_startup_respects_the_disabled_setting() {
        let temp = tempfile::tempdir().unwrap();
        apply_model_instructions_policy(temp.path(), true, "keep me").unwrap();
        apply_model_instructions_policy(temp.path(), false, "").unwrap();
        assert_eq!(
            std::fs::read_to_string(managed_instructions_path(temp.path())).unwrap(),
            "keep me"
        );
        assert!(!ensure_model_instructions_before_launch(temp.path(), false, "").unwrap());
        assert!(
            !std::fs::read_to_string(temp.path().join("config.toml"))
                .unwrap()
                .contains("model_instructions_file")
        );
        apply_model_instructions_policy(temp.path(), true, "").unwrap();
        assert_eq!(
            std::fs::read_to_string(managed_instructions_path(temp.path())).unwrap(),
            "keep me"
        );
    }

    #[test]
    fn startup_recovers_legacy_reference_without_deleting_on_default_settings() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("config.toml"),
            format!("model_instructions_file = \"{MANAGED_MODEL_INSTRUCTIONS_FILE}\"\n"),
        )
        .unwrap();
        assert!(
            ensure_model_instructions_before_launch(temp.path(), false, "restored text").unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(managed_instructions_path(temp.path())).unwrap(),
            "restored text"
        );
        assert!(!ensure_model_instructions_before_launch(temp.path(), false, "").unwrap());
    }

    #[test]
    fn startup_preserves_external_instruction_reference_and_rejects_unreadable_config() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.toml");
        let original = "model_instructions_file = \"~/custom-prompt.md\"\n";
        std::fs::write(&config, original).unwrap();
        assert!(!ensure_model_instructions_before_launch(temp.path(), true, "default").unwrap());
        assert_eq!(std::fs::read_to_string(&config).unwrap(), original);
        assert!(!managed_instructions_path(temp.path()).exists());
        std::fs::write(&config, [0xff, 0xfe, 0xfd]).unwrap();
        assert!(ensure_model_instructions_before_launch(temp.path(), true, "default").is_err());
        assert_eq!(std::fs::read(&config).unwrap(), [0xff, 0xfe, 0xfd]);
    }

    #[test]
    fn first_launch_creates_nonempty_template_only_for_an_enabled_feature() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!ensure_model_instructions_before_launch(temp.path(), false, "").unwrap());
        assert!(!managed_instructions_path(temp.path()).exists());
        assert!(ensure_model_instructions_before_launch(temp.path(), true, "").unwrap());
        assert_eq!(
            std::fs::read_to_string(managed_instructions_path(temp.path())).unwrap(),
            DEFAULT_INSTRUCTIONS
        );
        assert!(!ensure_model_instructions_before_launch(temp.path(), true, "").unwrap());
    }
}
