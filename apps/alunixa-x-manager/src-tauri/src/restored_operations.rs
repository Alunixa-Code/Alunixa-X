use alunixa_x_core::official_remote::OfficialRemoteRuntime;
use alunixa_x_core::settings::SettingsStore;
use serde_json::{Value, json};
use std::sync::OnceLock;

fn remote_runtime() -> &'static tokio::sync::Mutex<OfficialRemoteRuntime> {
    static RUNTIME: OnceLock<tokio::sync::Mutex<OfficialRemoteRuntime>> = OnceLock::new();
    RUNTIME.get_or_init(|| tokio::sync::Mutex::new(OfficialRemoteRuntime::default()))
}

#[tauri::command]
pub async fn restored_agent_operation(
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    operation(&action, payload.unwrap_or_else(|| json!({})))
        .await
        .map_err(|error| error.to_string())
}

async fn operation(action: &str, payload: Value) -> anyhow::Result<Value> {
    use alunixa_x_core::zed_remote;
    if action.starts_with("plugins/") {
        let home = alunixa_x_core::codex_home::default_codex_home_dir();
        match action {
            "plugins/repair" => {
                alunixa_x_core::plugin_marketplace::initialize_openai_curated_marketplace_and_configure(&home).await?;
            }
            "plugins/remote" => {
                alunixa_x_core::plugin_marketplace::ensure_openai_curated_remote_marketplace_available(&home)?;
            }
            "plugins/status" => {}
            _ => anyhow::bail!("未知插件缓存操作"),
        }
        return Ok(json!({"status":"ok",
            "local":alunixa_x_core::plugin_marketplace::openai_curated_marketplace_status(&home),
            "remote":alunixa_x_core::plugin_marketplace::openai_curated_remote_marketplace_status(&home)}));
    }
    if action.starts_with("zed/") {
        return Ok(match action {
            "zed/status" => zed_remote::zed_remote_status(),
            "zed/projects" => zed_remote::list_zed_remote_projects_response(&payload),
            "zed/open" => zed_remote::open_zed_remote(&payload),
            "zed/remember" => zed_remote::remember_zed_remote_project_response(&payload),
            "zed/forget" => zed_remote::forget_zed_remote_project_response(&payload),
            _ => anyhow::bail!("未知远程项目操作"),
        });
    }
    if action == "usage" {
        return tokio::task::spawn_blocking(|| {
            let home = alunixa_x_core::codex_home::default_codex_home_dir();
            let paths = alunixa_x_core::codex_sqlite::codex_session_db_paths_from_home(&home);
            let mut sessions = Vec::new();
            for path in paths {
                let adapter = alunixa_x_data::SQLiteStorageAdapter::new(
                    path,
                    alunixa_x_data::BackupStore::new(
                        alunixa_x_core::paths::default_app_state_dir().join("backups"),
                    ),
                );
                if let Ok(mut rows) = adapter.list_local_sessions_limited(200) {
                    sessions.append(&mut rows);
                }
            }
            sessions.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
            let mut ids = std::collections::HashSet::new();
            sessions.retain(|session| ids.insert(session.id.clone()));
            Ok(serde_json::to_value(
                alunixa_x_data::summarize_local_session_usage(&sessions, 200),
            )?)
        })
        .await?;
    }
    let store = SettingsStore::default();
    let settings = store.load()?;
    let home = alunixa_x_core::codex_home::default_codex_home_dir();
    let app = Some(settings.codex_app_path.as_str());
    let mut runtime = remote_runtime().lock().await;
    Ok(match action {
        "remote/status" => serde_json::to_value(runtime.status(app).await?)?,
        "remote/enable" => serde_json::to_value(runtime.enable(app).await?)?,
        "remote/disable" => serde_json::to_value(runtime.disable(app).await?)?,
        "remote/pair" => serde_json::to_value(runtime.pairing_start(app).await?)?,
        "remote/pair-status" => json!({"claimed":runtime.pairing_status(app,
            payload["pairingCode"].as_str(),payload["manualPairingCode"].as_str()).await?}),
        "remote/revoke" => serde_json::to_value(
            runtime
                .revoke_client(
                    app,
                    payload["environmentId"].as_str().unwrap_or(""),
                    payload["clientId"].as_str().unwrap_or(""),
                )
                .await?,
        )?,
        "login/browser" => serde_json::to_value(runtime.login_start(app, &store, &home).await?)?,
        "login/device" => {
            serde_json::to_value(runtime.device_login_start(app, &store, &home).await?)?
        }
        "login/status" => serde_json::to_value(
            runtime
                .login_status(payload["loginId"].as_str().unwrap_or(""), &store, &home)
                .await?,
        )?,
        "login/cancel" => {
            runtime
                .login_cancel(payload["loginId"].as_str().unwrap_or(""), &store, &home)
                .await?;
            json!({"status":"cancelled"})
        }
        "login/logout" => serde_json::to_value(runtime.logout(app, &store, &home).await?)?,
        _ => anyhow::bail!("未知 Agent 操作"),
    })
}
