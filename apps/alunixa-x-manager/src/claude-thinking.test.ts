import assert from "node:assert/strict";
import test from "node:test";
import { isClaudeModel, supportsClaudeAdaptive } from "./claude-thinking.ts";

test("adaptive thinking is only offered for Claude conversion protocols", () => {
  for (const model of ["claude-opus-5-5", "anthropic/claude-opus-4-6", "vendor:CLAUDE-sonnet-4-6"]) {
    assert.equal(isClaudeModel(model), true);
    for (const protocol of ["chatCompletions", "anthropicMessages"]) {
      assert.equal(supportsClaudeAdaptive(model, protocol, "pureApi"), true);
    }
    assert.equal(supportsClaudeAdaptive(model, "responses", "pureApi"), false);
    assert.equal(supportsClaudeAdaptive(model, "chatCompletions", "customModels"), false);
  }
  for (const model of ["gpt-6-astra", "gemini-3-pro", "grok-4", "glm-5", "deepseek-v4-pro", "notclaude-x"]) {
    assert.equal(supportsClaudeAdaptive(model, "chatCompletions", "pureApi"), false);
  }
});
