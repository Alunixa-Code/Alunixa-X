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

function harness() {
  let now = 0;
  const settings = { enhancementsEnabled: true };
  const events: unknown[] = [];
  const api = new Function("alunixaXBackendSettings", "sendAlunixaXDiagnostic", "Date", `
    ${functions("codexModuleFunctionSource", "patchCodexQueuedFollowUpQueue", "patchCodexQueuedFollowUpCoordinator")}
    return { patch: patchCodexQueuedFollowUpQueue, coordinator: patchCodexQueuedFollowUpCoordinator };
  `)(settings, (...args: unknown[]) => events.push(args), { now: () => now });
  const rows = new Map<string, any[]>([["t", [{ id: "old", context: { prompt: "before" } }, { id: "next" }]]]);
  const writes: any[] = [];
  let failure: Error | null = null;
  const queue = {
    read(thread: string) { return rows.get(thread) ?? []; },
    async remove(thread: string, id: string) {
      const list = this.read(thread);
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const [message] = list.splice(index, 1);
      return { message, serverSubmission: { id }, index };
    },
    async enqueue(thread: string, message: any, position?: any, prepared?: any) {
      const list = this.read(thread);
      if (position?.messageId != null && !list.some((item) => item.id === position.messageId)) {
        throw new Error("App-server queued follow-up no longer exists");
      }
      const method = position?.messageId ? "thread/queue/update" : "thread/queue/add";
      writes.push({ method, thread, message, position, prepared });
      if (failure) throw failure;
      list.push(message);
      return { status: "queued", messageId: message.id };
    },
    async restore(thread: string, snapshot: any) {
      snapshot.message.id = "restored";
      this.read(thread).push(snapshot.message);
    },
    dispose() {},
  };
  return { api, queue, rows, writes, events, settings,
    fail: (error: Error) => { failure = error; },
    advance: (ms: number) => { now += ms; } };
}

test("native queue edit contract fails after removing the old row", async () => {
  const h = harness();
  await h.queue.remove("t", "old");
  await assert.rejects(h.queue.enqueue("t", { id: "draft" }, { messageId: "old" }), /no longer exists/);
  assert.equal(h.writes.length, 0);
});

test("confirmed queue edit re-adds once with intact context and ordering hints", async () => {
  const h = harness();
  assert.equal(h.api.patch(h.queue), true);
  await h.queue.remove("t", "old");
  const message = Object.freeze({ id: "draft", context: { prompt: "edited", imageAttachments: [{ src: "image" }],
    fileAttachments: [{ path: "file" }], model: "selected-model", reasoningEffort: "high" } });
  const position = Object.freeze({ messageId: "old", nextMessageId: "next", previousMessageId: null, isImageEditFollowUp: true });
  const prepared = { input: [{ type: "text", text: "edited" }], clientUserMessageId: "client-id" };
  assert.equal((await h.queue.enqueue("t", message, position, prepared)).messageId, "draft");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].method, "thread/queue/add");
  assert.equal(h.writes[0].message, message);
  assert.equal(h.writes[0].prepared, prepared);
  assert.deepEqual(h.writes[0].position, { nextMessageId: "next", previousMessageId: null, isImageEditFollowUp: true });
  assert.equal(position.messageId, "old");
  assert.equal(JSON.stringify(h.events).includes("edited"), false);
});

test("fresh queue adds and existing queue updates keep native behavior", async () => {
  const h = harness();
  h.api.patch(h.queue);
  await h.queue.enqueue("t", { id: "fresh" });
  await h.queue.enqueue("t", { id: "edit" }, { messageId: "old" });
  assert.deepEqual(h.writes.map((w) => w.method), ["thread/queue/add", "thread/queue/update"]);
});

test("missing or consumed rows without a successful local delete are never replayed", async () => {
  const h = harness();
  h.api.patch(h.queue);
  assert.equal(await h.queue.remove("t", "missing"), null);
  await assert.rejects(h.queue.enqueue("t", { id: "draft" }, { messageId: "missing" }), /no longer exists/);
  h.rows.set("t", []);
  await assert.rejects(h.queue.enqueue("t", { id: "draft" }, { messageId: "old" }), /no longer exists/);
  assert.equal(h.writes.length, 0);
});

test("network failure after add is not retried and its deletion marker is consumed", async () => {
  const h = harness();
  h.api.patch(h.queue);
  await h.queue.remove("t", "old");
  const failure = new Error("connection lost after write");
  h.fail(failure);
  await assert.rejects(h.queue.enqueue("t", { id: "draft" }, { messageId: "old" }), (e) => e === failure);
  await assert.rejects(h.queue.enqueue("t", { id: "draft2" }, { messageId: "old" }), /no longer exists/);
  assert.equal(h.writes.length, 1);
});

test("concurrent submits for the same removed ID cannot add twice", async () => {
  const h = harness();
  h.api.patch(h.queue);
  await h.queue.remove("t", "old");
  const results = await Promise.allSettled([
    h.queue.enqueue("t", { id: "draft" }, { messageId: "old" }),
    h.queue.enqueue("t", { id: "draft2" }, { messageId: "old" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(h.writes.length, 1);
});

test("queue deletion evidence is isolated by thread and queue instance", async () => {
  const h = harness();
  h.api.patch(h.queue);
  await h.queue.remove("t", "old");
  await assert.rejects(h.queue.enqueue("other", { id: "draft" }, { messageId: "old" }), /no longer exists/);
  const other = harness();
  other.api.patch(other.queue);
  other.rows.set("t", []);
  await assert.rejects(other.queue.enqueue("t", { id: "draft" }, { messageId: "old" }), /no longer exists/);
  assert.equal(h.writes.length + other.writes.length, 0);
});

test("undo restore, expiry, disable, and disposal invalidate stale edit recovery", async () => {
  for (const operation of ["undo", "expiry", "disable", "dispose"]) {
    const h = harness();
    h.api.patch(h.queue);
    const snapshot = await h.queue.remove("t", "old");
    if (operation === "undo") await h.queue.restore("t", snapshot);
    if (operation === "expiry") h.advance(30 * 60 * 1000);
    if (operation === "disable") h.settings.enhancementsEnabled = false;
    if (operation === "dispose") h.queue.dispose();
    await assert.rejects(h.queue.enqueue("t", { id: "draft" }, { messageId: "old" }), /no longer exists/);
    assert.equal(h.writes.length, 0, operation);
  }
});

test("patching is idempotent and unsupported or immutable native queues are untouched", () => {
  const h = harness();
  assert.equal(h.api.patch(h.queue), true);
  const enqueue = h.queue.enqueue;
  assert.equal(h.api.patch(h.queue), true);
  assert.equal(enqueue, h.queue.enqueue);
  const immutable = Object.freeze(harness().queue);
  assert.equal(h.api.patch(immutable), false);
  const fixed = harness().queue;
  fixed.enqueue = async () => ({ status: "queued", messageId: "fixed" });
  const original = fixed.enqueue;
  assert.equal(h.api.patch(fixed), false);
  assert.equal(fixed.enqueue, original);
});

test("coordinator installs on current and replacement queues without repeated wrapping", () => {
  const h = harness();
  const coordinator = {
    serverQueue: h.queue,
    sendMessage() {},
    removeQueuedMessage() {},
    setServerQueue(queue: typeof h.queue) { this.serverQueue = queue; },
  };
  assert.equal(h.api.coordinator({ turnCoordinator: coordinator }), true);
  const setter = coordinator.setServerQueue;
  h.api.coordinator(coordinator);
  assert.equal(setter, coordinator.setServerQueue);
  const next = harness().queue;
  const original = next.enqueue;
  coordinator.setServerQueue(next);
  assert.notEqual(next.enqueue, original);
});

test("queue compatibility discovery is independent of provider and Fast toggles and bounded", async () => {
  let now = 0;
  let discoveries = 0;
  const window = { location: { href: "app://-/index.html#/thread/one" } };
  const settings = { enhancementsEnabled: true };
  const api = new Function("window", "Date", "alunixaXBackendSettings", "loadAppServerRequestCandidates", `
    let alunixaXBackendSettingsLoaded = true;
    let codexQueuedFollowUpDiscovery = { key: "", attempts: 0, at: 0, pending: null };
    const codexAppAssetCandidateUrls = () => [];
    const patchCodexQueuedFollowUpCoordinator = () => false;
    const sendAlunixaXDiagnostic = () => {};
    ${functions("installCodexQueuedFollowUpEditPatch")}
    return async () => { installCodexQueuedFollowUpEditPatch(); await codexQueuedFollowUpDiscovery.pending; };
  `)(window, { now: () => now }, settings, async () => { discoveries++; return { candidates: [] }; });
  await Promise.all(Array.from({ length: 20 }, () => api()));
  assert.equal(discoveries, 1);
  for (let i = 0; i < 20; i++) { now += 30001; await api(); }
  assert.equal(discoveries, 8);
  window.location.href += "-two";
  await api();
  assert.equal(discoveries, 9);
  settings.enhancementsEnabled = false;
  now += 30001;
  await api();
  assert.equal(discoveries, 9);
  assert.match(functions("scanDeferred"), /installCodexQueuedFollowUpEditPatch\(\)/);
});
