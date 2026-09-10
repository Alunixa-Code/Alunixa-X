import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const renderer = readFileSync(new URL("../../../assets/inject/renderer-inject.js", import.meta.url), "utf8");
function functions(...names: string[]) {
  return names.map((name) => {
    const match = renderer.match(new RegExp(`^  (?:async )?function ${name}\\([\\s\\S]*?^  \\}`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
}

// Small, strict DOM fixture: selectors are interpreted, not pre-mapped to test results.
class Element {
  tagName: string;
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  listeners: Record<string, (event: any) => void> = {};
  className = "";
  textContent = "";
  title = "";
  style = { display: "flex", visibility: "visible" };
  rect = { left: 0, top: 700, width: 700, height: 40, bottom: 740 };
  root = false;
  insertions = 0;
  constructor(tag = "div", attrs: Record<string, string> = {}) {
    this.tagName = tag;
    Object.entries(attrs).forEach(([key, value]) => this.setAttribute(key, value));
  }
  get isConnected(): boolean { return this.root || !!this.parentElement?.isConnected; }
  get childNodes() { return this.children; }
  get nextSibling(): Element | null {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null;
  }
  getAttribute(key: string) {
    if (key === "class") return this.className;
    if (key.startsWith("data-")) return this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attrs[key] ?? null;
  }
  setAttribute(key: string, value: string) {
    if (key === "class") this.className = value;
    else if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    else this.attrs[key] = value;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const source = part.trim();
      const tokens = source.match(/\[[^\]]+\]|\.[\w-]+|^[\w-]+/g) ?? [];
      assert.equal(tokens.join(""), source, `unsupported fixture selector: ${source}`);
      return tokens.every((token) => {
        if (token.startsWith(".")) return this.className.split(/\s+/).includes(token.slice(1));
        if (!token.startsWith("[")) return this.tagName === token;
        const [, key, op, value] = token.match(/^\[([\w-]+)(?:(\*?=)["']([^"']*)["'])?\]$/)!;
        const actual = this.getAttribute(key);
        return op === "*=" ? actual?.includes(value) === true : op === "=" ? actual === value : actual != null;
      });
    });
  }
  closest(selector: string): Element | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [...child.matches(selector) ? [child] : [], ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return this.rect; }
  addEventListener(type: string, callback: (event: any) => void) { this.listeners[type] = callback; }
  insertBefore(child: Element, before: Element | null) {
    assert.notEqual(child, before, "must not repeatedly insert a badge before itself");
    if (before) assert.equal(before.parentElement, this);
    child.remove();
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
    child.parentElement = this;
    this.insertions++;
    return child;
  }
  append(child: Element) { return this.insertBefore(child, null); }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
}

function harness() {
  const body = new Element("body");
  body.root = true;
  const document = {
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    createElement: (tag: string) => new Element(tag),
  };
  const settings = { serviceTierControls: true };
  const tier = { status: "ok" };
  const badgeState = { label: "standard", tier: "standard", disabled: false, title: "服务模式" };
  let toggles = 0;
  const declarations = ["codexComposerFooterSelector", "codexServiceTierBadgeClass", "codexServiceTierBadgeVersion"].map((name) => {
    const match = renderer.match(new RegExp(`^  const ${name} = [\\s\\S]*?;$`, "m"));
    assert.ok(match, name);
    return match[0];
  }).join("\n");
  const api = new Function("HTMLElement", "document", "getComputedStyle", "alunixaXSettings",
    "codexServiceTierState", "codexServiceTierBadgeState", "toggleCodexServiceTierFromBadge", `
    ${declarations}
    const codexModelCatalog = {};
    const uniqueValues = (values) => [...new Set(values.filter(Boolean))];
    const conversationViewFindComposerEl = () => null;
    ${functions("codexServiceTierBadgeVisibleElement", "codexServiceTierBadgeText", "codexServiceTierKnownProviderNames",
      "codexServiceTierLooksLikeProviderButton", "codexServiceTierBadgeButtonCandidates", "codexServiceTierVisibleComposerFooters",
      "codexServiceTierComposerScore", "codexServiceTierComposerCandidates", "codexServiceTierBestComposerFooter",
      "codexServiceTierFindComposerEl", "codexServiceTierBadgeAnchor", "codexServiceTierComposerFooter",
      "codexServiceTierBadgeFooterGroup", "codexServiceTierBadgePlacement", "wireCodexServiceTierBadge",
      "installCodexServiceTierBadge", "removeCodexServiceTierBadges", "refreshCodexServiceTierBadges")}
    return { installCodexServiceTierBadge, codexServiceTierVisibleComposerFooters, codexServiceTierFindComposerEl };
  `)(Element, document, (node: Element) => node.style, () => settings, tier, () => badgeState, () => toggles++);
  return { body, document, settings, tier, badgeState, api, toggles: () => toggles };
}

const badgeSelector = '[data-codex-service-tier-badge="true"]';
for (const [name, attrs] of [
  ["legacy", { class: "composer-footer" }],
  ["shared CSS module", { class: "_ComposerFooter_newhash_1" }],
  ["modern CSS module with responsiveness off", { class: "_ComposerLayoutFooter_otherhash_12" }],
  ["responsive attribute without known classes", { "data-composer-footer-responsive": "" }],
] as Array<[string, Record<string, string>]>) {
  test(`Fast attaches to ${name} without the old conversation wrapper`, () => {
    const { body, api } = harness();
    const footer = body.append(new Element("div", attrs));
    api.installCodexServiceTierBadge();
    assert.equal(body.querySelector(badgeSelector)?.parentElement, footer);
    assert.equal(api.codexServiceTierVisibleComposerFooters().length, 1);
  });
}

test("composer bodies and responsive labels are not mistaken for footers", () => {
  const { body, api } = harness();
  body.append(new Element("div", { class: "_ComposerLayoutBody_x_1", "data-composer-layout": "multiline" }));
  body.append(new Element("div", { class: "_ComposerLayoutFooterLabel_x_1" }));
  body.append(new Element("span", { "data-composer-footer-label-responsive": "" }));
  api.installCodexServiceTierBadge();
  assert.equal(body.querySelector(badgeSelector), null);
});

test("hidden and detached composers cannot steal the visible Fast button", () => {
  const { body, api } = harness();
  const hidden = body.append(new Element("div", { "aria-hidden": "true" }));
  hidden.append(new Element("div", { class: "composer-footer" }));
  const footer = body.append(new Element("div", { class: "_ComposerLayoutFooter_x_1", "data-composer-footer-responsive": "" }));
  api.installCodexServiceTierBadge();
  assert.equal(api.codexServiceTierFindComposerEl(), footer);
  assert.equal(api.codexServiceTierVisibleComposerFooters().length, 1);
  footer.remove();
  api.installCodexServiceTierBadge();
  assert.equal(body.querySelector(badgeSelector), null);
});

test("the badge stays outside native buttons even in a flat compact footer", () => {
  const { body, api } = harness();
  const footer = body.append(new Element("div", { class: "_ComposerLayoutFooter_x_1" }));
  const native = footer.append(new Element("button"));
  native.textContent = "gpt-5.6-sol";
  api.installCodexServiceTierBadge();
  const badge = body.querySelector(badgeSelector)!;
  assert.equal(badge.parentElement, footer);
  assert.equal(badge.closest("button"), null);
  assert.equal(native.children.length, 0);
});

test("repeated scans reuse one badge without self-insertion or duplicate handlers", () => {
  const { body, api, toggles } = harness();
  const footer = body.append(new Element("div", { class: "composer-footer" }));
  api.installCodexServiceTierBadge();
  const badge = body.querySelector(badgeSelector)!;
  const insertions = footer.insertions;
  for (let i = 0; i < 5; i++) api.installCodexServiceTierBadge();
  assert.equal(footer.insertions, insertions);
  assert.equal(body.querySelectorAll(badgeSelector).length, 1);
  assert.equal(body.querySelector(badgeSelector), badge);
  const event = { preventDefault() {}, stopPropagation() {}, key: "Enter" };
  badge.listeners.keydown(event);
  badge.listeners.click(event);
  assert.equal(toggles(), 2);
});

test("remounting a modern footer replaces detached badges and preserves disabled status", () => {
  const { body, api, badgeState } = harness();
  const old = body.append(new Element("div", { class: "composer-footer" }));
  api.installCodexServiceTierBadge();
  old.remove();
  const current = body.append(new Element("div", { class: "_ComposerLayoutFooter_x_1" }));
  Object.assign(badgeState, { label: "未连接", tier: "failed", disabled: true });
  api.installCodexServiceTierBadge();
  const badge = body.querySelector(badgeSelector)!;
  assert.equal(badge.parentElement, current);
  assert.equal(badge.textContent, "未连接");
  assert.equal(badge.getAttribute("aria-disabled"), "true");
});

test("explicitly disabling Fast controls still removes injected buttons", () => {
  const { body, api, settings } = harness();
  body.append(new Element("div", { class: "_ComposerLayoutFooter_x_1" }));
  api.installCodexServiceTierBadge();
  settings.serviceTierControls = false;
  api.installCodexServiceTierBadge();
  assert.equal(body.querySelectorAll(badgeSelector).length, 0);
});

test("modern footer insertion participates in the existing bounded mutation scan", () => {
  assert.match(functions("scanRelevantSelector"), /codexComposerFooterSelector/);
  assert.match(functions("shouldScheduleScan"), /isExtensionUiNode/);
});
