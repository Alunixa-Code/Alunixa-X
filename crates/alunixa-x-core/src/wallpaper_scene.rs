//! Native Scene projects stay in Wallpaper Engine; Electron captures only our
//! uniquely named pop-out window, never the desktop or an arbitrary app.
use crate::settings::BackendSettings;
use anyhow::{Context, bail};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

fn snapshot() -> &'static Mutex<(PathBuf, Value)> {
    static STATE: OnceLock<Mutex<(PathBuf, Value)>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new((PathBuf::new(), json!({"status":"waiting"}))))
}

pub fn state(project: &Path) -> Value {
    match snapshot().lock() {
        Ok(state) if state.0 == project => state.1.clone(),
        _ => {
            json!({"status":"failed","message":"场景尚未启动，请保存设置并通过 Alunixa X 重新启动 Codex"})
        }
    }
}

pub fn enabled(settings: &BackendSettings) -> bool {
    settings.enhancements_enabled
        && settings.codex_app_image_overlay_enabled
        && crate::wallpaper::resolve(Path::new(settings.codex_app_image_overlay_path.trim()))
            .is_ok_and(|source| matches!(source.kind.as_str(), "scene" | "web"))
}

pub fn engine_path(project: &Path, configured: &str) -> anyhow::Result<PathBuf> {
    if !cfg!(windows) {
        bail!("Wallpaper Engine 原生 Scene 仅支持 Windows；其他平台可使用视频或 Web 壁纸");
    }
    let valid = |path: &Path| {
        path.is_file()
            && path.file_name().and_then(|s| s.to_str()).is_some_and(|s| {
                matches!(
                    s.to_ascii_lowercase().as_str(),
                    "wallpaper64.exe" | "wallpaper32.exe"
                )
            })
    };
    if !configured.trim().is_empty() {
        let path = PathBuf::from(configured.trim());
        if valid(&path) {
            return Ok(path.canonicalize()?);
        }
        bail!("请选择 Wallpaper Engine 的 wallpaper64.exe 或 wallpaper32.exe");
    }
    // Works for both Workshop and local projects on non-default Steam libraries.
    for root in project.ancestors() {
        for relative in [
            "wallpaper64.exe",
            "wallpaper32.exe",
            "common/wallpaper_engine/wallpaper64.exe",
            "common/wallpaper_engine/wallpaper32.exe",
        ] {
            let candidate = root.join(relative);
            if valid(&candidate) {
                return Ok(candidate.canonicalize()?);
            }
        }
    }
    bail!("未找到 Wallpaper Engine，请选择已安装的 wallpaper64.exe");
}

pub fn start(inspector_port: u16, settings: &BackendSettings) {
    if !enabled(settings) {
        return;
    }
    let settings = settings.clone();
    tokio::spawn(async move {
        let Ok(source) =
            crate::wallpaper::resolve(Path::new(settings.codex_app_image_overlay_path.trim()))
        else {
            return;
        };
        if let Ok(mut state) = snapshot().lock() {
            *state = (source.path.clone(), json!({"status":"waiting"}));
        }
        let result = prepare(inspector_port, &source.path, &settings).await;
        let value = match result {
            Ok(value) => value,
            Err(error) => json!({"status":"failed","message":error.to_string()}),
        };
        if let Ok(mut state) = snapshot().lock() {
            *state = (source.path, value);
        }
    });
}

async fn prepare(port: u16, project: &Path, settings: &BackendSettings) -> anyhow::Result<Value> {
    let engine = engine_path(project, &settings.codex_app_wallpaper_engine_path)?;
    let title = format!("Alunixa X Wallpaper {}", uuid::Uuid::new_v4());
    let script = capture_script(&engine, project, &title, settings.codex_app_wallpaper_muted);
    let mut target = None;
    for _ in 0..20 {
        if let Ok(targets) = crate::cdp::list_targets(port).await {
            target = targets.into_iter().find(|target| {
                target.target_type == "node" && target.web_socket_debugger_url.is_some()
            });
            if target.is_some() {
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    let target = target.context("Codex 主进程未开放场景接口，请通过 Alunixa X 启动")?;
    let result = crate::bridge::evaluate_script_with_timeout(
        target.web_socket_debugger_url.as_deref().unwrap(),
        &script,
        true,
        std::time::Duration::from_secs(30),
    )
    .await?;
    let text = result
        .pointer("/result/result/value")
        .or_else(|| result.pointer("/result/value"))
        .and_then(Value::as_str)
        .context("原生场景返回了无效捕获结果")?;
    let value: Value = serde_json::from_str(text)?;
    if value["status"] == "ok" {
        send_window_behind(&title);
    }
    Ok(value)
}

pub fn capture_script(engine: &Path, project: &Path, title: &str, muted: bool) -> String {
    let options = json!({"engine":engine,"project":project,"title":title,"muted":muted});
    r#"(async () => {
      const options = __OPTIONS__;
      const require = process.mainModule?.require?.bind(process.mainModule);
      const electron = require?.("electron");
      if (!electron?.desktopCapturer) return JSON.stringify({status:"failed",message:"当前 Codex 未提供原生窗口捕获"});
      const {spawn} = require("node:child_process");
      const quoteWindowsArg = value => '"' + value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/g,'$1$1') + '"';
      const run = (args, rawProperties = false) => new Promise((resolve,reject) => {
        // WE parses RAW~(...)~END directly from the Windows command line.
        // Node's normal argv quoting escapes its JSON quotes and WE rejects it.
        // Preserve only this fixed payload verbatim, quoting every other argument;
        // ordinary file/title commands keep Node's normal safe argv encoding.
        const verbatim = rawProperties && process.platform === "win32";
        const argv = verbatim ? [...args.slice(0,-1).map(quoteWindowsArg),args.at(-1)] : args;
        const child = spawn(options.engine,argv,{windowsHide:true,stdio:"ignore",shell:false,windowsVerbatimArguments:verbatim});
        // A first launch can keep running as the engine. Bound the wait without
        // killing that process; readiness is checked using the exact window.
        const timer = setTimeout(resolve,2000);
        child.once("error",error=>{clearTimeout(timer);reject(error);});
        child.once("exit",code=>{clearTimeout(timer);code === 0 ? resolve() : reject(new Error(`Wallpaper Engine ${args[1]} (${code})`));});
      });
      const previous = globalThis.__alunixaXWallpaperScene;
      if (previous?.project === options.project && previous?.sourceId) return JSON.stringify({status:"ok",sourceId:previous.sourceId});
      if (previous) await previous.close();
      const owned = {project:options.project,sourceId:"",close:() => run(["-control","closeWallpaper","-location",options.title]).catch(()=>{})};
      globalThis.__alunixaXWallpaperScene = owned;
      electron.app.once("will-quit",()=>{ void owned.close(); });
      try {
        await run(["-control","openWallpaper","-file",options.project,"-playInWindow",options.title,"-width","1280","-height","720"]);
        if (options.muted) await run(["-control","applyProperties","-location",options.title,"-properties",'RAW~({"volume":0})~END'],true);
        for (let attempt=0;attempt<24;attempt++) {
          const sources = await electron.desktopCapturer.getSources({types:["window"],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
          const source = sources.find(source=>source.name === options.title);
          if (source) {
            owned.sourceId=source.id;
            return JSON.stringify({status:"ok",sourceId:source.id});
          }
          await new Promise(resolve=>setTimeout(resolve,500));
        }
        throw new Error("scene window not found");
      } catch (error) {
        await owned.close();
        if (globalThis.__alunixaXWallpaperScene === owned) delete globalThis.__alunixaXWallpaperScene;
        return JSON.stringify({status:"failed",message:`场景渲染窗口未就绪，请确认 Wallpaper Engine 和项目可播放 (${error?.message || "unknown"})`});
      }
    })()"#.replace("__OPTIONS__", &options.to_string())
}

#[cfg(windows)]
fn send_window_behind(title: &str) {
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
    };
    use windows::core::PCWSTR;
    let title: Vec<u16> = title.encode_utf16().chain(Some(0)).collect();
    unsafe {
        if let Ok(window) = FindWindowW(PCWSTR::null(), PCWSTR(title.as_ptr())) {
            let _ = SetWindowPos(
                window,
                HWND_BOTTOM,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            );
        }
    }
}
#[cfg(not(windows))]
fn send_window_behind(_title: &str) {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scene_never_controls_desktop_or_launches_project_programs() {
        let script = capture_script(
            Path::new("wallpaper64.exe"),
            Path::new("project.json"),
            "unique fixture",
            true,
        );
        assert!(script.contains("shell:false"));
        assert!(script.contains(r#"types:["window"]"#));
        assert!(script.contains(r#""-playInWindow",options.title"#));
        assert!(script.contains(r#""closeWallpaper","-location",options.title"#));
        assert!(!script.contains(r#""-control","stop""#));
        assert!(!script.contains(r#"types:["screen"]"#));
    }
}
