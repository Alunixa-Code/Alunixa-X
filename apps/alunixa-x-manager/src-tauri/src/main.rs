#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    if run_codex_restart_worker(&args) {
        return;
    }
    for arg in &args {
        if arg.starts_with("dreamskin://") {
            if alunixa_x_manager_lib::handle_dream_skin_url(arg) {
                alunixa_x_manager_lib::focus_existing_manager_window();
            }
        }
        if arg.starts_with("alunixax://") || arg.starts_with("codexplusplus://") {
            match alunixa_x_core::provider_import::save_pending_provider_import_from_url(arg) {
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
    if args.iter().any(|arg| arg == "--show-update") {
        unsafe {
            std::env::set_var("ALUNIXA_X_SHOW_UPDATE", "1");
        }
    }
    if args.iter().any(|arg| arg == "--hidden") {
        unsafe {
            std::env::set_var("ALUNIXA_X_START_HIDDEN", "1");
        }
    }
    alunixa_x_manager_lib::run();
}

fn run_codex_restart_worker(args: &[String]) -> bool {
    if !args.iter().any(|arg| arg == "--restart-codex-now") {
        return false;
    }
    let debug_port = port_arg(args, "--debug-port", 9229);
    let helper_port = port_arg(
        args,
        "--helper-port",
        alunixa_x_core::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT,
    );
    std::thread::sleep(std::time::Duration::from_millis(900));
    if let Err(error) = alunixa_x_core::watcher::stop_codex_processes_and_wait() {
        let _ = alunixa_x_core::diagnostic_log::append_diagnostic_log(
            "manager.restart_worker.stop_failed",
            serde_json::json!({
                "debug_port": debug_port,
                "helper_port": helper_port,
                "error": error.to_string(),
            }),
        );
        return true;
    }
    for _ in 0..150 {
        if alunixa_x_core::ports::can_bind_loopback_port(helper_port) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if !alunixa_x_core::ports::can_bind_loopback_port(helper_port) {
        let _ = alunixa_x_core::diagnostic_log::append_diagnostic_log(
            "manager.restart_worker.helper_port_busy",
            serde_json::json!({
                "debug_port": debug_port,
                "helper_port": helper_port,
            }),
        );
        return true;
    }
    let launch_args = [
        "--debug-port".to_string(),
        debug_port.to_string(),
        "--helper-port".to_string(),
        helper_port.to_string(),
    ];
    let result = alunixa_x_core::install::spawn_companion(
        alunixa_x_core::install::SILENT_BINARY,
        launch_args,
    );
    let _ = alunixa_x_core::diagnostic_log::append_diagnostic_log(
        if result.is_ok() {
            "manager.restart_worker.started"
        } else {
            "manager.restart_worker.failed"
        },
        serde_json::json!({
            "debug_port": debug_port,
            "helper_port": helper_port,
            "error": result.as_ref().err().map(ToString::to_string),
        }),
    );
    true
}

fn port_arg(args: &[String], key: &str, default: u16) -> u16 {
    args.iter()
        .position(|arg| arg == key)
        .and_then(|index| args.get(index + 1))
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}
