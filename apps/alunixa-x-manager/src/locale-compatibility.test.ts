import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const renderer = readFileSync(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
const source = renderer.match(/^  function installAlunixaXForceChineseLocale\([\s\S]*?^  \}/m)?.[0];
assert.ok(source);
const managedKey = "alunixaX.forceChineseLocale.managed.v1";

function storage(initial: Array<[string, string]> = []) {
  const values = new Map(initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function client(methods = ["getLayer", "getDynamicConfig"]) {
  const layer = Object.freeze({
    value: Object.freeze({ enable_i18n: false, locale_source: "IDE", unrelated: 42 }),
    get(key: string, fallback: unknown, options?: unknown) {
      assert.equal(this, layer);
      if (options) assert.deepEqual(options, { preserve: true });
      return (this.value as Record<string, unknown>)[key] ?? fallback;
    },
  });
  const calls: unknown[][] = [];
  const value: Record<string, any> = {};
  for (const method of methods) {
    value[method] = function (...args: unknown[]) {
      assert.equal(this, value);
      calls.push([method, ...args]);
      return layer;
    };
  }
  return { value, layer, calls };
}

function harness(options: {
  enabled?: boolean; readyState?: string; setting?: string | null;
  statsig?: Record<string, any>; local?: ReturnType<typeof storage>; session?: ReturnType<typeof storage>;
  noBridge?: boolean; blockedStorage?: boolean; failRequests?: number; invalidResponse?: boolean;
} = {}) {
  let now = 0;
  let nextTimer = 0;
  let setting: string | null = options.setting ?? null;
  let reloads = 0;
  let failures = options.failRequests ?? 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const listeners = new Set<(event: any) => void>();
  const requests: Array<{ method: string; params: Record<string, any> }> = [];
  const local = options.local ?? storage();
  const session = options.session ?? storage();
  const navigator = { language: "en-US", languages: ["en-US", "en"] };
  const window: Record<string, any> = {
    __ALUNIXA_X_FORCE_CHINESE_LOCALE__: { enabled: options.enabled ?? true, locale: "zh-CN" },
    __STATSIG__: options.statsig,
    localStorage: local,
    sessionStorage: options.blockedStorage ? {
      getItem() { throw new Error("Storage denied"); },
    } : session,
    location: { reload() { reloads++; } },
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener(type: string, listener: (event: any) => void) {
      assert.equal(type, "message");
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: any) => void) {
      listeners.delete(listener);
    },
  };
  const bridge = {
    sendMessageFromView(message: any) {
      const method = message.url.split("/").pop();
      const { params } = JSON.parse(message.body);
      requests.push({ method, params });
      if (failures-- > 0) throw new Error("Bridge starting");
      if (method === "set-setting") setting = params.value;
      const response = {
        type: "fetch-response", requestId: message.requestId, responseType: "success",
        bodyJsonString: JSON.stringify(options.invalidResponse ? {} : { value: setting }),
      };
      for (const listener of [...listeners]) listener({ data: response });
    },
  };
  if (!options.noBridge) window.electronBridge = bridge;
  const install = new Function("window", "navigator", "document", "Date",
    `${source}; return installAlunixaXForceChineseLocale;`)(
      window, navigator, { readyState: options.readyState ?? "loading" }, { now: () => now },
    );
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const advance = async (milliseconds: number) => {
    const until = now + milliseconds;
    for (let i = 0; i < 1000; i++) {
      await flush();
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = until;
    await flush();
  };
  return {
    window, navigator, bridge, local, session, install, flush, advance, requests, timers, listeners,
    get setting() { return setting; },
    set setting(value: string | null) { setting = value; },
    get reloads() { return reloads; },
  };
}

test("current getLayer and legacy DynamicConfig activate Chinese without altering other flags", async () => {
  const statsig = client();
  const h = harness({ statsig: { firstInstance: statsig.value }, setting: "zh-CN" });
  h.install();
  await h.flush();
  for (const method of ["getLayer", "getDynamicConfig"]) {
    const config = statsig.value[method]("72216192", { disableExposureLog: true });
    assert.equal(config.get("enable_i18n", false), true);
    assert.equal(config.get("locale_source", "IDE"), "SYSTEM");
    assert.equal(config.get("unrelated", 0, { preserve: true }), 42);
    assert.equal(config.value.enable_i18n, true);
    assert.equal(statsig.value[method]("unrelated-config"), statsig.layer);
    assert.equal(statsig.value[method]("72216192"), config);
  }
  assert.equal(statsig.layer.get("enable_i18n", true), false);
  assert.equal(h.reloads, 0);
  assert.equal(h.window.__alunixaXForceChineseLocaleRuntime.status, "ok");
});

test("a Layer-only client works without the removed DynamicConfig API", async () => {
  const statsig = client(["getLayer"]);
  const h = harness({ statsig: { instances: { desktop: statsig.value } }, setting: "zh-CN" });
  h.install();
  await h.flush();
  assert.equal(statsig.value.getLayer("72216192").get("enable_i18n", false), true);
  assert.equal(h.window.__alunixaXForceChineseLocaleRuntime.patchedClients, 1);
});

test("unavailable Statsig getters and immutable roots do not prevent other clients from working", async () => {
  const statsig = client(["getLayer"]);
  Object.defineProperty(statsig.value, "getDynamicConfig", { get() { throw new Error("Not initialized"); } });
  const root = Object.freeze({
    firstInstance: statsig.value,
    instance() { throw new Error("No default client"); },
  });
  const h = harness({ statsig: root, setting: "zh-CN" });
  assert.doesNotThrow(() => h.install());
  await h.flush();
  assert.equal(statsig.value.getLayer("72216192").get("enable_i18n", false), true);
  assert.equal(h.setting, "zh-CN");
});

test("already selected Chinese with a mounted English provider reloads at most once", async () => {
  const session = storage();
  for (let i = 0; i < 3; i++) {
    const statsig = client(["getLayer"]);
    const h = harness({ statsig: { firstInstance: statsig.value }, setting: "zh-CN", readyState: "complete", session });
    h.install();
    await h.flush();
    h.install();
    await h.advance(21000);
    assert.equal(h.reloads, i === 0 ? 1 : 0);
    assert.equal(h.requests.length, 1);
  }
});

test("blocked session storage defers reload instead of creating a reload loop", async () => {
  const h = harness({ setting: "en-US", blockedStorage: true });
  h.install();
  await h.flush();
  assert.equal(h.setting, "zh-CN");
  assert.equal(h.reloads, 0);
  assert.equal(h.window.__alunixaXForceChineseLocaleRuntime.status, "reload-deferred");
});

test("slow client registration and bridge initialization recover after the former five-second cutoff", async () => {
  const h = harness({ noBridge: true, setting: "zh-CN" });
  h.install();
  await h.advance(6000);
  const statsig = client(["getLayer"]);
  h.window.__STATSIG__ = { instances: {} };
  h.window.__STATSIG__.instances.desktop = statsig.value;
  h.window.electronBridge = h.bridge;
  await h.advance(6000);
  assert.equal(statsig.value.getLayer("72216192").get("enable_i18n", false), true);
  assert.equal(h.window.__alunixaXForceChineseLocaleRuntime.status, "ok");
  assert.equal(h.requests.length, 1);
});

test("bridge errors retry with a fixed limit and leave no listeners or polling timers", async () => {
  const h = harness({ failRequests: 100 });
  h.install();
  await h.advance(60000);
  assert.equal(h.requests.length, 8);
  assert.equal(h.window.__alunixaXForceChineseLocaleRuntime.status, "failed");
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("malformed official setting responses never overwrite the existing locale", async () => {
  const h = harness({ setting: "ja-JP", invalidResponse: true });
  h.install();
  await h.advance(60000);
  assert.equal(h.setting, "ja-JP");
  assert.ok(h.requests.every((request) => request.method === "get-setting"));
  assert.equal(h.local.getItem(managedKey), null);
});

test("an unavailable backup store prevents changing the user's official locale", async () => {
  const h = harness({ setting: "fr-FR" });
  h.window.localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  h.install();
  await h.advance(60000);
  assert.equal(h.setting, "fr-FR");
  assert.ok(h.requests.every((request) => request.method === "get-setting"));
  assert.equal(h.window.__alunixaXForceChineseLocaleRuntime.status, "failed");
});

test("disabling restores native APIs, navigator and the original automatic locale", async () => {
  const statsig = client();
  const originalGetLayer = statsig.value.getLayer;
  const h = harness({ statsig: { firstInstance: statsig.value }, setting: null });
  h.install();
  await h.flush();
  const cachedLayer = statsig.value.getLayer("72216192");
  assert.equal(h.navigator.language, "zh-CN");
  assert.equal(h.setting, "zh-CN");
  // A retry/re-apply must retain null (auto-detection), not replace it with the applied locale.
  h.window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__.locale = "zh-TW";
  h.install();
  await h.flush();
  h.window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__.enabled = false;
  h.install();
  await h.flush();
  assert.equal(h.setting, null);
  assert.equal(h.navigator.language, "en-US");
  assert.deepEqual(h.navigator.languages, ["en-US", "en"]);
  assert.equal(statsig.value.getLayer, originalGetLayer);
  assert.equal(cachedLayer.get("enable_i18n", false), false);
  assert.equal(h.local.getItem(managedKey), null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
});

test("disable does not overwrite a newer explicit native language choice", async () => {
  const h = harness({ setting: "en-US" });
  h.install();
  await h.flush();
  h.setting = "ja-JP";
  h.window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__.enabled = false;
  h.install();
  await h.flush();
  assert.equal(h.setting, "ja-JP");
  assert.equal(h.local.getItem(managedKey), null);
});

test("turning off while a request is in flight cancels stale work before any setting write", async () => {
  const h = harness({ noBridge: true, setting: "en-US" });
  h.window.electronBridge = { sendMessageFromView() {} };
  h.install();
  assert.equal(h.listeners.size, 1);
  h.window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__.enabled = false;
  h.window.electronBridge = h.bridge;
  h.install();
  await h.advance(60000);
  assert.equal(h.setting, "en-US");
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.filter((request) => request.method === "set-setting").length, 0);
});

test("native permission confirmations are not replaced with automatic clicks or synthetic consent", () => {
  assert.doesNotMatch(source, /full-access|sandbox_mode|approval_policy|ultraFullAccessConfirm/);
  assert.doesNotMatch(source, /\.click\(|onContinueWithFullAccess|dispatchEvent\(/);
});
