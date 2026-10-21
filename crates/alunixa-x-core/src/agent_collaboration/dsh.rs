//! 仅为本次 dsh 任务生成无凭据的 overlay，不读取或修改 DSH 的全局配置。

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use serde_json::{Value, json};

use super::{AgentConfig, Store, TaskRecord, parse_deepseek_model};

fn overlay(agent: &AgentConfig) -> anyhow::Result<Option<Value>> {
    let mut patches = Vec::new();
    let model = parse_deepseek_model(&agent.model)?;
    if agent.reuse_saved_auth {
        for id in ["credentials", "authorization"] {
            patches.push(json!({"id": id, "disabled": false}));
        }
        // API key 路由无需初始化账户 provider，避免影响其不使用的账户登录。
        if model.is_some_and(|(provider, _)| provider == "deepseek-account") {
            patches.push(json!({"id": "deepseek-account", "disabled": false}));
        }
    }
    if let Some((provider, model)) = model {
        patches.push(json!({
            "id": "agent-default-model",
            "config": {"provider": provider, "model": model},
        }));
    }
    Ok((!patches.is_empty()).then(|| Value::Array(patches)))
}

/// overlay 只包含能力开关和模型名称，按任务保存以供诊断，绝不放入 key 或 grant。
pub(super) fn prepare_overlay(
    store: &Store,
    task: &TaskRecord,
    agent: &AgentConfig,
) -> anyhow::Result<Option<PathBuf>> {
    let Some(patch) = overlay(agent)? else {
        return Ok(None);
    };
    let id = uuid::Uuid::parse_str(&task.id).context("DSH 任务身份无效")?;
    let directory = store
        .path()
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("agent-collaboration-overlays");
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => bail!("无法创建 DSH 任务配置目录"),
    }
    let metadata = std::fs::symlink_metadata(&directory).context("无法检查 DSH 任务配置目录")?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        bail!("DSH 任务配置目录不能是符号链接或普通文件");
    }
    let path = directory.join(format!("{id}.json"));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).context("无法创建独立的 DSH 任务配置")?;
    serde_json::to_writer(file, &patch).context("无法写入 DSH 任务配置")?;
    Ok(Some(path.canonicalize().context("无法定位 DSH 任务配置")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_collaboration::{CollaborationConfig, TaskRequest};

    fn agent() -> AgentConfig {
        CollaborationConfig::default()
            .agents
            .into_iter()
            .find(|agent| agent.id == "deepseek")
            .unwrap()
    }

    #[test]
    fn default_keeps_headless_unchanged_and_auth_and_route_are_independent() {
        let mut agent = agent();
        assert!(overlay(&agent).unwrap().is_none());
        agent.reuse_saved_auth = true;
        let expected = json!([
            {"id":"credentials","disabled":false},
            {"id":"authorization","disabled":false},
        ]);
        assert_eq!(overlay(&agent).unwrap(), Some(expected.clone()));
        agent.model = "deepseek-account/deepseek-flash".to_owned();
        let mut with_model = expected.as_array().unwrap().clone();
        with_model.push(json!({"id":"deepseek-account","disabled":false}));
        with_model.push(json!({"id":"agent-default-model","config":{
            "provider":"deepseek-account","model":"deepseek-flash"
        }}));
        assert_eq!(overlay(&agent).unwrap(), Some(json!(with_model)));
        agent.model = "deepseek-official/deepseek-flash".to_owned();
        let api_key_patch = overlay(&agent).unwrap().unwrap();
        assert!(
            !api_key_patch
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["id"] == "deepseek-account")
        );
        agent.model = "deepseek-account/deepseek-flash".to_owned();
        agent.reuse_saved_auth = false;
        assert_eq!(overlay(&agent).unwrap(), Some(json!([with_model.last()])));
        // 模型字符串始终是 JSON 数据，不能注入新的插件或配置字段。
        agent.model = "custom/model \"quoted\" $(literal)".to_owned();
        let patch = overlay(&agent).unwrap().unwrap();
        let serialized = serde_json::to_string(&patch).unwrap();
        let parsed: Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 1);
        assert_eq!(parsed[0]["config"]["model"], "model \"quoted\" $(literal)");
    }

    #[test]
    fn per_task_patch_is_private_and_never_overwrites_an_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().join("state.sqlite3"));
        let mut config = CollaborationConfig::default();
        config.enabled = true;
        let agent = config
            .agents
            .iter_mut()
            .find(|agent| agent.id == "deepseek")
            .unwrap();
        agent.enabled = true;
        agent.reuse_saved_auth = true;
        agent.model = "deepseek-account/deepseek-flash".to_owned();
        agent.executable = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let agent = agent.clone();
        store.save_config(config).unwrap();
        let task = store
            .submit(TaskRequest {
                agent_id: "deepseek".to_owned(),
                prompt: "test".to_owned(),
                cwd: temp.path().to_string_lossy().into_owned(),
                continue_task_id: None,
            })
            .unwrap();
        let path = prepare_overlay(&store, &task, &agent).unwrap().unwrap();
        assert!(path.is_absolute());
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&contents).unwrap(),
            overlay(&agent).unwrap().unwrap()
        );
        assert!(prepare_overlay(&store, &task, &agent).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_directory_cannot_redirect_the_patch() {
        let temp = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(
            target.path(),
            temp.path().join("agent-collaboration-overlays"),
        )
        .unwrap();
        let store = Store::new(temp.path().join("state.sqlite3"));
        let mut agent = agent();
        agent.reuse_saved_auth = true;
        let task: TaskRecord = serde_json::from_value(json!({
            "id":uuid::Uuid::new_v4().to_string(),"agentId":"deepseek","prompt":"test", "cwd":temp.path(),
            "status":"queued","answer":"","error":"","sessionId":"","parentTaskId":null,
            "createdAtMs":0,"updatedAtMs":0,"cancelRequested":false,"progress":""
        })).unwrap();
        assert!(prepare_overlay(&store, &task, &agent).is_err());
        assert_eq!(std::fs::read_dir(target.path()).unwrap().count(), 0);
    }
}
