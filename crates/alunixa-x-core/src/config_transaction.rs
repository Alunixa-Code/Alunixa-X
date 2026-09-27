use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use fs2::FileExt;
use sha2::{Digest, Sha256};

thread_local! {
    static LOCKS: RefCell<HashMap<PathBuf, (File, usize)>> = RefCell::new(HashMap::new());
    static WRITES: RefCell<Vec<JournalState>> = RefCell::new(Vec::new());
}

struct JournalState {
    directory: PathBuf,
    original: Vec<(PathBuf, Option<Vec<u8>>)>,
    writes: HashMap<PathBuf, Option<Vec<u8>>>,
}

struct WriteJournal(bool);
impl WriteJournal {
    fn begin(state: JournalState) -> Self {
        WRITES.with(|writes| writes.borrow_mut().push(state));
        Self(true)
    }
    fn finish(mut self) -> JournalState {
        self.0 = false;
        WRITES.with(|writes| writes.borrow_mut().pop().expect("active write journal"))
    }
}
impl Drop for WriteJournal {
    fn drop(&mut self) {
        if self.0 {
            WRITES.with(|writes| {
                writes.borrow_mut().pop();
            });
        }
    }
}
fn journal_key(path: &Path) -> PathBuf {
    // Keep the identity stable when a previously absent parent directory is created.
    let path = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    #[cfg(windows)]
    let path = PathBuf::from(
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_lowercase(),
    );
    path
}
fn digest(bytes: Option<&[u8]>) -> Option<Vec<u8>> {
    bytes.map(|bytes| Sha256::digest(bytes).to_vec())
}

/// Called immediately before replacement by every atomic configuration writer.
/// This also captures model catalogs and auxiliary files created inside an operation.
pub(crate) fn prepare_write(path: &Path) -> anyhow::Result<()> {
    WRITES.with(|journals| {
        let mut journals = journals.borrow_mut();
        if journals.is_empty() {
            return Ok(());
        }
        let key = journal_key(path);
        let current = read_optional(path)?;
        for journal in journals.iter_mut() {
            if let Some((_, original)) =
                journal.original.iter().find(|(p, _)| journal_key(p) == key)
            {
                let expected = journal
                    .writes
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| digest(original.as_deref()));
                if digest(current.as_deref()) != expected {
                    bail!("配置在保存期间被外部更新，未覆盖新配置");
                }
            } else {
                let index = journal.original.len();
                if let Some(bytes) = &current {
                    crate::settings::atomic_write_untracked(
                        &journal.directory.join(format!("{index}.bak")),
                        bytes,
                    )?;
                }
                journal.original.push((path.to_path_buf(), current.clone()));
                write_manifest(&journal.directory, &journal.original)?;
            }
        }
        Ok(())
    })
}

pub(crate) fn record_write(path: &Path, bytes: &[u8]) {
    record_state(path, Some(bytes));
}

fn record_state(path: &Path, bytes: Option<&[u8]>) {
    WRITES.with(|writes| {
        let mut writes = writes.borrow_mut();
        if writes.is_empty() {
            return;
        }
        let digest = digest(bytes);
        let key = journal_key(path);
        for journal in writes.iter_mut() {
            journal.writes.insert(key.clone(), digest.clone());
        }
    });
}

pub(crate) fn remove_file(path: &Path) -> anyhow::Result<()> {
    prepare_write(path)?;
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    record_state(path, None);
    Ok(())
}

/// Acquire before settings-store locks, never across an await. Nested config writers reuse it.
pub struct ConfigLock {
    path: PathBuf,
    _thread: PhantomData<Rc<()>>,
}
impl ConfigLock {
    pub fn acquire(home: &Path) -> anyhow::Result<Self> {
        fs::create_dir_all(home)?;
        let path = fs::canonicalize(home)?.join("alunixa-x-config.lock");
        LOCKS.with(|locks| -> anyhow::Result<()> {
            let mut locks = locks.borrow_mut();
            if let Some((_, count)) = locks.get_mut(&path) {
                *count += 1;
                return Ok(());
            }
            let file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(&path)?;
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                match file.try_lock_exclusive() {
                    Ok(()) => break,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(15))
                    }
                    Err(_) => bail!("配置正被其他进程修改，未写入，请稍后刷新重试"),
                }
            }
            locks.insert(path.clone(), (file, 1));
            Ok(())
        })?;
        Ok(Self {
            path,
            _thread: PhantomData,
        })
    }
}
impl Drop for ConfigLock {
    fn drop(&mut self) {
        LOCKS.with(|locks| {
            let mut locks = locks.borrow_mut();
            if let Some((_, count)) = locks.get_mut(&self.path) {
                *count -= 1;
                if *count == 0 {
                    if let Some((file, _)) = locks.remove(&self.path) {
                        let _ = FileExt::unlock(&file);
                    }
                }
            }
        });
    }
}

fn read_optional(path: &Path) -> anyhow::Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(meta)
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() > 32 * 1024 * 1024 =>
        {
            bail!("配置文件不是可安全更新的普通文件")
        }
        Ok(_) => Ok(Some(
            fs::read(path).context("读取配置文件失败，未替换为默认值")?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => bail!("读取配置文件失败，未替换为默认值"),
    }
}

pub fn protected_paths(settings: &Path, home: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = vec![settings.to_path_buf()];
    files.extend(
        [
            "config.toml",
            "auth.json",
            "hooks.json",
            "alunixa-x-wss-policy.json",
            "TSC_ZYL_PJ/do_special.md",
            "TSC_ZYL_PJ/do_special.md.last-good",
        ]
        .into_iter()
        .map(|p| home.join(p)),
    );
    // Directory membership and file names are part of the revision, not only file bytes.
    match fs::read_dir(home.join("model-catalogs")) {
        Ok(entries) => {
            let mut catalogs = Vec::new();
            for entry in entries {
                let path = entry?.path();
                if path.extension().is_some_and(|e| e == "json") {
                    catalogs.push(path);
                }
            }
            catalogs.sort();
            files.extend(catalogs);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => bail!("模型目录无法读取，配置状态未知"),
    }
    let mut seen = std::collections::HashSet::new();
    files.retain(|path| seen.insert(journal_key(path)));
    Ok(files)
}

pub fn revision(settings: &Path, home: &Path) -> anyhow::Result<String> {
    let mut hash = Sha256::new();
    for path in protected_paths(settings, home)? {
        hash.update(journal_key(&path).as_os_str().as_encoded_bytes());
        hash.update([0]);
        let bytes = read_optional(&path)?;
        hash.update([u8::from(bytes.is_some())]);
        if let Some(bytes) = bytes {
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn run<T>(
    settings: &Path,
    home: &Path,
    expected: Option<&str>,
    operation: impl FnOnce() -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let _lock = ConfigLock::acquire(home)?;
    if let Some(expected) = expected {
        if expected.is_empty() || revision(settings, home)? != expected {
            bail!("配置已被其他页面或程序修改，请刷新后重试；未覆盖新配置");
        }
    }
    let original = protected_paths(settings, home)?
        .into_iter()
        .map(|p| read_optional(&p).map(|bytes| (p, bytes)))
        .collect::<anyhow::Result<Vec<_>>>()?;
    if let Some((_, Some(bytes))) = original
        .iter()
        .find(|(p, _)| p == &home.join("config.toml"))
    {
        let text = std::str::from_utf8(bytes).context("config.toml 不是 UTF-8，未修改")?;
        text.parse::<toml_edit::DocumentMut>()
            .map_err(|_| anyhow::anyhow!("config.toml 无法解析，未修改"))?;
    }
    let directory = home
        .join("alunixa-x-config-transactions")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    }
    for (index, (_, bytes)) in original.iter().enumerate() {
        if let Some(bytes) = bytes {
            crate::settings::atomic_write_untracked(
                &directory.join(format!("{index}.bak")),
                bytes,
            )?;
        }
    }
    write_manifest(&directory, &original)?;
    let journal = WriteJournal::begin(JournalState {
        directory,
        original,
        writes: HashMap::new(),
    });
    let mut result = operation();
    let JournalState {
        original, writes, ..
    } = journal.finish();
    // A successful call is still not a successful save if an external writer replaced it.
    if result.is_ok() {
        for (path, _) in &original {
            if let Some(written) = writes.get(&journal_key(path)) {
                if !read_optional(path).is_ok_and(|current| digest(current.as_deref()) == *written)
                {
                    result = Err(anyhow::anyhow!("配置回读不一致，检测到外部更新"));
                    break;
                }
            }
        }
    }
    match result {
        Ok(value) => Ok(value),
        Err(_) => {
            let mut conflict = false;
            for (path, bytes) in original.iter().rev() {
                // An auth refresh or external edit that this operation never wrote belongs to
                // its original writer. Never restore the snapshot over it.
                let Some(written) = writes.get(&journal_key(path)) else {
                    continue;
                };
                if read_optional(path).is_ok_and(|current| &current == bytes) {
                    continue;
                }
                if !read_optional(path).is_ok_and(|current| digest(current.as_deref()) == *written)
                {
                    conflict = true;
                    continue;
                }
                match bytes {
                    Some(bytes) => crate::settings::atomic_write(path, bytes)
                        .context("配置回滚失败；请从 alunixa-x-config-transactions 恢复")?,
                    None => remove_file(path)
                        .context("配置回滚失败；请从 alunixa-x-config-transactions 恢复")?,
                }
            }
            if conflict {
                bail!(
                    "保存失败；已回滚本次修改并保留外部新配置，备份位于 alunixa-x-config-transactions"
                );
            }
            bail!("配置保存失败，已恢复原设置及关联文件；未更换密钥、模型或接口")
        }
    }
}

/// Home-only writers must not capture the caller's unrelated global AX settings.
pub fn run_in_home<T>(
    home: &Path,
    operation: impl FnOnce() -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    run(&home.join("config.toml"), home, None, operation)
}

fn write_manifest(directory: &Path, original: &[(PathBuf, Option<Vec<u8>>)]) -> anyhow::Result<()> {
    let manifest = original.iter().enumerate().map(|(index, (path, bytes))| {
        serde_json::json!({"path": path, "existed": bytes.is_some(), "backup": format!("{index}.bak")})
    }).collect::<Vec<_>>();
    crate::settings::atomic_write_untracked(
        &directory.join("manifest.json"),
        &serde_json::to_vec(&manifest)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failure_restores_all_files_and_keeps_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        fs::create_dir(&home).unwrap();
        let settings = dir.path().join("settings.json");
        fs::write(&settings, b"{}").unwrap();
        fs::write(home.join("config.toml"), "[features]\nfast_mode=true\n").unwrap();
        fs::write(
            home.join("auth.json"),
            b"{\"tokens\":{\"refresh_token\":\"fixture-only\"}}",
        )
        .unwrap();
        let before = revision(&settings, &home).unwrap();
        let result: anyhow::Result<()> = run(&settings, &home, Some(&before), || {
            crate::settings::atomic_write(&settings, b"{\"changed\":true}")?;
            crate::settings::atomic_write(&home.join("config.toml"), b"model='other'\n")?;
            crate::settings::atomic_write(&home.join("hooks.json"), b"{}")?;
            bail!("fixture failure")
        });
        assert!(result.is_err());
        assert_eq!(revision(&settings, &home).unwrap(), before);
        assert!(!home.join("hooks.json").exists());
        assert_eq!(
            fs::read_dir(home.join("alunixa-x-config-transactions"))
                .unwrap()
                .count(),
            1
        );
    }
    #[test]
    fn stale_or_unparseable_config_never_runs_the_write() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let settings = home.join("settings.json");
        fs::write(home.join("config.toml"), "x=1\n").unwrap();
        assert!(
            run(&settings, home, Some("stale"), || -> anyhow::Result<()> {
                panic!("stale");
            })
            .is_err()
        );
        fs::write(home.join("config.toml"), "[broken").unwrap();
        assert!(
            run(&settings, home, None, || -> anyhow::Result<()> {
                panic!("broken");
            })
            .is_err()
        );
    }
    #[test]
    fn lock_is_reentrant_and_released() {
        let dir = tempfile::tempdir().unwrap();
        {
            let _one = ConfigLock::acquire(dir.path()).unwrap();
            let _two = ConfigLock::acquire(dir.path()).unwrap();
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(dir.path().join("alunixa-x-config.lock"))
            .unwrap();
        file.try_lock_exclusive().unwrap();
    }

    #[test]
    fn rollback_does_not_overwrite_external_auth_refresh_or_newer_config() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let config = dir.path().join("config.toml");
        let auth = dir.path().join("auth.json");
        fs::write(&settings, "{}").unwrap();
        fs::write(&config, "x=1\n").unwrap();
        fs::write(&auth, "{\"token\":\"old-fixture\"}").unwrap();
        let result: anyhow::Result<()> = run(&settings, dir.path(), None, || {
            crate::settings::atomic_write(&settings, b"{\"changed\":true}")?;
            crate::settings::atomic_write(&config, b"x=2\n")?;
            // Simulate a non-AX writer after our last write and before failure.
            fs::write(&auth, "{\"token\":\"refreshed-fixture\"}")?;
            fs::write(&config, "x=3\n")?;
            bail!("fixture failure")
        });
        assert!(result.unwrap_err().to_string().contains("外部"));
        assert_eq!(fs::read_to_string(settings).unwrap(), "{}");
        assert_eq!(fs::read_to_string(config).unwrap(), "x=3\n");
        assert_eq!(
            fs::read_to_string(auth).unwrap(),
            "{\"token\":\"refreshed-fixture\"}"
        );
    }

    #[test]
    fn external_change_before_write_is_not_overwritten_and_success_requires_readback() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::write(&path, "x=1\n").unwrap();
        let result = run_in_home(dir.path(), || {
            fs::write(&path, "x=2\n")?;
            crate::settings::atomic_write(&path, b"x=3\n")
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "x=2\n");
        let result = run_in_home(dir.path(), || {
            crate::settings::atomic_write(&path, b"x=3\n")?;
            fs::write(&path, "x=4\n")?;
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "x=4\n");
    }

    #[test]
    fn catalog_membership_changes_revision_and_new_auxiliary_files_are_rolled_back() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let before = revision(&settings, dir.path()).unwrap();
        fs::create_dir(dir.path().join("model-catalogs")).unwrap();
        let catalog = dir.path().join("model-catalogs/new.json");
        fs::write(&catalog, "{}").unwrap();
        assert_ne!(revision(&settings, dir.path()).unwrap(), before);
        fs::remove_file(&catalog).unwrap();
        let new_file = dir.path().join("new-parent/state.json");
        let result: anyhow::Result<()> = run(&settings, dir.path(), None, || {
            crate::settings::atomic_write(&catalog, b"{}")?;
            crate::settings::atomic_write(&new_file, b"{}")?;
            bail!("fixture failure")
        });
        assert!(result.is_err());
        assert!(!catalog.exists());
        assert!(!new_file.exists());
        assert_eq!(revision(&settings, dir.path()).unwrap(), before);
    }

    #[test]
    fn nested_rollback_retains_parent_ownership_and_deleted_state_is_recoverable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let auxiliary = dir.path().join("owned-state.json");
        fs::write(&path, "x=1\n").unwrap();
        fs::write(&auxiliary, "{}").unwrap();
        let result: anyhow::Result<()> = run_in_home(dir.path(), || {
            crate::settings::atomic_write(&path, b"x=2\n")?;
            let nested: anyhow::Result<()> = run_in_home(dir.path(), || {
                crate::settings::atomic_write(&path, b"x=3\n")?;
                bail!("nested fixture failure")
            });
            assert!(nested.is_err());
            assert_eq!(fs::read_to_string(&path)?, "x=2\n");
            remove_file(&auxiliary)?;
            bail!("outer fixture failure")
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "x=1\n");
        assert_eq!(fs::read_to_string(&auxiliary).unwrap(), "{}");
    }
}
