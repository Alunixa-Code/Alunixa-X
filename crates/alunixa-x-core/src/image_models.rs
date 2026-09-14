//! Ordered, independently editable image models. Keys never appear in summaries.
use std::collections::HashSet;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageModel {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl std::fmt::Debug for ImageModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ImageModel")
            .field("id", &self.id)
            .field("model", &self.model)
            .field("api_key", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageModelEdit {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub base_url: String,
    pub model: String,
    /// None retains the stored key for this ID; an explicit empty key is invalid.
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageModelSummary {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageModelsSnapshot {
    pub models: Vec<ImageModelSummary>,
    pub revision: String,
}

pub fn snapshot(models: &[ImageModel]) -> ImageModelsSnapshot {
    let revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(models).expect("image model serialization"))
    );
    ImageModelsSnapshot {
        models: models
            .iter()
            .map(|model| ImageModelSummary {
                id: model.id.clone(),
                name: model.name.clone(),
                base_url: model.base_url.clone(),
                model: model.model.clone(),
                has_api_key: !model.api_key.is_empty(),
            })
            .collect(),
        revision,
    }
}

pub fn apply_edits(
    current: &[ImageModel],
    expected_revision: &str,
    edits: Vec<ImageModelEdit>,
) -> anyhow::Result<Vec<ImageModel>> {
    anyhow::ensure!(
        snapshot(current).revision == expected_revision,
        "生图模型已在其他窗口修改，请刷新后重试"
    );
    let mut models = edits
        .into_iter()
        .map(|edit| {
            let api_key = edit
                .api_key
                .or_else(|| {
                    current
                        .iter()
                        .find(|model| model.id == edit.id)
                        .map(|model| model.api_key.clone())
                })
                .unwrap_or_default();
            ImageModel {
                id: edit.id,
                name: edit.name,
                base_url: edit.base_url,
                api_key,
                model: edit.model,
            }
        })
        .collect::<Vec<_>>();
    normalize_models(&mut models)?;
    Ok(models)
}

pub fn normalize_models(models: &mut [ImageModel]) -> anyhow::Result<()> {
    anyhow::ensure!(models.len() <= 128, "生图模型最多配置 128 项");
    let mut ids = HashSet::new();
    for (index, model) in models.iter_mut().enumerate() {
        model.id = model.id.trim().to_string();
        model.name = model.name.trim().to_string();
        model.model = model.model.trim().to_string();
        model.api_key = model.api_key.trim().to_string();
        anyhow::ensure!(
            !model.id.is_empty()
                && model.id.len() <= 128
                && model
                    .id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
                && ids.insert(model.id.clone()),
            "第 {} 项生图模型的 ID 无效或重复",
            index + 1
        );
        anyhow::ensure!(
            !model.model.is_empty()
                && model.model.len() <= 256
                && !model.model.chars().any(char::is_control)
                && model.name.len() <= 256
                && !model.name.chars().any(char::is_control),
            "第 {} 项生图模型名称无效",
            index + 1
        );
        anyhow::ensure!(
            !model.api_key.is_empty()
                && model.api_key.len() <= 8192
                && reqwest::header::HeaderValue::from_str(&format!("Bearer {}", model.api_key))
                    .is_ok(),
            "第 {} 项生图模型需要有效 API Key",
            index + 1
        );
        model.base_url = normalize_base_url(&model.base_url)
            .with_context(|| format!("第 {} 项生图模型 API 地址无效", index + 1))?;
        if model.name.is_empty() {
            model.name = model.model.clone();
        }
    }
    Ok(())
}

pub fn normalize_base_url(raw: &str) -> anyhow::Result<String> {
    // Do not include user-supplied URLs or their credentials in validation errors.
    let mut url = reqwest::Url::parse(raw.trim())
        .map_err(|_| anyhow::anyhow!("请输入完整 HTTP/HTTPS 地址"))?;
    anyhow::ensure!(
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "API 地址仅支持不含凭据、查询参数和片段的 HTTP/HTTPS 地址"
    );
    let mut path = url.path().trim_end_matches('/').to_string();
    for suffix in ["/images/generations", "/images/edits"] {
        if let Some(base) = path.strip_suffix(suffix) {
            path = base.to_string();
            break;
        }
    }
    if path.is_empty() {
        path = "/v1".to_string();
    }
    url.set_path(&path);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub fn select_model<'a>(
    models: &'a [ImageModel],
    profile_id: Option<&str>,
    requested_model: Option<&str>,
) -> anyhow::Result<Option<&'a ImageModel>> {
    if let Some(id) = profile_id {
        let profile = models
            .iter()
            .find(|model| model.id == id)
            .context("未找到指定生图配置，请在生图模型页面检查")?;
        anyhow::ensure!(
            requested_model.is_none_or(|model| model == profile.model),
            "指定 model 与生图配置不一致"
        );
        return Ok(Some(profile));
    }
    if models.is_empty() {
        return Ok(None);
    }
    match requested_model {
        Some(name) => models
            .iter()
            .find(|model| model.model == name)
            .map(Some)
            .context("该生图模型尚未配置，请添加配置或省略 model 使用默认项"),
        None => Ok(models.first()),
    }
}
