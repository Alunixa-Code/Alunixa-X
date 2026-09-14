use alunixa_x_core::image_models::{
    ImageModel, ImageModelEdit, apply_edits, normalize_base_url, select_model, snapshot,
};
use alunixa_x_core::settings::{BackendSettings, SettingsStore};
use serde_json::json;

fn model(id: &str) -> ImageModel {
    ImageModel {
        id: id.into(),
        name: format!("Images {id}"),
        base_url: format!("https://{id}.example.invalid/v1"),
        api_key: format!("fixture-key-{id}"),
        model: format!("image-{id}"),
    }
}

fn edits(models: &[ImageModel]) -> Vec<ImageModelEdit> {
    models
        .iter()
        .map(|model| ImageModelEdit {
            id: model.id.clone(),
            name: model.name.clone(),
            base_url: model.base_url.clone(),
            api_key: None,
            model: model.model.clone(),
        })
        .collect()
}

#[test]
fn legacy_settings_have_no_image_override() {
    let settings: BackendSettings = serde_json::from_value(json!({})).unwrap();
    assert!(settings.image_models.is_empty());
    assert!(
        select_model(&settings.image_models, None, None)
            .unwrap()
            .is_none()
    );
}

#[test]
fn independent_images_enable_mcp_without_changing_conversation_provider_switches() {
    use alunixa_x_core::image_models::mcp_enabled;
    let mut settings = BackendSettings {
        relay_profiles_enabled: false,
        ..Default::default()
    };
    assert!(!mcp_enabled(&settings));
    settings.image_models = vec![model("a")];
    assert!(mcp_enabled(&settings));
    assert!(!settings.relay_profiles_enabled);
    settings.enhancements_enabled = false;
    assert!(!mcp_enabled(&settings));
}

#[test]
fn ordering_is_default_and_explicit_selection_is_unambiguous() {
    let mut models = vec![model("a"), model("b")];
    assert_eq!(select_model(&models, None, None).unwrap().unwrap().id, "a");
    models.reverse();
    assert_eq!(select_model(&models, None, None).unwrap().unwrap().id, "b");
    assert_eq!(
        select_model(&models, None, Some("image-a"))
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
    models[0].model = "image-a".into();
    assert_eq!(
        select_model(&models, Some("a"), Some("image-a"))
            .unwrap()
            .unwrap()
            .id,
        "a"
    );
    assert!(select_model(&models, Some("a"), Some("different")).is_err());
    assert!(select_model(&models, None, Some("unconfigured")).is_err());
    assert!(select_model(&[], Some("missing"), None).is_err());
}

#[test]
fn endpoints_preserve_custom_roots_and_normalize_image_routes() {
    for (input, expected) in [
        (
            "https://images.example.invalid",
            "https://images.example.invalid/v1",
        ),
        (
            "https://images.example.invalid/v1/",
            "https://images.example.invalid/v1",
        ),
        (
            "https://images.example.invalid/proxy/openai/v1/images/generations",
            "https://images.example.invalid/proxy/openai/v1",
        ),
        (
            "http://127.0.0.1:8000/custom/images/edits/",
            "http://127.0.0.1:8000/custom",
        ),
    ] {
        assert_eq!(normalize_base_url(input).unwrap(), expected);
    }
}

#[test]
fn endpoint_errors_do_not_disclose_credentials() {
    for url in [
        "file:///secret",
        "https://user:fixture-secret@example.invalid/v1",
        "https://example.invalid/v1?key=fixture-secret",
        "https://example.invalid/#fixture-secret",
    ] {
        let error = normalize_base_url(url).unwrap_err().to_string();
        assert!(!error.contains("fixture-secret"));
    }
}

#[test]
fn summary_and_debug_do_not_contain_keys_and_revisions_change_with_order() {
    let models = vec![model("a"), model("b")];
    let current = snapshot(&models);
    let serialized = serde_json::to_string(&current).unwrap();
    assert!(!serialized.contains("fixture-key"));
    assert!(!format!("{models:?}").contains("fixture-key"));
    assert!(current.models.iter().all(|entry| entry.has_api_key));
    assert_ne!(
        current.revision,
        snapshot(&[model("b"), model("a")]).revision
    );
}

#[test]
fn edits_preserve_keys_by_id_not_position_and_reject_duplicates() {
    let models = vec![model("a"), model("b")];
    let reversed = vec![model("b"), model("a")];
    let result = apply_edits(&models, &snapshot(&models).revision, edits(&reversed)).unwrap();
    assert_eq!(result, reversed);
    let duplicates = vec![model("a"), model("a")];
    assert!(apply_edits(&models, &snapshot(&models).revision, edits(&duplicates)).is_err());
}

#[test]
fn new_items_require_a_key_and_invalid_edits_leave_file_unchanged() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let store = SettingsStore::new(path.clone());
    store
        .save(&BackendSettings {
            image_models: vec![model("a")],
            ..Default::default()
        })
        .unwrap();
    let before = std::fs::read(&path).unwrap();
    let revision = snapshot(&store.load().unwrap().image_models).revision;
    assert!(
        store
            .save_image_models(&revision, edits(&[model("new")]))
            .is_err()
    );
    let mut invalid = edits(&[model("a")]);
    invalid[0].api_key = Some("fixture-key\r\nInjected: header".into());
    assert!(store.save_image_models(&revision, invalid).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn store_persists_add_edit_reorder_delete_and_retains_unrelated_settings() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("settings.json");
    let store = SettingsStore::new(path.clone());
    store
        .save(&BackendSettings {
            codex_app_path: "keep-app".into(),
            ..Default::default()
        })
        .unwrap();
    let mut create = edits(&[model("a"), model("b")]);
    create[0].api_key = Some("fixture-key-a".into());
    create[1].api_key = Some("fixture-key-b".into());
    let state = store
        .save_image_models(&snapshot(&[]).revision, create)
        .unwrap();
    let state = store
        .save_image_models(&state.revision, edits(&[model("b"), model("a")]))
        .unwrap();
    assert_eq!(state.models[0].id, "b");
    let reloaded = SettingsStore::new(path).load().unwrap();
    assert_eq!(reloaded.image_models[0], model("b"));
    assert_eq!(reloaded.codex_app_path, "keep-app");
    let state = store
        .save_image_models(&state.revision, edits(&[model("a")]))
        .unwrap();
    assert_eq!(state.models[0].id, "a");
    let state = store.save_image_models(&state.revision, vec![]).unwrap();
    assert!(state.models.is_empty());
    assert!(store.load().unwrap().image_models.is_empty());
}

#[test]
fn stale_general_settings_and_concurrent_image_saves_cannot_overwrite_new_order() {
    let temp = tempfile::tempdir().unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    store
        .save(&BackendSettings {
            image_models: vec![model("a"), model("b")],
            ..Default::default()
        })
        .unwrap();
    let stale = store.load().unwrap();
    let old_revision = snapshot(&stale.image_models).revision;
    store
        .save_image_models(&old_revision, edits(&[model("b"), model("a")]))
        .unwrap();
    assert!(store.save_image_models(&old_revision, vec![]).is_err());
    store.save(&stale).unwrap();
    store
        .save_preserving_runtime_model_selection(&stale)
        .unwrap();
    store.update(json!({"codexAppPath": "new-app"})).unwrap();
    assert_eq!(store.load().unwrap().image_models[0].id, "b");
}

#[test]
fn simultaneous_image_edits_have_exactly_one_winner() {
    let temp = tempfile::tempdir().unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    store
        .save(&BackendSettings {
            image_models: vec![model("a"), model("b")],
            ..Default::default()
        })
        .unwrap();
    let revision = snapshot(&store.load().unwrap().image_models).revision;
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|index| {
            let (store, revision, barrier) = (store.clone(), revision.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .save_image_models(
                        &revision,
                        edits(&[model(if index == 0 { "a" } else { "b" })]),
                    )
                    .is_ok()
            })
        })
        .collect();
    assert_eq!(
        workers
            .into_iter()
            .filter_map(|worker| worker.join().ok())
            .filter(|ok| *ok)
            .count(),
        1
    );
}

#[test]
fn full_config_backup_round_trips_order_and_keys() {
    use alunixa_x_core::config_backup::{
        ConfigBackupPaths, export_full_config, import_full_config,
    };
    let temp = tempfile::tempdir().unwrap();
    let paths = ConfigBackupPaths {
        settings_path: temp.path().join("settings.json"),
        codex_home: temp.path().join("codex"),
        user_scripts_dir: temp.path().join("scripts"),
        user_scripts_config_path: temp.path().join("scripts.json"),
        automatic_backup_dir: temp.path().join("backups"),
    };
    let store = SettingsStore::new(paths.settings_path.clone());
    store
        .save(&BackendSettings {
            image_models: vec![model("b"), model("a")],
            ..Default::default()
        })
        .unwrap();
    let backup = temp.path().join("export.json");
    export_full_config(&backup, &paths).unwrap();
    store
        .save_image_models(
            &snapshot(&store.load().unwrap().image_models).revision,
            vec![],
        )
        .unwrap();
    import_full_config(&backup, &paths).unwrap();
    assert_eq!(
        store.load().unwrap().image_models,
        vec![model("b"), model("a")]
    );
}
