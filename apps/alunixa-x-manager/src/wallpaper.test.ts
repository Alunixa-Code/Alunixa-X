import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../../../assets/inject/renderer-inject.js");
const runtime = source.split("function installAlunixaXImageOverlay()")[1].split("function scheduleAlunixaXImageOverlay")[0];

test("production startup schedules the media runtime instead of the obsolete image-only bootstrap", () => {
  const startup = read("../../../assets/inject/renderer-inject/99-startup.js");
  const prelude = read("../../../assets/inject/renderer-inject/00-prelude.js");
  assert.ok(startup.includes("runScanStep(scheduleAlunixaXImageOverlay)"));
  assert.ok(!prelude.includes("  scheduleCodexPlusImageOverlay();"));
});

test("production Electron coverage runs the full renderer without manually booting the media function", () => {
  const fixture = read("../../../crates/alunixa-x-core/examples/wallpaper_fixture.rs");
  const verifier = read("../../../tools/verify-wallpaper-electron.cjs");
  assert.ok(fixture.includes('input["productionStartup"] == true'));
  assert.ok(fixture.includes("assets::injection_script_with_settings"));
  assert.ok(!fixture.includes("__ALUNIXA_X_TEST_SERVICE_TIER__"),
    "the service-tier test flag returns before production startup");
  assert.ok(fixture.includes('println!("DIAGNOSTIC {payload}")'));
  assert.ok(verifier.includes("--production-startup"));
});

test("wallpaper runtime uses media only and cannot capture windows or run project scripts", () => {
  assert.ok(!runtime.includes("getUserMedia"));
  assert.ok(!runtime.includes("chromeMediaSource"));
  assert.ok(!runtime.includes('createElement("iframe")'));
  assert.ok(!runtime.includes("/wallpaper/scene"));
  assert.ok(runtime.includes('window.__codexSessionDeleteBridge("/wallpaper/media", {})'));
});

test("image and video teardown releases blobs and preserves playback controls", () => {
  assert.ok(runtime.includes('video.removeAttribute("src")'));
  assert.ok(runtime.includes('removeEventListener("visibilitychange", syncPlayback)'));
  assert.ok(runtime.includes('if (old?.signature === signature && old.element?.isConnected) return'));
  assert.ok(runtime.includes('URL.revokeObjectURL(blobUrl)'));
  assert.ok(runtime.includes('if (stopped) { URL.revokeObjectURL(result.sourceUrl); return ""; }'));
  assert.ok(runtime.includes("video.loop = true"));
  assert.ok(runtime.includes("video.muted = config.muted !== false"));
});

test("native wallpaper launch is absent and legacy previews are explicitly labelled", () => {
  const launcher = read("../../../crates/alunixa-x-core/src/launcher.rs");
  const fixture = read("../../../crates/alunixa-x-core/examples/wallpaper_fixture.rs");
  const ui = read("./components/WallpaperSettings.tsx");
  for (const script of [launcher, fixture]) {
    assert.ok(!script.includes("wallpaper_scene"));
    assert.ok(!script.includes("-playInWindow"));
  }
  assert.ok(!ui.includes("chooseEngine"));
  assert.ok(!ui.includes('t("选择项目目录")'));
  assert.ok(ui.includes('t("静态预览")'));
  assert.ok(ui.includes('t("旧场景只显示预览图片，不运行场景；可上传新图片替换。")'));
});

test("real playback verifier fails closed instead of returning zero after app.quit", () => {
  const verifier = read("../../../tools/verify-wallpaper-electron.cjs");
  assert.ok(verifier.includes("app.exit(failed ? 1 : 0)"));
  assert.ok(verifier.includes("--self-test-failure"));
  assert.ok(!verifier.includes("process.exitCode = 1"));
  assert.ok(!verifier.includes('require("node:inspector")'));
});
