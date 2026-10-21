  const codexThreadServiceTierModes = new Set(["inherit", "standard", "fast"]);

  const codexServiceTierControlModes = new Set(["inherit", "global-standard", "global-fast", "custom"]);

  function isFastServiceTierValue(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "fast" || normalized === "priority";
  }

  let codexServiceTierState = {
    status: "loading",
    serviceTier: null,
    configServiceTier: null,
    serviceTierSource: null,
    message: "正在读取…",
    fastTierValue: "priority",
    controlMode: "inherit",
    defaultMode: "inherit",
    activeThreadId: "",
    threadMode: "inherit",
    effectiveServiceTier: null,
    effectiveMode: "standard",
    fastModelName: "",
    fastSupported: false,
  };

  function codexServiceTierDefaultModeForControlMode(controlMode, fallback = "inherit") {
    if (controlMode === "global-fast") return "fast";
    if (controlMode === "global-standard") return "standard";
    if (controlMode === "inherit") return "inherit";
    return normalizeCodexThreadServiceTierMode(fallback);
  }

  function codexServiceTierMaybeLoadModelCatalog(force = false) {
    if (codexModelCatalogPromise) return;
    if (!force && codexModelCatalog.status === "failed") return;
    if (!force && codexModelCatalogLoadedAt && Date.now() - codexModelCatalogLoadedAt < 10000) return;
    loadCodexModelCatalog(force).then(() => {
      refreshCodexServiceTierControls();
    }).catch(() => {
      refreshCodexServiceTierControls();
    });
  }

  function codexServiceTierFastUnsupportedMessage(modelName = codexServiceTierCurrentModelName()) {
    const modelText = modelName ? `当前模型 ${modelName} 不支持` : "当前模型未读取";
    return `Fast 支持 ${codexServiceTierFastModelListLabel()} 或已声明 priority 的模型，${modelText}；可在供应商的模型配置中设置 Fast 支持`;
  }

  function codexServiceTierEffectiveMode(value) {
    return isFastServiceTierValue(value) ? "fast" : "standard";
  }

  function codexServiceTierValueForControlMode(controlMode, threadMode = "inherit", defaultMode = "inherit") {
    if (controlMode === "global-fast") return codexFastServiceTierValue();
    if (controlMode === "global-standard") return null;
    if (controlMode === "custom") return codexServiceTierValueForMode(codexServiceTierEffectiveThreadMode(threadMode, defaultMode));
    return codexServiceTierInheritedValue();
  }

  function codexServiceTierFastModelListLabel() {
    return Array.from(codexServiceTierSupportedFastModels).join(" / ");
  }

  const codexServiceTierReadTimeoutMs = 5000;

  async function getCodexServiceTierSetting() {
    try {
      const read = (async () => {
        const settingStorage = await codexSettingStorageModule();
        return await settingStorage.n(codexDefaultServiceTierSetting);
      })();
      return await Promise.race([
        read,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Codex 应用设置读取超时")), codexServiceTierReadTimeoutMs)),
      ]);
    } catch (error) {
      if (typeof codexStateCall === "function") {
        const fallbackRead = codexStateCall("get-setting", { params: { key: codexDefaultServiceTierSetting.key } });
        const result = await Promise.race([
          fallbackRead,
          new Promise((_, reject) => setTimeout(() => reject(error), codexServiceTierReadTimeoutMs)),
        ]);
        return result && Object.prototype.hasOwnProperty.call(result, "value") ? result.value : codexDefaultServiceTierSetting.default;
      }
      throw error;
    }
  }

  function codexFastServiceTierValue() {
    return codexServiceTierState.fastTierValue || codexServiceTierFallbackFastValue;
  }

  function codexServiceTierInheritedValue() {
    if (codexServiceTierState.serviceTier != null) return codexServiceTierState.serviceTier;
    return codexServiceTierState.configServiceTier ?? null;
  }

  function codexServiceTierEffectiveThreadMode(threadMode = "inherit", defaultMode = "inherit") {
    const normalizedThreadMode = normalizeCodexThreadServiceTierMode(threadMode);
    if (normalizedThreadMode !== "inherit") return normalizedThreadMode;
    return normalizeCodexThreadServiceTierMode(defaultMode);
  }

  function codexServiceTierValueForMode(mode) {
    if (mode === "fast") return codexFastServiceTierValue();
    if (mode === "standard") return null;
    return codexServiceTierInheritedValue();
  }

  const codexDefaultServiceTierSetting = { key: "default-service-tier", default: null };

  const codexServiceTierFallbackFastValue = "priority";

