import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultDreamSkinTheme, normalizeDreamSkinTheme } from "./dream-skin.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(root, "App.tsx"), "utf8");
const commandSource = readFileSync(
  path.join(root, "..", "src-tauri", "src", "commands.rs"),
  "utf8",
);
const communitySource = readFileSync(
  path.join(root, "..", "..", "..", "crates", "codex-plus-core", "src", "dream_skin_community.rs"),
  "utf8",
);
const packageSource = readFileSync(
  path.join(root, "..", "..", "..", "crates", "codex-plus-core", "src", "dream_skin_package.rs"),
  "utf8",
);
const assetsSource = readFileSync(
  path.join(root, "..", "..", "..", "crates", "codex-plus-core", "src", "assets.rs"),
  "utf8",
);
const managerLibSource = readFileSync(
  path.join(root, "..", "src-tauri", "src", "lib.rs"),
  "utf8",
);
const windowsThemeSource = readFileSync(
  path.join(root, "..", "..", "..", "assets", "inject", "upstream", "dream-skin", "windows", "renderer-inject.js"),
  "utf8",
);

test("DreamSkin defaults are neutral and preserve safe custom fields", () => {
  const defaults = defaultDreamSkinTheme();
  assert.equal(defaults.id, "dream-skin-default");
  assert.equal(defaults.name, "Dream Skin");
  assert.equal(defaults.promoUrl, undefined);
  const normalized = normalizeDreamSkinTheme({
    ...defaults,
    colors: { ...defaults.colors!, accent: "javascript:bad" },
    customTargetField: { keep: true },
  });
  assert.equal(normalized.colors?.accent, "#E25563");
  assert.deepEqual(normalized.customTargetField, { keep: true });
});

test("DreamSkin community uses a fixed API and validates every package", () => {
  assert.match(communitySource, /COMMUNITY_API_ORIGIN: &str = "https:\/\/api\.dreamskin\.cc"/);
  assert.match(communitySource, /redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(communitySource, /package_sha256/);
  assert.match(packageSource, /PACKAGE_LIMIT: usize = 32 \* 1024 \* 1024/);
  assert.match(packageSource, /validate_safe_css/);
  assert.match(packageSource, /validate_image_content/);
  assert.match(packageSource, /deny_unknown_fields/);
});

test("DreamSkin manager exposes search, preview, ZIP import, install, update, and activation", () => {
  for (const contract of [
    "refresh_dream_skin_community",
    "install_dream_skin_community_theme",
    "import_dream_skin_theme_package",
    "activate_dream_skin_theme",
    "delete_dream_skin_theme",
    "restore_default_dream_skin",
  ]) {
    assert.match(commandSource, new RegExp(contract));
  }
  assert.match(appSource, /DreamSkinScreen/);
  assert.match(appSource, /搜索主题、作者或版本/);
  assert.match(appSource, /在线预览/);
  assert.match(appSource, /导入 ZIP 主题包/);
  assert.match(appSource, /theme\.updateAvailable/);
});

test("DreamSkin runtime is appended without replacing the current renderer", () => {
  assert.match(assetsSource, /const RENDERER_SCRIPT: &str = include_str!/);
  assert.match(assetsSource, /dream_skin_target_runtime_script/);
  assert.match(assetsSource, /DREAM_SKIN_RENDERER_REVISION/);
  assert.match(assetsSource, /upstream\/dream-skin/);
  assert.match(assetsSource, /upstream\/cidala-tiger/);
  assert.match(assetsSource, /upstream\/snow-skin/);
  assert.match(assetsSource, /upstream\/glass-vision/);
  assert.match(assetsSource, /codex-dream-skin-companion/);
  assert.match(assetsSource, /data-codex-plus-dream-skin-main-surface/);
  assert.match(assetsSource, /naturalHeight \/ image\.naturalWidth/);
});

test("DreamSkin deep links accept only canonical version identifiers", () => {
  assert.match(communitySource, /strip_prefix\("dreamskin:\/\/apply\?version="\)/);
  assert.match(communitySource, /validate_version_id/);
  assert.match(communitySource, /%76er_1234abcd/);
  assert.match(managerLibSource, /tauri::RunEvent::Opened \{ urls \}/);
  assert.match(managerLibSource, /handle_dream_skin_url\(url\.as_str\(\)\)/);
});

test("DreamSkin adapts and releases the modern Codex main surface", () => {
  assert.match(windowsThemeSource, /const ensureShellMain = \(\) =>/);
  assert.match(windowsThemeSource, /MainContentSurface/);
  assert.match(windowsThemeSource, /data-codex-plus-dream-surface/);
});
