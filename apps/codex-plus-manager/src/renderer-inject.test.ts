import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

function installRendererStyle(renderer: string) {
  const start = renderer.indexOf("  function installStyle()");
  const end = renderer.indexOf("\n  function defaultCodexPlusSettings", start);
  assert.ok(start >= 0 && end > start);
  const source = renderer.slice(start, end);
  const requiredNames = new Set([
    "styleId",
    "codexDeleteStyleVersion",
    ...Array.from(source.matchAll(/\$\{([A-Za-z_$][A-Za-z0-9_$]*)/g), (match) => match[1]),
  ]);
  const declarations = Array.from(requiredNames, (name) => {
    const declaration = renderer.match(new RegExp(`^  const ${name} = .+;$`, "m"))
      ?? renderer.match(new RegExp(`^  const ${name} = [\\s\\S]*?^  };$`, "m"));
    assert.ok(declaration, `missing renderer declaration for ${name}`);
    return declaration[0];
  }).join("\n");
  const appended: Array<{ dataset: Record<string, string>; id?: string; textContent?: string }> = [];
  const document = {
    getElementById() {
      return null;
    },
    createElement() {
      return { dataset: {} };
    },
    documentElement: {
      appendChild(node: (typeof appended)[number]) {
        appended.push(node);
      },
    },
  };
  const install = new Function("document", `${declarations}\n${source}\ninstallStyle();`) as (
    documentValue: typeof document,
  ) => void;

  install(document);
  return appended;
}

describe("renderer injection compatibility", () => {
  it("initializes styles without unresolved template identifiers", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );

    const appended = installRendererStyle(renderer);

    assert.equal(appended.length, 1);
    assert.match(appended[0].textContent ?? "", /#codex-plus-menu/);
  });

  it("discovers current app bundles for app-server request patches", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );

    assert.match(renderer, /function appServerFallbackAssetUrls\(\)/);
    assert.match(renderer, /app-initial\|app-main/);
    assert.match(renderer, /function collectAppServerRequestCandidatesFromModule\(module\)/);
    assert.match(renderer, /loadAppServerRequestCandidates\(\)/);
  });
});
