"""Exercise the production settings transport with two distinct CAS revisions."""
import ast
import importlib.util
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".tmp/upstream-v1101-20261022/ui"
OUTPUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("fixture", ROOT / "tools/verify-image-models-ui.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
tree = ast.parse((ROOT / "tools/verify-upstream-manager-ui.py").read_text(encoding="utf-8"))
INIT = next(ast.literal_eval(node.value) for node in tree.body
            if isinstance(node, ast.Assign) and any(isinstance(item, ast.Name) and item.id == "INIT"
                                                   for item in node.targets))
INIT += r"""
(() => {
 const ok = value => ({status:"ok",message:"saved fixture",...value});
 const inner = window.__TAURI_INTERNALS__.invoke;
 let serial=1;
 window.__transaction="transaction-1";
 window.__fixtureSettings.revision="file-1";
 window.__saveRequests=[];
 window.__pageIdentity=Math.random();
 window.__TAURI_INTERNALS__.invoke=async (cmd,args={})=>{
  if(cmd==="load_settings")return ok({revision:window.__transaction,
    settings:structuredClone(window.__fixtureSettings),user_scripts:{enabled:true,scripts:[]}});
  if(cmd==="save_settings"){
   window.__saveRequests.push(structuredClone(args));
   if(args.expectedRevision!==window.__transaction)return {status:"failed",
    message:"保存设置失败：配置已被其他页面或程序修改，请刷新后重试；未覆盖新配置"};
   if(args.settings.revision!==window.__fixtureSettings.revision)return {status:"failed",
    message:"settings_revision_conflict：设置已被其他操作更新"};
   serial++;
   window.__transaction=`transaction-${serial}`;
   window.__fixtureSettings={...structuredClone(args.settings),revision:`file-${serial}`};
   window.__fixtureSaves.push(structuredClone(window.__fixtureSettings));
   return ok({revision:window.__transaction,settings:structuredClone(window.__fixtureSettings),
    user_scripts:{enabled:true,scripts:[]}});
  }
  if(cmd==="inspect_agent_capabilities")return {revision:"1",configPath:"fixture",entries:[],overrides:[]};
  if(cmd==="load_request_logs")return ok({entries:[]});
  if(cmd==="list_provider_proxy_settings")return ok({profiles:[]});
  return await inner(cmd,args);
 };
})();
"""

with fixture.server_url() as url, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(INIT)
        page.goto(url, wait_until="networkidle")
        page.get_by_role("button", name="Codex增强", exact=True).click()
        checkbox = page.get_by_label("会话项目移动", exact=True)
        initial = checkbox.is_checked()
        checkbox.locator("..").click()
        page.get_by_role("button", name="保存增强设置", exact=True).click()
        page.wait_for_function("window.__fixtureSaves.length===1")
        expect(checkbox).to_be_checked() if not initial else expect(checkbox).not_to_be_checked()
        page.keyboard.press("Escape")
        checkbox.locator("..").click()
        page.get_by_role("button", name="保存增强设置", exact=True).click()
        page.wait_for_function("window.__fixtureSaves.length===2")
        requests = page.evaluate("window.__saveRequests")
        assert [request["expectedRevision"] for request in requests] == ["transaction-1", "transaction-2"]
        assert [request["settings"]["revision"] for request in requests] == ["file-1", "file-2"]
        assert len(page.evaluate("window.__fixtureSettings.relayProfiles")) == 3

        page.keyboard.press("Escape")
        page.get_by_label("Instructions 提示词", exact=True).locator("..").click()
        page.get_by_label("提示词正文", exact=True).fill("draft survives conflict and language changes")
        identity = page.evaluate("window.__pageIdentity")
        for locale in ["en", "ru", "zh"]:
            page.locator(".rail-language-select").select_option(locale)
            assert page.evaluate("window.__pageIdentity") == identity
        page.wait_for_function("""() => [...document.querySelectorAll('textarea')].some(
            node => node.value === 'draft survives conflict and language changes')""")
        page.evaluate("""() => {
          window.__transaction="external-transaction";
          window.__fixtureSettings.revision="external-file";
        }""")
        page.get_by_role("button", name="保存增强设置", exact=True).click()
        page.get_by_text("配置已被其他页面或程序修改", exact=False).wait_for()
        page.wait_for_function("""() => [...document.querySelectorAll('textarea')].some(
            node => node.value === 'draft survives conflict and language changes')""")
        assert len(page.evaluate("window.__fixtureSaves")) == 2
        assert page.evaluate("window.__fixtureSettings.revision") == "external-file"
        assert len(page.evaluate("window.__saveRequests")) == 3, "must not silently retry a conflict"
        page.screenshot(path=str(OUTPUT / "save-conflict-preserves-draft.png"), full_page=True)
        assert not errors, errors
        print(json.dumps({"status": "PASS", "checks": [
            "first save", "second save", "distinct CAS revisions", "three providers retained",
            "three languages without reload", "draft retained", "real conflict rejected without retry",
            "no page errors",
        ]}))
    finally:
        browser.close()
