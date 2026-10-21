import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/40-backend-settings.js", import.meta.url), "utf8");
const functions = [
  "alunixaXNativeBackButton", "restoreCodexPlusPageBackButton",
  "syncCodexPlusPageBackButton", "installCodexPlusPageNavigationCloseHandler",
  "closeCodexPlusPageAfterNativeNavigation",
].map((name) => {
  const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");

class Element {
  attributes = new Map<string, string>();
  title = "";
  button: Element | null = null;
  thread = false;
  backIcon = false;
  constructor(attributes: Record<string, string> = {}) {
    Object.entries(attributes).forEach(([key, value]) => this.attributes.set(key, value));
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  querySelector(_selector: string) { return this.backIcon ? {} : null; }
  closest(selector: string) {
    if (selector === "button") return this.button;
    if (selector === "[data-thread]") return this.thread ? this : null;
    return null;
  }
}

function harness(disabled = false, label = "返回") {
  let pageOpen = true;
  let pageNode = {};
  let closes = 0;
  let navigations = 0;
  const button = new Element({
    "aria-label": label,
    ...(disabled ? { disabled: "", "aria-disabled": "true", tabindex: "-1", "data-disabled": "" } : {}),
  });
  button.button = button;
  let current: Element | null = button;
  const listeners = new Set<Function>();
  const timers = new Map<number, Function>();
  let timerId = 0;
  const context = vm.createContext({
    setTimeout: (callback: Function) => { navigations++; timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    window: {
      addEventListener: (_: string, handler: Function) => listeners.add(handler),
      removeEventListener: (_: string, handler: Function) => listeners.delete(handler),
    }, Element, alunixaXPageClass: "page",
    selectors: { appHeader: ".header, .tint", sidebarThread: "[data-thread]" },
    document: {
      querySelector: () => pageOpen ? pageNode : null,
      querySelectorAll: (selector: string) => {
        assert.equal(selector, ".header button, .tint button");
        return current ? [current] : [];
      },
      addEventListener: (_: string, handler: Function) => listeners.add(handler),
      removeEventListener: (_: string, handler: Function) => listeners.delete(handler),
    },
    closeCodexPlusPage: () => {
      closes++;
      pageOpen = false;
      timers.delete(context.window.__alunixaXPageNavigationCloseTimer);
      context.window.__alunixaXPageNavigationCloseTimer = null;
      vm.runInContext("restoreCodexPlusPageBackButton()", context);
    },
  });
  vm.runInContext(functions, context);
  const install = () => vm.runInContext("installCodexPlusPageNavigationCloseHandler()", context);
  const click = (target: Element) => {
    const event = { target, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    listeners.forEach((listener) => listener(event));
    return event;
  };
  return { button, install, click, listeners, context,
    flushTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); },
    setPage: (open: boolean) => { pageOpen = open; pageNode = {}; },
    setButton: (next: Element | null) => { current = next; },
    counts: () => ({ closes, navigations }),
  };
}

test("Back closes the page without also executing native history navigation", () => {
  const h = harness();
  h.install();
  const icon = new Element();
  icon.button = h.button;
  const event = h.click(icon);
  assert.ok(event.prevented && event.stopped);
  assert.deepEqual(h.counts(), { closes: 1, navigations: 0 });
  assert.equal(h.click(icon).prevented, false);
});

test("a disabled native Back becomes available and restores all original attributes on close", () => {
  const h = harness(true, "Back");
  const initial = [...h.button.attributes];
  h.install();
  h.install();
  assert.equal(h.listeners.size, 1);
  assert.equal(h.button.getAttribute("disabled"), null);
  assert.equal(h.button.getAttribute("aria-disabled"), null);
  assert.equal(h.button.getAttribute("tabindex"), null);
  h.click(h.button);
  assert.deepEqual([...h.button.attributes], initial);
});

test("button replacement restores old state and reacquires the new native control", () => {
  const h = harness(true);
  h.install();
  const replacement = new Element({ "aria-label": "Go back" });
  replacement.button = replacement;
  h.setButton(replacement);
  h.install();
  assert.equal(h.button.getAttribute("disabled"), "");
  assert.ok(h.click(replacement).stopped);
  assert.equal(replacement.getAttribute("disabled"), null);
});

test("missing Back, unrelated clicks and thread navigation keep their existing behavior", () => {
  const h = harness();
  h.setButton(null);
  h.install();
  const other = new Element();
  assert.equal(h.click(other).prevented, false);
  other.thread = true;
  assert.equal(h.click(other).prevented, false);
  assert.deepEqual(h.counts(), { closes: 0, navigations: 1 });
});

test("all page implementations restore Back on close and synchronize it on opening", () => {
  const extension = readFileSync(new URL("../../../assets/inject/renderer-inject/92-extension-host.js", import.meta.url), "utf8");
  assert.match(extension.match(/^  function closeCodexPlusPage\([^]*?^  \}/m)?.[0] ?? "", /restoreCodexPlusPageBackButton\(\)/);
  assert.match(source.match(/^  function observeCodexPlusPageLayout\([^]*?^  \}/m)?.[0] ?? "", /syncCodexPlusPageBackButton\(\)/);
});

test("native navigation keeps its new Back state after deferred page close and intervening scans", () => {
  const h = harness(true);
  h.install();
  const thread = new Element();
  thread.thread = true;
  assert.equal(h.click(thread).prevented, false);
  assert.equal(h.button.getAttribute("disabled"), "");
  for (const name of ["disabled", "aria-disabled", "tabindex", "data-disabled"]) h.button.removeAttribute(name);
  h.install();
  assert.equal(h.context.window.__alunixaXPageBackButtonState, null);
  h.flushTimers();
  assert.deepEqual([...h.button.attributes], [["aria-label", "返回"]]);
  assert.deepEqual(h.counts(), { closes: 1, navigations: 1 });
});

test("pending native navigation does not override a replacement Back button", () => {
  const h = harness();
  h.install();
  vm.runInContext("closeCodexPlusPageAfterNativeNavigation()", h.context);
  const replacement = new Element({ "aria-label": "Back", disabled: "", "aria-disabled": "true" });
  h.setButton(replacement);
  h.install();
  h.flushTimers();
  assert.equal(replacement.getAttribute("disabled"), "");
  assert.equal(replacement.getAttribute("aria-disabled"), "true");
});

test("a navigation timer cannot close a replacement page", () => {
  const h = harness(true);
  h.install();
  vm.runInContext("closeCodexPlusPageAfterNativeNavigation()", h.context);
  h.setPage(true);
  h.flushTimers();
  assert.equal(h.counts().closes, 0);
  h.install();
  assert.equal(h.button.getAttribute("disabled"), null);
});

test("closing and reopening a page cancels pending navigation close", () => {
  const h = harness(true);
  h.install();
  vm.runInContext("closeCodexPlusPageAfterNativeNavigation();closeCodexPlusPage()", h.context);
  h.setPage(true);
  h.install();
  assert.equal(h.button.getAttribute("disabled"), null);
  h.flushTimers();
  assert.equal(h.counts().closes, 1);
});

test("localized Back is identified by its native unmirrored arrow", () => {
  for (const label of ["戻る", "Zurück"]) {
    const h = harness(true, label);
    h.button.backIcon = true;
    h.install();
    assert.equal(h.button.getAttribute("disabled"), null);
    assert.equal(h.click(h.button).stopped, true);
    assert.equal(h.button.getAttribute("disabled"), "");
  }
});

test("both actual close implementations cancel timers before reopening", () => {
  const extension = readFileSync(new URL("../../../assets/inject/renderer-inject/92-extension-host.js", import.meta.url), "utf8");
  for (const implementation of [source, extension]) {
    const h = harness(true);
    const queryAll = h.context.document.querySelectorAll;
    h.context.document.querySelectorAll = (selector: string) => selector === ".page"
      ? [{ remove: () => h.setPage(false) }] : queryAll(selector);
    h.context.closeCodexPlusTypingEffectDropdown = () => {};
    h.context.setCodexPlusSidebarNavActive = () => {};
    vm.runInContext(implementation.match(/^  function closeCodexPlusPage\([^]*?^  \}/m)![0], h.context);
    h.install();
    vm.runInContext("closeCodexPlusPageAfterNativeNavigation();closeCodexPlusPage()", h.context);
    assert.equal(h.context.window.__alunixaXPageNavigationCloseTimer, null);
    h.setPage(true);
    h.install();
    h.flushTimers();
    assert.ok(h.context.document.querySelector(".page"));
    assert.equal(h.button.getAttribute("disabled"), null);
  }
});
