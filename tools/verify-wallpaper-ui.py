"""Real Chromium media + Rust streaming, manager UI fixtures, isolated Codex parser.

Build first: cargo build -p alunixa-x-core --example wallpaper_fixture --locked
Run: python tools/verify-wallpaper-ui.py [--codex <installed codex.exe>]
No real settings are loaded or changed; every child process is owned by this script.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
from contextlib import contextmanager
import tempfile

from PIL import Image
from playwright.sync_api import expect, sync_playwright
BASE = runpy.run_path(str(Path(__file__).with_name("verify-image-models-ui.py")))
INIT, server_url = BASE["INIT"], BASE["server_url"]

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "target/debug/examples" / ("wallpaper_fixture.exe" if os.name == "nt" else "wallpaper_fixture")
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


@contextmanager
def media_server(path):
    process = subprocess.Popen([str(FIXTURE), "serve", str(path)], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, creationflags=FLAGS)
    try:
        port = int(process.stdout.readline().strip())
        yield f"http://127.0.0.1:{port}"
    finally:
        process.terminate()
        process.wait(timeout=10)


def verify_parser(codex, root):
    fixtures = [
        "[features]\nguardianv2='invalid'\ngoals=true\n",
        "[features.guardianv2]\nenabled=true\nthread_context='invalid'\n[features.guardianv2.transcript]\ninclude_images=false\nsources=['invalid']\n",
        "[features]\nguardianv2={enabled=false, stale_option=2, transcript={include_images='invalid'}}\n",
    ]
    for index, source in enumerate(fixtures):
        home = root / f"codex-{index}"
        home.mkdir()
        config = home / "config.toml"
        config.write_text(source, encoding="utf-8")
        env = {**os.environ, "CODEX_HOME": str(home)}
        before = subprocess.run([codex, "features", "list"], env=env, capture_output=True, timeout=30, creationflags=FLAGS)
        assert before.returncode != 0 and b"FeatureToml" in before.stderr, before.stderr.decode(errors="replace")
        repair = subprocess.run([str(FIXTURE), "repair", str(home)], capture_output=True, timeout=20, creationflags=FLAGS)
        assert repair.returncode == 0, repair.stderr
        after = subprocess.run([codex, "features", "list"], env=env, capture_output=True, timeout=30, creationflags=FLAGS)
        assert after.returncode == 0, after.stderr.decode(errors="replace")
        backups = list((home / "alunixa-x-config-repair-backups").glob("*.toml"))
        assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == source
    print("INSTALLED_CODEX_PARSER: 3 original FeatureToml failures -> repaired load PASS")


def record_video(page, path):
    encoded = page.evaluate("""async () => {
      const canvas = document.createElement('canvas'); canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');const chunks=[];const stream=canvas.captureStream(24);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
      recorder.ondataavailable=e=>chunks.push(e.data);
      const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
      let frame=0;
      const paint=()=>{ctx.fillStyle='#183b50';ctx.fillRect(0,0,640,360);
        ctx.fillStyle='#e49762';ctx.beginPath();ctx.arc(90+frame*8,190,65,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#ffffff';ctx.font='26px sans-serif';ctx.fillText('LIVE WALLPAPER',34,60);frame++;};
      paint();const timer=setInterval(paint,40);await new Promise(r=>setTimeout(r,1200));
      clearInterval(timer);recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
      const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());
      return btoa(String.fromCharCode(...bytes));
    }""")
    path.write_bytes(base64.b64decode(encoded))


def verify_runtime(browser, url, video_url, gif):
    page = browser.new_page(viewport={"width": 900, "height": 650})
    page.goto(url, wait_until="networkidle")
    page.set_content('<main><input aria-label="underlying input"></main>')
    script = (ROOT / "assets/inject/renderer-inject.js").read_text(encoding="utf-8")
    function = script[script.index("  function installAlunixaXImageOverlay()"):script.index("  function scheduleAlunixaXImageOverlay()")]
    page.evaluate("window.sendAlunixaXDiagnostic=()=>{}; const alunixaXImageOverlayId='alunixa-x-image-overlay';" +
                  function + ";window.installWallpaper=installAlunixaXImageOverlay")

    def apply(config):
        page.evaluate("(config)=>{window.__ALUNIXA_X_IMAGE_OVERLAY__=config;window.installWallpaper();}", config)

    config = dict(enabled=True, kind="video", sourceUrl=video_url, opacity=0.7, fitMode="fill", muted=True, paused=False)
    apply(config)
    page.wait_for_function("document.querySelector('#alunixa-x-image-overlay video')?.currentTime > .12")
    page.get_by_label("underlying input").fill("input still works")
    expect(page.get_by_label("underlying input")).to_have_value("input still works")
    assert page.evaluate("document.querySelector('video').muted && document.querySelector('video').loop")
    page.evaluate("window.originalVideo=document.querySelector('video')")
    apply(config)
    assert page.evaluate("window.originalVideo===document.querySelector('video')")
    apply({**config, "paused": True})
    page.wait_for_timeout(400)
    assert page.evaluate("document.querySelector('video').paused")
    apply({**config, "paused": False})
    page.wait_for_function("document.querySelector('video').currentTime > .15")
    # An actual animated GIF must change pixels; do not count a still preview as success.
    apply(dict(enabled=True, kind="image", dataUrl="data:image/gif;base64," + base64.b64encode(gif.read_bytes()).decode(), opacity=1, fitMode="fill"))
    frames = set()
    for _ in range(5):
        page.wait_for_timeout(130)
        frames.add(hashlib.sha256(page.screenshot()).hexdigest())
    assert len(frames) > 1, "GIF was flattened"
    assert page.locator("video").count() == 0
    apply(dict(enabled=False))
    assert page.locator("#alunixa-x-image-overlay").count() == 0
    assert page.evaluate("!window.__alunixaXWallpaperRuntime")
    page.close()
    print("RENDERER: real WebM decode/time advance/pause/reuse/input/GIF motion/cleanup PASS")


def verify_legacy_preview(browser, root):
    project = root / "legacy-web"
    project.mkdir()
    (project / "project.json").write_text('{"type":"web","file":"index.html","preview":"preview.png"}', encoding="utf-8")
    (project / "index.html").write_text("<script>throw new Error('must not execute')</script>", encoding="utf-8")
    Image.new("RGB", (64, 64), "#4269b5").save(project / "preview.png")
    with media_server(project) as media:
        page = browser.new_page()
        response = page.request.get(media + "/wallpaper/media")
        assert response.ok and response.body() == (project / "preview.png").read_bytes()
        for route in ["/wallpaper/scene", "/wallpaper/web/index.html", "/wallpaper/web/../project.json"]:
            assert page.request.get(media + route).status == 404
        page.close()
    print("LEGACY: preview bytes only; retired scene and script routes return 404 PASS")


def verify_manager(browser, url, video_url, output):
    saved = dict(relayProfiles=[], enhancementsEnabled=True, codexAppImageOverlayEnabled=False,
                 codexAppImageOverlayPath="", codexAppWallpaperMuted=True, codexAppWallpaperPaused=False)
    calls = []
    selected = ["/fixture/clip.webm"]
    fail_import = False

    def boundary(command, args):
        nonlocal saved, fail_import
        calls.append(command)
        if command == "plugin:dialog|open":
            return selected.pop(0) if selected else None
        if command == "load_settings":
            return dict(status="ok", message="", settings=saved, user_scripts=dict(enabled=True, scripts=[]))
        if command == "save_settings":
            saved = copy.deepcopy(args["settings"])
            return dict(status="ok", message="saved fixture", settings=saved, user_scripts=dict(enabled=True, scripts=[]))
        if command == "reset_image_overlay_settings":
            saved.update(codexAppImageOverlayEnabled=False, codexAppImageOverlayPath="", codexAppWallpaperPaused=False)
            return dict(status="ok", message="reset fixture", settings=saved, user_scripts=dict(enabled=True, scripts=[]))
        if command == "repair_codex_feature_config":
            return True
        if command in ("inspect_wallpaper", "import_wallpaper_media"):
            if fail_import:
                fail_import = False
                raise RuntimeError("fixture import failed; previous wallpaper retained")
            path = args["path"]
            if "scene" in path:
                return dict(kind="image", title="Legacy scene preview", path="/fixture/scene/project.json", entry="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", root="/fixture/scene", staticPreview=True)
            return dict(kind="video", title="Live wallpaper demo", path="/fixture/clip.webm", entry=video_url, root="/fixture")
        raise AssertionError(command)

    extra = """
      if(["load_settings","save_settings","reset_image_overlay_settings","inspect_wallpaper","import_wallpaper_media","repair_codex_feature_config","plugin:dialog|open"].includes(cmd))
        return window.wallpaperFixtureCall(cmd,args || {});
      if(cmd==="list_dream_skin_themes")return ok({themes:[],activeDraft:{config:{},imagePath:"",builtin:true}});
      if(cmd==="refresh_dream_skin_community")return ok({items:[],total:0});
    """
    init = INIT.replace('if(cmd==="load_image_models")', extra + 'if(cmd==="load_image_models")')
    page = browser.new_page(viewport={"width": 1440, "height": 1050})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.expose_function("wallpaperFixtureCall", boundary)
    page.add_init_script(init)
    page.goto(url, wait_until="networkidle")
    page.get_by_role("button", name="皮肤管理", exact=True).click()
    region = page.get_by_role("region", name="动态壁纸")
    expect(region).to_be_visible()
    region.get_by_role("button", name="上传壁纸媒体", exact=True).click()
    expect(region.locator("video")).to_have_count(1)
    try:
        page.wait_for_function("document.querySelector('.wallpaper-preview video')?.currentTime > .1")
    except Exception:
        page.screenshot(path=str(output / "wallpaper-ui-failure.png"), full_page=True)
        print("MANAGER_PREVIEW_FAILURE", region.inner_text(), errors)
        print(page.evaluate("""()=>{const v=document.querySelector('.wallpaper-preview video');
          return v && {src:v.src,paused:v.paused,readyState:v.readyState,error:v.error?.message};}"""))
        raise
    region.get_by_role("button", name="暂停视频").click()
    assert region.locator("video").evaluate("(v)=>v.paused")
    region.get_by_role("button", name="继续播放").click()
    region.get_by_role("button", name="保存设置", exact=True).click()
    page.wait_for_timeout(350)
    assert saved["codexAppImageOverlayPath"] == "/fixture/clip.webm"
    assert saved["codexAppWallpaperMuted"]
    # Cancellation and failed import cannot replace or save the existing selection.
    region.get_by_role("button", name="上传壁纸媒体", exact=True).click()
    expect(region.locator("video")).to_have_count(1)
    selected.append("/fixture/bad.mp4")
    fail_import = True
    region.get_by_role("button", name="上传壁纸媒体", exact=True).click()
    expect(region.get_by_role("status")).to_contain_text("fixture import failed")
    assert saved["codexAppImageOverlayPath"] == "/fixture/clip.webm"
    region.get_by_role("button", name="修复对话配置").click()
    expect(region.get_by_role("status")).to_contain_text("配置已备份并修复")
    expect(region.get_by_role("checkbox", name="启用壁纸", exact=True)).to_be_checked()
    expect(region.locator(".toggle-switch-visual")).to_have_count(2)
    page.screenshot(path=str(output / "wallpaper-ui-dark.png"), full_page=True)
    page.get_by_role("button", name="切换到浅色", exact=True).click()
    expect(page.locator("html")).to_have_class(re.compile(r"\blight\b"))
    page.wait_for_timeout(250)
    page.screenshot(path=str(output / "wallpaper-ui-light.png"), full_page=True)
    assert region.get_by_role("button", name="选择项目目录").count() == 0
    assert region.get_by_label("Wallpaper Engine 程序路径").count() == 0
    region.get_by_label("壁纸文件路径", exact=True).fill("/fixture/scene/project.json")
    expect(region.get_by_text("静态预览", exact=True)).to_be_visible()
    expect(region.get_by_text("旧场景只显示预览图片，不运行场景；可上传新图片替换。", exact=True)).to_be_visible()
    assert region.locator("video,iframe").count() == 0
    page.set_viewport_size({"width": 1000, "height": 900})
    assert region.evaluate("(e)=>e.scrollWidth<=e.clientWidth+1")
    region.get_by_role("button", name="重置背景").click()
    expect(region.get_by_text("尚未选择壁纸")).to_be_visible()
    assert not saved["codexAppImageOverlayEnabled"]
    assert not errors, errors
    assert not page.evaluate("window.__unsupportedCommands"), page.evaluate("window.__unsupportedCommands")
    page.close()
    print("MANAGER: import/preview/pause/save/cancel/failure/explicit legacy preview/no engine UI/reset/themes/layout PASS")


def main():
    global FIXTURE
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex")
    args = parser.parse_args()
    assert FIXTURE.exists(), "Build the wallpaper_fixture example first"
    built_fixture = FIXTURE
    output = ROOT / ".tmp"
    with tempfile.TemporaryDirectory(prefix="ax-wallpaper-") as directory:
        root = Path(directory)
        # Do not hold the workspace build artifact open on Windows while this
        # isolated HTTP fixture is running. The owned copy is removed on exit.
        FIXTURE = root / built_fixture.name
        shutil.copy2(built_fixture, FIXTURE)
        if args.codex:
            verify_parser(args.codex, root)
        gif = root / "animation.gif"
        frames = [Image.new("RGB", (64, 64), color) for color in ["#ed7045", "#4269b5"]]
        frames[0].save(gif, save_all=True, append_images=frames[1:], duration=180, loop=0)
        with server_url() as url, sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                generator = browser.new_page()
                clip = root / "motion.webm"
                record_video(generator, clip)
                generator.close()
                with media_server(clip) as media:
                    verify_runtime(browser, url, media + "/wallpaper/media", gif)
                    verify_manager(browser, url, media + "/wallpaper/media", output)
                verify_legacy_preview(browser, root)
            finally:
                browser.close()
    print("WALLPAPER_VERIFICATION=PASS (media and legacy previews; native engine removed)")


if __name__ == "__main__":
    main()
