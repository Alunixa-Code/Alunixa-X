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

test("missing module discovery is coalesced, bounded, and resumes for new assets", async () => {
  let now = 100;
  let signature = "initial";
  let searches = 0;
  const api = new Function("Date", "codexAppAssetCandidateUrls", "codexAppAssetUrl", "codexAppAssetUrlFromScriptText", `
    const codexServiceTierModulePromises = new Map();
    const codexAppModuleFailures = new Map();
    const codexAppModuleRetryCooldownMs = 30000;
    const codexAppModuleMaxAttempts = 8;
    ${functions("loadCodexAppModule")}
    return loadCodexAppModule;
  `)({ now: () => now }, () => [signature], () => "", async () => { searches++; return ""; });
  await Promise.all(Array.from({ length: 20 }, () => api("missing-").catch(() => null)));
  assert.equal(searches, 1);
  for (let attempt = 0; attempt < 12; attempt++) {
    now += 30001;
    await assert.rejects(api("missing-"));
  }
  assert.equal(searches, 8);
  signature = "late-loaded";
  await assert.rejects(api("missing-"));
  assert.equal(searches, 9);
});

test("asset lookup accepts template literals and shares source requests", async () => {
  let requests = 0;
  const api = new Function("fetch", "document", "codexAppAssetCandidateUrls", `
    const codexAppAssetTextPromises = new Map();
    ${functions("codexAppAssetUrlFromScriptText")}
    return codexAppAssetUrlFromScriptText;
  `)(async () => {
    requests++;
    return { ok: true, text: async () => 'import(`./app-initial-new.js`);import("./vscode-api-old.js")' };
  }, { baseURI: "https://codex.test/index.html" }, () => ["https://codex.test/assets/app-main-new.js"]);
  assert.equal(await api("app-initial-"), "https://codex.test/assets/app-initial-new.js");
  assert.equal(await api("vscode-api-"), "https://codex.test/assets/vscode-api-old.js");
  assert.equal(requests, 1);
});

test("plugin filters survive renamed minifier variables without replaying callbacks", () => {
  const result = vm.runInNewContext(`
    const window = {};
    const codexPluginMarketplaceUnlockVersion = "16";
    const codexPluginFilterSourceCache = new WeakMap();
    const pluginPatchDisabledInRelayMode = () => false;
    const alunixaXSettings = () => ({ pluginMarketplaceUnlock: true });
    const sendAlunixaXDiagnostic = () => {};
    ${functions("restorePluginMarketplaceName", "codexPluginOfficialMarketplaceName",
      "codexPluginFilterCallbackSource", "isCodexPluginBuildFlavorFilter",
      "isCodexPluginMarketplaceHiddenFilter", "installPluginBuildFlavorFilterPatch")}
    installPluginBuildFlavorFilterPatch();
    let calls = 0;
    const reserved = (name) => { calls++; return name.startsWith("openai-"); };
    const current = "openai-curated";
    const entries = [{marketplaceName: "openai-bundled"}, {marketplaceName: "openai-curated"}, {marketplaceName: "user"}];
    const visible = entries.filter(z=>!reserved(z.marketplaceName)||z.marketplaceName===current);
    const searched = entries.filter(z=>z.marketplaceName===current);
    const hidden = ["openai-bundled"];
    const markets = [{name:"openai-bundled"}, {name:"user"}].filter(q=>!hidden.includes(q.name));
    let contexts = 0;
    entries.filter(function() { if (this.ok) contexts++; return false; }, {ok: true});
    JSON.stringify({ calls, visible: visible.length, searched: searched.length, markets: markets.length, contexts });
  `);
  assert.deepEqual(JSON.parse(result), { calls: 3, visible: 3, searched: 1, markets: 2, contexts: 3 });
});

test("pure API resume corrects inherited official providers but preserves explicit providers", () => {
  const api = new Function("alunixaXBackendSettings", "codexModelCatalog", "sendAlunixaXDiagnostic", `
    ${functions("codexRemoteSessionProviderNormalizationEnabled", "codexRemoteSessionPureApiEnabled",
      "codexRemoteSessionTargetProvider", "codexRemoteSessionThreadStartMethod", "applyCodexRemoteSessionProviderOverride")}
    return applyCodexRemoteSessionProviderOverride;
  `)({ relayProfilesEnabled: true, activeRelayId: "api", relayProfiles: [{ id: "api", relayMode: "pureApi" }] },
  { codex_model_provider: "my-provider" }, () => {});
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

test("native model/list metadata enables newly introduced Fast models", () => {
  const api = new Function(`
    const codexServiceTierSupportedFastModels = new Set();
    const codexNativeModelServiceTiers = new Map();
    const alunixaXModelMetadata = () => null;
    const alunixaXModelDetail = () => null;
    ${functions("rememberCodexNativeModelServiceTiers", "normalizeCodexServiceTierModelName",
      "isFastServiceTierValue", "codexServiceTierFastSupportedForModel")}
    return { rememberCodexNativeModelServiceTiers, codexServiceTierFastSupportedForModel };
  `)();
  api.rememberCodexNativeModelServiceTiers({ data: [
    { model: "new-model", serviceTiers: [{ id: "priority" }] },
    { model: "standard-model", serviceTiers: [] },
  ] });
  assert.equal(api.codexServiceTierFastSupportedForModel("new-model"), true);
  assert.equal(api.codexServiceTierFastSupportedForModel("standard-model"), false);
  assert.match(functions("patchAppServerModelResult"), /method !== "model\/list"/);
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
