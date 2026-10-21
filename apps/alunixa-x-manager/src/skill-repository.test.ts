import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillRepository } from "./skill-repository.ts";

test("accepts GitHub URLs and repository names", () => {
  for (const value of ["openai/skills", "https://github.com/openai/skills.git", "https://www.github.com/openai/skills/?tab=readme#top"]) {
    assert.deepEqual(parseSkillRepository(value), { owner: "openai", name: "skills", branch: "main", subdir: "", enabled: true });
  }
});

test("parses branch and skill directory without retaining a previous draft", () => {
  assert.deepEqual(parseSkillRepository("https://github.com/openai/skills/tree/dev/skills/.curated"), {
    owner: "openai", name: "skills", branch: "dev", subdir: "skills/.curated", enabled: true,
  });
  assert.equal(parseSkillRepository("acme/new-repo")?.subdir, "");
});

test("rejects unrelated hosts, malformed URLs and non-repository routes", () => {
  for (const value of ["https://evil.com/acme/kit", "https://github.com@evil.com/acme/kit", "https://github.com/acme/kit/issues", "https://github.com/acme/kit/tree", "acme", "https://github.com/topics/skills"]) {
    assert.equal(parseSkillRepository(value), null, value);
  }
});
