import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const dataLibSource = fs.readFileSync(new URL("../../../crates/alunixa-x-data/src/lib.rs", import.meta.url), "utf8");

test("unified overview replaces retired donut cards with live health and explicit refresh", () => {
  const start = appSource.indexOf("function OverviewScreen(");
  const end = appSource.indexOf("\nfunction RelayEnvironmentScreen", start);
  assert.ok(start >= 0 && end > start);
  const overview = appSource.slice(start, end);
  assert.match(overview, /healthItems\(overview\)/);
  assert.match(overview, /overview\?\.codex_version/);
  assert.match(overview, /actions\.refreshCurrent\(\)/);
  assert.match(overview, /<Badge status=\{item\.status\}/);
  assert.doesNotMatch(overview, /UsageAnalyticsPanel|usage-donut|model-frequency-donut|<strong>\{percent\}%<\/strong>/);
  assert.match(stylesSource, /\.overview-health-grid/);
});

test("retiring overview usage cards does not erase rollout analytics or widget usage readers", () => {
  assert.match(dataLibSource, /summarize_local_session_usage/);
  assert.match(dataLibSource, /DashboardUsageAnalytics/);
  assert.match(dataLibSource, /pub mod whale_usage/);
  const reader = fs.readFileSync(new URL("../../../crates/alunixa-x-data/src/whale_usage.rs", import.meta.url), "utf8");
  assert.match(reader, /cached|cache/);
  assert.match(reader, /input_tokens/);
  assert.match(reader, /output_tokens/);
});
