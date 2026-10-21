import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { modelWindowRowsFromProfile, serializeModelWindowRows } from "./model-windows.ts";
import { serializeModelMetadataDocument } from "./model-metadata.ts";

describe("custom model compaction configuration", () => {
  it("edits per-model context, protocol and auto-compaction without the retired selected-model summary", async () => {
    const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

    assert.match(app, /className="relay-model-row-editor"/);
    assert.match(app, /value=\{row\.window\}/);
    assert.match(app, /value=\{normalizeAutoCompactPercent\(row\.autoCompact\) \|\| DEFAULT_AUTO_COMPACT_PERCENT\}/);
    assert.match(app, /value=\{row\.protocol \|\| ""\}/);
    assert.doesNotMatch(app, /className="custom-model-effective-config"/);
  });

  it("round-trips distinct model windows and computes each model's compaction threshold", () => {
    const rows = modelWindowRowsFromProfile("small\nlarge", '{"small":"200K","large":"1M"}',
      "{}", '{"small":"80%","large":"90%"}', '{"large":"anthropicMessages"}');
    const saved = serializeModelWindowRows(rows);
    assert.deepEqual(modelWindowRowsFromProfile(saved.modelList, saved.modelWindows, saved.modelVlm,
      saved.modelAutoCompact, saved.modelProtocols), rows);
    const limits = rows.map(row => JSON.parse(serializeModelMetadataDocument(row.model, {}, row.window, row.autoCompact)).models[0]);
    assert.deepEqual(limits.map(model => [model.context_window, model.auto_compact_token_limit]),
      [[200000, 160000], [1000000, 900000]]);
  });
});
