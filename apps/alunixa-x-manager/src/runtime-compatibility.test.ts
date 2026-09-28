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

test("modern shared bundle resolves settings and host RPC by shape, not legacy short names", async () => {
  const read = async () => "get-setting";
  const write = async () => "set-setting";
  async function rpc(method: unknown, { params, select, signal, source, ...rest }: Record<string, unknown>) {
    return { method, params, select, signal, source, ...rest };
  }
  const wrong = () => { throw new Error("unrelated minified export must not run"); };
  const shared = { n: wrong, s: wrong, changedRead: read, changedWrite: write, changedRpc: rpc };
  const storageResolver = compile("codexSettingStorageFromModule", { codexModuleFunctionSource: functionSource });
  const rpcResolver = compile("codexHostRpcFromModule", { codexModuleFunctionSource: functionSource });
  const load = async (prefix: string) => {
    if (prefix === "app-shared-") return shared;
    if (prefix === "app-initial-") return {};
    throw new Error("old chunk absent");
  };
  const storage = await compile("codexSettingStorageModule", {
    loadCodexAppModule: load, codexSettingStorageFromModule: storageResolver,
  })();
  assert.equal(storage.n, read);
  assert.equal(storage.s, write);
  const getStateApi = new Function("loadCodexAppModule", "codexHostRpcFromModule",
    `let codexStateApiPromise = null; ${source("codexStateApi")}; return codexStateApi;`)(load, rpcResolver);
  assert.equal(await getStateApi(), rpc);
  assert.equal(await getStateApi(), rpc);
});

test("dispatcher and shared terminal discover both split and legacy layouts without invoking exports", async () => {
  const dispatcher = { dispatchMessage() {}, subscribe() {} };
  const methods = ["create", "attach", "write", "runHeadlessAction", "register", "getSnapshot",
    "getConversationSnapshot", "closeSessionForConversation", "subscribeToSessionSnapshot",
    "addSessionForConversation", "setActiveSessionForConversation", "handleHostEvent"];
  const terminal = Object.fromEntries(methods.map((method) => [method, () => {}]));
  for (const location of ["app-shared-", "app-initial-"]) {
    const load = async (prefix: string) => prefix === location ? { changedName: dispatcher, terminal } : {};
    const result = await compile("loadCodexDispatcher", {
      loadCodexAppModule: load,
      codexServiceTierDispatcherFromModule: compile("codexServiceTierDispatcherFromModule"),
    })();
    assert.equal(result.dispatcher, dispatcher);
    assert.equal(result.assetPrefix, location);
    const actualTerminal = await compile("loadCodexTerminalManager", {
      loadCodexAppModule: load, codexTerminalManagerFromModule: compile("codexTerminalManagerFromModule"),
    })();
    assert.equal(actualTerminal, terminal);
  }
  await assert.rejects(compile("loadCodexTerminalManager", {
    loadCodexAppModule: async () => ({}), codexTerminalManagerFromModule: compile("codexTerminalManagerFromModule"),
  })(), /unavailable/);
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

test("request candidates prioritize shared services without discarding legacy bundles", () => {
  const urls = ["app-initial-old.js", "app-main-old.js", "app-shared-new.js", "app-primary-new.js"]
    .map((name) => `app://-/assets/${name}`);
  const result = compile("appServerFallbackAssetUrls", { codexAppAssetCandidateUrls: () => urls })();
  assert.equal(result[0], urls[2]);
  assert.deepEqual(new Set(result), new Set(urls));
});

test("fast startup preserves native initialization failures and has reversible idempotent fetch ownership", async () => {
  const calls: unknown[][] = [];
  const statsig = { loadingStatus: "Loading", initializeAsync: () => Promise.reject(new Error("native failure")) };
  const originalInitialize = statsig.initializeAsync;
  const originalFetch = async (...args: unknown[]) => { calls.push(args); return { ok: true }; };
  const win: Record<string, any> = {
    __ALUNIXA_X_FAST_STARTUP__: { enabled: true },
    __STATSIG__: { firstInstance: statsig },
    fetch: originalFetch,
    location: { href: "app://-/index.html" },
    setTimeout, clearTimeout,
  };
  const install = compile("installAlunixaXFastStartup", { window: win });
  install();
  const first = win.fetch;
  install();
  assert.equal(win.fetch, first);
  assert.equal(statsig.loadingStatus, "Loading");
  assert.equal(statsig.initializeAsync, originalInitialize);
  await assert.rejects(statsig.initializeAsync(), /native failure/);
  const request = new Request("https://example.test/v1/responses");
  await win.fetch(request);
  assert.equal(calls[0][0], request);
  assert.equal(calls[0][1], undefined);
  const controller = new AbortController();
  controller.abort();
  await win.fetch(new Request("https://ab.chatgpt.com/config", { signal: controller.signal }));
  assert.equal((calls[1][1] as { signal: AbortSignal }).signal.aborted, true);
  win.__ALUNIXA_X_FAST_STARTUP__.enabled = false;
  install();
  assert.equal(win.fetch, originalFetch);
});

test("fast startup deadline aborts telemetry instead of marking initialization successful", async () => {
  const win: Record<string, any> = {
    __ALUNIXA_X_FAST_STARTUP__: { enabled: true, statsigTimeoutMs: 100 },
    fetch: (_input: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    location: { href: "app://-/index.html" }, setTimeout, clearTimeout,
  };
  compile("installAlunixaXFastStartup", { window: win })();
  await assert.rejects(win.fetch("https://ab.chatgpt.com/config"), /aborted/);
});
