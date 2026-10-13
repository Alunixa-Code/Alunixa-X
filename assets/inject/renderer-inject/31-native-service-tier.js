  // Only supply provider capabilities to the installed native presentation component.
  // Never change the account, subscription access, or the native tier setter.
  function patchCodexNativeFastControlProps(props, context) {
    if (!props || !context?.enabled || context.authMethod !== "apikey"
        || context.hostId !== "local" || context.status !== "ready"
        || !Array.isArray(props.serviceTierOptions) || props.serviceTierOptions.length
        || !context.isModelSupported?.(props.model)
        || typeof context.onSelectServiceTier !== "function"
        || !Array.isArray(context.serviceTierOptions) || context.serviceTierOptions.length < 2) return props;
    return {
      ...props,
      selectedServiceTier: context.selectedServiceTier,
      serviceTierOptions: context.serviceTierOptions,
      serviceTierOptionsLoading: false,
      onSelectServiceTier: context.onSelectServiceTier,
      ...(props.modelPickerTriggerConfig ? {
        modelPickerTriggerConfig: {
          ...props.modelPickerTriggerConfig,
          selectedServiceTierIconKind: context.selectedServiceTier === "priority" ? "fast" : null,
        },
      } : {}),
    };
  }

  function installCodexNativeFastJsxPatch(runtime, NativePicker, Adapter) {
    if (!runtime || typeof NativePicker !== "function" || typeof Adapter !== "function") return null;
    const replacements = [];
    try {
      for (const key of ["jsx", "jsxs"]) {
        const descriptor = Object.getOwnPropertyDescriptor(runtime, key);
        if (!descriptor || typeof descriptor.value !== "function" || !descriptor.writable) throw new Error("Native JSX is read only");
        const original = descriptor.value;
        const wrapper = function (type, ...args) {
          return original.call(this, type === NativePicker ? Adapter : type, ...args);
        };
        Object.defineProperty(runtime, key, { ...descriptor, value: wrapper });
        replacements.push({ key, descriptor, wrapper });
      }
    } catch (_) {
      replacements.forEach(({ key, descriptor, wrapper }) => {
        if (runtime[key] === wrapper) Object.defineProperty(runtime, key, descriptor);
      });
      return null;
    }
    return () => replacements.forEach(({ key, descriptor, wrapper }) => {
      if (runtime[key] === wrapper) Object.defineProperty(runtime, key, descriptor);
    });
  }

  function cloneCodexNativeFastTrigger(React, NativeLabel, node, tier, depth = 0) {
    if (depth > 10 || !React.isValidElement(node)) return node;
    if (node.type === NativeLabel) return React.cloneElement(node, { serviceTierIconKind: tier === "priority" ? "fast" : null });
    const changes = {};
    // The native dropdown places its displayed model in selectedValue, not children.
    for (const key of ["children", "selectedValue"]) {
      const value = node.props[key];
      if (value != null) changes[key] = Array.isArray(value)
        ? value.map((child) => cloneCodexNativeFastTrigger(React, NativeLabel, child, tier, depth + 1))
        : cloneCodexNativeFastTrigger(React, NativeLabel, value, tier, depth + 1);
    }
    return Object.keys(changes).length ? React.cloneElement(node, changes) : node;
  }

  const codexNativeFastControlRuntime = window.__alunixaXNativeFastControlRuntime || (window.__alunixaXNativeFastControlRuntime = {
    revision: 0, signature: "", listeners: new Set(), pending: null,
    dispose: null, checkedAt: 0, authMethod: null, client: null, generation: 0,
    requirementsReady: false, fastAllowed: false,
  });
  // Results from the previous injection must not publish its captured state.
  codexNativeFastControlRuntime.generation += 1;
  codexNativeFastControlRuntime.pending = null;
  codexNativeFastControlRuntime.checkedAt = 0;
  // An already mounted adapter must read the newest injection's state/handlers.
  codexNativeFastControlRuntime.getContext = codexNativeFastControlContext;
  codexNativeFastControlRuntime.patchProps = patchCodexNativeFastControlProps;
  codexNativeFastControlRuntime.cloneTrigger = cloneCodexNativeFastTrigger;
  codexNativeFastControlRuntime.activeControls ||= new Map();
  codexNativeFastControlRuntime.refreshBadges = () => refreshCodexServiceTierBadges();

  function codexNativeFastControlEnabled() {
    return !!alunixaXSettings().serviceTierControls
      && alunixaXBackendSettings.codexAppVersion === "26.1007.30912";
  }

  function codexNativeFastControlClientReady() {
    const runtime = codexNativeFastControlRuntime;
    return runtime.authMethod === "apikey" && runtime.requirementsReady === true
      && runtime.fastAllowed === true && !!runtime.client
      && nativeHostClient("local") === runtime.client;
  }

  function codexNativeFastControlVisible() {
    const ref = currentSessionRef();
    return codexNativeFastControlEnabled() && codexNativeFastControlClientReady()
      && alunixaXBackendStatus.status === "ok" && codexServiceTierState.status === "ok"
      && ref.host_id === "local" && Array.from(codexNativeFastControlRuntime.activeControls.values())
      .some((key) => key === `local:${ref.session_id}`);
  }

  function notifyCodexNativeFastControls() {
    const runtime = codexNativeFastControlRuntime;
    const ref = currentSessionRef();
    const signature = JSON.stringify([
      !!alunixaXSettings().serviceTierControls, alunixaXBackendStatus.status,
      codexServiceTierState.status, codexServiceTierState.effectiveServiceTier,
      codexServiceTierState.fastModelName, codexServiceTierState.fastSupported,
      codexModelCatalogLoadedAt,
      ref.session_id, ref.host_id, runtime.authMethod,
      runtime.requirementsReady, runtime.fastAllowed, runtime.generation,
    ]);
    if (signature === runtime.signature) return;
    runtime.signature = signature;
    runtime.revision += 1;
    runtime.listeners.forEach((notify) => notify());
  }

  function codexNativeFastControlContext(props) {
    const runtime = codexNativeFastControlRuntime;
    const ref = currentSessionRef();
    const threadId = validThreadScrollSessionKey(ref.session_id);
    const model = props.model;
    const client = runtime.client;
    const generation = runtime.generation;
    const supported = codexServiceTierFastSupportedForModel(model);
    const isCurrent = () => {
      const current = currentSessionRef();
      return current.host_id === "local" && current.session_id === ref.session_id
        && codexNativeFastControlEnabled() && alunixaXBackendStatus.status === "ok"
        && codexServiceTierState.status === "ok" && codexNativeFastControlClientReady()
        && runtime.client === client && runtime.generation === generation;
    };
    return {
      enabled: codexNativeFastControlEnabled() && alunixaXBackendStatus.status === "ok",
      authMethod: codexNativeFastControlClientReady() ? runtime.authMethod : null,
      hostId: ref.host_id,
      status: codexServiceTierState.status === "ok" ? "ready" : codexServiceTierState.status,
      selectedServiceTier: isFastServiceTierValue(codexServiceTierState.effectiveServiceTier) ? "priority" : null,
      isModelSupported: () => supported,
      serviceTierOptions: [
        { value: null, label: "Standard", description: "使用标准服务模式", iconKind: null },
        { value: "priority", label: "Fast", description: "使用供应商的 priority 服务模式", iconKind: "fast" },
      ],
      onSelectServiceTier: (value) => {
        if (!isCurrent() || (value !== null && value !== "priority")) return false;
        if (value === "priority" && !codexServiceTierFastSupportedForModel(model)) return false;
        if (threadId) codexServiceTierRememberThreadModel(threadId, model);
        return setCodexThreadServiceTierMode(value === "priority" ? "fast" : "standard", model);
      },
    };
  }

  async function installCodexNativeFastControls() {
    const runtime = codexNativeFastControlRuntime;
    // These native exports were inspected in this release. Unknown releases retain
    // the established Alunixa control until their component contract is checked.
    const enabled = codexNativeFastControlEnabled();
    const client = enabled ? nativeHostClient("local") : null;
    if (!enabled || !client || runtime.client !== client) {
      runtime.generation += 1;
      runtime.pending = null;
      runtime.checkedAt = 0;
      runtime.client = client;
      runtime.authMethod = null;
      runtime.requirementsReady = false;
      runtime.fastAllowed = false;
      if (!enabled) {
        runtime.dispose?.();
        runtime.dispose = null;
      }
      notifyCodexNativeFastControls();
    }
    if (!enabled || !client) return;
    if (runtime.pending) return runtime.pending;
    if (Date.now() - runtime.checkedAt < 5000) return;
    runtime.checkedAt = Date.now();
    const generation = runtime.generation;
    const isCurrent = () => generation === runtime.generation && codexNativeFastControlEnabled()
      && runtime.client === client && nativeHostClient("local") === client;
    const operation = (async () => {
      const auth = await client.sendRequest("getAuthStatus", { includeToken: false, refreshToken: false }, { timeoutMs: 5000 });
      if (!isCurrent()) return;
      runtime.authMethod = auth?.authMethod ?? null;
      if (runtime.authMethod !== "apikey") {
        runtime.requirementsReady = false;
        runtime.fastAllowed = false;
        notifyCodexNativeFastControls();
        return;
      }
      const policy = await client.sendRequest("configRequirements/read", undefined, { timeoutMs: 5000 });
      if (!isCurrent()) return;
      if (!policy || typeof policy !== "object") throw new Error("Invalid native config requirements response");
      runtime.requirementsReady = true;
      runtime.fastAllowed = policy.requirements?.featureRequirements?.fast_mode !== false;
      notifyCodexNativeFastControls();
      if (!runtime.fastAllowed || runtime.dispose) return;
      const [shared, primary] = await Promise.all([
        loadCodexAppModule("app-shared-"), loadCodexAppModule("app-primary-"),
      ]);
      if (!isCurrent()) return;
      if (typeof shared.PCn !== "function" || typeof shared.Agn !== "function"
          || typeof primary.Td !== "function" || typeof primary.Ed !== "function") return;
      const source = String(primary.Td);
      if (!["serviceTierOptionsLoading", "onSelectServiceTier", "triggerButton", "onToggleMenuView"].every((key) => source.includes(key))) return;
      primary.Ed();
      const React = shared.PCn();
      const jsxRuntime = shared.Agn();
      const originalJsx = jsxRuntime.jsx;
      const subscribe = (notify) => { runtime.listeners.add(notify); return () => runtime.listeners.delete(notify); };
      const snapshot = () => runtime.revision;
      function AlunixaNativeFastModelPicker(props) {
        React.useSyncExternalStore(subscribe, snapshot, snapshot);
        const token = React.useRef({}).current;
        const context = runtime.getContext(props);
        let next = runtime.patchProps(props, context);
        const activeKey = next !== props ? `local:${currentSessionRef().session_id}` : null;
        React.useEffect(() => {
          if (activeKey == null) return;
          runtime.activeControls.set(token, activeKey);
          runtime.refreshBadges();
          return () => { runtime.activeControls.delete(token); runtime.refreshBadges(); };
        }, [activeKey, token]);
        // Retain the native trigger and native lightning glyph. Only clone its
        // existing label; never append a second model picker or synthetic button.
        if (next !== props && next.triggerButton && typeof primary.Pd === "function") {
          next = { ...next, triggerButton: runtime.cloneTrigger(React, primary.Pd, next.triggerButton, next.selectedServiceTier) };
        }
        return originalJsx(primary.Td, next);
      }
      runtime.dispose = installCodexNativeFastJsxPatch(jsxRuntime, primary.Td, AlunixaNativeFastModelPicker);
      if (runtime.dispose) sendAlunixaXDiagnostic("native_fast_control_ready", { codexAppVersion: alunixaXBackendSettings.codexAppVersion });
    })().catch(() => {
      if (!isCurrent()) return;
      runtime.authMethod = null;
      runtime.requirementsReady = false;
      runtime.fastAllowed = false;
      notifyCodexNativeFastControls();
    }).finally(() => { if (runtime.pending === operation) runtime.pending = null; });
    runtime.pending = operation;
    return operation;
  }
