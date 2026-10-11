import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const renderer = readFileSync(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
const source = renderer.match(/^  async function restoreCodexPlusManagedLocale\([\s\S]*?^  \}/m)?.[0];
assert.ok(source, "retired locale override must retain its preserving migration");
const managedKey = "alunixaX.forceChineseLocale.managed.v1";
const reloadKey = "alunixaX.forceChineseLocale.reload.v1";
const marker = (previousValue: unknown = null) => JSON.stringify({ previousValue, appliedLocale: "zh-CN" });

function harness(options: { marker?: string | null; current?: unknown; response?: unknown; fail?: string } = {}) {
  const values = new Map<string, string>();
  if (options.marker !== null) values.set(managedKey, options.marker ?? marker());
  values.set("unrelated", "keep");
  const session = new Map([[reloadKey, "old"], ["unrelated", "keep"]]);
  const calls: Array<{ method: string; params: any }> = [];
  let current = options.current === undefined ? "zh-CN" : options.current;
  let pause: (() => Promise<void>) | null = null;
  const window: Record<string, any> = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    },
    sessionStorage: { removeItem: (key: string) => session.delete(key) },
  };
  const run = new Function("window", "codexStateCall", `${source}; return restoreCodexPlusManagedLocale;`)(
    window, async (method: string, request: any) => {
      calls.push({ method, params: structuredClone(request.params) });
      if (pause) await pause();
      if (options.fail === method) throw new Error("native bridge unavailable");
      if (method === "get-setting") return options.response ?? { value: current };
      current = request.params.value;
      return {};
    },
  );
  return { run, window, values, session, calls, current: () => current,
    pause: (fn: () => Promise<void>) => { pause = fn; } };
}

test("forced locale installation is retired and migration never synthesizes permission consent", () => {
  assert.doesNotMatch(renderer, /function installAlunixaXForceChineseLocale\(/);
  assert.doesNotMatch(source, /navigator|__STATSIG__|\.reload\(|\.click\(|dispatchEvent|full-access|approval_policy/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
  assert.match(renderer, /restoreCodexPlusManagedLocale\(\)/);
});

test("absent ownership marker leaves native locale and unrelated storage untouched", async () => {
  const h = harness({ marker: null, current: "fr-FR" });
  assert.equal(await h.run(), true);
  assert.equal(h.calls.length, 0);
  assert.equal(h.current(), "fr-FR");
  assert.equal(h.values.get("unrelated"), "keep");
});

for (const previous of [null, "en-US", "ru-RU", "zh-TW"]) {
  test(`retired locale migration restores ${previous ?? "automatic"} only while still owned`, async () => {
    const h = harness({ marker: marker(previous) });
    assert.equal(await h.run(), true);
    assert.equal(h.current(), previous);
    assert.deepEqual(h.calls, [
      { method: "get-setting", params: { key: "localeOverride" } },
      { method: "set-setting", params: { key: "localeOverride", value: previous } },
    ]);
    assert.equal(h.values.has(managedKey), false);
    assert.equal(h.session.has(reloadKey), false);
    assert.equal(h.values.get("unrelated"), "keep");
    assert.equal(h.session.get("unrelated"), "keep");
    assert.equal(h.window.__alunixaXRetiredLocaleCleanupPromise, undefined);
    await h.run();
    assert.equal(h.calls.length, 2, "successful migration must not replay");
  });
}

test("a newer explicit native language choice is preserved", async () => {
  const h = harness({ current: "ja-JP" });
  assert.equal(await h.run(), true);
  assert.equal(h.current(), "ja-JP");
  assert.equal(h.calls.length, 1);
  assert.equal(h.values.has(managedKey), false);
});

test("malformed markers never query or modify native locale", async () => {
  for (const value of ["{", "null", "[]", "{}", '{"appliedLocale":""}', '{"appliedLocale":42}']) {
    const h = harness({ marker: value });
    assert.equal(await h.run(), false, value);
    assert.equal(h.calls.length, 0);
    assert.equal(h.values.get(managedKey), value);
  }
});

test("invalid previous locales do not erase the marker or overwrite the current setting", async () => {
  for (const previous of [42, "en-US ", "bad_locale", "x".repeat(65)]) {
    const h = harness({ marker: marker(previous) });
    assert.equal(await h.run(), false);
    assert.equal(h.current(), "zh-CN");
    assert.equal(h.calls.length, 1);
    assert.equal(h.values.get(managedKey), marker(previous));
  }
});

test("malformed native responses retain recoverable ownership information", async () => {
  const h = harness({ response: {} });
  assert.equal(await h.run(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.values.has(managedKey), true);
});

test("blocked storage stops migration before native writes", async () => {
  const h = harness();
  h.window.localStorage.getItem = () => { throw new Error("denied"); };
  assert.equal(await h.run(), false);
  assert.equal(h.calls.length, 0);
});

test("native read/write failure retains the marker and clears the coalescing promise", async () => {
  for (const fail of ["get-setting", "set-setting"]) {
    const h = harness({ fail });
    assert.equal(await h.run(), false);
    assert.equal(h.current(), "zh-CN");
    assert.equal(h.values.has(managedKey), true);
    assert.equal(h.window.__alunixaXRetiredLocaleCleanupPromise, undefined);
    assert.ok(h.calls.length <= 2);
  }
});

test("concurrent migration probes perform one native read and one preserving write", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = harness();
  h.pause(() => gate);
  const pending = Promise.all([h.run(), h.run(), h.run()]);
  assert.equal(h.calls.length, 1);
  release();
  assert.deepEqual(await pending, [true, true, true]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.window.__alunixaXRetiredLocaleCleanupPromise, undefined);
});

test("ownership changes during the native read cancel stale restoration", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = harness();
  h.pause(() => gate);
  const pending = h.run();
  h.values.set(managedKey, marker("ru-RU"));
  release();
  assert.equal(await pending, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.current(), "zh-CN");
  assert.equal(h.values.get(managedKey), marker("ru-RU"));
});
