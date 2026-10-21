import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/31-config-read-deadline.js", import.meta.url), "utf8");
const configUrl = "vscode://codex/mcp-codex-config";

function fixture() {
  const handlers = new Map<string, Set<(event: any) => void>>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const sent: any[] = [], replies: any[] = [], diagnostics: any[] = [];
  let timerId = 0;
  class MessageEvent {
    constructor(type: string, init: object) { Object.assign(this, { type }, init); }
  }
  const window = {
    location: { origin: "app://-" },
    electronBridge: {
      sendMessageFromView(message: any) { sent.push(message); return Promise.resolve(); },
    },
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId; timers.set(id, { callback, delay }); return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener(type: string, callback: (event: any) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(callback);
    },
    dispatchEvent(event: any) {
      if (event.type === "message") replies.push(event.data);
      for (const callback of handlers.get(event.type) || []) callback(event);
      return true;
    },
  };
  const context = vm.createContext({
    window, MessageEvent, CustomEvent: MessageEvent,
    sendCodexPlusDiagnostic: (...args: any[]) => diagnostics.push(args),
  });
  const install = () => vm.runInContext(`${source}\ninstallCodexConfigReadDeadline();`, context);
  install();
  const outgoing = (message: any) => {
    window.electronBridge.sendMessageFromView(message);
    window.dispatchEvent({ type: "codex-message-from-view", detail: message, __codexForwardedViaBridge: true });
  };
  const read = (requestId = "read", overrides: object = {}) =>
    outgoing({ type: "fetch", method: "POST", requestId, url: configUrl, ...overrides });
  const respond = (requestId = "read", overrides: object = {}, eventOverrides: object = {}) =>
    window.dispatchEvent({ type: "message", source: null, origin: "", data: {
      type: "fetch-response", requestId, responseType: "success", status: 200,
      bodyJsonString: '{"config":{}}', ...overrides,
    }, ...eventOverrides });
  const expire = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.callback();
    }
  };
  return { window, handlers, timers, sent, replies, diagnostics, read, respond, outgoing, expire, install };
}

test("lost config response is cancelled and rejected through the native response path", async () => {
  const f = fixture();
  // 原生 WebFetch 的关键合约：按 ID 清理 pending，再 resolve/reject。
  const nativePending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  f.window.addEventListener("message", ({ data }) => {
    const request = nativePending.get(data?.requestId);
    if (!request) return;
    nativePending.delete(data.requestId);
    if (data.responseType === "error") request.reject(new Error(data.error));
    else request.resolve(data);
  });
  let sending = true, turnStarts = 0;
  const request = new Promise((resolve, reject) => nativePending.set("read", { resolve, reject }));
  const submission = request.then(() => { turnStarts++; }).finally(() => { sending = false; });
  const failure = assert.rejects(submission, /Timed out reading Codex configuration/);
  f.read();
  assert.equal(sending, true);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 15_000);
  f.expire();
  await failure;
  assert.equal(sending, false);
  assert.equal(nativePending.size, 0);
  assert.equal(turnStarts, 0);
  assert.deepEqual(f.sent.map(({ type }) => type), ["fetch", "cancel-fetch"]);
  assert.equal(f.replies[0].status, 408);
  f.respond(); // 原生忽略迟到响应；不得恢复旧提交或自动重试。
  assert.equal(turnStarts, 0);
  assert.equal(f.sent.length, 2);
});

test("normal success and errors clear deadlines without changing responses", () => {
  for (const response of [{}, { responseType: "error", status: 500, error: "fixture" }]) {
    const f = fixture();
    f.read();
    f.respond("read", response);
    assert.equal(f.timers.size, 0);
    f.expire();
    assert.equal(f.sent.length, 1);
    assert.equal(f.replies.length, 1);
    assert.deepEqual(f.replies[0], {
      type: "fetch-response", requestId: "read", responseType: "success", status: 200,
      bodyJsonString: '{"config":{}}', ...response,
    });
  }
});

test("caller cancellation clears its own deadline and preserves other reads", () => {
  const f = fixture();
  f.read("first");
  f.read("second");
  f.outgoing({ type: "cancel-fetch", requestId: "first" });
  assert.equal(f.timers.size, 1);
  f.expire();
  assert.deepEqual(f.replies.map(({ requestId }) => requestId), ["second"]);
  assert.deepEqual(f.sent.filter(({ type }) => type === "cancel-fetch").map(({ requestId }) => requestId), ["first", "second"]);
});

test("mirror duplicates and reinjection retain one original deadline and one cancellation", () => {
  const f = fixture();
  f.read();
  const timer = [...f.timers.keys()][0];
  f.install();
  f.window.dispatchEvent({ type: "codex-message-from-view", __codexForwardedViaBridge: true, detail: {
    type: "fetch", method: "POST", requestId: "read", url: configUrl,
  } });
  assert.deepEqual([...f.timers.keys()], [timer]);
  assert.equal(f.handlers.get("message")!.size, 1);
  assert.equal(f.handlers.get("codex-message-from-view")!.size, 1);
  f.expire();
  assert.equal(f.replies.length, 1);
  assert.equal(f.sent.filter(({ type }) => type === "cancel-fetch").length, 1);
});

test("write operations, other reads, malformed IDs and paths are untouched", () => {
  const f = fixture();
  for (const url of ["vscode://codex/set-setting", "vscode://codex/config/read",
    "vscode://codex/mcp-codex-config?query=1", "https://example.test/mcp-codex-config"]) f.read(url, { url });
  f.read("put", { method: "PUT" });
  f.read("", {});
  f.read("bad-id", { requestId: 1 });
  f.window.dispatchEvent({ type: "codex-message-from-view", detail: {
    type: "fetch", method: "POST", requestId: "unforwarded", url: configUrl,
  } });
  f.outgoing({ type: "mcp-request", request: { id: "write", method: "turn/start" } });
  assert.equal(f.timers.size, 0);
  f.expire();
  assert.equal(f.replies.length, 0);
});

test("foreign response events cannot cancel a local config deadline", () => {
  const f = fixture();
  f.read();
  f.respond("read", {}, { source: {}, origin: "https://example.test" });
  f.respond("read", {}, { source: f.window, origin: "https://example.test" });
  assert.equal(f.timers.size, 1);
  f.respond("read", {}, { source: f.window, origin: "app://-" });
  assert.equal(f.timers.size, 0);
});

test("a host cancellation failure still releases the native waiter", () => {
  const f = fixture();
  f.read();
  f.window.electronBridge.sendMessageFromView = () => { throw new Error("fixture disconnected bridge"); };
  f.expire();
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].responseType, "error");
  assert.equal(f.timers.size, 0);
});

test("an asynchronous cancellation failure and its mirror cannot block the timeout error", async () => {
  const f = fixture();
  f.read();
  f.window.electronBridge.sendMessageFromView = (message) => {
    f.window.dispatchEvent({
      type: "codex-message-from-view", detail: message, __codexForwardedViaBridge: true,
    });
    return Promise.reject(new Error("fixture rejected cancellation"));
  };
  f.expire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].responseType, "error");
  assert.equal(f.timers.size, 0);
});

test("a settled timer cannot cancel a later read that reuses the ID", () => {
  const f = fixture();
  f.read();
  const oldTimer = [...f.timers.values()][0];
  f.respond();
  f.read();
  oldTimer.callback();
  assert.equal(f.sent.length, 2);
  assert.equal(f.replies.length, 1);
  assert.equal(f.timers.size, 1);
  f.expire();
  assert.equal(f.replies.length, 2);
});
