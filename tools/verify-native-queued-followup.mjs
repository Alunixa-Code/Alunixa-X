import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "../apps/alunixa-x-manager/node_modules/typescript/lib/typescript.js";
import { readAsarAssets } from "./audit-codex-bundle.mjs";

// Run the installed queue factory in isolation. Never import the desktop app,
// connect to its app-server, write its ASAR, or use real conversation content.
const asarPath = process.argv[2];
if (!asarPath) throw new Error("Usage: node tools/verify-native-queued-followup.mjs <Codex app.asar>");
const asset = readAsarAssets(asarPath).find(({ source }) =>
  source.includes("App-server queued follow-up no longer exists"));
assert.ok(asset, "Installed app must contain the affected native queue contract");
const file = ts.createSourceFile(asset.name, asset.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = file.statements.filter(ts.isFunctionDeclaration);
const factory = declarations.find((node) =>
  node.getText(file).includes("App-server queued follow-up no longer exists"));
assert.ok(factory?.name, "Native queue factory");
const factorySource = factory.getText(file);
const order = declarations.find((node) => {
  const text = node.getText(file);
  return text.length < 600 && text.includes("nextMessageId") && text.includes("previousMessageId")
    && factorySource.includes(`${node.name?.text}(`);
});
assert.ok(order, "Native queue position resolver");
const createQueue = new Function(`${factorySource}\n${order.getText(file)}\nreturn ${factory.name.text};`)();
const renderer = fs.readFileSync(new URL("../assets/inject/renderer-inject.js", import.meta.url), "utf8");
const patchSource = ["codexModuleFunctionSource", "patchCodexQueuedFollowUpQueue"].map((name) => {
  const match = renderer.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");
const patch = new Function("alunixaXBackendSettings", "sendAlunixaXDiagnostic",
  `${patchSource}\nreturn patchCodexQueuedFollowUpQueue;`)({ enhancementsEnabled: true }, () => {});

function fixture() {
  let sequence = 0;
  let rows = [];
  const writes = [];
  const manager = {
    getHostId: () => "local",
    getConversation: () => null,
    addNotificationCallback: () => () => {},
    async sendRequest(method, params) {
      assert.equal(params.threadId, "fixture-thread");
      if (method === "thread/queue/list") return { data: [...rows], nextCursor: null };
      writes.push({ method, params });
      if (method === "thread/queue/add") {
        const row = { id: `fixture-${++sequence}`, input: params.input,
          clientUserMessageId: params.clientUserMessageId };
        rows.push(row);
        return { queuedSubmission: row };
      }
      if (method === "thread/queue/delete") {
        const present = rows.some((row) => row.id === params.queuedSubmissionId);
        rows = rows.filter((row) => row.id !== params.queuedSubmissionId);
        return { deleted: present };
      }
      if (method === "thread/queue/reorder") {
        rows = params.queuedSubmissionIds.map((id) => {
          const row = rows.find((row) => row.id === id);
          assert.ok(row);
          return row;
        });
        return {};
      }
      throw new Error(`Unexpected fixture method: ${method}`);
    },
  };
  return { queue: createQueue({ scope: {}, manager, appServerVersion: () => "fixture" }),
    writes, rows: () => rows };
}
const message = (id) => ({ id, text: id, context: { prompt: id, imageAttachments: [], fileAttachments: [] }, createdAt: 1 });
const prepared = { input: [{ type: "text", text: "isolated edited prompt" },
  { type: "image", url: "data:image/png;base64,Zml4dHVyZQ==" },
  { type: "mention", path: "fixture.md", name: "fixture" }], clientUserMessageId: "edited-client" };

const before = fixture();
const old = await before.queue.enqueue("fixture-thread", message("before"), undefined, prepared);
await before.queue.remove("fixture-thread", old.messageId);
await assert.rejects(before.queue.enqueue("fixture-thread", message("edit"), { messageId: old.messageId }, prepared),
  /App-server queued follow-up no longer exists/);
assert.equal(before.rows().length, 0);

const after = fixture();
assert.equal(patch(after.queue), true);
const first = await after.queue.enqueue("fixture-thread", message("first"), undefined, prepared);
const second = await after.queue.enqueue("fixture-thread", message("second"), undefined, prepared);
await after.queue.remove("fixture-thread", first.messageId);
const result = await after.queue.enqueue("fixture-thread", message("edit"),
  { messageId: first.messageId, nextMessageId: second.messageId }, prepared);
assert.equal(result.status, "queued");
assert.deepEqual(after.rows().map((row) => row.id), [result.messageId, second.messageId]);
assert.deepEqual(after.rows()[0].input, prepared.input);
assert.equal(after.rows()[0].clientUserMessageId, "edited-client");
assert.deepEqual(after.queue.read("fixture-thread").map((row) => row.id), [result.messageId, second.messageId]);
assert.equal(after.writes.filter(({ method }) => method === "thread/queue/update").length, 0);
assert.equal(after.writes.filter(({ method }) => method === "thread/queue/add").length, 3);
console.log(JSON.stringify({ status: "PASS", asset: asset.name, baselineReproduced: true,
  editedRequeuedOnce: true, orderPreserved: true, inputPreserved: true, liveAppAccessed: false }));
