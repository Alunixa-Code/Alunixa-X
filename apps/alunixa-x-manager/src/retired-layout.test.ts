import { contextRootEnabled, setContextRootEnabled } from "./context-enabled.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const style = readFileSync(new URL("../../../assets/inject/renderer-inject/10-style.js", import.meta.url), "utf8");

function fixture() {
  const stored = new Map<string, string>();
  const writes: Array<[string, unknown]> = [];
  const context = vm.createContext({
    window: {}, conversationViewDefaultWidth: 900, alunixaXSettingsKey: "settings",
    alunixaXBackendSettings: {}, alunixaXBackendSettingsLoaded: true,
    localStorage: { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value) },
    setBackendSetting: async (key: string, value: unknown) => {
      writes.push([key, value]);
      context.alunixaXBackendSettings = { ...context.alunixaXBackendSettings, [key]: value };
    },
    loadBackendSettings: async () => {}, syncStepwisePanel: () => {},
  });
  const start = style.indexOf("  function defaultCodexPlusSettings()");
  const end = style.indexOf("  // Dream skin runtime", start);
  const setterStart = style.indexOf("  function setCodexPlusSetting(");
  const setterEnd = style.indexOf("  function syncStepwisePanel(", setterStart);
  assert.ok(start >= 0 && end > start && setterStart >= 0 && setterEnd > setterStart);
  vm.runInContext(`${style.slice(start, end)}\n${style.slice(setterStart, setterEnd)}`, context);
  return { context, stored, writes };
}

test("retired layout preferences are hidden while existing local enhancement choices remain intact", () => {
  const { context, stored } = fixture();
  const oldPreferences = JSON.stringify({
    customLayout: true, conversationView: true, whaleWidget: true, typingEffect: "stars",
    nativeMenuPlacement: false, threadScrollRestore: true,
  });
  stored.set("settings", oldPreferences);
  const settings = context.alunixaXSettings();
  assert.equal("customLayout" in settings, false);
  assert.equal(settings.conversationView, true); assert.equal(settings.whaleWidget, true);
  assert.equal(settings.typingEffect, "stars"); assert.equal(settings.nativeMenuPlacement, false);
  assert.equal(settings.threadScrollRestore, true);
  assert.equal(stored.get("settings"), oldPreferences, "reading preferences must not rewrite other saved choices");
});

test("a stale backend layout flag cannot reappear during partial updates to retained enhancements", async () => {
  const { context, stored, writes } = fixture();
  stored.set("settings", JSON.stringify({ customLayout: true, conversationView: true, whaleWidget: true }));
  context.alunixaXBackendSettings = { enhancementsEnabled: true, codexAppCustomLayoutEnabled: true, codexAppTypingEffect: "stars" };
  assert.equal("customLayout" in context.alunixaXSettings(), false);
  context.setCodexPlusSetting("threadIdBadge", true);
  context.setCodexPlusSetting("typingEffect", "rainbow");
  await Promise.resolve();
  assert.deepEqual(writes, [["codexAppThreadIdBadge", true], ["codexAppTypingEffect", "rainbow"]]);
  const settings = context.alunixaXSettings();
  assert.equal("customLayout" in settings, false);
  assert.equal(settings.threadIdBadge, true); assert.equal(settings.typingEffect, "rainbow");
  assert.equal(settings.conversationView, true); assert.equal(settings.whaleWidget, true);
  assert.equal(JSON.parse(stored.get("settings")!).conversationView, true);
  assert.equal(JSON.parse(stored.get("settings")!).whaleWidget, true);
});

test("unified MCP navigation is global to Codex providers and uses the preserving context actions", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /id: "context", label: (?:t\()?"MCP"/);
  const start = app.indexOf('{route === "context" ? (');
  const end = app.indexOf('{route === "skills"', start);
  assert.ok(start >= 0 && end > start);
  const route = app.slice(start, end);
  assert.match(route, /<McpPage/);
  assert.match(route, /contextEntriesWithLiveEntries\(settingsForm, liveContextEntries\)/);
  assert.match(route, /actions\.upsertContextEntry\(settingsForm, kind, id, body\)/);
  assert.match(route, /actions\.deleteContextEntry\(settingsForm, entry\.kind, entry\.id\)/);
  assert.match(route, /actions\.importMcpServersJson\(settingsForm, json\)/);
  assert.doesNotMatch(route, /activeRelayId|relayProfiles\s*=/);
});

function mcpEnabledBody(body: string, enabled: boolean) {
  const page = readFileSync(new URL("./ManagementPages.tsx", import.meta.url), "utf8");
  assert.match(page, /function enabledBody[\s\S]*?return setContextRootEnabled\(body, enabled\)/);
  return setContextRootEnabled(body, enabled);
}

test("global MCP toggles preserve unrelated fields and nested configuration when a root flag exists", () => {
  const input = 'enabled = false\ncommand = "fixture"\n[env]\nKEEP = "fixture-value"\n[settings]\nenabled = false\n';
  assert.equal(mcpEnabledBody(input, true),
    'enabled = true\ncommand = "fixture"\n[env]\nKEEP = "fixture-value"\n[settings]\nenabled = false\n');
});

test("global MCP toggles add only a root flag and never consume a nested enabled value", () => {
  const input = 'command = "fixture"\n[env]\nKEEP = "fixture-value"\n[settings]\nenabled = false\n';
  assert.equal(mcpEnabledBody(input, true), `enabled = true\n${input}`);
});

test("global flags ignore multiline content, arrays and nested legacy flags", () => {
  const body = `description = """\n[not.a.table]\nenabled = false\n"""\nargs = [\n ["nested"]\n]\ndisabled = true\n[env]\ndisabled = true\n`;
  assert.equal(contextRootEnabled(body), false);
  const saved = mcpEnabledBody(body, true);
  assert.equal(contextRootEnabled(saved), true);
  assert.ok(saved.includes('[not.a.table]\nenabled = false'));
  assert.ok(saved.endsWith('[env]\ndisabled = true\n'));
  assert.equal((saved.match(/^disabled = true$/gm) || []).length, 1);
});
