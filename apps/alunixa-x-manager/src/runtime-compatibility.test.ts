import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
