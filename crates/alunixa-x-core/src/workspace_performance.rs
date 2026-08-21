use std::path::{Path, PathBuf};

use anyhow::Context;
use serde_json::Value;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct WorkspacePruneResult {
    pub removed: Vec<String>,
}

pub fn prune_broad_saved_workspace_roots() -> anyhow::Result<WorkspacePruneResult> {
    let state_path = crate::codex_home::default_codex_home_dir().join(".codex-global-state.json");
    prune_broad_saved_workspace_roots_at(&state_path)
}

fn prune_broad_saved_workspace_roots_at(state_path: &Path) -> anyhow::Result<WorkspacePruneResult> {
    if !state_path.is_file() {
        return Ok(WorkspacePruneResult::default());
    }
    let original = std::fs::read(state_path)
        .with_context(|| format!("failed to read {}", state_path.display()))?;
    let mut state: Value = serde_json::from_slice(&original)
        .with_context(|| format!("failed to parse {}", state_path.display()))?;
    let Some(object) = state.as_object_mut() else {
        return Ok(WorkspacePruneResult::default());
    };
    let active_keys = path_values(object.get("active-workspace-roots"))
        .iter()
        .map(|path| comparison_key(Path::new(path)))
        .collect::<Vec<_>>();
    let Some(saved) = object
        .get("electron-saved-workspace-roots")
        .and_then(Value::as_array)
    else {
        return Ok(WorkspacePruneResult::default());
    };
    let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
    let mut removed = Vec::new();
    let mut retained = Vec::with_capacity(saved.len());
    for value in saved {
        let Some(path) = value.as_str() else {
            retained.push(value.clone());
            continue;
        };
        let key = comparison_key(Path::new(path));
        let is_active = active_keys.iter().any(|active| active == &key);
        if !is_active && is_broad_root(Path::new(path), home.as_deref()) {
            removed.push(path.to_string());
        } else {
            retained.push(value.clone());
        }
    }
    if removed.is_empty() {
        return Ok(WorkspacePruneResult { removed });
    }
    object.insert(
        "electron-saved-workspace-roots".to_string(),
        Value::Array(retained),
    );
    let backup_path = state_path.with_file_name(".codex-global-state.performance.bak");
    std::fs::write(&backup_path, &original)
        .with_context(|| format!("failed to write {}", backup_path.display()))?;
    crate::settings::atomic_write(state_path, &serde_json::to_vec(&state)?)?;
    Ok(WorkspacePruneResult { removed })
}

fn path_values(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect(),
        Some(Value::String(value)) => vec![value.clone()],
        _ => Vec::new(),
    }
}

fn is_broad_root(path: &Path, home: Option<&Path>) -> bool {
    let key = comparison_key(path);
    if key.is_empty() || key == "/" || is_windows_drive_root(&key) {
        return true;
    }
    let Some(home) = home else {
        return false;
    };
    let home_key = comparison_key(home);
    key == home_key || key == comparison_key(&home.join("Desktop"))
}

fn comparison_key(path: &Path) -> String {
    let resolved = path.canonicalize().unwrap_or_else(|_| PathBuf::from(path));
    let key = resolved
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches("//?/")
        .to_string();
    if cfg!(windows) {
        key.trim_end_matches('/').to_ascii_lowercase()
    } else {
        let trimmed = key.trim_end_matches('/');
        if trimmed.is_empty() {
            "/".to_string()
        } else {
            trimmed.to_string()
        }
    }
}

fn is_windows_drive_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() == 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broad_root_detection_catches_home_desktop_and_drive_root() {
        let home = Path::new("C:/Users/tester");
        assert!(is_broad_root(home, Some(home)));
        assert!(is_broad_root(&home.join("Desktop"), Some(home)));
        assert!(is_broad_root(Path::new("C:/"), Some(home)));
        assert!(!is_broad_root(&home.join("source/project"), Some(home)));
    }
}
