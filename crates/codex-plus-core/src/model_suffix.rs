//! model_list 后缀语法解析与 catalog JSON 构建。
//!
//! 后缀语法：`deepseek-v4-pro[1M]` 表示 slug=deepseek-v4-pro、context_window=1000000。
//! 单位 K/k=1000、M/m=1000000；纯数字也接受。后缀在生成 catalog 时剥离。

use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

use crate::settings::ReasoningEffort;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCatalogEntry {
    pub slug: String,
    pub display_name: String,
    /// 来自后缀的窗口值；None 表示该条目无后缀（回落顶层默认）。
    pub suffix_window: Option<u64>,
}

/// 解析单个模型条目的后缀，返回 (slug, 可选窗口)。
/// 括号内非合法窗口 token 时，整串作为 slug 且 window=None（不剥离括号）。
pub fn parse_model_suffix(raw: &str) -> (String, Option<u64>) {
    let raw = raw.trim();
    if let Some(close) = raw.rfind(']') {
        // 仅当 ] 是最后一个字符时才视为后缀
        if close == raw.len() - 1 {
            if let Some(open) = raw[..close].rfind('[') {
                let inner = raw[open + 1..close].trim();
                let slug = raw[..open].trim();
                if !slug.is_empty() {
                    if let Some(window) = parse_window_token(inner) {
                        return (slug.to_string(), Some(window));
                    }
                }
            }
        }
    }
    (raw.to_string(), None)
}

/// 一次性迁移：把旧格式 `slug[suffix]` 的 model_list 拆成无后缀列表和窗口 map。
pub fn migrate_model_list_with_suffixes(model_list: &str) -> (String, HashMap<String, String>) {
    let mut clean_lines = Vec::new();
    let mut windows = HashMap::new();
    for raw in model_list
        .split(['\r', '\n', ','])
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let (slug, window) = parse_model_suffix(raw);
        clean_lines.push(slug.clone());
        if let Some(window) = window {
            windows.insert(slug, window.to_string());
        }
    }
    (clean_lines.join("\n"), windows)
}

/// 解析括号内的窗口 token，如 "1M" / "200K" / "1000000"。非法或 0 返回 None。
pub(crate) fn parse_window_token(token: &str) -> Option<u64> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    let (num_part, multiplier) = match token.chars().last() {
        Some('K' | 'k') => (&token[..token.len() - 1], 1_000u64),
        Some('M' | 'm') => (&token[..token.len() - 1], 1_000_000u64),
        Some(_) => (token, 1u64),
        None => return None,
    };
    num_part
        .trim()
        .parse::<u64>()
        .ok()
        .map(|value| value * multiplier)
        .filter(|value| *value > 0)
}

/// 收集 profile 的全部模型条目，保留 `model_list` 的用户排序并从
/// `model_windows` map 读取窗口。当前 model 不在列表中时才追加到末尾。
///
/// 当前 model 若不带后缀，但在 `model_windows` 中存在同名条目，
/// 则采纳该窗口（让当前 model 的窗口也能生效）。
pub fn collect_catalog_entries(
    model_list: &str,
    model_windows: &HashMap<String, String>,
    current_model: &str,
) -> Vec<ModelCatalogEntry> {
    // 先解析 model_list，保留顺序并去重；后缀已从 model_list 剥离，窗口来自 model_windows map。
    let mut seen = HashSet::new();
    let mut list_entries: Vec<ModelCatalogEntry> = Vec::new();
    for raw in model_list
        .split(['\r', '\n', ','])
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let (slug, _) = parse_model_suffix(raw);
        if slug.is_empty() {
            continue;
        }
        if !seen.insert(slug.clone()) {
            continue;
        }
        let suffix_window = model_windows
            .get(&slug)
            .and_then(|token| parse_window_token(token));
        list_entries.push(ModelCatalogEntry {
            display_name: slug.clone(),
            slug,
            suffix_window,
        });
    }

    // 当前 model 不在有序列表中时才追加，避免启动模型改写用户排序。
    let current_model = current_model.trim();
    if !current_model.is_empty() {
        let (slug, _) = parse_model_suffix(current_model);
        if !slug.is_empty() && seen.insert(slug.clone()) {
            let suffix_window = model_windows
                .get(&slug)
                .and_then(|token| parse_window_token(token));
            list_entries.push(ModelCatalogEntry {
                display_name: slug.clone(),
                slug,
                suffix_window,
            });
        }
    }
    list_entries
}

/// 内置 codex bundled catalog 模板（assets/codex-models.json），用于 clone entry
/// 保证字段齐全，避免 codex 因缺字段忽略条目。
const BUNDLED_TEMPLATE_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../assets/codex-models.json"
));

const GPT56_METADATA_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../assets/gpt56-model-metadata-compat.json"
));

pub fn requires_bundled_metadata_catalog(slug: &str) -> bool {
    gpt56_metadata_entry(slug).is_some()
}

pub fn model_ui_metadata(slug: &str) -> Option<Value> {
    let metadata = gpt56_metadata_entry(slug)?;
    let levels = metadata
        .get("supported_reasoning_levels")?
        .as_array()?
        .iter()
        .filter_map(|level| {
            let effort = level.get("effort")?.as_str()?.trim();
            if effort.is_empty() {
                return None;
            }
            Some(json!({
                "reasoningEffort": effort,
                "description": level
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            }))
        })
        .collect::<Vec<_>>();
    Some(json!({
        "displayName": metadata
            .get("display_name")
            .and_then(Value::as_str)
            .unwrap_or(slug),
        "description": metadata
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Custom model"),
        "defaultReasoningEffort": metadata
            .get("default_reasoning_level")
            .and_then(Value::as_str)
            .unwrap_or("medium"),
        "supportedReasoningEfforts": levels,
        "additionalSpeedTiers": metadata
            .get("additional_speed_tiers")
            .cloned()
            .unwrap_or_else(|| json!([])),
        "serviceTiers": metadata
            .get("service_tiers")
            .cloned()
            .unwrap_or_else(|| json!([]))
    }))
}

pub fn model_ui_metadata_with_maximum(slug: &str, maximum: ReasoningEffort) -> Value {
    let mut metadata = model_ui_metadata(slug).unwrap_or_else(|| {
        json!({
            "displayName": slug,
            "description": slug,
            "defaultReasoningEffort": "medium",
            "additionalSpeedTiers": [],
            "serviceTiers": []
        })
    });
    let levels = ReasoningEffort::ALL
        .into_iter()
        .take_while(|effort| *effort <= maximum)
        .map(|effort| {
            json!({
                "reasoningEffort": effort.as_str(),
                "description": reasoning_effort_description(effort)
            })
        })
        .collect::<Vec<_>>();
    metadata["supportedReasoningEfforts"] = json!(levels);
    let default = metadata
        .get("defaultReasoningEffort")
        .and_then(Value::as_str)
        .and_then(reasoning_effort_from_str)
        .unwrap_or(ReasoningEffort::Medium);
    metadata["defaultReasoningEffort"] = json!(std::cmp::min(default, maximum).as_str());
    metadata
}

/// 构建 codex model_catalog_json 内容。
///
/// 采用 cc-switch 的 template-clone 思路：取 codex 自带 bundled entry 做模板，
/// 再覆盖 slug / display_name / description / context_window / max_context_window /
/// effective_context_window_percent / priority / auto_compact_token_limit 等字段。
/// 无后缀条目用 fallback_window；fallback 也无时回落 272000（codex 默认）。
/// auto_compact_token_limit 留 null：codex 内置模型即 null（按比例算，调研第六节）。
pub fn build_model_catalog_json(
    entries: &[ModelCatalogEntry],
    fallback_window: Option<u64>,
) -> String {
    build_model_catalog_json_with_efforts(entries, fallback_window, &HashMap::new())
}

pub fn build_model_catalog_json_with_efforts(
    entries: &[ModelCatalogEntry],
    fallback_window: Option<u64>,
    reasoning_efforts: &HashMap<String, ReasoningEffort>,
) -> String {
    build_model_catalog_json_with_template_and_efforts(
        entries,
        fallback_window,
        None,
        reasoning_efforts,
    )
}

/// 使用指定模板（或内置 bundled 模板）构建 catalog。
/// `template` 为单个 model entry 的 JSON Value；为 None 时使用内置模板的第一条。
pub fn build_model_catalog_json_with_template(
    entries: &[ModelCatalogEntry],
    fallback_window: Option<u64>,
    template: Option<&Value>,
) -> String {
    build_model_catalog_json_with_template_and_efforts(
        entries,
        fallback_window,
        template,
        &HashMap::new(),
    )
}

fn build_model_catalog_json_with_template_and_efforts(
    entries: &[ModelCatalogEntry],
    fallback_window: Option<u64>,
    template: Option<&Value>,
    reasoning_efforts: &HashMap<String, ReasoningEffort>,
) -> String {
    let models: Vec<Value> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let (mut model, has_model_metadata) = template
                .cloned()
                .map(|template| (template, false))
                .unwrap_or_else(|| model_template_entry(&entry.slug));
            let metadata_window = model.get("context_window").and_then(Value::as_u64);
            let context_window = entry
                .suffix_window
                .or(fallback_window)
                .or(metadata_window)
                .unwrap_or(272_000);
            model["slug"] = json!(entry.slug);
            if !has_model_metadata {
                model["display_name"] = json!(entry.display_name);
                model["description"] = json!(entry.display_name);
            }
            model["context_window"] = json!(context_window);
            model["max_context_window"] = json!(context_window);
            // 默认 95 会让 1M 显示为 950K，显式写 100 以显示真实窗口。
            model["effective_context_window_percent"] = json!(100);
            model["auto_compact_token_limit"] = Value::Null;
            model["priority"] = json!(1000 + index);
            model["visibility"] = json!("list");
            model["supported_in_api"] = json!(true);
            let maximum_effort = reasoning_efforts
                .get(&entry.slug)
                .copied()
                .unwrap_or_default();
            model["supported_reasoning_levels"] = reasoning_levels(maximum_effort);
            let current_default = model
                .get("default_reasoning_level")
                .and_then(Value::as_str)
                .and_then(reasoning_effort_from_str)
                .unwrap_or(ReasoningEffort::Medium);
            model["default_reasoning_level"] =
                json!(std::cmp::min(current_default, maximum_effort).as_str());
            if !has_model_metadata {
                model["additional_speed_tiers"] = json!([]);
                model["service_tiers"] = json!([]);
            }
            model["availability_nux"] = Value::Null;
            model["upgrade"] = Value::Null;
            model
        })
        .collect();
    serde_json::to_string_pretty(&json!({ "models": models })).unwrap_or_default()
}

pub fn reasoning_levels(maximum: ReasoningEffort) -> Value {
    Value::Array(
        ReasoningEffort::ALL
            .into_iter()
            .take_while(|effort| *effort <= maximum)
            .map(|effort| {
                json!({
                    "effort": effort.as_str(),
                    "description": reasoning_effort_description(effort)
                })
            })
            .collect(),
    )
}

fn reasoning_effort_from_str(value: &str) -> Option<ReasoningEffort> {
    match value.trim().to_ascii_lowercase().as_str() {
        "low" => Some(ReasoningEffort::Low),
        "medium" => Some(ReasoningEffort::Medium),
        "high" => Some(ReasoningEffort::High),
        "xhigh" => Some(ReasoningEffort::Xhigh),
        "max" => Some(ReasoningEffort::Max),
        "ultra" => Some(ReasoningEffort::Ultra),
        _ => None,
    }
}

fn reasoning_effort_description(effort: ReasoningEffort) -> &'static str {
    match effort {
        ReasoningEffort::Low => "Fast responses with lighter reasoning",
        ReasoningEffort::Medium => "Balances speed and reasoning depth for everyday tasks",
        ReasoningEffort::High => "Greater reasoning depth for complex problems",
        ReasoningEffort::Xhigh => "Extra high reasoning depth for complex problems",
        ReasoningEffort::Max => "Maximum reasoning depth for the hardest problems",
        ReasoningEffort::Ultra => "Maximum reasoning with automatic task delegation",
    }
}

fn model_template_entry(slug: &str) -> (Value, bool) {
    if let Some(entry) = bundled_template_entry(slug) {
        return (entry, true);
    }
    if let Some(compatibility) = gpt56_metadata_entry(slug) {
        let mut template = first_bundled_template_entry().unwrap_or_else(|| json!({}));
        if let (Some(target), Some(source)) = (template.as_object_mut(), compatibility.as_object())
        {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        return (template, true);
    }
    (
        first_bundled_template_entry().unwrap_or_else(|| json!({})),
        false,
    )
}

fn bundled_template_entry(slug: &str) -> Option<Value> {
    let catalog: Value = serde_json::from_str(BUNDLED_TEMPLATE_JSON).ok()?;
    catalog
        .get("models")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("slug").and_then(Value::as_str) == Some(slug))
        .cloned()
}

fn first_bundled_template_entry() -> Option<Value> {
    let catalog: Value = serde_json::from_str(BUNDLED_TEMPLATE_JSON).ok()?;
    catalog.get("models")?.as_array()?.first().cloned()
}

fn gpt56_metadata_entry(slug: &str) -> Option<Value> {
    let catalog: Value = serde_json::from_str(GPT56_METADATA_JSON).ok()?;
    let normalized_slug = normalized_gpt56_model_slug(slug);
    catalog
        .get("models")?
        .as_array()?
        .iter()
        .find(|entry| {
            entry
                .get("slug")
                .and_then(Value::as_str)
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(&normalized_slug))
        })
        .cloned()
}

fn normalized_gpt56_model_slug(slug: &str) -> String {
    let (slug, _) = parse_model_suffix(slug);
    let normalized = slug.trim().to_ascii_lowercase();
    for candidate in ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] {
        let Some(start) = normalized.rfind(candidate) else {
            continue;
        };
        let end = start + candidate.len();
        let prefix_ok = start == 0
            || normalized[..start]
                .chars()
                .next_back()
                .is_some_and(is_model_slug_separator);
        let suffix_ok = end == normalized.len()
            || normalized[end..]
                .chars()
                .next()
                .is_some_and(is_model_slug_separator);
        if prefix_ok && suffix_ok {
            return candidate.to_string();
        }
    }
    normalized
}

fn is_model_slug_separator(ch: char) -> bool {
    matches!(ch, '/' | '\\' | ':' | '@' | '-' | '_' | '.')
}
