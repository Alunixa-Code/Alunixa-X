"""Isolated production UI checks; no real configuration, registry, or desktop mutation."""
import runpy
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = runpy.run_path(str(Path(__file__).with_name("verify-image-models-ui.py")))
INIT = BASE["INIT"] + r"""
(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  let revision = 'r1', fast = true, goals = true, settings = {codexAppPath:'',relayProfiles:[],enhancementsEnabled:true,codexAppPackagedProxyRepair:true,codexAppFastMode:false,codexGoalsEnabled:false};
  window.__lastSave = null;
  window.__saveFail = false; window.__proxyState = 'dead_loopback'; window.__proxyWrites = 0;
  window.__external = false; window.__auditFail = false;
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if(cmd==='load_settings') return {status:'ok',settings,revision,user_scripts:{scripts:[]}};
    if(cmd==='save_settings') {
      window.__lastSave = args;
      if(window.__saveFail || window.__external || args.expectedRevision!==revision)
        return {status:'failed',message:'fixture write failed',settings,revision,user_scripts:{scripts:[]}};
      if(args.capabilityWrites?.includes('codexAppFastMode')) fast=args.settings.codexAppFastMode;
      if(args.capabilityWrites?.includes('codexGoalsEnabled')) goals=args.settings.codexGoalsEnabled;
      settings=args.settings; revision+='x';
      return {status:'ok',message:'已保存，待重启生效',settings,revision,user_scripts:{scripts:[]}};
    }
    if(cmd==='inspect_runtime_health') return {helper:'unavailable',renderer:'unverified',modelRequest:'not_tested',reason:'fixture: original UI not ready'};
    if(cmd==='inspect_agent_capabilities') {
      if(window.__auditFail) throw new Error('fixture cannot parse config');
      return {revision:window.__external?'external':revision,configPath:'fixture/config.toml',cliPath:'fixture/codex',
        scope:'global_profile_only_runtime_unknown',overrides:['environment: CODEX_HOME'],entries:[
        {key:'codexAppFastMode',desired:settings.codexAppFastMode,disk:fast,state:fast===settings.codexAppFastMode?'saved_pending_restart':'different',source:'config.toml / CLI default',dependency:'fast_mode',effect:'restart'},
        {key:'codexGoalsEnabled',desired:settings.codexGoalsEnabled,disk:goals,state:window.__goalsUnsupported?'unsupported':goals===settings.codexGoalsEnabled?'saved_pending_restart':'different',source:'config.toml / CLI default',dependency:'goals',effect:'restart'},
        {key:'zedRemoteSyncToZedSettings',desired:true,disk:null,state:'unsupported',source:'settings',dependency:'not implemented',effect:'unknown'}]};
    }
    if(cmd==='packaged_proxy_action') {
      if(args.action==='repair') {
        if(window.__proxyState!=='dead_loopback')throw new Error('repair must be guarded');
        window.__proxyWrites++; window.__proxyState='disabled';
      }
      return {status:'ok',message:'fixture '+window.__proxyState,repaired:args.action==='repair',
        restartRequired:args.action==='repair',backupId:window.__proxyWrites?'fixture-backup':null,
        host:{enabled:0,state:'disabled'},
        packaged:{package:'OpenAI.Codex_fixture',enabled:window.__proxyState==='disabled'?0:1,state:window.__proxyState,revision:'p1',viewId:'0123456789abcdef',loopbackEndpoints:[]}};
    }
    return original(cmd,args);
  };
})();
"""


def main():
    with BASE["server_url"]() as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            source = (ROOT / "crates/alunixa-x-core/src/runtime_health.rs").read_text(encoding="utf-8")
            health_script = re.search(r'pub const RENDERER_HEALTH_SCRIPT: &str = r#"(.*?)"#;', source, re.S)[1]
            probe = browser.new_page()
            probe.set_content('<div id="root"><div role="progressbar">Loading</div></div>')
            probe.evaluate("window.electronBridge = {}")
            assert probe.evaluate(health_script)["hasNativeSurface"] is False
            assert probe.evaluate(health_script)["loading"] is True
            probe.locator("#root").evaluate("""root => {
                root.innerHTML = '<div id="alunixa-menu"><main><div contenteditable="true">AX overlay</div></main></div>';
            }""")
            assert probe.evaluate(health_script)["hasNativeSurface"] is False
            probe.locator("#root").evaluate("""root => {
                root.innerHTML = '<main><div class="ProseMirror" contenteditable="true">Native editor</div></main>';
            }""")
            assert probe.evaluate(health_script)["hasNativeSurface"] is True
            probe.locator("main").evaluate("node => node.style.display = 'none'")
            assert probe.evaluate(health_script)["hasNativeSurface"] is False
            probe.close()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script(INIT)
            page.goto(url, wait_until="networkidle")
            expect(page.locator(".ax-readiness strong")).to_have_text("0/2")
            expect(page.locator(".ax-readiness")).to_contain_text("not_tested")
            page.locator(".nav").get_by_role("button", name="Agent 能力", exact=True).click()
            panel = page.locator(".agent-health-panel")
            expect(panel.get_by_text("与磁盘不一致", exact=True).first).to_be_visible()
            expect(panel.get_by_text("不支持/未实现", exact=True)).to_be_visible()
            fast_row = page.locator(".feature-toggle").filter(has=page.locator("strong").get_by_text("Fast 模式", exact=True))
            fast = fast_row.get_by_role("checkbox")
            # AX's persisted intent is false, but the installed CLI default is on.
            expect(fast).to_be_checked()
            page.evaluate("window.__saveFail = true")
            fast_row.click()
            page.get_by_role("button", name="保存增强设置", exact=True).click()
            expect(fast).to_be_checked()
            assert "codexAppFastMode" in page.evaluate("window.__lastSave.capabilityWrites")
            page.evaluate("window.__saveFail = false")
            fast_row.click()
            page.get_by_role("button", name="保存增强设置", exact=True).click()
            expect(panel.get_by_text("已保存，待重启生效", exact=True)).to_be_visible()
            expect(fast).not_to_be_checked()
            auto = panel.get_by_role("checkbox")
            expect(auto).to_be_checked()
            goals_row = page.locator(".feature-toggle").filter(has=page.locator("strong").get_by_text("Goals", exact=True))
            goals = goals_row.get_by_role("checkbox")
            expect(goals).to_be_checked()
            goals_row.click()
            auto.uncheck()
            page.wait_for_function("window.__lastSave?.settings.codexAppPackagedProxyRepair === false")
            assert "codexGoalsEnabled" in page.evaluate("window.__lastSave.capabilityWrites")
            expect(goals).not_to_be_checked()
            # The immediate save of another switch must also persist the pending Goals edit.
            panel.get_by_role("button", name="重新检测", exact=True).click()
            expect(panel.locator("tr").filter(has_text="codexGoalsEnabled")).to_contain_text("已保存，待重启生效")
            auto.check()
            expect(auto).to_be_checked()
            page.evaluate("window.__goalsUnsupported = true")
            panel.get_by_role("button", name="重新检测", exact=True).click()
            expect(goals).to_be_disabled()
            page.evaluate("window.__saveFail = true")
            auto.click()
            expect(auto).to_be_checked()
            expect(page.get_by_text("fixture write failed", exact=True)).to_be_visible()
            page.evaluate("window.__saveFail = false")
            auto.uncheck()
            expect(auto).not_to_be_checked()
            panel.get_by_role("button", name="检查代理", exact=True).click()
            repair = panel.get_by_role("button", name="备份并修复", exact=True)
            expect(repair).to_be_enabled()
            repair.click()
            expect(panel.get_by_text("需要重新启动相关 Codex 进程", exact=True)).to_be_visible()
            expect(repair).to_be_disabled()
            assert page.evaluate("window.__proxyWrites") == 1
            for state in ["reachable_loopback", "pac_configured", "external_proxy", "disabled"]:
                page.evaluate("(state) => window.__proxyState = state", state)
                panel.get_by_role("button", name="检查代理", exact=True).click()
                expect(panel.get_by_text("fixture " + state, exact=True)).to_be_visible()
                expect(repair).to_be_disabled()
            page.evaluate("window.__external = true")
            panel.get_by_role("button", name="重新检测", exact=True).click()
            expect(panel.get_by_text("检测到外部配置变化，请刷新设置后再保存", exact=False)).to_be_visible()
            expect(fast).to_be_disabled()
            panel.get_by_role("button", name="重新检测", exact=True).click()
            expect(fast).to_be_disabled()
            page.set_viewport_size({"width": 980, "height": 760})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            page.screenshot(path=str(ROOT / ".tmp" / "agent-health-compact.png"), full_page=True)
            page.evaluate("window.__auditFail = true")
            panel.get_by_role("button", name="重新检测", exact=True).click()
            expect(panel.get_by_text("检测失败，状态未知", exact=True)).to_be_visible()
            expect(panel.locator("table")).to_have_count(0)
            assert not errors, errors
            print("AGENT_HEALTH_UI_PASS: native DOM vs spinner/overlay/hidden, false readiness, Fast/Goals disk defaults, pending native edit across immediate save, unsupported Goals, failed-save rollback, persistent stale revision, proxy gating, unknown, compact")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
