import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

const healthSource = readFileSync(new URL("../../../crates/alunixa-x-core/src/runtime_health.rs", import.meta.url), "utf8");
const recoveryScript = healthSource.match(/const LOCAL_APP_SERVER_RECOVERY_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1];
assert.ok(recoveryScript);

const renderer = readFileSync(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
function source(name: string) {
  const match = renderer.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}`, "m"));
  assert.ok(match, name);
  return match[0];
}
function compile(name: string, dependencies: Record<string, unknown> = {}) {
  return new Function(...Object.keys(dependencies), `${source(name)}; return ${name};`)(...Object.values(dependencies));
}
const functionSource = (value: unknown) => typeof value === "function" ? Function.prototype.toString.call(value) : "";

test("modern shared bundle uses native setting fallback without invoking unrelated minified exports", async () => {
  const calls: Array<{ method: unknown; params: unknown }> = [];
  const bridge = async (method: string, _request: unknown) => method;
  const read = async (key: string) => bridge("get-setting", { params: { key } });
  const write = async (key: string, value: unknown) => bridge("set-setting", { params: { key, value } });
  async function rpc(method: unknown, { params, select, signal, source, ...rest }: Record<string, unknown>) {
    const endpoint = method === "get-global-state" ? "get-global-state" : "set-global-state";
    calls.push({ method, params });
    return { method, endpoint, params, select, signal, source, value: "priority", ...rest };
  }
  const wrong = () => { throw new Error("unrelated minified export must not run"); };
  const shared = { n: wrong, s: wrong, changedRead: read, changedWrite: write, changedRpc: rpc };
  const storageResolver = compile("codexSettingStorageFromModule");
  const rpcResolver = compile("codexStateApiFromModule", {
    codexStateCallByCapability: compile("codexStateCallByCapability"),
  });
  const load = async (prefix: string) => {
    if (prefix === "app-shared-") return shared;
    if (prefix === "app-initial-") return {};
    throw new Error("old chunk absent");
  };
  assert.equal(storageResolver(shared, "app-shared-").n, read);
  assert.equal(storageResolver(shared, "app-shared-").s, write);
  assert.equal(rpcResolver(shared, "app-shared-"), rpc);
  const getStateApi = new Function("loadCodexAppModule", "codexStateApiFromModule",
    `let codexStateApiPromise = null; ${source("codexStateApi")}; return codexStateApi;`)(load, rpcResolver);
  assert.equal(await getStateApi(), rpc);
  assert.equal(await getStateApi(), rpc);
  const legacyStorage = compile("codexSettingStorageModule", {
    loadCodexAppModule: load, codexSettingStorageFromModule: storageResolver,
  });
  const deadlines: number[] = [];
  const getSetting = compile("getCodexServiceTierSetting", {
    codexSettingStorageModule: legacyStorage,
    codexDefaultServiceTierSetting: { key: "default-service-tier", default: null },
    codexServiceTierReadTimeoutMs: 5000,
    codexStateCall: async (method: string, request: Record<string, unknown>) => (await getStateApi())(method, request),
    setTimeout: (_callback: Function, delay: number) => { deadlines.push(delay); return deadlines.length; },
  });
  assert.equal(await getSetting(), "priority");
  assert.deepEqual(calls, [{ method: "get-setting", params: { key: "default-service-tier" } }]);
  assert.ok(deadlines.length <= 2 && deadlines.every(delay => delay === 5000));
});

test("dispatcher discovery through the actual installer supports split and legacy layouts without invoking unrelated exports", async () => {
  for (const location of ["app-shared-", "app-initial-"]) {
    const deliveries: Array<[unknown, unknown, unknown]> = [];
    const original = function (this: unknown, type: unknown, payload: unknown) {
      deliveries.push([this, type, payload]);
      return "native-result";
    };
    const dispatcher = { dispatchMessage: original, subscribe() {} };
    const registrations: Array<[unknown, string]> = [];
    const context = vm.createContext({
      window: {},
      codexServiceTierRequestOverrideVersion: "fixture",
      serviceTierDispatcherPatchMaxMisses: 8,
      serviceTierDispatcherPatchMissCount: 0,
      serviceTierDispatcherPatchDisabled: false,
      serviceTierDispatcherPatchPromise: null,
      loadCodexAppModule: async (prefix: string) => prefix === location
        ? { changedName: dispatcher, unrelated: () => { throw new Error("unrelated export invoked"); } } : {},
      codexServiceTierDispatcherFromModule: compile("codexServiceTierDispatcherFromModule"),
      codexServiceTierDispatcherPatchable: compile("codexServiceTierDispatcherPatchable"),
      installCodexRemoteSessionDispatcherSubscription: (value: unknown, prefix: string) => registrations.push([value, prefix]),
      dispatchCodexPlusMessage: compile("dispatchCodexPlusMessage", {
        codexServiceTierRequestOverride: (value: unknown) => value,
        observeCodexRemoteSessionNotification: () => { throw new Error("unrelated notification"); },
      }),
      sendCodexPlusDiagnostic: () => {},
    });
    vm.runInContext(source("installCodexServiceTierDispatcherPatch"), context);
    context.installCodexServiceTierDispatcherPatch();
    await context.serviceTierDispatcherPatchPromise;
    assert.equal(registrations[0]?.[0], dispatcher, location);
    assert.equal(registrations[0]?.[1], location);
    assert.notEqual(dispatcher.dispatchMessage, original);
    const payload = { hostId: "local", fixture: "preserve" };
    assert.equal((dispatcher.dispatchMessage as Function)("native-message", payload), "native-result");
    assert.deepEqual(deliveries, [[dispatcher, "native-message", payload]]);
    const patched = dispatcher.dispatchMessage;
    context.installCodexServiceTierDispatcherPatch();
    assert.equal(dispatcher.dispatchMessage, patched, "successful installation must not wrap again");
  }
});

test("retired shared terminal stops the previous runtime once without invoking exports or touching sessions", () => {
  const timers = new Set(["poll", "heartbeat", "retention"]);
  const listeners = new Set(["snapshot", "activity"]);
  const records = [{ threadId: "fixture-thread", sessionId: "fixture-session" }];
  let disposals = 0;
  const runtime = { dispose() { disposals++; timers.clear(); listeners.clear(); } };
  const window = { __alunixaXSharedTerminalRuntime: runtime };
  const retired = new WeakSet();
  const retire = compile("retireCodexSharedTerminalRuntime", {
    window, codexRetiredSharedTerminalRuntimes: retired,
    loadCodexAppModule: () => { throw new Error("retired runtime must not load unrelated exports"); },
    localStorage: { setItem: () => { throw new Error("retirement must preserve session records"); } },
  });
  assert.equal(retire(), true);
  for (let i = 0; i < 20; i++) assert.equal(retire(), false);
  assert.equal(disposals, 1);
  assert.equal(timers.size + listeners.size, 0);
  assert.deepEqual(records, [{ threadId: "fixture-thread", sessionId: "fixture-session" }]);
  assert.match(source("scanDeferred"), /retireCodexSharedTerminalRuntime\(\)/);
  assert.doesNotMatch(renderer, /function (?:loadCodexTerminalManager|installCodexSharedTerminalRuntime)\(/);
  assert.doesNotMatch(renderer, /postJson\("\/shared-terminal\//);
});

test("shared terminal retirement disables legacy runtimes and bounds cleanup failures", () => {
  const calls: boolean[] = [];
  const retired = new WeakSet();
  const window = { __alunixaXSharedTerminalRuntime: {
    dispose() { throw new Error("fixture-private-path"); },
    setEnabled(value: boolean) { calls.push(value); },
  } };
  const retire = compile("retireCodexSharedTerminalRuntime", { window, codexRetiredSharedTerminalRuntimes: retired });
  assert.equal(retire(), true);
  assert.equal(retire(), false);
  assert.deepEqual(calls, [false]);
  window.__alunixaXSharedTerminalRuntime = {
    dispose() { throw new Error("second fixture-private-path"); },
    setEnabled() { throw new Error("cleanup failure"); },
  };
  assert.doesNotThrow(() => retire());
  assert.equal(retire(), false, "failed cleanup must not cause an unbounded scan loop");
});

function nativeRecoveryFixture(initial: Record<string, unknown> | null) {
  let connection = initial;
  let mode = "normal";
  const calls: Record<string, any>[] = [];
  const listeners = new Set<(event: unknown) => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const win: Record<string, any> = {
    addEventListener: (_: string, fn: (event: unknown) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: unknown) => void) => listeners.delete(fn),
    setTimeout: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
    electronBridge: { sendMessageFromView: (message: Record<string, any>) => {
      calls.push(message);
      if (message.type !== "fetch") {
        if (mode === "restart-reject") return Promise.reject(new Error("fixture-private-path"));
        return new Promise(() => {}); // A restart IPC can remain pending during handshake.
      }
      if (mode === "query-throw") throw new Error("fixture-secret");
      if (mode === "query-reject") return Promise.reject(new Error("fixture-secret"));
      if (mode === "timeout") return Promise.resolve();
      // The native fetch handler spreads the JSON body directly into the endpoint.
      // A nested `params` object queries an undefined host and returns disconnected.
      const { hostId } = JSON.parse(message.body);
      const response = hostId === "local" ? connection : { state: "disconnected", error: null };
      queueMicrotask(() => {
        for (const fn of [...listeners]) fn({ data: { type: "fetch-response", requestId: message.requestId,
          responseType: mode === "query-error" ? "error" : "success",
          bodyJsonString: mode === "malformed" ? "{" : JSON.stringify(response) } });
      });
      return Promise.resolve();
    } },
  };
  const context = vm.createContext({ window: win, crypto: { randomUUID } });
  return { win, calls, listeners, timers,
    setConnection: (next: Record<string, unknown>) => { connection = next; },
    setMode: (next: string) => { mode = next; },
    run: async () => JSON.parse(await vm.runInContext(recoveryScript!, context, { timeout: 1000 })),
  };
}

test("native startup recovery queries actual local state and restarts without AX injection", async () => {
  const fixture = nativeRecoveryFixture({ state: "connecting", error: null });
  assert.equal(fixture.win.__alunixaXRecoverLocalAppServer, undefined);
  assert.deepEqual(await fixture.run(), { status: "requested", state: "connecting", errorCode: null });
  assert.equal(fixture.calls[0].url, "vscode://codex/app-server-connection-state");
  assert.deepEqual(JSON.parse(fixture.calls[0].body), { hostId: "local" });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls[1])), {
    type: "codex-app-server-restart", hostId: "local", intent: "restart", errorMessage: null,
  });
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.timers.size, 0);
});

test("native startup recovery is one-shot even for concurrent probes and rejected restart IPC", async () => {
  for (const mode of ["normal", "restart-reject"]) {
    const fixture = nativeRecoveryFixture({ state: "error", error: { code: "connection-failed", message: "fixture-secret" } });
    fixture.setMode(mode);
    const reports = await Promise.all([fixture.run(), fixture.run(), fixture.run()]);
    await fixture.run();
    assert.equal(fixture.calls.filter(call => call.type === "codex-app-server-restart").length, 1);
    assert.ok(!JSON.stringify(reports).includes("fixture-secret"));
    if (mode === "restart-reject") assert.equal((await fixture.run()).status, "failed");
    fixture.setConnection({ state: "connected", error: null });
    assert.equal((await fixture.run()).status, "connected");
  }
});

test("healthy, already restarting, unknown and login/update/config states never restart", async () => {
  for (const connection of [null, { state: "connected" }, { state: "restarting" }, { state: "unexpected" },
    { state: "error" }, { state: "error", error: { code: "login-required" } },
    { state: "error", error: { code: "update-required" } },
    { state: "error", error: { code: "config-invalid", message: "fixture-secret" } }]) {
    const fixture = nativeRecoveryFixture(connection);
    const report = await fixture.run();
    assert.equal(fixture.calls.filter(call => call.type === "codex-app-server-restart").length, 0);
    assert.ok(!JSON.stringify(report).includes("fixture-secret"));
    assert.equal(fixture.listeners.size, 0);
  }
});

test("unavailable native IPC fails closed and cleans timers/listeners", async () => {
  for (const mode of ["query-throw", "query-reject", "query-error", "malformed", "timeout"]) {
    const fixture = nativeRecoveryFixture({ state: "connecting" });
    fixture.setMode(mode);
    const pending = fixture.run();
    if (mode === "timeout") for (const expire of [...fixture.timers.values()]) expire();
    assert.equal((await pending).status, "unavailable");
    assert.equal(fixture.calls.filter(call => call.type === "codex-app-server-restart").length, 0);
    assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.timers.size, 0);
  }
  const fixture = nativeRecoveryFixture(null);
  fixture.win.electronBridge = undefined;
  assert.equal((await fixture.run()).status, "unavailable");
});

test("captured-client candidates prioritize shared services, retain legacy bundles and cap scanning", () => {
  const urls = ["app-initial-old.js", "app-main-old.js", "app-shared-new.js", "app-primary-new.js"]
    .map((name) => `app://-/assets/${name}`);
  const hints = renderer.match(/^  const codexAppServerClientBundleHints = [\s\S]*?;$/m)?.[0];
  assert.ok(hints);
  const candidateUrls = new Function("codexAppAssetCandidateUrls", `
    ${hints}
    const codexAppServerClientAssetFetchLimit = 24;
    ${source("codexAppServerClientAssetCandidateUrls")}
    return codexAppServerClientAssetCandidateUrls;
  `);
  const result = candidateUrls(() => urls)();
  assert.equal(result[0], urls[2]);
  assert.deepEqual(new Set(result), new Set(urls));
  const crowded = [...urls, ...Array.from({ length: 50 }, (_, index) => `app://-/assets/unrelated-${index}.js`)];
  assert.equal(candidateUrls(() => crowded)().length, 24);
  assert.deepEqual(urls, ["app-initial-old.js", "app-main-old.js", "app-shared-new.js", "app-primary-new.js"]
    .map(name => `app://-/assets/${name}`), "candidate sorting must not mutate native discovery input");
});

function retiredStartupBoot(win: Record<string, any>) {
  const prelude = readFileSync(new URL("../../../assets/inject/renderer-inject/00-prelude.js", import.meta.url), "utf8");
  const end = prelude.indexOf("  const helperBase =");
  assert.ok(end > 0);
  vm.runInNewContext(`${prelude.slice(0, end)}\n})();`, {
    window: win, navigator: { userAgent: "fixture" }, process: { versions: { node: "fixture" } },
  });
}

test("retired fast startup flags leave native initialization and fetch ownership unchanged", async () => {
  const calls: unknown[][] = [];
  const statsig = { loadingStatus: "Loading", initializeAsync: () => Promise.reject(new Error("native failure")) };
  const originalInitialize = statsig.initializeAsync;
  const originalFetch = async (...args: unknown[]) => { calls.push(args); return { ok: true }; };
  const unexpected: unknown[] = [];
  const win: Record<string, any> = {
    __ALUNIXA_X_FAST_STARTUP__: { enabled: true, statsigTimeoutMs: 100 },
    __STATSIG__: { firstInstance: statsig }, fetch: originalFetch,
    setTimeout: (...args: unknown[]) => unexpected.push(args),
    setInterval: (...args: unknown[]) => unexpected.push(args),
  };
  retiredStartupBoot(win);
  retiredStartupBoot(win);
  assert.equal(win.fetch, originalFetch);
  assert.equal(statsig.loadingStatus, "Loading");
  assert.equal(statsig.initializeAsync, originalInitialize);
  await assert.rejects(statsig.initializeAsync(), /native failure/);
  const request = new Request("https://example.test/v1/responses");
  await win.fetch(request);
  assert.equal(calls[0][0], request);
  assert.equal(calls[0][1], undefined);
  const controller = new AbortController(); controller.abort();
  const aborted = new Request("https://ab.chatgpt.com/config", { signal: controller.signal });
  await win.fetch(aborted);
  assert.equal(calls[1][0], aborted);
  assert.equal((calls[1][0] as Request).signal.aborted, true);
  assert.deepEqual(unexpected, [], "retired startup cannot create new polling or timeout work");
  assert.doesNotMatch(renderer, /function install(?:AlunixaX|CodexPlus)FastStartup\(|__alunixaXFastStartup|statsigTimeoutMs/);
});

test("retired startup never turns a native timeout into synthetic initialization success", async () => {
  const failure = new Error("native timeout");
  const nativeFetch = (_input?: unknown) => Promise.reject(failure);
  const initializeAsync = () => Promise.reject(failure);
  const client = Object.freeze({ initializeAsync, loadingStatus: "Loading" });
  const win: Record<string, any> = {
    __ALUNIXA_X_FAST_STARTUP__: { enabled: true, statsigTimeoutMs: 1 },
    __STATSIG__: Object.freeze({ firstInstance: client }), fetch: nativeFetch,
  };
  retiredStartupBoot(win);
  assert.equal(win.fetch, nativeFetch);
  assert.equal(client.initializeAsync, initializeAsync);
  assert.equal(client.loadingStatus, "Loading");
  await assert.rejects(win.fetch("https://ab.chatgpt.com/config"), (error: unknown) => error === failure);
  await assert.rejects(client.initializeAsync(), (error: unknown) => error === failure);
});
