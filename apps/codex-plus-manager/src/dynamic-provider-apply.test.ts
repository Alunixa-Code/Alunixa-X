import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const commandsSource = fs.readFileSync(
  new URL("../src-tauri/src/commands.rs", import.meta.url),
  "utf8",
);

test("manager saves settings for the next Codex++ launcher startup", () => {
  const start = commandsSource.indexOf("pub async fn save_settings");
  const end = commandsSource.indexOf("fn apply_codex_hook_policy", start);
  const saveSettings = commandsSource.slice(start, end);

  assert.ok(start >= 0);
  assert.match(saveSettings, /save_preserving_runtime_model_selection/);
  assert.match(saveSettings, /下次通过 Codex\+\+ 启动器启动 Codex 时完整应用/);
  assert.doesNotMatch(saveSettings, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(saveSettings, /runtimeApply/);
  assert.doesNotMatch(saveSettings, /Runtime\.evaluate/);
});

test("active provider save does not claim a runtime model refresh", () => {
  const start = appSource.indexOf("const saveDraft = async () =>");
  const end = appSource.indexOf("const switchDraft = () =>", start);
  const saveDraft = appSource.slice(start, end);

  assert.ok(start >= 0);
  assert.match(saveDraft, /actions\.switchRelayProfile/);
  assert.doesNotMatch(saveDraft, /runtimeApply/);
  assert.doesNotMatch(appSource, /已动态注入/);
  assert.doesNotMatch(appSource, /动态应用失败/);
});

test("provider switch persists files without a runtime transaction", () => {
  const start = commandsSource.indexOf("pub async fn switch_relay_profile");
  const end = commandsSource.indexOf("pub fn write_diagnostic_event", start);
  const providerSwitch = commandsSource.slice(start, end);

  assert.ok(start >= 0);
  assert.match(providerSwitch, /switch_relay_profile_in_home/);
  assert.match(providerSwitch, /下次通过 Codex\+\+ 启动器启动 Codex 时完整应用配置、模型目录和默认模型/);
  assert.doesNotMatch(providerSwitch, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(providerSwitch, /runtimeApply/);
});

test("restoring official mode only prepares files for the next startup", () => {
  const start = commandsSource.indexOf("pub async fn clear_relay_injection");
  const end = commandsSource.indexOf("fn prepare_codex_app_state_before_provider_switch", start);
  const officialRestore = commandsSource.slice(start, end);

  assert.ok(start >= 0);
  assert.match(officialRestore, /clear_relay_config_to_home_with_auth/);
  assert.match(officialRestore, /下次通过 Codex\+\+ 启动器启动 Codex 时完整应用/);
  assert.doesNotMatch(officialRestore, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(officialRestore, /dynamic_apply_failed/);
});
