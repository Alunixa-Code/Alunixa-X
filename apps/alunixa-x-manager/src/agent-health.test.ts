import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const core = readFileSync(new URL("../../../crates/alunixa-x-core/src/agent_capabilities.rs", import.meta.url), "utf8");
const tree = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  let text = "";
  function visit(node: any) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) text = node.parent.parent.getText(tree);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(text, `missing production declaration: ${name}`);
  return text;
}

test("restored enhancement controls bind persisted settings and gate explicit native writes", () => {
  const screen = declaration("EnhanceScreen");
  const settings = readFileSync(new URL("../../../crates/alunixa-x-core/src/settings.rs", import.meta.url), "utf8");
  const keys = [...screen.matchAll(/set(?:Persisted)?EnhanceFlag\("([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 10, "the control inventory must not silently become empty");
  for (const key of new Set(keys)) assert.ok(settings.includes(`"${key}"`), key);
  for (const key of ["computerUseGuardEnabled", "enhancementsEnabled", "codexAppPackagedProxyRepair"]) {
    assert.ok(core.includes(`"${key}"`));
  }
  assert.match(screen, /nativeChecked/);
  assert.match(screen, /nativeCapabilityEditable/);
  assert.match(screen, /actions\.markNativeCapabilityWrite\(key\)/);
  assert.match(screen, /nativeDiskValues\[key\]/);
  assert.match(screen, /codexAppForceChineseLocale/);
});

function saveHarness(results: Array<"ok" | "failed" | "null" | "throw">) {
  const code = ts.transpileModule(declaration("saveSettingsValue") + "\nglobalThis.save = saveSettingsValue;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: Array<{ expectedRevision: string | null; capabilityWrites?: string[] }> = [];
  const notices: unknown[] = [];
  let form: unknown = null;
  let serial = 1;
  const context = vm.createContext({
    settings: { settings: { codexAppPackagedProxyRepair: true } },
    defaultSettings: { codexAppPackagedProxyRepair: false },
    settingsRevisionRef: { current: "r1" },
    committedSettingsRef: { current: { codexAppPackagedProxyRepair: true } },
    settingsSaveRequestRef: { current: 0 },
    settingsSaveQueueRef: { current: Promise.resolve() },
    nativeCapabilityWritesRef: { current: new Map() },
    nativeSettingsDraftRef: { current: {} },
    normalizeSettings: (s: unknown) => s,
    whaleBalanceSettingsIssue: () => null,
    whaleBalanceValidationMessage: () => "",
    dictationSettingsIssue: () => null,
    dictationSettingsValidationMessage: () => "",
    setSettingsForm: (s: unknown) => { form = structuredClone(s); },
    setSettings: () => {},
    isSuccessStatus: (s: string) => s === "ok",
    showNotice: (...args: unknown[]) => { notices.push(args); },
    t: (s: string) => s,
    run: (f: () => unknown) => f(),
    call: async (_: string, args: { settings: unknown; expectedRevision: string }) => {
      calls.push(structuredClone(args));
      const status = results.shift();
      if (status === "throw") throw new Error("fixture request failure");
      if (status === "null") return null;
      return { status, message: status, settings: args.settings, revision: status === "ok" ? `r${++serial}` : "r1" };
    },
  });
  vm.runInContext(code, context);
  return { save: context.save, calls, notices, form: () => form };
}

test("failed optimistic settings save restores the last confirmed snapshot", async () => {
  const h = saveHarness(["failed"]);
  assert.equal(await h.save({ codexAppPackagedProxyRepair: false }, true), null);
  assert.deepEqual(h.form(), { codexAppPackagedProxyRepair: true });
  assert.equal(h.notices.length, 1);
  assert.equal(h.calls[0].expectedRevision, "r1");
});

test("a missing response cannot leave an unpersisted switch enabled", async () => {
  const h = saveHarness(["null"]);
  assert.equal(await h.save({ codexAppPackagedProxyRepair: false }, true), null);
  assert.deepEqual(h.form(), { codexAppPackagedProxyRepair: true });
});

test("queued saves use the revision produced by the previous successful write", async () => {
  const h = saveHarness(["ok", "ok"]);
  const first = h.save({ codexAppPackagedProxyRepair: false }, true);
  const second = h.save({ codexAppPackagedProxyRepair: true }, true);
  assert.deepEqual(await first, { codexAppPackagedProxyRepair: false });
  assert.deepEqual(await second, { codexAppPackagedProxyRepair: true });
  assert.deepEqual(h.calls.map(c => c.expectedRevision), ["r1", "r2"]);
  assert.deepEqual(h.form(), { codexAppPackagedProxyRepair: true });
});

test("queued saves preserve complete provider, credential and unrelated feature snapshots", async () => {
  const h = saveHarness(["ok", "ok"]);
  const first = { codexAppPackagedProxyRepair: false, relayProfiles: [{ id: "a", apiKey: "fixture-key", authContents: '{"tokens":{"refresh":"fixture"}}' }] };
  const second = { ...first, codexAppThreadScrollRestore: true };
  const [savedFirst, savedSecond] = await Promise.all([h.save(first, true), h.save(second, true)]);
  assert.deepEqual(savedFirst, first);
  assert.deepEqual(savedSecond, second);
  assert.deepEqual((h.calls[1] as any).settings, second);
  assert.deepEqual(h.form(), second);
  assert.deepEqual(first.relayProfiles, second.relayProfiles);
});

test("a failed newest save rolls back to the previous queued success, not the initial snapshot", async () => {
  const h = saveHarness(["ok", "failed"]);
  const first = { codexAppPackagedProxyRepair: false, unrelated: "keep" };
  const second = { ...first, codexAppThreadScrollRestore: true };
  const pending = h.save(first, true);
  const failed = h.save(second, true);
  assert.deepEqual(await pending, first);
  assert.equal(await failed, null);
  assert.deepEqual(h.form(), first);
  assert.deepEqual(h.calls.map(c => c.expectedRevision), ["r1", "r2"]);
});

test("a failed earlier save does not poison the CAS queue or replace a later successful draft", async () => {
  const h = saveHarness(["failed", "ok"]);
  const failed = h.save({ codexAppPackagedProxyRepair: false }, true);
  const newest = { codexAppPackagedProxyRepair: true, codexAppThreadScrollRestore: true };
  const successful = h.save(newest, true);
  assert.equal(await failed, null);
  assert.deepEqual(await successful, newest);
  assert.deepEqual(h.calls.map(c => c.expectedRevision), ["r1", "r1"]);
  assert.deepEqual(h.form(), newest);
});

test("overview readiness uses live checks and never equates port presence with health", () => {
  const section = declaration("healthItems");
  assert.ok(section.includes("runtime"));
  assert.ok(section.includes("not_tested") || section.includes("not_checked"));
  assert.ok(!section.includes("Boolean(overview?.latest_launch?.helper_port)"));
});

test("immediate enhancement edits keep the entire pending form before entering the save queue", () => {
  const screen = declaration("EnhanceScreen");
  assert.match(screen, /const next = \{ \.\.\.form, \[key\]: value \}/);
  assert.match(screen, /onFormChange\(next\)/);
  assert.match(screen, /actions\.saveSettingsValue\(next, true, nativeEdits\)/);
});

test("a rejected transport leaves the CAS queue usable and never advances an unconfirmed revision", async () => {
  const h = saveHarness(["throw", "ok"]);
  const failed = h.save({ codexAppPackagedProxyRepair: false }, true);
  const newest = { codexAppPackagedProxyRepair: true, unrelated: "keep after rejection" };
  const pending = h.save(newest, true);
  await assert.rejects(failed, /fixture request failure/);
  assert.deepEqual(await pending, newest);
  assert.deepEqual(h.calls.map(c => c.expectedRevision), ["r1", "r1"]);
  assert.deepEqual(h.form(), newest);
});
