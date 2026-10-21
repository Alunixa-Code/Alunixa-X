use std::path::Path;

use anyhow::Context;

use crate::relay_config::{
    backfill_relay_profile_from_home_with_common, relay_config_status_from_home,
};
use crate::settings::{BackendSettings, RelayMode, SettingsStore};

#[derive(Debug, Clone, PartialEq)]
pub struct RelaySwitchResult {
    pub settings: BackendSettings,
    pub configured: bool,
    pub backup_path: Option<String>,
}

pub fn switch_relay_profile_in_home(
    store: &SettingsStore,
    home: &Path,
    next_settings: BackendSettings,
    previous_active_relay_id: &str,
) -> anyhow::Result<RelaySwitchResult> {
    let _lock = crate::config_transaction::ConfigLock::acquire(home)?;
    let mut selected_settings = next_settings;
    if !selected_settings.relay_profiles_enabled {
        anyhow::bail!("供应商配置总开关已关闭，未写入 config.toml / auth.json。");
    }
    crate::codex_app_state::capture_app_state_snapshot_nonfatal(home, "relay_switch.before");

    let saved_settings = store
        .load()
        .context("读取原供应商设置失败，已停止切换以避免覆盖配置")?;
    restore_missing_saved_profiles(&mut selected_settings, &saved_settings);
    let target = selected_settings.active_relay_profile();
    let snapshot_invalid = !target.auth_contents.trim().is_empty()
        && serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
            &target.auth_contents,
        )
        .is_err();
    if snapshot_invalid {
        let live = std::fs::read_to_string(home.join("auth.json")).unwrap_or_default();
        let live_valid =
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&live).is_ok();
        if target.relay_mode == RelayMode::Aggregate && live_valid {
            // A stale aggregate snapshot never outranks validated current login state.
            if let Some(profile) = selected_settings
                .relay_profiles
                .iter_mut()
                .find(|p| p.id == target.id)
            {
                profile.auth_contents = "{}".into();
            }
        } else {
            anyhow::bail!("auth.json 不是有效 JSON 对象，未切换");
        }
    }
    if target.relay_mode == RelayMode::Aggregate {
        let live = std::fs::read_to_string(home.join("auth.json")).unwrap_or_default();
        let live_invalid = !live.trim().is_empty()
            && serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&live).is_err();
        let usable_snapshot = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
            &target.auth_contents,
        )
        .is_ok_and(|snapshot| !snapshot.is_empty());
        anyhow::ensure!(
            !live_invalid || usable_snapshot,
            "auth.json 不是有效 JSON 对象，且没有已验证格式的恢复快照；未切换，原登录文件保持不变"
        );
    }
    if !previous_active_relay_id.trim().is_empty()
        && previous_active_relay_id != selected_settings.active_relay_id
    {
        backfill_profile_before_switch(home, &mut selected_settings, previous_active_relay_id)?;
    }
    // This path represents an explicit provider/default-model selection from
    // the manager, so the submitted selection must win over an older runtime
    // model snapshot that may still be present on disk.
    let result = crate::config_transaction::run(store.path(), home, None, || {
        store
            .save(&selected_settings)
            .context("保存供应商设置失败")?;
        let selected_settings = store.load().context("读取供应商设置失败")?;
        apply_selected_relay_profile(home, &selected_settings)
    })?;
    crate::codex_app_state::sync_app_state_after_provider_switch_nonfatal(
        home,
        "relay_switch.after",
    );
    crate::codex_app_state::prune_stale_model_references_after_switch_nonfatal(
        home, &result.settings, "relay_switch.after",
    );
    Ok(result)
}

fn restore_missing_saved_profiles(selected: &mut BackendSettings, saved: &BackendSettings) {
    for profile in &saved.relay_profiles {
        if !selected.relay_profiles.iter().any(|item| item.id == profile.id) {
            selected.relay_profiles.push(profile.clone());
        }
    }
    for aggregate in &saved.aggregate_relay_profiles {
        if !selected.aggregate_relay_profiles.iter().any(|item| item.id == aggregate.id) {
            selected.aggregate_relay_profiles.push(aggregate.clone());
        }
    }
}

fn backfill_profile_before_switch(
    home: &Path,
    settings: &mut BackendSettings,
    previous_active_relay_id: &str,
) -> anyhow::Result<()> {
    // 确认属于另一个已保存供应商的 live 配置，不回填到旧 profile（共享 Key 也适用）。
    if crate::relay_config::live_config_matches_other_profile_in_home(
        home,
        settings,
        previous_active_relay_id,
    )? {
        return Ok(());
    }
    // 找不到上一个供应商是用户能自助处理的一类原因（它已被删除或 id 变了），
    // 单独给一条能直接照做的话；下面回填失败则属于另一类，见那里的写法。
    let profile = settings
        .relay_profiles
        .iter_mut()
        .find(|profile| profile.id == previous_active_relay_id)
        .with_context(|| {
            format!(
                "当前供应商（{previous_active_relay_id}）已不在配置列表中，已停止切换以避免覆盖用户改动。"
            )
        })?;
    // issue #1888：管理器把本函数返回的错误拼成「回填当前供应商配置失败：{error}」，
    // 而 `{error}` 只打印最外层 context，底层原因（读 home 失败等）会被丢掉，
    // 用户看到的就是一句没有信息量的报错。这里把 context 链完整拼进消息里。
    backfill_relay_profile_from_home_with_common(
        home,
        profile,
        &mut settings.relay_context_config_contents,
    )
    .with_context(|| format!("回填当前供应商配置失败（供应商：{previous_active_relay_id}）"))
    .map_err(|error| anyhow::anyhow!("{error:#}"))
}

fn apply_selected_relay_profile(
    home: &Path,
    settings: &BackendSettings,
) -> anyhow::Result<RelaySwitchResult> {
    let relay = settings.active_relay_profile();
    let common_config = relay_combined_common_config(settings);
    let result = if relay.relay_mode == RelayMode::Official && !relay.official_mix_api_key {
        crate::relay_config::apply_relay_profile_with_preservation(home, &relay, &common_config, crate::protocol_proxy::protocol_proxy_port(), settings.relay_preserve_nonprovider_settings)?
    } else {
        validate_switch_profile_files(&relay)?;
        crate::relay_config::apply_relay_profile_with_preservation(
            home, &relay, &common_config, crate::protocol_proxy::protocol_proxy_port(), settings.relay_preserve_nonprovider_settings,
        )?
    };
    crate::relay_config::sync_codex_agent_capabilities_in_home(home, settings)?;
    crate::retired_context::remove_from_home(home)?;
    crate::relay_config::verify_profile_context_limits_in_config(
        &relay,
        &std::fs::read_to_string(home.join("config.toml"))?,
    )?;
    let status = relay_config_status_from_home(home);
    if relay.relay_mode == RelayMode::PureApi && !status.configured {
        anyhow::bail!(
            "纯 API 配置写入后未检测到完整 custom provider，请检查 config.toml 和供应商 API Key。"
        );
    }
    Ok(RelaySwitchResult {
        settings: settings.clone(),
        configured: status.configured,
        backup_path: result.backup_path,
    })
}

fn validate_switch_profile_files(profile: &crate::settings::RelayProfile) -> anyhow::Result<()> {
    if profile.relay_mode != RelayMode::Aggregate && profile.config_contents.trim().is_empty() {
        anyhow::bail!(
            "供应商「{}」缺少独立 config.toml，已停止切换，避免继续显示上一套配置文件。",
            if profile.name.trim().is_empty() {
                profile.id.as_str()
            } else {
                profile.name.as_str()
            }
        );
    }
    if profile.relay_mode == RelayMode::Official
        && serde_json::from_str::<serde_json::Value>(&profile.auth_contents)
            .ok()
            .and_then(|value| {
                value
                    .get("OPENAI_API_KEY")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .map(str::is_empty)
            })
            == Some(false)
    {
        anyhow::bail!(
            "官方混合 API 不应在 auth.json 中保存 OPENAI_API_KEY。请清理此供应商的 auth.json 后再切换。"
        );
    }
    Ok(())
}

fn relay_combined_common_config(settings: &BackendSettings) -> String {
    let sections = [
        settings.relay_common_config_contents.trim(),
        settings.relay_context_config_contents.trim(),
    ]
    .into_iter()
    .filter(|section| !section.is_empty())
    .collect::<Vec<_>>();
    if sections.is_empty() {
        String::new()
    } else {
        crate::relay_config::normalize_config_text(&format!("{}\n", sections.join("\n\n")))
    }
}
