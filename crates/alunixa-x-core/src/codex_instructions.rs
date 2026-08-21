use std::path::{Path, PathBuf};

use anyhow::Context;
use toml_edit::{DocumentMut, Item};

pub const MANAGED_MODEL_INSTRUCTIONS_FILE: &str = "~/.codex/TSC_ZYL_PJ/do_special.md";
const MANAGED_DIRECTORY: &str = "TSC_ZYL_PJ";
const MANAGED_FILE: &str = "do_special.md";

pub fn managed_instructions_path(home: &Path) -> PathBuf {
    home.join(MANAGED_DIRECTORY).join(MANAGED_FILE)
}

pub fn apply_model_instructions_policy(
    home: &Path,
    enabled: bool,
    instructions: &str,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(home)?;
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = parse_config(&existing)?;
    let current = doc
        .get("model_instructions_file")
        .and_then(Item::as_str)
        .unwrap_or_default()
        .to_string();

    if enabled {
        let instructions_path = managed_instructions_path(home);
        if let Some(parent) = instructions_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        crate::settings::atomic_write(&instructions_path, instructions.as_bytes())
            .with_context(|| format!("failed to write {}", instructions_path.display()))?;
        doc["model_instructions_file"] = toml_edit::value(MANAGED_MODEL_INSTRUCTIONS_FILE);
    } else if current == MANAGED_MODEL_INSTRUCTIONS_FILE {
        doc.as_table_mut().remove("model_instructions_file");
        let path = managed_instructions_path(home);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error).with_context(|| format!("failed to remove {}", path.display()));
            }
        }
    }

    let updated = normalize_config(doc.to_string());
    if updated != normalize_config(existing) {
        crate::settings::atomic_write(&config_path, updated.as_bytes())
            .with_context(|| format!("failed to write {}", config_path.display()))?;
    }
    Ok(())
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
    if incoming_doc.get("model_instructions_file").is_none() {
        incoming_doc["model_instructions_file"] = toml_edit::value(value);
    }
    Ok(normalize_config(incoming_doc.to_string()))
}

pub fn strip_managed_model_instructions_file(config: &str) -> anyhow::Result<String> {
    let mut doc = parse_config(config)?;
    if doc.get("model_instructions_file").and_then(Item::as_str)
        == Some(MANAGED_MODEL_INSTRUCTIONS_FILE)
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
        .context("config.toml TOML parse failed")
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
        assert!(config.contains(&format!(
            "model_instructions_file = \"{MANAGED_MODEL_INSTRUCTIONS_FILE}\""
        )));
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
}
