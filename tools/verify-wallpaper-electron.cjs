// Actual Electron + product Rust CDP bridge, with host-equivalent strict CSP.
// Run with a standalone Electron binary, never the user's running Codex:
// electron tools/verify-wallpaper-electron.cjs --fixture <exe> --output <dir>
// Optional --scene <project.json> --engine <wallpaper64.exe> uses one owned
// uniquely named native window and closes only that location in finally.
const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const inspector = require("node:inspector");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const argv = process.argv.slice(2);
const option = key => argv[argv.indexOf(key) + 1];
const fixture = option("--fixture");
const output = path.resolve(option("--output"));
assert(fixture && argv.includes("--output"), "explicit --fixture and --output required");
fs.mkdirSync(output, { recursive: true });
const work = fs.mkdtempSync(path.join(output, "electron-run-"));
fs.mkdirSync(path.join(work, "profile"));
app.setPath("userData", path.join(work, "profile"));
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
protocol.registerSchemesAsPrivileged([{
  scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);
// Deliberately no bypassCSP, webSecurity:false, unsafe-eval, loopback sources,
// permission overrides, or replacement protocol handler for the media.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'";
const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body style="margin:0;background:#14243c"><main><input aria-label="underlying input"></main></body></html>`;
const windows = new Set();
const children = new Set();
app.on("window-all-closed", () => {}); // Each case owns a fresh isolated window.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 18000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await delay(120);
  }
  throw new Error(`timed out: ${label}`);
}
function run(exe, args) {
  const result = spawnSync(exe, args, { windowsHide: true, encoding: "utf8", timeout: 90000 });
  assert.equal(result.status, 0, `${exe}: ${result.stderr}`);
  return result.stdout;
}
function makeMedia() {
  run("python", ["-c", `
from PIL import Image
from pathlib import Path
import random,sys
p=Path(sys.argv[1])
Image.new("RGB",(640,360),(18,141,118)).save(p/"still.png")
Image.frombytes("RGB",(2500,2500),random.Random(13).randbytes(2500*2500*3)).save(p/"large.png")
a=Image.new("RGB",(640,360),(210,42,73));b=Image.new("RGB",(640,360),(25,161,117))
a.save(p/"animated.gif",save_all=True,append_images=[b],duration=180,loop=0)
a.save(p/"animated.apng",save_all=True,append_images=[b],duration=180,loop=0)
`, work]);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=960x540:rate=24,noise=alls=25:allf=t", "-t", "4",
    "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv420p",
    "-an", path.join(work, "seek.mp4")]);
  assert(fs.statSync(path.join(work, "seek.mp4")).size > 4 * 1024 * 1024, "must cross media chunk");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "testsrc2=size=320x180:rate=12", "-t", "1.5", "-c:v", "libvpx-vp9",
    "-deadline", "realtime", "-cpu-used", "8", "-an", path.join(work, "loop.webm")]);
  const web = path.join(work, "web");
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, "project.json"), JSON.stringify({ type: "web", file: "index.html" }));
  fs.writeFileSync(path.join(web, "data.json"), '{"local":true}');
  fs.writeFileSync(path.join(web, "script.js"), `
    (async()=>{
      let parentBlocked=false, helperBlocked=false;
      try { parent.document.body; } catch { parentBlocked=true; }
      try { await fetch("app://-/_alunixa-x-wallpaper/scene"); } catch { helperBlocked=true; }
      const data=await fetch("./data.json").then(r=>r.json());
      parent.postMessage({fixtureWeb:true,parentBlocked,helperBlocked,local:data.local},"*");
    })();
  `);
  fs.writeFileSync(path.join(web, "index.html"), '<body style="background:#216e85"><script src="./script.js"></script></body>');
  const weVideo = path.join(work, "project.json");
  fs.writeFileSync(weVideo, JSON.stringify({ type: "video", file: "loop.webm" }));
}
async function open(source, extra = {}) {
  const w = new BrowserWindow({ show: false, width: 960, height: 640,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  windows.add(w);
  const network = [];
  w.webContents.on("console-message", (_event, details, oldMessage) => {
    network.push(details?.message || oldMessage || String(details));
  });
  await w.loadURL("app://-/index.html");
  await w.webContents.executeJavaScript(`
    window.webResult=null;window.addEventListener("message",e=>{if(e.data?.fixtureWeb)window.webResult=e.data});
    window.fixtureCsp=[];window.addEventListener("securitypolicyviolation",e=>window.fixtureCsp.push(e.violatedDirective));
  `);
  const activePort = Number(fs.readFileSync(path.join(work, "profile", "DevToolsActivePort"), "utf8").split("\n")[0]);
  const targets = await fetch(`http://127.0.0.1:${activePort}/json/list`).then(r => r.json());
  const target = targets.find(t => t.id === String(w.webContents.id)) ||
    targets.find(t => t.type === "page" && t.url === "app://-/index.html");
  assert(target?.webSocketDebuggerUrl);
  const configPath = path.join(work, `attach-${w.id}.json`);
  fs.writeFileSync(configPath, JSON.stringify({ websocketUrl: target.webSocketDebuggerUrl, path: source, ...extra }));
  const child = spawn(fixture, ["attach", configPath], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", value => { stdout += value; });
  child.stderr.on("data", value => { stderr += value; });
  await until(() => {
    assert(child.exitCode === null, `bridge exited: ${stderr}`);
    return stdout.includes("READY");
  }, "product bridge ready");
  const evaluate = js => w.webContents.executeJavaScript(js);
  const done = async () => {
    if (!w.isDestroyed()) w.destroy();
    windows.delete(w);
    if (child.exitCode === null) await Promise.race([once(child, "exit"), delay(5000)]);
    if (child.exitCode === null) child.kill();
    children.delete(child);
  };
  return { w, evaluate, done, diagnostics: () => ({ stdout, stderr, network }) };
}
async function verifyImage(name, animated = false) {
  const ctx = await open(path.join(work, name));
  try {
    await until(async () => {
      const events = await ctx.evaluate(`window.fixtureEvents || []`);
      assert(!events.some(e => e.event === "wallpaper_failed"), JSON.stringify(events));
      return events.some(e => e.event === "wallpaper_ready");
    }, name + " decoded", 30000);
    assert(!await ctx.evaluate(`window.fixtureEvents.some(e=>e.event==="wallpaper_failed")`));
    if (animated) {
      const hashes = new Set();
      for (let i = 0; i < 5; i++) {
        await delay(130);
        hashes.add(createHash("sha256").update((await ctx.w.webContents.capturePage()).toPNG()).digest("hex"));
      }
      assert(hashes.size > 1, name + " must animate, not merely load a still");
    }
    if (name === "large.png") {
      assert(await ctx.evaluate(`window.__ALUNIXA_X_IMAGE_OVERLAY__.dataUrl===""`));
      await ctx.w.webContents.executeJavaScript(`fetch("http://127.0.0.1:1/not-allowed").catch(()=>{})`);
      assert((await ctx.evaluate(`window.fixtureCsp`)).includes("connect-src"), "host CSP must remain active");
      fs.writeFileSync(path.join(output, "wallpaper-electron-large.png"), (await ctx.w.webContents.capturePage()).toPNG());
      const reloaded = once(ctx.w.webContents, "did-finish-load");
      ctx.w.webContents.reload();
      await reloaded;
      await until(() => ctx.evaluate(`window.fixtureEvents?.some(e=>e.event==="wallpaper_ready")`), "reload keeps transport");
    }
    console.log("PASS", name, animated ? "decoded + real pixel animation" : "decoded under host CSP");
  } catch (error) {
    const transport = await Promise.race([
      ctx.evaluate(`fetch(window.__ALUNIXA_X_IMAGE_OVERLAY__.sourceUrl).then(async r=>({status:r.status,length:(await r.arrayBuffer()).byteLength})).catch(e=>String(e))`),
      delay(3000).then(() => "fetch timed out"),
    ]);
    console.error("RESOURCE_DIAGNOSTICS", JSON.stringify(transport));
    console.error("IMAGE_DIAGNOSTICS", JSON.stringify(ctx.diagnostics()));
    throw error;
  } finally { await ctx.done(); }
}
async function verifyVideo(name, source, extra = {}) {
  const ctx = await open(source, extra);
  try {
    await until(async () => {
      const failures = await ctx.evaluate(`(window.fixtureEvents||[]).filter(e=>e.event==="wallpaper_failed")`);
      assert.equal(failures.length, 0, JSON.stringify(failures));
      return ctx.evaluate(`document.querySelector("video")?.currentTime>.25 && document.querySelector("video")?.videoWidth>0`);
    }, name + " playback", 45000);
    assert.deepEqual(await ctx.evaluate(`window.__codexSessionDeleteBridge("fixture",{})`), { status: "ok" });
    if (name === "large MP4") {
      await ctx.evaluate(`document.querySelector("video").currentTime=2.5`);
      await until(() => ctx.evaluate(`document.querySelector("video").currentTime>2.6`), "seek across chunks");
      await ctx.evaluate(`document.querySelector("video").currentTime=3.8`);
      await until(() => ctx.evaluate(`document.querySelector("video").currentTime<1`), "loop");
      await ctx.evaluate(`window.__ALUNIXA_X_IMAGE_OVERLAY__.paused=true;window.installWallpaper()`);
      assert(await ctx.evaluate(`document.querySelector("video").paused`));
      await ctx.evaluate(`window.__ALUNIXA_X_IMAGE_OVERLAY__.paused=false;window.installWallpaper()`);
      await until(() => ctx.evaluate(`document.querySelector("video").currentTime>.2`), "resume");
    }
    await ctx.evaluate(`document.querySelector("input").value="still usable"`);
    assert.equal(await ctx.evaluate(`document.elementFromPoint(20,10).tagName`), "INPUT");
    fs.writeFileSync(path.join(output, name === "native scene" ? "wallpaper-electron-scene.png" : "wallpaper-electron-video.png"),
      (await ctx.w.webContents.capturePage()).toPNG());
    await ctx.evaluate(`window.__ALUNIXA_X_IMAGE_OVERLAY__.enabled=false;window.installWallpaper()`);
    assert(await ctx.evaluate(`!document.querySelector("video") && !window.__alunixaXWallpaperRuntime`));
    console.log("PASS", name, "real frames + bridge + input + cleanup");
  } finally { await ctx.done(); }
}
app.whenReady().then(async () => {
  protocol.handle("app", request => new Response(
    new URL(request.url).pathname === "/index.html" ? html : "Transport did not intercept",
    { status: new URL(request.url).pathname === "/index.html" ? 200 : 404, headers: { "Content-Type": "text/html" } },
  ));
  try {
    makeMedia();
    await verifyImage("still.png");
    await verifyImage("large.png");
    await verifyImage("animated.gif", true);
    await verifyImage("animated.apng", true);
    await verifyVideo("large MP4", path.join(work, "seek.mp4"));
    await verifyVideo("WebM", path.join(work, "loop.webm"));
    await verifyVideo("Wallpaper Engine video project", path.join(work, "project.json"));
    const web = await open(path.join(work, "web"));
    try {
      await until(() => web.evaluate(`window.webResult?.local`), "sandboxed Web local scripts and JSON");
      assert.deepEqual(await web.evaluate(`window.webResult`), { fixtureWeb: true, parentBlocked: true, helperBlocked: true, local: true });
      console.log("PASS Web project actual local script/JSON and parent/helper isolation");
    } finally { await web.done(); }
    if (argv.includes("--scene")) {
      assert.equal(process.platform, "win32");
      assert(argv.includes("--engine"));
      inspector.open(0, "127.0.0.1");
      await verifyVideo("native scene", option("--scene"), { engine: option("--engine"), inspectorPort: Number(new URL(inspector.url()).port) });
    } else console.log("SKIP native scene: no explicit project/engine");
    console.log("ELECTRON_WALLPAPER_PASS", app.getVersion(), "work:", work);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    // Never stop/pause the global engine or close somebody else's window.
    await globalThis.__alunixaXWallpaperScene?.close();
    if (inspector.url()) inspector.close();
    for (const w of windows) if (!w.isDestroyed()) w.destroy();
    for (const child of children) if (child.exitCode === null) child.kill();
    app.quit();
  }
});
