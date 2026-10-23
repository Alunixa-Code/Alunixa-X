import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const styles = read("./styles.css");
const management = read("./ManagementPages.css");
const main = read("./main.tsx");
const preview = read("../web-preview/entry.tsx");
const app = read("./App.tsx");

test("classic offline typography and branded management surfaces are restored", () => {
  for (const weight of [400, 500, 600, 700]) {
    assert.ok(main.includes(`@fontsource/inter/${weight}.css`));
    assert.ok(preview.includes(`@fontsource/inter/${weight}.css`));
  }
  assert.match(styles, /--font-sans:\s*Inter,/);
  assert.match(styles, /font-feature-settings:\s*"cv02", "cv03", "cv04", "cv11", "ss01"/);
  assert.match(management, /\.mg-primary\{background:linear-gradient/);
  assert.doesNotMatch(management, /\.dark \.mg-skills-page\s*\{/);
  assert.doesNotMatch(management, /background:hsl\(232 76% 54%\)/);
});

test("classic model cards retain the independent protocol and reasoning fields at small widths", () => {
  assert.match(styles, /@container relay-editor \(max-width: 900px\)/);
  assert.match(styles, /\.relay-model-cell-protocol\s*\{\s*grid-column: 2 \/ 4;\s*grid-row: 2/);
  assert.match(styles, /\.relay-model-cell-reasoning\s*\{\s*grid-column: 2 \/ -1;\s*grid-row: 4/);
  assert.ok(app.includes('aria-label={t("模型协议")}'));
  assert.ok(app.includes("modelWindows"));
  assert.ok(app.includes("modelAutoCompact"));
  assert.ok(app.includes('route === "requestLog"'));
  assert.ok(app.includes('route === "agentCollaboration"'));
});
