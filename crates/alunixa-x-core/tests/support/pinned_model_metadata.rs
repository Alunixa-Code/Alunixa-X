use serde_json::Value;

pub fn assert_pinned_default_windows(model: &Value) {
    let slug = model["slug"]
        .as_str()
        .expect("catalog model must have a slug");
    let catalogs = [
        include_str!("../../../../assets/astra-model-metadata-compat.json"),
        include_str!("../../../../assets/gpt56-model-metadata-compat.json"),
        include_str!("../../../../assets/gpt6-sol-luna-model-metadata-compat.json"),
        include_str!("../../../../assets/gpt61-sol-model-metadata-compat.json"),
    ];
    let expected = catalogs
        .iter()
        .flat_map(|source| {
            let catalog: Value = serde_json::from_str(source).expect("pinned metadata must parse");
            catalog["models"].as_array().unwrap().clone()
        })
        .find(|entry| {
            entry["slug"]
                .as_str()
                .is_some_and(|id| id.eq_ignore_ascii_case(slug))
        })
        .unwrap_or_else(|| panic!("no fixed metadata contract for {slug}"));
    assert_eq!(
        model["context_window"], expected["context_window"],
        "{slug}"
    );
    assert_eq!(
        model["max_context_window"], expected["max_context_window"],
        "{slug}: no implicit gateway capacity increase beyond fixed metadata"
    );
}
