import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { hasModelProtocols } from "./model-protocols.ts";
import { normalizeRelayModelRoutes } from "./model-routes.ts";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string): string {
  let result = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.parent.parent.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, `missing production declaration: ${name}`);
  return result;
}
function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const supported = new Function("normalizeRelayModelRoutes", "hasModelProtocols",
  `${compile(declaration("isAggregateRelayProfile") + "\n" + declaration("multiLaunchSupported"))}; return multiLaunchSupported;`)(
  normalizeRelayModelRoutes, hasModelProtocols,
) as (value: ReturnType<typeof profile>) => boolean;
function profile(id = "one", patch: Record<string, unknown> = {}) {
  return {
    id, name: id, relayMode: "pureApi", protocol: "responses", modelRoutes: [], modelProtocols: "",
    apiKey: "fixture-private-key", authContents: '{"tokens":{"refresh":"fixture"}}', ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options: { queue?: Promise<void>; response?: Promise<unknown> } = {}) {
  const calls: Array<{ command: string; args: any }> = [];
  const notices: unknown[][] = [];
  const pending: Array<string | null> = [];
  const state = Object.freeze({ activeRelayId: "primary", revision: "confirmed", profiles: [profile()] });
  const ref = { current: null as string | null };
  const context = vm.createContext({
    multiLaunchPendingRef: ref,
    settingsSaveQueueRef: { current: options.queue ?? Promise.resolve() },
    multiLaunchSupported: supported,
    setMultiLaunchPending: (id: string | null) => pending.push(id),
    t: (value: string) => value,
    run: (operation: () => unknown) => operation(),
    showNotice: (...args: unknown[]) => notices.push(args),
    call: async (command: string, args: unknown) => {
      calls.push({ command, args: structuredClone(args) });
      return options.response ? await options.response : { status: "ok", message: "fixture" };
    },
    settings: { settings: state }, committedSettingsRef: { current: state },
    setSettings: () => { throw new Error("isolated launch must not mutate primary settings"); },
    setSettingsForm: () => { throw new Error("isolated launch must not replay an entire draft"); },
  });
  vm.runInContext(compile(declaration("launchMultiInstance") + "\nglobalThis.launchMultiInstance = launchMultiInstance;"), context);
  return { launch: context.launchMultiInstance as (value: ReturnType<typeof profile>) => Promise<void>,
    calls, notices, pending, ref, state };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test("isolated launch supports single transports without weakening AX's five-protocol editor", () => {
  for (const protocol of ["responses", "chatCompletions"]) assert.equal(supported(profile("one", { protocol })), true);
  for (const protocol of ["completions", "anthropicMessages", "geminiGenerateContent"]) {
    assert.equal(supported(profile("one", { protocol })), false, protocol);
    assert.ok(app.includes(`"${protocol}"`), `${protocol} must remain available in the normal editor`);
  }
  for (const relayMode of ["aggregate", "customModels"]) assert.equal(supported(profile("one", { relayMode })), false);
  for (const patch of [
    { modelRoutes: [{ model: "a", targetRelayId: "b", targetModel: "" }] },
    { modelRoutes: [{ model: "", targetRelayId: "", targetModel: "a" }] },
    { modelProtocols: '{"a":"anthropicMessages"}' }, { modelProtocols: "{" },
  ]) assert.equal(supported(profile("one", patch)), false);
  assert.equal(supported(profile("", {})), false);
});

test("isolated launch waits for confirmed saves and sends only the selected identity", async () => {
  const queue = deferred<void>();
  const h = harness({ queue: queue.promise });
  const selected = profile("other");
  const before = structuredClone(selected);
  const pending = h.launch(selected);
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.ref.current, "other");
  queue.resolve();
  await pending;
  assert.deepEqual(h.calls, [{ command: "launch_codex_multi_instance", args: { request: { profileId: "other" } } }]);
  assert.deepEqual(selected, before);
  assert.equal(h.state.activeRelayId, "primary");
  assert.equal(h.state.revision, "confirmed");
  assert.deepEqual(h.pending, ["other", null]);
  assert.equal(h.ref.current, null);
  assert.ok(!JSON.stringify(h.calls).includes("fixture-private-key"));
  assert.ok(!JSON.stringify(h.notices).includes('"tokens"'));
});

test("double clicks are coalesced synchronously before a React state update", async () => {
  const reply = deferred<unknown>();
  const h = harness({ response: reply.promise });
  const first = h.launch(profile("one"));
  const second = h.launch(profile("two"));
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.request.profileId, "one");
  assert.equal(h.ref.current, "one");
  reply.resolve({ status: "ok", message: "fixture" });
  await Promise.all([first, second]);
  await h.launch(profile("two"));
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].args.request.profileId, "two");
});

test("an asynchronous save cannot redirect the captured launch identity", async () => {
  const queue = deferred<void>();
  const h = harness({ queue: queue.promise });
  const selected = profile("chosen");
  const pending = h.launch(selected);
  selected.id = "different";
  queue.resolve();
  await pending;
  assert.equal(h.calls[0].args.request.profileId, "chosen");
  assert.deepEqual(h.pending, ["chosen", null]);
});

test("unsupported profiles cannot bypass the disabled UI through a direct action", async () => {
  const h = harness();
  await h.launch(profile("aggregate", { relayMode: "aggregate" }));
  await h.launch(profile("custom", { relayMode: "customModels" }));
  await h.launch(profile("routed", { modelProtocols: '{"a":"chatCompletions"}' }));
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.pending, []);
  assert.equal(h.ref.current, null);
});

test("failed, missing and rejected replies always release isolated launch ownership", async () => {
  for (const result of [null, { status: "failed", message: "fixture rejection" }]) {
    const h = harness({ response: Promise.resolve(result) });
    await h.launch(profile());
    assert.equal(h.ref.current, null);
    assert.deepEqual(h.pending, ["one", null]);
    assert.equal(h.notices.length, result ? 1 : 0);
  }
  const h = harness({ response: Promise.reject(new Error("fixture transport rejection")) });
  await assert.rejects(h.launch(profile()), /fixture transport rejection/);
  assert.equal(h.ref.current, null);
  assert.deepEqual(h.pending, ["one", null]);
});

test("multi-launch navigation, busy actions and AX-specific panels remain wired", () => {
  assert.match(app, /id: "multiLaunch", label: t\("Codex多开"\)/);
  assert.match(app, /route === "multiLaunch"[\s\S]*?<CodexMultiLaunchScreen/);
  assert.match(app, /next === "relay" \|\| next === "multiLaunch"/);
  assert.match(declaration("CodexMultiLaunchScreen"), /actions\.multiLaunchPending !== null/);
  assert.match(declaration("SortableRelayProfileCard"), /actions\.multiLaunchPending !== null/);
  for (const name of ["CustomModelsEditor", "ImageModelsScreen", "WallpaperSettings", "AgentHealthPanel",
    "committedSettingsRef", "settingsSaveQueueRef"]) assert.ok(app.includes(name), name);
  assert.doesNotMatch(declaration("launchMultiInstance"), /save_settings|switch_relay_profile|activeRelayId\s*=/);
});
