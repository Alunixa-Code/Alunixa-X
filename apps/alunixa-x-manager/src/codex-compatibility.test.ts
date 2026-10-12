import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const renderer = readFileSync(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
function functions(...names: string[]) {
  return names.map((name) => {
    const match = renderer.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}
function declarations(...names: string[]) {
  return names.map(name => {
    const match = renderer.match(new RegExp(`^  const ${name}\\s*=\\s*[\\s\\S]*?;$`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}

test("missing module discovery stays bounded across reinjection and resets only in a new document", async () => {
  let now = 100;
  let searches = 0;
  const failures = new Map();
  const loader = (failures: Map<unknown, unknown>, found = "") => new Function("Date", "codexAppModuleFailures",
    "codexAppAssetUrl", "codexAppAssetUrlFromScriptText", `
      const codexServiceTierModulePromises = new Map();
      const codexAppModuleRetryCooldownMs = 30000;
      const codexAppModuleMaxAttempts = 8;
      ${functions("codexAppAssetMissingError", "loadCodexAppModule")}
      return loadCodexAppModule;
    `)({ now: () => now }, failures, () => "", async () => { searches++; return found; });
  const api = loader(failures);
  await Promise.all(Array.from({ length: 20 }, () => api("missing-").catch(() => null)));
  assert.equal(searches, 1);
  for (let attempt = 0; attempt < 12; attempt++) {
    now += 30001;
    await assert.rejects(api("missing-"));
  }
  assert.equal(searches, 8);
  await assert.rejects(loader(failures)("missing-"));
  assert.equal(searches, 8, "reinjection must not restart an exhausted scan budget");
  const newDocument = loader(new Map(), "data:text/javascript,export%20const%20ready%20%3D%20true%3B");
  assert.equal((await newDocument("missing-")).ready, true);
  assert.equal(searches, 9, "a new document owns a fresh discovery budget");
});

test("asset lookup resolves emitted quoted imports and caches positive and negative prefix results", async () => {
  let requests = 0;
  let now = 100;
  const api = new Function("fetch", "Date", "codexAppAssetCandidateUrls", `
    const codexAppAssetUrlLookups = new Map();
    const codexAppModuleRetryCooldownMs = 30000;
    ${functions("scanCodexAppAssetUrlFromScriptText", "codexAppAssetUrlFromScriptText")}
    return codexAppAssetUrlFromScriptText;
  `)(async () => {
    requests++;
    return { ok: true, text: async () => 'import("./app-initial-new.js");import(\'./vscode-api-old.js\')' };
  }, { now: () => now }, () => ["https://codex.test/assets/app-main-new.js"]);
  assert.equal(await api("app-initial-"), "https://codex.test/assets/app-initial-new.js");
  assert.equal(await api("vscode-api-"), "https://codex.test/assets/vscode-api-old.js");
  assert.equal(requests, 2, "each distinct prefix has its own lookup cache");
  assert.equal(await api("app-initial-"), "https://codex.test/assets/app-initial-new.js");
  assert.equal(await api("vscode-api-"), "https://codex.test/assets/vscode-api-old.js");
  assert.equal(requests, 2);
  assert.equal(await api("absent-"), "");
  for (let i = 0; i < 20; i++) assert.equal(await api("absent-"), "");
  assert.equal(requests, 3, "a missing prefix must not re-fetch during cooldown");
  now += 30001;
  assert.equal(await api("absent-"), "");
  assert.equal(requests, 4);
});

test("plugin filters survive renamed minifier variables without replaying callbacks", () => {
  const result = vm.runInNewContext(`
    const window = {};
    const alunixaXBackendSettingsLoaded = true;
    const codexPluginMarketplaceUnlockVersion = "16";
    const codexPluginFilterSourceCache = new WeakMap();
    ${declarations("codexPluginBuildFlavorFilterSourcePattern", "codexPluginFeaturedFilterSourcePattern", "codexPluginHiddenFilterSourcePattern")}
    const pluginPatchDisabledInRelayMode = () => false;
    const settings = { pluginMarketplaceUnlock: true };
    const alunixaXSettings = () => settings;
    const sendAlunixaXDiagnostic = () => {};
    const sendCodexPlusDiagnostic = sendAlunixaXDiagnostic;
    ${functions("codexPluginMarketplacePatchEnabled", "restorePluginMarketplaceName", "codexPluginOfficialMarketplaceName",
      "codexPluginFilterCallbackSource", "isCodexPluginBuildFlavorFilter", "isCodexPluginFeaturedFilter",
      "isCodexPluginMarketplaceHiddenFilter", "installPluginBuildFlavorFilterPatch")}
    installPluginBuildFlavorFilterPatch();
    let calls = 0;
    const reserved = (name) => { calls++; return name.startsWith("openai-"); };
    const current = "openai-curated";
    const entries = [{marketplaceName: "openai-bundled"}, {marketplaceName: "openai-curated"}, {marketplaceName: "user"}];
    const visible = entries.filter(z=>!reserved(z.marketplaceName)||z.marketplaceName===current);
    const searched = entries.filter(z=>z.marketplaceName===current);
    const hidden = ["openai-bundled"];
    let hiddenChecks = 0;
    const includes = hidden.includes.bind(hidden);
    hidden.includes = name => { hiddenChecks++; return includes(name); };
    const markets = [{name:"openai-bundled"}, {name:"user"}].filter(q=>!hidden.includes(q.name));
    settings.pluginMarketplaceUnlock = false;
    const disabled = [{name:"openai-bundled"}, {name:"user"}].filter(q=>!hidden.includes(q.name));
    let contexts = 0;
    entries.filter(function() { if (this.ok) contexts++; return false; }, {ok: true});
    JSON.stringify({ calls, visible: visible.length, searched: searched.length, markets: markets.length,
      disabled: disabled.length, hiddenChecks, contexts });
  `);
  assert.deepEqual(JSON.parse(result), { calls: 3, visible: 3, searched: 1, markets: 2,
    disabled: 1, hiddenChecks: 4, contexts: 3 });
});

test("pure API resume corrects inherited official providers but preserves explicit providers", () => {
  const api = new Function("alunixaXBackendSettings", "codexModelCatalog", "sendCodexPlusDiagnostic", `
    ${functions("codexRemoteSessionActiveProfile", "codexRemoteSessionProviderPatchEnabled",
      "codexRemoteSessionProviderNormalizationEnabled", "codexRemoteSessionProviderOverrideEnabled",
      "codexRelayConfigModelProvider", "codexRemoteSessionTargetProvider",
      "codexRemoteSessionProviderRequestMethod", "applyCodexRemoteSessionProviderOverride")}
    return applyCodexRemoteSessionProviderOverride;
  `)({ relayProfilesEnabled: true, activeRelayId: "api", relayProfiles: [{
    id: "api", relayMode: "pureApi", configContents: 'model_provider = "my-provider"',
  }] }, { codex_model_provider: "stale-provider" }, () => {});
  assert.deepEqual(api("thread/resume", { modelProvider: "openai", threadId: "t" }),
    { modelProvider: "my-provider", threadId: "t" });
  assert.deepEqual(api("thread/resume", { modelProvider: "other" }), { modelProvider: "other" });
  assert.deepEqual(api("turn/start", { threadId: "t" }), { threadId: "t" });
});

test("Fast availability agrees with explicit current model tier metadata", () => {
  const api = new Function("alunixaXModelMetadata", "alunixaXModelDetail", `
    const codexServiceTierSupportedFastModels = new Set(["gpt-5.5"]);
    const codexNativeModelServiceTiers = new Map();
    ${functions("normalizeCodexServiceTierModelName", "isFastServiceTierValue",
      "codexServiceTierFastSupportedForModel", "codexServiceTierFastAvailability")}
    return codexServiceTierFastAvailability;
  `)((name: string) => name === "current-model" ? { serviceTiers: [{ id: "priority" }] } : null, () => null);
  assert.equal(api("current-model").supported, true);
  assert.equal(api("unknown-model").supported, false);
});

test("catalogue metadata enables new Fast models while native model/list fields remain intact", () => {
  const catalogue = {
    modelMetadata: {
      "new-model": { serviceTiers: [{ id: "priority" }] },
      "standard-model": { serviceTiers: [], prioritySupportOverride: false },
      "gpt-5.5": { prioritySupportOverride: false },
    },
  };
  const api = new Function("codexModelCatalog", `
    const window = {};
    const codexServiceTierSupportedFastModels = new Set(["gpt-5.5"]);
    const alunixaXModelCollectionSnapshots = new WeakMap();
    const codexPureApiAllowedModelSet = () => null;
    const alunixaXModelNames = () => [];
    const sendCodexPlusDiagnostic = () => {};
    ${functions("codexServiceTierModelFromValue", "alunixaXModelMetadata",
      "normalizeCodexServiceTierModelName", "codexServiceTierFastSupportedForModel",
      "modelArrayLooksPatchable", "modelFilterPolicy", "sameModelCollection",
      "prepareModelCollection", "finishModelCollection", "patchModelArray",
      "modelResponseHostId", "patchAppServerModelResult")}
    return { supported: codexServiceTierFastSupportedForModel, patch: patchAppServerModelResult };
  `)(catalogue);
  const unrelated = { data: [{ model: "keep", serviceTiers: [{ id: "priority" }] }] };
  const before = structuredClone(unrelated);
  assert.equal(api.patch("turn/start", unrelated), unrelated, "non-model RPC results must keep their identity");
  assert.deepEqual(unrelated, before);
  assert.equal(api.patch("model/list", unrelated, "local"), unrelated);
  assert.deepEqual(unrelated, before, "native tier metadata must not be stripped or rewritten");
  assert.equal(api.supported("new-model"), true);
  assert.equal(api.supported("standard-model"), false);
  assert.equal(api.supported("gpt-5.5"), false, "an explicit provider override beats the builtin allowlist");
  assert.equal(api.supported("unverified-fast-model"), false);
  assert.match(functions("patchAppServerModelResult"), /"model\/list"/);
});

test("v1.5 Fast allowlist includes the GPT-6 model family", () => {
  assert.match(
    renderer,
    /"gpt-6-astra",\s*"gpt-6-sol",\s*"gpt-6-luna"/,
  );
});

test("injected UI mutations do not recursively schedule full scans", () => {
  const api = new Function("isChatContentMutation", "isExtensionUiNode",
    "nodeSelfOrAncestorMatchesScanRelevance", "isScanRelevantNode", `
    ${functions("shouldScheduleScan")} return shouldScheduleScan;
  `)(() => false, (node: { own?: boolean }) => node?.own === true, () => true, () => true);
  const host = { nodeType: 1 };
  assert.equal(api([{ target: host, addedNodes: [{ nodeType: 1, own: true }], removedNodes: [] }]), false);
  assert.equal(api([{ target: host, addedNodes: [{ nodeType: 1, own: false }], removedNodes: [] }]), true);
});
