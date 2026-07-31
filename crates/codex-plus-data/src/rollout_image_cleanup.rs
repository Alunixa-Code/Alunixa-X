use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CLEANUP_VERSION: u32 = 1;
const IMAGE_PREFIX: &[u8] = b"data:image/";
const BASE64_MARKER: &[u8] = b";base64,";
const PLACEHOLDER: &[u8] = b"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const STATE_FILE: &str = "codex-plus-rollout-image-cleanup.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RolloutImageCleanupStatus {
    Cleaned,
    UpToDate,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutImageCleanupResult {
    pub status: RolloutImageCleanupStatus,
    pub message: String,
    pub scanned_files: usize,
    pub changed_files: usize,
    pub duplicate_images_replaced: u64,
    pub bytes_reclaimed: u64,
    pub backup_dir: Option<PathBuf>,
    pub skipped_active_sessions: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanupState {
    version: u32,
    files: HashMap<String, FileFingerprint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    len: u64,
    modified_ms: u64,
}

#[derive(Debug)]
struct FileCleanup {
    fingerprint: FileFingerprint,
    duplicate_images_replaced: u64,
    bytes_reclaimed: u64,
    temp_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedFileManifest {
    path: String,
    duplicate_images_replaced: u64,
    bytes_reclaimed: u64,
}

pub fn run_rollout_image_cleanup(
    codex_home: Option<&Path>,
) -> anyhow::Result<RolloutImageCleanupResult> {
    let home = codex_home
        .map(Path::to_path_buf)
        .unwrap_or_else(|| codex_plus_core::codex_sqlite::default_codex_home_dir());
    let active_processes =
        codex_plus_core::watcher::find_session_index_cleanup_blocking_processes();
    run_rollout_image_cleanup_guarded(&home, active_processes.is_empty(), true)
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
            RolloutImageCleanupStatus::Skipped,
            format!("Codex home not found: {}", home.display()),
            !include_active_sessions,
        ));
    }

    let lock_dir = home.join("tmp/rollout-image-cleanup.lock");
    if fs::create_dir_all(lock_dir.parent().unwrap_or(home)).is_err()
        || fs::create_dir(&lock_dir).is_err()
    {
        return Ok(empty_result(
            RolloutImageCleanupStatus::Skipped,
            "Rollout image cleanup is already running".to_string(),
            !include_active_sessions,
        ));
    }

    let result = cleanup_with_lock(home, include_active_sessions, guard_active_processes);
    let _ = fs::remove_dir_all(&lock_dir);
    result
}

fn cleanup_with_lock(
    home: &Path,
    include_active_sessions: bool,
    guard_active_processes: bool,
) -> anyhow::Result<RolloutImageCleanupResult> {
    let state_path = home.join(STATE_FILE);
    let mut state = load_state(&state_path);
    if state.version != CLEANUP_VERSION {
        state = CleanupState {
            version: CLEANUP_VERSION,
            files: HashMap::new(),
        };
    }

    let files = rollout_files(home, include_active_sessions)?;
    let live_keys = files
        .iter()
        .map(|path| state_key(home, path))
        .collect::<HashSet<_>>();
    state.files.retain(|path, _| live_keys.contains(path));

    let mut scanned_files = 0;
    let mut changed_files = Vec::new();
    let mut duplicate_images_replaced = 0_u64;
    let mut bytes_reclaimed = 0_u64;

    for path in files {
        let before = fingerprint(&path)?;
        let key = state_key(home, &path);
        if state.files.get(&key) == Some(&before) {
            continue;
        }
        scanned_files += 1;
        let cleanup = clean_file(&path, before)?;
        if cleanup.duplicate_images_replaced == 0 {
            state.files.insert(key, cleanup.fingerprint);
            continue;
        }

        if guard_active_processes
            && include_active_sessions
            && !codex_plus_core::watcher::find_session_index_cleanup_blocking_processes().is_empty()
        {
            remove_temp(cleanup.temp_path.as_deref());
            continue;
        }
        if fingerprint(&path)? != before {
            remove_temp(cleanup.temp_path.as_deref());
            continue;
        }

        let Some(temp_path) = cleanup.temp_path else {
            continue;
        };
        codex_plus_core::settings::atomic_replace_file(&temp_path, &path)?;
        let after = fingerprint(&path)?;
        state.files.insert(key, after);
        duplicate_images_replaced += cleanup.duplicate_images_replaced;
        bytes_reclaimed += cleanup.bytes_reclaimed;
        changed_files.push(ChangedFileManifest {
            path: path.to_string_lossy().to_string(),
            duplicate_images_replaced: cleanup.duplicate_images_replaced,
            bytes_reclaimed: cleanup.bytes_reclaimed,
        });
    }

    codex_plus_core::settings::atomic_write(
        &state_path,
        serde_json::to_vec_pretty(&state)?.as_slice(),
    )?;
    let backup_dir = if changed_files.is_empty() {
        None
    } else {
        Some(write_manifest(
            home,
            &changed_files,
            duplicate_images_replaced,
            bytes_reclaimed,
        )?)
    };
    let status = if changed_files.is_empty() {
        RolloutImageCleanupStatus::UpToDate
    } else {
        RolloutImageCleanupStatus::Cleaned
    };
    let message = if changed_files.is_empty() {
        if include_active_sessions {
            "Rollout images are already deduplicated".to_string()
        } else {
            "Codex is running; only archived rollout files were checked".to_string()
        }
    } else {
        format!(
            "Deduplicated {duplicate_images_replaced} rollout image copies in {} files and reclaimed {bytes_reclaimed} bytes",
            changed_files.len()
        )
    };
    Ok(RolloutImageCleanupResult {
        status,
        message,
        scanned_files,
        changed_files: changed_files.len(),
        duplicate_images_replaced,
        bytes_reclaimed,
        backup_dir,
        skipped_active_sessions: !include_active_sessions,
    })
}

fn clean_file(path: &Path, expected: FileFingerprint) -> anyhow::Result<FileCleanup> {
    let source = open_rollout_for_cleanup(path)?;
    let temp_path = temp_path(path);
    remove_temp(Some(&temp_path));
    let temp = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)?;
    let mut reader = BufReader::new(source);
    let mut writer = BufWriter::new(temp);
    let mut seen = HashSet::<[u8; 32]>::new();
    let mut duplicate_images_replaced = 0_u64;
    let mut bytes_reclaimed = 0_u64;
    let mut line = Vec::new();

    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        let (next, duplicates, reclaimed) = replace_duplicate_images(&line, &mut seen);
        duplicate_images_replaced += duplicates;
        bytes_reclaimed += reclaimed;
        writer.write_all(&next)?;
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;
    drop(writer);
    drop(reader);

    if duplicate_images_replaced == 0 {
        remove_temp(Some(&temp_path));
        return Ok(FileCleanup {
            fingerprint: expected,
            duplicate_images_replaced,
            bytes_reclaimed,
            temp_path: None,
        });
    }
    Ok(FileCleanup {
        fingerprint: expected,
        duplicate_images_replaced,
        bytes_reclaimed,
        temp_path: Some(temp_path),
    })
}

fn replace_duplicate_images(line: &[u8], seen: &mut HashSet<[u8; 32]>) -> (Vec<u8>, u64, u64) {
    let mut output = Vec::with_capacity(line.len());
    let mut cursor = 0;
    let mut duplicates = 0_u64;
    let mut reclaimed = 0_u64;
    while let Some(relative) = find_subslice(&line[cursor..], IMAGE_PREFIX) {
        let start = cursor + relative;
        output.extend_from_slice(&line[cursor..start]);
        let Some(relative_end) = line[start..].iter().position(|byte| *byte == b'"') else {
            output.extend_from_slice(&line[start..]);
            return (output, duplicates, reclaimed);
        };
        let end = start + relative_end;
        let candidate = &line[start..end];
        let is_base64_image = find_subslice(candidate, BASE64_MARKER).is_some();
        if !is_base64_image || candidate == PLACEHOLDER {
            output.extend_from_slice(candidate);
        } else {
            let hash: [u8; 32] = Sha256::digest(candidate).into();
            if seen.insert(hash) || candidate.len() <= PLACEHOLDER.len() {
                output.extend_from_slice(candidate);
            } else {
                output.extend_from_slice(PLACEHOLDER);
                duplicates += 1;
                reclaimed += (candidate.len() - PLACEHOLDER.len()) as u64;
            }
        }
        cursor = end;
    }
    output.extend_from_slice(&line[cursor..]);
    (output, duplicates, reclaimed)
}

fn rollout_files(home: &Path, include_active_sessions: bool) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let roots = if include_active_sessions {
        vec![home.join("sessions"), home.join("archived_sessions")]
    } else {
        vec![home.join("archived_sessions")]
    };
    for root in roots {
        collect_jsonl_files(&root, &mut files)?;
    }
    files.sort();
    Ok(files)
}

fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    Ok(())
}

fn load_state(path: &Path) -> CleanupState {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
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

fn state_key(home: &Path, path: &Path) -> String {
    path.strip_prefix(home)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn write_manifest(
    home: &Path,
    files: &[ChangedFileManifest],
    duplicate_images_replaced: u64,
    bytes_reclaimed: u64,
) -> anyhow::Result<PathBuf> {
    let root = home.join("backups_state/rollout-image-dedup");
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S%.3f");
    let mut directory = root.join(timestamp.to_string());
    let mut suffix = 0;
    while directory.exists() {
        suffix += 1;
        directory = root.join(format!("{timestamp}-{suffix}"));
    }
    fs::create_dir_all(&directory)?;
    fs::write(
        directory.join("metadata.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "version": CLEANUP_VERSION,
            "namespace": "rollout-image-dedup",
            "createdAt": chrono::Utc::now().to_rfc3339(),
            "duplicateImagesReplaced": duplicate_images_replaced,
            "bytesReclaimed": bytes_reclaimed,
            "files": files,
            "recovery": "Each file retains the first original data image for every hash; later identical copies use a valid one-pixel placeholder."
        }))?,
    )?;
    Ok(directory)
}

fn empty_result(
    status: RolloutImageCleanupStatus,
    message: String,
    skipped_active_sessions: bool,
) -> RolloutImageCleanupResult {
    RolloutImageCleanupResult {
        status,
        message,
        scanned_files: 0,
        changed_files: 0,
        duplicate_images_replaced: 0,
        bytes_reclaimed: 0,
        backup_dir: None,
        skipped_active_sessions,
    }
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("rollout.jsonl");
    path.with_file_name(format!(".{name}.codex-plus-{}.tmp", std::process::id()))
}

fn remove_temp(path: Option<&Path>) {
    if let Some(path) = path {
        let _ = fs::remove_file(path);
    }
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

#[allow(dead_code)]
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

    #[test]
    fn duplicate_images_keep_first_original_and_preserve_json_lines() {
        let original = image(b'A', 2048);
        let mut seen = HashSet::new();
        let line = format!(
            "{{\"content\":[{{\"type\":\"input_image\",\"image_url\":\"{original}\"}},{{\"type\":\"input_image\",\"image_url\":\"{original}\"}}]}}\n"
        );

        let (next, duplicates, reclaimed) = replace_duplicate_images(line.as_bytes(), &mut seen);
        let value: serde_json::Value = serde_json::from_slice(&next).unwrap();

        assert_eq!(duplicates, 1);
        assert!(reclaimed > 1900);
        assert_eq!(value["content"][0]["image_url"], original);
        assert_eq!(
            value["content"][1]["image_url"].as_str(),
            Some(String::from_utf8_lossy(PLACEHOLDER).as_ref())
        );
    }

    #[test]
    fn cleanup_uses_fingerprints_and_rescans_only_changed_rollouts() {
        let temp = tempfile::tempdir().unwrap();
        let sessions = temp.path().join("sessions/2026/07/31");
        fs::create_dir_all(&sessions).unwrap();
        let rollout = sessions.join("rollout-test.jsonl");
        let original = image(b'B', 4096);
        fs::write(
            &rollout,
            format!("{{\"image_url\":\"{original}\"}}\n{{\"image_url\":\"{original}\"}}\n"),
        )
        .unwrap();

        let first = run_rollout_image_cleanup_in_home(temp.path(), true).unwrap();
        let second = run_rollout_image_cleanup_in_home(temp.path(), true).unwrap();

        assert_eq!(first.status, RolloutImageCleanupStatus::Cleaned);
        assert_eq!(first.changed_files, 1);
        assert_eq!(first.duplicate_images_replaced, 1);
        assert!(first.backup_dir.unwrap().join("metadata.json").is_file());
        assert_eq!(second.status, RolloutImageCleanupStatus::UpToDate);
        assert_eq!(second.scanned_files, 0);

        fs::OpenOptions::new()
            .append(true)
            .open(&rollout)
            .unwrap()
            .write_all(format!("{{\"image_url\":\"{original}\"}}\n").as_bytes())
            .unwrap();
        let third = run_rollout_image_cleanup_in_home(temp.path(), true).unwrap();
        assert_eq!(third.status, RolloutImageCleanupStatus::Cleaned);
        assert_eq!(third.scanned_files, 1);
        assert_eq!(third.duplicate_images_replaced, 1);
    }

    #[test]
    fn running_mode_only_checks_archived_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let active = temp.path().join("sessions/rollout-active.jsonl");
        let archived = temp.path().join("archived_sessions/rollout-archived.jsonl");
        fs::create_dir_all(active.parent().unwrap()).unwrap();
        fs::create_dir_all(archived.parent().unwrap()).unwrap();
        let original = image(b'C', 2048);
        let content =
            format!("{{\"image_url\":\"{original}\"}}\n{{\"image_url\":\"{original}\"}}\n");
        fs::write(&active, &content).unwrap();
        fs::write(&archived, &content).unwrap();

        let result = run_rollout_image_cleanup_in_home(temp.path(), false).unwrap();

        assert!(result.skipped_active_sessions);
        assert_eq!(result.changed_files, 1);
        assert_eq!(fs::read_to_string(active).unwrap(), content);
        assert!(
            fs::read_to_string(archived)
                .unwrap()
                .contains(&String::from_utf8_lossy(PLACEHOLDER).to_string())
        );
    }
}
