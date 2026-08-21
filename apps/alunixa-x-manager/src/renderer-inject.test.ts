import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

function installRendererStyle(renderer: string) {
  const start = renderer.indexOf("  function installStyle()");
  const end = renderer.indexOf("\n  function defaultAlunixaXSettings", start);
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
  it("anchors the Alunixa X menu to current and legacy application top bars only", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );

    assert.match(renderer, /appHeader:\s*'[^']*ApplicationMenuTopBar[^']*\.app-header-tint'/);
    assert.doesNotMatch(renderer, /document\.querySelector\(["']header["']\)/);
    assert.match(renderer, /isApplicationMenuTopBar\s*\?\s*Math\.max\(4, headerRect\.top\)/);
    assert.match(renderer, /isApplicationMenuTopBar\s*\?\s*28\s*:\s*headerRect\.height/);
  });

  it("does not install Alunixa X UI in embedded browser documents", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );

    assert.match(renderer, /window\.top\s*!==\s*window/);
    assert.match(renderer, /!window\.electronBridge/);
    assert.match(renderer, /alunixaXIsSupportedMainDocument/);
    assert.match(renderer, /url\.protocol === "app:"/);
    assert.match(renderer, /url\.hostname === "chatgpt\.com"/);
    assert.match(renderer, /alunixaXIsNodeTestHarness/);
  });

  it("adds session copy and native automatic rename workflows", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );

    assert.match(renderer, /原地复制会话 - Alunixa X/);
    assert.match(renderer, /activateSessionCopyMenuItem/);
    assert.match(renderer, /button\[aria-label="从这里创建聊天分支"\]/);
    assert.match(renderer, /data-app-action-sidebar-thread-selected/);
    assert.match(renderer, /isClientNewThreadId\(targetId\)/);
    assert.match(renderer, /自动重命名当前会话/);
    assert.match(renderer, /activateSessionAutoRenameMenuItem/);
    assert.match(renderer, /input\[aria-label="聊天标题"\], input\[aria-label="Chat title"\]/);
    assert.match(renderer, /button\.classList\.contains\("text-info"\)/);
    assert.match(renderer, /Codex 未能生成新名称/);
  });

  it("initializes styles without unresolved template identifiers", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );

    const appended = installRendererStyle(renderer);

    assert.equal(appended.length, 1);
    assert.match(appended[0].textContent ?? "", /#alunixa-x-menu/);
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
      "alunixaXBackendSettings",
      "codexModelCatalog",
      "sendAlunixaXDiagnostic",
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

  it("keeps remote plugin searches isolated from local fallback", async () => {
    const renderer = await readFile(
      new URL("../../../assets/inject/renderer-inject.js", import.meta.url),
      "utf8",
    );
    const api = new Function(`
      const codexPluginRemoteOnlyMarketplaceKinds = new Set(["created-by-me-remote", "shared-with-me"]);
      function restorePluginMarketplaceName(value) { return value; }
      ${rendererFunction(renderer, "pluginMarketplaceRequestProfile")}
      ${rendererFunction(renderer, "pluginMarketplaceErrorText")}
      ${rendererFunction(renderer, "pluginMarketplaceRemoteAuthError")}
      return { pluginMarketplaceRequestProfile, pluginMarketplaceRemoteAuthError };
    `)() as {
      pluginMarketplaceRequestProfile(value: unknown): { remoteOnly: boolean };
      pluginMarketplaceRemoteAuthError(value: unknown): boolean;
    };

    assert.equal(
      api.pluginMarketplaceRequestProfile({ marketplaceKinds: ["created-by-me-remote"] }).remoteOnly,
      true,
    );
    assert.equal(
      api.pluginMarketplaceRequestProfile({ marketplaceKinds: ["created-by-me-remote", "local"] }).remoteOnly,
      false,
    );
    assert.equal(
      api.pluginMarketplaceRemoteAuthError({
        error: {
          message: "ChatGPT authentication required for remote plugin catalog; API key auth is not supported",
        },
      }),
      true,
    );
    assert.equal(api.pluginMarketplaceRemoteAuthError({ message: "temporary network error" }), false);
    assert.match(renderer, /__codexPluginMarketplaceRequestProfiles/);
    assert.match(renderer, /__codexPluginMarketplaceFetchRequestProfiles/);
    assert.match(renderer, /remoteOnlyPluginMarketplaceFallbackResult/);
    assert.match(renderer, /plugin_marketplace_remote_auth_fallback/);
  });
});
