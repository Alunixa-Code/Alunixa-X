  // AX feature adapters retained alongside the modern upstream renderer.
  function installAlunixaXFastStartup() {
    const config = window.__ALUNIXA_X_FAST_STARTUP__;
    const previous = window.__alunixaXFastStartupRuntime;
    if (!config || config.enabled !== true) {
      previous?.dispose?.();
      return;
    }
    if (previous?.version === "2") return;
    previous?.dispose?.();
    if (typeof window.fetch !== "function") return;
    const timeoutMs = Math.max(100, Math.min(Number(config.statsigTimeoutMs) || 800, 3000));
    const statsigHosts = new Set([
      "ab.chatgpt.com", "featureassets.org", "prodregistryv2.org",
      "api.statsigcdn.com", "statsigapi.net", "cloudflare-dns.com",
    ]);
    const originalFetch = window.fetch;
    const patchedFetch = (input, init = undefined) => {
      let url;
      try { url = new URL(typeof input === "string" ? input : input?.url ?? "", window.location.href); }
      catch { return originalFetch.call(window, input, init); }
      if (!statsigHosts.has(url.hostname)) return originalFetch.call(window, input, init);
      const callerSignal = init?.signal ?? input?.signal;
      const controller = new AbortController();
      const abort = () => controller.abort(callerSignal?.reason);
      if (callerSignal?.aborted) abort();
      else callerSignal?.addEventListener("abort", abort, { once: true });
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abort);
      };
      try {
        return Promise.resolve(originalFetch.call(window, input, { ...(init || {}), signal: controller.signal })).finally(cleanup);
      } catch (error) { cleanup(); throw error; }
    };
    // Bound optional telemetry requests; never invent Statsig Ready/events or resolve
    // failed initialization as success. The native application owns its state machine.
    window.fetch = patchedFetch;
    window.__alunixaXFastStartupInstalled = "2";
    window.__alunixaXFastStartupRuntime = { version: "2", dispose() {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
      delete window.__alunixaXFastStartupInstalled;
      delete window.__alunixaXFastStartupRuntime;
    } };
  }

  function installAlunixaXForceChineseLocale() {
    const config = window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__;
    if (!config) return;
    const enabled = config.enabled === true;
    const locale = typeof config.locale === "string" && config.locale ? config.locale : "zh-CN";
    const installationKey = `3:${enabled ? "on" : "off"}:${locale}`;
    const previousRuntime = window.__alunixaXForceChineseLocaleRuntime;
    if (previousRuntime?.key === installationKey && !previousRuntime.disposed && previousRuntime.status !== "failed") return;
    previousRuntime?.dispose?.();
    window.__alunixaXForceChineseLocaleInstalled = installationKey;
    const cleanups = [];
    const timers = new Set();
    const runtime = {
      key: installationKey, enabled, disposed: false, status: "pending",
      attempts: 0, patchedClients: 0, latePatch: false, settingSynced: false,
      dispose() {
        runtime.disposed = true;
        for (const timer of timers) window.clearTimeout(timer);
        timers.clear();
        for (const cleanup of cleanups.splice(0).reverse()) {
          try { cleanup(); } catch {}
        }
      },
    };
    window.__alunixaXForceChineseLocaleRuntime = runtime;
    const later = (callback, delay) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (!runtime.disposed) callback();
      }, delay);
      timers.add(timer);
      return timer;
    };
    const managedLocaleStorageKey = "alunixaX.forceChineseLocale.managed.v1";
    const localeReloadStorageKey = "alunixaX.forceChineseLocale.reload.v2";

    const readManagedLocale = () => {
      try {
        const value = JSON.parse(window.localStorage.getItem(managedLocaleStorageKey) || "null");
        return value && typeof value === "object" && !Array.isArray(value)
          && typeof value.appliedLocale === "string" ? value : null;
      } catch {
        return null;
      }
    };

    const writeManagedLocale = (value) => {
      try {
        if (value) {
          window.localStorage.setItem(managedLocaleStorageKey, JSON.stringify(value));
        } else {
          window.localStorage.removeItem(managedLocaleStorageKey);
        }
        return true;
      } catch {
        return false;
      }
    };

    const callCodexSettingApi = (bridge, method, params) => new Promise((resolve, reject) => {
      const requestId = typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `alunixa-x-locale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let timeout;
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeout);
        timers.delete(timeout);
        window.removeEventListener("message", onMessage);
        const index = cleanups.indexOf(cancel);
        if (index >= 0) cleanups.splice(index, 1);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const cancel = () => fail(new Error("Codex locale sync cancelled"));
      const onMessage = (event) => {
        const message = event?.data;
        if (!message || message.type !== "fetch-response" || message.requestId !== requestId) return;
        if (message.responseType !== "success") {
          fail(new Error(`Codex ${method} failed`));
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        try {
          resolve(JSON.parse(message.bodyJsonString || "null"));
        } catch (error) {
          reject(error);
        }
      };
      window.addEventListener("message", onMessage);
      cleanups.push(cancel);
      timeout = later(() => fail(new Error(`Codex ${method} timed out`)), 5000);
      const message = {
        type: "fetch",
        requestId,
        method: "POST",
        url: `vscode://codex/${method}`,
        body: JSON.stringify({ params }),
      };
      try {
        Promise.resolve(bridge.sendMessageFromView(message)).catch(fail);
      } catch (error) {
        fail(error);
      }
    });

    const reloadAfterLocaleChange = (value) => {
      if (runtime.disposed) return;
      const marker = JSON.stringify({ key: installationKey, value });
      try {
        if (window.sessionStorage.getItem(localeReloadStorageKey) === marker) return;
        window.sessionStorage.setItem(localeReloadStorageKey, marker);
        if (window.sessionStorage.getItem(localeReloadStorageKey) !== marker) return;
      } catch {
        // Without a durable per-window marker, reloading can loop forever.
        runtime.status = "reload-deferred";
        return;
      }
      window.location.reload();
    };

    const refreshLateLocaleProvider = () => {
      // Current React-compiled providers memoize the Layer object. A method
      // patch made after mount cannot invalidate that object by itself.
      if (enabled && runtime.latePatch && runtime.settingSynced) reloadAfterLocaleChange(locale);
    };

    const syncOfficialLocaleSetting = async () => {
      const managed = readManagedLocale();
      if (!enabled && !managed && !previousRuntime?.enabled) {
        runtime.status = "disabled";
        return;
      }
      const bridge = window.electronBridge;
      if (typeof bridge?.sendMessageFromView !== "function") throw new Error("Codex locale bridge not ready");
      const response = await callCodexSettingApi(bridge, "get-setting", { key: "localeOverride" });
      if (runtime.disposed) return;
      if (!response || typeof response !== "object" || !Object.hasOwn(response, "value")) {
        throw new Error("Invalid Codex locale setting response");
      }
      const currentValue = response?.value ?? null;
      if (currentValue !== null && typeof currentValue !== "string") {
        throw new Error("Invalid Codex locale setting value");
      }

      if (enabled) {
        if (currentValue === locale) {
          runtime.settingSynced = true;
          runtime.status = "ok";
          refreshLateLocaleProvider();
          return;
        }
        if (!writeManagedLocale({ appliedLocale: locale, previousValue: managed ? managed.previousValue ?? null : currentValue })) {
          throw new Error("Cannot back up the original Codex locale setting");
        }
        await callCodexSettingApi(bridge, "set-setting", { key: "localeOverride", value: locale });
        if (runtime.disposed) return;
        runtime.settingSynced = true;
        runtime.status = "ok";
        reloadAfterLocaleChange(locale);
        return;
      }

      if (!managed || currentValue !== managed.appliedLocale) {
        writeManagedLocale(null);
        runtime.status = "disabled";
        if (previousRuntime?.enabled) reloadAfterLocaleChange(currentValue);
        return;
      }
      const previousValue = managed.previousValue ?? null;
      if (previousValue !== null && typeof previousValue !== "string") {
        throw new Error("Invalid saved Codex locale value");
      }
      await callCodexSettingApi(bridge, "set-setting", {
        key: "localeOverride",
        value: previousValue,
      });
      if (runtime.disposed) return;
      writeManagedLocale(null);
      runtime.status = "disabled";
      reloadAfterLocaleChange(previousValue);
    };

    const syncWithRetry = () => {
      runtime.attempts++;
      runtime.syncPromise = syncOfficialLocaleSetting().catch(() => {
        if (runtime.disposed) return;
        if (runtime.attempts < 8) {
          later(syncWithRetry, Math.min(250 * 2 ** (runtime.attempts - 1), 4000));
        } else {
          runtime.status = "failed";
        }
      });
    };

    const defineNavigatorGetter = (name, value) => {
      try {
        const original = Object.getOwnPropertyDescriptor(navigator, name);
        const getter = () => value;
        Object.defineProperty(navigator, name, {
          configurable: true,
          get: getter,
        });
        cleanups.push(() => {
          if (Object.getOwnPropertyDescriptor(navigator, name)?.get !== getter) return;
          if (original) Object.defineProperty(navigator, name, original);
          else delete navigator[name];
        });
      } catch {}
    };

    const patchedConfigs = new WeakMap();
    const patchI18nConfig = (dynamicConfig) => {
      if (!dynamicConfig || typeof dynamicConfig !== "object") return dynamicConfig;
      if (patchedConfigs.has(dynamicConfig)) return patchedConfigs.get(dynamicConfig);
      const result = {
        ...dynamicConfig,
        get value() {
          if (runtime.disposed) return dynamicConfig.value;
          return { ...dynamicConfig.value, enable_i18n: true, locale_source: "SYSTEM" };
        },
        get(key, ...args) {
          if (!runtime.disposed) {
            if (key === "enable_i18n") return true;
            if (key === "locale_source") return "SYSTEM";
          }
          return typeof dynamicConfig.get === "function"
            ? dynamicConfig.get.call(dynamicConfig, key, ...args) : args[0];
        },
      };
      patchedConfigs.set(dynamicConfig, result);
      return result;
    };

    const statsigClients = () => {
      const root = window.__STATSIG__ || globalThis.__STATSIG__;
      if (!root || typeof root !== "object") return [];
      const clients = [];
      try { clients.push(root.firstInstance); } catch {}
      try { if (typeof root.instance === "function") clients.push(root.instance()); } catch {}
      try { if (root.instances && typeof root.instances === "object") clients.push(...Object.values(root.instances)); } catch {}
      return clients.filter((client, index, array) => client && typeof client === "object" && array.indexOf(client) === index);
    };

    const patchStatsigClient = (client) => {
      if (!client || typeof client !== "object") return;
      let changed = false;
      for (const method of ["getLayer", "getDynamicConfig"]) {
        let original;
        try { original = client[method]; } catch { continue; }
        if (typeof original !== "function" || original.__alunixaXLocaleRuntime === runtime) continue;
        const patched = function (name, ...args) {
          const result = original.call(this, name, ...args);
          return !runtime.disposed && name === "72216192" ? patchI18nConfig(result) : result;
        };
        patched.__alunixaXLocaleRuntime = runtime;
        try {
          client[method] = patched;
          if (client[method] !== patched) continue;
          changed = true;
          cleanups.push(() => { if (client[method] === patched) client[method] = original; });
        } catch {}
      }
      if (changed) {
        runtime.patchedClients++;
        runtime.latePatch ||= document.readyState !== "loading";
        refreshLateLocaleProvider();
      }
    };

    const watchedProperties = new WeakMap();
    const watchProperty = (owner, key, onValue) => {
      if (!owner || typeof owner !== "object") return;
      let watched = watchedProperties.get(owner);
      if (!watched) watchedProperties.set(owner, watched = new Set());
      if (watched.has(key)) return;
      const original = Object.getOwnPropertyDescriptor(owner, key);
      if (original && (!original.configurable || original.get || original.set || !original.writable)) return;
      let current = owner[key];
      const getter = () => current;
      try {
        Object.defineProperty(owner, key, {
          configurable: true, enumerable: original?.enumerable ?? true,
          get: getter,
          set(value) {
            current = value;
            if (!runtime.disposed) {
              try { onValue(value); } catch {}
            }
          },
        });
        watched.add(key);
        cleanups.push(() => {
          if (Object.getOwnPropertyDescriptor(owner, key)?.get !== getter) return;
          if (original) Object.defineProperty(owner, key, { ...original, value: current });
          else {
            delete owner[key];
            if (current !== undefined) owner[key] = current;
          }
        });
      } catch {}
      try { onValue(current); } catch {}
    };

    const patchStatsigRoot = (root) => {
      if (!root || typeof root !== "object") return;
      for (const key of ["firstInstance", "instance", "instances"]) {
        watchProperty(root, key, () => {
          statsigClients().forEach(patchStatsigClient);
        });
      }
      statsigClients().forEach(patchStatsigClient);
    };

    if (enabled) {
      defineNavigatorGetter("language", locale);
      defineNavigatorGetter("languages", Object.freeze([locale, "zh", "en-US", "en"]));
      watchProperty(window, "__STATSIG__", patchStatsigRoot);
      const startedAt = Date.now();
      const discoverClients = () => {
        try {
          patchStatsigRoot(window.__STATSIG__ || globalThis.__STATSIG__);
        } catch {}
        if (Date.now() - startedAt < 20000) later(discoverClients, 250);
      };
      discoverClients();
    }
    syncWithRetry();
  }

  const projectMoveOverlayClass = "codex-project-move-overlay";

  const upstreamBranchSelectionKey = "codexUpstreamBranchSelection";

  const zedRemoteOpenInMenuVersion = "1";

  const zedRemoteOpenInMenuActivationWindowMs = 600;

  const projectMoveProjectionKey = "codexProjectMoveProjection";

  const legacyProjectMoveOverridesKey = "codexProjectMoveOverrides";

  const projectMoveProjectionTtlMs = 24 * 60 * 60 * 1000;

  const projectMoveProjectionSettleMs = 5 * 60 * 1000;

  const projectMoveRefreshDelaysMs = [50, 250, 750, 1500];

  const chatsSortRefreshIntervalMs = 1500;

  const chatsSortDbRefreshIntervalMs = 5000;

  const codexPluginAutoExpandVersion = "1";

  const codexPluginAutoExpandMaxClicks = 80;

  const codexPluginAutoExpandClickDelayMs = 90;

  const codexProjectMoveRuntimeId = window.__codexProjectMoveRuntimeId;

  const codexPerformanceImageFailures = new Map();

  function beginCodexPerformanceTransition() {
    if (!alunixaXSettings().performanceProtection) return;
    window.__alunixaXPerformanceTransitionUntil = Date.now() + 1400;
    document.documentElement.classList.add("alunixa-x-thread-switching");
    clearTimeout(window.__alunixaXPerformanceTransitionTimer);
    window.__alunixaXPerformanceTransitionTimer = setTimeout(() => {
      document.documentElement.classList.remove("alunixa-x-thread-switching");
      window.__alunixaXPerformanceTransitionUntil = 0;
    }, 1400);
  }

  function codexPerformanceImageKey(image) {
    const source = String(image?.currentSrc || image?.src || "");
    if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith(helperBase)) return "";
    return source.slice(0, 2048);
  }

  function recordCodexPerformanceImageFailure(event) {
    if (!alunixaXSettings().performanceProtection) return;
    const image = event?.target;
    if (!(image instanceof HTMLImageElement) || isExtensionUiNode(image)) return;
    const key = codexPerformanceImageKey(image);
    if (!key) return;
    const now = Date.now();
    const previous = codexPerformanceImageFailures.get(key);
    const count = previous && now - previous.at < 60000 ? previous.count + 1 : 1;
    codexPerformanceImageFailures.set(key, { count, at: now });
    if (codexPerformanceImageFailures.size > 256) {
      const oldest = codexPerformanceImageFailures.keys().next().value;
      if (oldest) codexPerformanceImageFailures.delete(oldest);
    }
    image.loading = "lazy";
    image.decoding = "async";
    if (count < 3) return;
    image.dataset.alunixaXImageQuarantined = "true";
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    image.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  }

  function clearCodexPerformanceImageFailure(event) {
    const image = event?.target;
    const key = codexPerformanceImageKey(image);
    if (key) codexPerformanceImageFailures.delete(key);
  }

  function refreshCodexPerformanceProtection() {
    const enabled = !!alunixaXSettings().performanceProtection;
    document.documentElement.classList.toggle("alunixa-x-performance-protection", enabled);
    if (!enabled) {
      document.documentElement.classList.remove("alunixa-x-thread-switching");
      window.__alunixaXPerformanceTransitionUntil = 0;
    }
  }

  function installCodexPerformanceProtection() {
    refreshCodexPerformanceProtection();
    if (window.__alunixaXPerformanceProtectionInstalled) return;
    window.__alunixaXPerformanceProtectionInstalled = true;
    document.addEventListener("error", recordCodexPerformanceImageFailure, true);
    document.addEventListener("load", clearCodexPerformanceImageFailure, true);
    document.addEventListener("click", (event) => {
      if (event.target?.closest?.(selectors.sidebarThread)) beginCodexPerformanceTransition();
    }, true);
    window.addEventListener("popstate", beginCodexPerformanceTransition);
    window.addEventListener("hashchange", beginCodexPerformanceTransition);
  }

  async function loadCodexDispatcher() {
    const errors = [];
    const seenUrls = new Set();
    for (const assetPrefix of ["app-shared-", "setting-storage-", "vscode-api-", "app-initial-"]) {
      try {
        const module = await loadCodexAppModule(assetPrefix);
        const dispatcher = codexServiceTierDispatcherFromModule(module);
        if (dispatcher) return { dispatcher, assetPrefix };
        errors.push(`${assetPrefix}: dispatcher export unavailable`);
      } catch (error) {
        errors.push(`${assetPrefix}: ${error?.message || String(error)}`);
      }
    }
    // Codex 26.924 moved several renderer services between hashed chunks. The
    // named compatibility prefixes above remain the cheap path; if they miss,
    // inspect only already-loaded app bundles instead of repeatedly failing or
    // importing every asset in the application.
    for (const url of appServerFallbackAssetUrls()) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      try {
        const dispatcher = codexServiceTierDispatcherFromModule(await import(url));
        if (dispatcher) return { dispatcher, assetPrefix: url };
      } catch (error) {
        errors.push(`fallback: ${error?.name || "Error"}`);
      }
    }
    throw new Error(`Codex dispatcher unavailable (${errors.join("; ")})`);
  }

  const codexSharedTerminalRuntimeVersion = "4";

  const codexSharedTerminalRecordKey = "alunixaX.sharedTerminal.records.v1";

  function codexSharedTerminalRetentionMs(value = alunixaXBackendSettings.codexAppSharedTerminalRetentionMinutes) {
    const parsed = value == null ? Number.NaN : Number(value);
    const minutes = Number.isFinite(parsed) ? Math.trunc(parsed) : 2;
    return Math.max(0, Math.min(5, minutes)) * 60 * 1000;
  }

  function codexTerminalManagerFromModule(module) {
    const methods = [
      "create",
      "attach",
      "write",
      "runHeadlessAction",
      "register",
      "getSnapshot",
      "getConversationSnapshot",
      "closeSessionForConversation",
      "subscribeToSessionSnapshot",
      "addSessionForConversation",
      "setActiveSessionForConversation",
      "handleHostEvent",
    ];
    return Object.values(module || {}).find((candidate) =>
      candidate && typeof candidate === "object" && methods.every((method) => typeof candidate[method] === "function")
    ) || null;
  }

  async function loadCodexTerminalManager() {
    for (const prefix of ["app-shared-", "app-initial-"]) {
      try {
        const manager = codexTerminalManagerFromModule(await loadCodexAppModule(prefix));
        if (manager) return manager;
      } catch {
        // Try the other supported bundle layout; never invoke an arbitrary export.
      }
    }
    throw new Error("Codex terminal manager unavailable");
  }

  function stripCodexTerminalControls(value) {
    return String(value || "")
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
      .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function codexTerminalBufferDelta(previous, current) {
    if (!previous) return current || "";
    if ((current || "").startsWith(previous)) return current.slice(previous.length);
    const maximum = Math.min(previous.length, (current || "").length);
    for (let length = maximum; length > 0; length -= 1) {
      if (previous.slice(-length) === current.slice(0, length)) return current.slice(length);
    }
    return current || "";
  }

  function codexPowerShellEncodedCommand(command) {
    const bytes = new Uint8Array(command.length * 2);
    for (let index = 0; index < command.length; index += 1) {
      const code = command.charCodeAt(index);
      bytes[index * 2] = code & 0xff;
      bytes[index * 2 + 1] = code >> 8;
    }
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function codexSharedTerminalWrappedCommand(command, shell, startMarker, doneMarker) {
    const shellName = String(shell || "").toLowerCase();
    if (!alunixaXIsWindowsPlatform && !shellName.includes("powershell") && !shellName.includes("pwsh")) {
      const script = `printf '%s\\n' '${startMarker}'; ${command}; __alunixa_x_exit=$?; printf '\\n%s%s\\n' '${doneMarker}' "$__alunixa_x_exit"`;
      const encoded = btoa(unescape(encodeURIComponent(script)));
      return `eval "$(printf '%s' '${encoded}' | base64 -d)"`;
    }
    const child = shellName.includes("pwsh") ? "pwsh.exe" : "powershell.exe";
    const original = codexPowerShellEncodedCommand(command);
    const orchestrator = [
      "$global:LASTEXITCODE = 0",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      `Write-Output '${startMarker}'`,
      `& '${child}' -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand '${original}'`,
      "$__alunixaXExit = if ($null -eq $LASTEXITCODE) { if ($?) { 0 } else { 1 } } else { [int]$LASTEXITCODE }",
      `Write-Output ([Environment]::NewLine + '${doneMarker}' + $__alunixaXExit)`,
      "exit 0",
    ].join("; ");
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${codexPowerShellEncodedCommand(orchestrator)}`;
  }

  function installCodexSharedTerminalRuntime() {
    const enabled = alunixaXBackendSettings.enhancementsEnabled !== false && alunixaXBackendSettings.codexAppSharedTerminal === true;
    const retentionMinutes = alunixaXBackendSettings.codexAppSharedTerminalRetentionMinutes;
    const existing = window.__alunixaXSharedTerminalRuntime;
    if (existing?.version === codexSharedTerminalRuntimeVersion && !existing.state?.()?.disposed) {
      existing.setEnabled(enabled);
      existing.setRetentionMinutes(retentionMinutes);
      return;
    }
    if (typeof existing?.dispose === "function") existing.dispose();
    else existing?.setEnabled?.(false);
    const state = {
      enabled,
      disposed: false,
      manager: null,
      modulePromise: null,
      records: new Map(),
      activeRequests: new Map(),
      pollTimer: null,
      polling: false,
      retentionMs: codexSharedTerminalRetentionMs(retentionMinutes),
    };

    const persistedRecords = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem(codexSharedTerminalRecordKey) || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const persistCompletedRecords = () => {
      try {
        const records = Array.from(state.records.values())
          .filter((record) => record.completed && !record.closed)
          .map((record) => ({ threadId: record.threadId, sessionId: record.sessionId, lastActivityAt: record.lastActivityAt }));
        localStorage.setItem(codexSharedTerminalRecordKey, JSON.stringify(records));
      } catch {
      }
    };

    const manager = async () => {
      if(state.disposed) throw new Error("Shared terminal runtime stopped");
      if (state.manager) return state.manager;
      state.modulePromise = state.modulePromise || loadCodexTerminalManager();
      const terminalManager = await state.modulePromise.catch((error) => {
        state.modulePromise = null;
        throw error;
      });
      if(state.disposed) throw new Error("Shared terminal runtime stopped");
      state.manager = terminalManager;
      if (!terminalManager.__alunixaXSharedTerminalOriginalWrite) {
        terminalManager.__alunixaXSharedTerminalActivityListeners = new Set();
        terminalManager.__alunixaXSharedTerminalEventListeners = new Set();
        terminalManager.__alunixaXSharedTerminalOriginalWrite = terminalManager.write.bind(terminalManager);
        terminalManager.__alunixaXSharedTerminalOriginalHandleHostEvent = terminalManager.handleHostEvent.bind(terminalManager);
        terminalManager.write = (sessionId, data) => {
          terminalManager.__alunixaXSharedTerminalActivityListeners.forEach((listener) => listener(sessionId, data));
          return terminalManager.__alunixaXSharedTerminalOriginalWrite(sessionId, data);
        };
        terminalManager.handleHostEvent = (event) => {
          terminalManager.__alunixaXSharedTerminalEventListeners.forEach((listener) => listener(event));
          return terminalManager.__alunixaXSharedTerminalOriginalHandleHostEvent(event);
        };
      }
      terminalManager.__alunixaXSharedTerminalActivityListeners.add(activityListener);
      return terminalManager;
    };

    const activityListener = (sessionId, data) => {
        const record = state.records.get(sessionId);
        if (!record) return;
        record.lastActivityAt = Date.now();
        if (record.completed) persistCompletedRecords();
        if (record.busy && String(data || "").includes("\x03")) {
          setTimeout(() => {
            if (record.busy) void finish(record, 130, "共享终端命令已由用户中断");
          }, 1500);
        }
      };

    const scheduleClose = (record) => {
      clearTimeout(record.closeTimer);
      if (!record.completed || record.closed) return;
      const delay = state.retentionMs === 0
        ? 0
        : Math.max(250, record.lastActivityAt + state.retentionMs - Date.now());
      record.closeTimer = setTimeout(async () => {
        if (record.busy || record.closed) return;
        if (state.retentionMs > 0 && Date.now() - record.lastActivityAt < state.retentionMs) {
          scheduleClose(record);
          return;
        }
        try {
          const terminalManager = await manager();
          terminalManager.closeSessionForConversation(record.threadId, record.sessionId);
        } catch {
        }
        record.closed = true;
        unsubscribeRecord(record);
        state.records.delete(record.sessionId);
        persistCompletedRecords();
      }, delay);
    };

    const completeBrokerRequest = async (record, exitCode, output, error) => {
      while (!record.closed) {
        try {
          const result = await postJson("/shared-terminal/complete", {
            requestId: record.requestId,
            exitCode,
            output: output.slice(-4 * 1024 * 1024),
            error: String(error || "").slice(0, 64 * 1024),
          });
          if (result?.status === "ok") return;
        } catch {
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };

    const finish = async (record, exitCode, error = "") => {
      if (!record.busy) return;
      record.busy = false;
      record.completed = true;
      clearInterval(record.heartbeatTimer);
      const clean = stripCodexTerminalControls(record.collected);
      const startLine = `${record.startMarker}\n`;
      const startAt = clean.indexOf(startLine);
      const outputStart = startAt >= 0 ? startAt + startLine.length : 0;
      const markerAt = clean.indexOf(record.doneMarker, outputStart);
      const output = (markerAt >= 0 ? clean.slice(outputStart, markerAt) : clean.slice(outputStart)).replace(/^\n+|\n+$/g, "");
      record.lastActivityAt = Date.now();
      persistCompletedRecords();
      await completeBrokerRequest(record, Number.isInteger(exitCode) ? exitCode : 1, output, error);
      state.activeRequests.delete(record.requestId);
      scheduleClose(record);
    };

    const handleSnapshot = (record) => {
      const snapshot = state.manager?.getSnapshot(record.sessionId) || null;
      if (!snapshot) {
        if (record.busy) void finish(record, 1, "共享终端会话已关闭");
        return;
      }
      const current = String(snapshot.buffer || "");
      const delta = codexTerminalBufferDelta(record.lastBuffer, current);
      record.lastBuffer = current;
      if (!delta) return;
      record.lastActivityAt = Date.now();
      if (record.rawEvents) {
        if (record.completed) {
          persistCompletedRecords();
          scheduleClose(record);
        }
        return;
      }
      if (!record.busy) {
        if (record.completed) {
          persistCompletedRecords();
          scheduleClose(record);
        }
        return;
      }
      record.collected = `${record.collected}${delta}`.slice(-4 * 1024 * 1024);
      const clean = stripCodexTerminalControls(record.collected);
      const markerAt = clean.indexOf(record.doneMarker);
      if (markerAt < 0) return;
      const codeText = clean.slice(markerAt + record.doneMarker.length).match(/^-?\d+/)?.[0];
      if (codeText == null) return;
      void finish(record, Number.parseInt(codeText, 10));
    };

    const subscribeRecord = (terminalManager, record) => {
      unsubscribeRecord(record);
      record.unsubscribe = terminalManager.subscribeToSessionSnapshot(record.sessionId, () => handleSnapshot(record));
      record.rawEvents = typeof terminalManager.__alunixaXSharedTerminalEventListeners?.add === "function";
      if (record.rawEvents) {
        record.rawEventListener = (event) => {
          if (!event || event.sessionId !== record.sessionId) return;
          record.lastActivityAt = Date.now();
          if (event.type === "data" || event.type === "init-log") {
            if (record.busy) {
              const data = String(event.type === "data" ? event.data || "" : event.log || "");
              record.collected = `${record.collected}${data}`.slice(-4 * 1024 * 1024);
              const clean = stripCodexTerminalControls(record.collected);
              const markerAt = clean.indexOf(record.doneMarker);
              const codeText = markerAt < 0 ? null : clean.slice(markerAt + record.doneMarker.length).match(/^-?\d+/)?.[0];
              if (codeText != null) void finish(record, Number.parseInt(codeText, 10));
            } else if (record.completed) {
              persistCompletedRecords();
              scheduleClose(record);
            }
            return;
          }
          if (record.busy && event.type === "exit") void finish(record, Number(event.code) || 1, "共享终端会话已退出");
          if (record.busy && event.type === "error") void finish(record, 1, event.message || "共享终端会话失败");
        };
        terminalManager.__alunixaXSharedTerminalEventListeners.add(record.rawEventListener);
      }
      handleSnapshot(record);
    };

    const unsubscribeRecord = (record) => {
      record.unsubscribe?.();
      record.unsubscribe = null;
      if (record.rawEventListener) state.manager?.__alunixaXSharedTerminalEventListeners?.delete(record.rawEventListener);
      record.rawEventListener = null;
    };

    const waitForShell = async (terminalManager, sessionId, timeoutMs = 8000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const snapshot = terminalManager.getSnapshot(sessionId);
        if (snapshot && snapshot.shell && snapshot.shell !== "unknown") return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Codex terminal did not attach");
    };

    const createRecord = (work, terminalManager, sessionId) => {
      const token = String(work.requestId).replace(/[^a-zA-Z0-9]/g, "");
      const record = {
        requestId: work.requestId,
        threadId: work.threadId,
        sessionId,
        busy: true,
        completed: false,
        closed: false,
        collected: "",
        lastBuffer: "",
        lastActivityAt: Date.now(),
        startMarker: `__ALUNIXA_X_SHARED_START_${token}__`,
        doneMarker: `__ALUNIXA_X_SHARED_DONE_${token}__:`,
        heartbeatTimer: null,
        closeTimer: null,
        unsubscribe: null,
      };
      state.records.set(sessionId, record);
      state.activeRequests.set(work.requestId, record);
      subscribeRecord(terminalManager, record);
      return record;
    };

    const execute = async (work) => {
      if(state.disposed || !state.enabled) {
        if(work?.requestId) void postJson("/shared-terminal/cancel",{}).catch(()=>{});
        return;
      }
      if (!work?.requestId || state.activeRequests.has(work.requestId)) return;
      // Reserve the single execution slot before loading the Codex module so a slow
      // first attach cannot claim another command and change the visible terminal.
      state.activeRequests.set(work.requestId, null);
      let record = null;
      try {
        const terminalManager = await manager();
        if (work.started && work.terminalSessionId) {
          if (!terminalManager.getSnapshot(work.terminalSessionId)) {
            terminalManager.attach({
              conversationId: work.threadId,
              hostId: "local",
              cwd: work.cwd,
              preserveOnOwnerDestroy: true,
              sessionId: work.terminalSessionId,
              workspaceRoot: work.cwd,
            });
          }
          record = createRecord(work, terminalManager, work.terminalSessionId);
          await waitForShell(terminalManager, record.sessionId);
          handleSnapshot(record);
          if (!record.busy) return;
        } else {
          const reusable = Array.from(state.records.values()).find((candidate) =>
            candidate.threadId === work.threadId && candidate.completed && !candidate.closed && !candidate.busy && terminalManager.getSnapshot(candidate.sessionId)
          );
          const sessionId = reusable?.sessionId || terminalManager.addSessionForConversation(work.threadId);
          if (reusable) {
            unsubscribeRecord(reusable);
            clearTimeout(reusable.closeTimer);
            state.records.delete(reusable.sessionId);
          } else {
            terminalManager.create({
              conversationId: work.threadId,
              conversationTitle: "AI shared terminal",
              hostId: "local",
              cwd: work.cwd,
              preserveOnOwnerDestroy: true,
              sessionId,
              workspaceRoot: work.cwd,
            });
          }
          terminalManager.setActiveSessionForConversation(work.threadId, sessionId);
          record = createRecord(work, terminalManager, sessionId);
          const snapshot = await waitForShell(terminalManager, sessionId);
          if(state.disposed || !state.enabled) throw new Error("Shared terminal stopped before dispatch");
          record.lastBuffer = String(snapshot.buffer || "");
          await postJson("/shared-terminal/started", { requestId: work.requestId, terminalSessionId: sessionId });
          if(state.disposed || !state.enabled) throw new Error("Shared terminal stopped before dispatch");
          const wrapped = codexSharedTerminalWrappedCommand(work.command, snapshot.shell, record.startMarker, record.doneMarker);
          terminalManager.runHeadlessAction(sessionId, { command: wrapped, cwd: work.cwd });
          if (typeof terminalManager.setTitle === "function") terminalManager.setTitle(sessionId, work.command);
        }
        record.heartbeatTimer = setInterval(() => {
          if (record.busy) void postJson("/shared-terminal/heartbeat", { requestId: record.requestId }).catch(() => {});
        }, 5000);
      } catch (error) {
        if (record) {
          void finish(record, 1, error?.message || String(error));
        } else {
          try {
            await postJson("/shared-terminal/complete", { requestId: work.requestId, exitCode: 1, output: "", error: error?.message || String(error) });
          } catch {
          }
          state.activeRequests.delete(work.requestId);
        }
      }
    };

    const poll = async () => {
      if (state.disposed || state.polling) return;
      state.polling = true;
      try {
        if (state.enabled && state.activeRequests.size === 0) {
          const work = await postJson("/shared-terminal/next", {});
          if (work?.requestId) void execute(work);
        }
      } catch {
      } finally {
        state.polling = false;
        clearTimeout(state.pollTimer);
        if (!state.disposed) state.pollTimer = setTimeout(poll, state.enabled ? 400 : 2000);
      }
    };

    const restoreCompletedRecords = async () => {
      try {
        const terminalManager = await manager();
        persistedRecords().forEach((saved) => {
          const snapshot = saved?.sessionId ? terminalManager.getSnapshot(saved.sessionId) : null;
          if (!saved?.threadId || !snapshot) return;
          const record = {
            requestId: "",
            threadId: saved.threadId,
            sessionId: saved.sessionId,
            busy: false,
            completed: true,
            closed: false,
            collected: "",
            lastBuffer: String(snapshot.buffer || ""),
            lastActivityAt: Number(saved.lastActivityAt) || Date.now(),
            startMarker: "",
            doneMarker: "",
            heartbeatTimer: null,
            closeTimer: null,
            unsubscribe: null,
          };
          state.records.set(record.sessionId, record);
          subscribeRecord(terminalManager, record);
          scheduleClose(record);
        });
        persistCompletedRecords();
      } catch {
      }
    };

    window.__alunixaXSharedTerminalRuntime = {
      version: codexSharedTerminalRuntimeVersion,
      setEnabled(value) {
        if (state.disposed) return;
        state.enabled = value === true;
        clearTimeout(state.pollTimer);
        state.pollTimer = setTimeout(poll, 0);
      },
      setRetentionMinutes(value) {
        if (state.disposed) return;
        state.retentionMs = codexSharedTerminalRetentionMs(value);
        state.records.forEach((record) => scheduleClose(record));
      },
      dispose() {
        if (state.disposed) return;
        state.disposed = true;
        state.enabled = false;
        void postJson("/shared-terminal/cancel",{}).catch(()=>{});
        clearTimeout(state.pollTimer);
        state.records.forEach((record) => {
          clearInterval(record.heartbeatTimer);
          clearTimeout(record.closeTimer);
          unsubscribeRecord(record);
        });
        state.manager?.__alunixaXSharedTerminalActivityListeners?.delete(activityListener);
      },
      state: () => ({ enabled: state.enabled, disposed:state.disposed, activeRequests: state.activeRequests.size, sessions: state.records.size }),
    };
    void restoreCompletedRecords();
    void poll();
  }

  function pluginAutoExpandVisibleElement(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function pluginAutoExpandPageLooksRelevant() {
    const route = `${location.pathname || ""}${location.hash || ""}${location.search || ""}`;
    if (/plugins?|marketplace/i.test(route)) return true;
    const labels = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading'], [role='tab'], nav a, nav button")).slice(0, 160);
    return labels.some((node) => /插件|Plugins?|Marketplace|市场/i.test(String(node.textContent || "").slice(0, 240)));
  }

  function pluginAutoExpandButtonLooksScoped(button) {
    let node = button;
    for (let depth = 0; node instanceof HTMLElement && node !== document.body && depth < 8; depth += 1, node = node.parentElement) {
      const text = String(node.innerText || "");
      if (text.length > 16000) continue;
      if (/插件|Plugins?|Marketplace|市场/i.test(text)) return true;
    }
    return false;
  }

  function pluginAutoExpandButtonText(button) {
    return String(button?.textContent || button?.getAttribute?.("aria-label") || button?.getAttribute?.("title") || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pluginAutoExpandButtonLooksLikeMore(button) {
    const text = pluginAutoExpandButtonText(button);
    if (!text || text.length > 120) return false;
    if (/^(更多|显示更多|查看更多|加载更多|Show more|Load more|More)$/i.test(text)) return true;
    if (/^查看\s+.+以及另外\s*\d+\s*个$/i.test(text)) return true;
    if (/^View\s+.+\s+and\s+\d+\s+more$/i.test(text)) return true;
    if (/^Show\s+.+\s+and\s+\d+\s+more$/i.test(text)) return true;
    return false;
  }

  function pluginAutoExpandButtonCandidates() {
    if (!alunixaXSettings().pluginAutoExpand || !pluginAutoExpandPageLooksRelevant()) return [];
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(pluginAutoExpandVisibleElement)
      .filter((button) => !button.disabled && button.getAttribute("aria-disabled") !== "true")
      .filter(pluginAutoExpandButtonLooksLikeMore)
      .filter(pluginAutoExpandButtonLooksScoped)
      .filter((button) => !button.closest?.(`.${moreMenuClass}, #${alunixaXMenuId}, .alunixa-x-modal-overlay`));
  }

  function pluginAutoExpandSignature() {
    return pluginAutoExpandButtonCandidates()
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return `${pluginAutoExpandButtonText(button)}:${Math.round(rect.top)}:${Math.round(rect.left)}`;
      })
      .join("|");
  }

  function runPluginAutoExpand(force = false) {
    if (!alunixaXSettings().pluginAutoExpand) return;
    const currentSignature = pluginAutoExpandSignature();
    if (!force && !currentSignature) return;
    if (!force && currentSignature && currentSignature === window.__codexPluginAutoExpandLastSignature) return;
    window.__codexPluginAutoExpandLastSignature = currentSignature;
    window.__codexPluginAutoExpandRunning = true;
    window.__codexPluginAutoExpandClicks = 0;
    const clickNext = () => {
      if (!alunixaXSettings().pluginAutoExpand) {
        window.__codexPluginAutoExpandRunning = false;
        return;
      }
      const button = pluginAutoExpandButtonCandidates()[0];
      if (!button || window.__codexPluginAutoExpandClicks >= codexPluginAutoExpandMaxClicks) {
        window.__codexPluginAutoExpandRunning = false;
        if ((window.__codexPluginAutoExpandClicks || 0) > 0 || button) {
          sendAlunixaXDiagnostic("plugin_auto_expand_finished", {
            version: codexPluginAutoExpandVersion,
            clicks: window.__codexPluginAutoExpandClicks || 0,
            exhausted: !!button,
          });
        }
        return;
      }
      window.__codexPluginAutoExpandClicks = (window.__codexPluginAutoExpandClicks || 0) + 1;
      button.dataset.codexPluginAutoExpandClicked = String(Date.now());
      button.click();
      setTimeout(clickNext, codexPluginAutoExpandClickDelayMs);
    };
    clickNext();
  }

  function sendAlunixaXDiagnostic(event, detail) {
    const payload = alunixaXDiagnosticPayload(event, detail);
    if (window.__ALUNIXA_X_TEST_SERVICE_TIER__) {
      window.__alunixaXServiceTierTestDiagnostics = window.__alunixaXServiceTierTestDiagnostics || [];
      window.__alunixaXServiceTierTestDiagnostics.push(payload);
      return;
    }
    if (window.__codexSessionDeleteBridge) {
      window.__codexSessionDeleteBridge("/diagnostics/log", payload).catch(() => {});
    }
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(`${helperBase}/diagnostics/log`, blob)) return;
      }
    } catch (_) {}
    fetch(`${helperBase}/diagnostics/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }

  function projectMoveSessionKey(sessionId) {
    const variants = threadIdVariants(sessionId);
    const bareId = variants.find((id) => !id.startsWith("local:"));
    return bareId || variants[0] || "";
  }

  function numericTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  function timestampValueToMs(value) {
    const timestamp = numericTimestamp(value);
    if (!timestamp) return 0;
    return timestamp < 1000000000000 ? timestamp * 1000 : timestamp;
  }

  function sortMsForSession(sessionId, preferredValue) {
    return numericTimestamp(preferredValue) || uuidV7TimestampMs(sessionId);
  }

  function timestampMsFromPayload(payload) {
    return numericTimestamp(payload?.updated_at_ms) || timestampValueToMs(payload?.updated_at) || numericTimestamp(payload?.created_at_ms);
  }

  function relativeTimeLabel(timestampMs, nowMs = Date.now()) {
    const timestamp = numericTimestamp(timestampMs);
    if (!timestamp) return "";
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
    if (elapsedSeconds < 60) return "刚刚";
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `${elapsedMinutes} 分`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours} 小时`;
    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays < 7) return `${elapsedDays} 天`;
    const elapsedWeeks = Math.floor(elapsedDays / 7);
    if (elapsedWeeks < 5) return `${elapsedWeeks} 周`;
    const elapsedMonths = Math.floor(elapsedDays / 30);
    if (elapsedMonths < 12) return `${Math.max(1, elapsedMonths)} 月`;
    return `${Math.floor(elapsedDays / 365)} 年`;
  }

  function chatsSection() {
    return document.querySelector('[data-app-action-sidebar-section-heading="Chats"]');
  }

  function projectRowListItem(projectRow) {
    return projectRow.closest?.('[role="listitem"][aria-label]') || projectRow.closest?.('[role="listitem"]') || projectRow;
  }

  function nativeProjectTargets() {
    const section = projectsSection();
    const seen = new Set();
    const targets = [];
    Array.from(document.querySelectorAll('[data-app-action-sidebar-project-row]')).forEach((row) => {
      if (section && !section.contains(row)) return;
      const path = row.getAttribute("data-app-action-sidebar-project-id") || "";
      const normalizedPath = normalizeWorkspacePath(path);
      if (!normalizedPath || seen.has(normalizedPath)) return;
      const label = row.getAttribute("data-app-action-sidebar-project-label") || row.getAttribute("aria-label") || displayProjectName(path);
      seen.add(normalizedPath);
      targets.push({ kind: "project", label: String(label || displayProjectName(path)), description: path, path, normalizedPath, row, listItem: projectRowListItem(row) });
    });
    return targets;
  }

  function serializableProjectTarget(target) {
    return { kind: target.kind, label: target.label, description: target.description, path: target.path, normalizedPath: target.normalizedPath || normalizeWorkspacePath(target.path) };
  }

  function projectMoveTargets() {
    return [
      { kind: "projectless", label: "普通对话", description: "不属于任何项目", path: "", normalizedPath: "" },
      ...nativeProjectTargets().map(serializableProjectTarget),
    ];
  }

  function readLegacyProjectMoveProjection() {
    try {
      const parsed = JSON.parse(localStorage.getItem(legacyProjectMoveOverridesKey) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const now = Date.now();
      const next = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object" || !value.targetCwd) continue;
        const sessionId = projectMoveSessionKey(value.sessionId || key);
        if (!sessionId) continue;
        next[sessionId] = {
          sessionId,
          targetKind: "project",
          targetCwd: String(value.targetCwd),
          targetLabel: String(value.targetLabel || displayProjectName(value.targetCwd)),
          title: String(value.title || ""),
          sortMs: sortMsForSession(sessionId, value.sortMs || value.updatedAtMs || value.updated_at_ms),
          sortMsTrusted: false,
          at: typeof value.at === "number" ? value.at : now,
        };
      }
      return next;
    } catch {
      return {};
    }
  }

  function readProjectMoveProjection() {
    try {
      const parsed = JSON.parse(localStorage.getItem(projectMoveProjectionKey) || "{}");
      const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const merged = { ...readLegacyProjectMoveProjection(), ...raw };
      const now = Date.now();
      const projection = {};
      for (const [key, value] of Object.entries(merged)) {
        if (!value || typeof value !== "object") continue;
        const sessionId = projectMoveSessionKey(value.sessionId || key);
        if (!sessionId) continue;
        if (typeof value.at === "number" && now - value.at > projectMoveProjectionTtlMs) continue;
        const targetKind = value.targetKind === "projectless" ? "projectless" : "project";
        const targetCwd = String(value.targetCwd || value.path || "");
        if (targetKind === "project" && !targetCwd) continue;
        projection[sessionId] = {
          sessionId,
          targetKind,
          targetCwd,
          targetLabel: String(value.targetLabel || value.label || (targetKind === "projectless" ? "普通对话" : displayProjectName(targetCwd))),
          title: String(value.title || ""),
          sortMs: sortMsForSession(sessionId, value.sortMs || value.updatedAtMs || value.updated_at_ms),
          sortMsTrusted: value.sortMsTrusted === true,
          at: typeof value.at === "number" ? value.at : now,
        };
      }
      return projection;
    } catch {
      return readLegacyProjectMoveProjection();
    }
  }

  function writeProjectMoveProjection(projection) {
    try {
      localStorage.setItem(projectMoveProjectionKey, JSON.stringify(projection || {}));
      localStorage.removeItem(legacyProjectMoveOverridesKey);
    } catch (error) {
      window.__codexProjectMoveProjectionFailures = window.__codexProjectMoveProjectionFailures || [];
      window.__codexProjectMoveProjectionFailures.push(String(error?.stack || error));
    }
  }

  function saveProjectMoveProjection(ref, target, sortMs) {
    const id = projectMoveSessionKey(ref.session_id);
    if (!id || !target) return;
    const projection = readProjectMoveProjection();
    projection[id] = {
      sessionId: id,
      targetKind: target.kind === "projectless" ? "projectless" : "project",
      targetCwd: target.path || "",
      targetLabel: target.label || (target.kind === "projectless" ? "普通对话" : displayProjectName(target.path)),
      title: ref.title || "",
      sortMs: sortMsForSession(ref.session_id, sortMs || target.sortMs),
      sortMsTrusted: target.sortMsTrusted === true,
      at: Date.now(),
    };
    writeProjectMoveProjection(projection);
  }

  function clearProjectMoveProjection(ref) {
    const projection = readProjectMoveProjection();
    const keys = threadIdVariants(ref.session_id).map(projectMoveSessionKey).filter(Boolean);
    let changed = false;
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(projection, key)) {
        delete projection[key];
        changed = true;
      }
    });
    if (changed) writeProjectMoveProjection(projection);
  }

  function projectionForSessionId(sessionId, projection = readProjectMoveProjection()) {
    const key = projectMoveSessionKey(sessionId);
    return key ? projection[key] || null : null;
  }

  function projectRowFromListItem(projectItem) {
    if (!projectItem) return null;
    if (projectItem.matches?.("[data-app-action-sidebar-project-row]")) return projectItem;
    return projectItem.querySelector?.("[data-app-action-sidebar-project-row]") || null;
  }

  function targetPath(target) {
    return target?.path || target?.targetCwd || "";
  }

  function targetLabel(target) {
    return target?.label || target?.targetLabel || displayProjectName(targetPath(target));
  }

  function projectItemMatchesTarget(projectItem, target) {
    const projectRow = projectRowFromListItem(projectItem);
    const projectPath = projectRow?.getAttribute?.("data-app-action-sidebar-project-id") || "";
    if (projectPath && sameWorkspacePath(projectPath, targetPath(target))) return true;
    const actual = normalizeProjectLabel(projectRow?.getAttribute?.("data-app-action-sidebar-project-label") || projectItem?.getAttribute?.("aria-label"));
    const labels = uniqueValues([targetLabel(target), displayProjectName(targetPath(target))]).map(normalizeProjectLabel).filter(Boolean);
    return !!actual && labels.includes(actual);
  }

  function findProjectListItem(target) {
    const nativeTarget = nativeProjectTargets().find((project) => sameWorkspacePath(project.path, targetPath(target)));
    if (nativeTarget?.listItem) return nativeTarget.listItem;
    const section = projectsSection();
    if (!section) return null;
    return Array.from(section.querySelectorAll('[role="listitem"][aria-label]')).find((item) => projectItemMatchesTarget(item, target)) || null;
  }

  function closestProjectListItem(row) {
    const item = row.closest?.('[role="listitem"][aria-label]');
    return item?.closest?.('[data-app-action-sidebar-section-heading="Projects"]') ? item : null;
  }

  function rowIsInChats(row) {
    return !!row.closest?.('[data-app-action-sidebar-section-heading="Chats"]');
  }

  function chatsThreadList() {
    return chatsSection()?.querySelector?.('[role="list"][aria-label="对话"], [role="list"]') || null;
  }

  function rowIsUnderTargetProject(row, target) {
    const item = closestProjectListItem(row);
    return !!item && projectItemMatchesTarget(item, target);
  }

  function rowIsUnderTarget(row, target) {
    return target?.targetKind === "projectless" || target?.kind === "projectless" ? rowIsInChats(row) : rowIsUnderTargetProject(row, target);
  }

  function rowListItem(row) {
    return row.closest?.('[role="listitem"]') || row;
  }

  function rowContentRoot(row) {
    return Array.from(row?.children || []).find((child) => String(child.className || "").includes("h-full w-full items-center")) || null;
  }

  function normalizedText(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function classNameText(node) {
    return String(node?.className || "");
  }

  function isRelativeTimeText(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return /^(刚刚|just now|\d+\s*(秒|秒钟|分|分钟|小时|天|日|周|星期|个月|月|年|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years))$/i.test(value);
  }

  function nodeIsThreadTitle(row, node) {
    return Array.from(row?.querySelectorAll?.('[data-thread-title], .truncate.select-none, .truncate.text-base') || [])
      .some((titleNode) => titleNode === node || titleNode.contains(node));
  }

  function closestTimeWrapper(row, node) {
    const root = rowContentRoot(row) || row;
    let current = node?.parentElement || null;
    while (current && current !== root && current !== row) {
      const className = classNameText(current);
      if (current.dataset?.codexProjectMoveTimeWrapper === "true" || (className.includes("ml-[3px]") && className.includes("min-w-[26px]"))) return current;
      current = current.parentElement;
    }
    return null;
  }

  function nodeInsideStatusIcon(row, node) {
    const stop = closestTimeWrapper(row, node) || rowContentRoot(row) || row;
    let current = node || null;
    while (current && current !== stop && current !== row) {
      const className = classNameText(current);
      if (className.includes("animate-spin")) return true;
      if (className.includes("size-5") && className.includes("shrink-0")) return true;
      if (className.includes("contain-paint") && className.includes("contain-layout")) return true;
      current = current.parentElement;
    }
    return false;
  }

  function cleanupManagedStatusIconTimeNodes(row) {
    Array.from(row?.querySelectorAll?.('[data-codex-project-move-time="true"]') || []).forEach((node) => {
      if (!nodeInsideStatusIcon(row, node)) return;
      const text = normalizedText(node);
      delete node.dataset.codexProjectMoveTime;
      delete node.dataset.codexProjectMoveTimeMs;
      if (node.children.length === 0 && isRelativeTimeText(text)) node.textContent = "";
    });
  }

  function nodeLooksLikeTimeLabel(row, node) {
    if (nodeInsideStatusIcon(row, node)) return false;
    if (node?.dataset?.codexProjectMoveTime === "true") return true;
    if (node.children.length > 0) return false;
    const text = normalizedText(node);
    const className = classNameText(node);
    if ((className.includes("tabular-nums") || className.includes("text-token-description-foreground")) && text.length <= 24) return true;
    if (!isRelativeTimeText(text)) return false;
    const rowRect = row?.getBoundingClientRect?.();
    const nodeRect = node?.getBoundingClientRect?.();
    if (!rowRect || !nodeRect || rowRect.width <= 0 || nodeRect.width <= 0) return false;
    return nodeRect.left >= rowRect.left + rowRect.width * 0.45 || nodeRect.right >= rowRect.right - 96;
  }

  function rowTimeLabelCandidates(row) {
    cleanupManagedStatusIconTimeNodes(row);
    const root = rowContentRoot(row) || row;
    const raw = Array.from(root?.querySelectorAll?.("div, span, time, small") || []).filter((node) => {
      if (nodeIsThreadTitle(row, node)) return false;
      return nodeLooksLikeTimeLabel(row, node);
    });
    return raw.filter((node) => !raw.some((other) => other !== node && node.contains(other)));
  }

  function rowTimeLabelNode(row) {
    const candidates = rowTimeLabelCandidates(row);
    return candidates.find((node) => node.dataset?.codexProjectMoveTime !== "true" && !node.closest?.('[data-codex-project-move-time-wrapper="true"]')) || candidates[0] || null;
  }

  function removeTimeLabelNode(row, node) {
    if (!node || !row?.contains?.(node)) return;
    const wrapper = node.closest?.('[data-codex-project-move-time-wrapper="true"]') || closestTimeWrapper(row, node);
    if (wrapper && wrapper !== row && row.contains(wrapper)) {
      wrapper.remove();
      return;
    }
    node.remove();
  }

  function cleanupRowTimeLabels(row, keepNode) {
    if (!keepNode) return;
    rowTimeLabelCandidates(row).forEach((node) => {
      if (node === keepNode) return;
      if (node.dataset?.codexProjectMoveTime === "true" || node.closest?.('[data-codex-project-move-time-wrapper="true"]')) removeTimeLabelNode(row, node);
    });
  }

  function ensureRowTimeLabelNode(row) {
    const existing = rowTimeLabelNode(row);
    if (existing) {
      cleanupRowTimeLabels(row, existing);
      return existing;
    }
    const root = rowContentRoot(row);
    if (!root) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "ml-[3px] flex items-center justify-end gap-1 min-w-[26px]";
    wrapper.dataset.codexProjectMoveTimeWrapper = "true";
    const inner = document.createElement("div");
    const label = document.createElement("div");
    label.className = "text-token-description-foreground text-sm leading-4 empty:hidden tabular-nums overflow-visible truncate text-right group-focus-within:opacity-0 group-hover:opacity-0";
    label.dataset.codexProjectMoveTime = "true";
    inner.appendChild(label);
    wrapper.appendChild(inner);
    root.appendChild(wrapper);
    return label;
  }

  function updateRowTimeLabel(row, sortMs) {
    const label = ensureRowTimeLabelNode(row);
    if (!label) return;
    const timestamp = numericTimestamp(sortMs);
    const text = relativeTimeLabel(timestamp);
    label.dataset.codexProjectMoveTime = "true";
    label.dataset.codexProjectMoveTimeMs = String(timestamp || 0);
    if (text && label.textContent !== text) label.textContent = text;
    cleanupRowTimeLabels(row, label);
  }

  function rowProjectionKind(row) {
    return row?.dataset?.codexProjectMoveTargetKind || rowListItem(row)?.dataset?.codexProjectMoveTargetKind || "";
  }

  function rowSortMs(row, ref = sessionRefFromRow(row), target = null) {
    return sortMsForSession(ref.session_id, target?.sortMs || row?.dataset?.codexProjectMoveSortMs || rowListItem(row)?.dataset?.codexProjectMoveSortMs);
  }

  function threadRowFromListItem(item) {
    if (!item) return null;
    if (item.matches?.("[data-app-action-sidebar-thread-id]")) return item;
    return item.querySelector?.("[data-app-action-sidebar-thread-id]") || null;
  }

  function rowPinned(row) {
    return row?.getAttribute?.("data-app-action-sidebar-thread-pinned") === "true" || rowListItem(row)?.getAttribute?.("data-app-action-sidebar-thread-pinned") === "true";
  }

  function insertRowItemByTime(list, item, row, target) {
    const ref = sessionRefFromRow(row);
    const sortMs = rowSortMs(row, ref, target);
    item.dataset.codexProjectMoveSortMs = String(sortMs || 0);
    row.dataset.codexProjectMoveSortMs = String(sortMs || 0);
    if (target?.sortMsTrusted) updateRowTimeLabel(row, sortMs);
    const pinned = rowPinned(row);
    const sessionKey = projectMoveSessionKey(ref.session_id);
    const existingItems = Array.from(list.children).filter((child) => child !== item);
    let firstNonThreadItem = null;
    for (const child of existingItems) {
      const childRow = threadRowFromListItem(child);
      if (!childRow) {
        firstNonThreadItem = firstNonThreadItem || child;
        continue;
      }
      const childPinned = rowPinned(childRow);
      if (childPinned && !pinned) continue;
      if (!childPinned && pinned) {
        list.insertBefore(item, child);
        return;
      }
      const childRef = sessionRefFromRow(childRow);
      const childSortMs = rowSortMs(childRow, childRef);
      const childKey = projectMoveSessionKey(childRef.session_id);
      if (sortMs > childSortMs || (sortMs === childSortMs && sessionKey > childKey)) {
        list.insertBefore(item, child);
        return;
      }
    }
    if (firstNonThreadItem) {
      list.insertBefore(item, firstNonThreadItem);
      return;
    }
    list.appendChild(item);
  }

  function projectMoveInjectedList(projectItem) {
    let list = projectItem.querySelector('[data-codex-project-move-injected-list="true"]');
    if (!list) {
      const body = Array.from(projectItem.children).find((child) => child.classList?.contains("overflow-hidden")) || projectItem;
      list = document.createElement("div");
      list.setAttribute("role", "list");
      list.setAttribute("data-codex-project-move-injected-list", "true");
      list.className = "flex flex-col";
      body.appendChild(list);
    }
    return list;
  }

  function projectThreadList(projectItem, target) {
    const targetCwd = targetPath(target);
    const projectLists = Array.from(projectItem.querySelectorAll("[data-app-action-sidebar-project-list-id]"));
    return projectLists.find((list) => sameWorkspacePath(list.getAttribute("data-app-action-sidebar-project-list-id"), targetCwd))
      || projectLists[0]
      || projectMoveInjectedList(projectItem);
  }

  function projectEmptyStateNodes(projectItem) {
    const emptyLabels = new Set(["暂无对话", "No conversations"]);
    return Array.from(projectItem.querySelectorAll("div, span")).filter((node) => {
      if (node.classList?.contains("overflow-hidden")) return false;
      if (node.closest('[data-app-action-sidebar-thread-id], [data-codex-project-move-injected-list="true"]')) return false;
      return emptyLabels.has(normalizeProjectLabel(node.textContent));
    });
  }

  function setProjectEmptyStateHidden(projectItem, hidden) {
    projectEmptyStateNodes(projectItem).forEach((node) => {
      if (hidden) {
        node.dataset.codexProjectMoveEmptyHidden = "true";
        node.classList.add("codex-project-move-hidden");
      } else if (node.dataset.codexProjectMoveEmptyHidden === "true") {
        delete node.dataset.codexProjectMoveEmptyHidden;
        node.classList.remove("codex-project-move-hidden");
      }
    });
  }

  function updateProjectMoveEmptyStates() {
    document.querySelectorAll('[data-codex-project-move-injected-list="true"]').forEach((list) => {
      const projectItem = list.closest('[role="listitem"][aria-label]');
      const hasRows = Array.from(list.children).some((child) => child.querySelector?.("[data-app-action-sidebar-thread-id]") || child.matches?.("[data-app-action-sidebar-thread-id]"));
      if (!hasRows) list.remove();
      if (projectItem) setProjectEmptyStateHidden(projectItem, hasRows);
    });
    document.querySelectorAll('[data-codex-project-move-empty-hidden="true"]').forEach((node) => {
      const projectItem = node.closest('[role="listitem"][aria-label]');
      const list = projectItem?.querySelector?.('[data-codex-project-move-injected-list="true"]');
      if (!list || list.children.length === 0) {
        delete node.dataset.codexProjectMoveEmptyHidden;
        node.classList.remove("codex-project-move-hidden");
      }
    });
  }

  function moveRowToProjectList(row, target) {
    const projectItem = findProjectListItem(target);
    if (!projectItem) return false;
    const list = projectThreadList(projectItem, target);
    const item = rowListItem(row);
    if (!list) return false;
    insertRowItemByTime(list, item, row, target);
    cachedSessionRowsAt = 0;
    item.dataset.codexProjectMoveTargetKind = "project";
    item.dataset.codexProjectMoveTargetCwd = targetPath(target);
    row.dataset.codexProjectMoveTargetKind = "project";
    row.dataset.codexProjectMoveTargetCwd = targetPath(target);
    setProjectEmptyStateHidden(projectItem, true);
    return true;
  }

  function moveRowToChats(row, target = null) {
    const list = chatsThreadList();
    if (!list) return false;
    const item = rowListItem(row);
    insertRowItemByTime(list, item, row, target);
    cachedSessionRowsAt = 0;
    item.dataset.codexProjectMoveTargetKind = "projectless";
    row.dataset.codexProjectMoveTargetKind = "projectless";
    delete item.dataset.codexProjectMoveTargetCwd;
    delete row.dataset.codexProjectMoveTargetCwd;
    updateProjectMoveEmptyStates();
    return true;
  }

  function applyProjectMoveProjection() {
    if (!alunixaXSettings().projectMove) return;
    const projection = readProjectMoveProjection();
    const targetRowsById = new Map();
    const settledRefs = [];
    const now = Date.now();
    const rows = sessionRows(true);
    rows.forEach((row) => {
      const ref = sessionRefFromRow(row);
      const target = projectionForSessionId(ref.session_id, projection);
      if (target && rowIsUnderTarget(row, target)) {
        const rowId = projectMoveSessionKey(ref.session_id);
        const hadProjectionKind = !!rowProjectionKind(row);
        const existingRow = targetRowsById.get(rowId);
        if (existingRow && existingRow !== row) {
          const existingIsProjection = !!rowProjectionKind(existingRow);
          const currentIsProjection = !!rowProjectionKind(row);
          const rowToRemove = existingIsProjection && !currentIsProjection ? existingRow : row;
          rowListItem(rowToRemove).remove();
          if (rowToRemove === existingRow) targetRowsById.set(rowId, row);
          if (rowToRemove === row) return;
        } else {
          targetRowsById.set(rowId, row);
        }
        if (!hadProjectionKind && typeof target.at === "number" && now - target.at > projectMoveProjectionSettleMs) settledRefs.push(ref);
        const moved = target.targetKind === "projectless" ? moveRowToChats(row, target) : moveRowToProjectList(row, target);
        if (moved) targetRowsById.set(rowId, row);
        const projectItem = closestProjectListItem(row);
        if (projectItem) setProjectEmptyStateHidden(projectItem, true);
      }
    });
    rows.forEach((row) => {
      const ref = sessionRefFromRow(row);
      const rowId = projectMoveSessionKey(ref.session_id);
      const target = projectionForSessionId(ref.session_id, projection);
      if (!target) {
        const item = rowListItem(row);
        delete row.dataset.codexProjectMoveTargetKind;
        delete row.dataset.codexProjectMoveTargetCwd;
        delete item.dataset.codexProjectMoveTargetKind;
        delete item.dataset.codexProjectMoveTargetCwd;
        return;
      }
      if (rowIsUnderTarget(row, target)) return;
      if (targetRowsById.has(rowId)) {
        rowListItem(row).remove();
        return;
      }
      const moved = target.targetKind === "projectless" ? moveRowToChats(row, target) : moveRowToProjectList(row, target);
      if (moved) targetRowsById.set(rowId, row);
    });
    settledRefs.forEach(clearProjectMoveProjection);
    updateProjectMoveEmptyStates();
  }

  function scheduleProjectMoveProjection() {
    if (!alunixaXSettings().projectMove || window.__codexProjectMoveProjectionTimer) return;
    window.__codexProjectMoveProjectionTimer = setTimeout(() => {
      if (window.__codexProjectMoveRuntimeId !== codexProjectMoveRuntimeId) return;
      window.__codexProjectMoveProjectionTimer = null;
      applyProjectMoveProjection();
    }, 80);
  }

  function refreshAfterProjectMove() {
    const refreshVisibleSidebar = () => {
      applyProjectMoveProjection();
      scheduleChatsSortCorrection(0);
    };
    refreshVisibleSidebar();
    refreshRecentConversationsForHost().finally(() => {
      projectMoveRefreshDelaysMs.forEach((delay) => setTimeout(refreshVisibleSidebar, delay));
    });
  }

  function visibleChatsRows() {
    const list = chatsThreadList();
    if (!list) return [];
    return Array.from(list.children).map(threadRowFromListItem).filter(Boolean).filter((row) => rowIsInChats(row));
  }

  function chatsSortNeedsCorrection(rows) {
    let previousPinned = true;
    let previousSortMs = Infinity;
    let previousKey = "\uffff";
    for (const row of rows) {
      const pinned = rowPinned(row);
      const ref = sessionRefFromRow(row);
      const sortMs = rowSortMs(row, ref);
      const key = projectMoveSessionKey(ref.session_id);
      if (previousPinned && !pinned) {
        previousPinned = false;
        previousSortMs = sortMs;
        previousKey = key;
        continue;
      }
      if (!previousPinned && pinned) return true;
      if (sortMs > previousSortMs || (sortMs === previousSortMs && key > previousKey)) return true;
      previousSortMs = sortMs;
      previousKey = key;
    }
    return false;
  }

  function reorderChatsRows(rows) {
    const list = chatsThreadList();
    if (!list || rows.length < 2) return;
    const rowItems = new Set(rows.map(rowListItem));
    const firstNonThreadItem = Array.from(list.children).find((child) => !rowItems.has(child) && !threadRowFromListItem(child));
    const orderedRows = [...rows].sort((left, right) => {
      const leftPinned = rowPinned(left);
      const rightPinned = rowPinned(right);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      const leftRef = sessionRefFromRow(left);
      const rightRef = sessionRefFromRow(right);
      const leftSortMs = rowSortMs(left, leftRef);
      const rightSortMs = rowSortMs(right, rightRef);
      if (leftSortMs !== rightSortMs) return rightSortMs - leftSortMs;
      return projectMoveSessionKey(rightRef.session_id).localeCompare(projectMoveSessionKey(leftRef.session_id));
    });
    orderedRows.forEach((row) => list.insertBefore(rowListItem(row), firstNonThreadItem || null));
    cachedSessionRowsAt = 0;
  }

  async function applyChatsSortCorrection() {
    if (!alunixaXSettings().projectMove || chatsSortInFlight) return;
    const rows = visibleChatsRows();
    if (rows.length < 2) return;
    const refs = rows.map(sessionRefFromRow).filter((ref) => ref.session_id);
    const signature = refs.map((ref) => projectMoveSessionKey(ref.session_id)).join("|");
    const allRowsHaveSortMs = rows.every((row) => numericTimestamp(row.dataset.codexProjectMoveSortMs || rowListItem(row).dataset.codexProjectMoveSortMs));
    const shouldRefreshSortKeys = signature !== chatsSortSignature || !allRowsHaveSortMs || Date.now() - chatsSortLastFetchAt > chatsSortDbRefreshIntervalMs;
    if (!shouldRefreshSortKeys && !chatsSortNeedsCorrection(rows)) return;
    chatsSortInFlight = true;
    try {
      if (shouldRefreshSortKeys) {
        const result = await postJson("/thread-sort-keys", { sessions: refs }).catch(() => ({ status: "failed", sort_keys: [] }));
        chatsSortLastFetchAt = Date.now();
        const byId = new Map();
        if (result?.status === "ok" && Array.isArray(result?.sort_keys)) {
          result.sort_keys.forEach((item) => {
            const key = projectMoveSessionKey(String(item?.session_id || ""));
            if (key) byId.set(key, item);
          });
        }
        rows.forEach((row) => {
          const ref = sessionRefFromRow(row);
          const payload = byId.get(projectMoveSessionKey(ref.session_id));
          const trustedSortMs = timestampMsFromPayload(payload);
          const sortMs = trustedSortMs || sortMsForSession(ref.session_id, row.dataset.codexProjectMoveSortMs || rowListItem(row).dataset.codexProjectMoveSortMs);
          row.dataset.codexProjectMoveSortMs = String(sortMs || 0);
          rowListItem(row).dataset.codexProjectMoveSortMs = String(sortMs || 0);
          if (trustedSortMs) updateRowTimeLabel(row, trustedSortMs);
        });
      }
      if (chatsSortNeedsCorrection(rows)) reorderChatsRows(rows);
      chatsSortSignature = visibleChatsRows().map((row) => projectMoveSessionKey(sessionRefFromRow(row).session_id)).join("|");
    } finally {
      chatsSortInFlight = false;
    }
  }

  function scheduleChatsSortCorrection(delay = chatsSortRefreshIntervalMs) {
    if (!alunixaXSettings().projectMove || window.__codexProjectMoveChatsSortTimer) return;
    window.__codexProjectMoveChatsSortTimer = setTimeout(() => {
      if (window.__codexProjectMoveRuntimeId !== codexProjectMoveRuntimeId) return;
      window.__codexProjectMoveChatsSortTimer = null;
      applyChatsSortCorrection().catch((error) => {
        window.__codexProjectMoveSortFailures = window.__codexProjectMoveSortFailures || [];
        window.__codexProjectMoveSortFailures.push(String(error?.stack || error));
      });
    }, delay);
  }

  async function setProjectlessThreadIds(ref, mode) {
    const variants = threadIdVariants(ref.session_id);
    if (variants.length === 0) throw new Error("未找到会话 ID");
    const existingIds = await getCodexGlobalState("projectless-thread-ids").catch(() => []);
    const ids = Array.isArray(existingIds) ? existingIds : [];
    const variantSet = new Set(variants);
    const nextIds = mode === "add" ? uniqueValues([...ids, ...variants]) : ids.filter((id) => !variantSet.has(id));
    if (nextIds.length !== ids.length || nextIds.some((id, index) => id !== ids[index])) await setCodexGlobalState("projectless-thread-ids", nextIds);
  }

  async function clearThreadWorkspaceHints(ref) {
    const variants = threadIdVariants(ref.session_id);
    if (variants.length === 0) return;
    const hints = objectGlobalState(await getCodexGlobalState("thread-workspace-root-hints").catch(() => ({})));
    const hintKeys = variants.filter((id) => Object.prototype.hasOwnProperty.call(hints, id));
    if (hintKeys.length > 0) {
      hintKeys.forEach((id) => delete hints[id]);
      await setCodexGlobalState("thread-workspace-root-hints", hints);
    }
  }

  async function clearThreadWritableRoots(ref) {
    const variants = threadIdVariants(ref.session_id);
    if (variants.length === 0) return;
    const roots = objectGlobalState(await getCodexGlobalState("thread-writable-roots").catch(() => ({})));
    const rootKeys = variants.filter((id) => Object.prototype.hasOwnProperty.call(roots, id));
    if (rootKeys.length > 0) {
      rootKeys.forEach((id) => delete roots[id]);
      await setCodexGlobalState("thread-writable-roots", roots);
    }
  }

  async function clearThreadProjectlessOutputDirectories(ref) {
    const variants = threadIdVariants(ref.session_id);
    if (variants.length === 0) return;
    const dirs = objectGlobalState(await getCodexGlobalState("thread-projectless-output-directories").catch(() => ({})));
    const dirKeys = variants.filter((id) => Object.prototype.hasOwnProperty.call(dirs, id));
    if (dirKeys.length > 0) {
      dirKeys.forEach((id) => delete dirs[id]);
      await setCodexGlobalState("thread-projectless-output-directories", dirs);
    }
  }

  async function moveSessionToProjectless(ref) {
    if (!ref.session_id) throw new Error("未找到会话 ID");
    await setProjectlessThreadIds(ref, "add");
    await clearThreadWorkspaceHints(ref);
    await clearThreadWritableRoots(ref);
    await clearThreadProjectlessOutputDirectories(ref);
    const sortKey = await postJson("/thread-sort-key", ref).catch(() => ({}));
    return { status: "moved", session_id: ref.session_id, updated_at: sortKey?.updated_at, updated_at_ms: sortKey?.updated_at_ms, created_at_ms: sortKey?.created_at_ms };
  }

  function isNativeProjectTarget(target) {
    return target?.kind === "project" && nativeProjectTargets().some((project) => sameWorkspacePath(project.path, target.path));
  }

  async function moveSessionToProject(ref, target) {
    if (!ref.session_id) throw new Error("未找到会话 ID");
    if (!target?.path) throw new Error("目标项目路径为空");
    if (!isNativeProjectTarget(target)) throw new Error("目标项目不在 Codex 项目列表中");
    const result = await postJson("/move-thread-workspace", { ...ref, target_cwd: target.path });
    if (result.status !== "moved") throw new Error(result.message || "移动项目失败");
    await setProjectlessThreadIds(ref, "remove");
    await clearThreadWorkspaceHints(ref);
    return result;
  }

  function upstreamWorktreeField(dialog, name) {
    return dialog.querySelector(`[data-codex-upstream-worktree-field="${name}"]`);
  }

  function upstreamWorktreePayload(dialog) {
    return {
      repoPath: upstreamWorktreeField(dialog, "repoPath")?.value || "",
      branchName: upstreamWorktreeField(dialog, "branchName")?.value || "",
      worktreePath: upstreamWorktreeField(dialog, "worktreePath")?.value || "",
      remote: upstreamWorktreeField(dialog, "remote")?.value || "upstream",
      baseBranch: upstreamWorktreeField(dialog, "baseBranch")?.value || "main",
      fetch: true,
    };
  }

  function readUpstreamBranchSelection() {
    try {
      return JSON.parse(sessionStorage.getItem(upstreamBranchSelectionKey) || "null");
    } catch {
      return null;
    }
  }

  function writeUpstreamBranchSelection(selection) {
    if (!selection) {
      sessionStorage.removeItem(upstreamBranchSelectionKey);
      return;
    }
    sessionStorage.setItem(upstreamBranchSelectionKey, JSON.stringify(selection));
  }

  function clearUpstreamBranchTriggerLabel() {
    document.querySelectorAll('[data-codex-upstream-branch-trigger="true"]').forEach((trigger) => {
      const nativeLabel = trigger.querySelector('[data-codex-native-branch-label="true"]');
      const selectionLabel = trigger.querySelector('[data-codex-upstream-branch-selection-label="true"]');
      if (nativeLabel) nativeLabel.hidden = false;
      if (selectionLabel) selectionLabel.hidden = true;
      trigger.removeAttribute("aria-label");
      trigger.removeAttribute("title");
    });
  }

  function syncUpstreamBranchTriggerLabel() {
    const selection = readUpstreamBranchSelection();
    if (!selection?.label) {
      clearUpstreamBranchTriggerLabel();
      return;
    }
    document.querySelectorAll('[data-codex-upstream-branch-trigger="true"]').forEach((trigger) => {
      const nativeLabel = trigger.querySelector('[data-codex-native-branch-label="true"]');
      const selectionLabel = trigger.querySelector('[data-codex-upstream-branch-selection-label="true"]');
      if (!selectionLabel) return;
      if (nativeLabel) nativeLabel.hidden = true;
      selectionLabel.hidden = false;
      selectionLabel.textContent = selection.label;
      trigger.setAttribute("aria-label", selection.label);
      trigger.setAttribute("title", selection.label);
    });
  }

  function upstreamQualifiedSourceRef(selection) {
    if (selection?.qualifiedSourceRef) return selection.qualifiedSourceRef;
    const remote = (selection?.remote || "upstream").trim();
    const baseBranch = (selection?.baseBranch || "main").trim();
    return remote && baseBranch ? `refs/remotes/${remote}/${baseBranch}` : "";
  }

  function prepareUpstreamBranchSelection(selection) {
    if ((!selection?.repoPath && !selection?.projectId) || !selection.remote || !selection.baseBranch) return;
    void postJson("/upstream-worktree/prepare", {
      repoPath: selection.repoPath || "",
      projectId: selection.projectId || "",
      remote: selection.remote,
      baseBranch: selection.baseBranch,
      fetch: true,
    }).then((result) => {
      if (result?.status !== "ok") throw new Error(result?.message || "prepare failed");
      writePreparedUpstreamBranchSelection(selection, result);
    }).catch((error) => {
      sendAlunixaXDiagnostic("upstream_branch_prepare_failed", {
        label: selection.label || "",
        errorName: error?.name || "",
        errorMessage: error?.message || String(error),
      });
    });
  }

  function writePreparedUpstreamBranchSelection(selection, result) {
    const current = readUpstreamBranchSelection();
    if (!upstreamSelectionMatches(current, selection)) return;
    writeUpstreamBranchSelection({
      ...current,
      qualifiedSourceRef: result.qualifiedSourceRef || upstreamQualifiedSourceRef(selection),
      sourceHead: result.sourceHead || "",
      preparedAt: Date.now(),
    });
  }

  function upstreamSelectionMatches(left, right) {
    return !!left && !!right
      && (left.repoPath || "") === (right.repoPath || "")
      && (left.projectId || "") === (right.projectId || "")
      && (left.remote || "upstream") === (right.remote || "upstream")
      && (left.baseBranch || "main") === (right.baseBranch || "main");
  }

  function pendingWorktreeRequestMatchesSelection(request, selection) {
    if (!selection || !request || request.launchMode !== "start-conversation") return false;
    const sourceRoot = request.sourceWorkspaceRoot || "";
    if (selection.repoPath && sourceRoot) return sameWorkspacePath(sourceRoot, selection.repoPath);
    if (selection.projectId) return true;
    return !selection.repoPath || sameWorkspacePath(sourceRoot, selection.repoPath);
  }

  function applyUpstreamPendingWorktreeOverride(payload) {
    const selection = readUpstreamBranchSelection();
    const request = payload?.request;
    const sourceRef = upstreamQualifiedSourceRef(selection);
    if (!alunixaXSettings().upstreamWorktreeCreate || !sourceRef) return payload;
    if (!pendingWorktreeRequestMatchesSelection(request, selection)) return payload;
    if (request?.startingState?.type !== "branch") return payload;
    if (request.startingState.branchName === sourceRef) return payload;
    const nextRequest = {
      ...request,
      startingState: { ...request.startingState, branchName: sourceRef },
    };
    prepareUpstreamBranchSelection(selection);
    sendAlunixaXDiagnostic("upstream_pending_worktree_override_applied", {
      label: selection.label || "",
      sourceRef,
      sourceWorkspaceRoot: request.sourceWorkspaceRoot || "",
    });
    return { ...(payload || {}), request: nextRequest };
  }

  function installUpstreamPendingWorktreeDispatcherPatch() {
    const patchVersion = "1";
    if (window.__codexUpstreamPendingWorktreeDispatcherPatch === patchVersion) return;
    const patch = async () => {
      try {
        const { dispatcher } = await loadCodexDispatcher();
        if (!dispatcher || typeof dispatcher.dispatchMessage !== "function") throw new Error("Codex dispatcher unavailable");
        if (!dispatcher.__codexUpstreamWorktreeOriginalDispatchMessage) {
          dispatcher.__codexUpstreamWorktreeOriginalDispatchMessage = dispatcher.dispatchMessage.bind(dispatcher);
          dispatcher.dispatchMessage = (type, payload) => {
            const nextPayload = type === "pending-worktree-create"
              ? applyUpstreamPendingWorktreeOverride(payload)
              : payload;
            return dispatcher.__codexUpstreamWorktreeOriginalDispatchMessage(type, nextPayload);
          };
        }
        window.__codexUpstreamPendingWorktreeDispatcherPatch = patchVersion;
      } catch (error) {
        sendAlunixaXDiagnostic("upstream_pending_worktree_patch_failed", {
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
      }
    };
    void patch();
  }

  function upstreamWorktreeNativePayloadFromElement(element) {
    const trigger = element?.closest?.("[data-codex-worktree-create], [data-worktree-create]") || element;
    const scopes = [
      trigger,
      trigger?.closest?.("form"),
      trigger?.closest?.("dialog, [role='dialog']"),
    ].filter((scope, index, all) => scope?.querySelector && all.indexOf(scope) === index);
    if (!scopes.length) return null;
    const valueFrom = (selectors) => {
      for (const scope of scopes) {
        for (const selector of selectors) {
          const node = scope.matches?.(selector) ? scope : scope.querySelector(selector);
          const dataAttribute = selector.match(/^\[([a-z0-9-]+)\]$/i)?.[1] || "";
          const value = node?.value || node?.getAttribute?.(dataAttribute) || node?.getAttribute?.("data-value") || node?.textContent || "";
          if (String(value).trim()) return String(value).trim();
        }
      }
      return "";
    };
    const repoPath = valueFrom(["[data-repo-path]", "[name='repoPath']", "[name='repo']"]);
    const branchName = valueFrom(["[data-branch-name]", "[name='branchName']", "[name='branch']"]);
    const worktreePath = valueFrom(["[data-worktree-path]", "[name='worktreePath']", "[name='path']"]);
    const remote = valueFrom(["[data-remote]", "[name='remote']"]) || "upstream";
    const baseBranch = valueFrom(["[data-base-branch]", "[name='baseBranch']", "[name='base']"]) || "main";
    if (!repoPath || !branchName || !worktreePath || !remote || !baseBranch) return null;
    return { repoPath, branchName, worktreePath, remote, baseBranch, fetch: true };
  }

  function upstreamWorktreePayloadFromSelection(trigger) {
    const selection = readUpstreamBranchSelection();
    if ((!selection?.repoPath && !selection?.projectId) || !selection?.remote || !selection?.baseBranch) return null;
    const nativePayload = upstreamWorktreeNativePayloadFromElement(trigger);
    if (!nativePayload?.branchName || !nativePayload?.worktreePath) return null;
    return {
      ...nativePayload,
      repoPath: selection.repoPath,
      projectId: selection.projectId || "",
      remote: selection.remote,
      baseBranch: selection.baseBranch,
      fetch: true,
    };
  }

  async function handleUpstreamWorktreeNativeCreate(event) {
    if (!alunixaXSettings().upstreamWorktreeCreate) return false;
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const trigger = target?.closest?.("[data-codex-worktree-create], [data-worktree-create]");
    if (!trigger) return false;
    const payload = upstreamWorktreePayloadFromSelection(trigger) || upstreamWorktreeNativePayloadFromElement(trigger);
    if (!payload) {
      showToast("无法安全识别 Codex 原生 worktree 表单，请使用 Alunixa X 菜单创建。", null);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = await postJson("/upstream-worktree/create", payload);
      if (result?.status === "ok") {
        writeUpstreamBranchSelection(null);
        syncUpstreamBranchTriggerLabel();
        showToast(`已从 ${result.sourceRef} 创建 worktree`, null);
      } else {
        showToast(result?.message || "创建 upstream worktree 失败", null);
      }
    } catch (error) {
      showToast(error?.message || "创建 upstream worktree 失败", null);
    }
    return true;
  }

  function installUpstreamWorktreeNativeAdapter() {
    const adapterVersion = "2";
    installUpstreamPendingWorktreeDispatcherPatch();
    if (window.__codexUpstreamWorktreeNativeAdapterInstalled === adapterVersion) return;
    window.__codexUpstreamWorktreeNativeAdapterInstalled = adapterVersion;
    document.addEventListener("click", (event) => {
      handleUpstreamWorktreeNativeCreate(event);
    }, true);
  }

  function setUpstreamWorktreeMessage(dialog, message, status = "idle") {
    const messageNode = dialog.querySelector("[data-codex-upstream-worktree-message]");
    if (!messageNode) return;
    messageNode.dataset.status = status;
    messageNode.textContent = message || "";
  }

  async function loadUpstreamWorktreeDefaults(dialog) {
    const repoPath = upstreamWorktreeField(dialog, "repoPath")?.value?.trim() || "";
    if (!repoPath) {
      setUpstreamWorktreeMessage(dialog, "填写仓库路径后会自动读取 remote 和当前分支。", "idle");
      return;
    }
    setUpstreamWorktreeMessage(dialog, "正在读取仓库默认值…", "loading");
    try {
      const result = await postJson("/upstream-worktree/defaults", { repoPath });
      if (result?.status !== "ok") {
        setUpstreamWorktreeMessage(dialog, result?.message || "读取仓库默认值失败", "failed");
        return;
      }
      const remote = upstreamWorktreeField(dialog, "remote");
      const baseBranch = upstreamWorktreeField(dialog, "baseBranch");
      if (remote && !remote.value) remote.value = result.defaultRemote || "upstream";
      if (baseBranch && (!baseBranch.value || baseBranch.value === "main")) baseBranch.value = result.defaultBaseBranch || "main";
      setUpstreamWorktreeMessage(dialog, `将从 ${remote?.value || "upstream"}/${baseBranch?.value || "main"} 创建 worktree。`, "ok");
    } catch (error) {
      setUpstreamWorktreeMessage(dialog, error?.message || "读取仓库默认值失败", "failed");
    }
  }

  async function submitUpstreamWorktree(dialog) {
    const payload = upstreamWorktreePayload(dialog);
    if (!payload.repoPath || !payload.branchName || !payload.worktreePath || !payload.remote || !payload.baseBranch) {
      setUpstreamWorktreeMessage(dialog, "仓库路径、分支名、worktree 路径、remote 和 base branch 都必须填写。", "failed");
      return;
    }
    setUpstreamWorktreeMessage(dialog, "正在 fetch 并创建 worktree…", "loading");
    try {
      const result = await postJson("/upstream-worktree/create", payload);
      if (result?.status === "ok") {
        setUpstreamWorktreeMessage(dialog, `已从 ${result.sourceRef} 创建：${result.worktreePath}`, "ok");
        showToast(`已创建 upstream worktree：${result.branchName}`, null);
      } else {
        setUpstreamWorktreeMessage(dialog, result?.message || "创建 upstream worktree 失败", "failed");
      }
    } catch (error) {
      setUpstreamWorktreeMessage(dialog, error?.message || "创建 upstream worktree 失败", "failed");
    }
  }

  function openUpstreamWorktreeDialog() {
    document.querySelectorAll(`.${upstreamWorktreeDialogClass}`).forEach((node) => node.remove());
    const overlay = document.createElement("div");
    overlay.className = `codex-delete-confirm-overlay ${upstreamWorktreeDialogClass}`;
    overlay.innerHTML = `
      <div class="codex-delete-confirm-content" role="dialog" aria-modal="true" aria-label="Create upstream worktree">
        <div class="codex-delete-confirm-title">Create from upstream</div>
        <div class="codex-delete-confirm-message">等价于 git worktree add -b branch path upstream/base。创建前会先 fetch 远端分支。</div>
        <label class="alunixa-x-form-field">仓库路径<input data-codex-upstream-worktree-field="repoPath" type="text" placeholder="/path/to/repo"></label>
        <label class="alunixa-x-form-field">新分支名<input data-codex-upstream-worktree-field="branchName" type="text" placeholder="feature/my-task"></label>
        <label class="alunixa-x-form-field">Worktree 路径<input data-codex-upstream-worktree-field="worktreePath" type="text" placeholder="/path/to/worktrees/my-task"></label>
        <label class="alunixa-x-form-field">Remote<input data-codex-upstream-worktree-field="remote" type="text" value="upstream"></label>
        <label class="alunixa-x-form-field">Base branch<input data-codex-upstream-worktree-field="baseBranch" type="text" value="main"></label>
        <div class="alunixa-x-form-message" data-codex-upstream-worktree-message>填写仓库路径后会自动读取 remote 和当前分支。</div>
        <div class="codex-delete-confirm-actions">
          <button type="button" data-codex-upstream-worktree-cancel="true">取消</button>
          <button type="button" data-codex-upstream-worktree-defaults="true">读取默认值</button>
          <button type="button" data-codex-upstream-worktree-submit="true">Create from upstream</button>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (event.target === overlay || target?.closest("[data-codex-upstream-worktree-cancel]")) {
        overlay.remove();
        return;
      }
      if (target?.closest("[data-codex-upstream-worktree-defaults]")) {
        loadUpstreamWorktreeDefaults(overlay);
        return;
      }
      if (target?.closest("[data-codex-upstream-worktree-submit]")) {
        submitUpstreamWorktree(overlay);
      }
    }, true);
    upstreamWorktreeField(overlay, "repoPath")?.addEventListener("change", () => loadUpstreamWorktreeDefaults(overlay));
    document.body.appendChild(overlay);
    upstreamWorktreeField(overlay, "repoPath")?.focus();
  }

  function sortStateFromMoveResult(result, ref, row) {
    const trustedSortMs = timestampMsFromPayload(result);
    return { sortMs: trustedSortMs || rowSortMs(row, ref), sortMsTrusted: !!trustedSortMs };
  }

  function finishProjectMove(row, button, ref, target, message) {
    releaseDeleteFocus(row, button);
    button.disabled = false;
    button.textContent = "移动";
    saveProjectMoveProjection(ref, target, target.sortMs || rowSortMs(row, ref, target));
    if (target.kind === "projectless") moveRowToChats(row, target);
    refreshAfterProjectMove();
    showToast(message, null);
  }

  async function applyProjectMove(row, button, ref, target) {
    button.disabled = true;
    button.textContent = "移动中";
    try {
      if (target.kind === "projectless") {
        const result = await moveSessionToProjectless(ref);
        finishProjectMove(row, button, ref, { ...target, ...sortStateFromMoveResult(result, ref, row) }, `已移动到普通对话：“${ref.title || ref.session_id}”`);
      } else {
        const result = await moveSessionToProject(ref, target);
        finishProjectMove(row, button, ref, { ...target, ...sortStateFromMoveResult(result, ref, row) }, `已移动到“${target.label}”：“${ref.title || ref.session_id}”`);
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = "移动";
      showToast(`移动失败：${error?.message || error}`, null);
    }
  }

  async function openProjectMoveMenuForRow(row, button, ref, event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    releaseDeleteFocus(row, button);
    document.querySelectorAll(`.${projectMoveOverlayClass}`).forEach((node) => node.remove());
    const overlay = document.createElement("div");
    overlay.className = projectMoveOverlayClass;
    overlay.innerHTML = `
      <div class="codex-project-move-panel" role="dialog" aria-modal="true" aria-label="移动对话">
        <div class="codex-project-move-header">
          <div class="codex-project-move-title">移动“${escapeHtml(ref.title || ref.session_id)}”</div>
        </div>
        <div class="codex-project-move-list"><div class="codex-project-move-empty">加载项目中...</div></div>
      </div>
    `;
    const panel = overlay.querySelector(".codex-project-move-panel");
    const rect = button.getBoundingClientRect();
    const panelWidth = Math.min(360, Math.max(240, window.innerWidth - 32));
    panel.style.left = `${Math.max(16, Math.min(window.innerWidth - panelWidth - 16, rect.right - panelWidth))}px`;
    panel.style.top = `${Math.max(16, Math.min(window.innerHeight - 120, rect.bottom + 6))}px`;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (clickEvent) => {
      if (clickEvent.target === overlay) close();
    }, true);
    overlay.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        close();
      }
    }, true);
    document.body.appendChild(overlay);
    try {
      const targets = projectMoveTargets();
      const list = overlay.querySelector(".codex-project-move-list");
      if (!list) return;
      list.innerHTML = "";
      if (targets.length === 0) {
        list.innerHTML = `<div class="codex-project-move-empty">没有可用目标</div>`;
        return;
      }
      for (const target of targets) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "codex-project-move-item";
        item.innerHTML = `
          <div class="codex-project-move-item-title">${escapeHtml(target.label)}</div>
          <div class="codex-project-move-item-path">${escapeHtml(target.description)}</div>
        `;
        item.addEventListener("click", async (selectEvent) => {
          selectEvent.preventDefault();
          selectEvent.stopPropagation();
          close();
          await applyProjectMove(row, button, ref, target);
        }, true);
        list.appendChild(item);
      }
      list.querySelector("button")?.focus();
    } catch (error) {
      close();
      showToast(`加载项目失败：${error?.message || error}`, null);
    }
  }

  let zedRemoteStatusPromise = null;

  const zedRemoteMissingHostMessage = "Cannot determine remote SSH host for this file";

  function showZedRemoteToast(message) {
    document.querySelectorAll(`.${zedRemoteToastClass}`).forEach((node) => node.remove());
    const toast = document.createElement("div");
    toast.className = zedRemoteToastClass;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  async function loadZedRemoteStatus() {
    zedRemoteStatusPromise = zedRemoteStatusPromise || postJson("/zed-remote/status", {});
    return zedRemoteStatusPromise;
  }

  async function resolveZedRemoteHost(hostId) {
    const result = await postJson("/zed-remote/resolve-host", { hostId });
    return result?.status === "ok" && result.ssh ? result.ssh : null;
  }

  function zedRemoteIsRemoteHostId(hostId) {
    return zedRemoteString(hostId).startsWith("remote-ssh-");
  }

  function zedRemoteProjectIdFromRow(row) {
    const projectList = row?.closest?.("[data-app-action-sidebar-project-list-id]");
    const projectId = zedRemoteString(projectList?.getAttribute?.("data-app-action-sidebar-project-list-id"));
    if (projectId) return projectId;
    const projectRow = row?.closest?.("[data-app-action-sidebar-project-id]");
    return zedRemoteString(projectRow?.getAttribute?.("data-app-action-sidebar-project-id"));
  }

  function zedRemoteWorkspaceRootFromObject(source) {
    if (!source || typeof source !== "object") return "";
    for (const key of ["remoteWorkspaceRoot", "workspaceRoot", "displayCwd", "cwd", "rootPath", "workingDirectory", "workingDir"]) {
      const workspaceRoot = zedRemoteString(source[key]);
      if (workspaceRoot.startsWith("/") && !/\/\.codex$/.test(workspaceRoot)) return workspaceRoot;
    }
    const hostConfig = source.hostConfig || source.sshHostConfig || source.remoteHostConfig || source.ssh || {};
    for (const key of ["remoteWorkspaceRoot", "workspaceRoot", "rootPath", "cwd"]) {
      const workspaceRoot = zedRemoteString(hostConfig[key]);
      if (workspaceRoot.startsWith("/") && !/\/\.codex$/.test(workspaceRoot)) return workspaceRoot;
    }
    return "";
  }

  function zedRemoteWorkspaceRootFromElement(element) {
    for (const key of zedRemoteReactKeys(element)) {
      const workspaceRoot = zedRemoteWalkObject(element[key], zedRemoteWorkspaceRootFromObject, { maxDepth: 10, maxNodes: 320 });
      if (workspaceRoot) return workspaceRoot;
    }
    return "";
  }

  function zedRemoteWorkspaceRootFromRow(row) {
    for (let node = row; node && node !== document.body; node = node.parentElement) {
      const workspaceRoot = zedRemoteWorkspaceRootFromElement(node);
      if (workspaceRoot) return workspaceRoot;
    }
    return "";
  }

  function zedRemoteActiveThreadRow() {
    const rows = sessionRows(true).filter((row) => row instanceof HTMLElement);
    return rows.find((row) => row.getAttribute("data-app-action-sidebar-thread-active") === "true")
      || rows.find((row) => row.getAttribute("aria-current") === "page" || row.getAttribute("aria-current") === "true")
      || null;
  }

  function zedRemoteCurrentFallbackPayload() {
    const row = zedRemoteActiveThreadRow();
    const ref = row ? sessionRefFromRow(row) : currentSessionRef();
    const threadId = ref.session_id || locationThreadId();
    const hostId = zedRemoteString(row?.getAttribute?.("data-app-action-sidebar-thread-host-id"));
    const isRemoteHost = zedRemoteIsRemoteHostId(hostId);
    const payload = {};
    if (threadId) payload.threadId = threadId;
    if (hostId && hostId !== "local") payload.hostId = hostId;
    if (!isRemoteHost) return payload;
    const remoteWorkspaceRoot = zedRemoteWorkspaceRootFromRow(row);
    const remoteProjectId = zedRemoteProjectIdFromRow(row);
    if (remoteWorkspaceRoot) payload.remoteWorkspaceRoot = remoteWorkspaceRoot;
    if (remoteProjectId) payload.remoteProjectId = remoteProjectId;
    return payload;
  }

  async function resolveZedRemoteFallbackRequest() {
    const payload = zedRemoteCurrentFallbackPayload();
    if (!zedRemoteIsRemoteHostId(payload.hostId)) return null;
    const result = await postJson("/zed-remote/fallback-request", payload);
    return result?.status === "ok" && result.request ? result.request : null;
  }

  function zedRemoteOpenStrategy() {
    const strategy = zedRemoteString(alunixaXBackendSettings.zedRemoteOpenStrategy);
    return ["addToFocusedWorkspace", "reuseWindow", "newWindow", "default"].includes(strategy)
      ? strategy
      : "addToFocusedWorkspace";
  }

  function zedRemoteString(value) {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  }

  function zedRemoteTruthy(value) {
    if (value === true) return true;
    if (typeof value === "string") return /^(true|1|yes|enabled|ssh)$/i.test(value.trim());
    return false;
  }

  function zedRemoteHasTrustedSshSignal(source, hostConfig) {
    return zedRemoteTruthy(source?.supportsSsh) || zedRemoteTruthy(hostConfig?.supportsSsh);
  }

  function zedRemoteContextFromObject(source) {
    if (!source || typeof source !== "object") return null;
    const hostConfig = source.hostConfig || source.sshHostConfig || source.remoteHostConfig || source.ssh || {};
    const host = zedRemoteString(source.remoteHost || source.sshHost || source.host || source.hostname || source.hostName || hostConfig.host || hostConfig.hostname || hostConfig.hostName || hostConfig.sshHost);
    const hostId = zedRemoteString(source.hostId);
    const cwd = zedRemoteString(source.cwd || source.workspaceRoot || source.rootPath || source.remoteWorkspaceRoot || hostConfig.remoteWorkspaceRoot || hostConfig.workspaceRoot || hostConfig.rootPath);
    if ((!host || !zedRemoteHasTrustedSshSignal(source, hostConfig)) && !(hostId.startsWith("remote-ssh-") && cwd.startsWith("/"))) return null;
    const user = zedRemoteString(source.remoteUser || source.sshUser || source.user || source.username || hostConfig.user || hostConfig.username || hostConfig.sshUser);
    const port = zedRemoteString(source.remotePort || source.sshPort || source.port || hostConfig.port || hostConfig.sshPort);
    const workspaceRoot = cwd;
    return { hostId, ssh: { user, host, port }, workspaceRoot };
  }

  function zedRemoteWalkObject(root, visitor, options = {}) {
    const maxDepth = options.maxDepth || 6;
    const maxNodes = options.maxNodes || 180;
    const visited = new WeakSet();
    const stack = [{ value: root, depth: 0 }];
    let scanned = 0;
    while (stack.length && scanned < maxNodes) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object" || visited.has(value) || depth > maxDepth) continue;
      visited.add(value);
      scanned += 1;
      const result = visitor(value);
      if (result) return result;
      if (value instanceof Element || value === window || value === document || value === document.body || value === document.documentElement) continue;
      for (const key of Object.keys(value).slice(0, 80)) {
        if (key === "ownerDocument" || key === "parentElement" || key === "parentNode" || key === "children" || key === "childNodes") continue;
        let child;
        try {
          child = value[key];
        } catch {
          continue;
        }
        if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
      }
    }
    return null;
  }

  function zedRemoteReactKeys(element) {
    return Object.keys(element).filter((key) => key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance") || key.startsWith("__reactProps"));
  }

  function zedRemoteContextFromElement(element) {
    for (const key of zedRemoteReactKeys(element)) {
      const context = zedRemoteWalkObject(element[key], zedRemoteContextFromObject);
      if (context) return context;
    }
    return null;
  }

  function zedRemoteContextForElement(element) {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const context = zedRemoteContextFromElement(node);
      if (context) return context;
    }
    return null;
  }

  function zedRemoteHostIdFromText(text) {
    const source = String(text || "");
    const match = source.match(/\bremote-ssh-[A-Za-z0-9:_-]+\b/);
    return match ? match[0] : "";
  }

  function zedRemoteWorkspaceRootForPath(path) {
    const source = String(path || "").trim();
    const projects = Array.from(document.querySelectorAll(selectors.sidebarThread))
      .map((row) => ({
        label: (row.textContent || "").replace(/\s+/g, " ").trim(),
        selected: row.getAttribute("aria-current") === "page" || row.getAttribute("data-selected") === "true" || row.getAttribute("data-active") === "true" || row.className.includes("selected"),
      }))
      .filter((row) => row.label);
    const selected = projects.find((row) => row.selected)?.label || "";
    for (const label of [selected, ...projects.map((row) => row.label)]) {
      const name = label.match(/^([A-Za-z0-9._-]+)/)?.[1];
      if (name && source.includes(`/repo/${name}/`)) return source.slice(0, source.indexOf(`/repo/${name}/`) + `/repo/${name}`.length);
    }
    const repoIndex = source.indexOf("/bin/repo/");
    if (repoIndex >= 0) {
      const afterRepo = source.slice(repoIndex + "/bin/repo/".length);
      const project = afterRepo.split("/")[0];
      if (project) return source.slice(0, repoIndex + "/bin/repo/".length + project.length);
    }
    return source;
  }

  function zedRemoteFallbackContextForElement(element) {
    const pathText = (element.textContent || "").trim();
    if (!pathText.startsWith("/")) return null;
    const root = element.closest("main") || document.body;
    const hostId = zedRemoteHostIdFromText(root?.textContent || "") || "remote-ssh-codex-managed:remote";
    return { hostId, ssh: { user: "", host: "", port: "" }, workspaceRoot: zedRemoteWorkspaceRootForPath(pathText) };
  }

  function zedRemoteContextFromSerializedState(text) {
    const source = String(text || "");
    if (!source.includes("hostConfig") || !source.includes("supportsSsh") || !source.includes("remoteWorkspaceRoot")) return null;
    const trimmed = source.trim();
    if (/^[{[]/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        const context = zedRemoteWalkObject(parsed, zedRemoteContextFromObject, { maxDepth: 10, maxNodes: 300 });
        if (context) return context;
      } catch {
      }
    }
    if (!/['"]supportsSsh['"]\s*:\s*true/.test(source)) return null;
    const fieldValue = (name) => {
      const match = source.match(new RegExp(`["']${name}["']\\s*:\\s*["']([^"']+)["']`));
      return match ? match[1] : "";
    };
    const host = fieldValue("host") || fieldValue("hostname") || fieldValue("hostName") || fieldValue("sshHost") || fieldValue("remoteHost");
    if (!host) return null;
    return {
      ssh: {
        user: fieldValue("user") || fieldValue("username") || fieldValue("sshUser") || fieldValue("remoteUser"),
        host,
        port: fieldValue("port") || fieldValue("sshPort") || fieldValue("remotePort"),
      },
      workspaceRoot: fieldValue("remoteWorkspaceRoot") || fieldValue("workspaceRoot") || fieldValue("rootPath"),
    };
  }

  const zedRemoteContextCacheTtlMs = 1200;

  let zedRemoteContextCache = { scope: null, at: 0, value: null };

  function zedRemoteScopedElements(scope, selector) {
    const root = scope?.querySelectorAll ? scope : document;
    const nodes = [];
    if (scope instanceof HTMLElement && scope.matches?.(selector)) nodes.push(scope);
    root.querySelectorAll?.(selector).forEach((node) => nodes.push(node));
    return Array.from(new Set(nodes));
  }

  function zedRemoteContextFromDataset(node) {
    if (!(node instanceof HTMLElement)) return null;
    const data = node.dataset;
    return zedRemoteContextFromObject({
      hostConfig: data.hostConfig ? { host: data.hostConfig, supportsSsh: true } : {},
      supportsSsh: data.supportsSsh || data.supportsSshRemote,
      sshHost: data.sshHost,
      remoteHost: data.remoteHost,
      host: data.host,
      sshUser: data.sshUser,
      remoteUser: data.remoteUser,
      user: data.user,
      sshPort: data.sshPort,
      remotePort: data.remotePort,
      port: data.port,
      remoteWorkspaceRoot: data.remoteWorkspaceRoot,
      workspaceRoot: data.workspaceRoot,
    });
  }

  function zedRemoteContextUncached(scope = document) {
    const explicitSelector = "[data-host-config], [data-ssh-host], [data-remote-host], [data-remote-workspace-root], [data-supports-ssh]";
    for (const node of zedRemoteScopedElements(scope, explicitSelector)) {
      if (isExtensionUiNode(node)) continue;
      const context = zedRemoteContextFromDataset(node);
      if (context) return context;
    }
    const reactSelector = "[data-remote-path], [data-file-path], [data-path], [data-open-in-targets], [data-open-file], [data-codex-open-file], [role='menuitem']";
    const reactNodes = zedRemoteScopedElements(scope, reactSelector);
    if (scope instanceof HTMLElement && !isExtensionUiNode(scope)) reactNodes.unshift(scope);
    for (const node of Array.from(new Set(reactNodes)).slice(0, 60)) {
      if (!(node instanceof HTMLElement) || isExtensionUiNode(node)) continue;
      const context = zedRemoteContextFromElement(node);
      if (context) return context;
    }
    if (scope !== document) return null;
    const scripts = Array.from(document.querySelectorAll("script[type='application/json'], script[data-state], script#__NEXT_DATA__, script:not([src])"));
    for (const script of scripts.slice(0, 20)) {
      const context = zedRemoteContextFromSerializedState(script.textContent || "");
      if (context) return context;
    }
    return null;
  }

  function zedRemoteContext(scope = document) {
    const settings = alunixaXSettings();
    if (!settings.zedRemoteOpen) return null;
    const now = Date.now();
    if (zedRemoteContextCache.scope === scope && now - zedRemoteContextCache.at < zedRemoteContextCacheTtlMs) {
      return zedRemoteContextCache.value;
    }
    const value = zedRemoteContextUncached(scope);
    zedRemoteContextCache = { scope, at: now, value };
    return value;
  }

  function zedRemoteAbsolutePath(value, workspaceRoot) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.startsWith("/")) return text;
    if (workspaceRoot && !text.includes("://") && !text.startsWith("~")) {
      return `${workspaceRoot.replace(/\/+$/, "")}/${text.replace(/^\.\//, "")}`;
    }
    return "";
  }

  function zedRemoteMetadataRemotePath(source) {
    if (!source || typeof source !== "object") return "";
    return zedRemoteString(source.remotePath || source.remote_path || source.path || source.filePath || source.file_path || source.openFile?.remotePath || source.openFile?.path);
  }

  function zedRemotePathFromElementMetadata(element) {
    const dataPath = element.dataset.remotePath || element.dataset.filePath || element.dataset.path || "";
    if (dataPath) return dataPath;
    for (const key of zedRemoteReactKeys(element)) {
      const path = zedRemoteWalkObject(element[key], zedRemoteMetadataRemotePath, { maxDepth: 6, maxNodes: 120 });
      if (path) return path;
    }
    return "";
  }

  function zedRemoteInlinePathFromElement(element, context) {
    if (!context?.hostId && !context?.ssh?.host) return "";
    const text = (element.textContent || "").trim();
    if (!text || text.length > 600 || !text.startsWith("/")) return "";
    const path = zedRemoteAbsolutePath(text, context.workspaceRoot || "");
    if (!path) return "";
    if (context.workspaceRoot && !path.startsWith(`${context.workspaceRoot.replace(/\/+$/, "")}/`) && path !== context.workspaceRoot) return "";
    return path;
  }

  function zedRemoteAnchorHasOpenFileMetadata(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    if (anchor.dataset.remotePath || anchor.dataset.filePath || anchor.dataset.path || anchor.dataset.openInTargets || anchor.dataset.openFile || anchor.dataset.codexOpenFile) return true;
    const label = `${anchor.getAttribute("aria-label") || ""} ${anchor.getAttribute("data-testid") || ""} ${anchor.getAttribute("rel") || ""}`;
    return /open[-_\s]?file|open-in-targets|remote/i.test(label) && !!zedRemotePathFromElementMetadata(anchor);
  }

  function zedRemoteFileCandidates(context, scope = document) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (node, candidateContext, rawPath) => {
      if (!candidateContext?.ssh?.host && !candidateContext?.hostId) return;
      const path = zedRemoteAbsolutePath(rawPath, candidateContext.workspaceRoot || "");
      if (!path || seen.has(path)) return;
      seen.add(path);
      candidates.push({ node, request: { ssh: candidateContext.ssh, hostId: candidateContext.hostId || "", path } });
    };
    const selectors = "[data-remote-path], [data-file-path], [data-path], [data-open-in-targets], [data-open-file], [data-codex-open-file], a[data-remote-path], a[data-file-path], a[data-path]";
    zedRemoteScopedElements(scope, selectors).forEach((node) => {
      if (!(node instanceof HTMLElement) || isExtensionUiNode(node)) return;
      if (node instanceof HTMLAnchorElement && !zedRemoteAnchorHasOpenFileMetadata(node)) return;
      addCandidate(node, zedRemoteContextForElement(node) || context, zedRemotePathFromElementMetadata(node));
    });
    if (scope !== document) {
      zedRemoteScopedElements(scope, "span.inline-markdown, code, [class*='inlineMarkdown']").forEach((node) => {
        if (!(node instanceof HTMLElement) || isExtensionUiNode(node)) return;
        const candidateContext = zedRemoteContextForElement(node) || context || zedRemoteFallbackContextForElement(node);
        if (!candidateContext?.hostId && !candidateContext?.ssh?.host) return;
        const path = zedRemoteInlinePathFromElement(node, candidateContext);
        if (path) addCandidate(node, candidateContext, path);
      });
    }
    return candidates;
  }

  function zedRemoteBestOpenRequest(scope = document, context = zedRemoteContext(scope) || zedRemoteContext(document) || {}) {
    const candidates = zedRemoteFileCandidates(context, scope);
    if (candidates.length) return candidates[0].request;
    return null;
  }

  async function openZedRemote(request) {
    let nextRequest = request;
    if (!nextRequest?.ssh?.host && nextRequest?.hostId) {
      const ssh = await resolveZedRemoteHost(nextRequest.hostId);
      nextRequest = ssh ? { ...nextRequest, ssh } : nextRequest;
    }
    if (!nextRequest?.ssh?.host) {
      showZedRemoteToast(zedRemoteMissingHostMessage);
      return;
    }
    nextRequest = {
      ...nextRequest,
      strategy: nextRequest.strategy || zedRemoteOpenStrategy(),
      remember: alunixaXBackendSettings.zedRemoteProjectRegistryEnabled !== false,
    };
    try {
      const result = await postJson("/zed-remote/open", nextRequest);
      if (result?.status === "ok") {
        showZedRemoteToast("Opened in Zed Remote");
        return;
      }
      showZedRemoteToast(result?.message || "Cannot open this file in Zed Remote");
    } catch (error) {
      showZedRemoteToast(error?.message || "Cannot open this file in Zed Remote");
    }
  }

  function removeZedRemoteButtons() {
    document.querySelectorAll(`[data-codex-zed-remote-version]`).forEach((node) => {
      delete node.dataset.codexZedRemoteVersion;
    });
    document.querySelectorAll(`.${zedRemoteButtonClass}`).forEach((node) => node.remove());
  }

  function createZedRemoteOpenInMenuItem(referenceItem) {
    const item = document.createElement("div");
    item.className = referenceItem?.className || "no-drag text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm group hover:bg-token-list-hover-background focus:bg-token-list-hover-background cursor-interaction flex flex-col";
    item.classList.add(zedRemoteOpenInMenuItemClass);
    item.setAttribute("role", referenceItem?.getAttribute("role") || "menuitem");
    item.setAttribute("tabindex", referenceItem?.getAttribute("tabindex") || "-1");
    item.setAttribute("data-orientation", referenceItem?.getAttribute("data-orientation") || "vertical");
    item.innerHTML = `
      <div class="flex w-full items-center gap-1.5">
        <span class="inline-flex size-[18px] items-center justify-center leading-none shrink-0 opacity-75 group-focus:opacity-100 group-hover:opacity-100">
          <img alt="" class="codex-zed-open-in-menu-icon icon-sm" src="apps/zed.png">
        </span>
        <span class="flex-1 min-w-0 truncate">Zed</span>
      </div>
    `;
    bindZedRemoteOpenInMenuItem(item, "injected");
    return item;
  }

  function zedRemoteOpenInMenuActivationIsDuplicate(target) {
    if (!(target instanceof HTMLElement)) return false;
    const now = Date.now();
    const activatedAt = Number(target.dataset.codexZedOpenInMenuActivatedAt || 0);
    if (activatedAt && now - activatedAt < zedRemoteOpenInMenuActivationWindowMs) return true;
    target.dataset.codexZedOpenInMenuActivatedAt = String(now);
    return false;
  }

  async function activateZedRemoteOpenInMenuItem(event) {
    if (!alunixaXSettings().zedRemoteOpen) return;
    if (event?.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const scope = event?.currentTarget?.closest?.('[role="menu"], [data-radix-popper-content-wrapper]') || event?.currentTarget || document;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (zedRemoteOpenInMenuActivationIsDuplicate(event?.currentTarget)) return;
    const request = zedRemoteBestOpenRequest(scope) || await resolveZedRemoteFallbackRequest();
    if (!request) {
      showZedRemoteToast("Cannot find a remote workspace or file for Zed");
      return;
    }
    openZedRemote(request);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }

  function bindZedRemoteOpenInMenuItem(item, source) {
    item.setAttribute("data-codex-zed-open-in-menu", source);
    if (item.dataset.codexZedOpenInMenuBound === zedRemoteOpenInMenuVersion) return;
    item.dataset.codexZedOpenInMenuBound = zedRemoteOpenInMenuVersion;
    item.dataset.codexZedOpenInMenuVersion = zedRemoteOpenInMenuVersion;
    item.addEventListener("pointerup", activateZedRemoteOpenInMenuItem, true);
    item.addEventListener("click", activateZedRemoteOpenInMenuItem, true);
    item.addEventListener("keydown", activateZedRemoteOpenInMenuItem, true);
  }

  function removeZedRemoteOpenInMenuItems(scope = document) {
    const root = scope?.querySelectorAll ? scope : document;
    root.querySelectorAll(`.${zedRemoteOpenInMenuItemClass}, [data-codex-zed-open-in-menu="injected"]`).forEach((node) => node.remove());
  }

  function zedRemoteOpenInMenuScopes(scope = document) {
    const root = scope?.querySelectorAll ? scope : document;
    const menus = [];
    if (scope instanceof HTMLElement && scope.matches?.('[role="menu"]')) menus.push(scope);
    root.querySelectorAll?.('[role="menu"]').forEach((menu) => menus.push(menu));
    return Array.from(new Set(menus));
  }

  function refreshZedRemoteOpenInMenus(scope = document) {
    removeZedRemoteOpenInMenuItems(scope);
    if (!alunixaXSettings().zedRemoteOpen) return;
    const fallbackPayload = zedRemoteCurrentFallbackPayload();
    zedRemoteOpenInMenuScopes(scope).forEach((menu) => {
      if (!(menu instanceof HTMLElement) || isExtensionUiNode(menu)) return;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((item) => !isExtensionUiNode(item));
      const menuText = items.map((item) => (item.textContent || "").trim()).join(" ");
      if (!/\b(VS Code|Cursor|Antigravity)\b/.test(menuText)) return;
      if (!zedRemoteBestOpenRequest(menu) && !zedRemoteIsRemoteHostId(fallbackPayload.hostId)) return;
      const existingZedItem = items.find((item) => (item.textContent || "").trim() === "Zed");
      if (existingZedItem) {
        bindZedRemoteOpenInMenuItem(existingZedItem, "native");
        return;
      }
      const referenceItem = items.find((item) => /^(VS Code|Cursor|Antigravity)$/.test((item.textContent || "").trim()));
      if (!referenceItem) return;
      referenceItem.parentElement?.appendChild(createZedRemoteOpenInMenuItem(referenceItem));
    });
  }

  async function refreshZedRemoteOpenControls(scope = document) {
    if (!alunixaXSettings().zedRemoteOpen) {
      removeZedRemoteButtons();
      removeZedRemoteOpenInMenuItems();
      return;
    }
    try {
      const status = await loadZedRemoteStatus();
      if (!status?.platformSupported || (!status.zedAppFound && !status.zedCliFound)) {
        removeZedRemoteButtons();
        removeZedRemoteOpenInMenuItems();
        return;
      }
    } catch (_) {
      removeZedRemoteButtons();
      removeZedRemoteOpenInMenuItems();
      return;
    }
    refreshZedRemoteOpenInMenus(scope);
  }


  function installRestoredFeatureStyles() {
  if (document.getElementById("alunixa-x-restored-styles")) return;
  const style=document.createElement("style");
  style.id="alunixa-x-restored-styles";
  style.setAttribute("data-alunixa-x-ext","restored-features");
  style.textContent=`.codex-zed-open-in-menu-icon{
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        object-fit: contain;
      }
.codex-project-move-panel{
        position: fixed;
        width: min(360px, calc(100vw - 32px));
        max-height: min(520px, calc(100vh - 32px));
        overflow: hidden;
        border: 1px solid rgba(15,23,42,.14);
        border-radius: 10px;
        background: #ffffff;
        color: #111827;
        font: 13px system-ui, sans-serif;
        box-shadow: 0 18px 60px rgba(15,23,42,.25);
      }
.codex-project-move-header{ border-bottom: 1px solid #e5e7eb; padding: 10px 12px; }
.codex-project-move-title{ font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.codex-project-move-list{ max-height: min(440px, calc(100vh - 110px)); overflow-y: auto; padding: 6px; }
.codex-project-move-item{
        display: block;
        width: 100%;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #111827;
        padding: 8px 9px;
        text-align: left;
        cursor: pointer;
      }
.codex-project-move-item:hover,
      .codex-project-move-item:focus-visible{ background: #f3f4f6; outline: none; }
.codex-project-move-item-title{ font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.codex-project-move-item-path{ margin-top: 2px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.codex-project-move-empty{ padding: 18px 12px; color: #6b7280; text-align: center; }
.codex-project-move-hidden{ display: none !important; }
[data-codex-project-move-injected-list="true"]{ display: flex; flex-direction: column; }
html.dark .codex-project-move-panel,
      html[data-theme="dark"] .codex-project-move-panel,
      :root[data-theme="dark"] .codex-project-move-panel{
        border-color: rgba(255,255,255,.12);
        background: #2b2b2b;
        color: #f3f4f6;
        box-shadow: 0 18px 60px rgba(0,0,0,.55);
      }
html.dark .codex-project-move-header,
      html[data-theme="dark"] .codex-project-move-header,
      :root[data-theme="dark"] .codex-project-move-header{
        border-bottom-color: rgba(255,255,255,.1);
      }
html.dark .codex-project-move-item,
      html[data-theme="dark"] .codex-project-move-item,
      :root[data-theme="dark"] .codex-project-move-item{
        color: #f3f4f6;
      }
html.dark .codex-project-move-item:hover,
      html.dark .codex-project-move-item:focus-visible,
      html[data-theme="dark"] .codex-project-move-item:hover,
      html[data-theme="dark"] .codex-project-move-item:focus-visible,
      :root[data-theme="dark"] .codex-project-move-item:hover,
      :root[data-theme="dark"] .codex-project-move-item:focus-visible{
        background: rgba(255,255,255,.08);
      }
html.dark .codex-project-move-item-path,
      html[data-theme="dark"] .codex-project-move-item-path,
      :root[data-theme="dark"] .codex-project-move-item-path,
      html.dark .codex-project-move-empty,
      html[data-theme="dark"] .codex-project-move-empty,
      :root[data-theme="dark"] .codex-project-move-empty{
        color: #9ca3af;
      }
html:not(.light):not([data-theme="light"]) .codex-project-move-panel{
          border-color: rgba(255,255,255,.12);
          background: #2b2b2b;
          color: #f3f4f6;
          box-shadow: 0 18px 60px rgba(0,0,0,.55);
        }
html:not(.light):not([data-theme="light"]) .codex-project-move-header{
          border-bottom-color: rgba(255,255,255,.1);
        }
html:not(.light):not([data-theme="light"]) .codex-project-move-item{
          color: #f3f4f6;
        }
html:not(.light):not([data-theme="light"]) .codex-project-move-item:hover,
        html:not(.light):not([data-theme="light"]) .codex-project-move-item:focus-visible{
          background: rgba(255,255,255,.08);
        }
html:not(.light):not([data-theme="light"]) .codex-project-move-item-path,
        html:not(.light):not([data-theme="light"]) .codex-project-move-empty{
          color: #9ca3af;
        }
.codex-project-move-overlay{position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;background:rgba(0,0,0,.45)}`;
  document.documentElement.appendChild(style);
}
