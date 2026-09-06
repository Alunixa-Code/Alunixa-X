use anyhow::Context;
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

pub(crate) struct SessionIndex {
    file: File,
    text: String,
}

fn entry_id(line: &str) -> Option<String> {
    serde_json::from_str::<Value>(line.trim())
        .ok()?
        .get("id")?
        .as_str()
        .map(ToString::to_string)
}

impl SessionIndex {
    pub(crate) fn open(home: &Path, create: bool) -> anyhow::Result<Option<Self>> {
        let path = home.join("session_index.jsonl");
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(create)
            .truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let mut file = match options.open(&path) {
            Ok(file) => file,
            Err(error) if !create && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(None);
            }
            Err(error) => return Err(error).context("cannot open session_index.jsonl for update"),
        };
        file.try_lock().context("session_index.jsonl is busy")?;
        let mut text = String::new();
        file.read_to_string(&mut text)?;
        Ok(Some(Self { file, text }))
    }

    pub(crate) fn lines(&self, id: &str) -> Vec<String> {
        self.text
            .split_inclusive('\n')
            .filter(|line| entry_id(line).as_deref() == Some(id))
            .map(ToString::to_string)
            .collect()
    }

    pub(crate) fn remove(&mut self, id: &str) -> anyhow::Result<()> {
        let next = self
            .text
            .split_inclusive('\n')
            .filter(|line| entry_id(line).as_deref() != Some(id))
            .collect::<String>();
        self.write(&next)
    }

    pub(crate) fn plan_restore(&self, lines: &[String]) -> anyhow::Result<String> {
        let mut next = self.text.clone();
        for line in lines {
            let id = entry_id(line).context("invalid session index backup entry")?;
            let existing = self.lines(&id);
            if existing
                .iter()
                .any(|item| item.trim_end() == line.trim_end())
            {
                continue;
            }
            anyhow::ensure!(existing.is_empty(), "session index restore conflict: {id}");
            if !next.is_empty() && !next.ends_with('\n') {
                next.push('\n');
            }
            next.push_str(line);
            if !next.ends_with('\n') {
                next.push('\n');
            }
        }
        Ok(next)
    }

    pub(crate) fn write(&mut self, next: &str) -> anyhow::Result<()> {
        if next == self.text {
            return Ok(());
        }
        // Keep the exclusive handle through database work and verify before truncating.
        self.file.rewind()?;
        let mut current = String::new();
        self.file.read_to_string(&mut current)?;
        anyhow::ensure!(current == self.text, "session index changed during update");
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(next.as_bytes())?;
        self.file.set_len(next.len() as u64)?;
        self.file.sync_all()?;
        self.text = next.to_string();
        Ok(())
    }
}

pub(crate) fn restore_lines(backups: &[Value], home: Option<&Path>) -> anyhow::Result<Vec<String>> {
    let mut lines = Vec::new();
    for backup in backups {
        let Some(entries) = backup["tables"].get("__session_index") else {
            continue;
        };
        let home = home.context("Codex home is required to restore the session index")?;
        anyhow::ensure!(
            backup["source_db"].as_str().map(Path::new)
                == Some(home.join("session_index.jsonl").as_path()),
            "session index backup is outside the configured Codex home"
        );
        anyhow::ensure!(
            backup["tables"]
                .as_object()
                .is_some_and(|tables| tables.len() == 1),
            "session index backup contains unexpected tables"
        );
        let id = backup["session_id"]
            .as_str()
            .context("missing session index backup id")?;
        for line in entries.as_array().context("invalid session index backup")? {
            let line = line.as_str().context("invalid session index backup line")?;
            anyhow::ensure!(
                entry_id(line).as_deref() == Some(id),
                "session index backup id mismatch"
            );
            lines.push(line.to_string());
        }
    }
    Ok(lines)
}
