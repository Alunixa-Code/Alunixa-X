use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

const CLEANUP_VERSION: u32 = 2;
const IMAGE_PREFIX: &[u8] = b"data:image/";
const BASE64_MARKER: &[u8] = b";base64,";
const IMAGE_REF_PREFIX: &[u8] = b"alunixa-x-image-ref:";
const BACKUP_NAMESPACE: &str = "rollout-image-cleanup";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RolloutImageCleanupStatus {
    Preview,
    Cleaned,
    Restored,
    UpToDate,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutImageBackupSummary {
    pub id: String,
    pub created_at: String,
    pub changed_files: usize,
    pub image_copies: u64,
    pub bytes_reclaimed: u64,
    pub restored_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutImageCleanupResult {
    pub status: RolloutImageCleanupStatus,
    pub message: String,
    pub scanned_files: usize,
    pub candidate_files: usize,
    pub changed_files: usize,
    pub image_copies: u64,
    pub unique_images: usize,
    pub bytes_reclaimable: u64,
    pub bytes_reclaimed: u64,
    pub backup_dir: Option<PathBuf>,
    pub skipped_active_sessions: bool,
    pub rollback_protected_files: usize,
    pub invalid_files: usize,
    pub backups: Vec<RolloutImageBackupSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    len: u64,
    modified_ms: u64,
}

#[derive(Debug)]
struct FilePlan {
    path: PathBuf,
    relative_path: String,
    fingerprint: FileFingerprint,
    clean_before_line: usize,
    image_copies: u64,
    bytes_reclaimable: u64,
    hashes: BTreeSet<String>,
}

#[derive(Debug, Default)]
struct CleanupPlan {
    files: Vec<FilePlan>,
    scanned_files: usize,
    rollback_protected_files: usize,
    invalid_files: usize,
    hashes: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    version: u32,
    namespace: String,
    id: String,
    created_at: String,
    changed_files: usize,
    image_copies: u64,
    bytes_reclaimed: u64,
    files: Vec<BackupFile>,
    restored_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    relative_path: String,
    image_copies: u64,
    bytes_reclaimed: u64,
    hashes: Vec<String>,
}

struct CleanupLock {
    path: PathBuf,
}

impl Drop for CleanupLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.path);
    }
}

pub fn preview_rollout_image_cleanup(
    codex_home: Option<&Path>,
) -> anyhow::Result<RolloutImageCleanupResult> {
    let home = resolve_home(codex_home);
    let include_active_sessions =
        alunixa_x_core::watcher::find_session_index_cleanup_blocking_processes().is_empty();
    preview_rollout_image_cleanup_in_home(&home, include_active_sessions)
}

pub fn preview_rollout_image_cleanup_in_home(
    home: &Path,
    include_active_sessions: bool,
) -> anyhow::Result<RolloutImageCleanupResult> {
    if !home.exists() {
        return Ok(empty_result(
            home,
            RolloutImageCleanupStatus::Skipped,
            format!("Codex home not found: {}", home.display()),
            !include_active_sessions,
        ));
    }
    let plan = build_plan(home, include_active_sessions)?;
    let mut result = result_from_plan(home, &plan, !include_active_sessions);
    result.status = RolloutImageCleanupStatus::Preview;
    result.message = if result.image_copies == 0 {
        if include_active_sessions {
            "No obsolete compacted image copies were found".to_string()
        } else {
            "Codex is running; only archived rollouts were previewed".to_string()
        }
    } else {
        format!(
            "Found {} obsolete compacted image copies in {} files; approximately {} bytes can be reclaimed",
            result.image_copies, result.candidate_files, result.bytes_reclaimable
        )
    };
    Ok(result)
}

pub fn run_rollout_image_cleanup(
    codex_home: Option<&Path>,
) -> anyhow::Result<RolloutImageCleanupResult> {
    let home = resolve_home(codex_home);
    let include_active_sessions =
        alunixa_x_core::watcher::find_session_index_cleanup_blocking_processes().is_empty();
    run_rollout_image_cleanup_guarded(&home, include_active_sessions, true)
}

pub fn run_rollout_image_cleanup_in_home(
    home: &Path,
    include_active_sessions: bool,
) -> anyhow::Result<RolloutImageCleanupResult> {
    run_rollout_image_cleanup_guarded(home, include_active_sessions, false)
}

fn run_rollout_image_cleanup_guarded(
    home: &Path,
    include_active_sessions: bool,
    guard_active_processes: bool,
) -> anyhow::Result<RolloutImageCleanupResult> {
    if !home.exists() {
        return Ok(empty_result(
            home,
            RolloutImageCleanupStatus::Skipped,
            format!("Codex home not found: {}", home.display()),
            !include_active_sessions,
        ));
    }
    let _lock = acquire_lock(home)?;
    let plan = build_plan(home, include_active_sessions)?;
    if plan.files.is_empty() {
        let mut result = result_from_plan(home, &plan, !include_active_sessions);
        result.status = RolloutImageCleanupStatus::UpToDate;
        result.message = if include_active_sessions {
            "Rollout images are already compacted safely".to_string()
        } else {
            "Codex is running; only archived rollouts were cleaned".to_string()
        };
        return Ok(result);
    }

    let backup_root = backup_root(home);
    let blob_root = backup_root.join("blobs");
    let (backup_dir, backup_id) = create_backup_run(&backup_root)?;
    fs::create_dir_all(&blob_root)?;
    let mut manifest = BackupManifest {
        version: CLEANUP_VERSION,
        namespace: BACKUP_NAMESPACE.to_string(),
        id: backup_id,
        created_at: chrono::Utc::now().to_rfc3339(),
        changed_files: 0,
        image_copies: 0,
        bytes_reclaimed: 0,
        files: Vec::new(),
        restored_at: None,
    };
    write_manifest(&backup_dir, &manifest)?;

    for file_plan in &plan.files {
        if guard_active_processes
            && include_active_sessions
            && !alunixa_x_core::watcher::find_session_index_cleanup_blocking_processes().is_empty()
        {
            break;
        }
        if fingerprint(&file_plan.path)? != file_plan.fingerprint {
            continue;
        }
        let transformed = transform_file(file_plan, &blob_root)?;
        let Some((temp_path, written_hashes)) = transformed else {
            continue;
        };
        if fingerprint(&file_plan.path)? != file_plan.fingerprint
            || (guard_active_processes
                && include_active_sessions
                && !alunixa_x_core::watcher::find_session_index_cleanup_blocking_processes()
                    .is_empty())
        {
            remove_temp(&temp_path);
            continue;
        }

        manifest.files.push(BackupFile {
            relative_path: file_plan.relative_path.clone(),
            image_copies: file_plan.image_copies,
            bytes_reclaimed: file_plan.bytes_reclaimable,
            hashes: written_hashes.into_iter().collect(),
        });
        write_manifest(&backup_dir, &manifest)?;
        alunixa_x_core::settings::atomic_replace_file(&temp_path, &file_plan.path)?;
        manifest.changed_files += 1;
        manifest.image_copies += file_plan.image_copies;
        manifest.bytes_reclaimed += file_plan.bytes_reclaimable;
        write_manifest(&backup_dir, &manifest)?;
    }

    if manifest.changed_files == 0 {
        let _ = fs::remove_dir_all(&backup_dir);
    }
    let mut result = result_from_plan(home, &plan, !include_active_sessions);
    result.changed_files = manifest.changed_files;
    result.image_copies = manifest.image_copies;
    result.bytes_reclaimed = manifest.bytes_reclaimed;
    result.backup_dir = (manifest.changed_files > 0).then_some(backup_dir);
    result.backups = list_backups(home);
    result.status = if manifest.changed_files > 0 {
        RolloutImageCleanupStatus::Cleaned
    } else {
        RolloutImageCleanupStatus::Skipped
    };
    result.message = if manifest.changed_files > 0 {
        format!(
            "Externalized {} obsolete compacted image copies in {} files and reclaimed {} bytes",
            manifest.image_copies, manifest.changed_files, manifest.bytes_reclaimed
        )
    } else {
        "Rollout files changed or Codex started while cleanup was scanning; no file was replaced"
            .to_string()
    };
    Ok(result)
}

pub fn restore_rollout_image_cleanup(
    codex_home: Option<&Path>,
    backup_id: &str,
) -> anyhow::Result<RolloutImageCleanupResult> {
    let home = resolve_home(codex_home);
    if !alunixa_x_core::watcher::find_session_index_cleanup_blocking_processes().is_empty() {
        return Ok(empty_result(
            &home,
            RolloutImageCleanupStatus::Skipped,
            "Close Codex and ChatGPT before restoring rollout images".to_string(),
            true,
        ));
    }
    restore_rollout_image_cleanup_in_home(&home, backup_id)
}

pub fn restore_rollout_image_cleanup_in_home(
    home: &Path,
    backup_id: &str,
) -> anyhow::Result<RolloutImageCleanupResult> {
    validate_backup_id(backup_id)?;
    let _lock = acquire_lock(home)?;
    let backup_dir = backup_root(home).join("runs").join(backup_id);
    let mut manifest = load_manifest(&backup_dir)?;
    if manifest.namespace != BACKUP_NAMESPACE || manifest.version != CLEANUP_VERSION {
        anyhow::bail!("unsupported rollout image backup manifest")
    }
    let blob_root = backup_root(home).join("blobs");
    let mut changed_files = 0;
    let mut restored_images = 0_u64;
    for file in &manifest.files {
        let path = safe_rollout_path(home, &file.relative_path)?;
        if !path.is_file() {
            continue;
        }
        let before = fingerprint(&path)?;
        let Some((temp_path, replacements)) = restore_file(&path, &blob_root, &file.hashes)? else {
            continue;
        };
        if fingerprint(&path)? != before {
            remove_temp(&temp_path);
            continue;
        }
        alunixa_x_core::settings::atomic_replace_file(&temp_path, &path)?;
        changed_files += 1;
        restored_images += replacements;
    }
    if changed_files > 0 {
        manifest.restored_at = Some(chrono::Utc::now().to_rfc3339());
        write_manifest(&backup_dir, &manifest)?;
    }
    Ok(RolloutImageCleanupResult {
        status: if changed_files > 0 {
            RolloutImageCleanupStatus::Restored
        } else {
            RolloutImageCleanupStatus::UpToDate
        },
        message: if changed_files > 0 {
            format!("Restored {restored_images} rollout image copies in {changed_files} files")
        } else {
            "This rollout image backup is already restored or its files no longer exist".to_string()
        },
        scanned_files: manifest.files.len(),
        candidate_files: manifest.files.len(),
        changed_files,
        image_copies: restored_images,
        unique_images: 0,
        bytes_reclaimable: 0,
        bytes_reclaimed: 0,
        backup_dir: Some(backup_dir),
        skipped_active_sessions: false,
        rollback_protected_files: 0,
        invalid_files: 0,
        backups: list_backups(home),
    })
}

fn build_plan(home: &Path, include_active_sessions: bool) -> anyhow::Result<CleanupPlan> {
    let mut plan = CleanupPlan::default();
    for path in rollout_files(home, include_active_sessions)? {
        plan.scanned_files += 1;
        match analyze_file(home, &path) {
            Ok(Some(file)) => {
                plan.hashes.extend(file.hashes.iter().cloned());
                plan.files.push(file);
            }
            Ok(None) => {}
            Err(AnalyzeError::RollbackProtected) => plan.rollback_protected_files += 1,
            Err(AnalyzeError::Invalid) => plan.invalid_files += 1,
            Err(AnalyzeError::Io(error)) => return Err(error.into()),
        }
    }
    Ok(plan)
}

enum AnalyzeError {
    RollbackProtected,
    Invalid,
    Io(std::io::Error),
}

fn analyze_file(home: &Path, path: &Path) -> Result<Option<FilePlan>, AnalyzeError> {
    let source = open_rollout_for_cleanup(path).map_err(AnalyzeError::Io)?;
    let mut reader = BufReader::new(source);
    let mut line = Vec::new();
    let mut line_index = 0_usize;
    let mut compacted = Vec::new();
    let mut rollback = false;
    loop {
        line.clear();
        if reader
            .read_until(b'\n', &mut line)
            .map_err(AnalyzeError::Io)?
            == 0
        {
            break;
        }
        if contains(&line, b"thread_rolled_back") {
            rollback = true;
        }
        if contains(&line, b"\"compacted\"") && contains(&line, b"replacement_history") {
            let value: serde_json::Value =
                serde_json::from_slice(&line).map_err(|_| AnalyzeError::Invalid)?;
            if value.get("type").and_then(serde_json::Value::as_str) == Some("compacted")
                && value
                    .get("payload")
                    .and_then(|payload| payload.get("replacement_history"))
                    .is_some_and(|history| !history.is_null())
            {
                compacted.push(line_index);
            }
        }
        line_index += 1;
    }
    if rollback && !compacted.is_empty() {
        return Err(AnalyzeError::RollbackProtected);
    }
    let Some(protected) = compacted.pop() else {
        return Ok(None);
    };
    if compacted.is_empty() {
        return Ok(None);
    }

    drop(reader);
    let source = open_rollout_for_cleanup(path).map_err(AnalyzeError::Io)?;
    let mut reader = BufReader::new(source);
    let mut hashes = BTreeSet::new();
    let mut image_copies = 0_u64;
    let mut bytes_reclaimable = 0_u64;
    line_index = 0;
    loop {
        line.clear();
        if reader
            .read_until(b'\n', &mut line)
            .map_err(AnalyzeError::Io)?
            == 0
        {
            break;
        }
        if line_index < protected {
            for candidate in data_images(&line) {
                let hash = sha256_hex(candidate);
                image_copies += 1;
                bytes_reclaimable += candidate
                    .len()
                    .saturating_sub(IMAGE_REF_PREFIX.len() + hash.len())
                    as u64;
                hashes.insert(hash);
            }
        }
        line_index += 1;
    }
    drop(reader);
    if image_copies == 0 {
        return Ok(None);
    }
    let _ = protected;
    Ok(Some(FilePlan {
        path: path.to_path_buf(),
        relative_path: state_key(home, path),
        fingerprint: fingerprint(path)
            .map_err(|error| AnalyzeError::Io(std::io::Error::other(error.to_string())))?,
        clean_before_line: protected,
        image_copies,
        bytes_reclaimable,
        hashes,
    }))
}

fn transform_file(
    plan: &FilePlan,
    blob_root: &Path,
) -> anyhow::Result<Option<(PathBuf, BTreeSet<String>)>> {
    let source = open_rollout_for_cleanup(&plan.path)?;
    let temp_path = temp_path(&plan.path);
    remove_temp(&temp_path);
    let temp = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)?;
    let mut reader = BufReader::new(source);
    let mut writer = BufWriter::new(temp);
    let mut line = Vec::new();
    let mut line_index = 0_usize;
    let mut written_hashes = BTreeSet::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        if line_index < plan.clean_before_line {
            let next = replace_data_images(&line, |candidate, hash| {
                write_blob(blob_root, hash, candidate)?;
                written_hashes.insert(hash.to_string());
                Ok(image_reference(hash))
            })?;
            writer.write_all(&next)?;
        } else {
            writer.write_all(&line)?;
        }
        line_index += 1;
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;
    drop(writer);
    drop(reader);
    if written_hashes.is_empty() {
        remove_temp(&temp_path);
        Ok(None)
    } else {
        Ok(Some((temp_path, written_hashes)))
    }
}

fn restore_file(
    path: &Path,
    blob_root: &Path,
    hashes: &[String],
) -> anyhow::Result<Option<(PathBuf, u64)>> {
    let allowed = hashes.iter().cloned().collect::<HashSet<_>>();
    let source = open_rollout_for_cleanup(path)?;
    let temp_path = temp_path(path);
    remove_temp(&temp_path);
    let temp = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)?;
    let mut reader = BufReader::new(source);
    let mut writer = BufWriter::new(temp);
    let mut line = Vec::new();
    let mut replacements = 0_u64;
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        let next = replace_image_references(&line, &allowed, blob_root, &mut replacements)?;
        writer.write_all(&next)?;
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;
    drop(writer);
    drop(reader);
    if replacements == 0 {
        remove_temp(&temp_path);
        Ok(None)
    } else {
        Ok(Some((temp_path, replacements)))
    }
}

fn replace_data_images<F>(line: &[u8], mut replacement: F) -> anyhow::Result<Vec<u8>>
where
    F: FnMut(&[u8], &str) -> anyhow::Result<Vec<u8>>,
{
    let mut output = Vec::with_capacity(line.len());
    let mut cursor = 0;
    while let Some(relative) = find_subslice(&line[cursor..], IMAGE_PREFIX) {
        let start = cursor + relative;
        output.extend_from_slice(&line[cursor..start]);
        let Some(relative_end) = line[start..].iter().position(|byte| *byte == b'"') else {
            output.extend_from_slice(&line[start..]);
            return Ok(output);
        };
        let end = start + relative_end;
        let candidate = &line[start..end];
        if contains(candidate, BASE64_MARKER) {
            let hash = sha256_hex(candidate);
            output.extend_from_slice(&replacement(candidate, &hash)?);
        } else {
            output.extend_from_slice(candidate);
        }
        cursor = end;
    }
    output.extend_from_slice(&line[cursor..]);
    Ok(output)
}

fn replace_image_references(
    line: &[u8],
    allowed: &HashSet<String>,
    blob_root: &Path,
    replacements: &mut u64,
) -> anyhow::Result<Vec<u8>> {
    let mut output = Vec::with_capacity(line.len());
    let mut cursor = 0;
    while let Some(relative) = find_subslice(&line[cursor..], IMAGE_REF_PREFIX) {
        let start = cursor + relative;
        output.extend_from_slice(&line[cursor..start]);
        let hash_start = start + IMAGE_REF_PREFIX.len();
        if hash_start + 64 > line.len() {
            output.extend_from_slice(&line[start..]);
            return Ok(output);
        }
        let hash = std::str::from_utf8(&line[hash_start..hash_start + 64]).unwrap_or_default();
        if !allowed.contains(hash) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            output.extend_from_slice(&line[start..hash_start + 64]);
        } else {
            let blob = fs::read(blob_root.join(format!("{hash}.data-url")))?;
            if sha256_hex(&blob) != hash {
                anyhow::bail!("rollout image blob hash mismatch: {hash}")
            }
            output.extend_from_slice(&blob);
            *replacements += 1;
        }
        cursor = hash_start + 64;
    }
    output.extend_from_slice(&line[cursor..]);
    Ok(output)
}

fn data_images(line: &[u8]) -> Vec<&[u8]> {
    let mut images = Vec::new();
    let mut cursor = 0;
    while let Some(relative) = find_subslice(&line[cursor..], IMAGE_PREFIX) {
        let start = cursor + relative;
        let Some(relative_end) = line[start..].iter().position(|byte| *byte == b'"') else {
            break;
        };
        let end = start + relative_end;
        let candidate = &line[start..end];
        if contains(candidate, BASE64_MARKER) {
            images.push(candidate);
        }
        cursor = end;
    }
    images
}

fn write_blob(root: &Path, hash: &str, value: &[u8]) -> anyhow::Result<()> {
    let path = root.join(format!("{hash}.data-url"));
    if path.exists() {
        let existing = fs::read(&path)?;
        if sha256_hex(&existing) != hash || existing != value {
            anyhow::bail!("rollout image blob collision: {hash}")
        }
        return Ok(());
    }
    let temp = root.join(format!(".{hash}-{}.tmp", std::process::id()));
    fs::write(&temp, value)?;
    match fs::rename(&temp, &path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            let _ = fs::remove_file(temp);
            let existing = fs::read(path)?;
            if existing == value {
                Ok(())
            } else {
                anyhow::bail!("rollout image blob collision: {hash}")
            }
        }
        Err(error) => Err(error.into()),
    }
}

fn result_from_plan(
    home: &Path,
    plan: &CleanupPlan,
    skipped_active_sessions: bool,
) -> RolloutImageCleanupResult {
    RolloutImageCleanupResult {
        status: RolloutImageCleanupStatus::Preview,
        message: String::new(),
        scanned_files: plan.scanned_files,
        candidate_files: plan.files.len(),
        changed_files: 0,
        image_copies: plan.files.iter().map(|file| file.image_copies).sum(),
        unique_images: plan.hashes.len(),
        bytes_reclaimable: plan.files.iter().map(|file| file.bytes_reclaimable).sum(),
        bytes_reclaimed: 0,
        backup_dir: None,
        skipped_active_sessions,
        rollback_protected_files: plan.rollback_protected_files,
        invalid_files: plan.invalid_files,
        backups: list_backups(home),
    }
}

fn empty_result(
    home: &Path,
    status: RolloutImageCleanupStatus,
    message: String,
    skipped_active_sessions: bool,
) -> RolloutImageCleanupResult {
    RolloutImageCleanupResult {
        status,
        message,
        scanned_files: 0,
        candidate_files: 0,
        changed_files: 0,
        image_copies: 0,
        unique_images: 0,
        bytes_reclaimable: 0,
        bytes_reclaimed: 0,
        backup_dir: None,
        skipped_active_sessions,
        rollback_protected_files: 0,
        invalid_files: 0,
        backups: list_backups(home),
    }
}

fn list_backups(home: &Path) -> Vec<RolloutImageBackupSummary> {
    let runs = backup_root(home).join("runs");
    let Ok(entries) = fs::read_dir(runs) else {
        return Vec::new();
    };
    let mut backups = entries
        .filter_map(Result::ok)
        .filter_map(|entry| load_manifest(&entry.path()).ok())
        .map(|manifest| RolloutImageBackupSummary {
            id: manifest.id,
            created_at: manifest.created_at,
            changed_files: manifest.changed_files,
            image_copies: manifest.image_copies,
            bytes_reclaimed: manifest.bytes_reclaimed,
            restored_at: manifest.restored_at,
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.id.cmp(&left.id));
    backups
}

fn create_backup_run(root: &Path) -> anyhow::Result<(PathBuf, String)> {
    let runs = root.join("runs");
    fs::create_dir_all(&runs)?;
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S%.3f");
    for suffix in 0..1000_u16 {
        let id = if suffix == 0 {
            timestamp.to_string()
        } else {
            format!("{timestamp}-{suffix}")
        };
        let directory = runs.join(&id);
        match fs::create_dir(&directory) {
            Ok(()) => return Ok((directory, id)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    anyhow::bail!("could not allocate rollout image backup directory")
}

fn write_manifest(directory: &Path, manifest: &BackupManifest) -> anyhow::Result<()> {
    alunixa_x_core::settings::atomic_write(
        &directory.join("metadata.json"),
        &serde_json::to_vec_pretty(manifest)?,
    )
}

fn load_manifest(directory: &Path) -> anyhow::Result<BackupManifest> {
    Ok(serde_json::from_slice(&fs::read(
        directory.join("metadata.json"),
    )?)?)
}

fn safe_rollout_path(home: &Path, relative: &str) -> anyhow::Result<PathBuf> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        anyhow::bail!("unsafe rollout backup path")
    }
    let path = home.join(relative);
    let allowed =
        path.starts_with(home.join("sessions")) || path.starts_with(home.join("archived_sessions"));
    if !allowed || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        anyhow::bail!("rollout backup path is outside supported session roots")
    }
    Ok(path)
}

fn validate_backup_id(id: &str) -> anyhow::Result<()> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
    {
        anyhow::bail!("invalid rollout image backup id")
    }
    Ok(())
}

fn acquire_lock(home: &Path) -> anyhow::Result<CleanupLock> {
    let path = home.join("tmp/rollout-image-cleanup.lock");
    fs::create_dir_all(path.parent().unwrap_or(home))?;
    fs::create_dir(&path).map_err(|error| {
        anyhow::anyhow!("rollout image cleanup is already running or lock failed: {error}")
    })?;
    Ok(CleanupLock { path })
}

fn rollout_files(home: &Path, include_active_sessions: bool) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if include_active_sessions {
        collect_jsonl_files(&home.join("sessions"), &mut files)?;
    }
    collect_jsonl_files(&home.join("archived_sessions"), &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    Ok(())
}

fn fingerprint(path: &Path) -> anyhow::Result<FileFingerprint> {
    let metadata = fs::metadata(path)?;
    let modified_ms = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileFingerprint {
        len: metadata.len(),
        modified_ms,
    })
}

fn resolve_home(codex_home: Option<&Path>) -> PathBuf {
    codex_home
        .map(Path::to_path_buf)
        .unwrap_or_else(alunixa_x_core::codex_sqlite::default_codex_home_dir)
}

fn backup_root(home: &Path) -> PathBuf {
    home.join("backups_state").join(BACKUP_NAMESPACE)
}

fn state_key(home: &Path, path: &Path) -> String {
    path.strip_prefix(home)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn image_reference(hash: &str) -> Vec<u8> {
    let mut value = Vec::with_capacity(IMAGE_REF_PREFIX.len() + hash.len());
    value.extend_from_slice(IMAGE_REF_PREFIX);
    value.extend_from_slice(hash.as_bytes());
    value
}

fn sha256_hex(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("rollout.jsonl");
    path.with_file_name(format!(".{name}.alunixa-x-{}.tmp", std::process::id()))
}

fn remove_temp(path: &Path) {
    let _ = fs::remove_file(path);
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    find_subslice(haystack, needle).is_some()
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(windows)]
fn open_rollout_for_cleanup(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new().read(true).share_mode(0).open(path)
}

#[cfg(not(windows))]
fn open_rollout_for_cleanup(path: &Path) -> std::io::Result<File> {
    File::open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(byte: u8, count: usize) -> String {
        format!(
            "data:image/png;base64,{}",
            char::from(byte).to_string().repeat(count)
        )
    }

    fn compacted(image: &str) -> String {
        format!(
            "{{\"type\":\"compacted\",\"payload\":{{\"message\":\"summary\",\"replacement_history\":[{{\"type\":\"message\",\"content\":[{{\"type\":\"input_image\",\"image_url\":\"{image}\"}}]}}]}}}}\n"
        )
    }

    #[test]
    fn cleanup_only_externalizes_obsolete_checkpoints_and_restores_exact_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let sessions = temp.path().join("sessions/2026/07/31");
        fs::create_dir_all(&sessions).unwrap();
        let rollout = sessions.join("rollout-test.jsonl");
        let first = image(b'A', 4096);
        let current = image(b'B', 4096);
        let original = format!(
            "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"content\":[{{\"type\":\"input_image\",\"image_url\":\"{first}\"}}]}}}}\n{}{}",
            compacted(&first),
            compacted(&current)
        );
        fs::write(&rollout, &original).unwrap();

        let result = run_rollout_image_cleanup_in_home(temp.path(), true).unwrap();
        let cleaned = fs::read_to_string(&rollout).unwrap();

        assert_eq!(result.status, RolloutImageCleanupStatus::Cleaned);
        assert_eq!(result.image_copies, 2);
        assert!(!cleaned.contains(&first));
        assert!(cleaned.contains(&current));
        assert!(cleaned.contains("alunixa-x-image-ref:"));
        let backup_id = result.backups[0].id.clone();
        let restored = restore_rollout_image_cleanup_in_home(temp.path(), &backup_id).unwrap();
        assert_eq!(restored.status, RolloutImageCleanupStatus::Restored);
        assert_eq!(fs::read_to_string(rollout).unwrap(), original);
    }

    #[test]
    fn rollback_files_retain_every_checkpoint_conservatively() {
        let temp = tempfile::tempdir().unwrap();
        let rollout = temp.path().join("sessions/rollout-rollback.jsonl");
        fs::create_dir_all(rollout.parent().unwrap()).unwrap();
        let original_image = image(b'C', 2048);
        let content = format!(
            "{}{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"thread_rolled_back\",\"num_turns\":1}}}}\n{}",
            compacted(&original_image),
            compacted(&original_image)
        );
        fs::write(&rollout, &content).unwrap();

        let result = run_rollout_image_cleanup_in_home(temp.path(), true).unwrap();

        assert_eq!(result.status, RolloutImageCleanupStatus::UpToDate);
        assert_eq!(result.rollback_protected_files, 1);
        assert_eq!(fs::read_to_string(rollout).unwrap(), content);
    }

    #[test]
    fn running_mode_only_checks_archived_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let active = temp.path().join("sessions/rollout-active.jsonl");
        let archived = temp.path().join("archived_sessions/rollout-archived.jsonl");
        fs::create_dir_all(active.parent().unwrap()).unwrap();
        fs::create_dir_all(archived.parent().unwrap()).unwrap();
        let old = image(b'D', 2048);
        let current = image(b'E', 2048);
        let content = format!("{}{}", compacted(&old), compacted(&current));
        fs::write(&active, &content).unwrap();
        fs::write(&archived, &content).unwrap();

        let result = run_rollout_image_cleanup_in_home(temp.path(), false).unwrap();

        assert!(result.skipped_active_sessions);
        assert_eq!(result.changed_files, 1);
        assert_eq!(fs::read_to_string(active).unwrap(), content);
        assert!(
            fs::read_to_string(archived)
                .unwrap()
                .contains("alunixa-x-image-ref:")
        );
    }

    #[test]
    fn duplicate_images_share_one_content_addressed_blob() {
        let temp = tempfile::tempdir().unwrap();
        let rollout = temp.path().join("sessions/rollout-shared.jsonl");
        fs::create_dir_all(rollout.parent().unwrap()).unwrap();
        let shared = image(b'F', 2048);
        fs::write(
            &rollout,
            format!(
                "{}{}{}",
                compacted(&shared),
                compacted(&shared),
                compacted(&shared)
            ),
        )
        .unwrap();

        let result = run_rollout_image_cleanup_in_home(temp.path(), true).unwrap();
        let blobs = fs::read_dir(backup_root(temp.path()).join("blobs"))
            .unwrap()
            .count();

        assert_eq!(result.image_copies, 2);
        assert_eq!(result.unique_images, 1);
        assert_eq!(blobs, 1);
    }

    #[test]
    fn restore_rejects_path_traversal_backup_ids() {
        let temp = tempfile::tempdir().unwrap();
        let error = restore_rollout_image_cleanup_in_home(temp.path(), "../outside").unwrap_err();
        assert!(
            error
                .to_string()
                .contains("invalid rollout image backup id")
        );
    }
}
