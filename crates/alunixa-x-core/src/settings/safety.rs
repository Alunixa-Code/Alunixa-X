use super::*;

pub(super) fn validate_profile_updates(
    settings: &BackendSettings,
    raw: &Map<String, Value>,
) -> anyhow::Result<()> {
    let previous: BackendSettings = serde_json::from_value(Value::Object(raw.clone()))?;
    for profile in &settings.relay_profiles {
        let mut normalized = profile.clone();
        if let Err(error) =
            crate::relay_config::normalize_relay_profile_for_storage(&mut normalized)
        {
            // 旧的不支持快照允许原样保留，不能阻断用户修改无关设置。
            if previous
                .relay_profiles
                .iter()
                .any(|old| old.id == profile.id && old == profile)
            {
                continue;
            }
            if profile.relay_mode == RelayMode::Official
                && !profile.official_mix_api_key
                && previous
                    .relay_profiles
                    .iter()
                    .any(|old| old.id == profile.id && old.auth_contents == profile.auth_contents)
            {
                let mut without_legacy_auth = profile.clone();
                without_legacy_auth.auth_contents.clear();
                crate::relay_config::normalize_relay_profile_for_storage(&mut without_legacy_auth)?;
                continue;
            }
            return Err(error)
                .with_context(|| format!("供应商 {} 配置无效，原存档未修改", profile.id));
        }
    }
    Ok(())
}

pub(super) fn preserve_unknown_settings_fields(
    next: &mut Map<String, Value>,
    old: &Map<String, Value>,
) -> anyhow::Result<()> {
    const KNOWN: &[&str] = &[
        "id",
        "name",
        "model",
        "baseUrl",
        "upstreamBaseUrl",
        "apiKey",
        "apiKeys",
        "activeApiKeyId",
        "protocol",
        "relayMode",
        "officialMixApiKey",
        "noAuth",
        "hideOfficialUsageAlert",
        "testModel",
        "configContents",
        "authContents",
        "useCommonConfig",
        "contextWindow",
        "autoCompactLimit",
        "modelInsertMode",
        "modelList",
        "modelWindows",
        "modelAutoCompact",
        "modelMetadata",
        "modelVlm",
        "vlmApiKey",
        "vlmModel",
        "vlmBaseUrl",
        "userAgent",
        "sub2apiEnabled",
        "sub2apiMultiplier",
        "modelRoutes",
        "customHeaders",
        "standardOpenaiProtocol",
        "webSearchHistoryCompat",
        "trustUpstreamCatalogLite",
        "strictResponsesReasoning",
        "anthropicAuthHeader",
        "anthropicMaxTokens",
        "anthropicPromptCache",
        "anthropicImpersonateClaudeCode",
        "anthropicThinkingMode",
        "customModels",
        "modelProtocols",
        "defaultCustomModelId",
        "modelReasoningEfforts",
        "lastUsedModel",
        "contextSelection",
        "contextSelectionInitialized",
        "rateLimitCooldownEnabled",
        "channelQueueEnabled",
        "channelRequestsPerMinute",
        "cooldownErrorStatuses",
    ];
    fn mark_profiles(value: &mut Value) {
        match value {
            Value::Object(object) => {
                if let Some(profiles) = object
                    .get_mut("relayProfiles")
                    .and_then(Value::as_array_mut)
                {
                    for profile in profiles.iter_mut().filter_map(Value::as_object_mut) {
                        // skip_serializing 的旧凭据/地址也是已知字段，绝不能当扩展字段补回。
                        for key in KNOWN {
                            profile.entry((*key).to_string()).or_insert(Value::Null);
                        }
                    }
                }
                for child in object.values_mut() {
                    mark_profiles(child);
                }
            }
            Value::Array(values) => {
                for child in values {
                    mark_profiles(child);
                }
            }
            _ => {}
        }
    }
    fn identity(value: &Value) -> Option<String> {
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            return Some(format!("id:{id}"));
        }
        let relay = value.get("relayId").and_then(Value::as_str)?;
        Some(format!(
            "relay:{relay}:{}",
            value.get("pattern").and_then(Value::as_str).unwrap_or("")
        ))
    }
    fn merge(target: &mut Value, old: &Value, known: &Value) {
        match (target, old, known) {
            (Value::Object(target), Value::Object(old), Value::Object(known)) => {
                for (key, original) in old {
                    if let Some(shape) = known.get(key) {
                        if let Some(value) = target.get_mut(key) {
                            merge(value, original, shape);
                        }
                    } else {
                        target
                            .entry(key.clone())
                            .or_insert_with(|| original.clone());
                    }
                }
            }
            (Value::Array(target), Value::Array(old), Value::Array(known)) => {
                for row in target {
                    let Some(id) = identity(row) else {
                        continue;
                    };
                    let matches: Vec<_> = old
                        .iter()
                        .enumerate()
                        .filter(|(_, old)| identity(old).as_ref() == Some(&id))
                        .collect();
                    if matches.len() != 1 {
                        continue;
                    }
                    let (index, original) = matches[0];
                    if let Some(shape) = known.get(index) {
                        merge(row, original, shape);
                    }
                }
            }
            _ => {}
        }
    }
    let previous: BackendSettings = serde_json::from_value(Value::Object(old.clone()))?;
    let mut known = serde_json::to_value(previous)?;
    known["ccsImportSources"] = known
        .get("ccsImportSources")
        .cloned()
        .unwrap_or(Value::Null);
    known["revision"] = Value::Null;
    for key in [
        "launchMode",
        "codexAppFastStartup",
        "codexAppZedRemoteOpen",
        "zedRemoteOpenStrategy",
        "zedRemoteProjectRegistryEnabled",
        "zedRemoteSyncToZedSettings",
        "codexAppUpstreamWorktreeCreate",
        "codexAppNativeMenuLocalization",
        "codexAppServiceTierControls",
        "codexAppPluginAutoExpand",
        "computerUseGuardEnabled",
    ] {
        known[key] = Value::Null;
    }
    known["codexAppExperimentalContext"] = Value::Null;
    mark_profiles(&mut known);
    let mut target = Value::Object(std::mem::take(next));
    merge(&mut target, &Value::Object(old.clone()), &known);
    *next = target.as_object_mut().expect("settings object").clone();
    Ok(())
}
