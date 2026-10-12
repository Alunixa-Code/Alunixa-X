import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeTokenCountInput } from "./model-metadata.ts";

const app = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(source.statements.filter(ts.isFunctionDeclaration)
  .filter(node => node.name).map(node => [node.name!.text, node]));
const names = new Set<string>();
function include(name: string) {
  if (names.has(name)) return;
  const node = functions.get(name);
  assert.ok(node, `missing production helper: ${name}`);
  names.add(name);
  function visit(child: ts.Node) {
    if (ts.isIdentifier(child) && functions.has(child.text)) include(child.text);
    ts.forEachChild(child, visit);
  }
  visit(node);
}
include("applyContextLimitPreview");
const extracted = [...names].map(name => functions.get(name)!.getText(source)).join("\n");
const compiled = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const preview = new Function("normalizeTokenCountInput", `${compiled};return applyContextLimitPreview;`)(normalizeTokenCountInput);
function profile(patch = {}) {
  return { relayMode: "customModels", contextWindow: "272000", autoCompactEnabled: true, autoCompactLimit: "271000",
    defaultCustomModelId: "large", customModels: [
      { id: "small", model: "small", contextWindow: "272000", autoCompactEnabled: true, autoCompactLimit: "271000" },
      { id: "large", model: "large", contextWindow: "1M", autoCompactEnabled: true, autoCompactLimit: "900000" },
    ], ...patch };
}

test("custom config preview removes global limits so the model catalog remains authoritative", () => {
  const text = preview("model_context_window = 272000\nmodel_auto_compact_token_limit = 271000\n", profile());
  assert.doesNotMatch(text, /model_context_window|model_auto_compact_token_limit/);
});

test("custom preview clears old root values for an empty window and disabled compaction", () => {
  const p = profile();
  p.customModels[1] = { id: "large", model: "large", contextWindow: "", autoCompactEnabled: false, autoCompactLimit: "1000000" };
  const text = preview("model_context_window = 272000\nmodel_auto_compact_token_limit = 271000\n", p);
  assert.doesNotMatch(text, /model_context_window|model_auto_compact_token_limit/);
});

test("custom preview removes only root limits and preserves nested profile limits", () => {
  const original = "model = 'large'\n[profiles.other] # user profile\nmodel_context_window = 123000\nmodel_auto_compact_token_limit = 100000\n";
  const text = preview(original, profile());
  assert.doesNotMatch(text.split("[profiles.other]")[0], /model_context_window|model_auto_compact_token_limit/);
  assert.match(text, /\[profiles.other\] # user profile\nmodel_context_window = 123000\nmodel_auto_compact_token_limit = 100000/);
});

test("regular preview preserves inherited window and compaction when neither is explicitly overridden", () => {
  const text = preview("model_context_window = 800000\nmodel_auto_compact_token_limit = 700000\n",
    { relayMode: "pureApi", contextWindow: "", autoCompactLimit: "" });
  assert.match(text, /model_context_window = 800000/);
  assert.match(text, /model_auto_compact_token_limit = 700000/);
});

test("custom startup selection is explicit and distinct from editing another model", () => {
  const editor = fs.readFileSync(new URL("./components/CustomModelsEditor.tsx", import.meta.url), "utf8");
  assert.match(app, /defaultId=\{profile\.defaultCustomModelId/);
  assert.match(app, /updateDraft\(\{customModels,defaultCustomModelId,model:selected\?\.model/);
  assert.match(editor, /type="radio"[\s\S]*?checked=\{defaultId === model\.id\}[\s\S]*?onChange=\{\(\) => onChange\(models,model\.id\)\}/);
  assert.match(editor, /onChange\(models\.map[\s\S]*?, defaultId\)/);
});

test("an explicit global preview update never overwrites a nested profile's limits", () => {
  const original = "[profiles.other] # user profile\nmodel_context_window = 123000\nmodel_auto_compact_token_limit = 100000\n";
  const text = preview(original, { relayMode: "pureApi", contextWindow: "800000", autoCompactLimit: "700000" });
  const [root, nested] = text.split("[profiles.other]");
  assert.match(root, /model_context_window = 800000/);
  assert.match(root, /model_auto_compact_token_limit = 700000/);
  assert.match(nested, /model_context_window = 123000/);
  assert.match(nested, /model_auto_compact_token_limit = 100000/);
});
