  // 完整版鲸鱼由上游原始引擎 + Codex 数据适配层组成；默认关闭。
  window.__alunixaXWhaleWidgetRuntime?.dispose?.();
  const alunixaXWhaleState = { disposed: false, runtime: null, profile: "", missingSource: false, failedUntil: 0, notice: null };
  function alunixaXWhaleEnabled() {
    return !alunixaXWhaleState.disposed && alunixaXBackendSettingsLoaded && alunixaXSettings().whaleWidget === true;
  }
  function alunixaXWhaleStop() {
    alunixaXWhaleState.runtime?.dispose();
    alunixaXWhaleState.runtime = null;
    alunixaXWhaleState.notice?.remove(); alunixaXWhaleState.notice = null;
  }
  function alunixaXWhaleInitializationFailed(runtime) {
    runtime?.dispose(); alunixaXWhaleState.runtime = null; alunixaXWhaleState.failedUntil = Date.now() + 10000;
    if (alunixaXWhaleState.notice) return;
    const notice = document.createElement("div"); notice.setAttribute("data-alunixa-x-ext", "whale-widget"); notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483600;max-width:320px;padding:12px;border-radius:10px;background:#fff5ec;color:#7c3218;font:12px/1.6 system-ui;box-shadow:0 3px 16px #0002";
    notice.textContent = "鲸鱼挂件暂时无法加载，10 秒后自动重试。可在 Alunixa X 增强设置关闭后重新开启。";
    document.body.appendChild(notice); alunixaXWhaleState.notice = notice;
  }
  function alunixaXWhaleProfileFingerprint() {
    const profile = codexRemoteSessionActiveProfile?.();
    const settings = alunixaXBackendSettings || {};
    return JSON.stringify([profile?.id || "", profile?.relayMode || "", settings.codexAppWhaleBalanceProtocol,
      settings.codexAppWhaleBalancePath, settings.codexAppWhaleBalanceField, settings.codexAppWhaleBalanceCurrency,
      settings.codexAppWhaleBalanceScale]);
  }
  function syncCodexPlusWhaleWidget() {
    if (!alunixaXWhaleEnabled()) { alunixaXWhaleStop(); alunixaXWhaleState.failedUntil = 0; return; }
    const profile = alunixaXWhaleProfileFingerprint();
    if (alunixaXWhaleState.profile !== profile) { alunixaXWhaleStop(); alunixaXWhaleState.failedUntil = 0; }
    alunixaXWhaleState.profile = profile;
    if (alunixaXWhaleState.runtime) {
      alunixaXWhaleState.runtime.context();
      alunixaXWhaleState.runtime.subscribe();
      alunixaXWhaleState.runtime.pause(document.hidden === true);
      return;
    }
    // 隐藏窗口等恢复可见后再挂载，不在后台构造音频或轮询会话日志。
    if (document.hidden) return;
    if (Date.now() < alunixaXWhaleState.failedUntil) return;
    if (typeof window.__ALUNIXA_X_WHALE_ENGINE__ !== "function") {
      if (!alunixaXWhaleState.missingSource) console.warn("[Alunixa X] 完整鲸鱼运行时未随启动器加载，请重新构建启动器。");
      alunixaXWhaleState.missingSource = true; alunixaXWhaleInitializationFailed(null); return;
    }
    const runtime = createCodexPlusWhaleFullRuntime();
    alunixaXWhaleState.runtime = runtime;
    registerCodexPlusExtensionSelector("[data-alunixa-x-ext=whale-widget]");
    void runtime.initialize().then(() => {
      if (runtime.active() && alunixaXWhaleState.runtime === runtime && alunixaXWhaleEnabled()) {
        window.__ALUNIXA_X_WHALE_ENGINE__(...runtime.environment);
        if (runtime.state.initializationError || !runtime.state.controls) throw new Error("完整鲸鱼初始化未完成");
        alunixaXWhaleState.notice?.remove(); alunixaXWhaleState.notice = null;
      }
    }).catch((error) => {
      if (!runtime.active()) return;
      if (alunixaXWhaleState.runtime === runtime) alunixaXWhaleInitializationFailed(runtime);
    });
  }
  window.__alunixaXWhaleWidgetRuntime = {
    version: 3,
    sync: syncCodexPlusWhaleWidget,
    dispose() { alunixaXWhaleStop(); alunixaXWhaleState.disposed = true; },
    get state() { return alunixaXWhaleState.runtime?.state || null; },
  };
