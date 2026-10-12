#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    let os_args: Vec<_> = std::env::args_os().collect();
    if let Some(options_path) = os_args.windows(2)
        .find(|window| window[0] == "--alunixa-x-multi-worker")
        .and_then(|window| window.get(1)) {
        if alunixa_x_manager_lib::commands::run_codex_multi_worker(std::path::Path::new(options_path)).is_err() {
            // The worker status file records a redacted diagnostic; never echo config or credentials here.
            eprintln!("multi_worker_failed");
            std::process::exit(1);
        }
        return;
    }
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("--alunixa-x-proxy-probe") {
        let result = args.get(1).ok_or_else(|| anyhow::anyhow!("proxy_probe_request_missing"))
            .and_then(|path| alunixa_x_core::packaged_proxy::run_probe_request(std::path::Path::new(path)));
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    if args.iter().any(|arg| arg == "--alunixa-x-hook" || arg == "--alunixa-x-shared-terminal") {
        let result = tokio_runtime_blocking_cli(args);
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    #[cfg(target_os = "macos")]
    if launched_from_legacy_manager_compat_bundle() {
        // 旧版更新器要求 DMG 中有第二个 manager bundle，并会在替换后打开它。
        // 兼容壳只满足身份校验；让真正的统一 Alunixa X app 接管界面。
        return;
    }
    // 开机启动也只打开界面；禁用开机项不影响用户主动双击。
    if should_skip_autostart(
        std::env::args(),
        alunixa_x_core::watcher::default_watcher_disabled_flag().exists(),
    ) {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let args: Vec<_> = std::env::args_os().collect();
        if args
            .get(1)
            .is_some_and(|arg| arg == "--apply-alunixa-x-update")
        {
            let result = if args.len() == 3 {
                alunixa_x_core::update::macos::run_update_helper(std::path::Path::new(&args[2]))
            } else {
                Err(anyhow::anyhow!(
                    "更新 helper 需要且仅接受一个计划文件路径。"
                ))
            };
            if let Err(error) = result {
                eprintln!("更新 helper 失败：{error:#}");
                let _ = alunixa_x_core::diagnostic_log::append_diagnostic_log(
                    "update.macos.helper_failed",
                    serde_json::json!({ "message": error.to_string() }),
                );
                std::process::exit(1);
            }
            return;
        }
    }
    for arg in std::env::args() {
        if arg.starts_with("dreamskin://") {
            if alunixa_x_manager_lib::handle_dream_skin_url(&arg) {
                alunixa_x_manager_lib::focus_existing_manager_window();
            }
        } else if arg.starts_with("codexplusplus://") {
            match alunixa_x_core::provider_import::save_pending_provider_import_from_url(&arg) {
                Ok(request) => {
                    let _ = alunixa_x_core::diagnostic_log::append_diagnostic_log(
                        "manager.provider_import_url.pending",
                        serde_json::json!({
                            "name": request.name,
                            "baseUrl": request.base_url
                        }),
                    );
                    alunixa_x_manager_lib::focus_existing_manager_window();
                }
                Err(error) => {
                    let _ = alunixa_x_core::diagnostic_log::append_diagnostic_log(
                        "manager.provider_import_url.failed",
                        serde_json::json!({
                            "error": error.to_string()
                        }),
                    );
                }
            }
        }
    }
    if std::env::args().any(|arg| arg == "--show-update") {
        unsafe {
            std::env::set_var("ALUNIXA_X_SHOW_UPDATE", "1");
        }
    }
    alunixa_x_manager_lib::run();
}

fn tokio_runtime_blocking_cli(args: Vec<String>) -> anyhow::Result<()> {
    // CLI dispatch must precede Tauri/single-instance setup: stdout belongs to
    // the invoking Codex child, not another already-open GUI instance.
    let runtime = alunixa_x_launcher::blocking_runtime_for_cli()?;
    runtime.block_on(async move {
        if args.iter().any(|arg| arg == "--alunixa-x-hook") {
            return alunixa_x_core::codex_hooks::run_hook_from_stdio().await;
        }
        use std::io::Write;
        let request = alunixa_x_core::shared_terminal::parse_proxy_request(args.iter())?;
        let result = alunixa_x_core::shared_terminal::run_proxy(request).await?;
        std::io::stdout().write_all(result.output.as_bytes())?;
        if !result.error.is_empty() { std::io::stderr().write_all(result.error.as_bytes())?; }
        std::io::stdout().flush()?;
        std::process::exit(result.exit_code.clamp(0,255));
    })
}

#[cfg(target_os = "macos")]
fn launched_from_legacy_manager_compat_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().contains("Alunixa X 管理工具.app"))
        .unwrap_or(false)
}

fn should_skip_autostart(args: impl IntoIterator<Item = String>, disabled: bool) -> bool {
    disabled && args.into_iter().any(|arg| arg == "--autostart")
}

#[cfg(test)]
mod tests {
    use super::should_skip_autostart;

    #[test]
    fn disabling_login_startup_still_allows_opening_the_gui() {
        for args in [
            vec!["alunixa-x-plus"],
            vec!["alunixa-x-plus", "--background"],
            vec!["alunixa-x-plus", "--helper-only"],
        ] {
            assert!(!should_skip_autostart(
                args.into_iter().map(String::from),
                true
            ));
        }
        assert!(should_skip_autostart(
            ["alunixa-x-plus", "--autostart"].map(String::from),
            true
        ));
        assert!(!should_skip_autostart(
            ["alunixa-x-plus", "--autostart"].map(String::from),
            false
        ));
    }
}
