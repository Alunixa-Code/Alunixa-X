//! Narrow compatibility repair for Guardian's untagged boolean/config union.
//! Keep valid settings, including enabled=false, and never touch other features.
use toml_edit::{DocumentMut, Item, TableLike};

pub fn repair_text(text: &str) -> anyhow::Result<(String, Vec<String>)> {
    let mut doc: DocumentMut = text.parse()?;
    let mut changes = Vec::new();
    repair_scope(doc.as_table_mut(), "", &mut changes);
    if let Some(profiles) = doc.get_mut("profiles").and_then(Item::as_table_like_mut) {
        for (name, profile) in profiles.iter_mut() {
            if let Some(scope) = profile.as_table_like_mut() {
                repair_scope(scope, &format!("profiles.{name}."), &mut changes);
            }
        }
    }
    Ok((if changes.is_empty() { text.into() } else { doc.to_string() }, changes))
}

fn repair_scope(scope: &mut dyn TableLike, prefix: &str, changes: &mut Vec<String>) {
    let Some(features) = scope.get_mut("features").and_then(Item::as_table_like_mut) else {
        return;
    };
    let Some(guardian) = features.get_mut("guardianv2") else { return };
    let path = format!("{prefix}features.guardianv2");
    if guardian.as_bool().is_some() {
        return;
    }
    if let Some(table) = guardian.as_table_like_mut() {
        repair_table(table, "guardian", &path, changes);
    } else {
        features.remove("guardianv2");
        changes.push(path);
    }
    if features.is_empty() {
        scope.remove("features");
    }
}

fn repair_table(table: &mut dyn TableLike, kind: &str, path: &str, changes: &mut Vec<String>) {
    let keys: Vec<String> = table.iter().map(|(key, _)| key.to_owned()).collect();
    for key in keys {
        let item = table.get_mut(&key).expect("enumerated key");
        let nested = match (kind, key.as_str()) {
            ("guardian", "transcript") => Some("transcript"),
            ("guardian", "review_scope") => Some("review_scope"),
            _ => None,
        };
        let valid = if let Some(nested) = nested {
            if let Some(child) = item.as_table_like_mut() {
                repair_table(child, nested, &format!("{path}.{key}"), changes);
                true
            } else {
                false
            }
        } else {
            valid_field(kind, &key, item)
        };
        if !valid {
            table.remove(&key);
            changes.push(format!("{path}.{key}"));
        }
    }
}

fn valid_field(kind: &str, key: &str, item: &Item) -> bool {
    match (kind, key) {
        ("guardian", "enabled" | "free_guardian" | "persist_scores" | "reuse_parent_compaction" | "thread_context")
        | ("review_scope", "computer_use_only" | "sandboxed_exec_commands")
        | ("transcript", "include_images") => item.as_bool().is_some(),
        ("guardian", "classifier_instructions") => item.as_str().is_some(),
        ("guardian", "reasoning_effort") => item.as_str().is_some_and(|v|
            matches!(v, "none" | "minimal" | "low" | "medium" | "high" | "xhigh")),
        ("guardian", "max_action_tokens" | "max_classifier_instruction_tokens" | "max_parent_compaction_tokens")
        | ("transcript", "max_message_entry_tokens" | "max_message_transcript_tokens" | "max_tool_entry_tokens" | "max_tool_transcript_tokens") =>
            item.as_integer().is_some_and(|v| (100..=100_000).contains(&v)),
        ("guardian", "max_tool_call_lag") => item.as_integer().is_some_and(|v| v >= 0),
        ("transcript", "max_recent_non_user_entries") => item.as_integer().is_some_and(|v| v >= 1),
        ("guardian", "review_threshold") => item.as_float().or_else(|| item.as_integer().map(|v| v as f64))
            .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v)),
        ("transcript", "sources") => item.as_array().is_some_and(|values| values.iter().all(|v|
            v.as_str().is_some_and(|v| matches!(v, "tool_calls" | "tool_outputs" | "reasoning")))),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_invalid_nested_fields_without_disabling_guardian() {
        let source = "# retained\n[features]\nother = true\n[features.guardianv2]\nenabled = true\nthread_context = 'yes'\nreview_threshold = 2.0\nfuture_option = 1\n[features.guardianv2.transcript]\ninclude_images = false\nsources = ['wrong']\n[profiles.work.features]\nguardianv2 = {enabled=false, transcript={max_tool_entry_tokens=-1}}\n";
        let (fixed, changes) = repair_text(source).unwrap();
        assert_eq!(changes.len(), 5);
        let v: toml::Value = fixed.parse().unwrap();
        assert_eq!(v["features"]["guardianv2"]["enabled"].as_bool(), Some(true));
        assert_eq!(v["profiles"]["work"]["features"]["guardianv2"]["enabled"].as_bool(), Some(false));
        assert_eq!(v["features"]["guardianv2"]["transcript"]["include_images"].as_bool(), Some(false));
        assert!(fixed.contains("# retained"));
        assert!(fixed.contains("other = true"));
        assert!(repair_text(&fixed).unwrap().1.is_empty());
    }

    #[test]
    fn valid_boolean_and_structures_are_byte_preserved() {
        for value in ["true", "false", "{enabled=true,thread_context=true}", "{transcript={include_images=false,sources=['reasoning']}, review_threshold=0.5}", "{}"] {
            let source = format!("[features]\nguardianv2={value}\n");
            assert_eq!(repair_text(&source).unwrap(), (source, vec![]));
        }
    }
}
