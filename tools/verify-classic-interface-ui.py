"""Verify the classic manager shell and responsive forms using production assets only."""
import ast
import importlib.util
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".tmp/classic-ui-restart-20261023/ui"
OUTPUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("fixture", ROOT / "tools/verify-image-models-ui.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
tree = ast.parse((ROOT / "tools/verify-upstream-manager-ui.py").read_text(encoding="utf-8"))
INIT = next(ast.literal_eval(node.value) for node in tree.body
            if isinstance(node, ast.Assign) and any(isinstance(item, ast.Name) and item.id == "INIT"
                                                   for item in node.targets))
INIT += """
(() => {
 const inner=window.__TAURI_INTERNALS__.invoke;
 window.__TAURI_INTERNALS__.invoke=async (command,args={}) => {
  if(command==="inspect_agent_capabilities")return {revision:"1",configPath:"fixture",entries:[],overrides:[]};
  if(command==="load_request_logs")return {status:"ok",entries:[]};
  if(command==="list_provider_proxy_settings")return {status:"ok",profiles:[]};
  return inner(command,args);
 };
})();
"""


with fixture.server_url() as url, sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(INIT)
        page.goto(url, wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        assert page.evaluate("getComputedStyle(document.body).fontFamily").startswith("Inter")
        page.screenshot(path=str(OUTPUT / "classic-overview.png"), full_page=True)
        page.get_by_role("button", name="供应商配置", exact=True).click()
        card = page.locator('[data-relay-profile-id="Standard"]')
        if not card.count():
            page.get_by_role("tab", name="需协议转换", exact=True).click()
        card.hover()
        card.get_by_title("编辑", exact=True).click()
        rows = page.locator(".relay-model-row:not(.relay-model-row-head)")
        expect(rows).to_have_count(5)
        for width in [1440, 1180, 960]:
            page.set_viewport_size({"width": width, "height": 820})
            protocols = page.get_by_label("模型协议", exact=True)
            expect(protocols).to_have_count(5)
            expect(protocols.first).to_be_visible()
            expect(page.get_by_label("上下文窗口", exact=True).first).to_be_visible()
            geometry = rows.first.evaluate("""node => {
              const names=['name','protocol','window','compact','image','reasoning'];
              return names.map(name=>{
                const cell=node.querySelector('.relay-model-cell-'+name), r=cell.getBoundingClientRect();
                return {name,x:r.x,y:r.y,w:r.width,h:r.height};
              });
            }""")
            for i, left in enumerate(geometry):
                assert left["w"] > 10 and left["h"] > 10, (width, geometry)
                for right in geometry[i + 1:]:
                    overlap_x = min(left["x"] + left["w"], right["x"] + right["w"]) - max(left["x"], right["x"])
                    overlap_y = min(left["y"] + left["h"], right["y"] + right["h"]) - max(left["y"], right["y"])
                    assert overlap_x < 1 or overlap_y < 1, (width, left, right)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            rows.first.scroll_into_view_if_needed()
            page.screenshot(path=str(OUTPUT / f"classic-models-{width}.png"), full_page=True)
        page.get_by_role("button", name="返回列表", exact=True).click()
        for label in ["Skills", "会话管理", "Agent 增强"]:
            button = page.get_by_role("button", name=label, exact=True)
            if not button.count() and label == "Agent 增强":
                button = page.get_by_role("button", name="Codex增强", exact=True)
            button.click()
            page.wait_for_timeout(100)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), label
            page.screenshot(path=str(OUTPUT / f"classic-{label}.png"), full_page=True)
        assert not errors, errors
        print(json.dumps({"status": "PASS", "checks": [
            "classic offline font", "classic shell", "five per-model protocols",
            "context and reasoning controls", "no field overlap at 1440/1180/960",
            "Skills/session/enhancement pages", "no document overflow", "no page errors",
        ]}, ensure_ascii=False))
    finally:
        browser.close()
