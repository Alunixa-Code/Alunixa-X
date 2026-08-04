import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const commandsSource = fs.readFileSync(
  new URL("../src-tauri/src/commands.rs", import.meta.url),
  "utf8",
);

test("manager settings and provider saves dynamically apply the running Codex instance", () => {
  assert.match(commandsSource, /pub async fn save_settings/);
  assert.match(commandsSource, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(
    commandsSource.slice(
      commandsSource.indexOf("pub async fn save_settings"),
      commandsSource.indexOf("fn apply_codex_hook_policy"),
    ),
    /9229/,
  );
  assert.match(appSource, /!normalized\.relayProfilesEnabled && next\.relayProfilesEnabled/);
  assert.match(appSource, /actions\.switchRelayProfile\(next, normalized\.activeRelayId\)/);
});

test("active provider save relies on the dynamic apply notice instead of showing two successes", () => {
  const start = appSource.indexOf("const saveDraft = async () =>");
  const end = appSource.indexOf("const switchDraft = () =>", start);
  const saveDraft = appSource.slice(start, end);

  assert.match(saveDraft, /if \(!isActive\)/);
  assert.match(saveDraft, /供应商配置已保存/);
  assert.match(appSource, /已动态注入 \{0\} 个模型，当前模型：\{1\}/);
});

test("provider switch lock is released before awaiting the runtime transaction", () => {
  const start = commandsSource.indexOf("pub async fn switch_relay_profile");
  const end = commandsSource.indexOf("pub fn write_diagnostic_event", start);
  const providerSwitch = commandsSource.slice(start, end);

  assert.match(providerSwitch, /let switch_result = \{/);
  assert.match(providerSwitch, /match switch_result/);
  assert.match(providerSwitch, /apply_current_runtime_config_and_models/);
  assert.doesNotMatch(providerSwitch, /drop\(_guard\)/);
});

test("restoring official mode also removes managed models from the running Codex", () => {
  const start = commandsSource.indexOf("pub async fn clear_relay_injection");
  const end = commandsSource.indexOf("fn prepare_codex_app_state_before_provider_switch", start);
  const officialRestore = commandsSource.slice(start, end);

  assert.ok(start >= 0);
  assert.match(officialRestore, /clear_relay_config_to_home_with_auth/);
  assert.match(officialRestore, /apply_current_runtime_config_and_models/);
  assert.match(officialRestore, /dynamic_apply_failed/);
});
