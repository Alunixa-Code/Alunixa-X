import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/10-style.js", import.meta.url), "utf8");

test("native popup positioning wrappers and menu bar stay above open extension pages", () => {
  const page = source.match(/\.\$\{alunixaXPageClass\}\s*\{([\s\S]*?)\n      \}/);
  assert.ok(page);
  const pageLayer = Number(page[1].match(/z-index:\s*(\d+)/)?.[1]);
  const popup = source.match(/html\[data-alunixa-x-page-open\] \[data-radix-popper-content-wrapper\]([\s\S]*?)\n      \}/);
  assert.ok(popup);
  assert.match(popup[0], /ApplicationMenuTopBar/);
  assert.match(popup[0], /role="tooltip"/);
  assert.match(popup[0], /role="menu"/);
  assert.match(popup[0], /:not\(\.\$\{alunixaXPageClass\} \*\)/);
  const popupLayer = Number(popup[1].match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(popupLayer > pageLayer);
});
