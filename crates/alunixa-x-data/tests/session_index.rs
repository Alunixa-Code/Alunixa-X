use alunixa_x_core::models::{DeleteStatus, SessionRef};
use alunixa_x_data::{
    BackupStore, SQLiteStorageAdapter, delete_local_from_paths, delete_local_from_paths_with_home,
};
use rusqlite::Connection;
use std::fs;
use std::path::Path;

fn create_db(path: &Path) {
    let db = Connection::open(path).unwrap();
    db.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
        INSERT INTO sessions VALUES ('s1', 'First');",
    )
    .unwrap();
}

fn count(path: &Path) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap()
}

fn session() -> SessionRef {
    SessionRef::new("s1", "First").unwrap()
}

#[test]
fn delete_and_undo_preserve_unrelated_and_malformed_index_records() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    let db = home.join("state.sqlite");
    create_db(&db);
    let index = home.join("session_index.jsonl");
    let entry = "{\"id\":\"s1\",\"thread_name\":\"First\"}\r\n";
    let untouched = "invalid\n{\"id\":\"other\",\"thread_name\":\"Other\"}\r\n";
    fs::write(&index, format!("{entry}{untouched}")).unwrap();
    let backups = BackupStore::new(home.join("backups"));
    let deleted =
        delete_local_from_paths_with_home([db.clone()], backups.clone(), &session(), home);
    assert_eq!(
        deleted.status,
        DeleteStatus::LocalDeleted,
        "{}",
        deleted.message
    );
    assert_eq!(count(&db), 0);
    assert_eq!(fs::read_to_string(&index).unwrap(), untouched);
    let restored = SQLiteStorageAdapter::new(&db, backups)
        .with_codex_home(home)
        .undo(deleted.undo_token.as_deref().unwrap());
    assert_eq!(
        restored.status,
        DeleteStatus::Undone,
        "{}",
        restored.message
    );
    assert_eq!(count(&db), 1);
    assert_eq!(
        fs::read_to_string(&index).unwrap(),
        format!("{untouched}{entry}")
    );
}

#[test]
fn index_only_session_has_a_working_undo_without_creating_a_database() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    let db = home.join("missing.sqlite");
    let index = home.join("session_index.jsonl");
    fs::write(&index, "{\"id\":\"s1\"}\n").unwrap();
    let backups = BackupStore::new(home.join("backups"));
    let deleted =
        delete_local_from_paths_with_home([db.clone()], backups.clone(), &session(), home);
    assert_eq!(deleted.status, DeleteStatus::LocalDeleted);
    assert_eq!(fs::read_to_string(&index).unwrap(), "");
    let restored = SQLiteStorageAdapter::new(&db, backups)
        .with_codex_home(home)
        .undo(deleted.undo_token.as_deref().unwrap());
    assert_eq!(
        restored.status,
        DeleteStatus::Undone,
        "{}",
        restored.message
    );
    assert!(!db.exists());
    assert_eq!(fs::read_to_string(&index).unwrap(), "{\"id\":\"s1\"}\n");
}

#[test]
fn index_conflict_prevents_database_undo_and_preserves_newer_entry() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    let db = home.join("state.sqlite");
    create_db(&db);
    let index = home.join("session_index.jsonl");
    fs::write(&index, "{\"id\":\"s1\"}\n").unwrap();
    let backups = BackupStore::new(home.join("backups"));
    let deleted =
        delete_local_from_paths_with_home([db.clone()], backups.clone(), &session(), home);
    let newer = "{\"id\":\"s1\",\"thread_name\":\"newer\"}\n";
    fs::write(&index, newer).unwrap();
    let restored = SQLiteStorageAdapter::new(&db, backups)
        .with_codex_home(home)
        .undo(deleted.undo_token.as_deref().unwrap());
    assert_eq!(restored.status, DeleteStatus::Failed);
    assert_eq!(count(&db), 0);
    assert_eq!(fs::read_to_string(&index).unwrap(), newer);
}

#[test]
fn locked_index_fails_before_any_database_mutation() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    let db = home.join("state.sqlite");
    create_db(&db);
    let index = home.join("session_index.jsonl");
    fs::write(&index, "{\"id\":\"s1\"}\n").unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&index)
        .unwrap();
    lock.try_lock().unwrap();
    let result = delete_local_from_paths_with_home(
        [db.clone()],
        BackupStore::new(home.join("backups")),
        &session(),
        home,
    );
    assert_eq!(result.status, DeleteStatus::Failed);
    assert_eq!(count(&db), 1);
}

#[test]
fn partial_database_failure_retains_successful_database_undo() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    let good = home.join("good.sqlite");
    let bad = home.join("bad.sqlite");
    create_db(&good);
    fs::write(&bad, "not a database").unwrap();
    let backups = BackupStore::new(home.join("backups"));
    let result = delete_local_from_paths([good.clone(), bad], backups.clone(), &session());
    assert_eq!(result.status, DeleteStatus::Failed);
    assert!(result.undo_token.is_some());
    let restored =
        SQLiteStorageAdapter::new(&good, backups).undo(result.undo_token.as_deref().unwrap());
    assert_eq!(restored.status, DeleteStatus::Undone);
    assert_eq!(count(&good), 1);
}

#[test]
fn catalog_only_deletion_and_undo_do_not_touch_remote_host_records() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("catalog.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE local_thread_catalog(host_id TEXT, thread_id TEXT, display_title TEXT, PRIMARY KEY(host_id,thread_id));
        INSERT INTO local_thread_catalog VALUES ('local','s1','Local'),('remote','s1','Remote');
        CREATE TABLE local_thread_catalog_metadata(catalog_revision INTEGER);
        INSERT INTO local_thread_catalog_metadata VALUES(0);").unwrap();
    let adapter = SQLiteStorageAdapter::new(&path, BackupStore::new(temp.path().join("backups")));
    let deleted = adapter.delete_local(&session());
    assert_eq!(
        deleted.status,
        DeleteStatus::LocalDeleted,
        "{}",
        deleted.message
    );
    assert_eq!(
        db.query_row("SELECT host_id FROM local_thread_catalog", [], |row| row
            .get::<_, String>(
            0
        ))
        .unwrap(),
        "remote"
    );
    let restored = adapter.undo(deleted.undo_token.as_deref().unwrap());
    assert_eq!(
        restored.status,
        DeleteStatus::Undone,
        "{}",
        restored.message
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM local_thread_catalog", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        2
    );
    assert_eq!(
        db.query_row(
            "SELECT catalog_revision FROM local_thread_catalog_metadata",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}

#[test]
fn index_backup_cannot_restore_into_a_different_codex_home() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path();
    fs::write(home.join("session_index.jsonl"), "{\"id\":\"s1\"}\n").unwrap();
    let backups = BackupStore::new(home.join("backups"));
    let deleted = delete_local_from_paths_with_home([], backups.clone(), &session(), home);
    let other = home.join("other");
    fs::create_dir(&other).unwrap();
    let result = SQLiteStorageAdapter::new(home.join("unused.sqlite"), backups)
        .with_codex_home(&other)
        .undo(deleted.undo_token.as_deref().unwrap());
    assert_eq!(result.status, DeleteStatus::Failed);
    assert!(!other.join("session_index.jsonl").exists());
}

#[test]
fn catalog_records_are_deleted_when_an_empty_automation_schema_also_exists() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("codex-dev.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE automation_runs(thread_id TEXT);
        CREATE TABLE local_thread_catalog(host_id TEXT, thread_id TEXT, PRIMARY KEY(host_id,thread_id));
        INSERT INTO local_thread_catalog VALUES ('local','s1');").unwrap();
    let adapter = SQLiteStorageAdapter::new(&path, BackupStore::new(temp.path().join("backups")));
    let deleted = adapter.delete_local(&session());
    assert_eq!(
        deleted.status,
        DeleteStatus::LocalDeleted,
        "{}",
        deleted.message
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM local_thread_catalog", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(
        adapter.undo(deleted.undo_token.as_deref().unwrap()).status,
        DeleteStatus::Undone
    );
}
