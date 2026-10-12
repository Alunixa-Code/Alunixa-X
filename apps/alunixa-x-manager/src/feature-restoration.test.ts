import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const models = readFileSync(new URL("./components/CustomModelsEditor.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../../crates/alunixa-x-core/src/settings.rs", import.meta.url), "utf8");
const assets = readFileSync(new URL("../../../crates/alunixa-x-core/src/assets.rs", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../../crates/alunixa-x-core/src/codex_hooks.rs", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../../../crates/alunixa-x-core/src/launcher.rs", import.meta.url), "utf8");

const legacyControls = [
  "computerUseGuardEnabled", "codexAppPackagedProxyRepair", "codexAppPluginAutoExpand",
  "codexAppProjectMove", "codexAppInstructionsEnabled", "codexAppInstructions",
  "codexAppResponsesIdNegotiation", "codexAppMemoryEmbeddingEnabled",
  "codexAppMemoryEmbeddingBaseUrl", "codexAppMemoryEmbeddingApiKey", "codexAppMemoryEmbeddingModel",
  "codexAppAiShell", "codexAppSharedTerminal", "codexAppSharedTerminalRetentionMinutes",
  "codexAppForceChineseLocale", "codexAppFastStartup", "codexAppDisableAutoUpdate",
  "codexAppDisableWss", "codexAppFastMode", "codexAppPerformanceProtection",
  "codexAppNativeMenuPlacement", "codexAppNativeMenuLocalization", "codexAppZedRemoteOpen",
  "zedRemoteProjectRegistryEnabled", "zedRemoteOpenStrategy", "codexAppUpstreamWorktreeCreate",
];

test("advanced supplier creation is directly reachable rather than only editing seeded fixtures", () => {
  assert.match(app, /添加供应商\(可自定义\)/);
  assert.match(app, /function createCustomModelsRelayProfile/);
  assert.match(app, /setNewProfileDraft\(createCustomModelsRelayProfile\(normalized\)\)/);
});

test("every lost enhancement control remains in the rendered manager and its settings schema", () => {
  const ui = app.slice(app.indexOf("function EnhanceScreen("), app.indexOf("function DreamSkinScreen("));
  for (const key of legacyControls) {
    assert.ok(ui.includes(key), `missing enhancement control: ${key}`);
    assert.ok(settings.includes(`"${key}"`), `missing persisted setting: ${key}`);
  }
  assert.match(ui, /<AgentHealthPanel/);
  assert.match(ui, /savedRevision/);
});

test("custom model controls include independent endpoint, protocol, window, compression and selection", () => {
  for (const field of ["baseUrl", "apiKey", "protocol", "contextWindow", "autoCompactEnabled", "autoCompactLimit"]) {
    assert.ok(models.includes(`model.${field}`), `missing custom model field: ${field}`);
  }
  assert.match(models, /SortableContext|移动模型|上移/);
  assert.match(models, /defaultId/);
});

test("native capability edits explicitly reach revision-protected settings saves", () => {
  const start = app.indexOf("const saveSettingsValue =");
  const end = app.indexOf("const beginWeixinQrLogin =", start);
  const save = app.slice(start, end);
  assert.match(save, /capabilityWrites/);
  assert.match(save, /expectedRevision: settingsRevisionRef\.current/);
});

test("restored public settings are not silently removed again by the upstream writer", () => {
  assert.doesNotMatch(settings, /target\.remove\("codexAppPluginAutoExpand"\)/);
  assert.doesNotMatch(settings, /target\.remove\("computerUseGuardEnabled"\)/);
});

test("native locale, startup, performance and update controls have actual injected configuration", () => {
  for (const key of [
    "codex_app_force_chinese_locale", "codex_app_fast_startup",
    "codex_app_performance_protection", "codex_app_disable_auto_update",
  ]) {
    assert.ok(assets.includes(`settings.${key}`), `missing runtime consumer: ${key}`);
  }
});

test("shared terminal is wired at both the native producer and the local service", () => {
  assert.match(hook, /settings\s*\.\s*codex_app_shared_terminal/);
  assert.match(launcher, /"\/shared-terminal\/submit"/);
  assert.match(launcher, /"\/shared-terminal\/next"/);
});

test("provider recovery does not remove or reduce the new native Anthropic bridge", () => {
  const protocol = readFileSync(new URL("../../../crates/alunixa-x-core/src/protocol_proxy.rs", import.meta.url), "utf8");
  assert.match(protocol, /anthropic::responses_request_to_anthropic/);
  assert.match(launcher, /UpstreamSseToResponsesConverter::with_request/);
});
