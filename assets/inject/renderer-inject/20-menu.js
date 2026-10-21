  function renderCodexPlusMenu() {
    const settings = alunixaXSettings();
    document.querySelectorAll(".alunixa-x-toggle[data-alunixa-x-setting]").forEach((button) => {
      const key = button.getAttribute("data-alunixa-x-setting");
      const waitsForBackend = alunixaXBackendMappedSettings.has(key) && !alunixaXBackendSettingsLoaded;
      button.dataset.enabled = String(!!settings[key]);
      button.setAttribute("aria-checked", button.dataset.enabled);
      button.dataset.pending = String(waitsForBackend);
      button.disabled = waitsForBackend || button.dataset.relayUnneeded === "true";
    });
    refreshConversationViewControls();
    document.querySelectorAll("[data-alunixa-x-typing-effect]").forEach((select) => {
      select.value = ["rainbow", "fireworks", "stars"].includes(settings.typingEffect) ? settings.typingEffect : "off";
      select.disabled = !alunixaXBackendSettingsLoaded || alunixaXBackendSettings.enhancementsEnabled === false;
      if (typeof syncCodexPlusTypingEffectDropdown === "function") syncCodexPlusTypingEffectDropdown(select);
    });
  }

  let alunixaXBackendSettings = { providerSyncEnabled: false, enhancementsEnabled: true, codexAppVersion: "" };
  let alunixaXBackendSettingsSeq = 0;
  const codexPluginLegacyEntryUnlockBeforeVersion = "26.601.2237";
  const codexPluginBridgeRequestUnlockFromVersion = "26.616.0";
  const codexPluginBroadCatalogKindsFromVersion = "26.803.0";

  function parseCodexVersionParts(version) {
    const raw = String(version || "").trim();
    if (!raw) return null;
    const match = raw.match(/\d+(?:\.\d+)*/);
    if (!match) return null;
    const parts = match[0].split(".").map((part) => Number(part));
    if (!parts.length || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
    return parts;
  }

  function compareCodexVersions(left, right) {
    const leftParts = parseCodexVersionParts(left);
    const rightParts = parseCodexVersionParts(right);
    if (!leftParts || !rightParts) return null;
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = leftParts[index] || 0;
      const rightPart = rightParts[index] || 0;
      if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
    }
    return 0;
  }

  function codexPluginUnlockStrategy() {
    const version = String(alunixaXBackendSettings.codexAppVersion || "").trim();
    const comparison = compareCodexVersions(version, codexPluginLegacyEntryUnlockBeforeVersion);
    if (comparison == null) return "unknown";
    return comparison < 0 ? "legacy" : "modern";
  }

  function logCodexPluginUnlockStrategy(strategy) {
    const codexAppVersion = String(alunixaXBackendSettings.codexAppVersion || "").trim();
    const signature = `${strategy}:${codexAppVersion || "unknown"}`;
    if (window.__codexPluginUnlockStrategyLogged === signature) return;
    window.__codexPluginUnlockStrategyLogged = signature;
    sendCodexPlusDiagnostic("plugin_unlock_strategy_selected", {
      strategy,
      codexAppVersion,
      cutoff: codexPluginLegacyEntryUnlockBeforeVersion,
    });
  }

  function codexPluginMarketplaceRequestPatchStrategy() {
    const pluginStrategy = codexPluginUnlockStrategy();
    if (pluginStrategy === "legacy") return "none";
    const version = String(alunixaXBackendSettings.codexAppVersion || "").trim();
    const comparison = compareCodexVersions(version, codexPluginBridgeRequestUnlockFromVersion);
    if (comparison == null) return "unknown";
    return comparison >= 0 ? "bridge" : "client";
  }

  function codexPluginUsesBroadCatalogKinds() {
    const version = String(alunixaXBackendSettings.codexAppVersion || "").trim();
    const comparison = compareCodexVersions(version, codexPluginBroadCatalogKindsFromVersion);
    return comparison != null && comparison >= 0;
  }

  let alunixaXBackendSettingsLoaded = false;
  const codexServiceTierModulePromises = new Map();
  // namePart -> { at, attempts, error }，见 loadCodexAppModule 里的说明。
  // 挂在 window 上跨重注入保留：否则每次重注入都会清空失败记录，重新全量 fetch asset
  // （issue #2330 / #2169：桥接看门狗重注入后 asset rescan 被重新跑满）。
  const codexAppModuleFailures = window.__alunixaXAppModuleFailures || (window.__alunixaXAppModuleFailures = new Map());
  // namePart -> { at, url }：codexAppAssetUrlFromScriptText 的查找结果，未命中也缓存，
  // 同样跨重注入保留（有调用方会绕过 asset loader 直接调它）。
  const codexAppAssetUrlLookups = window.__alunixaXAssetUrlLookups || (window.__alunixaXAssetUrlLookups = new Map());
  const codexAppModuleRetryCooldownMs = 30000;
  const codexAppModuleMaxAttempts = 8;
  const codexServiceTierSupportedFastModels = new Set(["gpt-5.4", "gpt-5.5"]);
  // 这里只放确认支持 priority service tier 的官方模型——这个集合同时用于生成
  // 「Fast 仅支持 …」的提示文案，塞进没验证过的模型等于对用户做出错误承诺。
  // 第三方模型（deepseek 等）走下面 codexServiceTierFastSupportedForModel 里的
  // 模型元数据判定：上游自己声明了 priority 才认。
  ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"].forEach((model) => codexServiceTierSupportedFastModels.add(model));

  function uniqueCodexAppAssetUrls(urls) {
    return Array.from(new Set((urls || []).filter((url) => typeof url === "string" && url.includes("/assets/") && url.split("?")[0].endsWith(".js"))));
  }

  function codexAppAssetCandidateUrls() {
    return uniqueCodexAppAssetUrls([
      // Fast 的 import map 让实际加载记录指向 Blob；定位原生类仍需要原资产 URL。
      window.__alunixaXNativeFastCompiled === "v1" ? window.__alunixaXNativeFastModuleDiagnostics?.url : null,
      ...Array.from(document.scripts || []).map((script) => script.src),
      ...Array.from(document.querySelectorAll("link[href]") || []).map((link) => link.href),
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ]);
  }

  function codexAppAssetUrl(namePart) {
    if (!namePart) return "";
    return codexAppAssetCandidateUrls().find((url) => url.includes(namePart)) || "";
  }

  async function codexAppAssetUrlFromScriptText(namePart) {
    if (!namePart) return "";
    // 有调用方会绕过 asset loader 直接调这里，
    // 没有缓存时每次注入都要把全部 app asset fetch 一遍（issue #2330）。
    // 未命中同样缓存：冷却期内不重复扫描。
    const cached = codexAppAssetUrlLookups.get(namePart);
    if (cached && (cached.url || Date.now() - cached.at < codexAppModuleRetryCooldownMs)) {
      return cached.url;
    }
    const url = await scanCodexAppAssetUrlFromScriptText(namePart);
    codexAppAssetUrlLookups.set(namePart, { at: Date.now(), url });
    return url;
  }

  async function scanCodexAppAssetUrlFromScriptText(namePart) {
    const scripts = codexAppAssetCandidateUrls();
    const escaped = String(namePart).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`["'](\\./(?:assets/)?${escaped}[^"']+\\.js)["']`),
      new RegExp(`["'](\\.?/assets/${escaped}[^"']+\\.js)["']`),
      new RegExp(`["']([^"']*/assets/${escaped}[^"']+\\.js)["']`),
    ];
    for (const src of scripts) {
      try {
        const text = await fetch(src).then((response) => response.ok ? response.text() : "");
        if (!text) continue;
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (!match) continue;
          return new URL(match[1], src).href;
        }
      } catch {
      }
    }
    return "";
  }

  // issue #1960：失败必须被记住。之前失败只是把 promise 从 map 里删掉，
  // 于是任何调用方下一次重试都会重新走 codexAppAssetUrlFromScriptText()，
  // 把全部 app asset（实测 121 个）重新 fetch 一遍再跑三条正则。
  // 这个 loader 有四个调用方，其中 installCodexServiceTierDispatcherPatch()
  // 挂在 scanLightweight() 里、每轮 scan 都试三个前缀，Codex 侧改名后就成了永不停止的重扫：
  // 实测空闲时 301 次请求/秒，主线程 TaskOtherDuration 占满一半 CPU，JS 堆每秒涨约 1MB，
  // Sentry 又给每个请求记一条 breadcrumb 并回同步一次 scope，把量再翻一倍推给 browser 进程。
  // 记住失败 + 冷却重试，让下游即便还在轮询也只会周期性地试一次。
  // 「这个 asset 找不到」是可预期的、会随 Codex 版本变化的情形，
  // 不是异常。用结构化标记而不是靠 message 字符串比对来区分：字符串比对让
  // loadOptionalCodexAppModule 的「可选」语义只对精确复刻了那段 message 的调用方生效，
  // 任何一个自己抛错或包了一层的调用方都会漏判，把可选依赖的缺失当成硬失败中断整条流程
  // （issue #1316 的「未找到 Codex App asset: vscode-api-」就是这么冒到用户面前的）。
  function codexAppAssetMissingError(namePart) {
    const error = new Error(`未找到 Codex App asset: ${namePart}`);
    error.code = "ALUNIXA_X_ASSET_MISSING";
    error.assetNamePart = namePart;
    return error;
  }

  function isCodexAppAssetMissingError(error) {
    return !!error && (error.code === "ALUNIXA_X_ASSET_MISSING" || error.name === "CodexPlusAssetMissingError");
  }

  async function loadCodexAppModule(namePart) {
    if (!codexServiceTierModulePromises.has(namePart)) {
      const failure = codexAppModuleFailures.get(namePart);
      if (failure
          && (failure.attempts >= codexAppModuleMaxAttempts
            || Date.now() - failure.at < codexAppModuleRetryCooldownMs)) {
        throw failure.error;
      }
      const promise = Promise.resolve().then(async () => {
        const url = codexAppAssetUrl(namePart) || await codexAppAssetUrlFromScriptText(namePart);
        if (!url) throw codexAppAssetMissingError(namePart);
        return await import(url);
      }).then((module) => {
        // Codex 更新后 asset 可能又出现，成功时把失败记录清掉，冷却计数重新开始。
        codexAppModuleFailures.delete(namePart);
        return module;
      }).catch((error) => {
        codexServiceTierModulePromises.delete(namePart);
        codexAppModuleFailures.set(namePart, {
          at: Date.now(),
          attempts: (codexAppModuleFailures.get(namePart)?.attempts || 0) + 1,
          error,
        });
        throw error;
      });
      codexServiceTierModulePromises.set(namePart, promise);
    }
    return await codexServiceTierModulePromises.get(namePart);
  }

  async function loadOptionalCodexAppModule(namePart) {
    try {
      return await loadCodexAppModule(namePart);
    } catch (error) {
      // 结构化标记优先；保留字符串兜底以便老缓存里的 Error 也能被认出来。
      if (isCodexAppAssetMissingError(error)) return null;
      if (String(error?.message || error).includes(`未找到 Codex App asset: ${namePart}`)) return null;
      throw error;
    }
  }

  function appServerFallbackAssetUrls() {
    const urls = codexAppAssetCandidateUrls();
    const preferred = urls.filter((url) => {
      const name = (url.split("/").pop() || "").toLowerCase();
      return /use-host-config|app-server-manager-signals|app-initial|app-main|page-|chatg|signals|server-manager/.test(name);
    });
    // Prefer known request-client modules, then the larger application bundles.
    preferred.sort((left, right) => {
      const score = (url) => {
        const name = (url.split("/").pop() || "").toLowerCase();
        if (name.includes("use-host-config")) return 0;
        if (name.includes("app-server-manager-signals")) return 1;
        if (name.includes("app-initial") && name.includes("app-main")) return 3;
        if (name.includes("app-main")) return 4;
        return 5;
      };
      return score(left) - score(right) || right.length - left.length;
    });
    return preferred.slice(0, 16);
  }

  function collectAppServerRequestCandidatesFromModule(module) {
    const candidates = [];
    const seen = new Set();
    const push = (value) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      candidates.push(value);
    };
    for (const value of Object.values(module || {})) {
      push(value);
      if (!value || typeof value !== "object") continue;
      if (typeof value.get === "function") {
        try { push(value.get()); } catch {}
        try { push(value.get("local")); } catch {}
      }
      try {
        for (const nested of Object.values(value).slice(0, 100)) push(nested);
      } catch {}
    }
    return candidates;
  }

  async function loadAppServerRequestModules() {
    const modules = [];
    const sources = [];
    const seenModules = new Set();
    const seenUrls = new Set();
    const pushModule = (module, source) => {
      if (!module || typeof module !== "object" || seenModules.has(module)) return;
      seenModules.add(module);
      modules.push(module);
      sources.push(source);
    };
    for (const assetPrefix of ["use-host-config-", "app-server-manager-signals-"]) {
      try {
        const module = await loadOptionalCodexAppModule(assetPrefix);
        if (module) pushModule(module, assetPrefix);
      } catch {
      }
    }
    for (const url of appServerFallbackAssetUrls()) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      try {
        pushModule(await import(url), url);
      } catch {
      }
    }
    return { modules, sources };
  }

  async function loadAppServerRequestCandidates() {
    const { modules, sources } = await loadAppServerRequestModules();
    const candidates = [];
    const seen = new Set();
    for (const module of modules) {
      for (const candidate of collectAppServerRequestCandidatesFromModule(module)) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        candidates.push(candidate);
      }
    }
    const usedFallback = sources.some((source) => !source.endsWith("-"));
    return { modules, candidates, sources, discovery: usedFallback ? "fallback" : "named-assets" };
  }

  function codexModuleFunctionSource(candidate) {
    if (typeof candidate !== "function") return "";
    try {
      return Function.prototype.toString.call(candidate);
    } catch {
      return "";
    }
  }

  const codexQueuedFollowUpLifecycle = window.__alunixaXQueuedFollowUpLifecycle
    || (window.__alunixaXQueuedFollowUpLifecycle = { enabled: true, epoch: 0 });

  function patchCodexQueuedFollowUpQueue(queue) {
    if (!queue || typeof queue !== "object") return false;
    const methods = ["read", "enqueue", "remove", "restore", "dispose"];
    const marker = "__alunixaXQueuedFollowUpEditPatch";
    let original;
    let originalDescriptors;
    try {
      if (queue[marker] === "1") return true;
      if (!Object.isExtensible(queue) || !methods.every((name) => typeof queue[name] === "function")) return false;
      originalDescriptors = Object.fromEntries([...methods, marker]
        .map((name) => [name, Object.getOwnPropertyDescriptor(queue, name)]));
      if (![...methods, marker].every((name) => {
        const descriptor = originalDescriptors[name];
        return !descriptor || ("value" in descriptor && descriptor.writable === true);
      })) return false;
      const source = codexModuleFunctionSource(queue.enqueue);
      // Only repair the native update-after-delete contract, never an arbitrary queue.
      if (!source.includes("App-server queued follow-up no longer exists")
          || !source.includes("thread/queue/update") || !source.includes("thread/queue/add")) return false;
      original = Object.fromEntries(methods.map((name) => [name, queue[name]]));
    } catch {
      return false;
    }
    const removed = new Map();
    const lifecycle = typeof codexQueuedFollowUpLifecycle === "object"
      ? codexQueuedFollowUpLifecycle : { enabled: true, epoch: 0 };
    const keyFor = (threadId, messageId) => JSON.stringify([threadId, messageId]);
    const enabled = () => {
      const active = (typeof alunixaXBackendSettingsLoaded === "undefined" || alunixaXBackendSettingsLoaded)
        && alunixaXBackendSettings.enhancementsEnabled !== false;
      if (!active && lifecycle.enabled) lifecycle.epoch += 1;
      lifecycle.enabled = active;
      return active;
    };
    let disposed = false;
    const replacements = {
      remove: async function (threadId, messageId, ...rest) {
        const result = await original.remove.call(this, threadId, messageId, ...rest);
        if (!disposed && enabled() && typeof threadId === "string" && threadId.length > 0
            && typeof messageId === "string" && messageId.length > 0
            && result?.serverSubmission?.id === messageId) {
          if (removed.size >= 256) removed.delete(removed.keys().next().value);
          removed.set(keyFor(threadId, messageId), { at: Date.now(), epoch: lifecycle.epoch });
        }
        return result;
      },
      enqueue: async function (threadId, message, position, ...rest) {
        const key = keyFor(threadId, position?.messageId);
        const evidence = removed.get(key);
        const active = enabled();
        // Consume before any await, even when expired or disabled. An ambiguous
        // native write must never leave a marker that can replay the submission.
        removed.delete(key);
        if (disposed || !active || !evidence || evidence.epoch !== lifecycle.epoch
            || Date.now() - evidence.at >= 30 * 60 * 1000) {
          return original.enqueue.call(this, threadId, message, position, ...rest);
        }
        const rows = original.read.call(this, threadId);
        if (!Array.isArray(rows) || rows.some((item) => item.id === position.messageId)) {
          return original.enqueue.call(this, threadId, message, position, ...rest);
        }
        const { messageId: _removedId, ...insertionPosition } = position;
        // Keep the exact message and prepared payload, including attachments,
        // reasoning/model and native ordering hints. Do not retry failed writes.
        const result = await original.enqueue.call(this, threadId, message, insertionPosition, ...rest);
        sendAlunixaXDiagnostic("queued_follow_up_edit_requeued", {});
        return result;
      },
      restore: function (threadId, snapshot, ...rest) {
        removed.delete(keyFor(threadId, snapshot?.message?.id));
        removed.delete(keyFor(threadId, snapshot?.serverSubmission?.id));
        return original.restore.call(this, threadId, snapshot, ...rest);
      },
      dispose: function (...args) {
        disposed = true;
        removed.clear();
        return original.dispose.apply(this, args);
      },
    };
    try {
      const descriptors = Object.fromEntries(Object.entries(replacements).map(([name, value]) => [
        name, { ...(originalDescriptors[name]
          || { writable: true, configurable: true, enumerable: true }), value },
      ]));
      descriptors[marker] = {
        ...(originalDescriptors[marker] || { writable: true, configurable: true }), value: "1",
      };
      Object.defineProperties(queue, descriptors);
      return true;
    } catch {
      // Fail closed for RPC stubs; restore all native descriptors if a proxy
      // rejected one definition after another had already been applied.
      for (const name of [...Object.keys(replacements), marker]) {
        try {
          if (originalDescriptors[name]) Object.defineProperty(queue, name, originalDescriptors[name]);
          else delete queue[name];
        } catch {}
      }
      return false;
    }
  }

  function patchCodexQueuedFollowUpCoordinator(candidate) {
    const coordinator = candidate?.turnCoordinator || candidate;
    if (!coordinator || typeof coordinator.setServerQueue !== "function"
        || typeof coordinator.sendMessage !== "function"
        || typeof coordinator.removeQueuedMessage !== "function") return false;
    const marker = "__alunixaXQueuedFollowUpEditPatch";
    try {
      if (coordinator[marker] === "1") {
        patchCodexQueuedFollowUpQueue(coordinator.serverQueue);
        return true;
      }
      const descriptor = Object.getOwnPropertyDescriptor(coordinator, "setServerQueue");
      const markerDescriptor = Object.getOwnPropertyDescriptor(coordinator, marker);
      if (!Object.isExtensible(coordinator)
          || (descriptor && (!("value" in descriptor) || !descriptor.writable))
          || (markerDescriptor && (!("value" in markerDescriptor) || !markerDescriptor.writable))) return false;
      const original = coordinator.setServerQueue;
      Object.defineProperties(coordinator, {
        setServerQueue: {
          ...(descriptor || { writable: true, configurable: true, enumerable: true }),
          value: function (queue, ...rest) {
            const result = original.call(this, queue, ...rest);
            if (!this.disposed) patchCodexQueuedFollowUpQueue(this.serverQueue);
            return result;
          },
        },
        [marker]: { ...(markerDescriptor || { writable: true, configurable: true }), value: "1" },
      });
      patchCodexQueuedFollowUpQueue(coordinator.serverQueue);
      return true;
    } catch {
      return false;
    }
  }

  let codexQueuedFollowUpDiscovery = { key: "", attempts: 0, at: 0, pending: null };

  function installCodexQueuedFollowUpEditPatch() {
    if (!alunixaXBackendSettingsLoaded || alunixaXBackendSettings.enhancementsEnabled === false) {
      if (typeof codexQueuedFollowUpLifecycle === "object" && codexQueuedFollowUpLifecycle.enabled) {
        codexQueuedFollowUpLifecycle.enabled = false;
        codexQueuedFollowUpLifecycle.epoch += 1;
      }
      return;
    }
    if (codexQueuedFollowUpDiscovery.pending) return;
    const key = `${window.location.href}\n${codexAppAssetCandidateUrls().join("\n")}`;
    if (key !== codexQueuedFollowUpDiscovery.key) {
      codexQueuedFollowUpDiscovery = { key, attempts: 0, at: 0, pending: null };
    }
    const state = codexQueuedFollowUpDiscovery;
    if (state.attempts >= 8 || (state.attempts > 0 && Date.now() - state.at < 30000)) return;
    state.attempts += 1;
    state.at = Date.now();
    state.pending = loadAppServerRequestCandidates().then(({ candidates }) => {
      if (!alunixaXBackendSettingsLoaded || alunixaXBackendSettings.enhancementsEnabled === false) return;
      const count = candidates.filter(patchCodexQueuedFollowUpCoordinator).length;
      if (count > 0 && state.attempts === 1) {
        sendAlunixaXDiagnostic("queued_follow_up_edit_patch_ready", { coordinatorCount: count });
      }
    }).catch(() => {
      // Optional discovery failure must not submit or retry a user message.
    }).finally(() => { state.pending = null; });
  }

  const codexRetiredSharedTerminalRuntimes = window.__alunixaXRetiredSharedTerminalRuntimes
    || (window.__alunixaXRetiredSharedTerminalRuntimes = new WeakSet());

  function retireCodexSharedTerminalRuntime() {
    const runtime = window.__alunixaXSharedTerminalRuntime;
    if (!runtime || typeof runtime !== "object" || codexRetiredSharedTerminalRuntimes.has(runtime)) return false;
    codexRetiredSharedTerminalRuntimes.add(runtime);
    try {
      if (typeof runtime.dispose === "function") {
        runtime.dispose();
        return true;
      }
    } catch {}
    try { runtime.setEnabled?.(false); } catch {}
    // No terminal discovery, command execution or closing native sessions.
    // Retain local records and settings so retirement never discards user data.
    return true;
  }

  function codexSettingStorageFromModule(module, assetPrefix = "") {
    const values = module && typeof module === "object" ? Object.values(module) : [];
    const functionSource = (candidate) => {
      if (typeof candidate !== "function") return "";
      try {
        return String(candidate);
      } catch (_) {
        return "";
      }
    };
    const getSettingByCapability = () => values.find((candidate) => {
      const source = functionSource(candidate);
      return source.includes("get-setting") && source.includes("params") && source.includes("key");
    });
    const setSettingByCapability = () => values.find((candidate) => {
      const source = functionSource(candidate);
      return source.includes("set-setting") && source.includes("params") && source.includes("key");
    });
    let getSetting = null;
    let setSetting = null;
    if (assetPrefix.startsWith("setting-storage-")) {
      getSetting = typeof module?.n === "function" ? module.n : getSettingByCapability();
      setSetting = typeof module?.s === "function" ? module.s : setSettingByCapability();
    } else if (assetPrefix.startsWith("app-initial-")) {
      getSetting = typeof module?.jut === "function" ? module.jut : getSettingByCapability();
      setSetting = typeof module?.Put === "function" ? module.Put : setSettingByCapability();
    } else {
      getSetting = getSettingByCapability();
      setSetting = setSettingByCapability();
    }
    return typeof getSetting === "function" && typeof setSetting === "function"
      ? { n: getSetting, s: setSetting, assetPrefix }
      : null;
  }

  async function codexSettingStorageModule() {
    const errors = [];
    for (const assetPrefix of ["setting-storage-", "app-initial-"]) {
      try {
        const module = await loadCodexAppModule(assetPrefix);
        const settingStorage = codexSettingStorageFromModule(module, assetPrefix);
        if (settingStorage) return settingStorage;
        errors.push(`${assetPrefix}: setting exports unavailable`);
      } catch (error) {
        errors.push(`${assetPrefix}: ${error?.message || String(error)}`);
      }
    }
    throw new Error(`Codex setting-storage 接口不可用 (${errors.join("; ")})`);
  }

  function normalizeCodexServiceTierModelName(model) {
    return String(model || "").trim().toLowerCase();
  }

  function codexServiceTierModelFromValue(value, visited = new WeakSet(), depth = 0) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object" || visited.has(value) || depth > 3) return "";
    visited.add(value);
    for (const key of ["model", "modelId", "model_id", "selectedModel", "selected_model", "defaultModel", "default_model"]) {
      const model = codexServiceTierModelFromValue(value[key], visited, depth + 1);
      if (model) return model;
    }
    for (const key of ["params", "request", "payload", "body", "config", "options"]) {
      const model = codexServiceTierModelFromValue(value[key], visited, depth + 1);
      if (model) return model;
    }
    return "";
  }

  function codexServiceTierCurrentModelName() {
    return codexServiceTierModelFromValue(codexModelCatalog.model) || codexServiceTierModelFromValue(codexModelCatalog.default_model);
  }

  // threadId -> 模型名。挂在 window 上跨重注入保留（重注入不该丢掉已知的线程模型）。
  // 只在请求路径观测到模型时写入，用于让界面判定跟上线程当前模型（issue #1463）。
  const codexServiceTierThreadModels = window.__alunixaXServiceTierThreadModels
    || (window.__alunixaXServiceTierThreadModels = new Map());

  // 线程中途换模型后，全局 catalog 的 model 字段往往还没更新，直接拿它判 Fast 可用性
  // 会落后一拍。因此界面优先读「当前线程最近一次实际请求用的模型」，读不到才回落全局。
  function codexServiceTierUiModelName(threadId = "") {
    const key = typeof validThreadScrollSessionKey === "function"
      ? validThreadScrollSessionKey(threadId)
      : String(threadId || "");
    if (key) {
      const cached = codexServiceTierThreadModels.get(key);
      if (cached) return cached;
    }
    return codexServiceTierCurrentModelName();
  }

  function codexServiceTierRememberThreadModel(threadId, modelName) {
    const key = typeof validThreadScrollSessionKey === "function"
      ? validThreadScrollSessionKey(threadId)
      : String(threadId || "");
    const model = codexServiceTierModelFromValue(modelName);
    if (!key || !model) return;
    codexServiceTierThreadModels.set(key, model);
    // 简易上界，避免长会话里 Map 无限增长；Map 的插入序即写入序，删最旧的即可。
    while (codexServiceTierThreadModels.size > 64) {
      const oldest = codexServiceTierThreadModels.keys().next().value;
      if (oldest === undefined) break;
      codexServiceTierThreadModels.delete(oldest);
    }
  }

  function codexServiceTierModelForRequest(params, modelHint = "") {
    return codexServiceTierModelFromValue(params) || codexServiceTierModelFromValue(modelHint) || codexServiceTierCurrentModelName();
  }

  function codexServiceTierFastSupportedForModel(modelName) {
    const normalized = normalizeCodexServiceTierModelName(modelName);
    if (!normalized) return false;
    // 不按名字猜：模型叫 deepseek 不代表它的中转站支持 priority tier。
    // 只认上游模型元数据里明确声明的 priority。
    try {
      const metadata = typeof alunixaXModelMetadata === "function" ? alunixaXModelMetadata(modelName) : null;
      if (typeof metadata?.prioritySupportOverride === "boolean") return metadata.prioritySupportOverride;
      const tierIs = (tier, expected) => String(typeof tier === "string" ? tier : tier?.id || "").trim().toLowerCase() === expected;
      if (Array.isArray(metadata?.serviceTiers) && metadata.serviceTiers.some((tier) => tierIs(tier, "priority"))) return true;
      if (Array.isArray(metadata?.additionalSpeedTiers) && metadata.additionalSpeedTiers.some((tier) => tierIs(tier, "fast"))) return true;
    } catch {}
    // 未声明仍沿用已验证的内置模型；第三方模型不能因名字含 fast 就自动放行。
    return codexServiceTierSupportedFastModels.has(normalized);
  }

  // UI 侧「Fast 是否可用」的唯一判据。这里必须复用 codexServiceTierFastSupportedForModel，
  // 不能再自己对照 codexServiceTierSupportedFastModels：那套只认内置名单，中转场景下
  // 模型名带前缀（或仅靠上游元数据声明 priority）时，界面会判「不支持/未读取」，而真正
  // 发请求的路径却按同一模型放了 service_tier=priority——两条判据不一致就会自相矛盾
  // （issue #772）。
  //
  // 默认模型名优先取最近一次在线程里观测到的模型（见 codexServiceTierRememberThreadModel），
  // 只有完全没观测过时才回落到全局 catalog——否则线程中途换模型后 UI 会落后一拍
  // （issue #1463）。
  function codexServiceTierFastAvailability(modelName = codexServiceTierUiModelName()) {
    const normalizedModel = normalizeCodexServiceTierModelName(modelName);
    return {
      modelName: modelName || "",
      supported: !!normalizedModel && codexServiceTierFastSupportedForModel(modelName),
    };
  }
