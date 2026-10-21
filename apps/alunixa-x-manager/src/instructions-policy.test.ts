import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("advanced instructions apply before launch and subsequent config writers preserve their path", () => {
  const launcher = readFileSync(
    new URL("../../../crates/alunixa-x-core/src/launcher.rs", import.meta.url), "utf8",
  );
  const repair = launcher.indexOf("codex_instructions::apply_model_instructions_policy(");
  assert.ok(repair >= 0);
  assert.ok(repair > launcher.indexOf(".apply_active_relay_profile(&settings)"));
  const launch = launcher.indexOf(".launch_codex(", repair);
  assert.ok(launch > repair);
  assert.match(launcher.slice(launch, launch + 320), /&app_dir[\s\S]*debug_port[\s\S]*&settings/);
  const relay = readFileSync(new URL("../../../crates/alunixa-x-core/src/relay_config.rs", import.meta.url), "utf8");
  assert.match(relay, /preserve_model_instructions_file/);
  const entrypoint = readFileSync(
    new URL("../../../apps/alunixa-x-launcher/src/main.rs", import.meta.url), "utf8",
  );
  const start = entrypoint.indexOf("async fn activate_existing_codex_app(");
  const reactivation = entrypoint.slice(start, entrypoint.indexOf("fn log_launcher_already_running(", start));
  // The unified launcher uses the native activation path to focus an existing app,
  // but must not replay the managed configuration/injection pipeline or create a helper.
  assert.doesNotMatch(reactivation, /ensure_model_instructions_before_launch|apply_model_instructions_policy|\.apply_active_relay_profile\(|\.start_helper\(|\.terminate_codex\(|launch_and_inject/);
  assert.match(reactivation, /\.launch_codex\([\s\S]*?options\.debug_port/);
  assert.match(reactivation, /windows_activate_process_window/);
});

test("saving unrelated Agent capabilities uses a preserving instructions policy", () => {
  const manager = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
  const start = manager.indexOf("pub async fn save_settings(");
  const end = manager.indexOf("\nfn apply_codex_hook_policy", start);
  const save = manager.slice(start, end);
  assert.match(save, /let previous = match SettingsStore::default\(\)\.load\(\)/);
  assert.match(save, /sync_model_instructions_after_settings_save/);
  assert.doesNotMatch(save, /and_then\(\|_\| apply_codex_instructions_policy/);
});

test("Fast request controls are separate from the retained native config.toml capability", () => {
  const manager = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(manager, /codexAppServiceTierControls: boolean/);
  assert.match(manager, /title=\{t\("Fast 按钮"\)\}/);
  const settings = readFileSync(
    new URL("../../../crates/alunixa-x-core/src/settings.rs", import.meta.url), "utf8",
  );
  assert.match(settings, /rename = "codexAppFastMode"/);
  const relay = readFileSync(
    new URL("../../../crates/alunixa-x-core/src/relay_config.rs", import.meta.url), "utf8",
  );
  assert.match(relay, /set_codex_fast_mode_in_home/);
  assert.match(relay, /fast_mode/);
});

test("startup audit covers managed Fast mode and advanced instructions", () => {
  const audit = readFileSync(
    new URL("../../../crates/alunixa-x-core/src/startup_audit.rs", import.meta.url), "utf8",
  );
  assert.match(audit, /sync_codex_agent_capabilities_in_home/);
  assert.match(audit, /audit_agent_capability_config/);
  assert.match(audit, /audit_model_instructions_before_launch/);
  const instructions = readFileSync(
    new URL("../../../crates/alunixa-x-core/src/codex_instructions.rs", import.meta.url), "utf8",
  );
  assert.match(instructions, /提示词文件内容为空/);
});
