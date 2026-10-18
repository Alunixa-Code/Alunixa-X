import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const fragment = (name: string) => readFileSync(new URL(`../../../assets/inject/renderer-inject/${name}`, import.meta.url), "utf8");
const extract = (source: string, name: string) => {
  const body = source.match(new RegExp(`^  (?:async )?function ${name}\\([^]*?^  \\}`, "m"))?.[0];
  assert.ok(body, name);
  return body;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

type InheritedTier = { serviceTier: string | null; configServiceTier: string | null; serviceTierSource: string | null };
const inherited = (tier: string | null): InheritedTier => ({ serviceTier: tier, configServiceTier: null, serviceTierSource: tier ? "codex-app" : null });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// Evaluate the production settings/bootstrap functions. Only I/O and rendering are
// replaced, so these tests exercise async ordering rather than a copy of the fix.
function harness(initial: Record<string, unknown> = {}) {
  const tier = fragment("30-service-tier.js");
  const backend = fragment("40-backend-settings.js");
  const settings = fragment("10-style.js");
  const reads: ReturnType<typeof deferred<InheritedTier>>[] = [];
  const heldSaves: ReturnType<typeof deferred<Record<string, unknown>>>[] = [];
  const diagnostics: string[] = [];
  const scheduled: Array<() => void> = [];
  let serverSettings: Record<string, unknown> = { enhancementsEnabled: true, codexAppServiceTierControls: true };
  let settingsFailures = 0;
  let settingsReads = 0;
  let removals = 0;
  const context = vm.createContext({
    window: { __ALUNIXA_X_TEST_SERVICE_TIER__: true },
    localStorage: { getItem: () => null },
    conversationViewDefaultWidth: 960,
    alunixaXSettingsKey: "test-settings",
    alunixaXBackendSettings: { enhancementsEnabled: true, ...initial },
    alunixaXBackendSettingsSeq: 0,
    alunixaXBackendSettingsLoaded: false,
    codexServiceTierState: { status: "loading", serviceTier: null, configServiceTier: null, message: "正在读取…" },
    resolveInheritedServiceTier: () => {
      const pending = deferred<InheritedTier>();
      reads.push(pending);
      return pending.promise;
    },
    isFastServiceTierValue: (value: unknown) => value === "priority" || value === "fast",
    refreshCodexServiceTierControls: () => {},
    removeCodexServiceTierBadges: () => { removals++; },
    refreshCodexPlusBackendToggles: () => {},
    codexRemoteSessionProviderOverrideEnabled: () => false,
    syncOfficialUsagePolicy: () => {},
    runScanStep: (callback: () => void) => callback(),
    syncCodexPlusTypingEffects: () => {},
    renderCodexPlusMenu: () => {},
    refreshConversationView: () => {},
    scan: () => {},
    setTimeout: (callback: () => void) => { scheduled.push(callback); return scheduled.length; },
    sendCodexPlusDiagnostic: (event: string) => { diagnostics.push(event); },
    postJson: async (path: string, body: Record<string, unknown>) => {
      if (path === "/settings/get") {
        settingsReads++;
        if (settingsFailures > 0) { settingsFailures--; throw new Error("backend starting"); }
      } else {
        assert.equal(path, "/settings/set");
        serverSettings = { ...serverSettings, ...body };
        const held = heldSaves.shift();
        if (held) return await held.promise;
      }
      return { ...serverSettings };
    },
  });
  const map = settings.match(/^  const alunixaXBackendSettingMap = \{[^]*?^  \};/m)?.[0];
  assert.ok(map);
  const stateStart = tier.indexOf("  let codexServiceTierStateLoadPromise");
  const stateEnd = tier.indexOf("  function setCodexThreadServiceTierMode", stateStart);
  assert.ok(stateStart >= 0 && stateEnd > stateStart);
  const bootstrapEnd = backend.indexOf("  function refreshCodexPlusBackendToggles");
  assert.ok(bootstrapEnd > 0);
  vm.runInContext([
    map,
    ...["defaultCodexPlusSettings", "backendCodexPlusSettings", "alunixaXSettings"].map((name) => extract(settings, name)),
    extract(tier, "serviceTierGlobalStatusMessage"),
    extract(tier, "loadBackendSettingsState"),
    tier.slice(stateStart, stateEnd),
    backend.slice(0, bootstrapEnd),
  ].join("\n"), context);
  return {
    api: context,
    reads,
    diagnostics,
    scheduled,
    server: (value: Record<string, unknown>) => { serverSettings = { ...serverSettings, ...value }; },
    failSettings: () => { settingsFailures++; },
    holdNextSave: () => {
      const held = deferred<Record<string, unknown>>();
      heldSaves.push(held);
      return held;
    },
    settingsReads: () => settingsReads,
    removals: () => removals,
  };
}

test("backend settings arriving after the early disabled read unlock the startup loading state", async () => {
  const f = harness();
  await f.api.loadCodexServiceTierState();
  assert.equal(f.api.codexServiceTierState.status, "idle");
  assert.equal(f.reads.length, 0);
  assert.equal(await f.api.loadBackendSettings(), true);
  assert.equal(f.reads.length, 1);
  assert.equal(f.api.codexServiceTierState.status, "loading");
  f.reads[0].resolve(inherited("priority"));
  await flush();
  assert.equal(f.api.codexServiceTierState.status, "ok");
  assert.equal(f.api.codexServiceTierState.serviceTier, "priority");
  assert.equal(f.api.codexServiceTierState.message, "Fast 已开启");
});

test("startup retries unavailable settings and reads Fast state after the first successful response", async () => {
  const f = harness();
  f.failSettings();
  f.api.loadBackendSettingsForStartup();
  await flush();
  assert.equal(f.settingsReads(), 1);
  assert.equal(f.reads.length, 0);
  assert.equal(f.scheduled.length, 1);
  f.scheduled.shift()!();
  await flush();
  assert.equal(f.settingsReads(), 2);
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(inherited(null));
  await flush();
  assert.equal(f.api.codexServiceTierState.status, "ok");
});

test("disabled backend settings settle startup without starting a service-tier read", async () => {
  const f = harness();
  f.server({ codexAppServiceTierControls: false });
  await f.api.loadBackendSettings();
  assert.equal(f.reads.length, 0);
  assert.equal(f.api.codexServiceTierState.status, "idle");
});

test("heartbeat enables Fast once and unchanged heartbeats do not reset a ready button", async () => {
  const f = harness({ codexAppServiceTierControls: false });
  await f.api.syncBackendSettingsFromHeartbeat();
  assert.equal(f.reads.length, 1);
  await f.api.syncBackendSettingsFromHeartbeat();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(inherited(null));
  await flush();
  await f.api.syncBackendSettingsFromHeartbeat();
  assert.equal(f.reads.length, 1);
  assert.equal(f.api.codexServiceTierState.status, "ok");
});

test("simultaneous service-tier reads share one request and the next explicit refresh can read again", async () => {
  const f = harness({ codexAppServiceTierControls: true });
  const first = f.api.loadCodexServiceTierState();
  const second = f.api.loadCodexServiceTierState();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(inherited("priority"));
  await Promise.all([first, second]);
  const third = f.api.loadCodexServiceTierState();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(inherited(null));
  await third;
  assert.equal(f.api.codexServiceTierState.serviceTier, null);
});

test("a failed service-tier read reports failure and releases the single-flight request for retry", async () => {
  const f = harness({ codexAppServiceTierControls: true });
  const first = f.api.loadCodexServiceTierState();
  f.reads[0].reject(new Error("app setting and catalog unavailable"));
  await first;
  assert.equal(f.api.codexServiceTierState.status, "failed");
  assert.deepEqual(f.diagnostics, ["service_tier_read_failed"]);
  const retry = f.api.loadCodexServiceTierState();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(inherited(null));
  await retry;
  assert.equal(f.api.codexServiceTierState.status, "ok");
});

test("a failed service-tier read is retried by an unchanged successful heartbeat", async () => {
  const f = harness({ codexAppServiceTierControls: true });
  const first = f.api.loadCodexServiceTierState();
  f.reads[0].reject(new Error("temporary service-tier read failure"));
  await first;
  assert.equal(f.api.codexServiceTierState.status, "failed");
  await f.api.syncBackendSettingsFromHeartbeat();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(inherited(null));
  await flush();
  assert.equal(f.api.codexServiceTierState.status, "ok");
});

test("saving the backend Fast toggle starts state loading without waiting for a heartbeat", async () => {
  const f = harness({ codexAppServiceTierControls: false });
  await f.api.setBackendSetting("codexAppServiceTierControls", true);
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(inherited(null));
  await flush();
  assert.equal(f.api.codexServiceTierState.status, "ok");
});

test("enabling the master enhancements switch initializes an already enabled Fast preference", async () => {
  const f = harness({ enhancementsEnabled: false, codexAppServiceTierControls: true });
  await f.api.loadCodexServiceTierState();
  await f.api.setBackendSetting("enhancementsEnabled", true);
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(inherited(null));
  await flush();
  assert.equal(f.api.codexServiceTierState.status, "ok");
});

test("optimistic disabling invalidates pending state before the settings save completes", async () => {
  const f = harness({ codexAppServiceTierControls: true });
  const pending = f.api.loadCodexServiceTierState();
  const saved = f.holdNextSave();
  const disabling = f.api.setBackendSetting("codexAppServiceTierControls", false);
  assert.equal(f.api.codexServiceTierState.status, "idle");
  f.reads[0].resolve(inherited("priority"));
  await pending;
  assert.equal(f.api.codexServiceTierState.status, "idle");
  saved.resolve({ enhancementsEnabled: true, codexAppServiceTierControls: false });
  await disabling;
  assert.equal(f.api.codexServiceTierState.serviceTier, null);
});

test("a backend response that disables Fast cancels the optimistic service-tier read", async () => {
  const f = harness({ codexAppServiceTierControls: false });
  const saved = f.holdNextSave();
  const enabling = f.api.setBackendSetting("codexAppServiceTierControls", true);
  assert.equal(f.reads.length, 1);
  saved.resolve({ enhancementsEnabled: true, codexAppServiceTierControls: false });
  await enabling;
  assert.equal(f.api.codexServiceTierState.status, "idle");
  assert.ok(f.removals() > 0);
  f.reads[0].resolve(inherited("priority"));
  await flush();
  assert.equal(f.api.codexServiceTierState.status, "idle");
  assert.equal(f.api.codexServiceTierState.serviceTier, null);
});

test("an older settings save cannot undo a newer Fast enable when responses arrive out of order", async () => {
  const f = harness({ codexAppServiceTierControls: true });
  const oldSave = f.holdNextSave();
  const disabling = f.api.setBackendSetting("codexAppServiceTierControls", false);
  const newSave = f.holdNextSave();
  const enabling = f.api.setBackendSetting("codexAppServiceTierControls", true);
  assert.equal(f.reads.length, 1);
  newSave.resolve({ enhancementsEnabled: true, codexAppServiceTierControls: true });
  await enabling;
  f.reads[0].resolve(inherited("priority"));
  await flush();
  oldSave.resolve({ enhancementsEnabled: true, codexAppServiceTierControls: false });
  await disabling;
  assert.equal(f.api.alunixaXSettings().serviceTierControls, true);
  assert.equal(f.api.codexServiceTierState.status, "ok");
  assert.equal(f.api.codexServiceTierState.serviceTier, "priority");
});

for (const source of ["heartbeat", "backend toggle"] as const) {
  test(`${source} disabling Fast invalidates an outstanding read`, async () => {
    const f = harness({ codexAppServiceTierControls: true });
    const pending = f.api.loadCodexServiceTierState();
    if (source === "heartbeat") {
      f.server({ codexAppServiceTierControls: false });
      await f.api.syncBackendSettingsFromHeartbeat();
    } else {
      await f.api.setBackendSetting("codexAppServiceTierControls", false);
    }
    assert.equal(f.api.codexServiceTierState.status, "idle");
    assert.ok(f.removals() > 0);
    f.reads[0].resolve(inherited("priority"));
    await pending;
    assert.equal(f.api.codexServiceTierState.status, "idle");
    assert.equal(f.api.codexServiceTierState.serviceTier, null);
  });
}

for (const staleResult of ["success", "failure"] as const) {
  test(`disable and re-enable starts a fresh read and ignores the stale ${staleResult}`, async () => {
    const f = harness({ codexAppServiceTierControls: true });
    const first = f.api.loadCodexServiceTierState();
    await f.api.setBackendSetting("codexAppServiceTierControls", false);
    await f.api.setBackendSetting("codexAppServiceTierControls", true);
    assert.equal(f.reads.length, 2, "re-enabling must not reuse the invalidated read");
    assert.equal(f.api.codexServiceTierState.status, "loading");
    if (staleResult === "success") f.reads[0].resolve(inherited("priority"));
    else f.reads[0].reject(new Error("stale read"));
    await first;
    assert.equal(f.api.codexServiceTierState.status, "loading");
    assert.deepEqual(f.diagnostics, [], "an invalidated request cannot report a current failure");
    const duplicate = f.api.loadCodexServiceTierState();
    assert.equal(f.reads.length, 2, "stale completion cannot release the new in-flight request");
    f.reads[1].resolve(inherited(null));
    await duplicate;
    assert.equal(f.api.codexServiceTierState.status, "ok");
    assert.equal(f.api.codexServiceTierState.serviceTier, null);
  });
}
