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
  assert.match(appSource, /list="weixin-session-workdirs"/);
  assert.match(appSource, /find_desktop_codex_cli/);
  assert.match(commandSource, /find_cached_codex_cli/);
  assert.match(appSource, /实时回传思考摘要、搜索、命令、工具与输出/);
  assert.match(appSource, /weixinConnectSandbox: "read-only"/);
  assert.match(settingsSource, /default_weixin_connect_sandbox/);
  assert.match(commandSource, /weixin_connect_qr_start/);
  assert.match(commandSource, /weixin_connect_start/);
});

test("WeChat credentials cannot be redirected or rendered by the manager", () => {
  assert.match(clientSource, /host == "ilinkai\.weixin\.qq\.com"/);
  assert.match(clientSource, /host\.ends_with\("\.weixin\.qq\.com"\)/);
  assert.match(clientSource, /url\.scheme\(\) != "https"/);
  assert.match(appSource, /the connection token is never displayed|不会在页面显示连接 token/);
  assert.doesNotMatch(appSource, /value=\{form\.weixinConnectToken\}/);
});
