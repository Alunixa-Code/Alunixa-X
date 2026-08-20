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

function rendererFunction(renderer: string, name: string) {
  const match = renderer.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, "m"));
  assert.ok(match, `missing renderer function ${name}`);
  return match[0].replace(/^  /gm, "");
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
    assert.match(renderer, /scheduleAppServerModelRequestPatchRetry\(\)/);
    assert.match(renderer, /appServerModelRequestPatchPromise/);
  });

  it("normalizes official mixed-mode Remote Control providers", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );
    const source = [
      "codexRemoteSessionProviderNormalizationEnabled",
      "codexRemoteSessionTargetProvider",
      "codexRemoteSessionThreadStartMethod",
      "applyCodexRemoteSessionProviderOverride",
    ].map((name) => rendererFunction(renderer, name)).join("\n");
    const build = new Function(
      "codexPlusBackendSettings",
      "codexModelCatalog",
      "sendCodexPlusDiagnostic",
      `${source}\nreturn applyCodexRemoteSessionProviderOverride;`,
    ) as (
      settings: Record<string, unknown>,
      catalog: Record<string, unknown>,
      diagnostic: () => void,
    ) => (method: string, params: Record<string, unknown>) => Record<string, unknown>;
    const apply = build(
      {
        relayProfilesEnabled: true,
        activeRelayId: "mixed",
        relayProfiles: [{ id: "mixed", relayMode: "official", officialMixApiKey: "secret" }],
      },
      { codex_model_provider: "custom-provider" },
      () => undefined,
    );

    assert.deepEqual(apply("thread/start", { model_provider: "openai" }), {
      modelProvider: "custom-provider",
    });
    assert.deepEqual(apply("thread/start", { modelProvider: "third-party" }), {
      modelProvider: "third-party",
    });
    assert.deepEqual(apply("turn/start", { modelProvider: "openai" }), {
      modelProvider: "openai",
    });
  });

  it("accepts real Remote Control notifications and rejects temporary thread ids", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );
    const parseThreadId = new Function(
      `${rendererFunction(renderer, "codexRemoteSessionStartedThreadId")}\nreturn codexRemoteSessionStartedThreadId;`,
    )() as (value: unknown) => string;
    const idApi = new Function(
      `${rendererFunction(renderer, "isClientNewThreadId")}\n${rendererFunction(renderer, "normalizedCodexThreadUuid")}\nreturn { isClientNewThreadId, normalizedCodexThreadUuid };`,
    )() as {
      isClientNewThreadId(value: unknown): boolean;
      normalizedCodexThreadUuid(value: unknown): string;
    };

    assert.equal(
      parseThreadId({ method: "thread/started", params: { thread: { id: "real-thread" } } }),
      "real-thread",
    );
    assert.equal(
      parseThreadId({ type: "browser-sidebar-browser-use-state", params: { isActive: false, conversationId: "ignored" } }),
      "",
    );
    assert.equal(idApi.isClientNewThreadId("local:client-new-thread:draft"), true);
    assert.equal(idApi.isClientNewThreadId("11111111-1111-4111-8111-111111111111"), false);
    assert.equal(
      idApi.normalizedCodexThreadUuid("local:11111111-1111-4111-8111-111111111111"),
      "11111111-1111-4111-8111-111111111111",
    );
    assert.match(renderer, /normalizedThreadId\.length > 128 \|\| isClientNewThreadId\(normalizedThreadId\)/);
    assert.match(renderer, /event\?\.source !== window/);
    assert.match(renderer, /dispatcher\.subscribe\("thread\/started", handler\)/);
    assert.match(renderer, /postJson\("\/remote-control-session\/recover", payload\)/);
    assert.match(renderer, /attributeFilter: \["data-app-action-sidebar-thread-id", "href"\]/);
  });
});
