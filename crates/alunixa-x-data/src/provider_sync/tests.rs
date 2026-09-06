use super::*;
use tempfile::tempdir;

#[test]
fn remote_control_finalization_defers_when_rollout_changes_after_collection() {
    let tmp = tempdir().unwrap();
    let home = tmp.path().join(".codex");
    fs::create_dir_all(home.join("sessions")).unwrap();
    fs::create_dir_all(home.join("sqlite")).unwrap();
    fs::write(home.join("config.toml"), "model_provider = \"custom\"\n").unwrap();
    let rollout = home.join("sessions/rollout-mobile.jsonl");
    let meta = json!({"type": "session_meta", "payload": {
        "id": "mobile", "model_provider": "openai", "cwd": "C:/workspace"
    }});
    fs::write(&rollout, format!("{meta}\n")).unwrap();

    let state_db = home.join("state_5.sqlite");
    let db = Connection::open(&state_db).unwrap();
    db.execute_batch(
        "CREATE TABLE threads (
            id TEXT PRIMARY KEY, model_provider TEXT, archived INTEGER, has_user_event INTEGER,
            cwd TEXT, title TEXT, rollout_path TEXT, source TEXT, created_at_ms INTEGER,
            updated_at_ms INTEGER, thread_source TEXT, git_branch TEXT
        );",
    )
    .unwrap();
    db.execute(
        "INSERT INTO threads VALUES ('mobile', 'openai', 0, 1, 'C:/workspace', 'mobile',
            ?1, 'vscode', 100000, 200000, NULL, NULL)",
        [rollout.to_string_lossy().as_ref()],
    )
    .unwrap();
    drop(db);
    let catalog_db = home.join("sqlite/codex-dev.db");
    let db = Connection::open(&catalog_db).unwrap();
    db.execute_batch(
        "CREATE TABLE local_thread_catalog (
            host_id TEXT NOT NULL, thread_id TEXT NOT NULL, display_title TEXT NOT NULL,
            source_created_at REAL NOT NULL, source_updated_at REAL NOT NULL,
            cwd TEXT NOT NULL, source_kind TEXT NOT NULL, source_detail TEXT,
            model_provider TEXT NOT NULL, git_branch TEXT, observation_sequence INTEGER NOT NULL,
            missing_candidate INTEGER NOT NULL DEFAULT 0, thread_source TEXT,
            PRIMARY KEY (host_id, thread_id)
        );
        CREATE TABLE local_thread_catalog_hosts (host_id TEXT PRIMARY KEY, host_kind TEXT NOT NULL);
        INSERT INTO local_thread_catalog_hosts VALUES ('local', 'local');
        CREATE TABLE local_thread_catalog_metadata (
            id INTEGER PRIMARY KEY, catalog_revision INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO local_thread_catalog_metadata VALUES (1, 0);",
    )
    .unwrap();
    drop(db);

    // Inject exactly after snapshot/backup, independent of filesystem copy speed or scheduling.
    let result = finalize_remote_control_session(Some(&home), "mobile", "custom", || {
        let mut file = OpenOptions::new().append(true).open(&rollout).unwrap();
        writeln!(
            file,
            "{}",
            json!({"type": "event_msg", "payload": {"type": "task_started"}})
        )
        .unwrap();
    });

    assert_eq!(result.status, ProviderSyncStatus::Skipped);
    assert_eq!(result.changed_session_files, 0);
    assert_eq!(result.sqlite_rows_updated, 0);
    assert_eq!(result.skipped_locked_rollout_files.len(), 1);
    assert_eq!(
        fs::canonicalize(&result.skipped_locked_rollout_files[0]).unwrap(),
        fs::canonicalize(&rollout).unwrap()
    );
    let text = fs::read_to_string(&rollout).unwrap();
    assert!(text.contains("task_started"));
    let first: Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(first["payload"]["model_provider"], "openai");
    let state = Connection::open(&state_db).unwrap();
    let provider: String = state
        .query_row(
            "SELECT model_provider FROM threads WHERE id = 'mobile'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(provider, "openai");
    let catalog = Connection::open(&catalog_db).unwrap();
    let rows: i64 = catalog
        .query_row("SELECT COUNT(*) FROM local_thread_catalog", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(rows, 0);
    let revision: i64 = catalog
        .query_row(
            "SELECT catalog_revision FROM local_thread_catalog_metadata WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(revision, 0);
}
