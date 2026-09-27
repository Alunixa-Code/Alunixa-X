import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const core = readFileSync(new URL("../../../crates/alunixa-x-core/src/agent_capabilities.rs", import.meta.url), "utf8");

test("every boolean Agent control is covered by the capability inventory", () => {
  const start = app.indexOf("function EnhanceScreen(");
  const end = app.indexOf("\nfunction ZedRemoteScreen", start);
  const keys = [...app.slice(start, end).matchAll(/set(?:Persisted)?EnhanceFlag\("([^"]+)"/g)].map(m => m[1]);
  for (const key of new Set(keys)) assert.ok(core.includes(`"${key}"`), key);
  for (const key of ["computerUseGuardEnabled", "enhancementsEnabled", "codexAppPackagedProxyRepair"]) {
    assert.ok(core.includes(`"${key}"`));
  }
});

function saveHarness(results: Array<"ok" | "failed" | "null">) {
  const start = app.indexOf("const saveSettingsValue = async (");
  const end = app.indexOf("\n  const exportFullConfig", start);
  const code = ts.transpileModule(app.slice(start, end) + "\nglobalThis.save = saveSettingsValue;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: Array<{ expectedRevision: string | null }> = [];
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
    normalizeSettings: (s: unknown) => s,
    setSettingsForm: (s: unknown) => { form = s; },
    setSettings: () => {},
    isSuccessStatus: (s: string) => s === "ok",
    showNotice: (...args: unknown[]) => { notices.push(args); },
    t: (s: string) => s,
    run: (f: () => unknown) => f(),
    call: async (_: string, args: { settings: unknown; expectedRevision: string }) => {
      calls.push(args);
      const status = results.shift();
      if (status === "null") return null;
      return { status, message: status, settings: args.settings, revision: status === "ok" ? `r${++serial}` : "r1" };
    },
  });
  vm.runInContext(code, context);
  return { save: context.save, calls, notices, form: () => form };
}

test("failed optimistic settings save restores the last confirmed snapshot", async () => {
  const h = saveHarness(["failed"]);
  assert.equal(await h.save({ codexAppPackagedProxyRepair: false }, true), false);
  assert.deepEqual(h.form(), { codexAppPackagedProxyRepair: true });
  assert.equal(h.notices.length, 1);
  assert.equal(h.calls[0].expectedRevision, "r1");
});

test("a missing response cannot leave an unpersisted switch enabled", async () => {
  const h = saveHarness(["null"]);
  assert.equal(await h.save({ codexAppPackagedProxyRepair: false }, true), false);
  assert.deepEqual(h.form(), { codexAppPackagedProxyRepair: true });
});

test("queued saves use the revision produced by the previous successful write", async () => {
  const h = saveHarness(["ok", "ok"]);
  const first = h.save({ codexAppPackagedProxyRepair: false }, true);
  const second = h.save({ codexAppPackagedProxyRepair: true }, true);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(h.calls.map(c => c.expectedRevision), ["r1", "r2"]);
  assert.deepEqual(h.form(), { codexAppPackagedProxyRepair: true });
});

test("overview readiness uses live checks and never equates port presence with health", () => {
  const section = app.slice(app.indexOf("function OverviewScreen("), app.indexOf("function Usage", app.indexOf("function OverviewScreen(")));
  assert.ok(section.includes('runtime?.helper === "ready"'));
  assert.ok(section.includes("not_tested"));
  assert.ok(!section.includes("Boolean(overview?.latest_launch?.helper_port)"));
});
