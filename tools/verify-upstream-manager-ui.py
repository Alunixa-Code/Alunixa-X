import importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('smoke',str(ROOT/'tools/verify-image-models-ui.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from playwright.sync_api import sync_playwright, expect
INIT=r'''(()=>{
 const ok=(payload={})=>({status:"ok",message:"fixture",...payload});
 const profile=(id,mode)=>({id,name:id,relayMode:mode,providerName:"Fixture",protocol:"responses",baseUrl:"https://fixture.invalid/v1",upstreamBaseUrl:"https://fixture.invalid/v1",apiKey:"fixture-only",model:"claude-opus",modelList:"claude-opus\ngemini-pro\nglm-5\ndeepseek\ngrok",modelProtocols:"{}",modelWindows:"{}",modelAutoCompact:"{}",configContents:"model = 'claude-opus'\nmodel_provider = 'fixture'\n[model_providers.fixture]\nbase_url = 'https://fixture.invalid/v1'\nwire_api = 'responses'\n",authContents:'{"OPENAI_API_KEY":"fixture-only"}',defaultCustomModelId:"one",customModels:mode==="customModels"?[{id:"one",model:"custom-one",baseUrl:"https://fixture.invalid/v1",apiKey:"fixture-only",protocol:"responses",contextWindow:"64000",autoCompactEnabled:false,autoCompactLimit:""}]:[]});
 window.__fixtureSettings={activeTool:"codex",activeRelayId:"active",relayProfilesEnabled:true,enhancementsEnabled:true,relayProfiles:[profile("active","pureApi"),profile("Standard","pureApi"),profile("Custom","customModels")]};
 window.__fixtureSaves=[];window.__fixtureCommands=[];window.__fixtureFail=false;
 window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:x=>x,async invoke(cmd,args={}){
 window.__fixtureCommands.push(cmd);
 if(cmd==="load_settings")return ok({settings:structuredClone(window.__fixtureSettings),revision:"1",user_scripts:{enabled:true,scripts:[]}});
 if(cmd==="save_settings"){if(window.__fixtureFail){window.__fixtureFail=false;throw new Error("fixture save failed");}window.__fixtureSaves.push(structuredClone(args.settings));window.__fixtureSettings=structuredClone(args.settings);return ok({settings:structuredClone(args.settings),revision:"2",user_scripts:{enabled:true,scripts:[]}});}
 if(cmd==="weixin_connect_status")return ok({enabled:false});
 if(cmd==="load_ccs_providers")return ok({providers:[]});
 if(cmd==="list_tools")return ok({tools:[],activeTool:"codex"});
 if(cmd==="consume_pending_manager_navigation")return null;
 if(cmd==="load_overview")return ok({current_version:"1.0.36",codex_app:{status:"not_checked"},silent_shortcut:{status:"not_checked"},management_shortcut:{status:"not_checked"}});
 if(cmd==="read_relay_files")return ok({configContents:window.__fixtureSettings.relayProfiles[0].configContents,authContents:'{}',configPath:"fixture/config.toml",authPath:"fixture/auth.json",revision:"1"});
 if(cmd==="relay_status")return ok({configured:true,authenticated:true});
 if(cmd==="list_codex_context_entries")return ok({mcpServers:[],skills:[],plugins:[]});
 if(cmd==="builtin_model_metadata_index")return {entries:[]};
 if(cmd==="query_builtin_model_metadata")return {matched:false};
 if(cmd==="check_env_conflicts")return ok({conflicts:[]});
 if(cmd==="startup_options")return ok({showUpdate:false});
 if(cmd==="check_update")return ok({currentVersion:"1.0.36",latestVersion:"1.0.36",updateAvailable:false});
 if(cmd==="load_provider_sync_targets")return ok({targets:[]});
 if(cmd==="load_pending_provider_import")return ok({pending:null});
 if(cmd==="load_pending_dream_skin_community")return ok({versionId:""});
 if(cmd==="plugin:event|listen")return 1;
 if(cmd==="read_latest_logs")return ok({logs:[]});
 if(cmd==="copy_diagnostics")return ok({text:"fixture"});
 if(cmd==="remote_plugin_marketplace_status")return ok({codexHome:"fixture",configRegistered:true,needsRepair:false,pluginCount:0,skillCount:0});
 if(cmd==="write_diagnostic_event"||cmd==="plugin:event|unlisten"||cmd==="update_tray_labels")return ok();
 throw new Error("Unknown fixture: "+cmd);
 }};
})();'''

with m.server_url() as url,sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 try:
  page=b.new_page(viewport={'width':1440,'height':1000});errors=[]
  page.on('pageerror',lambda error: errors.append(str(error)))
  page.add_init_script(INIT);page.goto(url,wait_until='networkidle')
  def edit(name):
   page.get_by_role('button',name='供应商配置',exact=True).click()
   card=page.locator('[data-relay-profile-id="'+name+'"]');
   if card.count()==0:page.get_by_role('tab',name='需协议转换',exact=True).click()
   card.hover();card.get_by_title('编辑',exact=True).click()
  edit('Standard')
  protocols=['anthropicMessages','geminiGenerateContent','chatCompletions','completions','responses']
  rows=page.get_by_label('模型协议',exact=True);expect(rows).to_have_count(5)
  for i,protocol in enumerate(protocols):rows.nth(i).select_option(protocol)
  page.get_by_label('模型最高思考等级',exact=True).first.select_option('adaptive')
  assert page.get_by_label('模型最高思考等级',exact=True).nth(1).locator('option[value="adaptive"]').is_disabled()
  page.get_by_label('上下文窗口',exact=True).first.fill('200000')
  page.get_by_role('button',name='保存供应商',exact=True).click()
  page.wait_for_function('window.__fixtureSaves.length===1')
  saved=page.evaluate('window.__fixtureSaves.at(-1).relayProfiles.find(p=>p.id==="Standard")')
  assert list(json.loads(saved['modelProtocols']).values())==protocols
  assert saved['modelReasoningEfforts']['claude-opus']=='adaptive'
  assert json.loads(saved['modelWindows'])['claude-opus']=='200000'
  assert len(page.evaluate('window.__fixtureSettings.relayProfiles'))==3
  edit('Standard')
  expect(rows.first).to_have_value('anthropicMessages')
  page.evaluate('window.__fixtureFail=true');rows.first.select_option('chatCompletions')
  page.get_by_role('button',name='保存供应商',exact=True).click()
  page.get_by_text('fixture save failed',exact=False).wait_for()
  assert len(page.evaluate('window.__fixtureSaves'))==1
  assert json.loads(page.evaluate('window.__fixtureSettings.relayProfiles.find(p=>p.id==="Standard").modelProtocols'))['claude-opus']=='anthropicMessages'
  page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='返回列表',exact=True).click()
  edit('Custom')
  custom=page.locator('.relay-custom-model');expect(custom).to_have_count(1)
  custom.get_by_label('模型协议',exact=True).select_option('geminiGenerateContent')
  custom.get_by_label('模型名称',exact=True).fill('custom-renamed')
  page.get_by_role('button',name='保存供应商',exact=True).click();page.wait_for_function('window.__fixtureSaves.length===2')
  saved=page.evaluate('window.__fixtureSaves.at(-1).relayProfiles.find(p=>p.id==="Custom")')
  assert saved['relayMode']=='customModels'
  assert saved['customModels'][0]['model']=='custom-renamed'
  assert saved['customModels'][0]['protocol']=='geminiGenerateContent'
  assert saved['customModels'][0]['apiKey']=='fixture-only'
  page.get_by_role('button',name='MCP',exact=True).click();expect(page.get_by_role('heading',name='MCP',exact=True).first).to_be_visible()
  assert not page.locator('[class*="sponsor-board"],[class*="ad-list"]').count()
  for language in ['en','ru','zh']:
   page.once('dialog',lambda d:d.accept());page.locator('.rail-language-select').select_option(language)
   page.wait_for_load_state('networkidle');expect(page.locator('.rail-language-select')).to_have_value(language)
   page.set_viewport_size({'width':960,'height':720})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),language
   page.screenshot(path=str(m.ROOT/'.tmp/upstream-20261011'/('manager-'+language+'.png')),full_page=True)
  assert not errors,errors
  print(json.dumps({'status':'PASS','checks':['five per-model protocols','Claude adaptive gate','context save','save failure persistence','custom-model protocol/name/key save','MCP navigation','three locales','minimum window','no advertising']},ensure_ascii=False))
 finally:b.close()

