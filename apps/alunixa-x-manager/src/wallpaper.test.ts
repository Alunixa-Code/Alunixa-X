import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const rust = readFileSync(new URL("../../../crates/alunixa-x-core/src/wallpaper_scene.rs", import.meta.url), "utf8");
const template = rust.split('r#"(async () => {')[1].split('})()"#')[0];
const options = { engine: "wallpaper64.exe", project: "fixture/project.json", title: "Owned fixture", muted: true };
const script = `(async () => {${template}})()`.replace("__OPTIONS__", JSON.stringify(options));

test("scene captures only the exact owned window and closes only that location", async () => {
  const calls: unknown[][] = [];
  let quit: (() => void) | undefined;
  const electron = {
    app: { once(_event: string, callback: () => void) { quit = callback; } },
    screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0 } }, { bounds: { x: -1920, y: -200 } }] },
    desktopCapturer: { async getSources(args: unknown) {
      assert.deepEqual(JSON.parse(JSON.stringify(args)), { types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      return [{ name: "private window", id: "window:100:0" }, { name: options.title, id: "window:200:0" }];
    } },
  };
  const sandbox = { process: { platform: "win32", mainModule: { require(name: string) {
    if (name === "electron") return electron;
    if (name === "node:child_process") return { spawn(exe: string, args: unknown[], config: unknown) {
      calls.push([exe, ...args]);
      assert.equal((config as { shell: boolean }).shell, false);
      const raw = (config as { windowsVerbatimArguments: boolean }).windowsVerbatimArguments;
      if (raw) {
        assert.equal(args[1], '"applyProperties"');
        assert.equal(args[3], `"${options.title}"`);
        assert.equal(args.at(-1), 'RAW~({"volume":0})~END');
        assert.ok(!String(args.at(-1)).includes('\\"'));
      } else {
        assert.notEqual(args[1], "applyProperties");
      }
      return { once(event: string, callback: (code: number) => void) { if (event === "exit") queueMicrotask(() => callback(0)); } };
    } };
    throw new Error("unexpected require");
  } } }, setTimeout, clearTimeout };
  const result = JSON.parse(await vm.runInNewContext(script, sandbox));
  assert.deepEqual(result, { status: "ok", sourceId: "window:200:0" });
  assert.equal(calls[0][2], "openWallpaper");
  assert.ok(calls[0].includes("-playInWindow"));
  assert.equal(calls[0][calls[0].indexOf("-x") + 1], "-3328");
  assert.equal(calls[0][calls[0].indexOf("-y") + 1], "-200");
  assert.ok(calls[0].includes("-borderless"));
  assert.ok(!calls[0].includes("-activate"));
  assert.ok(!calls.flat().includes("-monitor"));
  quit?.();
  assert.deepEqual(calls.at(-1), ["wallpaper64.exe", "-control", "closeWallpaper", "-location", options.title]);
});

test("scene reports an unavailable Electron capturer instead of using a preview", async () => {
  const result = JSON.parse(await vm.runInNewContext(script, { process: { mainModule: { require() { return {}; } } } }));
  assert.equal(result.status, "failed");
  assert.equal(result.sourceId, undefined);
});

test("scene never falls back to an unrelated window when its exact title is absent", async () => {
  const calls: unknown[][] = [];
  const sandbox = {
    process: { mainModule: { require(name: string) {
      if (name === "electron") return {
        app: { once() {} },
        screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0 } }] },
        desktopCapturer: { async getSources() {
          return [{ name: "Other wallpaper", id: "window:100:0" }];
        } },
      };
      if (name === "node:child_process") return { spawn(_exe: string, args: unknown[]) {
        calls.push([...args]);
        return { once(event: string, callback: (code: number) => void) {
          if (event === "exit") queueMicrotask(() => callback(0));
        } };
      } };
      throw new Error(name);
    } } },
    setTimeout(callback: () => void) { queueMicrotask(callback); return 1; },
    clearTimeout() {},
  };
  const result = JSON.parse(await vm.runInNewContext(script, sandbox));
  assert.equal(result.status, "failed");
  assert.equal(result.sourceId, undefined);
  assert.deepEqual(calls.at(-1), ["-control", "closeWallpaper", "-location", options.title]);
});

test("wallpaper runtime uses sandboxed web frames and releases streams on teardown", () => {
  const source = readFileSync(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
  const runtime = source.split("function installAlunixaXImageOverlay()")[1].split("function scheduleAlunixaXImageOverlay")[0];
  assert.ok(runtime.includes('setAttribute("sandbox", "allow-scripts")'));
  assert.ok(!runtime.includes("allow-same-origin"));
  assert.ok(runtime.includes("stream?.getTracks().forEach(track => track.stop())"));
  assert.ok(runtime.includes('video.removeAttribute("src")'));
  assert.ok(runtime.includes('removeEventListener("visibilitychange", syncPlayback)'));
  assert.ok(runtime.includes('if (old?.signature === signature && old.element?.isConnected) return'));
  assert.ok(runtime.includes('window.__codexSessionDeleteBridge("/wallpaper/media", {})'));
  assert.ok(runtime.includes('window.__codexSessionDeleteBridge("/wallpaper/scene", {})'));
  assert.ok(runtime.includes('URL.revokeObjectURL(blobUrl)'));
  assert.ok(runtime.includes('if (stopped) { URL.revokeObjectURL(result.sourceUrl); return ""; }'));
});
