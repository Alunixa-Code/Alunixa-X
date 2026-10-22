import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  let result = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      result = node.parent.parent.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(result, `missing production declaration ${name}`);
  return result;
}

function harness() {
  let serial = 1;
  let transaction = "transaction-1";
  let persisted = { revision: "file-1", codexAppPackagedProxyRepair: false };
  const requests: any[] = [];
  const notices: any[] = [];
  let draft: any = structuredClone(persisted);
  const context = vm.createContext({
    settings: { settings: persisted, revision: transaction },
    defaultSettings: {},
    settingsRevisionRef: { current: transaction },
    committedSettingsRef: { current: structuredClone(persisted) },
    settingsSaveQueueRef: { current: Promise.resolve() },
    settingsSaveRequestRef: { current: 0 },
    nativeCapabilityWritesRef: { current: new Map() },
    nativeSettingsDraftRef: { current: {} },
    normalizeSettings: (value: unknown) => value,
    whaleBalanceSettingsIssue: () => null, whaleBalanceValidationMessage: () => "",
    dictationSettingsIssue: () => null, dictationSettingsValidationMessage: () => "",
    setSettings: (value: unknown) => { context.settings = value; },
    setSettingsForm: (value: unknown) => { draft = structuredClone(value); },
    isSuccessStatus: (value: string) => value === "ok",
    showNotice: (...args: any[]) => notices.push(args),
    t: (value: string) => value,
    run: async (operation: () => Promise<unknown>) => {
      try { return await operation(); } catch (error) { notices.push(error); return null; }
    },
    invoke: async (command: string, args: any) => {
      if (command !== "save_settings") return { status: "ok" };
      requests.push(structuredClone(args));
      if (args.expectedRevision !== transaction)
        return { status: "failed", message: "保存设置失败：配置已被其他页面或程序修改，请刷新后重试；未覆盖新配置" };
      if (args.settings.revision !== persisted.revision)
        return { status: "failed", message: "settings_revision_conflict：设置已被其他操作更新" };
      serial++;
      transaction = `transaction-${serial}`;
      persisted = { ...args.settings, revision: `file-${serial}` };
      return { status: "ok", message: "saved", revision: transaction, settings: structuredClone(persisted) };
    },
  });
  const program = declaration("call") + "\n" + declaration("saveSettingsValue")
    + "\nglobalThis.save = saveSettingsValue; globalThis.transport = call;";
  vm.runInContext(ts.transpileModule(program, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { context, requests, notices, persisted: () => persisted, draft: () => draft };
}

test("save transport preserves an explicit cross-file revision rather than substituting the file hash", async () => {
  const h = harness();
  const result = await h.context.transport("save_settings", {
    expectedRevision: "transaction-1", settings: { revision: "file-1", codexAppPackagedProxyRepair: true },
  });
  assert.equal(h.requests[0].expectedRevision, "transaction-1");
  assert.equal(result.status, "ok");
});

test("ordinary saves use the cross-file snapshot and keep the file revision in its own field", async () => {
  const h = harness();
  const saved = await h.context.save({ revision: "file-1", codexAppPackagedProxyRepair: true }, true);
  assert.ok(saved, "first save must succeed with no external changes");
  assert.equal(h.requests[0].expectedRevision, "transaction-1");
  assert.equal(h.requests[0].settings.revision, "file-1");
  assert.equal(h.persisted().codexAppPackagedProxyRepair, true);
});

test("back-to-back queued saves advance both confirmed revisions", async () => {
  const h = harness();
  const first = h.context.save({ revision: "file-1", codexAppPackagedProxyRepair: true }, true);
  const second = h.context.save({ revision: "file-1", codexAppPackagedProxyRepair: false }, true);
  assert.ok(await first);
  assert.ok(await second);
  assert.deepEqual(h.requests.map(request => request.expectedRevision), ["transaction-1", "transaction-2"]);
  assert.deepEqual(h.requests.map(request => request.settings.revision), ["file-1", "file-2"]);
  assert.equal(h.persisted().codexAppPackagedProxyRepair, false);
});

test("real stale transaction failures are not retried with a current revision", async () => {
  const h = harness();
  await assert.rejects(h.context.transport("save_settings", {
    expectedRevision: "external-stale", settings: { revision: "file-1", codexAppPackagedProxyRepair: true },
  }), /配置已被其他页面或程序修改/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.persisted().codexAppPackagedProxyRepair, false);
});
