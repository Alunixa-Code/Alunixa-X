"""Headless production-UI check with an in-memory Tauri boundary; no live Codex."""
import json
import sys
from playwright.sync_api import sync_playwright


INIT = r"""
(() => {
  const model = (id, window, limit) => ({id, model:id, baseUrl:"https://fixture.invalid/v1",
    apiKey:"fixture-only", protocol:"responses", contextWindow:window,
    autoCompactEnabled:true, autoCompactLimit:limit});
  let settings = {codexAppPath:"", relayProfilesEnabled:true, enhancementsEnabled:true,
    activeRelayId:"fixture", relayCommonConfigContents:"", relayContextConfigContents:"",
    relayProfiles:[{id:"fixture",name:"Context fixture",relayMode:"customModels",
      lastUsedModel:"small",defaultCustomModelId:"small",model:"small",
      contextWindow:"272000",autoCompactEnabled:true,autoCompactLimit:"271000",
      configContents:"model = 'small'\nmodel_context_window = 272000\nmodel_auto_compact_token_limit = 271000\n",
      authContents:"{}",customModels:[model("small","272000","271000"),model("large","1050000","1000000")]}]};
  let live = settings.relayProfiles[0].configContents;
  const inventory = {enabled:true,scripts:[]};
  const ok = (payload={}) => ({status:"ok",message:"fixture",...payload});
  window.__contextSaves = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: x => x,
    async invoke(cmd,args) {
      if(cmd==="load_settings")return ok({settings:structuredClone(settings),user_scripts:inventory});
      if(cmd==="read_relay_files")return ok({configContents:live,authContents:"{}",configPath:"fixture/config.toml",authPath:"fixture/auth.json"});
      if(cmd==="relay_status")return ok({configured:true,authenticated:false});
      if(cmd==="switch_relay_profile"){
        window.__contextSaves.push(structuredClone(args.request));
        settings=structuredClone(args.request.settings);
        const p=settings.relayProfiles.find(p=>p.id===settings.activeRelayId);
        const selected=p.customModels.find(m=>m.model===p.lastUsedModel)||p.customModels[0];
        live=`model = "${selected.model}"\nmodel_context_window = ${selected.contextWindow}\nmodel_auto_compact_token_limit = ${selected.autoCompactLimit}\n`;
        return ok({settings,settingsPath:"fixture/settings.json",relay:{configured:true},user_scripts:inventory});
      }
      if(cmd==="load_overview")return ok({current_version:"1.0.17",codex_app:{status:"not_checked"},
        silent_shortcut:{status:"not_checked"},management_shortcut:{status:"not_checked"}});
      if(cmd==="list_codex_context_entries")return ok({mcpServers:[],skills:[],plugins:[]});
      if(cmd==="detect_env_conflicts")return ok({conflicts:[]});
      if(cmd==="plugin:event|listen")return 1;
      if(cmd==="write_diagnostic_event"||cmd==="plugin:event|unlisten")return ok();
      throw new Error("Isolated fixture: unsupported "+cmd);
    }
  };
})();
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(INIT)
        page.goto(sys.argv[1], wait_until="networkidle")
        page.get_by_role("button", name="供应商配置", exact=True).click()
        page.get_by_text("Context fixture", exact=True).first.click()
        selector = page.get_by_role("combobox", name="启动模型", exact=True)
        selector.wait_for()
        selector.select_option("large")
        block = page.locator(".custom-model-sortable").nth(1)
        block.locator("input").nth(3).fill("1200000")
        block.locator("input[type=number]").fill("1100000")
        page.locator(".relay-file-textarea").first.click()
        preview = page.locator(".relay-file-textarea").first.input_value()
        assert "model_context_window = 1200000" in preview, preview
        assert "model_auto_compact_token_limit = 1100000" in preview, preview
        page.get_by_role("button", name="保存", exact=True).click()
        page.wait_for_function("window.__contextSaves.length === 1")
        request = page.evaluate("window.__contextSaves[0]")
        saved = request["settings"]["relayProfiles"][0]
        assert saved["lastUsedModel"] == "large"
        assert saved["customModels"][1]["contextWindow"] == "1200000"
        assert saved["customModels"][1]["autoCompactLimit"] == "1100000"
        assert saved["customModels"][0]["contextWindow"] == "272000"
        assert request["previousActiveRelayId"] == "fixture"
        assert not errors, errors
        print(json.dumps({"status": "PASS", "productionUI": True,
                          "explicitSelection": True, "previewMatchesDraft": True,
                          "submittedEditedValues": True, "tauriBoundary": "mocked",
                          "liveCodexAccessed": False}))
    finally:
        browser.close()
