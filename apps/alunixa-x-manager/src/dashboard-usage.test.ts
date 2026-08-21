import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const commandsSource = fs.readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
const managerLibSource = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("overview renders real rollout usage analytics as donut charts", () => {
  assert.match(appSource, /dashboard_usage_analytics/);
  assert.match(appSource, /UsageAnalyticsPanel/);
  assert.match(appSource, /usage-donut/);
  assert.match(appSource, /model-frequency-donut/);
  assert.match(appSource, /Token 已用/);
  assert.match(appSource, /缓存命中/);
  assert.match(appSource, /formatTokenMillions/);
  assert.doesNotMatch(appSource, /<strong>\{percent\}%<\/strong>/);
  assert.match(appSource, /模型使用频率/);
  assert.match(stylesSource, /conic-gradient/);
  assert.match(stylesSource, /@media \(max-width: 1320px\)/);
  assert.match(stylesSource, /latest-launch-message/);
  assert.match(commandsSource, /summarize_local_session_usage/);
  assert.match(managerLibSource, /commands::dashboard_usage_analytics/);
});
