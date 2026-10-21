import assert from "node:assert/strict";
// Run from the repository root: node scripts/test-skills-repository-browser.mjs <release-executable>
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile, readFile, readdir, lstat, unlink, rmdir, copyFile, chmod, symlink } from "node:fs/promises";
import path from "node:path";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = path.resolve(process.env.TEMP, `codex-repo-browser-${Date.now()}`);
const output = path.resolve("output/playwright");
const report = { state, checks: {}, cleanup: false };
const executable = path.resolve(process.argv[2]);
const home = path.join(state, "home");
await mkdir(home, { recursive: true });
await mkdir(output, { recursive: true });
const names = ["openai/skills", "anthropics/skills", "ComposioHQ/awesome-claude-skills", "cexll/myclaude", "Yuan1z0825/nature-skills"];
const repos = names.map((name) => {
  const [owner, repository] = name.split("/");
  return { owner, name: repository, branch: name.startsWith("ComposioHQ") || name.startsWith("cexll") ? "master" : "main", subdir: "", enabled: true };
});
await writeFile(path.join(state, "skills.json"), JSON.stringify({ repos, installed: {} }));
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const env = { ...process.env, CODEX_HOME: home, ALUNIXA_X_STATE_DIR: state,
  ALUNIXA_X_MANAGER_GUARD_PORT: String(await port()),
  ALUNIXA_X_PROTOCOL_PROXY_PORT: String(await port()), WEBVIEW2_USER_DATA_FOLDER: path.join(state, "webview") };
for (const key of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(key)) delete env[key];
const debugPort = await port();
env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${debugPort}`;
delete env.ALUNIXA_X_GUARD_PORT;
env.ALUNIXA_X_LAUNCHER_GUARD_PORT = String(await port());
await writeFile(path.join(state, "latest-status.json"), JSON.stringify({
  status: "stopped", message: "Isolated test", started_at_ms: 0,
  debug_port: await port(), helper_port: await port(), codex_app: null, aumid: null,
}));
const bin = path.join(state, "bin");
await mkdir(bin);
await copyFile(executable, path.join(bin, path.basename(executable)));
for (const name of await readdir(path.dirname(executable))) if (name.endsWith(".dll")) await copyFile(path.join(path.dirname(executable), name), path.join(bin, name));
let child, socket, evaluate, cdp;
async function stop() {
  socket?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await Promise.race([done, wait(5000)]);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  }
}
async function launch() {
  child = spawn(path.join(bin, path.basename(executable)), [], { env, windowsHide: true, stdio: "ignore" });
  let target;
  for (let i = 0; i < 180; i++) {
    if (child.exitCode !== null) throw Error(`manager exited ${child.exitCode}`);
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page"); } catch {}
    if (target) break;
    await wait(250);
  }
  assert.ok(target, "native WebView starts");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message); pending.delete(message.id);
  };
  cdp = async (method, params = {}) => {
    const id = ++serial;
    let timer;
    const result = new Promise((resolve, reject) => {
      pending.set(id, resolve);
      timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 300000);
    });
    socket.send(JSON.stringify({ id, method, params }));
    try { const response = await result; if (response.error) throw Error(JSON.stringify(response.error)); return response.result; }
    finally { clearTimeout(timer); }
  };
  evaluate = async (expression) => {
    const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await until("!!window.__TAURI_INTERNALS__?.invoke && document.body.innerText.length>20", "ready");
}
async function invoke(command, args = {}) {
  return evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
}
async function until(expression, label, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await wait(250);
  }
  throw Error(`timeout ${label}`);
}
async function click(text, scope = "document") {
  const found = await evaluate(`(() => { const b=[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled); b?.click();return !!b; })()`);
  assert.ok(found, `button ${text}`);
  await wait(150);
}
async function fill(selector, value) {
  await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(120);
}
async function screenshot(name) {
  const result = await cdp("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(output, name), Buffer.from(result.data, "base64"));
}
async function cleanup(entry) {
  assert.ok(entry === state || entry.startsWith(state + path.sep));
  const info = await lstat(entry).catch(() => null);
  if (!info) return;
  if (!info.isDirectory() || info.isSymbolicLink()) return unlink(entry);
  for (const name of await readdir(entry)) await cleanup(path.join(entry, name));
  await rmdir(entry);
}
try {
  await launch();
  await evaluate(`(() => {
    const original=window.fetch.bind(window);
    window.__skillsTest={hold:true,refresh:[],inspections:[],original};
    window.fetch=(input,options)=>{
      const test=window.__skillsTest;
      const command=String(input).split('/').at(-1);
      if(test.hold && (command==='refresh_skill_catalog'||command==='inspect_skill_repo')) {
        return new Promise((resolve,reject)=>{
          const queue=command==='refresh_skill_catalog'?test.refresh:test.inspections;
          queue.push(()=>original(input,options).then(resolve,reject));
        });
      }
      return original(input,options);
    };
  })()`);
  await click("Skills");
  await until("!!document.querySelector('.mg-skills-page')", "Skills page");
  await until("window.__skillsTest.refresh.length===1", "initial refresh pending");
  await click("管理仓库");
  await until("window.__skillsTest.inspections.length===1", "initial repository inspection pending");
  assert.ok(await evaluate("[...document.querySelectorAll('.mg-repo-select')].every(b=>!b.disabled)"), "first-load sidebar is interactive");
  for (const repo of repos.slice(1)) {
    const latency = await evaluate(`new Promise(resolve=>{
      const started=performance.now();
      [...document.querySelectorAll('.mg-repo-select')].find(b=>b.textContent.includes(${JSON.stringify(`${repo.owner}/${repo.name}`)})).click();
      requestAnimationFrame(()=>resolve({ms:performance.now()-started,title:document.querySelector('.mg-repo-detail-head h3').textContent}));
    })`);
    assert.equal(latency.title, `${repo.owner}/${repo.name}`);
    assert.ok(latency.ms < 300, `repository responds in next frame (${latency.ms}ms)`);
    report.checks[`pending${repo.owner}Switch`] = latency;
  }
  // 先放行已切走的仓库；它的结果不能覆盖当前选择。
  await evaluate("window.__skillsTest.inspections.shift()();void 0");
  await until("document.querySelector('.mg-repo-sidebar .mg-repo-select')?.textContent.includes('44 Skills')", "stale real inspection completed", 180000);
  assert.equal(await evaluate("document.querySelector('.mg-repo-detail-head h3').textContent"), "Yuan1z0825/nature-skills");
  report.checks.staleInspectionPreservesSelection = true;
  await evaluate("document.querySelector('.mg-drawer>header button[aria-label=\"关闭窗口\"]').click()");
  assert.equal(await evaluate("!!document.querySelector('.mg-repo-workspace')"), false);
  report.checks.closeDuringFirstLoad = true;
  await evaluate("window.__skillsTest.hold=false;window.__skillsTest.refresh.splice(0).forEach(run=>run());window.__skillsTest.inspections.splice(0).forEach(run=>run());void 0");
  await until("document.querySelector('.mg-skills-page .mg-header-actions button')?.disabled===false", "initial automatic catalog", 300000);
  let catalog = await invoke("list_installed_skills");
  report.counts = catalog.repoCounts;
  report.errors = await evaluate("[...document.querySelectorAll('.mg-warning p')].map(e=>e.textContent)");
  console.log(JSON.stringify({ counts: report.counts, errors: report.errors }));
  for (const repo of repos) {
    const matches = Object.entries(catalog.repoCounts).filter(([key]) => key.startsWith(`${repo.owner}/${repo.name}@`));
    assert.equal(matches.length, 1, `${repo.owner} scanned`);
    assert.ok(matches[0][1] > 0, `${repo.owner} nonzero skills`);
    assert.equal(catalog.repositorySkills.filter((s) => s.repoKey === matches[0][0]).length, matches[0][1]);
  }
  assert.ok(await evaluate("document.querySelectorAll('.mg-skill-row').length>0 && document.querySelectorAll('.mg-skill-row').length<40"), "discover mounts only visible rows");
  report.checks.autoDiscoverFiveRepos = true;
  await click("管理仓库");
  await until("!!document.querySelector('.mg-repo-workspace')", "wide repository browser");
  await evaluate("document.documentElement.classList.remove('light');document.documentElement.classList.add('dark')");
  const geometry = await evaluate("({drawer:document.querySelector('.mg-drawer').getBoundingClientRect().width,height:document.querySelector('.mg-drawer').getBoundingClientRect().height,viewport:innerWidth,viewportHeight:innerHeight,rowHeight:document.querySelector('.mg-repo-row').getBoundingClientRect().height})");
  assert.ok(Math.abs(geometry.drawer - geometry.viewport) < 2);
  assert.ok(Math.abs(geometry.height - geometry.viewportHeight) < 2);
  assert.ok(geometry.rowHeight <= 66);
  report.checks.wideGeometry = geometry;
  assert.ok(await evaluate("!document.querySelector('.mg-drawer>footer') && Math.abs(document.querySelector('.mg-repo-workspace').getBoundingClientRect().bottom-innerHeight)<2"));
  report.checks.noRedundantFooter = true;
  await evaluate("document.querySelector('.mg-drawer-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
  assert.equal(await evaluate("!!document.querySelector('.mg-repo-workspace')"), true);
  report.checks.backdropPreservesDrawer = true;
  for (const repo of repos) {
    await evaluate(`([...document.querySelectorAll('.mg-repo-select')].find(b=>b.textContent.includes(${JSON.stringify(`${repo.owner}/${repo.name}`)}))).click()`);
    await wait(150);
    const shown = await evaluate("({title:document.querySelector('.mg-repo-detail-head h3').textContent,count:document.querySelector('.mg-repo-count').textContent,rows:document.querySelectorAll('.mg-repo-skill').length,total:Number(document.querySelector('.mg-repo-results').dataset.total)})");
    assert.ok(shown.rows > 0);
    assert.equal(Number(shown.count.split(" ")[0]), shown.total);
    assert.ok(shown.rows < 40);
    report.checks[`${repo.owner}Browser`] = shown;
    if (repo.owner==="ComposioHQ") {
      report.checks.largeCatalogMountedRows = shown.rows;
      await evaluate("document.querySelector('.mg-repo-results').scrollTop=999999");
      await wait(100);
      assert.equal(await evaluate("[...document.querySelectorAll('.mg-repo-skill .mg-skill-name strong')].at(-1)?.textContent"), catalog.repositorySkills.filter(s=>s.repoKey.startsWith("ComposioHQ/")).at(-1).name);
      report.checks.largeCatalogLastRowReachable = true;
      const switchLatency = await evaluate(`new Promise(resolve=>{
        const started=performance.now();
        document.querySelector('.mg-repo-select').click();
        requestAnimationFrame(()=>resolve({ms:performance.now()-started,title:document.querySelector('.mg-repo-detail-head h3').textContent}));
      })`);
      assert.equal(switchLatency.title,"openai/skills");
      assert.ok(switchLatency.ms<300);
      report.checks.switchAwayFromLargeCatalog = switchLatency;
    }
  }
  await fill(".mg-repo-browser .mg-search input", "nature-figure");
  assert.equal(await evaluate("document.querySelectorAll('.mg-repo-skill').length"), 1);
  await fill(".mg-repo-browser .mg-search input", "");
  report.checks.repositorySearch = true;
  await screenshot("skills-repository-browser.png");
  report.checks.darkDivider = await evaluate("({divider:getComputedStyle(document.querySelector('.mg-repo-sidebar')).borderRightColor,background:getComputedStyle(document.querySelector('.mg-repo-browser')).backgroundColor,text:getComputedStyle(document.querySelector('.mg-repo-browser')).color})");
  await evaluate("document.documentElement.classList.remove('dark');document.documentElement.classList.add('light')");
  await wait(250);
  await screenshot("skills-repository-browser-light.png");
  await evaluate("document.documentElement.classList.remove('light');document.documentElement.classList.add('dark')");
  await wait(250);
  await cdp("Emulation.setDeviceMetricsOverride", { width:720, height:900, deviceScaleFactor:1, mobile:false });
  await wait(200);
  assert.ok(await evaluate("document.querySelector('.mg-drawer').scrollWidth<=document.querySelector('.mg-drawer').clientWidth+1"));
  assert.ok(await evaluate("document.querySelector('.mg-repo-browser').scrollWidth<=document.querySelector('.mg-repo-browser').clientWidth+1"));
  await screenshot("skills-repository-browser-720.png");
  await cdp("Emulation.clearDeviceMetricsOverride");
  report.checks.narrowLayoutNoOverflow = true;
  await evaluate("document.querySelector('.mg-repo-browser .mg-skill-name').click()");
  await until("!!document.querySelector('.mg-skill-repo-link')", "skill repository source link");
  assert.ok(await evaluate("!!document.querySelector('.mg-repo-workspace') && document.querySelectorAll('.mg-drawer').length===2"), "detail overlays retained workspace");
  assert.ok(await evaluate("[...document.querySelectorAll('.mg-detail .mg-link-button')].some(e=>e.textContent.includes('https://github.com/'))"));
  await evaluate("document.querySelector('.mg-skill-repo-link').click()");
  await until("document.querySelectorAll('.mg-drawer').length===1", "source closes only details");
  await until("document.querySelector('.mg-repo-detail-head h3')?.textContent==='Yuan1z0825/nature-skills'", "source goes to repository");
  report.checks.skillSourceNavigation = true;
  await fill(".mg-repo-browser .mg-search input", "nature");
  await evaluate("document.querySelector('.mg-repo-results').scrollTop=300");
  await wait(120);
  const preserved = await evaluate("({top:document.querySelector('.mg-repo-results').scrollTop,query:document.querySelector('.mg-repo-browser .mg-search input').value,title:document.querySelector('.mg-repo-detail-head h3').textContent})");
  await evaluate("document.querySelector('.mg-repo-skill .mg-skill-name').click()");
  await until("document.querySelectorAll('.mg-drawer').length===2", "nested detail opens");
  await screenshot("skills-repository-nested-detail.png");
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await until("document.querySelectorAll('.mg-drawer').length===1", "Escape only closes top detail");
  assert.deepEqual(await evaluate("({top:document.querySelector('.mg-repo-results').scrollTop,query:document.querySelector('.mg-repo-browser .mg-search input').value,title:document.querySelector('.mg-repo-detail-head h3').textContent})"), preserved);
  report.checks.detailRetainsSearchScrollSelection = preserved;
  await fill(".mg-repo-browser .mg-search input", "");
  await cdp("Emulation.setDeviceMetricsOverride", { width:900, height:600, deviceScaleFactor:1, mobile:false });
  await evaluate("document.querySelector('.mg-repo-sidebar').scrollTop=9999;document.querySelector('.mg-repo-sidebar .mg-repo-row:last-child button[title=\"编辑仓库\"]').click()");
  await until("!!document.querySelector('.mg-repo-form') && document.querySelector('.mg-repo-form').contains(document.activeElement)", "edit focus");
  const editorGeometry = await evaluate("(() => {const rect=document.querySelector('.mg-repo-form').getBoundingClientRect(); const footer=document.querySelector('.mg-repo-form-footer').getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,footerBottom:footer.bottom,height:innerHeight,outerScroll:document.querySelector('.mg-drawer-body').scrollTop};})()");
  assert.ok(editorGeometry.top >= 0 && editorGeometry.bottom <= editorGeometry.height && editorGeometry.footerBottom <= editorGeometry.height);
  assert.equal(editorGeometry.outerScroll, 0);
  await screenshot("skills-repository-editor-dark.png");
  await evaluate("document.querySelector('.mg-repo-form input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.ok(await evaluate("!document.querySelector('.mg-repo-form')&&!!document.querySelector('.mg-repo-workspace')"));
  report.checks.pinnedEditPanel = editorGeometry;
  await cdp("Emulation.clearDeviceMetricsOverride");
  await evaluate("document.querySelector('.mg-repo-sidebar .mg-repo-manager-head .mg-icon-button').click()");
  assert.ok(await evaluate("document.querySelector('.mg-repo-form').getBoundingClientRect().bottom<=innerHeight"));
  report.checks.pinnedAddPanel = true;
  await fill(".mg-repo-quick input", "https://github.com/openai/skills/tree/main/skills/.system");
  await click("解析", "document.querySelector('.mg-repo-form')");
  await until("document.querySelector('.mg-repo-count')?.textContent.includes('Skills') && document.querySelectorAll('.mg-repo-skill').length>0 && !document.querySelector('.mg-repo-quick button').disabled", "live parse preview", 180000);
  const previewCount = await evaluate("document.querySelectorAll('.mg-repo-skill').length");
  assert.ok(previewCount > 0);
  report.checks.livePreviewCount = previewCount;
  await click("添加仓库", "document.querySelector('.mg-repo-form')");
  await until("!document.querySelector('.mg-repo-form')", "saved preview", 180000);
  await evaluate("([...document.querySelectorAll('[role=dialog] button')].find(b=>['确定','知道了'].includes(b.textContent.trim())))?.click()");
  catalog = await invoke("list_installed_skills");
  assert.equal(catalog.repoCounts["openai/skills@main:skills/.system"], previewCount);
  report.checks.savePublishesSkills = true;
  await fill(".mg-repo-browser .mg-search input", "skill-creator");
  await click("安装", "document.querySelector('.mg-repo-browser')");
  await until("[...document.querySelectorAll('.mg-repo-browser .mg-repo-install-state')].some(e=>e.textContent==='已安装')", "installed badge updates", 180000);
  const installed = (await invoke("list_installed_skills")).skills.find(s=>s.repoPath==="skills/.system/skill-creator" && s.installed);
  assert.ok(installed && installed.enabled);
  report.checks.nativeRepositoryInstall = true;
  await fill(".mg-repo-browser .mg-search input", "");
  const columns = await evaluate("([...document.querySelectorAll('.mg-repo-skill')].map(row=>{const detail=row.querySelector('.mg-repo-skill-actions>.mg-button').getBoundingClientRect();const install=row.querySelector('.mg-repo-install-slot>*').getBoundingClientRect();return {details:detail.x,install:install.x,width:install.width,installed:!!row.querySelector('.mg-repo-install-state')};}))");
  assert.ok(columns.some(c=>c.installed) && columns.some(c=>!c.installed));
  for (const row of columns) {
    assert.ok(Math.abs(row.details-columns[0].details)<1);
    assert.ok(Math.abs(row.install-columns[0].install)<1);
    assert.ok(Math.abs(row.width-columns[0].width)<1);
  }
  report.checks.alignedInstalledActions = columns;
  await screenshot("skills-repository-aligned-actions.png");
  await evaluate("document.querySelector('.mg-repo-sidebar .mg-repo-row:last-child .mg-switch').click()");
  await until("!document.querySelector('.mg-repo-sidebar .mg-repo-row:last-child .mg-switch').classList.contains('is-on')", "disable repository", 180000);
  assert.equal(await evaluate("document.querySelectorAll('.mg-repo-skill').length"), previewCount);
  assert.equal((await invoke("list_installed_skills")).repoCounts["openai/skills@main:skills/.system"], previewCount);
  report.checks.disabledRepositoryStillBrowsable = true;
  await screenshot("skills-repository-preview-saved.png");
  const invalid = await invoke("upsert_skill_repo", { repo: { owner:"codex-skill-verification-nonexistent", name:"absent-repository-20261016", branch:"main",subdir:"",enabled:true } });
  assert.equal(invalid.status, "failed");
  assert.ok(!JSON.parse(await readFile(path.join(state,"skills.json"),"utf8")).repos.some(r=>r.owner==="codex-skill-verification-nonexistent"));
  report.checks.invalidSaveRejected = true;
  const expected = Object.values(catalog.repoCounts).reduce((a,b)=>a+b,0);
  await stop();
  await wait(1200);
  await launch();
  const restored = await invoke("list_installed_skills");
  assert.equal(Object.values(restored.repoCounts).reduce((a,b)=>a+b,0), expected);
  assert.ok(restored.skills.length>10);
  report.checks.persistedAfterRestart = expected;
  const updateTarget = restored.skills.find(s=>s.installed && s.repoPath==="skills/.system/skill-creator");
  assert.ok(updateTarget);
  const updatedManifest = path.join(home,"skills",updateTarget.id,"SKILL.md");
  await writeFile(updatedManifest, (await readFile(updatedManifest,"utf8"))+"\nlocal-update-regression-marker\n");
  assert.equal((await invoke("update_skill", {repoKey:updateTarget.repoKey,id:updateTarget.id})).status,"ok");
  assert.ok(!(await readFile(updatedManifest,"utf8")).includes("local-update-regression-marker"));
  const updateBackups = (await invoke("list_installed_skills")).backups.filter(b=>b.skillId===updateTarget.id);
  const backupContents = await Promise.all(updateBackups.map(b=>readFile(path.join(state,"skill-backups",b.id,"SKILL.md"),"utf8")));
  assert.ok(backupContents.some(content=>content.includes("local-update-regression-marker")));
  report.checks.updatePreservesLocalEditsInBackups = true;
  const local = path.join(home, "skills", "local-uninstall-regression");
  await mkdir(local, { recursive: true });
  await writeFile(path.join(local, "SKILL.md"), "user original content");
  assert.ok((await invoke("list_installed_skills")).skills.some(s=>s.id==="local-uninstall-regression" && s.installed));
  assert.equal((await invoke("uninstall_skill", { id:"local-uninstall-regression" })).status, "ok");
  const backup = (await invoke("list_installed_skills")).backups.find(b=>b.skillId==="local-uninstall-regression");
  assert.ok(backup);
  const restoreStateFile = path.join(state,"skills.json");
  const beforeRestoreFailure = await readFile(restoreStateFile,"utf8");
  try {
    await chmod(restoreStateFile, 0o444);
    assert.equal((await invoke("restore_skill_backup", { backupId:backup.id })).status, "failed");
    assert.equal(await readFile(path.join(state,"skill-backups",backup.id,"SKILL.md"),"utf8"), "user original content");
    assert.equal(await readFile(restoreStateFile,"utf8"), beforeRestoreFailure);
    assert.ok((await invoke("list_installed_skills")).backups.some(b=>b.id===backup.id));
  } finally { await chmod(restoreStateFile, 0o666); }
  await mkdir(local);
  await writeFile(path.join(local,"notes.txt"), "keep local notes");
  assert.equal((await invoke("restore_skill_backup", { backupId:backup.id })).status, "failed");
  assert.equal(await readFile(path.join(local,"notes.txt"),"utf8"), "keep local notes");
  await unlink(path.join(local,"notes.txt"));
  await rmdir(local);
  report.checks.restoreFailuresPreserveBackupAndLocalContent = true;
  assert.equal((await invoke("restore_skill_backup", { backupId:backup.id })).status, "ok");
  assert.equal(await readFile(path.join(local,"SKILL.md"),"utf8"), "user original content");
  report.checks.localUninstallRestoresOriginal = true;
  await writeFile(path.join(local,"SKILL.md"), "local disable edits");
  assert.equal((await invoke("set_skill_enabled", {id:"local-uninstall-regression",enabled:false})).status,"ok");
  assert.equal(await readFile(path.join(state,"skills","local-uninstall-regression","SKILL.md"),"utf8"),"local disable edits");
  assert.equal((await invoke("set_skill_enabled", {id:"local-uninstall-regression",enabled:true})).status,"ok");
  assert.equal(await readFile(path.join(local,"SKILL.md"),"utf8"),"local disable edits");
  report.checks.disableReenablePreservesLocalEdits = true;
  const stateFile = path.join(state,"skills.json");
  const rollbackLocal = path.join(home,"skills","local-disable-rollback");
  await mkdir(rollbackLocal);
  await writeFile(path.join(rollbackLocal,"SKILL.md"), "original unmanaged content");
  const beforeFailure = await readFile(stateFile,"utf8");
  try {
    await chmod(stateFile, 0o444);
    assert.equal((await invoke("set_skill_enabled", {id:"local-disable-rollback",enabled:false})).status,"failed");
    assert.equal(await readFile(path.join(rollbackLocal,"SKILL.md"),"utf8"),"original unmanaged content");
    assert.ok((await invoke("list_installed_skills")).skills.some(s=>s.id==="local-disable-rollback" && s.installed && s.enabled));
    assert.equal((await invoke("uninstall_skill", {id:"local-uninstall-regression"})).status,"failed");
    assert.equal(await readFile(path.join(local,"SKILL.md"),"utf8"),"local disable edits");
    assert.equal(await readFile(stateFile,"utf8"),beforeFailure);
  } finally { await chmod(stateFile, 0o666); }
  report.checks.stateWriteFailuresRestoreDirectories = true;
  const externalSkill = path.join(state,"external-skill");
  await mkdir(externalSkill);
  await writeFile(path.join(externalSkill,"SKILL.md"),"external skill content");
  const externalLink = path.join(home,"skills","external-link");
  await symlink(externalSkill,externalLink,"junction");
  assert.equal((await invoke("set_skill_enabled",{id:"external-link",enabled:false})).status,"ok");
  assert.ok((await invoke("list_installed_skills")).skills.some(s=>s.id==="external-link" && s.installed && !s.enabled));
  assert.equal((await invoke("set_skill_enabled",{id:"external-link",enabled:true})).status,"ok");
  assert.equal(await readFile(path.join(externalLink,"SKILL.md"),"utf8"),"external skill content");
  assert.equal(await readFile(path.join(externalSkill,"SKILL.md"),"utf8"),"external skill content");
  report.checks.externalLinkDisableReenable = true;
  const savedState = JSON.parse(await readFile(path.join(state,"skills.json"),"utf8"));
  const absent = { owner:"codex-skill-verification-nonexistent",name:"absent-repository-20261016",branch:"main",subdir:"",enabled:true };
  savedState.repos.push(absent);
  await writeFile(path.join(state,"skills.json"), JSON.stringify(savedState));
  const startToggle = performance.now();
  assert.equal((await invoke("upsert_skill_repo",{repo:{...absent,enabled:false}})).status,"ok");
  assert.ok(performance.now()-startToggle < 3000);
  assert.equal(JSON.parse(await readFile(path.join(state,"skills.json"),"utf8")).repos.find(r=>r.owner===absent.owner).enabled,false);
  report.checks.inaccessibleRepositoryCanDisable = true;
  console.log("Native repository checks passed.");
} catch (error) {
  report.error = String(error.stack || error); process.exitCode = 1;
  if (evaluate) { report.diagnostic = await evaluate("document.querySelector('.mg-drawer')?.innerText || document.body.innerText.slice(-4000)").catch(()=>null); await screenshot("skills-repository-failure.png").catch(()=>{}); }
} finally {
  await stop();
  for (let i=0;i<30;i++) {
    try { await cleanup(state); report.cleanup=true; break; }
    catch(error) { if(i===29) report.cleanupError=String(error); await wait(300); }
  }
  await writeFile(path.join(output,"skills-repository-browser.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
