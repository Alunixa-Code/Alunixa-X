import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(root, "App.tsx"), "utf8");
const commandSource = readFileSync(
  path.join(root, "..", "src-tauri", "src", "commands.rs"),
  "utf8",
);
const settingsSource = readFileSync(
  path.join(root, "..", "..", "..", "crates", "alunixa-x-core", "src", "settings.rs"),
  "utf8",
);
const clientSource = readFileSync(
  path.join(root, "..", "..", "..", "crates", "alunixa-x-core", "src", "connect", "weixin.rs"),
  "utf8",
);

test("WeChat connection is explicit, searchable, and defaults to restricted access", () => {
  assert.match(appSource, /id: "weixin"/);
  const screen = appSource.slice(appSource.indexOf("function WeixinConnectScreen("), appSource.indexOf("function OverviewScreen("));
  assert.match(screen, /<SearchablePathPicker/);
  assert.match(screen, /onFormChange\(\{ \.\.\.form, weixinConnectWorkDir:/);
  assert.match(appSource, /find_desktop_codex_cli/);
  assert.match(commandSource, /find_desktop_managed_codex_cli/);
  assert.match(commandSource, /find_bundled_codex_cli/);
  const appServer = readFileSync(
    path.join(root, "..", "..", "..", "crates", "alunixa-x-core", "src", "connect", "app_server.rs"),
    "utf8",
  );
  assert.match(appServer, /reasoning|Reasoning/);
  assert.match(appServer, /tool|Tool/);
  assert.match(appSource, /weixinConnectSandbox: "read-only"/);
  assert.match(settingsSource, /default_weixin_connect_sandbox/);
  assert.match(commandSource, /weixin_connect_qr_start/);
  assert.match(commandSource, /weixin_connect_start/);
});

test("WeChat credentials cannot be redirected or rendered by the manager", () => {
  assert.match(clientSource, /host == "ilinkai\.weixin\.qq\.com"/);
  assert.match(clientSource, /host\.ends_with\("\.weixin\.qq\.com"\)/);
  assert.match(clientSource, /url\.scheme\(\) != "https"/);
  const tokenInputs = [...appSource.matchAll(/<Input\b[\s\S]*?\/>/g)]
    .map(match => match[0]).filter(input => /value=\{form\.weixinConnectToken\}/.test(input));
  assert.equal(tokenInputs.length, 1, "credentials must have one explicit masked editor");
  assert.match(tokenInputs[0], /type="password"/);
  assert.match(tokenInputs[0], /autoComplete="off"/);
  assert.doesNotMatch(appSource, /<(?:code|span|strong)[^>]*>\s*\{form\.weixinConnectToken\}/);
});
