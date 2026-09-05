// Opt-in integration harness. Uses a separately downloaded CLI and a fake local API.
// Never point this at an installed/live Codex: executable must be inside fixtureRoot.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const [fixtureArg, bridgeArg] = process.argv.slice(2);
assert(fixtureArg && bridgeArg, "Usage: node test-context-api-compat.mjs <fixtureRoot> <builtCompanion>");
const fixtureRoot = fs.realpathSync(fixtureArg);
const executable = fs.realpathSync(path.join(fixtureRoot, "isolated-codex.exe"));
assert.equal(path.dirname(executable), fixtureRoot);
const bridge = fs.realpathSync(bridgeArg);
const runRoot = fs.mkdtempSync(path.join(fixtureRoot, "run-"));
const home = path.join(runRoot, "codex-home");
const work = path.join(runRoot, "project");
for (const directory of [home, work, path.join(runRoot, "appdata"), path.join(runRoot, "local")]) {
  fs.mkdirSync(directory, { recursive: true });
}

const fixtureThread = randomUUID();
let threadId;
let phase = 0;
let requests = 0;
let error;
let noteName;
let historyName;
let sawRollover = false;
const expectedNote = "LOCAL_CONTEXT_SAVED_NOTE: resume the isolated task after rollover";
const toolNames = [];
const events = [];
const discoveries = new Set();

const getToolName = (tools, suffix) => {
  for (const tool of tools) {
    if (tool.name?.endsWith(suffix)) return tool.name;
    if (tool.type === "namespace" && tool.tools) {
      const nested = getToolName(tool.tools, suffix);
      if (nested) return `${tool.name}.${nested}`;
    }
  }
};
const functionCall = (name, arguments_) => ({
  id: `fc_${randomUUID().replaceAll("-", "")}`, type: "function_call",
  call_id: `call_${phase}`, name, arguments: JSON.stringify(arguments_),
});
const finalMessage = () => ({
  id: `msg_${phase}`, type: "message", role: "assistant", status: "completed",
  content: [{ type: "output_text", text: "ISOLATED_CONTEXT_COMPAT_PASS", annotations: [] }],
});
const sse = (response, item) => {
  const id = `resp_${requests}`;
  const usage = { input_tokens: 900, output_tokens: 50, total_tokens: 950 };
  response.writeHead(200, { "content-type": "text/event-stream" });
  const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: "response.created", response: { id, object: "response", status: "in_progress", output: [] } });
  send({ type: "response.output_item.added", output_index: 0, item });
  send({ type: "response.output_item.done", output_index: 0, item });
  send({ type: "response.completed", response: { id, object: "response", status: "completed", output: [item], usage } });
  response.end();
};

const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/responses", "Only the fake local Responses route may be requested");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests++;
    assert(requests <= 10, "No unbounded model loop");
    assert.equal(request.headers.authorization, "Bearer alunixa-context-fixture-only");
    const inputText = JSON.stringify(body.input);
    toolNames.push((body.tools ?? []).map((tool) => tool.name ?? tool.type));
    const available = [
      ...(body.tools ?? []),
      ...(body.input ?? []).filter((item) => item.type === "tool_search_output").flatMap((item) => item.tools ?? []),
    ];
    if ([0, 2, 3].includes(phase) &&
        (!getToolName(available, "context_notes") || !getToolName(available, "context_history"))) {
      assert(!discoveries.has(phase), "Deferred MCP discovery must return both real tools");
      discoveries.add(phase);
      assert((body.tools ?? []).some((tool) => tool.type === "tool_search"));
      sse(response, {
        id: `tsc_${requests}`, type: "tool_search_call",
        call_id: `discover_${requests}`, execution: "client", status: "completed",
        arguments: { query: "alunixa-x-context context_notes context_history local", limit: 8 },
      });
      return;
    }
    let item;
    if (phase === 0) {
      noteName = getToolName(available, "context_notes");
      historyName = getToolName(available, "context_history");
      assert(noteName && historyName, "The real CLI must expose both local MCP tools");
      assert(getToolName(body.tools ?? [], "new_context"), "Native new_context must be available without login");
      assert(getToolName(body.tools ?? [], "get_context_remaining"), "Native context budget tool must be available");
      assert(inputText.includes("LOCAL_CONTEXT_NEEDLE"), "Fixture user message must reach the fake API");
      assert(threadId, "CLI must report its own thread UUID before issuing the request");
      item = functionCall(noteName, { thread_id: threadId, action: "set", content: expectedNote });
    } else if (phase === 1) {
      assert(inputText.includes(expectedNote), "Persistent note write must produce a real tool result");
      item = functionCall("new_context", {});
    } else if (phase === 2) {
      assert(!inputText.includes(expectedNote), "new_context must actually clear the earlier note tool output");
      item = functionCall(noteName, { thread_id: threadId, action: "get" });
    } else if (phase === 3) {
      assert(inputText.includes(expectedNote), "Saved note must be readable after a real window rollover");
      item = functionCall(historyName, { thread_id: threadId, query: "LOCAL_CONTEXT_NEEDLE" });
    } else {
      assert(inputText.includes('\\"found\\":true'), "History lookup must find this thread's local rollout");
      assert(inputText.includes("LOCAL_CONTEXT_NEEDLE"), "Local history must recover the earlier user message");
      item = finalMessage();
    }
    phase++;
    sse(response, item);
  } catch (failure) {
    error = failure;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: String(failure) } }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const tomlString = (value) => JSON.stringify(value);
fs.writeFileSync(path.join(home, "config.toml"), `
model = "gpt-5.4"
model_provider = "fixture"
model_context_window = 1000000
model_auto_compact_token_limit = 990000
[model_providers.fixture]
name = "Isolated fake API"
base_url = "http://127.0.0.1:${port}/v1"
env_key = "ALUNIXA_CONTEXT_FIXTURE_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
[features]
shell_tool = false
enable_request_compression = false
[features.code_mode]
enabled = false
[features.code_mode_host]
enabled = false
[features.context_management]
experimental_mode = true
[features.token_budget]
enabled = true
use_history_notes_extension = false
guidance_message = "Use local context_notes and context_history. Persist task notes before new_context; read them after rollover."
[mcp_servers.alunixa-x-context]
command = ${tomlString(bridge)}
args = ["--context-management"]
enabled = true
[mcp_servers.alunixa-x-context.env]
ALUNIXA_X_CONTEXT_HOME = ${tomlString(home)}
`);

const child = spawn(executable, [
  "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only",
  "--cd", work, `LOCAL_CONTEXT_NEEDLE ${fixtureThread}: Validate local context tools against the fake API only.`,
], {
  cwd: work,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    PATH: process.env.PATH, TEMP: runRoot, TMP: runRoot,
    USERPROFILE: runRoot, HOME: runRoot,
    APPDATA: path.join(runRoot, "appdata"), LOCALAPPDATA: path.join(runRoot, "local"),
    CODEX_HOME: home, CODEX_SQLITE_HOME: home,
    ALUNIXA_CONTEXT_FIXTURE_KEY: "alunixa-context-fixture-only",
    NO_PROXY: "127.0.0.1,localhost", RUST_LOG: "error",
  },
});
let stdout = "";
let stderr = "";
let pending = "";
child.stdout.on("data", (buffer) => {
  const text = buffer.toString("utf8");
  stdout += text;
  pending += text;
  while (pending.includes("\n")) {
    const index = pending.indexOf("\n");
    const line = pending.slice(0, index);
    pending = pending.slice(index + 1);
    try {
      const event = JSON.parse(line);
      events.push(event.type);
      if (event.type === "thread.started") threadId = event.thread_id;
      if (JSON.stringify(event).includes("context_compact")) sawRollover = true;
    } catch {}
  }
});
child.stderr.on("data", (buffer) => { stderr += buffer.toString("utf8"); });
const timeout = setTimeout(() => child.kill(), 90000);
let exitCode;
try {
  exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
} finally {
  clearTimeout(timeout);
  await new Promise((resolve) => server.close(resolve));
}
fs.writeFileSync(path.join(runRoot, "evidence.json"), JSON.stringify({
  exitCode, phase, requests, threadId, sawRollover, events, toolNames,
  error: error?.message, stdout, stderr,
}, null, 2));
assert(!fs.existsSync(path.join(home, "auth.json")), "No login credentials may be created");
if (error) throw error;
assert.equal(exitCode, 0, `Isolated CLI failed: ${stderr.slice(-6000)}`);
assert.equal(phase, 5);
assert(stdout.includes("ISOLATED_CONTEXT_COMPAT_PASS"));
console.log(JSON.stringify({ status: "PASS", requests, threadId, evidence: path.join(runRoot, "evidence.json"), noChatGptLogin: true }));
