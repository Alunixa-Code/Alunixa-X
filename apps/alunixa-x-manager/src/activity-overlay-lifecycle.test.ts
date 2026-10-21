import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/98-avatar-overlay-layout.js", import.meta.url), "utf8");

test("activity overlay tolerates a new document without a root and disposes retries", () => {
  const intervals = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const attributes = new Map<string, string>();
  let nextId = 0;
  let enabled = true;
  const document: Record<string, any> = {
    documentElement: null, head: null, getElementById: () => null,
    createElement: () => ({ dataset: {} }),
  };
  const window = {
    setInterval: (callback: () => void) => { intervals.set(++nextId, callback); return nextId; },
    clearInterval: (id: number) => intervals.delete(id),
    addEventListener: (type: string, callback: () => void) => listeners.set(type, callback),
    removeEventListener: (type: string, callback: () => void) => {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
  };
  const context = vm.createContext({ window, document,
    alunixaXSettings: () => ({ activityOverlayRight: enabled }) });
  vm.runInContext(source, context);
  assert.equal(intervals.size, 1);
  document.documentElement = {
    toggleAttribute() {},
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
  intervals.values().next().value!();
  assert.equal(attributes.get("data-alunixa-x-activity-overlay-right"), "true");
  enabled = false;
  context.__ALUNIXA_X_ACTIVITY_OVERLAY_SYNC__();
  assert.equal(attributes.get("data-alunixa-x-activity-overlay-right"), "false");
  for (let index = 0; index < 60; index++) intervals.values().next().value?.();
  assert.equal(intervals.size, 0);
  vm.runInContext(source, context);
  assert.equal(intervals.size, 1);
  listeners.get("pagehide")!();
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(context.__ALUNIXA_X_ACTIVITY_OVERLAY_SYNC__, undefined);
});
