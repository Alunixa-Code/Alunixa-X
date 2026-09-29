import assert from "node:assert";
import { describe, it, test } from "node:test";
import { PRESETS } from "./presets.ts";

describe("provider presets", () => {
  it("keeps the MiniMax China preset aligned with its current model", () => {
    const china = PRESETS.find((preset) => preset.id === "minimax");

    assert.deepStrictEqual(china, {
      id: "minimax",
      name: "MiniMax",
      websiteUrl: "https://platform.minimaxi.com",
      apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan",
      category: "cn_official",
      baseUrl: "https://api.minimaxi.com/v1",
      protocol: "chatCompletions",
      model: "MiniMax-M2.7",
      modelList: ["MiniMax-M2.7"],
    });

    assert.equal(PRESETS.some((preset) => preset.id === "minimax-global"), false);
  });

test("DeepSeek preset uses the official Responses integration", () => {
  const preset = PRESETS.find((candidate) => candidate.id === "deepseek");
  assert.ok(preset);
  assert.equal(preset.baseUrl, "https://api.deepseek.com");
  assert.equal(preset.protocol, "chatCompletions");
  assert.equal(preset.model, "deepseek-v4-flash");
  assert.deepEqual(preset.modelList, ["deepseek-v4-flash", "deepseek-v4-pro"]);
});
});
