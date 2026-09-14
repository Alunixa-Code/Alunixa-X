"""Production frontend smoke test with an isolated, in-memory Tauri boundary."""
import copy
import json
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
INIT = r"""
(() => {
  const ok = (payload={}) => ({status:"ok",message:"fixture",...payload});
  window.__imageSaveCalls = 0;
  window.__imageFailNext = false;
  window.__otherSaves = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: x => x,
    async invoke(cmd,args) {
      if(cmd==="load_image_models") return window.fixtureImageCall(cmd, args || {});
      if(cmd==="save_image_models") {
        window.__imageSaveCalls++;
        if(window.__imageFailNext){window.__imageFailNext=false;throw "fixture save failed";}
        return window.fixtureImageCall(cmd,args);
      }
      if(cmd==="save_settings"){window.__otherSaves++;throw "unexpected general settings save";}
      if(cmd==="load_settings")return ok({settings:{codexAppPath:"",relayProfiles:[],enhancementsEnabled:true},user_scripts:{enabled:true,scripts:[]}});
      if(cmd==="load_overview")return ok({current_version:"1.0.18",codex_app:{status:"not_checked"},
        silent_shortcut:{status:"not_checked"},management_shortcut:{status:"not_checked"}});
      if(cmd==="read_relay_files")return ok({configContents:"",authContents:"{}",configPath:"fixture/config.toml",authPath:"fixture/auth.json"});
      if(cmd==="relay_status")return ok({configured:false,authenticated:false});
      if(cmd==="list_codex_context_entries")return ok({mcpServers:[],skills:[],plugins:[]});
      if(cmd==="detect_env_conflicts")return ok({conflicts:[]});
      if(cmd==="startup_options")return ok({showUpdate:false});
      if(cmd==="check_update")return ok({currentVersion:"1.0.18",latestVersion:"1.0.18",hasUpdate:false});
      if(cmd==="load_provider_sync_targets")return ok({targets:[]});
      if(cmd==="load_pending_provider_import")return ok({pending:null});
      if(cmd==="load_pending_dream_skin_community")return ok({versionId:""});
      if(cmd==="remote_plugin_marketplace_status")return ok({codexHome:"fixture",configRegistered:true,needsRepair:false,pluginCount:0,skillCount:0});
      if(cmd==="plugin:event|listen")return 1;
      if(cmd==="write_diagnostic_event"||cmd==="plugin:event|unlisten")return ok();
      throw new Error("Isolated fixture: unsupported "+cmd);
    }
  };
})();
"""


@contextmanager
def server_url():
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(QuietHandler, directory=str(ROOT / "apps/alunixa-x-manager/dist")),
    )
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def main():
    models = [
        dict(id="a", name="日常插画", model="image-a", baseUrl="https://a.example.invalid/v1", apiKey="fixture-key-a"),
        dict(id="b", name="设计渲染", model="image-b", baseUrl="https://b.example.invalid/v1", apiKey="fixture-key-b"),
    ]
    revision = 1

    def fixture_call(command, args):
        nonlocal models, revision
        if command == "save_image_models":
            assert args["revision"] == str(revision), "stale revision"
            old = {model["id"]: model for model in models}
            updated = []
            for edit in args["models"]:
                model = copy.deepcopy(edit)
                model["apiKey"] = edit["apiKey"] or old[edit["id"]]["apiKey"]
                updated.append(model)
            models = updated
            revision += 1
        return dict(
            revision=str(revision),
            models=[{**{key: value for key, value in model.items() if key != "apiKey"}, "hasApiKey": True} for model in models],
        )

    with server_url() as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.expose_function("fixtureImageCall", fixture_call)
            page.add_init_script(INIT)
            page.goto(url, wait_until="networkidle")
            page.get_by_role("button", name="生图模型", exact=True).click()
            rows = page.locator("[data-image-model-id]")
            expect(rows).to_have_count(2)
            expect(rows.first).to_have_attribute("data-image-model-id", "a")
            expect(rows.first.get_by_text("默认", exact=True)).to_be_visible()

            # Real pointer drag: second row becomes the persisted default.
            start = page.get_by_role("button", name="拖动生图模型 设计渲染").bounding_box()
            end = page.get_by_role("button", name="拖动生图模型 日常插画").bounding_box()
            page.mouse.move(start["x"] + start["width"] / 2, start["y"] + start["height"] / 2)
            page.mouse.down()
            page.mouse.move(start["x"] + 20, start["y"] - 12, steps=3)
            page.mouse.move(end["x"] + end["width"] / 2, end["y"] + end["height"] / 2, steps=12)
            page.mouse.up()
            expect(rows.first).to_have_attribute("data-image-model-id", "b")
            assert models[0]["id"] == "b"
            expect(rows.first.get_by_text("默认", exact=True)).to_be_visible()

            # Keyboard dragging also persists and never mutates keys by position.
            handle = page.get_by_role("button", name="拖动生图模型 设计渲染")
            expect(handle).to_be_enabled()
            page.evaluate("""async () => {
              const animations = [...document.querySelectorAll('[data-image-model-id]')]
                .flatMap(row => row.getAnimations());
              await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }""")
            handle.focus()
            expect(handle).to_be_focused()
            page.keyboard.press("Space")
            expect(handle).to_have_attribute("aria-pressed", "true")
            # dnd-kit measures droppables on activation and attaches its key listener on a timer.
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            page.keyboard.press("ArrowDown")
            page.wait_for_function("""() => {
              const row = document.querySelector('[data-image-model-id="b"]');
              return Math.abs(new DOMMatrix(row.style.transform).m42) > 10;
            }""")
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            page.keyboard.press("Space")
            expect(rows.first).to_have_attribute("data-image-model-id", "a")
            assert [model["apiKey"] for model in models] == ["fixture-key-a", "fixture-key-b"]

            # Failed order saves leave the previous default visible and on disk.
            page.evaluate("window.__imageFailNext = true")
            rows.nth(1).get_by_role("button", name="上移", exact=True).click()
            expect(page.get_by_role("alert")).to_have_text("fixture save failed")
            expect(rows.first).to_have_attribute("data-image-model-id", "a")
            assert models[0]["id"] == "a"

            # Edit the second row without re-entering its key.
            rows.nth(1).get_by_role("button", name="编辑", exact=True).click()
            expect(page.locator("#image-model-key")).to_have_value("")
            expect(page.locator("#image-model-key")).to_have_attribute("type", "password")
            page.get_by_label("名称（可选）", exact=True).fill("产品视觉")
            page.get_by_label("Model", exact=True).fill("image-b-edited")
            page.get_by_role("button", name="保存生图模型", exact=True).click()
            expect(page.get_by_role("form", name="生图模型编辑")).to_have_count(0)
            assert models[1]["model"] == "image-b-edited"
            assert models[1]["apiKey"] == "fixture-key-b"

            # Add appends; it must not steal the default from the first row.
            page.get_by_role("button", name="添加生图模型", exact=True).click()
            page.get_by_label("名称（可选）", exact=True).fill("图片编辑")
            page.get_by_label("Model", exact=True).fill("image-edit")
            page.get_by_label("API 地址", exact=True).fill("https://edit.example.invalid/v1")
            page.get_by_label("API Key", exact=True).fill("fixture-key-edit")
            page.get_by_role("button", name="保存生图模型", exact=True).click()
            expect(rows).to_have_count(3)
            assert models[-1]["model"] == "image-edit"
            assert models[0]["id"] == "a"
            assert "fixture-key" not in page.locator(".image-model-list").inner_text()

            # Reload simulates a new window against the persisted fixture backend.
            page.reload(wait_until="networkidle")
            page.get_by_role("button", name="生图模型", exact=True).click()
            expect(rows).to_have_count(3)
            assert rows.nth(1).get_by_text("产品视觉", exact=True).is_visible()

            # Guard unsaved edits when changing pages and when refreshing.
            rows.first.get_by_role("button", name="编辑", exact=True).click()
            page.get_by_label("名称（可选）", exact=True).fill("未保存编辑")
            page.get_by_role("button", name="供应商配置", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible()
            page.get_by_role("button", name="继续编辑", exact=True).click()
            expect(page.get_by_label("名称（可选）", exact=True)).to_have_value("未保存编辑")
            page.get_by_role("button", name="刷新当前页面", exact=True).click()
            page.get_by_role("button", name="放弃编辑", exact=True).click()
            expect(page.get_by_role("form", name="生图模型编辑")).to_have_count(0)
            expect(rows).to_have_count(3)
            expect(rows.first.get_by_text("默认", exact=True)).to_be_visible()
            assert models[0]["name"] == "日常插画"

            page.screenshot(path=str(ROOT / ".tmp/image-models-ui-dark.png"), full_page=True)
            page.get_by_role("button", name="切换到浅色", exact=True).click()
            page.set_viewport_size({"width": 960, "height": 720})
            page.screenshot(path=str(ROOT / ".tmp/image-models-ui-light.png"), full_page=True)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal overflow"

            # Delete default promotes the next; deleting all restores fallback.
            while models:
                old_count = len(models)
                rows.first.get_by_role("button", name="删除", exact=True).click()
                page.get_by_role("button", name="确认删除", exact=True).click()
                expect(rows).to_have_count(old_count - 1)
                if models:
                    expect(rows.first.get_by_text("默认", exact=True)).to_be_visible()
            expect(page.get_by_text("还没有独立的生图模型", exact=True)).to_be_visible()
            assert page.evaluate("window.__otherSaves") == 0
            assert not errors, errors
            print(json.dumps({"status": "PASS", "checks": [
                "pointer drag", "keyboard drag", "persisted default", "masked keys",
                "failed save rollback", "add/edit/delete", "reload persistence",
                "navigation guard", "dark/light minimum window", "no general settings writes",
            ]}, ensure_ascii=False))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
