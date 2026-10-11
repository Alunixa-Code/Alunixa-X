import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const commandsSource = fs.readFileSync(
  new URL("../src-tauri/src/commands.rs", import.meta.url),
  "utf8",
);
function command(name: string) {
  const match = new RegExp(`^pub (?:async )?fn ${name}\\(`, "m").exec(commandsSource);
  assert.ok(match, `missing command: ${name}`);
  const tail = commandsSource.slice(match.index);
  const next = /^#\[tauri::command\]|^(?:pub (?:async )?|async )?fn /m.exec(tail.slice(1));
  return next ? tail.slice(0, next.index + 1) : tail;
}

test("manager saves settings for the next Alunixa X launcher startup", () => {
  const start = commandsSource.indexOf("pub async fn save_settings");
  const end = commandsSource.indexOf("fn apply_codex_hook_policy", start);
  const saveSettings = commandsSource.slice(start, end);

  assert.ok(start >= 0);
  assert.match(saveSettings, /save_preserving_runtime_model_selection/);
  assert.match(saveSettings, /下次通过 Alunixa X 启动器启动 Codex 时完整应用/);
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
  const providerSwitch = command("switch_relay_profile");
  assert.match(providerSwitch, /switch_relay_profile_in_home/);
  assert.doesNotMatch(providerSwitch, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(providerSwitch, /runtimeApply/);
});

test("restoring official mode only prepares files for the next startup", () => {
  const officialRestore = command("clear_relay_injection");
  assert.match(officialRestore, /clear_relay_config_to_home_with_auth/);
  assert.match(officialRestore, /relay_switch_mutex/);
  assert.doesNotMatch(officialRestore, /sync_codex_agent_capabilities_in_home/);
  assert.doesNotMatch(officialRestore, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(officialRestore, /dynamic_apply_failed/);
});

test("provider writers use preserving transactions without replaying unrelated native feature intent", () => {
  for (const name of ["apply_relay_injection", "apply_pure_api_injection"]) {
    const body = command(name);
    assert.match(body, /relay_switch_mutex/);
    assert.match(body, /apply_relay_profile_to_home_with_switch_rules/);
    assert.doesNotMatch(body, /sync_codex_agent_capabilities_in_home|Runtime\.evaluate|runtimeApply/);
  }
  const relay = fs.readFileSync(new URL("../../../crates/alunixa-x-core/src/relay_config.rs", import.meta.url), "utf8");
  assert.match(relay, /ConfigLock::acquire\(home\)/);
  assert.match(relay, /config_transaction::run_in_home/);
  assert.match(relay, /preserve_live_desktop_settings/);
});
