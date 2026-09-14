import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { imageModelEdits, reorderImageModels, upsertImageModel, validateImageModel } from "./image-models.ts";

const a = { id: "a", name: "First", model: "image-a", baseUrl: "https://a.invalid/v1", hasApiKey: true };
const b = { id: "b", name: "Second", model: "image-b", baseUrl: "https://b.invalid/v1", hasApiKey: true };

test("image model order changes default without mutating or losing rows", () => {
  const original = [a, b];
  const sorted = reorderImageModels(original, "b", "a");
  assert.deepEqual(sorted, [b, a]);
  assert.deepEqual(original, [a, b]);
  assert.equal(reorderImageModels(original, "missing", "a"), original);
  assert.equal(reorderImageModels(original, "a", "a"), original);
});

test("reordering retains keys by ID without ever returning key material", () => {
  assert.deepEqual(imageModelEdits([b, a]), [
    { id: "b", name: "Second", model: "image-b", baseUrl: b.baseUrl, apiKey: null },
    { id: "a", name: "First", model: "image-a", baseUrl: a.baseUrl, apiKey: null },
  ]);
});

test("add appends and editing never silently promotes a row to default", () => {
  const edited = upsertImageModel([a, b], { ...b, name: "Edited", apiKey: "" });
  assert.deepEqual(edited.map((row) => row.id), ["a", "b"]);
  assert.equal(edited[1].apiKey, null);
  assert.equal(edited[1].name, "Edited");
  const added = upsertImageModel([a], { ...b, name: "", apiKey: " fixture-key " });
  assert.equal(added[1].name, "image-b");
  assert.equal(added[1].apiKey, "fixture-key");
});

test("image configuration validates URLs, models and new versus saved keys", () => {
  const draft = { ...a, apiKey: "" };
  assert.equal(validateImageModel(draft), null);
  assert.equal(validateImageModel({ ...draft, hasApiKey: false }), "key");
  assert.equal(validateImageModel({ ...draft, apiKey: "new\nheader" }), "key");
  assert.equal(validateImageModel({ ...draft, model: " " }), "model");
  for (const baseUrl of ["file:///tmp/image", "not a URL", "https://u:secret@a.invalid", "https://a.invalid?key=secret"]) {
    assert.equal(validateImageModel({ ...draft, baseUrl }), "url");
  }
});

test("image page is independently persisted and accessible without a mouse", () => {
  const screen = readFileSync(new URL("./components/ImageModelsScreen.tsx", import.meta.url), "utf8");
  assert.ok(screen.includes('"save_image_models", { revision: snapshot.revision, models }'));
  assert.ok(screen.includes("KeyboardSensor"));
  assert.ok(screen.includes("setActivatorNodeRef"));
  assert.ok(screen.includes('type="password"'));
  assert.ok(screen.includes('index === 0 ? <Badge>{t("默认")}</Badge>'));
  assert.ok(!screen.includes('"save_settings"'));
  assert.ok(!screen.includes("localStorage"));
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes('{ id: "imageModels", label: t("生图模型")'));
  assert.ok(app.includes('imageModelsPending.current.dirty'));
});
