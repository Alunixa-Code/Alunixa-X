import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("custom model compaction configuration", () => {
  it("shows the selected model's effective context and token threshold", async () => {
    const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

    assert.match(app, /const selectedModelName = profile\.lastUsedModel\.trim\(\)/);
    assert.match(app, /className="custom-model-effective-config"/);
    assert.match(app, /selectedModel\?\.contextWindow/);
    assert.match(app, /selectedModel\?\.autoCompactEnabled \? selectedModel\.autoCompactLimit/);
  });
});
