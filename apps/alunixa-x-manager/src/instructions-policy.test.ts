import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("advanced instructions are checked after all config writers and before starting Codex", () => {
  const launcher = readFileSync(
    new URL("../../../crates/alunixa-x-core/src/launcher.rs", import.meta.url), "utf8",
  );
  const repair = launcher.indexOf("codex_instructions::ensure_model_instructions_before_launch(");
  assert.ok(repair > launcher.indexOf(".apply_active_relay_profile(&settings)"));
  assert.ok(repair > launcher.indexOf(".ensure_imagegen_mcp_config(&settings, helper_port)"));
  assert.ok(repair > launcher.indexOf("experimental_context::validate_local_context_companion("));
  assert.ok(repair < launcher.indexOf(".launch_codex(&app_dir, debug_port, &settings"));
  assert.equal(launcher.includes("codex_instructions::apply_model_instructions_policy("), false);
  const entrypoint = readFileSync(
    new URL("../../../apps/alunixa-x-launcher/src/main.rs", import.meta.url), "utf8",
  );
  const reactivation = entrypoint.slice(entrypoint.indexOf("async fn activate_existing_codex_app("));
  const reactivationRepair = reactivation.indexOf("ensure_model_instructions_before_launch(");
  assert.ok(reactivationRepair > 0 && reactivationRepair < reactivation.indexOf(".launch_codex("));
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
