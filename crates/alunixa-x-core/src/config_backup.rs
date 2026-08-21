use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const BACKUP_FORMAT: &str = "alunixa-x-backup";
const SCHEMA_VERSION: u32 = 2;
const LEGACY_SCHEMA_VERSION: u32 = 1;
const MAX_BACKUP_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ConfigBackupPaths {
    pub settings_path: PathBuf,
    pub codex_home: PathBuf,
    pub user_scripts_dir: PathBuf,
    pub user_scripts_config_path: PathBuf,
    pub automatic_backup_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigImportResult {
    pub imported_from: String,
    pub automatic_backup_path: String,
    pub user_script_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigBackup {
    format: String,
    schema_version: u32,
    app_version: String,
    exported_at_unix: u64,
    settings: Value,
    codex_live: CodexLiveBackup,
    user_scripts: UserScriptsBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexLiveBackup {
    config_toml: Option<String>,
    auth_json: Option<String>,
    #[serde(default)]
    dotenv: Option<String>,
    #[serde(default)]
    model_catalogs: Vec<CodexTextFileBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexTextFileBackup {
    name: String,
    contents: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserScriptsBackup {
    config: Value,
    files: Vec<UserScriptBackup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UserScriptBackup {
    name: String,
    contents: String,
}

pub fn export_full_config(path: &Path, paths: &ConfigBackupPaths) -> anyhow::Result<usize> {
    let backup = collect_backup(paths)?;
    let script_count = backup.user_scripts.files.len();
    let bytes = serde_json::to_vec_pretty(&backup)?;
    atomic_replace(path, &bytes)?;
    Ok(script_count)
}

pub fn import_full_config(
    path: &Path,
    paths: &ConfigBackupPaths,
) -> anyhow::Result<ConfigImportResult> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect backup {}", path.display()))?;
    if metadata.len() > MAX_BACKUP_BYTES {
        anyhow::bail!("backup exceeds the 32 MiB size limit");
    }
    let bytes =
        fs::read(path).with_context(|| format!("failed to read backup {}", path.display()))?;
    let backup: ConfigBackup = serde_json::from_slice(&bytes)
        .with_context(|| format!("invalid Alunixa X backup JSON: {}", path.display()))?;
    validate_backup(&backup)?;

    fs::create_dir_all(&paths.automatic_backup_dir).with_context(|| {
        format!(
            "failed to create backup directory {}",
            paths.automatic_backup_dir.display()
        )
    })?;
    let automatic_backup_path = paths.automatic_backup_dir.join(format!(
        "alunixa-x-before-import-{}.json",
        unix_timestamp_millis()
    ));
    export_full_config(&automatic_backup_path, paths)?;

    let settings_bytes = serde_json::to_vec_pretty(&backup.settings)?;
    atomic_replace(&paths.settings_path, &settings_bytes)?;
    restore_optional_text(
        &paths.codex_home.join("config.toml"),
        backup.codex_live.config_toml.as_deref(),
    )?;
    restore_optional_text(
        &paths.codex_home.join("auth.json"),
        backup.codex_live.auth_json.as_deref(),
    )?;
    if backup.schema_version >= SCHEMA_VERSION {
        restore_optional_text(
            &paths.codex_home.join(".env"),
            backup.codex_live.dotenv.as_deref(),
        )?;
        restore_named_text_files(
            &paths.codex_home.join("model-catalogs"),
            &backup.codex_live.model_catalogs,
            "json",
        )?;
    }
    let script_config_bytes = serde_json::to_vec_pretty(&backup.user_scripts.config)?;
    atomic_replace(&paths.user_scripts_config_path, &script_config_bytes)?;
    restore_user_scripts(&paths.user_scripts_dir, &backup.user_scripts.files)?;

    Ok(ConfigImportResult {
        imported_from: path.to_string_lossy().to_string(),
        automatic_backup_path: automatic_backup_path.to_string_lossy().to_string(),
        user_script_count: backup.user_scripts.files.len(),
    })
}

fn collect_backup(paths: &ConfigBackupPaths) -> anyhow::Result<ConfigBackup> {
    let settings = read_json_object_or_default(&paths.settings_path, json!({}))?;
    let script_config = read_json_object_or_default(
        &paths.user_scripts_config_path,
        json!({"enabled": true, "scripts": {}}),
    )?;
    let mut files = Vec::new();
    if paths.user_scripts_dir.exists() {
        for entry in fs::read_dir(&paths.user_scripts_dir).with_context(|| {
            format!(
                "failed to read user scripts directory {}",
                paths.user_scripts_dir.display()
            )
        })? {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("js") {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            validate_script_name(name)?;
            files.push(UserScriptBackup {
                name: name.to_string(),
                contents: fs::read_to_string(&path)
                    .with_context(|| format!("failed to read user script {}", path.display()))?,
            });
        }
    }
    files.sort_by(|left, right| left.name.cmp(&right.name));

    Ok(ConfigBackup {
        format: BACKUP_FORMAT.to_string(),
        schema_version: SCHEMA_VERSION,
        app_version: crate::version::VERSION.to_string(),
        exported_at_unix: unix_timestamp(),
        settings,
        codex_live: CodexLiveBackup {
            config_toml: read_optional_text(&paths.codex_home.join("config.toml"))?,
            auth_json: read_optional_text(&paths.codex_home.join("auth.json"))?,
            dotenv: read_optional_text(&paths.codex_home.join(".env"))?,
            model_catalogs: collect_named_text_files(
                &paths.codex_home.join("model-catalogs"),
                "json",
            )?,
        },
        user_scripts: UserScriptsBackup {
            config: script_config,
            files,
        },
    })
}

fn validate_backup(backup: &ConfigBackup) -> anyhow::Result<()> {
    if backup.format != BACKUP_FORMAT {
        anyhow::bail!("unsupported backup format: {}", backup.format);
    }
    if !(LEGACY_SCHEMA_VERSION..=SCHEMA_VERSION).contains(&backup.schema_version) {
        anyhow::bail!(
            "unsupported backup schema version: {}",
            backup.schema_version
        );
    }
    if !backup.settings.is_object() {
        anyhow::bail!("backup settings must be a JSON object");
    }
    serde_json::from_value::<crate::settings::BackendSettings>(backup.settings.clone())
        .context("backup settings are invalid")?;
    if !backup.user_scripts.config.is_object() {
        anyhow::bail!("backup user script config must be a JSON object");
    }
    if let Some(config) = backup.codex_live.config_toml.as_deref() {
        config
            .parse::<toml::Value>()
            .context("backup config.toml is invalid")?;
    }
    if let Some(auth) = backup.codex_live.auth_json.as_deref() {
        serde_json::from_str::<Value>(auth).context("backup auth.json is invalid")?;
    }
    let mut model_catalog_names = BTreeSet::new();
    for catalog in &backup.codex_live.model_catalogs {
        validate_named_text_file(&catalog.name, "json")?;
        if !model_catalog_names.insert(catalog.name.to_ascii_lowercase()) {
            anyhow::bail!("duplicate model catalog in backup: {}", catalog.name);
        }
        serde_json::from_str::<Value>(&catalog.contents)
            .with_context(|| format!("backup model catalog is invalid: {}", catalog.name))?;
    }
    let mut names = BTreeSet::new();
    for script in &backup.user_scripts.files {
        validate_script_name(&script.name)?;
        if !names.insert(script.name.to_ascii_lowercase()) {
            anyhow::bail!("duplicate user script in backup: {}", script.name);
        }
    }
    Ok(())
}

fn restore_user_scripts(directory: &Path, scripts: &[UserScriptBackup]) -> anyhow::Result<()> {
    fs::create_dir_all(directory).with_context(|| {
        format!(
            "failed to create user scripts directory {}",
            directory.display()
        )
    })?;
    let imported = scripts
        .iter()
        .map(|script| script.name.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("js") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !imported.contains(&name.to_ascii_lowercase()) {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove user script {}", path.display()))?;
        }
    }
    for script in scripts {
        atomic_replace(&directory.join(&script.name), script.contents.as_bytes())?;
    }
    Ok(())
}

fn collect_named_text_files(
    directory: &Path,
    extension: &str,
) -> anyhow::Result<Vec<CodexTextFileBackup>> {
    let mut files = Vec::new();
    if !directory.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(directory)
        .with_context(|| format!("failed to read directory {}", directory.display()))?
    {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some(extension) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        validate_named_text_file(name, extension)?;
        files.push(CodexTextFileBackup {
            name: name.to_string(),
            contents: fs::read_to_string(&path)
                .with_context(|| format!("failed to read {}", path.display()))?,
        });
    }
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

fn restore_named_text_files(
    directory: &Path,
    files: &[CodexTextFileBackup],
    extension: &str,
) -> anyhow::Result<()> {
    fs::create_dir_all(directory)
        .with_context(|| format!("failed to create directory {}", directory.display()))?;
    let imported = files
        .iter()
        .map(|file| file.name.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some(extension) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !imported.contains(&name.to_ascii_lowercase()) {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove {}", path.display()))?;
        }
    }
    for file in files {
        validate_named_text_file(&file.name, extension)?;
        atomic_replace(&directory.join(&file.name), file.contents.as_bytes())?;
    }
    Ok(())
}

fn validate_named_text_file(name: &str, extension: &str) -> anyhow::Result<()> {
    let path = Path::new(name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || path.components().count() != 1
        || path.extension().and_then(|value| value.to_str()) != Some(extension)
    {
        anyhow::bail!("invalid backup filename: {name}");
    }
    Ok(())
}

fn validate_script_name(name: &str) -> anyhow::Result<()> {
    let path = Path::new(name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || path.components().count() != 1
        || path.extension().and_then(|value| value.to_str()) != Some("js")
    {
        anyhow::bail!("invalid user script filename: {name}");
    }
    Ok(())
}

fn read_json_object_or_default(path: &Path, default: Value) -> anyhow::Result<Value> {
    let Some(text) = read_optional_text(path)? else {
        return Ok(default);
    };
    let value: Value = serde_json::from_str(&text)
        .with_context(|| format!("invalid JSON in {}", path.display()))?;
    if !value.is_object() {
        anyhow::bail!("expected a JSON object in {}", path.display());
    }
    Ok(value)
}

fn read_optional_text(path: &Path) -> anyhow::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn restore_optional_text(path: &Path, contents: Option<&str>) -> anyhow::Result<()> {
    match contents {
        Some(contents) => atomic_replace(path, contents.as_bytes()),
        None if path.exists() => {
            fs::remove_file(path).with_context(|| format!("failed to remove {}", path.display()))
        }
        None => Ok(()),
    }
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let temp_path = path.with_extension(format!(
        "{}.import.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    ));
    fs::write(&temp_path, bytes)
        .with_context(|| format!("failed to write temporary file {}", temp_path.display()))?;

    #[cfg(windows)]
    if path.exists() {
        let old_path = path.with_extension(format!(
            "{}.import.old",
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
        ));
        let _ = fs::remove_file(&old_path);
        fs::rename(path, &old_path)
            .with_context(|| format!("failed to stage existing file {}", path.display()))?;
        if let Err(error) = fs::rename(&temp_path, path) {
            let _ = fs::rename(&old_path, path);
            return Err(error).with_context(|| format!("failed to replace {}", path.display()));
        }
        let _ = fs::remove_file(old_path);
        return Ok(());
    }

    fs::rename(&temp_path, path).with_context(|| format!("failed to replace {}", path.display()))
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_paths(root: &Path) -> ConfigBackupPaths {
        ConfigBackupPaths {
            settings_path: root.join("state/settings.json"),
            codex_home: root.join("codex"),
            user_scripts_dir: root.join("scripts/user_scripts"),
            user_scripts_config_path: root.join("scripts/user_scripts.json"),
            automatic_backup_dir: root.join("state/config-backups"),
        }
    }

    #[test]
    fn full_config_round_trip_restores_all_files() {
        let root = tempfile::tempdir().unwrap();
        let paths = test_paths(root.path());
        fs::create_dir_all(paths.settings_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&paths.codex_home).unwrap();
        fs::create_dir_all(&paths.user_scripts_dir).unwrap();
        fs::write(
            &paths.settings_path,
            r#"{"providerSyncEnabled":false,"unknown":7}"#,
        )
        .unwrap();
        fs::write(paths.codex_home.join("config.toml"), "model = \"test\"\n").unwrap();
        fs::write(
            paths.codex_home.join("auth.json"),
            r#"{"OPENAI_API_KEY":"secret"}"#,
        )
        .unwrap();
        fs::write(
            paths.codex_home.join(".env"),
            "OPENAI_BASE_URL=https://relay.test\n",
        )
        .unwrap();
        fs::create_dir_all(paths.codex_home.join("model-catalogs")).unwrap();
        fs::write(
            paths.codex_home.join("model-catalogs/custom.json"),
            r#"{"models":[{"slug":"custom-model"}]}"#,
        )
        .unwrap();
        fs::write(&paths.user_scripts_config_path, r#"{"enabled":true}"#).unwrap();
        fs::write(
            paths.user_scripts_dir.join("example.js"),
            "console.log('before');",
        )
        .unwrap();
        let export_path = root.path().join("full.codexpp-backup.json");

        assert_eq!(export_full_config(&export_path, &paths).unwrap(), 1);
        fs::write(&paths.settings_path, r#"{"providerSyncEnabled":true}"#).unwrap();
        fs::write(
            paths.codex_home.join("config.toml"),
            "model = \"changed\"\n",
        )
        .unwrap();
        fs::write(paths.codex_home.join(".env"), "CHANGED=1\n").unwrap();
        fs::write(
            paths.codex_home.join("model-catalogs/extra.json"),
            r#"{"models":[]}"#,
        )
        .unwrap();
        fs::write(paths.user_scripts_dir.join("extra.js"), "extra").unwrap();
        let result = import_full_config(&export_path, &paths).unwrap();

        let settings: Value =
            serde_json::from_str(&fs::read_to_string(&paths.settings_path).unwrap()).unwrap();
        assert_eq!(settings["unknown"], json!(7));
        assert_eq!(
            fs::read_to_string(paths.codex_home.join("config.toml")).unwrap(),
            "model = \"test\"\n"
        );
        assert_eq!(
            fs::read_to_string(paths.codex_home.join(".env")).unwrap(),
            "OPENAI_BASE_URL=https://relay.test\n"
        );
        assert!(paths.codex_home.join("model-catalogs/custom.json").exists());
        assert!(!paths.codex_home.join("model-catalogs/extra.json").exists());
        assert!(paths.user_scripts_dir.join("example.js").exists());
        assert!(!paths.user_scripts_dir.join("extra.js").exists());
        assert!(Path::new(&result.automatic_backup_path).exists());
    }

    #[test]
    fn legacy_backup_preserves_env_and_model_catalogs_missing_from_schema() {
        let root = tempfile::tempdir().unwrap();
        let paths = test_paths(root.path());
        fs::create_dir_all(paths.settings_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&paths.codex_home).unwrap();
        fs::create_dir_all(&paths.user_scripts_dir).unwrap();
        fs::write(&paths.settings_path, r#"{"enhancementsEnabled":true}"#).unwrap();
        fs::write(paths.codex_home.join("config.toml"), "model = \"legacy\"\n").unwrap();
        fs::write(paths.codex_home.join("auth.json"), "{}").unwrap();
        fs::write(paths.codex_home.join(".env"), "KEEP_ENV=1\n").unwrap();
        fs::create_dir_all(paths.codex_home.join("model-catalogs")).unwrap();
        fs::write(
            paths.codex_home.join("model-catalogs/keep.json"),
            r#"{"models":[{"slug":"keep"}]}"#,
        )
        .unwrap();

        let export_path = root.path().join("legacy.json");
        export_full_config(&export_path, &paths).unwrap();
        let mut backup: Value = serde_json::from_slice(&fs::read(&export_path).unwrap()).unwrap();
        backup["schemaVersion"] = Value::from(LEGACY_SCHEMA_VERSION);
        let live = backup["codexLive"].as_object_mut().unwrap();
        live.remove("dotenv");
        live.remove("modelCatalogs");
        fs::write(&export_path, serde_json::to_vec_pretty(&backup).unwrap()).unwrap();

        import_full_config(&export_path, &paths).unwrap();

        assert_eq!(
            fs::read_to_string(paths.codex_home.join(".env")).unwrap(),
            "KEEP_ENV=1\n"
        );
        assert!(paths.codex_home.join("model-catalogs/keep.json").exists());
    }

    #[test]
    fn import_rejects_script_path_traversal_before_writing() {
        let root = tempfile::tempdir().unwrap();
        let paths = test_paths(root.path());
        fs::create_dir_all(paths.settings_path.parent().unwrap()).unwrap();
        fs::write(&paths.settings_path, "{}").unwrap();
        let import_path = root.path().join("bad.json");
        fs::write(
            &import_path,
            serde_json::to_vec(&json!({
                "format": BACKUP_FORMAT,
                "schemaVersion": SCHEMA_VERSION,
                "appVersion": "1.0.0",
                "exportedAtUnix": 1,
                "settings": {},
                "codexLive": {"configToml": null, "authJson": null},
                "userScripts": {"config": {}, "files": [{"name": "../bad.js", "contents": "bad"}]}
            }))
            .unwrap(),
        )
        .unwrap();

        assert!(import_full_config(&import_path, &paths).is_err());
        assert_eq!(fs::read_to_string(&paths.settings_path).unwrap(), "{}");
    }
}
