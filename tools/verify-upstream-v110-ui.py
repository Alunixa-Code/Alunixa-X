"""Verify the production manager's new workflows with an in-memory IPC boundary."""
import ast
import importlib.util
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".tmp/upstream-v110-20261020/ui"
OUTPUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("image_ui_fixture", ROOT / "tools/verify-image-models-ui.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
tree = ast.parse((ROOT / "tools/verify-upstream-manager-ui.py").read_text(encoding="utf-8"))
INIT = next(ast.literal_eval(node.value) for node in tree.body
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "INIT"
                                                   for target in node.targets))
INIT = INIT.replace('if(cmd==="list_tools")return ok({tools:[],activeTool:"codex"});',
                    'if(cmd==="list_tools")return ok({tools:[{id:"codex",name:"Codex",switchable:true,homeDir:"fixture",relayCount:3}],activeTool:"codex"});')
INIT = INIT.replace('throw new Error("Unknown fixture: "+cmd);', r'''
 if(cmd==="agent_collaboration_request"){
   const configuration=window.__collaboration || {enabled:false,defaultAgentId:"deepseek",agents:[
    {id:"codex",name:"Codex",executable:"",enabled:false,model:"",reuseSavedAuth:false},
    {id:"deepseek",name:"DeepSeek Harness",executable:"",enabled:false,model:"",reuseSavedAuth:false},
    {id:"claude",name:"Claude Code",executable:"",enabled:false,model:"",reuseSavedAuth:false}]};
   if(args.action==="save_config")window.__collaboration=structuredClone(args.payload);
   return {config:window.__collaboration || configuration,tasks:[],availability:[],
     integration:{status:"not_connected",message:"fixture"}};
 }
 if(cmd==="list_codex_multi_instances")return ok({instances:[]});
 if(cmd==="load_provider_sync_recovery")return ok({recovery:null});
 if(cmd==="list_installed_skills"||cmd==="refresh_skill_catalog")return ok({
   skills:[],repos:[{owner:"fixture",name:"skills",branch:"main",subdir:"",enabled:true}],
   repositorySkills:[],repoCounts:{"fixture/skills@main":0},repoErrors:[],
   skillsDir:"fixture/skills",codexSkillsDir:"fixture/codex/skills"});
 if(cmd==="inspect_skill_repo")return ok({skills:[],count:0});
 throw new Error("Unknown fixture: "+cmd);
''')

with fixture.server_url() as url, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(INIT)
    try:
        page.goto(url, wait_until="networkidle")
        page.get_by_role("button", name="Agent 协作", exact=True).click()
        expect(page.get_by_role("heading", name="子 Agent 设置")).to_be_visible()
        expect(page.get_by_role("checkbox")).to_have_count(5)
        assert not page.get_by_role("checkbox").first.is_checked()
        page.screenshot(path=str(OUTPUT / "collaboration-zh.png"), full_page=True)
        page.set_viewport_size({"width": 960, "height": 720})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(OUTPUT / "collaboration-narrow.png"), full_page=True)

        page.get_by_role("button", name="Codex", exact=True).click()
        page.get_by_role("button", name="供应商配置", exact=True).click()
        card = page.locator('[data-relay-profile-id="Standard"]')
        card.hover()
        card.get_by_title("编辑", exact=True).click()
        page.get_by_role("button", name="添加 Key", exact=True).click()
        keys = page.get_by_placeholder("输入供应商的 API Key")
        expect(keys).to_have_count(2)
        keys.nth(1).fill("fixture-secondary")
        names = page.get_by_placeholder("Key 名称")
        if names.count():
            names.nth(1).fill("Secondary")
        page.get_by_role("button", name="设为当前 Key", exact=True).last.click()
        page.get_by_role("button", name="保存供应商", exact=True).click()
        page.wait_for_function("window.__fixtureSaves.length===1")
        saved = page.evaluate("window.__fixtureSaves[0].relayProfiles.find(p=>p.id==='Standard')")
        assert len(saved["apiKeys"]) == 2
        assert next(key for key in saved["apiKeys"] if key["id"] == saved["activeApiKeyId"])["apiKey"] == "fixture-secondary"
        assert len(page.evaluate("window.__fixtureSettings.relayProfiles")) == 3
        page.screenshot(path=str(OUTPUT / "providers-narrow.png"), full_page=True)

        page.get_by_role("button", name="Skills", exact=True).click()
        page.get_by_role("button", name="管理仓库", exact=True).click()
        expect(page.get_by_role("heading", name="管理 Skills 仓库")).to_be_visible()
        expect(page.get_by_role("heading", name="fixture/skills", exact=True)).to_be_visible()
        page.screenshot(path=str(OUTPUT / "skills-repositories.png"), full_page=True)
        page.keyboard.press("Escape")
        for language in ["en", "ru", "zh"]:
            page.once("dialog", lambda dialog: dialog.accept())
            page.locator(".rail-language-select").select_option(language)
            page.wait_for_load_state("networkidle")
            expect(page.locator(".rail-language-select")).to_have_value(language)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert not errors, errors
        print(json.dumps({"status": "PASS", "checks": [
            "collaboration default off", "collaboration narrow layout", "named key add/select/save",
            "provider list preserved", "Skills repository drawer", "three locales", "no page errors",
        ]}))
    finally:
        browser.close()
