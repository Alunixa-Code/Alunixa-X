import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const app = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["applyContextLimitPreview", "parseContextWindowTokens", "setRootTomlIntKey", "setRootTomlLine",
  "removeRootTomlKey", "ensureTrailingNewline", "tomlTablePathFromLine", "parseTomlDottedPath"];
const extracted = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""))
  .map((node) => node.getText(source)).join("\n");
const compiled = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const preview = new Function("isCustomModelsRelayProfile", `${compiled};return applyContextLimitPreview;`)(
  (profile: any) => profile.relayMode === "customModels",
);
function profile(patch = {}) {
  return { relayMode: "customModels", contextWindow: "272000", autoCompactEnabled: true, autoCompactLimit: "271000",
    lastUsedModel: "large", customModels: [
      { model: "small", contextWindow: "272000", autoCompactEnabled: true, autoCompactLimit: "271000" },
      { model: "large", contextWindow: "1.05M", autoCompactEnabled: true, autoCompactLimit: "1000000" },
    ], ...patch };
}

test("custom config preview removes global limits so the model catalog remains authoritative", () => {
  const text = preview("model_context_window = 272000\nmodel_auto_compact_token_limit = 271000\n", profile());
  assert.doesNotMatch(text, /model_context_window|model_auto_compact_token_limit/);
});

test("custom preview clears old root values for an empty window and disabled compaction", () => {
  const p = profile();
  p.customModels[1] = { model: "large", contextWindow: "", autoCompactEnabled: false, autoCompactLimit: "1000000" };
  const text = preview("model_context_window = 272000\nmodel_auto_compact_token_limit = 271000\n", p);
  assert.doesNotMatch(text, /model_context_window|model_auto_compact_token_limit/);
});

test("custom preview removes only root limits and preserves nested profile limits", () => {
  const original = "model = 'large'\n[profiles.other] # user profile\nmodel_context_window = 123000\nmodel_auto_compact_token_limit = 100000\n";
  const text = preview(original, profile());
  assert.doesNotMatch(text.split("[profiles.other]")[0], /model_context_window|model_auto_compact_token_limit/);
  assert.match(text, /\[profiles.other\] # user profile\nmodel_context_window = 123000\nmodel_auto_compact_token_limit = 100000/);
});

test("regular preview preserves inherited window but removes disabled compaction", () => {
  const text = preview("model_context_window = 800000\nmodel_auto_compact_token_limit = 700000\n",
    { relayMode: "pureApi", contextWindow: "", autoCompactEnabled: false, autoCompactLimit: "700000" });
  assert.match(text, /model_context_window = 800000/);
  assert.doesNotMatch(text, /model_auto_compact_token_limit/);
});

test("custom startup selection is explicit and distinct from editing another model", () => {
  const start = app.indexOf("function CustomModelsRelayProfileEditor");
  const end = app.indexOf("function SortableCustomModelBlock", start);
  const editor = app.slice(start, end);
  assert.match(editor, /onChange=\{\(event\) => applyModels\(models, \{ lastUsedModel: event\.currentTarget\.value \}\)\}/);
});
