"""Exercise new-provider creation and the restored enhancement inventory without a real backend."""
import ast
import importlib.util
import json
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ui_fixture", ROOT / "tools/verify-image-models-ui.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
tree = ast.parse((ROOT / "tools/verify-upstream-manager-ui.py").read_text(encoding="utf-8"))
init = next(ast.literal_eval(node.value) for node in tree.body
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "INIT" for target in node.targets))
init = init.replace("window.__fixtureSaves=[];", '''
const persisted=window.localStorage.getItem("restored-feature-fixture");
if(persisted)window.__fixtureSettings=JSON.parse(persisted);
window.__fixtureNativeWrites=[];window.__fixtureSaves=[];
''')
init = init.replace("window.__fixtureSaves.push(structuredClone(args.settings));", '''
window.__fixtureNativeWrites.push(args.capabilityWrites || []);
window.localStorage.setItem("restored-feature-fixture",JSON.stringify(args.settings));
window.__fixtureSaves.push(structuredClone(args.settings));
''')
init = init.replace('throw new Error("Unknown fixture: "+cmd);', '''
 if(cmd==="inspect_agent_capabilities")return {
  revision:"1",configPath:"fixture/config.toml",overrides:[],
  entries:["codexAppFastMode","codexGoalsEnabled","codexAppDisableWss","codexAppSubAgentMaxThreads","codexAppPackagedProxyRepair"].map(key=>({
    key,desired:key==="codexAppSubAgentMaxThreads"?6:false,disk:key==="codexAppSubAgentMaxThreads"?6:false,
    state:"saved_pending_restart",source:"fixture",dependency:"fixture",effect:"restart"
  }))
 };
 throw new Error("Unknown fixture: "+cmd);
''')

with fixture.server_url() as url, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 1050})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(init)
        page.goto(url, wait_until="networkidle")
        page.get_by_role("button", name="供应商配置", exact=True).click()
        page.get_by_role("button", name="添加供应商(可自定义)", exact=True).click()
        page.get_by_label("名称", exact=True).fill("Restored advanced supplier")
        page.get_by_label("模型名称", exact=True).fill("claude-restored")
        page.get_by_label("Base URL", exact=True).fill("https://fixture.invalid/claude/v1")
        page.get_by_label("API Key", exact=True).fill("fixture-claude")
        page.get_by_label("模型协议", exact=True).select_option("anthropicMessages")
        page.get_by_label("上下文窗口", exact=True).fill("200000")
        page.get_by_label("自动压缩", exact=True).check()
        page.get_by_label("自动压缩 Token 阈值", exact=True).fill("180000")
        page.get_by_role("button", name="添加模型", exact=True).click()
        page.get_by_label("模型名称", exact=True).nth(1).fill("gemini-restored")
        page.get_by_label("Base URL", exact=True).nth(1).fill("https://fixture.invalid/gemini/v1")
        page.get_by_label("API Key", exact=True).nth(1).fill("fixture-gemini")
        page.get_by_label("模型协议", exact=True).nth(1).select_option("geminiGenerateContent")
        page.get_by_label("上下文窗口", exact=True).nth(1).fill("1000000")
        page.get_by_label("启动模型", exact=True).nth(1).check()
        page.get_by_label("上移模型", exact=True).nth(1).click()
        screenshot = ROOT / ".tmp/restore-features-20261012/advanced-provider.png"
        page.screenshot(path=str(screenshot), full_page=True)
        page.get_by_role("button", name="保存供应商", exact=True).click()
        card = page.locator("[data-relay-profile-id]").filter(has_text="Restored advanced supplier")
        expect(card).to_be_visible()
        saved = page.evaluate("window.__fixtureSaves.at(-1).relayProfiles.find(p=>p.name==='Restored advanced supplier')")
        assert saved["relayMode"] == "customModels"
        assert [model["model"] for model in saved["customModels"]] == ["gemini-restored", "claude-restored"]
        assert saved["customModels"][0]["contextWindow"] == "1000000"
        assert saved["customModels"][1]["contextWindow"] == "200000"
        assert saved["customModels"][0]["protocol"] == "geminiGenerateContent"
        assert saved["customModels"][1]["protocol"] == "anthropicMessages"
        assert saved["customModels"][1]["autoCompactEnabled"] is True
        assert saved["customModels"][1]["autoCompactLimit"] == "180000"
        assert saved["defaultCustomModelId"] == saved["customModels"][0]["id"]
        card.hover()
        card.get_by_title("编辑", exact=True).click()
        expect(page.get_by_label("上下文窗口", exact=True).nth(0)).to_have_value("1000000")
        expect(page.get_by_label("上下文窗口", exact=True).nth(1)).to_have_value("200000")
        expect(page.get_by_label("启动模型", exact=True).nth(0)).to_be_checked()
        page.reload(wait_until="networkidle")
        page.get_by_role("button", name="Codex增强", exact=True).click()
        controls = [
            "会话项目移动", "插件列表全量展示", "Instructions 提示词", "记忆嵌入模型",
            "Responses ID 自动协商", "强制中文界面", "快速启动", "关闭 Codex 自动更新",
            "性能保护", "原生菜单栏位置", "原生菜单汉化", "Zed 项目记录", "Upstream worktree",
            "Fast 模式", "Goals", "禁用 WSS",
        ]
        for label in controls:
            expect(page.get_by_label(label, exact=True)).to_have_count(1)
        page.get_by_label("Instructions 提示词", exact=True).locator("..").click()
        expect(page.get_by_label("Instructions 提示词", exact=True)).to_be_checked()
        page.get_by_label("提示词正文", exact=True).fill("fixture instructions")
        page.get_by_label("记忆嵌入模型", exact=True).locator("..").click()
        page.get_by_label("禁用 WSS", exact=True).locator("..").click()
        page.get_by_label("子代理最大并发数", exact=True).fill("12")
        page.get_by_role("button", name="保存增强设置", exact=True).click()
        settings = page.evaluate("window.__fixtureSaves.at(-1)")
        assert settings["codexAppInstructions"] == "fixture instructions"
        assert settings["codexAppMemoryEmbeddingEnabled"] is True
        assert settings["codexAppDisableWss"] is True
        assert settings["codexAppSubAgentMaxThreads"] == 12
        writes = page.evaluate("window.__fixtureNativeWrites.at(-1)")
        assert set(writes) == {"codexAppDisableWss", "codexAppSubAgentMaxThreads"}, writes
        assert len(settings["relayProfiles"]) == 4, "saving enhancements must preserve every supplier"
        page.screenshot(path=str(ROOT / ".tmp/restore-features-20261012/enhancements-restored.png"), full_page=True)
        assert not errors, errors
        print(json.dumps({"status": "PASS", "checks": [
            "new advanced supplier is reachable", "two independent endpoints/keys/protocols/windows",
            "compression", "ordering", "startup model", "save/reopen/reload",
            "enhancement control inventory", "native write parameters", "no supplier loss",
        ]}))
    finally:
        browser.close()
