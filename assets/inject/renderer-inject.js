(() => {
  // The launcher targets the Codex app page, but keep a renderer-side guard
  // so this bundle cannot create UI in embedded browser documents.
  const alunixaXIsNodeTestHarness = typeof process === "object" && !!process.versions?.node;
  if (!alunixaXIsNodeTestHarness && (window.top !== window || window.self !== window || !window.electronBridge || !/^app:\/\/\-\//i.test(window.location.href))) return;
  const alunixaXIsWindowsPlatform = /\bWindows\b/i.test(navigator.userAgent || "");

  // 撤下强制语言后的单次迁移：只撤回仍由旧版管理的设置，不干预用户后来选择的语言。
  async function restoreCodexPlusManagedLocale() {
    const managedKey = "alunixaX.forceChineseLocale.managed.v1";
    const reloadKey = "alunixaX.forceChineseLocale.reload.v1";
    let marker;
    let managed;
    try {
      marker = window.localStorage.getItem(managedKey);
      if (!marker) return true;
      managed = JSON.parse(marker);
      if (!managed || Array.isArray(managed) || typeof managed.appliedLocale !== "string" || !managed.appliedLocale) return false;
    } catch {
      return false;
    }
    if (window.__alunixaXRetiredLocaleCleanupPromise) return await window.__alunixaXRetiredLocaleCleanupPromise;
    const restore = async () => {
      try {
        const response = await codexStateCall("get-setting", { params: { key: "localeOverride" } });
        if (!response || !Object.prototype.hasOwnProperty.call(response, "value")) return false;
        if (window.localStorage.getItem(managedKey) !== marker) return false;
        if (response.value === managed.appliedLocale) {
          const previousValue = managed.previousValue ?? null;
          if (previousValue !== null) {
            if (typeof previousValue !== "string" || previousValue.length > 64 || previousValue.trim() !== previousValue) return false;
            if (Intl.getCanonicalLocales(previousValue).length !== 1) return false;
          }
          await codexStateCall("set-setting", { params: { key: "localeOverride", value: previousValue } });
        }
        if (window.localStorage.getItem(managedKey) !== marker) return false;
        window.sessionStorage.removeItem(reloadKey);
        window.sessionStorage.removeItem("alunixaX.forceChineseLocale.reload.v2");
        window.localStorage.removeItem(managedKey);
        return true;
      } catch {
        // 原生 API 或存储暂时不可用时保留标记，下一次注入继续撤回。
        return false;
      }
    };
    const pending = restore();
    window.__alunixaXRetiredLocaleCleanupPromise = pending;
    try {
      return await pending;
    } finally {
      if (window.__alunixaXRetiredLocaleCleanupPromise === pending) delete window.__alunixaXRetiredLocaleCleanupPromise;
    }
  }

  const helperBase = window.__CODEX_SESSION_DELETE_HELPER__ || "http://127.0.0.1:57321";
  const buttonClass = "codex-delete-button";
  const exportButtonClass = "codex-export-button";
  const actionButtonClass = "codex-session-action-button";
  const actionGroupClass = "codex-session-actions";
  const moreButtonClass = "codex-session-more-button";
  const moreMenuClass = "codex-session-more-menu";
  const actionTooltipClass = "codex-session-action-tooltip";
  const threadIdBadgeClass = "codex-thread-id-badge";
  const conversationViewMinWidth = 320;
  const conversationViewMaxAllowedWidth = 4000;
  const conversationViewDefaultWidth = 900;
  const conversationViewLegacyWidthKey = "alunixaX.threadCenter.maxWidth";
  // 已发布的旧类名保留兼容；对应功能不再安装。
  const zedRemoteButtonClass = "codex-zed-remote-button";
  const zedRemoteOpenInMenuItemClass = "codex-zed-open-in-menu-item";
  const sessionCopyMenuItemClass = "codex-session-copy-menu-item";
  const sessionCopyMenuItemVersion = "1";
  const sessionCopyMenuActivationTimeoutMs = 12000;
  const sessionShareButtonClass = "codex-session-share-button";
  const sessionShareButtonVersion = "1";
  const alunixaXShareBaseUrl = "https://share.codexpp.cc";
  const alunixaXShareFallbackBaseUrl = "https://codexpp-share.pages.dev";
  const alunixaXShareMaxCharacters = 900000;
  const sessionAutoRenameTimeoutMs = 20000;
  const zedRemoteToastClass = "codex-zed-remote-toast";
  const upstreamWorktreeDialogClass = "codex-upstream-worktree-dialog";
  const upstreamBranchOptionAttribute = "data-codex-upstream-branch-option";
  const styleId = "codex-delete-style";
  // 改 10-style.js 里的任何 CSS 都要把它 +1：installStyle 靠这个版本号判断
  // 页面里已有的 <style> 是否过期，不升的话新样式在旧标签存在时会被直接跳过。
  const codexDeleteStyleVersion = "32";
  const alunixaXMenuId = "alunixa-x-menu";
  const alunixaXMenuFloatingClass = "alunixa-x-menu-floating";
  const alunixaXSidebarNavId = "alunixa-x-sidebar-nav";
  const alunixaXPageClass = "alunixa-x-page-overlay";
  // 新版 Codex 在最左侧多出一条导航图标栏（navigation rail）。
  // 三个入口分别挂进去：Alunixa X 主页、「拓展」（原用户脚本）和「推荐内容」。
  // 三者各自是一个独立页面，不再作为弹窗里的二级 tab。
  const alunixaXRailNavId = "alunixa-x-rail-nav";
  const alunixaXRailExtensionsId = "alunixa-x-rail-extensions";
  const alunixaXRailSponsorId = "alunixa-x-rail-sponsor";
  const alunixaXRailPluginMarketId = "alunixa-x-rail-plugin-market";
  const alunixaXSidebarPluginMarketId = "alunixa-x-sidebar-plugin-market";
  const alunixaXPluginMarketTab = "plugin-market";
  const alunixaXRailSelector = "nav[data-app-navigation-rail]";
  const alunixaXRailDestinationSelector = "[data-sidebar-destination]";
  const alunixaXExtensionsTab = "extensions";
  const alunixaXSponsorTab = "sponsor";
  // Codex 的界面缩放是给内层布局节点设 CSS zoom，不是改 documentElement。
  // 我们的 overlay 挂在 body 下、落在那棵缩放子树之外，只能自己读这个变量跟随。
  const alunixaXWindowZoomVar = "--codex-window-zoom";
  const codexDeleteVersion = "7";
  const codexExportVersion = "1";
  const codexActionGroupVersion = "6";
  const codexArchiveRowActionsVersion = "1";
  const codexArchiveDeleteAllVersion = "2";
  const codexConversationViewVersion = "1";
  const codexThreadScrollVersion = "1";
  const codexThreadIdBadgeVersion = "1";
  const codexThreadServiceTierVersion = "1";
  const codexServiceTierBadgeClass = "codex-service-tier-badge";
  const codexServiceTierBadgeVersion = "3";
  let alunixaXVersion = window.__ALUNIXA_X_VERSION__ || "unknown";
  const alunixaXBuild = window.__ALUNIXA_X_BUILD__ || "unknown";
  let lastSessionActionTrigger = null;
  const alunixaXSettingsKey = "alunixaXSettings";
  const codexThreadScrollKey = "codexThreadScroll";
  const codexThreadServiceTierKey = "codexThreadServiceTierOverrides";
  const codexThreadServiceTierMaxEntries = 120;
  const codexThreadServiceTierDraftBindWindowMs = 60 * 1000;
  const codexServiceTierRequestOverrideVersion = "9";
  const codexAppServerModelRequestPatchVersion = "13";
  const codexAppServerClientCaptureMarker = "AppServerRequestClient is missing a message dispatcher";
  const codexAppServerClientCaptureAnchor = "async sendRequest(";
  const codexRemoteSessionRecoveryVersion = "5";
  const codexPluginMarketplaceUnlockVersion = "17";
  const codexThreadScrollMaxEntries = 120;
  const codexThreadScrollSaveThrottleMs = 120;
  const codexThreadScrollRestoreWindowMs = 3200;
  const codexThreadScrollRestoreDelaysMs = [0, 80, 220, 500, 1000, 1800, 2800];
  const codexThreadScrollUserIntentWindowMs = 1200;
  const codexThreadScrollProgrammaticGuardVersion = "dispatcher:2";
  const codexThreadScrollRouteHooksVersion = "dispatcher:2";
  const codexThreadScrollListenerVersion = "4";
  const codexThreadScrollUserIntentVersion = "dispatcher:2";
  const alunixaXImageOverlayId = "alunixa-x-image-overlay";
  const alunixaXDreamSkinStyleId = "codex-dream-skin-style";
  const alunixaXDreamSkinPlatform = String(window.__ALUNIXA_X_DREAM_SKIN_PLATFORM__ || "macos");
  const alunixaXDreamSkinRevision = String(window.__ALUNIXA_X_DREAM_SKIN_REVISION__ || "1");
  clearTimeout(window.__codexThreadScrollSaveTimer);
  window.__codexThreadScrollSaveTimer = null;
  (window.__codexThreadScrollRestoreTimers || []).forEach((timer) => clearTimeout(timer));
  window.__codexThreadScrollRestoreTimers = [];
  (window.__codexThreadScrollSyncTimers || []).forEach((timer) => clearTimeout(timer));
  window.__codexThreadScrollSyncTimers = [];
  window.__codexThreadScrollRestoreRevision = (window.__codexThreadScrollRestoreRevision || 0) + 1;

  window.__codexThreadScrollSyncRevision = (window.__codexThreadScrollSyncRevision || 0) + 1;
  ["__alunixaXHtmlCenteredThreadWidth", "__alunixaXViewportCenteredThreadWidth", "__alunixaXBoundedThreadCenter"].forEach((key) => {
    try {
      window[key]?.cleanup?.();
    } catch (_) {}
  });
  try {
    window.__alunixaXConversationViewCleanup?.();
  } catch (_) {}
  window.__alunixaXConversationViewCleanup = null;
  const selectors = {
    sidebarThread: "[data-app-action-sidebar-thread-id]",
    threadTitle: "[data-thread-title]",
    appHeader: '[class*="ApplicationMenuTopBar"], .app-header-tint',
    archiveNav: 'button[aria-label="已归档对话"], button[aria-label="Archived conversations"]',
    disabledInstallButton: 'button:disabled, button[aria-disabled="true"], [role="button"][aria-disabled="true"], button[data-disabled], [role="button"][data-disabled], button.cursor-not-allowed, [role="button"].cursor-not-allowed, button.pointer-events-none, [role="button"].pointer-events-none',
    pluginNavButton: 'nav[role="navigation"] button.h-token-nav-row.w-full',
    pluginSvgPath: 'svg path[d^="M7.94562 14.0277"]',
    // 会话视图对齐的目标锚点。全部走 data-* / 结构性写法，不绑 Codex 的哈希类名，
    // 见 90-action-groups.js 的候选链说明（issue #2258）。
    conversationViewScrollContainer: ".thread-scroll-container",
    conversationViewContentAnchor: "[data-thread-user-message-navigation-content]",
    conversationViewFooter: "[data-thread-scroll-footer]",
  };
  const headerContextButtonClass = "border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border-token-border text-token-button-tertiary-foreground bg-token-bg-fog enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border h-token-button-composer px-2 py-0 text-base leading-[18px]";

  function installAlunixaXImageOverlay() {
    const config = window.__ALUNIXA_X_IMAGE_OVERLAY__ || {};
    const source = config.dataUrl || config.sourceUrl || "";
    const signature = JSON.stringify(config);
    const old = window.__alunixaXWallpaperRuntime;
    if (old?.signature === signature && old.element?.isConnected) return;
    old?.cleanup?.();
    if (window.__alunixaXImageOverlayBlobUrl) {
      URL.revokeObjectURL(window.__alunixaXImageOverlayBlobUrl);
      window.__alunixaXImageOverlayBlobUrl = "";
    }
    document.getElementById?.(alunixaXImageOverlayId)?.remove();
    if (!config.enabled || !source) {
      if (config.error) sendAlunixaXDiagnostic("wallpaper_failed", { message: config.error });
      return;
    }
    const root = document?.documentElement;
    if (!root || typeof document?.createElement !== "function") return;
    const opacity = Math.min(1, Math.max(0.01, Number(config.opacity) || 0.35));
    const fitMode = ["fill", "fit", "stretch", "tile", "center"].includes(config.fitMode)
      ? config.fitMode
      : "fit";
    const fitStyles = {
      fill: { size: "cover", position: "center center", repeat: "no-repeat" },
      fit: { size: "contain", position: "center center", repeat: "no-repeat" },
      stretch: { size: "100% 100%", position: "center center", repeat: "no-repeat" },
      tile: { size: "auto", position: "left top", repeat: "repeat" },
      center: { size: "auto", position: "center center", repeat: "no-repeat" },
    }[fitMode];
    const overlay = document.createElement("div");
    overlay.id = alunixaXImageOverlayId;
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      opacity: String(opacity),
      pointerEvents: "none",
      zIndex: "2147483646",
      userSelect: "none",
      overflow: "hidden",
    });
    root.appendChild(overlay);
    let stopped = false;
    let video = null;
    let notice = null;
    let image = null;
    let ready = false;
    let blobUrl = null;
    const reportReady = () => {
      if (stopped || ready) return;
      ready = true;
      sendAlunixaXDiagnostic("wallpaper_ready", { kind: config.kind || "image" });
    };
    const reportFailure = (message) => {
      if (stopped || notice) return;
      sendAlunixaXDiagnostic("wallpaper_failed", { kind: config.kind, message });
      notice = document.createElement("button");
      notice.type = "button";
      notice.textContent = `${message} · ×`;
      notice.setAttribute("role", "status");
      Object.assign(notice.style, { position:"fixed", right:"16px", bottom:"16px", zIndex:"2147483647",
        maxWidth:"420px", padding:"10px 14px", borderRadius:"8px", background:"#252525",
        color:"#fff", border:"1px solid #777", cursor:"pointer", font:"13px system-ui" });
      notice.onclick = () => notice.remove();
      root.appendChild(notice);
    };
    const loadMediaSource = async () => {
      if (config.dataUrl || typeof window.__codexSessionDeleteBridge !== "function") return source;
      const result = await window.__codexSessionDeleteBridge("/wallpaper/media", {});
      if (result?.status !== "ok" || !String(result.sourceUrl || "").startsWith("blob:"))
        throw new Error(result?.message || "壁纸文件无法读取，请重新选择");
      if (stopped) { URL.revokeObjectURL(result.sourceUrl); return ""; }
      blobUrl = result.sourceUrl;
      return blobUrl;
    };
    const syncPlayback = () => {
      if (!video || stopped) return;
      if (document.hidden || config.paused) video.pause();
      else video.play().catch(error => {
        if (!stopped && !document.hidden && !config.paused && error?.name !== "AbortError")
          reportFailure("壁纸播放失败，请检查视频编码或静音设置");
      });
    };
    const cleanup = () => {
      stopped = true;
      document.removeEventListener("visibilitychange", syncPlayback);
      window.removeEventListener("pagehide", cleanup);
      if (image) { image.onload = image.onerror = null; image.src = ""; }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (video) {
        video.pause();
        video.srcObject = null;
        video.removeAttribute("src");
        video.load();
      }
      overlay.remove();
      notice?.remove();
      if (window.__alunixaXWallpaperRuntime?.element === overlay) delete window.__alunixaXWallpaperRuntime;
    };
    window.__alunixaXWallpaperRuntime = { signature, element: overlay, cleanup };
    window.addEventListener("pagehide", cleanup, { once: true });
    if (config.kind === "video") {
      video = document.createElement("video");
      video.autoplay = !config.paused && !document.hidden;
      video.loop = true;
      video.muted = config.muted !== false;
      video.playsInline = true;
      video.preload = "metadata";
      video.disablePictureInPicture = true;
      video.setAttribute("aria-hidden", "true");
      Object.assign(video.style, { width:"100%", height:"100%", pointerEvents:"none",
        objectFit: ({ fill:"cover", stretch:"fill", center:"none", tile:"contain" })[fitMode] || "contain" });
      video.onerror = () => reportFailure("视频无法解码，请使用 MP4（H.264）或 WebM");
      video.onloadedmetadata = syncPlayback;
      video.onloadeddata = reportReady;
      video.onplaying = reportReady;
      overlay.appendChild(video);
      document.addEventListener("visibilitychange", syncPlayback);
      void loadMediaSource().then(url => {
        if (stopped) return;
        video.src = url;
        syncPlayback();
      }).catch(error => reportFailure(error?.message || "壁纸文件读取失败"));
    } else {
      image = new Image();
      image.onload = reportReady;
      image.onerror = () => reportFailure("壁纸图片无法加载，请重新选择有效的图片");
      void loadMediaSource().then(url => {
        if (stopped) return;
        Object.assign(overlay.style, {
          backgroundImage: `url("${url.replace(/"/g, "%22")}")`,
          backgroundSize: fitStyles.size, backgroundPosition: fitStyles.position, backgroundRepeat: fitStyles.repeat,
        });
        image.src = url;
      }).catch(error => reportFailure(error?.message || "壁纸文件读取失败"));
    }
    sendAlunixaXDiagnostic("image_overlay_installed", { opacity, fitMode, kind:config.kind || "image" });
  }

  function scheduleAlunixaXImageOverlay() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", installAlunixaXImageOverlay, { once: true });
      return;
    }
    installAlunixaXImageOverlay();
    setTimeout(installAlunixaXImageOverlay, 250);
  }
  /**
   * 拓展注册中心。
   *
   * 第三方用户脚本通过挂到 window 上的 `alunixaX` 对象注册 UI 项，注册结果
   * 落在这里。注册中心只存数据与回调，不做任何渲染——渲染由各消费方在合适的
   * 时机读表完成。这样「内置项」和「第三方项」不会产生两条代码路径。
   *
   * 生命周期约定（很重要）：
   *   注册表持久，DOM 瞬态。
   *
   * Alunixa X 的 UI 宿主会被反复重建（overlay 每次打开都清空重建、会话行按钮在
   * 版本号变化时整组重建），所以任何消费方都不能缓存 DOM 引用，必须每次从注册
   * 表读数据全量重建。反过来说，第三方脚本不需要关心 DOM 何时被销毁。
   *
   * 注意：注册中心本身不持有 DOM，也不在模块顶层读 DOM，因此可以安全地放在
   * prelude 之后的最前面——此时常量已声明，而所有顶层启动语句都还没执行。
   */
  const alunixaXRegistry = {
    rowActions: new Map(),
    navEntries: new Map(),
    pages: new Map(),
    menuItems: new Map(),
  };

  /** 每个脚本最多注册多少项、全局最多多少项，防止劣质拓展把扫描拖慢。 */
  const alunixaXExtensionPerScriptLimit = 16;
  const alunixaXExtensionGlobalLimit = 64;

  /**
   * 必须被扫描调度忽略的选择器。
   *
   * 这些节点由 Alunixa X 自己（或拓展）插入到 Codex 的容器里，而容器本身是
   * scan-relevant 的。如果不排除，就会形成「写入 → 观察到自己的写入 → 200ms
   * 后再 scan → 再写入」的自喂循环：空闲时也每秒全量扫描五次，macOS 上足以
   * 吃满一个核（issue #1960）。
   *
   * 内置项在这里，拓展项通过 registerCodexPlusExtensionSelector 动态加入。
   * 拓展自带的选择器一律是 `[data-alunixa-x-ext="<脚本 key>"]`，由接口层在
   * 注册时自动加上，拓展作者不需要也不应该自己维护这个列表。
   */
  const alunixaXExtensionSelectors = new Set();
  let alunixaXExtensionSelectorCache = null;

  function registerCodexPlusExtensionSelector(selector) {
    if (typeof selector !== "string" || !selector.trim()) return false;
    if (alunixaXExtensionSelectors.has(selector)) return true;
    if (alunixaXExtensionSelectors.size >= alunixaXExtensionGlobalLimit) {
      return false;
    }
    // 提前验证选择器语法：非法选择器会在 closest() 里抛错，而 closest() 跑在
    // 每次 mutation 上，一个坏选择器能把整个页面卡死。
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      return false;
    }
    alunixaXExtensionSelectors.add(selector);
    alunixaXExtensionSelectorCache = null;
    return true;
  }

  /**
   * 拼给 closest() 用的选择器串。Set 变化时重建、否则复用——closest() 传一个
   * 逗号串比逐个调用快得多，而这里每次 DOM 变更都会走一遍。
   */
  function alunixaXExtensionSelector() {
    if (alunixaXExtensionSelectorCache !== null) return alunixaXExtensionSelectorCache;
    alunixaXExtensionSelectorCache = [...alunixaXExtensionSelectors].join(", ");
    return alunixaXExtensionSelectorCache;
  }

  function isCodexPlusExtensionNode(node) {
    const selector = alunixaXExtensionSelector();
    if (!selector) return false;
    return !!node?.closest?.(selector);
  }

  /**
   * 注册一项通用扩展数据。返回 dispose 函数。
   *
   * 所有类别共用同一套校验与配额，免得每个 register* 各写一遍。`kind` 只用于
   * 诊断与配额统计，不参与渲染。
   */
  function registerCodexPlusExtension(kind, registry, id, definition, scriptKey) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("拓展项 id 不能为空");
    }
    if (registry.has(id)) {
      throw new Error(`拓展项 id 已被占用：${id}`);
    }
    const owned = [...registry.values()].filter((item) => item.scriptKey === scriptKey).length;
    if (owned >= alunixaXExtensionPerScriptLimit) {
      throw new Error(`每个脚本最多注册 ${alunixaXExtensionPerScriptLimit} 项`);
    }
    if (registry.size >= alunixaXExtensionGlobalLimit) {
      throw new Error(`拓展项总数已达上限 ${alunixaXExtensionGlobalLimit}`);
    }
    // 每个类别至少要有一个可调用的钩子，否则注册进来也渲染不出东西。
    // 菜单项的开关形态是 onChange，页面/入口是 render，其余是 onActivate。
    const callbacks = ["render", "onActivate", "onChange", "onCleanup"];
    if (definition && !callbacks.some((name) => typeof definition[name] === "function")) {
      throw new Error(`拓展项 ${id} 必须提供 ${callbacks.join(" / ")} 之一`);
    }
    const order = Number.isFinite(definition?.order) ? Number(definition.order) : 0;
    // 内置项占用 0~999，第三方从 1000 起，避免插到内置项前面破坏既有布局。
    const normalized = { ...definition, kind, id, order: Math.max(1000, order), scriptKey };
    registry.set(id, normalized);
    alunixaXRegistryDiagnostics(kind, "register", id, scriptKey);
    return () => {
      if (registry.get(id) === normalized) {
        registry.delete(id);
        alunixaXRegistryDiagnostics(kind, "dispose", id, scriptKey);
      }
    };
  }

  /** 按 order 排序的注册项快照。消费方每次渲染时取，不要缓存结果。 */
  function alunixaXExtensionItems(registry) {
    return [...registry.values()].sort((left, right) => left.order - right.order);
  }

  function alunixaXRegistryDiagnostics(kind, action, id, scriptKey) {
    const entry = {
      kind,
      action,
      id,
      script_key: scriptKey || "",
      at: Date.now(),
      // 不抛错：诊断通道本身出问题时不该影响注册。
    };
    window.__alunixaXRegistryLog = window.__alunixaXRegistryLog || [];
    window.__alunixaXRegistryLog.push(entry);
    if (window.__alunixaXRegistryLog.length > 200) window.__alunixaXRegistryLog.shift();
    try {
      window.__codexSessionDeleteBridge?.("/diagnostics/log", {
        event: "extension_registry",
        detail: entry,
      })?.catch?.(() => {});
    } catch {}
  }

  /**
   * 带着归属信息执行拓展提供的回调。
   *
   * 拓展代码可能抛错、也可能返回坏数据。这里统一兜住：错误记进该脚本的状态
   * 通道（和用户脚本自身的失败上报同一个字段），并由调用方决定如何降级展示。
   * 返回值约定：成功返回 { ok: true, value }，失败返回 { ok: false, error }。
   */
  function runCodexPlusExtensionCallback(scriptKey, label, callback) {
    try {
      return { ok: true, value: callback() };
    } catch (error) {
      const message = String(error?.stack || error?.message || error);
      alunixaXMarkExtensionFailure(scriptKey, `${label}: ${message}`);
      return { ok: false, error: message };
    }
  }

  /**
   * 把拓展的失败写进用户脚本运行时状态。
   *
   * 复用 wrap_script 已经建立的上报通道：管理页读的就是
   * window.__alunixaXUserScripts.scripts[key].error。这样拓展的 UI 错误和
   * 脚本本身抛错在用户看来是同一件事，不需要第二套排查入口。
   */
  function alunixaXMarkExtensionFailure(scriptKey, message) {
    if (!scriptKey) return;
    const record = window.__alunixaXUserScripts?.scripts?.[scriptKey];
    if (record) {
      record.error = message;
      // 不覆盖 status：脚本本身可能已成功加载，失败的只是它注册的某一项 UI。
      record.extensionError = message;
    }
    window.__alunixaXExtensionFailures = window.__alunixaXExtensionFailures || [];
    window.__alunixaXExtensionFailures.push({ script_key: scriptKey, message, at: Date.now() });
    if (window.__alunixaXExtensionFailures.length > 100) window.__alunixaXExtensionFailures.shift();
  }
  function installStyle() {
    const existingStyle = document.getElementById(styleId);
    if (existingStyle?.dataset.codexDeleteStyleVersion === codexDeleteStyleVersion) return;
    existingStyle?.remove();
    const style = document.createElement("style");
    style.id = styleId;
    style.dataset.codexDeleteStyleVersion = codexDeleteStyleVersion;
    style.textContent = `
      .${actionGroupClass} {
        position: absolute;
        right: var(--codex-session-actions-right, 28px);
        top: 50%;
        transform: translateY(-50%);
        z-index: 20;
        opacity: 0;
        pointer-events: none;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        background: transparent;
      }
      .${actionButtonClass} {
        width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--codex-session-action-color, var(--color-token-text-tertiary, var(--alunixa-x-text-tertiary, rgba(255,255,255,.5))));
        font: 14px/1 system-ui, sans-serif;
        padding: 0;
        cursor: default;
        text-align: center;
      }
      .${actionButtonClass} svg {
        display: block;
        width: 16px;
        height: 16px;
      }
      .${actionButtonClass}:hover,
      .${actionButtonClass}:focus-visible {
        background: var(--codex-session-action-hover-background, transparent);
        color: var(--codex-session-action-hover-color, var(--codex-session-action-color, var(--color-token-text-primary, #f4f4f5)));
        outline: none;
      }
      .${moreMenuClass} {
        position: fixed;
        z-index: 2147483201;
        min-width: 104px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        box-shadow: var(--ui-menu-shadow, var(--shadow-300, 0 8px 24px rgba(0,0,0,.16)));
        padding: 4px;
      }
      .${moreMenuClass}[hidden] { display: none !important; }
      .${moreMenuClass}.codex-session-more-menu-open-up {
        transform: translateY(calc(-100% - 34px));
      }
      .codex-session-more-menu-item {
        width: 100%;
        border: 0;
        border-radius: var(--border-radius-sm, 6px);
        background: transparent;
        color: inherit;
        cursor: default;
        display: flex;
        align-items: center;
        gap: 8px;
        font: inherit;
        font-size: 13px;
        line-height: 18px;
        padding: 6px 8px;
        text-align: left;
      }
      .codex-session-more-menu-item:hover,
      .codex-session-more-menu-item:focus-visible {
        background: var(--alunixa-x-bg-hover);
        outline: none;
      }
      .codex-session-more-menu-icon {
        width: 16px;
        text-align: center;
      }
      .${threadIdBadgeClass} {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        max-width: 152px;
        margin-right: 8px;
        color: var(--text-secondary, var(--color-token-text-secondary, var(--alunixa-x-text-secondary, rgba(142,142,160,.95))));
        font: 11px/1.1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        letter-spacing: .01em;
        opacity: .9;
        white-space: nowrap;
        user-select: text;
      }
      ${selectors.sidebarThread} [data-codex-thread-id-badge-wrap="true"] {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        max-width: 100%;
      }
      ${selectors.sidebarThread} [data-codex-thread-id-badge-wrap="true"] ${selectors.threadTitle},
      ${selectors.sidebarThread} [data-codex-thread-id-badge-wrap="true"] .truncate.select-none,
      ${selectors.sidebarThread} [data-codex-thread-id-badge-wrap="true"] .truncate.text-base {
        min-width: 0;
      }
      .codex-archive-row-button {
        border: 1px solid var(--color-token-border-light, var(--color-token-border-default, rgba(0,0,0,.12)));
        border-radius: var(--border-radius-sm, 6px);
        background: var(--color-token-bg-secondary, transparent);
        color: var(--color-token-text-secondary, inherit);
        font: inherit;
        font-size: 13px;
        line-height: 16px;
        padding: 3px 8px;
        cursor: pointer;
      }
      .codex-archive-row-button.${buttonClass} {
        border-color: var(--color-border-danger, #dc2626);
        background: var(--color-background-danger-soft, rgba(220,38,38,.1));
        color: var(--color-text-danger, #dc2626);
      }
      .codex-archive-row-button.${exportButtonClass} {
        border-color: var(--color-token-border-light, var(--color-token-border-default, rgba(0,0,0,.12)));
        background: var(--color-token-bg-secondary, transparent);
        color: var(--color-token-text-primary, inherit);
      }
      .${sessionCopyMenuItemClass} {
        cursor: pointer;
      }
      .${sessionShareButtonClass} {
        position: static;
        flex: 0 0 auto;
        pointer-events: auto;
        -webkit-app-region: no-drag;
        margin-left: 2px;
        z-index: 2147483001;
        min-height: var(--height-button-composer, 32px);
        border-radius: var(--border-radius-lg, 8px);
        font: inherit;
        font-size: 13px;
        line-height: 18px;
        cursor: pointer;
        box-shadow: none;
      }
      .${sessionShareButtonClass}:hover,
      .${sessionShareButtonClass}:focus-visible {
        background: var(--color-token-list-hover-background, var(--alunixa-x-bg-hover));
        color: var(--color-token-text-primary, var(--alunixa-x-text));
        outline: none;
      }
      .${sessionShareButtonClass}[aria-busy="true"] {
        cursor: wait;
        opacity: .65;
      }
      [data-codex-delete-row="true"]:hover .${actionGroupClass} {
        opacity: 1;
        pointer-events: auto;
      }
      [data-codex-delete-row="true"]:hover ${selectors.threadTitle},
      [data-codex-delete-row="true"]:focus-within ${selectors.threadTitle},
      [data-codex-delete-row="true"].codex-session-more-open ${selectors.threadTitle} {
        flex: 0 1 auto;
        width: var(--codex-session-title-max-width, auto);
        max-width: var(--codex-session-title-max-width, 100%);
        overflow: hidden;
      }
      [data-codex-delete-row="true"].codex-session-more-open .${actionGroupClass} {
        opacity: 1;
        pointer-events: auto;
        z-index: 2147483201;
      }
      [data-codex-delete-row="true"].codex-archive-confirm-visible .${actionGroupClass} {
        right: max(66px, var(--codex-session-actions-right, 28px));
      }
      .${actionTooltipClass} {
        position: fixed;
        z-index: 2147483201;
        max-width: min(220px, calc(100vw - 32px));
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-md, 6px);
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        line-height: 16px;
        padding: 6px 8px;
        box-shadow: var(--tooltip-box-shadow, var(--shadow-200, 0 4px 12px rgba(0,0,0,.14)));
        pointer-events: none;
        white-space: nowrap;
      }
      .codex-archive-delete-all {
        border: 1px solid var(--color-border-danger, #dc2626);
        border-radius: var(--border-radius-sm, 6px);
        background: var(--color-background-danger-soft, rgba(220,38,38,.1));
        color: var(--color-text-danger, #dc2626);
        font: inherit;
        font-size: 13px;
        line-height: 16px;
        padding: 3px 8px;
        cursor: pointer;
      }
      .codex-archive-action-bar {
        position: fixed;
        right: 28px;
        top: 86px;
        z-index: 2147482999;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
      }
      .codex-delete-toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483000;
        padding: 10px 12px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        box-shadow: var(--ui-menu-shadow, var(--shadow-300, 0 8px 24px rgba(0,0,0,.16)));
        pointer-events: none;
      }
      .codex-delete-toast button { margin-left: 10px; pointer-events: auto; }
      /* 拓展与内置提示共用的类型配色。不传 type 时保持上面的默认外观。 */
      .codex-delete-toast[data-toast-type="success"] { border-color: var(--alunixa-x-success, #2f9e63); }
      .codex-delete-toast[data-toast-type="warn"] { border-color: var(--alunixa-x-warn, #b7791f); }
      .codex-delete-toast[data-toast-type="error"] { border-color: var(--alunixa-x-error, #c53030); }
      .codex-delete-confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483200;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--modal-backdrop-dim-shadow, rgba(0,0,0,.32));
        backdrop-filter: blur(1px);
      }
      .codex-delete-confirm-content {
        width: min(420px, calc(100vw - 48px));
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-xl, 12px);
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 14px;
        box-shadow: var(--shadow-400, 0 16px 48px rgba(0,0,0,.2));
        padding: 20px;
      }
      .codex-delete-confirm-title { font-size: 16px; font-weight: 650; }
      .codex-delete-confirm-message { margin-top: 8px; color: var(--alunixa-x-text-secondary); line-height: 1.45; }
      .codex-delete-confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 18px;
      }
      .codex-delete-confirm-actions button {
        min-height: 32px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        padding: 5px 12px;
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .codex-delete-confirm-actions button:hover,
      .codex-delete-confirm-actions button:focus-visible {
        background: var(--alunixa-x-bg-hover);
        outline: none;
      }
      .codex-delete-confirm-actions [data-codex-delete-confirm="true"] {
        border-color: var(--color-border-danger, #dc2626);
        background: var(--color-background-danger-solid, #dc2626);
        color: var(--color-text-danger-solid, #fff);
      }
      .alunixa-x-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        /*
         * overlay 自身带 zoom（见 applyCodexPlusZoom），而它的 inset: 0 与 100vw
         * 都按未缩放的视口算，再乘 zoom 就溢出（实测 zoom=1.2 时 100vw 得到 2072px，
         * 视口只有 1727px）。用 calc(100vw / var(--alunixa-x-zoom)) 抵消；zoom 缺失
         * 时分母回落到 1，行为与改造前一致。
         * 内部子元素用百分比即可——它们在缩放空间里，百分比本来就对。
         * 注意：本段在 JS 模板字符串里，注释中不能出现反引号，否则会提前闭合。
         */
        width: calc(100vw / var(--alunixa-x-zoom, 1));
        height: calc(100vh / var(--alunixa-x-zoom, 1));
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--modal-backdrop-dim-shadow, rgba(0,0,0,.32));
        backdrop-filter: blur(1px);
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      .alunixa-x-modal-content {
        width: min(520px, calc(100% - 48px));
        max-height: min(680px, calc(100% - 40px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-xl, 12px);
        background: var(--alunixa-x-bg-primary);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 14px;
        box-shadow: var(--shadow-400, 0 16px 48px rgba(0,0,0,.2));
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      .alunixa-x-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px 8px;
        flex: 0 0 auto;
        -webkit-app-region: no-drag;
      }
      .alunixa-x-modal-title { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; }
      .alunixa-x-backend-indicator { width: 8px; height: 8px; border-radius: 999px; background: var(--alunixa-x-text-tertiary); display: inline-block; }
      .alunixa-x-backend-indicator[data-status="ok"] { background: var(--alunixa-x-success); }
      .alunixa-x-backend-indicator[data-status="failed"] { background: var(--alunixa-x-danger); }
      .alunixa-x-backend-indicator[data-status="checking"] { background: var(--alunixa-x-warning); }
      .alunixa-x-backend-indicator[data-status="degraded"] { background: var(--alunixa-x-warning); }
      #${alunixaXSidebarNavId} {
        position: relative;
        flex: 0 0 auto;
      }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-icon {
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-icon svg {
        width: 19px;
        height: 19px;
        display: block;
      }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status {
        width: 7px;
        height: 7px;
        margin-left: auto;
        border-radius: 999px;
        background: #a1a1aa;
        opacity: .9;
      }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="ok"] {
        background: #34d399;
        box-shadow: 0 0 7px rgba(52,211,153,.7);
      }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="failed"] { background: #ef4444; }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="checking"] { background: #fbbf24; }
      #${alunixaXSidebarNavId} button[data-active="true"] {
        background: var(--alunixa-x-bg-selected);
        color: var(--alunixa-x-text);
      }
      .alunixa-x-plugin-sidebar { position: relative; flex: 0 0 auto; }
      .alunixa-x-plugin-sidebar .alunixa-x-sidebar-nav-icon { width: 20px; height: 20px; flex: 0 0 20px; display: inline-flex; align-items: center; justify-content: center; }
      .alunixa-x-plugin-sidebar .alunixa-x-sidebar-nav-icon svg { width: 19px; height: 19px; }
      .alunixa-x-plugin-sidebar-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
      .alunixa-x-plugin-sidebar button[data-active="true"] { background: var(--alunixa-x-bg-selected); color: var(--alunixa-x-text); }
      .alunixa-x-plugin-market-panel { max-width: 1140px; width: 100%; margin: 0 auto; box-sizing: border-box; }
      .alunixa-x-plugin-intro { margin: 0 0 18px; color: var(--alunixa-x-text-secondary); font-size: 13px; line-height: 1.6; }
      .alunixa-x-plugin-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 14px; }
      .alunixa-x-plugin-sources { display: flex; gap: 4px; flex: 1 1 auto; }
      .alunixa-x-plugin-sources button { border: 1px solid var(--alunixa-x-border); border-radius: 7px; padding: 7px 12px; color: var(--alunixa-x-text-secondary); background: transparent; cursor: pointer; }
      .alunixa-x-plugin-sources button[data-active="true"] { background: var(--alunixa-x-bg-selected); color: var(--alunixa-x-text); }
      .alunixa-x-plugin-search { flex: 1 1 240px; min-width: 120px; border: 1px solid var(--alunixa-x-border); border-radius: 8px; background: var(--alunixa-x-bg-secondary); color: var(--alunixa-x-text); padding: 9px 12px; font-size: 14px; }
      .alunixa-x-plugin-filter { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--alunixa-x-text-secondary); }
      .alunixa-x-plugin-status { font-size: 12px; color: var(--alunixa-x-text-secondary); white-space: pre-wrap; margin-bottom: 14px; }
      .alunixa-x-plugin-results { display: flex; flex-direction: column; gap: 10px; }
      .alunixa-x-plugin-card { display: flex; align-items: flex-start; gap: 18px; padding: 16px; border: 1px solid var(--alunixa-x-border); border-radius: 10px; background: var(--alunixa-x-bg-secondary); }
      .alunixa-x-plugin-card-info { flex: 1 1 auto; min-width: 0; }
      .alunixa-x-plugin-name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
      .alunixa-x-plugin-id, .alunixa-x-plugin-meta { color: var(--alunixa-x-text-tertiary); font-size: 11px; margin-top: 4px; overflow-wrap: anywhere; }
      .alunixa-x-plugin-description { color: var(--alunixa-x-text-secondary); font-size: 13px; line-height: 1.55; margin: 7px 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
      .alunixa-x-plugin-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
      .alunixa-x-plugin-tags span { border-radius: 5px; padding: 2px 6px; background: var(--alunixa-x-bg-selected); color: var(--alunixa-x-text-secondary); font-size: 10px; overflow-wrap: anywhere; }
      .alunixa-x-plugin-install { flex: 0 0 auto; white-space: nowrap; }
      .alunixa-x-plugin-market-page button:disabled { opacity: .55; cursor: default; }
      .alunixa-x-plugin-job-message { font-size: 12px; color: var(--alunixa-x-text-secondary); margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .alunixa-x-plugin-job-message[data-status="failed"] { color: var(--alunixa-x-danger); }
      .alunixa-x-plugin-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 20px; font-size: 12px; color: var(--alunixa-x-text-secondary); }
      .alunixa-x-plugin-pagination > span { margin-right: auto; }
      .alunixa-x-plugin-empty { padding: 40px 16px; text-align: center; color: var(--alunixa-x-text-secondary); }
      @media (max-width: 600px) { .alunixa-x-plugin-card { flex-direction: column; gap: 10px; } .alunixa-x-plugin-install { align-self: flex-end; } }
      /*
       * 新版导航图标栏里的 Alunixa X / 拓展 / 推荐内容入口：原生按钮只放图标，
       * 这里对齐它的尺寸。
       *
       * 用 [data-alunixa-x-rail] 而不是逐个列 id——早先按 id 写，加第三个入口时
       * 漏掉了对应的选择器，那个图标容器就没有 20px 约束、撑成整个按钮宽，
       * 表现为图标偏左不居中。
       */
      [data-alunixa-x-rail] {
        position: relative;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      [data-alunixa-x-rail] > button {
        position: relative;
      }
      [data-alunixa-x-rail] .alunixa-x-rail-icon {
        width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      [data-alunixa-x-rail] .alunixa-x-rail-icon svg {
        width: 19px;
        height: 19px;
        display: block;
      }
      /* 图标栏是纯图标，状态点挂在按钮右上角，不占布局。 */
      #${alunixaXRailNavId} .alunixa-x-sidebar-nav-status {
        position: absolute;
        top: 2px;
        right: 2px;
        margin-left: 0;
        width: 6px;
        height: 6px;
      }
      /*
       * 我们的页面是叠加在 Codex 之上的，Codex 并不知道，所以它自己那个
       * destination 的选中态会一直留着，看起来像 rail 上同时亮两个。
       * 页面打开时给根节点打标记，用 CSS 把原生选中项压成未选中；
       * 关掉页面即移除标记，原生状态自动恢复——比改它的按钮属性稳，
       * 不会和 React 的重渲染打架。
       * 颜色取自当前主题下真实未选中项（见 syncCodexPlusRailNativeSelection），
       * 主题切换时下次同步会重算。
       */
      html[data-alunixa-x-page-open] nav[data-app-navigation-rail] [data-sidebar-destination][aria-current="page"] {
        color: var(--alunixa-x-rail-dim, var(--alunixa-x-text-tertiary, currentColor)) !important;
      }
      html[data-alunixa-x-page-open] nav[data-app-navigation-rail] [data-sidebar-destination][aria-current="page"]::before {
        opacity: 0 !important;
      }
      html[data-alunixa-x-page-open] nav[data-app-navigation-rail] [data-sidebar-destination][aria-current="page"] * {
        color: var(--alunixa-x-rail-dim, var(--alunixa-x-text-tertiary, currentColor)) !important;
      }
      /*
       * 页面 overlay 的 left 由 positionCodexPlusPage 按图标栏右边界算好写进来。
       *
       * 关键：写进来的必须是**布局坐标**（视觉值 / zoom），因为 overlay 自己在缩放
       * 空间里布局，宽度也要用同一个空间的量。width 的 calc(100vw / zoom - left - right)
       * 把右边贴到原生内容区的右边缘；三个量都除过 zoom，缩放后才正好补齐。
       * 注意：本段在 JS 模板字符串里，注释里不能出现反引号，否则会提前闭合。
       *
       * 右/下各留一圈槽（原生是 4px）并给四角加圆角，对齐官方面板的观感：
       * 官方页面面板 [_PageSurface_] 的 rect 与我们这块 overlay 完全相同（都是
       * [52, 44, 1663, 940]），四角 12px；它外面套了一个 padding: 0 4px 4px 0 的槽，
       * 右、下能看到底色。我们原先 right/bottom 贴 0 且无圆角，于是方角并且比官方
       * 多占 4px，用户反馈「少一个圆角」就是这个。
       * 圆角值由 positionCodexPlusPage 量官方面板写入，四个角一起用，不做左右区分。
       * overflow: hidden 让圆角真正裁到内容；内容都在 .alunixa-x-modal-content 内，
       * 没有依赖溢出显示的全屏浮层，切掉是安全的。
       */
      .${alunixaXPageClass} {
        position: fixed;
        top: var(--alunixa-x-page-top, 0px);
        right: var(--alunixa-x-page-right, 0px);
        bottom: var(--alunixa-x-page-bottom, 0px);
        left: var(--alunixa-x-page-left, 0px);
        width: calc(100vw / var(--alunixa-x-zoom, 1) - var(--alunixa-x-page-left, 0px) - var(--alunixa-x-page-right, 0px));
        height: calc(100vh / var(--alunixa-x-zoom, 1) - var(--alunixa-x-page-top, 0px) - var(--alunixa-x-page-bottom, 0px));
        border-radius: var(--alunixa-x-page-radius, 0px);
        overflow: hidden;
        z-index: 2147483644;
        display: block;
        background: var(--alunixa-x-bg-primary, #fff);
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      .${alunixaXPageClass} .alunixa-x-modal-content {
        width: auto;
        height: 100%;
        max-height: none;
        border: 0;
        border-radius: 0;
        background: var(--alunixa-x-bg-primary, #fff);
        box-shadow: none;
      }
      .${alunixaXPageClass} .alunixa-x-modal-header {
        width: 100%;
        margin: 0;
        padding: 16px 24px 10px;
      }
      .${alunixaXPageClass} .alunixa-x-modal-body {
        width: 100%;
        margin: 0;
        padding: 4px 32px 32px;
      }
      /* 两栏：左侧自己的面板（导航 / 列表），右侧内容区。观感对齐 Codex 原生页面。 */
      .${alunixaXPageClass} .alunixa-x-page-layout {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
      }
      .${alunixaXPageClass} .alunixa-x-page-nav {
        width: 260px;
        flex: 0 0 260px;
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-right: 1px solid var(--alunixa-x-border-subtle);
      }
      .${alunixaXPageClass} .alunixa-x-page-nav-header {
        flex: 0 0 auto;
        padding: 4px 16px 10px;
      }
      .${alunixaXPageClass} .alunixa-x-page-nav-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--alunixa-x-text);
      }
      .${alunixaXPageClass} .alunixa-x-page-nav-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 4px 10px 16px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,.28) transparent;
        /*
         * 左面板是导航/列表，不是内容：拖动时不该把条目文字或分组标题选蓝
         * （列表项本来就是整行可点，选中态由 data-active 表达）。
         * 右侧详情区不设，那里的描述文字要能复制。
         */
        user-select: none;
        -webkit-user-select: none;
      }
      .${alunixaXPageClass} .alunixa-x-page-main {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .alunixa-x-page-nav-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .alunixa-x-page-nav-item:hover { background: var(--alunixa-x-bg-hover); }
      .alunixa-x-page-nav-item[data-active="true"] {
        background: var(--alunixa-x-bg-selected);
        color: var(--alunixa-x-text);
      }
      .alunixa-x-page-nav-item-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .alunixa-x-page-nav-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .alunixa-x-page-nav-item-meta { font-size: 13px; color: var(--alunixa-x-text-tertiary); }
      .alunixa-x-page-nav-item-state {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--alunixa-x-text-tertiary);
      }
      .alunixa-x-page-nav-item-state[data-state="on"] { background: #34d399; }
      /* 拓展条目：三行结构（名称 / 简介 / 作者+操作），对齐 VSCode 扩展列表的 .extension-list-item */
      .alunixa-x-page-nav-item .alunixa-x-extensions-item-body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        /* VSCode 的 .details 垂直居中，条目高矮不一时文字块不贴顶 */
        justify-content: center;
        overflow: hidden;
      }
      .alunixa-x-extensions-item-header {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .alunixa-x-extensions-icon {
        flex: 0 0 auto;
        display: flex;
        align-items: flex-start;
        padding-top: 10px;
        color: var(--alunixa-x-text-secondary);
      }
      .alunixa-x-extensions-icon svg { width: 40px; height: 40px; display: block; }
      /* 市场清单给的图标：正方形等比缩放，圆角与 VSCode 的扩展图标一致 */
      .alunixa-x-extensions-icon .alunixa-x-extensions-icon-img {
        width: 40px;
        height: 40px;
        display: block;
        object-fit: contain;
        border-radius: 6px;
      }
      .alunixa-x-page-nav-item[data-active="true"] .alunixa-x-extensions-icon { color: var(--alunixa-x-text); }
      /* 名称：VSCode 用 semiBold，且 hover 才加下划线 */
      .alunixa-x-extensions-item-name {
        flex: 1 1 auto;
        min-width: 0;
        font-weight: 600;
        color: var(--alunixa-x-text);
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .alunixa-x-page-nav-item:hover .alunixa-x-extensions-item-name { text-decoration: underline; }
      .alunixa-x-extensions-item-description {
        margin-top: 2px;
        padding-right: 8px;
        color: var(--alunixa-x-text-tertiary);
        font-size: 13px;
        line-height: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      /* 底部行：作者在左、操作在右，VSCode 的 .footer 是 24px 高 */
      .alunixa-x-extensions-item-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        min-height: 24px;
        padding-top: 2px;
      }
      .alunixa-x-extensions-item-publisher {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 600;
        color: var(--alunixa-x-text-tertiary);
      }
      .alunixa-x-extensions-item-actions { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; }
      /* 行内按钮：默认低调，hover 整行时才提亮，避免列表花掉 */
      .alunixa-x-extensions-item-button {
        padding: 2px 8px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 6px;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
        line-height: 16px;
        white-space: nowrap;
      }
      .alunixa-x-page-nav-item:hover .alunixa-x-extensions-item-button {
        background: var(--alunixa-x-bg-selected);
        color: var(--alunixa-x-text);
      }
      /* 启用状态点挪到名称右侧，用 VSCode 那种 14px 徽标尺寸 */
      .alunixa-x-page-nav-item[data-active="true"] .alunixa-x-extensions-item-state {
        background: currentColor;
      }
      .alunixa-x-extensions-item-state {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--alunixa-x-text-tertiary);
      }
      .alunixa-x-extensions-item-state[data-state="on"] { background: #34d399; }
      .alunixa-x-extensions-icon-badge {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: #10a37f;
        color: #fff;
        font-size: 13px;
        line-height: 1;
      }
      .alunixa-x-page-nav-empty { padding: 8px 10px; color: var(--alunixa-x-text-tertiary); font-size: 13px; }
      /* 拓展页：搜索框 + 分组标题 + 市场条目的「安装」按钮 */
      .alunixa-x-page-search { padding: 0 10px 8px; }
      .alunixa-x-page-search-input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 9px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 8px;
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        outline: none;
      }
      .alunixa-x-page-search-input:focus { border-color: var(--alunixa-x-border-subtle); background: var(--alunixa-x-bg-elevated); }
      .alunixa-x-page-search-input::placeholder { color: var(--alunixa-x-text-tertiary); }
      /* 左面板条目图标：市场里没有图标字段，统一用 VSCode 的默认扩展字形 */
      .alunixa-x-page-nav-item-icon {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 5px;
        background: var(--alunixa-x-bg-hover);
        color: var(--alunixa-x-text-secondary);
      }
      .alunixa-x-page-nav-item-icon svg { width: 14px; height: 14px; display: block; }
      .alunixa-x-page-nav-item[data-active="true"] .alunixa-x-page-nav-item-icon {
        color: var(--alunixa-x-text);
      }
      /* 右上角详情：形态对齐 VSCode 的扩展详情页 */
      .alunixa-x-extensions-detail { padding: 4px 4px 24px; }
      .alunixa-x-extensions-detail-empty {
        padding: 40px 8px;
        color: var(--alunixa-x-text-tertiary);
        font-size: 13px;
        text-align: center;
      }
      .alunixa-x-extensions-detail-head {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--alunixa-x-border-subtle);
      }
      .alunixa-x-extensions-detail-icon {
        flex: 0 0 auto;
        width: 64px;
        height: 64px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: var(--alunixa-x-bg-hover);
        color: var(--alunixa-x-text-secondary);
      }
      .alunixa-x-extensions-detail-icon svg { width: 40px; height: 40px; display: block; }
      .alunixa-x-extensions-detail-heading { flex: 1 1 auto; min-width: 0; }
      .alunixa-x-extensions-detail-title {
        font-size: 19px;
        font-weight: 600;
        color: var(--alunixa-x-text);
        line-height: 1.3;
      }
      .alunixa-x-extensions-detail-meta {
        margin-top: 3px;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
      }
      .alunixa-x-extensions-detail-sep { margin: 0 6px; color: var(--alunixa-x-text-tertiary); }
      /* issue #2359：原 #fbbf24 在浅色主题下对比度仅 1.56:1，改为随主题走的警告色。 */
      .alunixa-x-extensions-detail-update { margin-top: 5px; color: var(--alunixa-x-warning); font-size: 13px; }
      .alunixa-x-extensions-detail-actions {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .alunixa-x-extensions-detail-button {
        padding: 5px 12px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 8px;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .alunixa-x-extensions-detail-button:hover { background: var(--alunixa-x-bg-hover); color: var(--alunixa-x-text); }
      .alunixa-x-extensions-detail-primary {
        background: #10a37f;
        border-color: #10a37f;
        color: #fff;
      }
      .alunixa-x-extensions-detail-primary:hover { background: #0e8f70; color: #fff; }
      .alunixa-x-extensions-detail-description {
        margin-top: 14px;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
        line-height: 1.6;
      }
      .alunixa-x-extensions-detail-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 12px;
      }
      .alunixa-x-extensions-detail-tags span {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--alunixa-x-bg-hover);
        color: var(--alunixa-x-text-tertiary);
        font-size: 13px;
      }
      .alunixa-x-extensions-detail-section { margin-top: 16px; }
      .alunixa-x-extensions-detail-section-title {
        margin-bottom: 6px;
        font-weight: 600;
        font-size: 13px;
        color: var(--alunixa-x-text);
      }
      .alunixa-x-extensions-detail-section ul {
        margin: 0;
        padding-left: 18px;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
        line-height: 1.7;
      }
      .alunixa-x-extensions-detail-link { margin-top: 16px; font-size: 13px; }
      .alunixa-x-extensions-detail-link a { color: var(--alunixa-x-success); word-break: break-all; }
      .alunixa-x-extensions-detail-error {
        margin-top: 14px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--alunixa-x-danger-bg);
        color: var(--alunixa-x-danger);
        font-size: 13px;
      }
      .alunixa-x-page-nav-group { margin-bottom: 10px; }
      .alunixa-x-page-nav-group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 10px;
        color: var(--alunixa-x-text-tertiary);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: .04em;
      }
      .alunixa-x-page-nav-group-count {
        min-width: 16px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--alunixa-x-bg-hover);
        text-align: center;
        font-size: 13px;
      }
      .alunixa-x-page-nav-group-tail { display: inline-flex; align-items: center; gap: 6px; }
      .alunixa-x-page-nav-group-action {
        border: 0;
        background: transparent;
        color: var(--alunixa-x-text-tertiary);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        padding: 0 2px;
      }
      .alunixa-x-page-nav-group-action:hover { color: var(--alunixa-x-text); }
      .alunixa-x-page-nav-item-action {
        flex: 0 0 auto;
        padding: 2px 8px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 6px;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
      }
      .alunixa-x-page-nav-item:hover .alunixa-x-page-nav-item-action {
        background: var(--alunixa-x-bg-selected);
        color: var(--alunixa-x-text);
      }
      .alunixa-x-modal-close {
        border: 0;
        background: transparent;
        color: #d1d5db;
        font-size: 20px;
        cursor: pointer;
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      .alunixa-x-modal-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        padding: 4px 20px 16px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,.28) transparent;
      }
      .alunixa-x-modal-body::-webkit-scrollbar { width: 10px; }
      .alunixa-x-modal-body::-webkit-scrollbar-track { background: transparent; }
      .alunixa-x-modal-body::-webkit-scrollbar-thumb {
        border: 2px solid transparent;
        border-radius: 999px;
        background: rgba(255,255,255,.28);
        background-clip: padding-box;
      }
      .alunixa-x-modal-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.38); background-clip: padding-box; }
      .alunixa-x-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 0;
        border-top: 1px solid rgba(255,255,255,.1);
      }
      .alunixa-x-row:first-child { border-top: 0; }
      .alunixa-x-row-title { font-weight: 550; line-height: 1.35; }
      .alunixa-x-row-description { margin-top: 2px; color: #a1a1aa; font-size: 13px; line-height: 1.4; }
      .alunixa-x-model-compat-warning { margin-top: 6px; color: #fbbf24; font-size: 13px; line-height: 1.45; }
      .alunixa-x-toggle {
        width: 42px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: #52525b;
        padding: 2px;
      }
      .alunixa-x-toggle span {
        display: block;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        background: white;
        transition: transform .12s ease;
      }
      .alunixa-x-toggle,
      .alunixa-x-action-button,
      .alunixa-x-issue-button,
      .alunixa-x-backend-status {
        flex-shrink: 0;
        align-self: center;
      }
      .alunixa-x-toggle[data-enabled="true"] { background: #10a37f; }
      .alunixa-x-toggle[data-enabled="true"] span { transform: translateX(18px); }
      .alunixa-x-toggle[data-pending="true"],
      .alunixa-x-toggle:disabled { cursor: not-allowed; opacity: .55; }
      .alunixa-x-width-control { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 176px; align-self: center; }
      .alunixa-x-width-input {
        width: 78px;
        height: 26px;
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 7px;
        background: rgba(255,255,255,.08);
        color: #f3f4f6;
        font-size: 13px;
        font-family: inherit;
        padding: 0 8px;
      }
      .alunixa-x-width-input:disabled { opacity: .55; cursor: not-allowed; }
      .alunixa-x-typing-effect-select {
        flex-shrink: 0;
        align-self: center;
        min-width: 112px;
        height: 32px;
        padding: 0 8px;
        font-size: 13px;
      }
      .alunixa-x-typing-effect-select:disabled { opacity: .55; cursor: not-allowed; }
      .alunixa-x-service-tier-control { display: grid; gap: 6px; min-width: 316px; justify-items: end; align-self: center; }
      .alunixa-x-service-tier-status { color: #a1a1aa; font-size: 13px; line-height: 1.3; text-align: right; }
      .alunixa-x-service-tier-status[data-status="ok"] { color: #34d399; }
      .alunixa-x-service-tier-status[data-status="failed"] { color: #f87171; }
      .alunixa-x-service-tier-status[data-status="unsupported"] { color: #fbbf24; }
      .alunixa-x-service-tier-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
      .alunixa-x-service-tier-thread-actions { opacity: .88; align-items: center; }
      .alunixa-x-service-tier-thread-label { color: #a1a1aa; font-size: 13px;
        line-height: 1.2;
        font-family: inherit; white-space: nowrap; }
      .alunixa-x-service-tier-button { border: 1px solid rgba(255,255,255,.18); border-radius: 7px; background: #3f3f46; color: #f3f4f6; font-size: 13px;
        font-family: inherit; padding: 5px 8px; white-space: nowrap; }
      .alunixa-x-service-tier-button[data-active="true"] { border-color: #10a37f; background: rgba(16,163,127,.22); color: #6ee7b7; }
      .alunixa-x-service-tier-button:disabled { opacity: .55; cursor: not-allowed; }
      .${codexServiceTierBadgeClass} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        height: 24px;
        min-width: 54px;
        box-sizing: border-box;
        border: 1px solid rgba(148,163,184,.28);
        border-radius: 999px;
        background: rgba(148,163,184,.12);
        color: #d4d4d8;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        font-family: inherit;
        padding: 0 8px;
        white-space: nowrap;
        cursor: pointer;
      }
      .${codexServiceTierBadgeClass}[hidden] { display: none !important; }
      .${codexServiceTierBadgeClass}:hover { border-color: rgba(16,163,127,.44); background: rgba(16,163,127,.13); }
      .${codexServiceTierBadgeClass}[data-tier="fast"] { border-color: rgba(16,163,127,.55); background: rgba(16,163,127,.18); color: #6ee7b7; }
      .${codexServiceTierBadgeClass}[data-tier="loading"] { color: #a1a1aa; }
      .${codexServiceTierBadgeClass}[data-tier="failed"] { border-color: rgba(248,113,113,.42); background: rgba(248,113,113,.12); color: #fca5a5; }
      .${codexServiceTierBadgeClass}[data-tier="unsupported"] { border-color: rgba(251,191,36,.48); background: rgba(251,191,36,.13); color: #fbbf24; }
      .${codexServiceTierBadgeClass}[data-disabled="true"] { cursor: not-allowed; opacity: .78; }
      .alunixa-x-about { color: #a1a1aa; line-height: 1.5; }
      .alunixa-x-panel[hidden] { display: none; }
      .alunixa-x-action-button,
      .alunixa-x-issue-button { border: 1px solid rgba(255,255,255,.18); border-radius: 7px; background: #3f3f46; color: #f3f4f6; font-size: 13px;
        font-family: inherit; padding: 6px 8px; }
      .alunixa-x-form-field {
        display: grid;
        gap: 4px;
        margin-top: 10px;
        /* issue #2359：原来是写死的 #d4d4d8，浅色主题下对比度只有 1.38:1（≈看不见）。
           标签文字改跟主题走。 */
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
        font-family: inherit;
        text-align: left;
      }
      .alunixa-x-form-field input {
        width: min(520px, 72vw);
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        background: #18181b;
        color: #f4f4f5;
        padding: 8px 10px;
        font: 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .alunixa-x-form-message {
        min-height: 18px;
        margin-top: 10px;
        color: #a1a1aa;
        font-size: 13px;
        font-family: inherit;
        text-align: left;
      }
      .alunixa-x-form-message[data-status="ok"] { color: #34d399; }
      .alunixa-x-form-message[data-status="failed"] { color: #f87171; }
      .alunixa-x-form-message[data-status="loading"] { color: #fbbf24; }
      .alunixa-x-backend-status { display: grid; gap: 4px; min-width: 132px; justify-items: end; }
      .alunixa-x-backend-label { color: #a1a1aa; font-size: 13px; }
      .alunixa-x-backend-label[data-status="ok"] { color: #34d399; }
      .alunixa-x-backend-label[data-status="failed"] { color: #f87171; }
      .alunixa-x-backend-label[data-status="degraded"] { color: #fbbf24; }
      .alunixa-x-sponsor-text { color: #d1d5db; font-size: 13px; line-height: 1.55; margin: 4px 0 12px; }
      /*
       * 推荐内容：网格卡片。
       *
       * 一张卡 = 图标 + 名称/简介 + 右上箭头 + 底部优惠条。用 auto-fill + minmax
       * 让列数随宽度自适应（宽屏 4 列、窄屏递减），卡片等高对齐。
       */

      .alunixa-x-ad-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        background: rgba(255,255,255,.02);
        color: inherit;
        text-decoration: none;
        padding: 16px;
        transition: background .12s ease, border-color .12s ease;
      }
      .alunixa-x-ad-card:hover,
      .alunixa-x-ad-card:focus-visible {
        border-color: rgba(255,255,255,.18);
        background: rgba(255,255,255,.05);
        outline: none;
      }
      .alunixa-x-ad-main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
      .alunixa-x-ad-icon {
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        border-radius: 9px;
        object-fit: contain;
        background: rgba(255,255,255,.06);
      }
      /* 清单没给图时用名称首字占位，比空一块整齐。 */
      .alunixa-x-ad-icon-fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #f3f4f6;
        font-size: 15px;
        font-weight: 600;
      }
      .alunixa-x-ad-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .alunixa-x-ad-title { overflow: hidden; color: #f8fafc; font-size: 14px; font-weight: 600; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
      /* 简介不再压成一行：卡片按内容撑高，最多 3 行，超出才省略。
         nowrap 会让「提供 Claude 与 ...」这类较长简介只露前几个字。 */
      .alunixa-x-ad-description { display: -webkit-box; overflow: hidden; color: #a1a1aa; font-size: 13px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      .alunixa-x-ad-arrow { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 2px; color: #71717a; }
      .alunixa-x-ad-arrow svg { width: 14px; height: 14px; display: block; }
      .alunixa-x-ad-card:hover .alunixa-x-ad-arrow,
      .alunixa-x-ad-card:focus-visible .alunixa-x-ad-arrow { color: #f3f4f6; }
      /* 底部优惠条：撑满卡片宽度，长文本截断。 */
      .alunixa-x-ad-promo {
        display: block;
        overflow: hidden;
        border-radius: 8px;
        background: rgba(255,255,255,.05);
        color: #f5a97f;
        font-size: 13px;
        line-height: 1.35;
        padding: 7px 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .alunixa-x-ad-empty { border: 1px dashed rgba(255,255,255,.16); border-radius: 12px; color: #9ca3af; font-size: 13px; padding: 12px; text-align: center; }
      /*
       * 注入面板的语义色板：前景/背景必须取自同一套 token，且都要能被主题切换带走。
       *
       * issue #2359（Windows 浅色主题下黑底黑字）：旧写法在中间塞了一整层
       * --token-* 回退名（--token-bg-primary / --token-text-primary /
       * --token-border / --token-list-hover-background / --token-text-default /
       * --token-bg-fog / --token-text-tertiary …）。实测 Codex 客户端（26.9xx）
       * 的产物里这些名字**一个都不存在**——真正在用的一套是 --color-token-*。
       * 于是三级回退链的中间那级永远落空，浅色主题下只靠最后一级写死的深色值
       * 兜底，前景与背景各自独立兜底时明度撞在一起，就成了黑底黑字。
       * 这里把死名删掉，直接接到确实存在、且**由 Codex 自己按主题重算**的
       * --color-token-* 上；末级兜底仅作最后保险，不再承担主题判断。
       */
      :root {
        --alunixa-x-bg-primary: var(--color-token-bg-primary, var(--color-token-main-surface-primary, #fff));
        --alunixa-x-bg-secondary: var(--color-token-bg-secondary, var(--alunixa-x-bg-primary));
        --alunixa-x-bg-elevated: var(--color-token-dropdown-background, var(--color-token-bg-secondary, var(--alunixa-x-bg-primary)));
        --alunixa-x-bg-hover: var(--color-token-interactive-bg-secondary-hover, var(--color-token-list-hover-background, rgba(0,0,0,.06)));
        --alunixa-x-bg-selected: var(--color-token-interactive-bg-secondary-selected, var(--alunixa-x-bg-hover));
        --alunixa-x-text: var(--color-token-text-primary, var(--color-token-foreground, #171717));
        --alunixa-x-text-secondary: var(--color-token-text-secondary, var(--alunixa-x-text));
        --alunixa-x-text-tertiary: var(--color-token-text-tertiary, var(--alunixa-x-text-secondary));
        --alunixa-x-border: var(--color-token-border-light, var(--color-token-border, var(--color-token-border-default, rgba(0,0,0,.12))));
        --alunixa-x-border-subtle: var(--alunixa-x-border);
        --alunixa-x-focus: var(--color-token-focus-border, var(--color-border-focus, currentColor));
        --alunixa-x-danger: var(--color-text-danger, #dc2626);
        --alunixa-x-danger-bg: var(--color-background-danger-soft, rgba(220,38,38,.1));
        --alunixa-x-success: var(--color-text-success, #15803d);
        --alunixa-x-warning: var(--color-text-warning, #a16207);
      }
      :where(.${moreMenuClass}, .${actionTooltipClass}, .codex-delete-toast, .codex-delete-confirm-overlay, .alunixa-x-modal-overlay, .${alunixaXPageClass}) {
        color: var(--alunixa-x-text);
        font-family: inherit;
      }
      .${moreMenuClass} {
        border-color: var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        box-shadow: var(--ui-menu-shadow, var(--shadow-300, 0 8px 24px rgba(0,0,0,.16)));
      }
      .codex-session-more-menu-item { border-radius: var(--border-radius-sm, 6px); font-family: inherit; }
      .codex-session-more-menu-item:hover,
      .codex-session-more-menu-item:focus-visible { background: var(--alunixa-x-bg-hover); }
      .${actionButtonClass} {
        width: var(--h-token-button-composer-sm, 28px);
        height: var(--h-token-button-composer-sm, 28px);
        border-radius: var(--border-radius-lg, 8px);
        color: var(--codex-session-action-color, var(--alunixa-x-text-tertiary));
        font-family: inherit;
      }
      .${actionButtonClass}:hover,
      .${actionButtonClass}:focus-visible {
        background: var(--codex-session-action-hover-background, var(--alunixa-x-bg-hover));
        color: var(--codex-session-action-hover-color, var(--alunixa-x-text));
      }
      .${sessionShareButtonClass}:hover,
      .${sessionShareButtonClass}:focus-visible {
        background: var(--alunixa-x-bg-hover);
        color: var(--alunixa-x-text);
      }
      .${actionTooltipClass} {
        border-color: var(--alunixa-x-border);
        border-radius: var(--border-radius-md, 6px);
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        font-family: inherit;
        font-size: 13px;
        line-height: 16px;
        padding: 6px 8px;
        box-shadow: var(--tooltip-box-shadow, var(--shadow-200, 0 4px 12px rgba(0,0,0,.14)));
      }
      .codex-delete-confirm-overlay,
      .alunixa-x-modal-overlay { background: var(--color-background-surface-under, rgba(0,0,0,.32)); backdrop-filter: blur(1px); }
      .codex-delete-confirm-content,
      .alunixa-x-modal-content {
        border-color: var(--alunixa-x-border);
        border-radius: var(--border-radius-xl, 12px);
        background: var(--alunixa-x-bg-primary);
        color: var(--alunixa-x-text);
        font-family: inherit;
        box-shadow: var(--shadow-400, 0 16px 48px rgba(0,0,0,.2));
      }
      .codex-delete-confirm-message,
      .alunixa-x-row-description,
      .alunixa-x-about,
      .alunixa-x-service-tier-thread-label,
      .alunixa-x-backend-label,
      .alunixa-x-form-message,
      .alunixa-x-sponsor-text { color: var(--alunixa-x-text-secondary); }
      .codex-delete-confirm-actions button,
      .alunixa-x-action-button,
      .alunixa-x-issue-button,
      .alunixa-x-service-tier-button {
        min-height: 32px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        line-height: 18px;
        padding: 5px 10px;
      }
      .codex-delete-confirm-actions button:hover,
      .codex-delete-confirm-actions button:focus-visible,
      .alunixa-x-action-button:hover,
      .alunixa-x-action-button:focus-visible,
      .alunixa-x-issue-button:hover,
      .alunixa-x-issue-button:focus-visible,
      .alunixa-x-service-tier-button:hover,
      .alunixa-x-service-tier-button:focus-visible,
      .codex-delete-confirm-actions [data-codex-delete-confirm="true"] {
        border-color: var(--color-border-danger, #dc2626);
        background: var(--color-background-danger-solid, #dc2626);
        color: var(--color-text-danger-solid, #fff);
      }
      .alunixa-x-modal-close { border-color: var(--alunixa-x-border); color: var(--alunixa-x-text-secondary); border-radius: var(--border-radius-lg, 8px); }
      .alunixa-x-modal-close:hover,
      .alunixa-x-modal-close:focus-visible { background: var(--alunixa-x-bg-hover); color: var(--alunixa-x-text); outline: none; }
      .${alunixaXPageClass},
      .${alunixaXPageClass} .alunixa-x-modal-content {
        background: var(--alunixa-x-bg-primary) !important;
        color: var(--alunixa-x-text) !important;
      }
      .${alunixaXPageClass} .alunixa-x-modal-content { border-color: transparent; }
      .alunixa-x-modal-body { scrollbar-color: var(--alunixa-x-text-tertiary) transparent; }
      .alunixa-x-modal-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--alunixa-x-text-tertiary) 45%, transparent); background-clip: padding-box; }
      .alunixa-x-modal-body::-webkit-scrollbar-thumb:hover { background: var(--alunixa-x-text-tertiary); background-clip: padding-box; }
      .alunixa-x-row { border-top-color: var(--alunixa-x-border-subtle); }
      .alunixa-x-toggle { background: var(--color-background-secondary-solid, var(--alunixa-x-text-tertiary)); }
      .alunixa-x-toggle span { background: var(--color-token-bg-primary, #fff); box-shadow: var(--switch-thumb-shadow, 0 1px 2px rgba(0,0,0,.16)); }
      .alunixa-x-toggle[data-enabled="true"] { background: var(--color-background-primary-solid, var(--color-background-success-solid, #10a37f)); }
      .alunixa-x-width-input,
      .alunixa-x-typing-effect-select,
      .alunixa-x-form-field input {
        border: 1px solid var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text);
        font-family: inherit;
      }
      .alunixa-x-width-input:focus,
      .alunixa-x-typing-effect-select:focus,
      .alunixa-x-form-field input:focus { border-color: var(--alunixa-x-focus); outline: 2px solid color-mix(in srgb, var(--alunixa-x-focus) 25%, transparent); outline-offset: 0; }
      .alunixa-x-service-tier-button[data-active="true"] {
        border-color: var(--color-border-primary, var(--alunixa-x-focus));
        background: var(--color-background-primary-soft, var(--alunixa-x-bg-selected));
        color: var(--color-text-primary, var(--alunixa-x-text));
      }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status,
      .alunixa-x-backend-indicator { box-shadow: none; }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="ok"],
      .alunixa-x-backend-indicator[data-status="ok"] { background: var(--alunixa-x-success); }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="failed"],
      .alunixa-x-backend-indicator[data-status="failed"] { background: var(--alunixa-x-danger); }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="checking"],
      .alunixa-x-backend-indicator[data-status="checking"] { background: var(--alunixa-x-warning); }
      #${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status[data-status="degraded"],
      .alunixa-x-backend-indicator[data-status="degraded"] { background: var(--alunixa-x-warning); }
      .${codexServiceTierBadgeClass} {
        height: 24px;
        border-color: var(--alunixa-x-border);
        border-radius: var(--border-radius-lg, 8px);
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text-secondary);
        font-family: inherit;
      }
      .${codexServiceTierBadgeClass}:hover { border-color: var(--alunixa-x-focus); background: var(--alunixa-x-bg-hover); }
      .${codexServiceTierBadgeClass}[data-tier="fast"] { border-color: var(--color-border-primary, var(--alunixa-x-focus)); background: var(--color-background-primary-soft, var(--alunixa-x-bg-selected)); color: var(--alunixa-x-text); }
      .${codexServiceTierBadgeClass}[data-tier="failed"] { border-color: var(--color-border-danger, var(--alunixa-x-danger)); background: var(--alunixa-x-danger-bg); color: var(--alunixa-x-danger); }
      .${codexServiceTierBadgeClass}[data-tier="unsupported"] { border-color: var(--color-border-warning, var(--alunixa-x-border)); background: var(--color-background-warning-soft, var(--alunixa-x-bg-hover)); color: var(--alunixa-x-warning); }
      .alunixa-x-ad-card { border-color: var(--alunixa-x-border-subtle); background: var(--alunixa-x-bg-secondary); }
      .alunixa-x-ad-card:hover,
      .alunixa-x-ad-card:focus-visible { border-color: var(--alunixa-x-border); background: var(--alunixa-x-bg-hover); }
      .alunixa-x-ad-icon { background: var(--alunixa-x-bg-hover); }
      .alunixa-x-ad-icon-fallback { color: var(--alunixa-x-text); }
      .alunixa-x-ad-title { color: var(--alunixa-x-text); }
      .alunixa-x-ad-description { color: var(--alunixa-x-text-secondary); }
      .alunixa-x-ad-arrow { color: var(--alunixa-x-text-tertiary); }
      .alunixa-x-ad-card:hover .alunixa-x-ad-arrow,
      .alunixa-x-ad-card:focus-visible .alunixa-x-ad-arrow { color: var(--alunixa-x-text); }
      /*
       * 优惠条：暗底配橙色文字。
       *
       * 底色不能用 --alunixa-x-danger-bg —— 它在当前主题下解析成浅粉（偏浅色主题
       * 的值），压在深色卡片上非常刺眼。改成用警告色按低透明度混出来，深浅主题
       * 都成立，也和原生「需要注意」的语义色同源。
       */
      .alunixa-x-ad-promo {
        background: color-mix(in srgb, var(--alunixa-x-warning) 14%, transparent);
        color: var(--alunixa-x-warning);
      }
      .alunixa-x-ad-empty { border-color: var(--alunixa-x-border); color: var(--alunixa-x-text-tertiary); }
      .alunixa-x-form-message[data-status="ok"], .alunixa-x-service-tier-status[data-status="ok"], .alunixa-x-backend-label[data-status="ok"] { color: var(--alunixa-x-success); }
      .alunixa-x-form-message[data-status="failed"], .alunixa-x-service-tier-status[data-status="failed"], .alunixa-x-backend-label[data-status="failed"] { color: var(--alunixa-x-danger); }
      .alunixa-x-backend-label[data-status="degraded"] { color: var(--alunixa-x-warning); }
      .alunixa-x-form-message[data-status="loading"], .alunixa-x-service-tier-status[data-status="unsupported"], .alunixa-x-model-compat-warning { color: var(--alunixa-x-warning); }
      /* Alunixa X 设置主页：对齐原生设置页，保持其它页面与弹窗的布局独立。 */
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="home"] {
        background: var(--alunixa-x-settings-page-bg, var(--alunixa-x-bg-primary)) !important;
      }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="home"] .alunixa-x-modal-body {
        box-sizing: border-box;
        padding: 72px 32px 64px;
      }
      .alunixa-x-settings {
        width: 100%;
        max-width: 740px;
        min-width: 0;
        margin: 0 auto;
        container: alunixa-x-settings / inline-size;
      }
      .alunixa-x-settings > .alunixa-x-modal-header {
        width: 100%;
        box-sizing: border-box;
        padding: 0;
        margin: 0 0 48px;
        gap: 16px;
      }
      .alunixa-x-settings .alunixa-x-modal-title {
        min-width: 0;
        font-size: 28px;
        font-weight: 600;
        line-height: 36px;
        letter-spacing: -.02em;
        overflow-wrap: anywhere;
      }
      .alunixa-x-settings-section { margin: 0 0 48px; }
      .alunixa-x-settings-section:last-child { margin-bottom: 0; }
      .alunixa-x-settings-section-title {
        margin: 0 0 16px;
        color: var(--alunixa-x-text);
        font-size: 14px;
        font-weight: 550;
        line-height: 20px;
      }
      .alunixa-x-settings-card,
      .alunixa-x-settings > [data-alunixa-x-ext-menu] {
        box-sizing: border-box;
        min-width: 0;
        padding: 0 16px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 16px;
        background: var(--alunixa-x-settings-card-bg, var(--alunixa-x-bg-secondary));
      }
      .alunixa-x-settings > [data-alunixa-x-ext-menu] { margin-top: 48px; }
      .alunixa-x-settings .alunixa-x-row {
        box-sizing: border-box;
        min-height: 60px;
        align-items: center;
        gap: 24px;
        padding: 10px 0;
        font-size: 14px;
        line-height: 20px;
      }
      .alunixa-x-settings .alunixa-x-row[hidden] { display: none; }
      .alunixa-x-settings .alunixa-x-row > :first-child {
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .alunixa-x-settings .alunixa-x-row > :not(:first-child) { max-width: 48%; }
      .alunixa-x-settings .alunixa-x-row-title { font-weight: 500; line-height: 20px; }
      .alunixa-x-settings .alunixa-x-row-description,
      .alunixa-x-settings .alunixa-x-about {
        margin-top: 2px;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
        line-height: 18px;
        overflow-wrap: anywhere;
      }
      .alunixa-x-settings .alunixa-x-toggle {
        flex: 0 0 32px;
        width: 32px;
        height: 20px;
        min-height: 20px;
        box-sizing: border-box;
        padding: 2px;
        background: var(--alunixa-x-switch-off, #3a3a3a);
        cursor: pointer;
      }
      .alunixa-x-settings .alunixa-x-toggle span {
        width: 16px;
        height: 16px;
        background: var(--alunixa-x-switch-thumb, #fff);
      }
      .alunixa-x-settings .alunixa-x-toggle[data-enabled="true"] { background: var(--alunixa-x-switch-on, #3485ff); }
      .alunixa-x-settings .alunixa-x-toggle[data-enabled="true"] span { transform: translateX(12px); }
      .alunixa-x-settings .alunixa-x-toggle[data-pending="true"],
      .alunixa-x-settings .alunixa-x-toggle:disabled { cursor: not-allowed; opacity: .55; }
      .alunixa-x-settings .alunixa-x-width-control {
        flex: 0 1 auto;
        min-width: 0;
        flex-wrap: wrap;
        gap: 8px;
      }
      .alunixa-x-settings .alunixa-x-service-tier-control {
        flex: 0 1 300px;
        min-width: 0;
      }
      .alunixa-x-settings .alunixa-x-service-tier-status { overflow-wrap: anywhere; }
      .alunixa-x-settings .alunixa-x-backend-status { overflow-wrap: anywhere; text-align: right; }
      .alunixa-x-settings .alunixa-x-action-button,
      .alunixa-x-settings .alunixa-x-issue-button,
      .alunixa-x-settings .alunixa-x-service-tier-button,
      .alunixa-x-settings .alunixa-x-width-input,
      .alunixa-x-settings .alunixa-x-typing-effect-select {
        box-sizing: border-box;
        min-height: 32px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 8px;
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text);
        font-family: inherit;
        font-size: 13px;
        line-height: 18px;
      }
      .alunixa-x-settings .alunixa-x-width-input,
      .alunixa-x-settings .alunixa-x-typing-effect-select { height: 32px; }
      .alunixa-x-settings .alunixa-x-width-input { width: 72px; min-width: 48px; }
      .alunixa-x-settings .alunixa-x-typing-effect-select { min-width: 0; }
      .alunixa-x-settings .alunixa-x-typing-effect-select[hidden] { display: none; }
      .alunixa-x-settings .alunixa-x-dropdown-trigger {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        align-self: center;
        justify-content: space-between;
        gap: 8px;
        height: 28px;
        min-width: 112px;
        box-sizing: border-box;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 8px;
        padding: 3px 10px;
        background: var(--alunixa-x-bg-secondary);
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        line-height: 20px;
        cursor: pointer;
      }
      .alunixa-x-settings .alunixa-x-dropdown-trigger > svg {
        flex: 0 0 16px;
        width: 16px;
        height: 16px;
        color: var(--alunixa-x-text-secondary);
      }
      .alunixa-x-settings .alunixa-x-dropdown-trigger:hover:not(:disabled),
      .alunixa-x-settings .alunixa-x-dropdown-trigger[aria-expanded="true"] { background: var(--alunixa-x-bg-hover); }
      .alunixa-x-settings .alunixa-x-dropdown-trigger:disabled { cursor: not-allowed; opacity: .55; }
      /* 菜单挂在 overlay 上，避免设置卡片或滚动容器裁切。 */
      .alunixa-x-dropdown-menu {
        position: absolute;
        z-index: 2;
        overflow-y: auto;
        overscroll-behavior: contain;
        width: 220px;
        max-width: calc(100% - 16px);
        box-sizing: border-box;
        padding: 6px;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 14px;
        background: var(--alunixa-x-bg-elevated);
        color: var(--alunixa-x-text);
        font-family: inherit;
        box-shadow: var(--ui-menu-shadow, var(--shadow-300, 0 8px 24px rgba(0,0,0,.16)));
      }
      .alunixa-x-dropdown-menu[hidden] { display: none; }
      .alunixa-x-dropdown-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        width: 100%;
        min-height: 28px;
        box-sizing: border-box;
        border: 0;
        border-radius: 8px;
        padding: 4px 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 14px;
        line-height: 20px;
        text-align: left;
        cursor: pointer;
      }
      .alunixa-x-dropdown-option > svg {
        flex: 0 0 16px;
        width: 16px;
        height: 16px;
        visibility: hidden;
      }
      .alunixa-x-dropdown-option[aria-selected="true"] > svg { visibility: visible; }
      .alunixa-x-dropdown-option:hover,
      .alunixa-x-dropdown-option:focus-visible {
        background: var(--alunixa-x-bg-hover);
        outline: none;
      }
      .alunixa-x-settings .alunixa-x-action-button,
      .alunixa-x-settings .alunixa-x-issue-button { white-space: normal; overflow-wrap: anywhere; }
      .alunixa-x-settings .alunixa-x-action-button:hover,
      .alunixa-x-settings .alunixa-x-action-button:focus-visible,
      .alunixa-x-settings .alunixa-x-issue-button:hover,
      .alunixa-x-settings .alunixa-x-issue-button:focus-visible,
      .alunixa-x-settings .alunixa-x-service-tier-button:hover,
      .alunixa-x-settings .alunixa-x-service-tier-button:focus-visible {
        border-color: var(--alunixa-x-border);
        background: var(--alunixa-x-bg-hover);
        color: var(--alunixa-x-text);
      }
      .alunixa-x-settings .alunixa-x-service-tier-button[data-active="true"] {
        border-color: var(--alunixa-x-switch-on, #3485ff);
        background: color-mix(in srgb, var(--alunixa-x-switch-on, #3485ff) 16%, var(--alunixa-x-settings-card-bg, var(--alunixa-x-bg-secondary)));
        color: var(--alunixa-x-text);
      }
      .alunixa-x-settings button:focus-visible,
      .alunixa-x-settings input:focus-visible,
      .alunixa-x-settings select:focus-visible {
        outline: 2px solid var(--alunixa-x-switch-on, #3485ff);
        outline-offset: 3px;
      }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="home"] { container: alunixa-x-settings-page / inline-size; }
      @container alunixa-x-settings-page (max-width: 800px) {
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="home"] .alunixa-x-modal-body { padding: 48px 24px; }
      }
      @container alunixa-x-settings-page (max-width: 480px) {
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="home"] .alunixa-x-modal-body { padding: 32px 16px; }
      }
      @container alunixa-x-settings (max-width: 560px) {
        .alunixa-x-settings .alunixa-x-row { gap: 16px; }
        .alunixa-x-settings .alunixa-x-row[data-codex-service-tier-controls="true"] { flex-wrap: wrap; }
        .alunixa-x-settings .alunixa-x-row[data-codex-service-tier-controls="true"] > :first-child { flex-basis: 100%; }
        .alunixa-x-settings .alunixa-x-row[data-codex-service-tier-controls="true"] > .alunixa-x-service-tier-control { flex-basis: 100%; max-width: 100%; }
      }
      /* 拓展与推荐内容使用原生插件页面的导航、标题和轻量列表布局。 */
      .${alunixaXPageClass} .alunixa-x-modal-content:is([data-alunixa-x-active-tab="extensions"], [data-alunixa-x-active-tab="sponsor"]) {
        background: var(--alunixa-x-settings-page-bg, var(--alunixa-x-bg-primary)) !important;
        container: alunixa-x-discovery-page / inline-size;
      }
      .${alunixaXPageClass} .alunixa-x-modal-content:is([data-alunixa-x-active-tab="extensions"], [data-alunixa-x-active-tab="sponsor"]) > .alunixa-x-modal-header { display: none; }
      .${alunixaXPageClass} .alunixa-x-modal-content:is([data-alunixa-x-active-tab="extensions"], [data-alunixa-x-active-tab="sponsor"]) .alunixa-x-modal-body {
        box-sizing: border-box;
        padding: 32px 32px 56px;
      }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav {
        box-sizing: border-box;
        width: 312px;
        flex-basis: 312px;
        background: var(--alunixa-x-nav-bg, var(--alunixa-x-bg-secondary));
      }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-item[data-active="true"] { background: var(--alunixa-x-nav-selected-bg, var(--alunixa-x-bg-selected)); }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-header { padding: 16px; }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-title { font-size: 18px; line-height: 24px; }
      .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-body { padding: 0 12px 20px; }
      .alunixa-x-extensions-nav-entry {
        min-height: 36px;
        gap: 10px;
        box-sizing: border-box;
        padding: 8px 12px;
        font-size: 14px;
        font-weight: 400;
        line-height: 20px;
      }
      .alunixa-x-extensions-nav-entry .alunixa-x-page-nav-item-icon,
      .alunixa-x-extensions-nav-entry .alunixa-x-extensions-icon {
        flex: 0 0 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        background: transparent;
      }
      .alunixa-x-extensions-nav-entry .alunixa-x-page-nav-item-icon svg,
      .alunixa-x-extensions-nav-entry .alunixa-x-extensions-icon svg,
      .alunixa-x-extensions-nav-entry .alunixa-x-extensions-icon-img { width: 20px; height: 20px; }
      .alunixa-x-extensions-nav-entry .alunixa-x-extensions-icon-img { display: block; object-fit: contain; }
      .alunixa-x-extensions-nav-entry .alunixa-x-extensions-item-name { font-weight: 400; }
      .alunixa-x-extensions-nav-entry + .alunixa-x-page-nav-group { margin-top: 24px; }
      .alunixa-x-extensions-nav-entry:hover .alunixa-x-extensions-item-name { text-decoration: none; }
      .alunixa-x-discovery {
        width: 100%;
        max-width: 900px;
        min-width: 0;
        margin: 0 auto;
        padding: 0;
        container: alunixa-x-discovery / inline-size;
      }
      .alunixa-x-discovery-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
      }
      .alunixa-x-discovery-header > :first-child { flex: 1 1 auto; min-width: 0; }
      .alunixa-x-discovery-title {
        margin: 0;
        color: var(--alunixa-x-text);
        font-size: 26px;
        font-weight: 600;
        line-height: 34px;
        letter-spacing: -.02em;
        overflow-wrap: anywhere;
      }
      .alunixa-x-discovery-description {
        margin: 12px 0 0;
        color: var(--alunixa-x-text-secondary);
        font-size: 14px;
        line-height: 20px;
        overflow-wrap: anywhere;
      }
      .alunixa-x-discovery-toolbar { display: flex; flex: 0 1 auto; align-items: center; gap: 8px; min-width: 0; }
      .alunixa-x-discovery-search {
        display: flex;
        flex: 0 1 240px;
        align-items: center;
        gap: 8px;
        width: 240px;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 999px;
        padding: 8px 12px;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
      }
      .alunixa-x-discovery-search > svg { flex: 0 0 16px; width: 16px; height: 16px; }
      .alunixa-x-discovery-search input {
        width: 100%;
        min-width: 0;
        border: 0;
        padding: 0;
        outline: none;
        background: transparent;
        color: var(--alunixa-x-text);
        font: inherit;
        font-size: 13px;
        line-height: 18px;
      }
      .alunixa-x-discovery-search input::placeholder { color: var(--alunixa-x-text-tertiary); }
      .alunixa-x-discovery-search:focus-within {
        outline: 2px solid var(--alunixa-x-switch-on, #3485ff);
        outline-offset: 2px;
      }
      .alunixa-x-discovery-icon-button {
        display: inline-flex;
        flex: 0 0 32px;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        box-sizing: border-box;
        border: 0;
        border-radius: 8px;
        padding: 0;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
        cursor: pointer;
      }
      .alunixa-x-discovery-icon-button svg { width: 16px; height: 16px; }
      .alunixa-x-discovery-icon-button:hover { background: var(--alunixa-x-bg-hover); color: var(--alunixa-x-text); }
      .alunixa-x-discovery-icon-button:disabled { opacity: .55; cursor: not-allowed; }
      .alunixa-x-extensions-filter { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
      .alunixa-x-extensions-filter button {
        border: 0;
        border-radius: 999px;
        padding: 8px 16px;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
        font: inherit;
        font-size: 13px;
        line-height: 20px;
        cursor: pointer;
      }
      .alunixa-x-extensions-filter button[data-active="true"] { background: var(--alunixa-x-bg-selected); color: var(--alunixa-x-text); }
      .alunixa-x-extensions-filter button:hover { background: var(--alunixa-x-bg-hover); }
      .alunixa-x-discovery-section-title {
        margin: 32px 0 16px;
        color: var(--alunixa-x-text);
        font-size: 16px;
        font-weight: 550;
        line-height: 24px;
      }
      .alunixa-x-extensions-grid,

      .alunixa-x-extensions-grid > .alunixa-x-extensions-detail-empty,
      .alunixa-x-discovery .alunixa-x-ad-empty { grid-column: 1 / -1; }
      .alunixa-x-extension-card {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
        min-height: 56px;
        box-sizing: border-box;
        border: 0;
        padding: 8px 0;
        background: transparent;
      }
      .alunixa-x-extension-card-select {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 12px;
        min-width: 0;
        border: 0;
        border-radius: 8px;
        padding: 0;
        background: transparent;
        color: var(--alunixa-x-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .alunixa-x-extension-card-icon {
        display: inline-flex;
        flex: 0 0 36px;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        box-sizing: border-box;
        border: 1px solid var(--alunixa-x-border);
        border-radius: 10px;
        color: var(--alunixa-x-text-secondary);
      }
      .alunixa-x-extension-card-icon svg { width: 24px; height: 24px; }
      .alunixa-x-extension-card-icon img { width: 32px; height: 32px; object-fit: contain; border-radius: 8px; }
      .alunixa-x-extension-card-copy { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; min-width: 0; }
      .alunixa-x-extension-card-title {
        overflow: hidden;
        color: var(--alunixa-x-text);
        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .alunixa-x-extension-card-description {
        display: block;
        overflow: hidden;
        color: var(--alunixa-x-text-secondary);
        font-size: 13px;
        line-height: 18px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .alunixa-x-extension-card-actions { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; }
      .alunixa-x-discovery .alunixa-x-extensions-detail { max-width: 900px; margin: 0 auto; padding: 0 0 24px; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-head { align-items: center; border-bottom: 0; gap: 20px; padding-bottom: 20px; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-title { font-size: 26px; line-height: 34px; overflow-wrap: anywhere; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-icon img { width: 40px; height: 40px; object-fit: contain; border-radius: 8px; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-description { font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-actions { flex-wrap: wrap; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-button { min-height: 32px; box-sizing: border-box; }
      .alunixa-x-discovery .alunixa-x-extensions-detail-primary {
        border-color: var(--alunixa-x-text);
        background: var(--alunixa-x-text);
        color: var(--alunixa-x-settings-page-bg, var(--alunixa-x-bg-primary));
      }
      .alunixa-x-discovery .alunixa-x-extensions-detail-primary:hover {
        background: color-mix(in srgb, var(--alunixa-x-text) 90%, transparent);
        color: var(--alunixa-x-settings-page-bg, var(--alunixa-x-bg-primary));
      }
      .alunixa-x-discovery .alunixa-x-extensions-detail-link a { color: var(--color-text-link, var(--color-token-text-link, var(--alunixa-x-switch-on, #3485ff))); }
      .alunixa-x-discovery .alunixa-x-toggle { flex: 0 0 32px; width: 32px; height: 20px; min-height: 20px; box-sizing: border-box; padding: 2px; background: var(--alunixa-x-switch-off, #3a3a3a); cursor: pointer; }
      .alunixa-x-discovery .alunixa-x-toggle span { width: 16px; height: 16px; background: var(--alunixa-x-switch-thumb, #fff); }
      .alunixa-x-discovery .alunixa-x-toggle[data-enabled="true"] { background: var(--alunixa-x-switch-on, #3485ff); }
      .alunixa-x-discovery .alunixa-x-toggle[data-enabled="true"] span { transform: translateX(12px); }
      .alunixa-x-discovery .alunixa-x-toggle[data-pending="true"],
      .alunixa-x-discovery .alunixa-x-toggle:disabled { cursor: not-allowed; opacity: .55; }
      .alunixa-x-extensions-back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 24px;
        border: 0;
        border-radius: 8px;
        padding: 4px 0;
        background: transparent;
        color: var(--alunixa-x-text-secondary);
        font: inherit;
        font-size: 13px;
        line-height: 20px;
        cursor: pointer;
      }
      .alunixa-x-extensions-back svg { width: 16px; height: 16px; }
      .alunixa-x-extensions-back:hover { color: var(--alunixa-x-text); }
      .alunixa-x-discovery button:focus-visible,
      .alunixa-x-discovery a:focus-visible,
      .alunixa-x-extensions-nav-entry:focus-visible { outline: 2px solid var(--alunixa-x-switch-on, #3485ff); outline-offset: 3px; }
      .alunixa-x-discovery .alunixa-x-ad-card {
        flex-direction: row;
        align-items: center;
        gap: 16px;
        min-height: 72px;
        min-width: 0;
        box-sizing: border-box;
        border: 0;
        border-radius: 8px;
        padding: 8px 0;
        background: transparent;
      }
      .alunixa-x-discovery .alunixa-x-ad-card:hover,
      .alunixa-x-discovery .alunixa-x-ad-card:focus-visible { background: transparent; }
      .alunixa-x-discovery .alunixa-x-ad-main { flex: 1 1 auto; align-items: center; gap: 12px; }
      .alunixa-x-discovery .alunixa-x-ad-icon { flex: 0 0 36px; border: 1px solid var(--alunixa-x-border); border-radius: 10px; background: transparent; box-sizing: border-box; }
      .alunixa-x-discovery .alunixa-x-ad-text { gap: 4px; }
      .alunixa-x-discovery .alunixa-x-ad-title { font-size: 14px; font-weight: 500; line-height: 20px; }
      .alunixa-x-discovery .alunixa-x-ad-description { font-size: 13px; line-height: 18px; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
      .alunixa-x-discovery .alunixa-x-ad-promo { border-radius: 0; padding: 0; background: transparent; color: var(--alunixa-x-text-secondary); font-size: 12px; line-height: 16px; white-space: normal; overflow-wrap: anywhere; }
      .alunixa-x-discovery .alunixa-x-ad-arrow { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; margin: 0; color: var(--alunixa-x-text-secondary); }
      .alunixa-x-discovery .alunixa-x-ad-arrow svg { width: 16px; height: 16px; }
      @container alunixa-x-discovery-page (max-width: 900px) {
        .alunixa-x-discovery-header { flex-wrap: wrap; gap: 20px; }
        .alunixa-x-discovery-toolbar { flex-basis: 100%; }
        .alunixa-x-discovery .alunixa-x-extensions-detail-head { flex-wrap: wrap; }
        .alunixa-x-discovery .alunixa-x-extensions-detail-actions { flex-basis: 100%; }
      }
      @container alunixa-x-discovery (max-width: 600px) {
        .alunixa-x-extensions-grid,

      }
      @container alunixa-x-discovery-page (max-width: 700px) {
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav { width: 180px; flex-basis: 180px; }
        .${alunixaXPageClass} .alunixa-x-modal-content:is([data-alunixa-x-active-tab="extensions"], [data-alunixa-x-active-tab="sponsor"]) .alunixa-x-modal-body { padding: 24px 20px 40px; }
      }
      @container alunixa-x-discovery-page (max-width: 480px) {
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav { width: 56px; flex-basis: 56px; }
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-header { display: none; }
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-body { padding: 12px 8px; }
        .alunixa-x-extensions-nav-entry { justify-content: center; padding: 8px; }
        .alunixa-x-extensions-nav-entry .alunixa-x-page-nav-item-text,
        .alunixa-x-extensions-nav-entry .alunixa-x-page-nav-item-name,
        .alunixa-x-extensions-nav-entry .alunixa-x-extensions-item-name,
        .alunixa-x-extensions-nav-entry .alunixa-x-page-nav-item-state,
        .alunixa-x-extensions-nav-entry .alunixa-x-extensions-item-state { display: none; }
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-group-head,
        .${alunixaXPageClass} .alunixa-x-modal-content[data-alunixa-x-active-tab="extensions"] .alunixa-x-page-nav-empty { display: none; }
        .${alunixaXPageClass} .alunixa-x-modal-content:is([data-alunixa-x-active-tab="extensions"], [data-alunixa-x-active-tab="sponsor"]) .alunixa-x-modal-body { padding: 24px 16px 40px; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function defaultCodexPlusSettings() {
    return { pluginAutoExpand:true, projectMove:true, performanceProtection:true, zedRemoteOpen:true, upstreamWorktreeCreate:true, nativeMenuLocalization:true, pluginMarketplaceUnlock: true, modelWhitelistUnlock: true, sessionDelete: true, markdownExport: true, sessionShare: true, pasteFix: false, typingEffect: "off", threadIdBadge: false, conversationView: false, whaleWidget: false, conversationViewMaxWidth: conversationViewDefaultWidth, threadScrollRestore: true, nativeMenuPlacement: true, serviceTierControls: false, petRealMouseLook: false, stepwise: false, answerOutline: false, dreamSkinEnabled: false, dreamSkinPaused: false, dreamSkinThemeConfig: window.__ALUNIXA_X_DREAM_SKIN_THEME__ || {}, dreamSkinImagePath: "" };
  }

  const alunixaXBackendSettingMap = {
    pluginAutoExpand:"codexAppPluginAutoExpand",
    projectMove:"codexAppProjectMove",
    performanceProtection:"codexAppPerformanceProtection",
    zedRemoteOpen:"codexAppZedRemoteOpen",
    upstreamWorktreeCreate:"codexAppUpstreamWorktreeCreate",
    nativeMenuLocalization:"codexAppNativeMenuLocalization",
    pluginMarketplaceUnlock: "codexAppPluginMarketplaceUnlock",
    modelWhitelistUnlock: "codexAppModelWhitelistUnlock",
    sessionDelete: "codexAppSessionDelete",
    markdownExport: "codexAppMarkdownExport",
    sessionShare: "codexAppSessionShare",
    threadIdBadge: "codexAppThreadIdBadge",
    conversationView: "codexAppConversationView",
    whaleWidget: "codexAppWhaleWidgetEnabled",
    threadScrollRestore: "codexAppThreadScrollRestore",
    nativeMenuPlacement: "codexAppNativeMenuPlacement",
    serviceTierControls: "codexAppServiceTierControls",
    petRealMouseLook: "codexAppPetRealMouseLook",
    stepwise: "codexAppStepwiseEnabled",
    answerOutline: "codexAppAnswerOutlineEnabled",
    pasteFix: "codexAppPasteFix",
    typingEffect: "codexAppTypingEffect",
    dreamSkinEnabled: "codexAppDreamSkinEnabled",
    dreamSkinPaused: "codexAppDreamSkinPaused",
    dreamSkinThemeConfig: "codexAppDreamSkinThemeConfig",
    dreamSkinImagePath: "codexAppDreamSkinImagePath",
  };
  const alunixaXBackendMappedSettings = new Set(Object.keys(alunixaXBackendSettingMap));

  function backendCodexPlusSettings() {
    const settings = {};
    Object.entries(alunixaXBackendSettingMap).forEach(([localKey, backendKey]) => {
      const value = alunixaXBackendSettings[backendKey];
      if (typeof value === "boolean" || typeof value === "string" || (value && typeof value === "object" && !Array.isArray(value))) {
        settings[localKey] = value;
      }
    });
    return settings;
  }

  function alunixaXSettings() {
    if (alunixaXBackendSettings.enhancementsEnabled === false) {
      return {
        pluginAutoExpand:false, projectMove:false, performanceProtection:false,
        zedRemoteOpen:false, upstreamWorktreeCreate:false, nativeMenuLocalization:false,
        pluginMarketplaceUnlock: false,
        modelWhitelistUnlock: false,
        sessionDelete: false,
        markdownExport: false,
        sessionShare: false,
        pasteFix: false,
        typingEffect: "off",
        threadIdBadge: false,
        conversationView: false,
        whaleWidget: false,
        conversationViewMaxWidth: conversationViewDefaultWidth,
        threadScrollRestore: false,
        nativeMenuPlacement: false,
        serviceTierControls: false,
        petRealMouseLook: false,
        stepwise: false,
        answerOutline: false,
        dreamSkinEnabled: false,
        dreamSkinPaused: false,
        dreamSkinThemeConfig: window.__ALUNIXA_X_DREAM_SKIN_THEME__ || {},
        dreamSkinImagePath: "",
      };
    }
    try {
      const settings = { ...defaultCodexPlusSettings(), ...JSON.parse(localStorage.getItem(alunixaXSettingsKey) || "{}"), ...backendCodexPlusSettings() };
      delete settings.customLayout;
      return settings;
    } catch {
      const settings = { ...defaultCodexPlusSettings(), ...backendCodexPlusSettings() };
      return settings;
    }
  }

  // Dream skin runtime is adapted from Fei-Away/Codex-Dream-Skin's renderer injection.
  function dreamSkinStylePreset(id, stylePreset) {
    const preset = String(stylePreset || "").trim();
    if (preset && preset !== "dream-original") return preset;
    return ({
      "caishen-lite": "caishen-lite",
      "caishen-max": "caishen-max",
      "caishen-readable": "caishen-readable",
      "export-night": "export-night",
      "global-founder-bright": "global-founder-bright",
      "mythic-guardian-noir": "mythic-guardian-noir",
      "codex-snow-skin": "codex-snow",
      "glass-vision": "glass-vision",
      "preset-midnight-aurora": "midnight-aurora",
      "preset-amber-dusk": "amber-dusk",
      "preset-forest-mist": "forest-mist",
      "preset-cyber-neon": "cyber-neon",
      "preset-sakura-dawn": "sakura-dawn",
    })[String(id || "").trim()] || "dream-original";
  }

  function dreamSkinThemeConfig(theme) {
    const fallback = window.__ALUNIXA_X_DREAM_SKIN_THEME__ || {};
    const value = theme && typeof theme === "object" ? theme : fallback;
    const colors = value.colors && typeof value.colors === "object" ? value.colors : fallback.colors || {};
    return {
      schemaVersion: value.schemaVersion === 1 ? 1 : 1,
      id: String(value.id || fallback.id || "custom"),
      name: String(value.name || fallback.name || "Dream Skin"),
      stylePreset: dreamSkinStylePreset(
        value.id || fallback.id,
        value.stylePreset || fallback.stylePreset,
      ),
      brandSubtitle: String(value.brandSubtitle || fallback.brandSubtitle || "CODEX DREAM SKIN"),
      statusText: String(value.statusText || fallback.statusText || "DREAM SKIN ONLINE"),
      quote: String(value.quote || fallback.quote || "MAKE SOMETHING WONDERFUL"),
      tagline: String(value.tagline || fallback.tagline || "把喜欢的画面变成可交互的 Codex 工作台。"),
      projectPrefix: String(value.projectPrefix || fallback.projectPrefix || "选择项目 · "),
      projectLabel: String(value.projectLabel || fallback.projectLabel || "◉  选择项目"),
      colors: { ...(fallback.colors || {}), ...colors },
    };
  }

  function dreamSkinCssString(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function dreamSkinParseRgb(value) {
    if (!value || value === "transparent") return null;
    const text = String(value).trim();
    const hex = text.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
    if (hex) {
      const normalized = hex.length === 3
        ? hex.split("").map((part) => `${part}${part}`).join("")
        : hex.slice(0, 6);
      return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
      };
    }
    const match = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }

  function dreamSkinLuminance({ r, g, b }) {
    const linear = [r, g, b].map((color) => {
      const value = color / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  const alunixaXDreamSkinMainSurfaceMarker = "data-alunixa-x-dream-skin-main-surface";

  function ensureDreamSkinMainSurface() {
    const existing = document.querySelector("main.main-surface");
    if (existing) return existing;

    const modularSurface = document.querySelector('main[class*="_MainContentSurface_"]');
    const mainCandidates = modularSurface ? [] : [...document.querySelectorAll("main")];
    const shellMain = modularSurface || (mainCandidates.length === 1 ? mainCandidates[0] : null);
    if (!shellMain) return null;

    shellMain.classList.add("main-surface");
    shellMain.setAttribute(alunixaXDreamSkinMainSurfaceMarker, "true");
    return shellMain;
  }

  function clearDreamSkinMainSurfaceCompatibility() {
    document.querySelectorAll(`main[${alunixaXDreamSkinMainSurfaceMarker}="true"]`).forEach((node) => {
      node.classList.remove("main-surface");
      node.removeAttribute(alunixaXDreamSkinMainSurfaceMarker);
    });
  }

  function detectDreamSkinShellMode() {
    const root = document.documentElement;
    const body = document.body;
    const classText = `${root?.className || ""} ${body?.className || ""}`.toLowerCase();

    if (/\b(dark|theme-dark|appearance-dark)\b/.test(classText)) return "dark";
    if (/\b(light|theme-light|appearance-light)\b/.test(classText)) return "light";

    const dataTheme = (
      root?.getAttribute("data-theme") ||
      root?.getAttribute("data-appearance") ||
      root?.getAttribute("data-color-mode") ||
      body?.getAttribute("data-theme") ||
      body?.getAttribute("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    const checked = document.querySelector('input[name="appearance-theme"]:checked');
    if (checked) {
      const label = (checked.getAttribute("aria-label") || checked.value || "").toLowerCase();
      if (label.includes("暗") || label.includes("dark")) return "dark";
      if (label.includes("浅") || label.includes("light")) return "light";
      if (label.includes("系统") || label.includes("system")) {
        return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
      }
    }

    try {
      const colorScheme = getComputedStyle(root).colorScheme || "";
      if (colorScheme.includes("dark") && !colorScheme.includes("light")) return "dark";
      if (colorScheme.includes("light") && !colorScheme.includes("dark")) return "light";
    } catch {
    }

    const samples = [
      body,
      ensureDreamSkinMainSurface(),
      document.querySelector("aside.app-shell-left-panel"),
    ].filter(Boolean);
    let lightVotes = 0;
    let darkVotes = 0;
    for (const element of samples) {
      try {
        const rgb = dreamSkinParseRgb(getComputedStyle(element).backgroundColor);
        if (!rgb) continue;
        const luminance = dreamSkinLuminance(rgb);
        if (luminance >= 0.55) lightVotes += 1;
        else if (luminance <= 0.25) darkVotes += 1;
      } catch {
      }
    }
    if (lightVotes > darkVotes) return "light";
    if (darkVotes > lightVotes) return "dark";

    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    } catch {
    }
    return "light";
  }

  function dreamSkinThemeShellMode(theme) {
    const background = dreamSkinParseRgb(theme?.colors?.background);
    if (background) return dreamSkinLuminance(background) < 0.36 ? "dark" : "light";
    return detectDreamSkinShellMode();
  }

  function dreamSkinArtBlobUrl(artDataUrl) {
    if (!artDataUrl || !artDataUrl.startsWith("data:")) return "";
    const comma = artDataUrl.indexOf(",");
    if (comma < 0) return "";
    const mime = /^data:([^;,]+)/.exec(artDataUrl)?.[1] || "image/png";
    const binary = atob(artDataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }

  function independentThemeDescriptor(stylePreset) {
    const custom = (name, chromeMarkup) => ({
      rootClass: `codex-theme-${name}`,
      homeClass: `theme-${name}-home`,
      shellClass: `theme-${name}-home-shell`,
      chromeId: "codex-theme-chrome",
      chromeClass: `theme-chrome-${name}`,
      chromeMarkup,
    });
    const descriptors = {
      "caishen-lite": custom("caishen-lite", `
        <div class="csl-caption" data-theme-field="name"></div><div class="csl-seal">吉</div>`),
      "caishen-max": custom("caishen-max", `
        <div class="csm-banner" data-theme-field="name"></div><div class="csm-coins">◇ ◇ ◇</div>`),
      "caishen-readable": custom("caishen-readable", ""),
      "export-night": custom("export-night", `
        <div class="exn-titlebar"><span data-theme-field="name"></span><span class="exn-cursor">█</span></div>`),
      "global-founder-bright": custom("global-founder-bright", `
        <div class="gfb-masthead"><span data-theme-field="name"></span><small data-theme-field="status"></small></div>`),
      "mythic-guardian-noir": custom("mythic-guardian-noir", `
        <div class="mgn-sigil"></div><div class="mgn-line"></div>`),
      "midnight-aurora": custom("midnight-aurora", `
        <div class="mda-arc"></div><div class="mda-star">✦</div>`),
      "amber-dusk": custom("amber-dusk", `
        <div class="abd-sun"></div><div class="abd-horizon"></div>`),
      "forest-mist": custom("forest-mist", `
        <div class="fm-branch"></div><div class="fm-leaf">⌁</div>`),
      "cyber-neon": custom("cyber-neon", `
        <div class="cn-index" data-theme-field="status"></div><div class="cn-scan"></div>`),
      "sakura-dawn": custom("sakura-dawn", `
        <div class="sd-petal">✿</div><div class="sd-rule"></div>`),
      "codex-snow": {
        rootClass: "codex-dream-skin",
        homeClass: "dream-home",
        shellClass: "dream-home-shell",
        chromeId: "codex-dream-skin-chrome",
        chromeClass: "",
        chromeMarkup: `
          <div class="dream-brand"><span class="dream-note">SKI</span><span><b>Snowline Codex</b><small>ice-blue training mode</small></span></div>
          <div class="dream-signature">Freeski focus</div>
          <div class="dream-sparkles"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="dream-ribbon"><span>slopestyle</span><strong>double cork energy</strong><span>halfpipe</span></div>
          <div class="dream-polaroid"></div>`,
      },
      "glass-vision": {
        rootClass: "codex-glass-vision-skin",
        homeClass: "glass-vision-home",
        shellClass: "glass-vision-home-shell",
        taskShellClass: "glass-vision-task-shell",
        chromeId: "codex-glass-vision-skin-chrome",
        chromeClass: "",
        chromeMarkup: `
          <div class="glass-vision-brand"><span class="glass-vision-orbit-mark"><i></i></span><span><b>GLASS VISION</b><small>SILVER BLUE · CELESTIAL</small></span></div>
          <div class="glass-vision-status"><i></i><span>CRYSTAL FIELD</span></div>
          <div class="glass-vision-atmosphere"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="glass-vision-orbit-lines"><i></i><i></i><i></i></div><div class="glass-vision-prism"></div>`,
      },
    };
    if (descriptors[stylePreset]) return descriptors[stylePreset];
    if (alunixaXDreamSkinPlatform === "windows") {
      return {
        rootClass: "codex-dream-skin",
        homeClass: "dream-home",
        shellClass: "dream-home-shell",
        taskClass: "dream-task",
        chromeId: "codex-dream-skin-chrome",
        chromeClass: "",
        chromeMarkup: "",
      };
    }
    return {
      rootClass: "codex-dream-skin",
      homeClass: "dream-skin-home",
      shellClass: "dream-skin-home-shell",
      chromeId: "codex-dream-skin-chrome",
      chromeClass: "",
      chromeMarkup: `
        <div class="dream-skin-brand"><span class="dream-skin-portal-mark">◉</span><span><b data-theme-field="name"></b><small data-theme-field="subtitle"></small></span></div>
        <div class="dream-skin-status"><i></i><span data-theme-field="status"></span></div>
        <div class="dream-skin-quote" data-theme-field="quote"></div>
        <div class="dream-skin-particles"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="dream-skin-orbit"></div>`,
    };
  }

  const dreamSkinCompanionId = "codex-dream-skin-companion";
  const dreamSkinCompanionDataUrlPrefixes = [
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
  ];
  const dreamSkinCompanionBase64Pattern = /^[a-z0-9+/=\s]+$/i;

  function removeDreamSkinCompanion() {
    document.getElementById(dreamSkinCompanionId)?.remove();
  }

  function dreamSkinCompanionConfig(theme) {
    const companion = theme && theme.companion;
    if (!companion || typeof companion !== "object" || companion.enabled === false) return null;
    const dataUrl = typeof companion.dataUrl === "string" ? companion.dataUrl.trim() : "";
    const prefix = dreamSkinCompanionDataUrlPrefixes.find((candidate) =>
      dataUrl.toLowerCase().startsWith(candidate));
    if (
      !dataUrl
      || dataUrl.length > 240_000
      || !prefix
      || !dreamSkinCompanionBase64Pattern.test(dataUrl.slice(prefix.length))
    ) {
      return null;
    }
    const width = Math.max(48, Math.min(Number(companion.width) || 96, 160));
    const side = ["left", "right"].includes(companion.side) ? companion.side : "auto";
    const offsetX = Math.max(-48, Math.min(Number(companion.offsetX) || 0, 48));
    const offsetY = Math.max(-160, Math.min(Number(companion.offsetY) || 0, 160));
    return { dataUrl, width, side, offsetX, offsetY };
  }

  function visibleDreamSkinComposer() {
    return [...document.querySelectorAll(".composer-footer, .composer-surface-chrome")]
      .map((node) => ({ node, rect: node.getBoundingClientRect?.() }))
      .filter(({ rect }) => rect && rect.width > 200 && rect.height > 0)
      .sort((left, right) => right.rect.bottom - left.rect.bottom)[0] || null;
  }

  function ensureDreamSkinCompanion(theme) {
    const config = dreamSkinCompanionConfig(theme);
    const composer = visibleDreamSkinComposer();
    if (!config || !composer) {
      removeDreamSkinCompanion();
      return;
    }

    let companion = document.getElementById(dreamSkinCompanionId);
    if (!companion) {
      companion = document.createElement("img");
      companion.id = dreamSkinCompanionId;
      companion.alt = "";
      companion.setAttribute("aria-hidden", "true");
      Object.assign(companion.style, {
        position: "fixed",
        zIndex: "39",
        height: "auto",
        maxHeight: "160px",
        objectFit: "contain",
        pointerEvents: "none",
        userSelect: "none",
        filter: "drop-shadow(0 8px 14px rgba(0, 0, 0, .18))",
        transition: "left 160ms ease, top 160ms ease, opacity 160ms ease",
      });
      document.body.appendChild(companion);
    }
    if (companion.src !== config.dataUrl) {
      companion.onload = () => ensureDreamSkinCompanion(theme);
      companion.src = config.dataUrl;
    }

    const renderedHeight = companion.naturalWidth > 0 && companion.naturalHeight > 0
      ? Math.min(160, config.width * companion.naturalHeight / companion.naturalWidth)
      : config.width;

    const gap = 12;
    const edge = 8;
    const right = composer.rect.right + gap + config.offsetX;
    const left = composer.rect.left - config.width - gap + config.offsetX;
    const fitsRight = right + config.width <= window.innerWidth - edge;
    const fitsLeft = left >= edge;
    const useRight = config.side === "right"
      ? fitsRight
      : config.side === "left"
        ? !fitsLeft && fitsRight
        : fitsRight || !fitsLeft;

    if (!fitsRight && !fitsLeft) {
      companion.style.opacity = "0";
      return;
    }

    const top = Math.max(
      edge,
      Math.min(
        composer.rect.bottom - renderedHeight + config.offsetY,
        window.innerHeight - renderedHeight - edge,
      ),
    );
    companion.style.width = `${config.width}px`;
    companion.style.left = `${Math.round(useRight ? right : left)}px`;
    companion.style.top = `${Math.round(top)}px`;
    companion.style.opacity = "1";
  }

  function clearDreamSkinPresentation() {
    const root = document.documentElement;
    for (const className of [...(root?.classList || [])]) {
      if (
        className === "codex-dream-skin"
        || className === "codex-glass-vision-skin"
        || className.startsWith("codex-theme-")
      ) {
        root?.classList.remove(className);
      }
    }
    root?.removeAttribute("data-dream-shell");
    root?.removeAttribute("data-alunixa-x-dream-skin");
    root?.style.removeProperty("--dream-art");
    root?.style.removeProperty("--dream-skin-art");
    [
      "--ds-bg",
      "--ds-panel",
      "--ds-panel-2",
      "--ds-green",
      "--ds-lime",
      "--ds-cyan",
      "--ds-purple",
      "--ds-text",
      "--ds-muted",
      "--ds-line",
      "--dream-ink",
      "--dream-purple",
      "--dream-violet",
      "--dream-pink",
      "--dream-blush",
      "--dream-pearl",
      "--dream-line",
      "--dream-skin-name",
      "--dream-skin-tagline",
      "--dream-skin-project-prefix",
      "--dream-skin-project-label",
    ].forEach((name) => root?.style.removeProperty(name));
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll('[role="main"][data-dream-home-layout]').forEach((node) => {
      node.removeAttribute("data-dream-home-layout");
    });
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.querySelectorAll(".dream-skin-home").forEach((node) => node.classList.remove("dream-skin-home"));
    document.querySelectorAll(".dream-skin-home-shell").forEach((node) => node.classList.remove("dream-skin-home-shell"));
    document.querySelectorAll("[class]").forEach((node) => {
      for (const className of [...node.classList]) {
        if (
          /^theme-[a-z0-9-]+-(?:home|home-shell|task|task-shell)$/.test(className)
          || /^glass-vision-(?:home|home-shell|task|task-shell)$/.test(className)
        ) {
          node.classList.remove(className);
        }
      }
    });
    document.getElementById(alunixaXDreamSkinStyleId)?.remove();
    document.getElementById("alunixa-x-dream-skin-style")?.remove();
    document.getElementById("codex-dream-skin-chrome")?.remove();
    document.getElementById("codex-glass-vision-skin-chrome")?.remove();
    document.getElementById("codex-theme-chrome")?.remove();
    removeDreamSkinCompanion();
    clearDreamSkinMainSurfaceCompatibility();
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    const descriptor = state?.descriptor;
    if (descriptor) {
      root?.classList.remove(descriptor.rootClass);
      for (const className of [descriptor.homeClass, descriptor.shellClass, descriptor.taskClass, descriptor.taskShellClass]) {
        if (!className) continue;
        document.querySelectorAll(`.${className}`).forEach((node) => node.classList.remove(className));
      }
      document.getElementById(descriptor.chromeId)?.remove();
    }
    root?.classList.remove("dream-theme-dark", "dream-theme-light");
    root?.removeAttribute("data-codex-theme");
    root?.removeAttribute("data-codex-theme-root");
    [
      "--theme-bg", "--theme-panel", "--theme-panel-alt", "--theme-accent",
      "--theme-accent-alt", "--theme-secondary", "--theme-highlight", "--theme-text",
      "--theme-muted", "--theme-line", "--theme-art", "--glass-vision-art",
      "--dream-accent", "--dream-accent-ink",
    ].forEach((name) => root?.style.removeProperty(name));
  }

  function cleanupDreamSkin() {
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (typeof state?.cleanup === "function" && state.cleanup !== cleanupDreamSkin) {
      try {
        state.cleanup();
      } catch {
      }
    }
    const remainingState = window.__CODEX_DREAM_SKIN_STATE__;
    remainingState?.observer?.disconnect();
    if (remainingState?.timer) clearInterval(remainingState.timer);
    if (remainingState?.scheduler?.timeout) clearTimeout(remainingState.scheduler.timeout);
    if (remainingState?.resizeHandler) window.removeEventListener("resize", remainingState.resizeHandler);
    if (remainingState?.mediaHandler && remainingState?.mediaQuery) {
      try {
        remainingState.mediaQuery.removeEventListener("change", remainingState.mediaHandler);
      } catch {
      }
    }
    if (remainingState?.artUrl) URL.revokeObjectURL(remainingState.artUrl);
    delete window.__CODEX_DREAM_SKIN_STATE__;
    window.__CODEX_GLASS_VISION_SKIN_DISABLED__ = true;
    const glassState = window.__CODEX_GLASS_VISION_SKIN_STATE__;
    try {
      glassState?.cleanup?.();
    } catch {
    }
    delete window.__CODEX_GLASS_VISION_SKIN_STATE__;
    clearDreamSkinPresentation();
  }

  window.__ALUNIXA_X_CLEAR_DREAM_SKIN__ = cleanupDreamSkin;

  function dreamSkinContentSignature(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}-${(hash >>> 0).toString(16)}`;
  }

  function applyIndependentThemeVariables(root, shell, theme, descriptor, artSource) {
    const colors = theme.colors || {};
    const accent = colors.accent || (shell === "light" ? "#d85c6c" : "#76e6cc");
    const accentAlt = colors.accentAlt || accent;
    const secondary = colors.secondary || (shell === "light" ? "#e7a3ad" : "#65bde8");
    const variables = {
      "--theme-bg": colors.background || (shell === "light" ? "#f6f3f4" : "#071116"),
      "--theme-panel": colors.panel || (shell === "light" ? "#ffffff" : "#0b1a20"),
      "--theme-panel-alt": colors.panelAlt || (shell === "light" ? "#fff8f9" : "#10272c"),
      "--theme-accent": accent,
      "--theme-accent-alt": accentAlt,
      "--theme-secondary": secondary,
      "--theme-highlight": colors.highlight || accentAlt,
      "--theme-text": colors.text || (shell === "light" ? "#201b1c" : "#edf7f3"),
      "--theme-muted": colors.muted || (shell === "light" ? "#6c6062" : "#9db7ae"),
      "--theme-line": colors.line || (shell === "light" ? "rgba(90, 64, 68, .18)" : "rgba(150, 220, 200, .24)"),
      "--theme-art": artSource,
      "--dream-art": artSource,
      "--dream-skin-art": artSource,
      "--glass-vision-art": artSource,
      "--dream-accent": accent,
      "--dream-accent-ink": colors.panel || "#ffffff",
    };
    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === "string" && value) root.style.setProperty(name, value);
    }
    root.style.setProperty("--dream-skin-name", dreamSkinCssString(theme.name || "Codex Dream Skin"));
    root.style.setProperty("--dream-skin-tagline", dreamSkinCssString(theme.tagline || "把喜欢的画面变成可交互的 Codex 工作台。"));
    root.style.setProperty("--dream-skin-project-prefix", dreamSkinCssString(theme.projectPrefix || "选择项目 · "));
    root.style.setProperty("--dream-skin-project-label", dreamSkinCssString(theme.projectLabel || "◉  选择项目"));
    root.classList.toggle("dream-theme-dark", shell === "dark");
    root.classList.toggle("dream-theme-light", shell === "light");
    const preset = theme.stylePreset || "dream-original";
    if (root.getAttribute("data-codex-theme") !== preset) root.setAttribute("data-codex-theme", preset);
    if (root.getAttribute("data-codex-theme-root") !== descriptor.rootClass) {
      root.setAttribute("data-codex-theme-root", descriptor.rootClass);
    }
  }

  function installDreamSkin(settings) {
    const theme = dreamSkinThemeConfig(settings.dreamSkinThemeConfig);
    const styles = window.__ALUNIXA_X_DREAM_SKIN_STYLES__ || {};
    const descriptor = independentThemeDescriptor(theme.stylePreset);
    const cssText = String(styles[theme.stylePreset] || styles["dream-original"] || "");
    const artDataUrl = String(window.__ALUNIXA_X_DREAM_SKIN_ART__ || "");
    const themeSignature = dreamSkinContentSignature(JSON.stringify(theme));
    const artSignature = String(window.__ALUNIXA_X_DREAM_SKIN_ART_SIGNATURE__ || dreamSkinContentSignature(artDataUrl));
    const version = `alunixa-x:independent:${alunixaXDreamSkinPlatform}:r${alunixaXDreamSkinRevision}:${theme.stylePreset}:${themeSignature}:${artSignature}:${cssText.length}`;
    const existingState = window.__CODEX_DREAM_SKIN_STATE__;
    if (existingState?.version === version && typeof existingState.ensure === "function") {
      window.__CODEX_DREAM_SKIN_DISABLED__ = false;
      existingState.ensure();
      return;
    }

    cleanupDreamSkin();
    window.__CODEX_DREAM_SKIN_DISABLED__ = false;
    const artUrl = dreamSkinArtBlobUrl(artDataUrl);
    const artSource = artUrl ? `url("${artUrl}")` : "none";

    const ensureStyle = (root) => {
      let style = document.getElementById(alunixaXDreamSkinStyleId);
      if (!style) {
        style = document.createElement("style");
        style.id = alunixaXDreamSkinStyleId;
        (document.head || root).appendChild(style);
      }
      if (style.dataset.independentThemeVersion !== version) {
        style.textContent = cssText;
        style.dataset.independentThemeVersion = version;
      }
    };

    const ensure = () => {
      if (window.__CODEX_DREAM_SKIN_DISABLED__) return;
      const root = document.documentElement;
      if (!root || !document.body) return;
      const shellMain = ensureDreamSkinMainSurface();
      if (!shellMain) {
        clearDreamSkinPresentation();
        return;
      }

      root.classList.add(descriptor.rootClass);
      root.setAttribute("data-alunixa-x-dream-skin", "true");
      const shell = dreamSkinThemeShellMode(theme);
      root.setAttribute("data-dream-shell", shell);
      applyIndependentThemeVariables(root, shell, theme, descriptor, artSource);
      ensureStyle(root);
      ensureDreamSkinCompanion(theme);

      const homeIndicator = document.querySelector('[data-testid="home-icon"]');
      const homeCandidate = homeIndicator?.closest('[role="main"]')
        || [...document.querySelectorAll('[role="main"]')].find((candidate) =>
          candidate.querySelector('[data-feature="game-source"]')
          && candidate.querySelector('.group\\/home-suggestions'))
        || null;
      const homeHasClassicChrome = !!(
        homeCandidate
        && homeCandidate.querySelector('[data-feature="game-source"]')
        && (
          homeCandidate.querySelector('.group\\/home-suggestions')
          || homeCandidate.querySelector('[class*="home-suggestions"]')
          || homeCandidate.querySelector('[class*="_homeUtilityBar_"]')
        )
      );
      const home = homeHasClassicChrome ? homeCandidate : null;
      for (const candidate of document.querySelectorAll(`[role="main"].${descriptor.homeClass}`)) {
        if (candidate !== home && candidate !== homeCandidate) candidate.classList.remove(descriptor.homeClass);
      }
      if (home) home.classList.add(descriptor.homeClass);
      else if (homeCandidate && descriptor.homeClass) homeCandidate.classList.add(descriptor.homeClass);
      if (descriptor.taskClass) {
        for (const candidate of document.querySelectorAll('[role="main"]')) {
          candidate.classList.toggle(descriptor.taskClass, candidate !== home && candidate !== homeCandidate);
        }
      }
      for (const candidate of document.querySelectorAll('[role="main"]')) {
        if (candidate === home) {
          const hero = candidate.querySelector(':scope > div > div > div');
          const structured = !!(hero && hero.querySelector('[data-feature="game-source"], [data-testid="home-icon"]'));
          candidate.setAttribute('data-dream-home-layout', structured ? 'structured' : 'soft');
        } else {
          candidate.setAttribute('data-dream-home-layout', 'soft');
        }
      }
      shellMain.classList.toggle(descriptor.shellClass, Boolean(homeCandidate));
      if (descriptor.taskShellClass) shellMain.classList.toggle(descriptor.taskShellClass, !home);

      let chrome = document.getElementById(descriptor.chromeId);
      if (!chrome || chrome.parentElement !== document.body) {
        chrome?.remove();
        chrome = document.createElement("div");
        chrome.id = descriptor.chromeId;
        chrome.setAttribute("aria-hidden", "true");
        chrome.innerHTML = descriptor.chromeMarkup;
        document.body.appendChild(chrome);
      }
      if (chrome.className !== descriptor.chromeClass) chrome.className = descriptor.chromeClass;
      const fields = {
        name: theme.name || "Codex Dream Skin",
        subtitle: theme.brandSubtitle || "CODEX DREAM SKIN",
        status: theme.statusText || "THEME ONLINE",
        quote: theme.quote || "MAKE SOMETHING WONDERFUL",
      };
      for (const [field, value] of Object.entries(fields)) {
        const target = chrome.querySelector(`[data-theme-field="${field}"]`);
        if (target && target.textContent !== value) target.textContent = value;
      }
      const shellBox = shellMain.getBoundingClientRect();
      chrome.style.left = `${Math.round(shellBox.left)}px`;
      chrome.style.top = `${Math.round(shellBox.top)}px`;
      chrome.style.width = `${Math.round(shellBox.width)}px`;
      chrome.style.height = `${Math.round(shellBox.height)}px`;
      chrome.classList.toggle(descriptor.shellClass, Boolean(home));
      if (descriptor.taskShellClass) chrome.classList.toggle(descriptor.taskShellClass, !home);
      chrome.dataset.dreamShell = shell;
    };

    const scheduler = { timeout: null };
    const scheduleEnsure = () => {
      if (scheduler.timeout) clearTimeout(scheduler.timeout);
      scheduler.timeout = setTimeout(() => {
        scheduler.timeout = null;
        ensure();
      }, 180);
    };
    const observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode"],
    });
    const timer = setInterval(ensure, 4000);
    const resizeHandler = scheduleEnsure;
    window.addEventListener("resize", resizeHandler, { passive: true });

    let mediaQuery = null;
    let mediaHandler = null;
    try {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaHandler = scheduleEnsure;
      mediaQuery.addEventListener("change", mediaHandler);
    } catch {
    }

    window.__CODEX_DREAM_SKIN_STATE__ = {
      ensure,
      cleanup: cleanupDreamSkin,
      observer,
      timer,
      scheduler,
      resizeHandler,
      mediaQuery,
      mediaHandler,
      artUrl,
      version,
      descriptor,
      themeId: theme.id || "custom",
      detectShellMode: detectDreamSkinShellMode,
    };
    ensure();
  }

  function refreshDreamSkin() {
    const settings = alunixaXSettings();
    if (settings.dreamSkinEnabled && !settings.dreamSkinPaused) ensureDreamSkinMainSurface();
    if (window.__ALUNIXA_X_EXTERNAL_DREAM_SKIN_RUNTIME__) {
      if (alunixaXBackendSettingsLoaded && (!settings.dreamSkinEnabled || settings.dreamSkinPaused)) {
        cleanupDreamSkin();
      } else {
        const state = window.__CODEX_DREAM_SKIN_STATE__ || window.__CODEX_GLASS_VISION_SKIN_STATE__;
        state?.ensure?.();
        ensureDreamSkinCompanion(
          window.__ALUNIXA_X_DREAM_SKIN_THEME__ || settings.dreamSkinThemeConfig,
        );
      }
      return;
    }
    if (!settings.dreamSkinEnabled || settings.dreamSkinPaused) {
      cleanupDreamSkin();
      return;
    }
    installDreamSkin(settings);
  }

  function applyDreamSkinLiveUpdate(payload) {
    if (!payload || String(payload.revision || "") !== alunixaXDreamSkinRevision) return false;
    if (typeof payload.artDataUrl === "string" && payload.artDataUrl) {
      window.__ALUNIXA_X_DREAM_SKIN_ART__ = payload.artDataUrl;
    }
    window.__ALUNIXA_X_DREAM_SKIN_ART_SIGNATURE__ = String(payload.artSignature || "");
    window.__ALUNIXA_X_DREAM_SKIN_THEME__ = payload.theme && typeof payload.theme === "object" ? payload.theme : {};
    alunixaXBackendSettings.codexAppDreamSkinEnabled = true;
    alunixaXBackendSettings.codexAppDreamSkinPaused = false;
    alunixaXBackendSettings.codexAppDreamSkinThemeConfig = window.__ALUNIXA_X_DREAM_SKIN_THEME__;
    refreshDreamSkin();
    return true;
  }

  window.__ALUNIXA_X_DREAM_SKIN_RUNTIME_REVISION__ = alunixaXDreamSkinRevision;
  window.__ALUNIXA_X_APPLY_DREAM_SKIN__ = applyDreamSkinLiveUpdate;

  function setCodexPlusSetting(key, value) {
    const backendKey = alunixaXBackendSettingMap[key];
    if (backendKey) {
      if (key === "stepwise") syncStepwisePanel(value);
      if (key === "answerOutline") syncStepwisePanel(undefined, value);
      void setBackendSetting(backendKey, value).then(() => {
        if (key === "stepwise" || key === "answerOutline") {
          Promise.resolve(window.__codexStepwisePanel?.loadSettings?.()).then(() => syncStepwisePanel());
        }
      }).catch(() => {
        void loadBackendSettings();
      });
      return;
    }
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(alunixaXSettingsKey) || "{}");
    } catch {
      stored = {};
    }
    const next = { ...stored, [key]: value };
    localStorage.setItem(alunixaXSettingsKey, JSON.stringify(next));
    if (key === "threadScrollRestore" && !value) {
      clearTimeout(window.__codexThreadScrollSaveTimer);
      window.__codexThreadScrollSaveTimer = null;
      window.__codexThreadScrollRestoreRevision = (window.__codexThreadScrollRestoreRevision || 0) + 1;
      window.__codexThreadScrollSyncRevision = (window.__codexThreadScrollSyncRevision || 0) + 1;
      (window.__codexThreadScrollRestoreTimers || []).forEach((timer) => clearTimeout(timer));
      window.__codexThreadScrollRestoreTimers = [];
      (window.__codexThreadScrollSyncTimers || []).forEach((timer) => clearTimeout(timer));
      window.__codexThreadScrollSyncTimers = [];
      window.__codexThreadScrollRuntime = null;
    }
    if (key === "serviceTierControls") {
      if (value) {
        void loadCodexServiceTierState();
      } else {
        removeCodexServiceTierBadges();
        refreshCodexServiceTierControls();
      }
    }
    if (key === "stepwise") syncStepwisePanel(value);
    renderCodexPlusMenu();
    scan();
  }

  function syncStepwisePanel(
    enabled = alunixaXSettings().stepwise,
    answerOutlineEnabled = alunixaXSettings().answerOutline
  ) {
    try {
      window.__codexStepwisePanel?.syncSettings?.({
        enabled: !!enabled,
        answerOutlineEnabled: !!answerOutlineEnabled,
      });
    } catch (error) {
      sendCodexPlusDiagnostic("stepwise_sync_failed", {
        errorName: error?.name || "",
        errorMessage: error?.message || String(error),
      });
    }
  }

  function normalizeConversationViewWidth(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(conversationViewMinWidth, Math.min(conversationViewMaxAllowedWidth, Math.round(number)));
  }

  function conversationViewWidth() {
    const settingsWidth = normalizeConversationViewWidth(alunixaXSettings().conversationViewMaxWidth);
    if (settingsWidth) return settingsWidth;
    const legacyWidth = normalizeConversationViewWidth(localStorage.getItem(conversationViewLegacyWidthKey));
    return legacyWidth || conversationViewDefaultWidth;
  }

  function refreshConversationViewControls() {
    const enabled = !!alunixaXSettings().conversationView;
    const width = conversationViewWidth();
    document.querySelectorAll("[data-alunixa-x-conversation-view-width]").forEach((input) => {
      input.value = String(width);
      input.disabled = !enabled;
    });
  }

  function setConversationViewWidth(value) {
    const width = normalizeConversationViewWidth(value);
    if (!width) return;
    setCodexPlusSetting("conversationViewMaxWidth", width);
  }
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
    refreshCodexServiceTierControls();
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
  const codexDefaultServiceTierSetting = { key: "default-service-tier", default: null };
  const codexServiceTierFallbackFastValue = "priority";
  const codexServiceTierReadTimeoutMs = 5000;
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
  const codexThreadServiceTierModes = new Set(["inherit", "standard", "fast"]);
  const codexServiceTierControlModes = new Set(["inherit", "global-standard", "global-fast", "custom"]);
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

  function isFastServiceTierValue(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "fast" || normalized === "priority";
  }

  function codexFastServiceTierValue() {
    return codexServiceTierState.fastTierValue || codexServiceTierFallbackFastValue;
  }

  function codexServiceTierFastModelListLabel() {
    return Array.from(codexServiceTierSupportedFastModels).join(" / ");
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

  function codexServiceTierFastUnsupportedMessage(modelName = codexServiceTierCurrentModelName()) {
    const modelText = modelName ? `当前模型 ${modelName} 不支持` : "当前模型未读取";
    return `Fast 支持 ${codexServiceTierFastModelListLabel()} 或已声明 priority 的模型，${modelText}；可在供应商的模型配置中设置 Fast 支持`;
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

  function codexServiceTierInheritedValue() {
    if (codexServiceTierState.serviceTier != null) return codexServiceTierState.serviceTier;
    return codexServiceTierState.configServiceTier ?? null;
  }

  function codexServiceTierValueForMode(mode) {
    if (mode === "fast") return codexFastServiceTierValue();
    if (mode === "standard") return null;
    return codexServiceTierInheritedValue();
  }

  function codexServiceTierDefaultModeForControlMode(controlMode, fallback = "inherit") {
    if (controlMode === "global-fast") return "fast";
    if (controlMode === "global-standard") return "standard";
    if (controlMode === "inherit") return "inherit";
    return normalizeCodexThreadServiceTierMode(fallback);
  }

  function codexServiceTierEffectiveThreadMode(threadMode = "inherit", defaultMode = "inherit") {
    const normalizedThreadMode = normalizeCodexThreadServiceTierMode(threadMode);
    if (normalizedThreadMode !== "inherit") return normalizedThreadMode;
    return normalizeCodexThreadServiceTierMode(defaultMode);
  }

  function codexServiceTierValueForControlMode(controlMode, threadMode = "inherit", defaultMode = "inherit") {
    if (controlMode === "global-fast") return codexFastServiceTierValue();
    if (controlMode === "global-standard") return null;
    if (controlMode === "custom") return codexServiceTierValueForMode(codexServiceTierEffectiveThreadMode(threadMode, defaultMode));
    return codexServiceTierInheritedValue();
  }

  function codexServiceTierEffectiveMode(value) {
    return isFastServiceTierValue(value) ? "fast" : "standard";
  }
  function normalizeCodexThreadServiceTierMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    return codexThreadServiceTierModes.has(normalized) ? normalized : "inherit";
  }

  function normalizeCodexServiceTierControlMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    return codexServiceTierControlModes.has(normalized) ? normalized : "inherit";
  }

  function serviceTierGlobalStatusMessage(serviceTier) {
    if (isFastServiceTierValue(serviceTier)) return "Fast 已开启";
    if (!serviceTier) return "默认服务模式";
    return `当前：${serviceTier}`;
  }

  function serviceTierInheritSourceLabel(serviceTierSource) {
    if (serviceTierSource === "config-toml") return "继承 config.toml";
    return "继承 Codex 默认设置";
  }

  function serviceTierStatusMessage(
    controlMode = codexServiceTierState.controlMode || "inherit",
    threadMode = codexServiceTierState.threadMode || "inherit",
    effectiveMode = codexServiceTierState.effectiveMode || "standard",
    defaultMode = codexServiceTierState.defaultMode || "inherit",
    effectiveServiceTier = codexServiceTierState.effectiveServiceTier,
    serviceTierSource = codexServiceTierState.serviceTierSource
  ) {
    if (codexServiceTierState.status === "loading") return "正在读取…";
    if (codexServiceTierState.status === "failed") return "读取失败";
    if (controlMode === "inherit") {
      if (effectiveServiceTier == null) return "继承 Codex 默认设置：默认";
      return `${serviceTierInheritSourceLabel(serviceTierSource)}：${effectiveMode}`;
    }
    if (controlMode === "global-standard") return "全局 Standard";
    if (controlMode === "global-fast") return "全局 Fast";
    if (threadMode === "inherit") return `自定义：默认 ${defaultMode}`;
    return `自定义：当前 thread ${threadMode}`;
  }

  function readThreadServiceTierState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(codexThreadServiceTierKey) || "{}");
      const rawEntries = parsed?.version === codexThreadServiceTierVersion && parsed?.entries && typeof parsed.entries === "object"
        ? parsed.entries
        : {};
      const entries = Object.create(null);
      Object.entries(rawEntries).forEach(([key, value]) => {
        const safeKey = typeof validThreadScrollSessionKey === "function" ? validThreadScrollSessionKey(key) : String(key || "");
        const mode = normalizeCodexThreadServiceTierMode(value?.mode);
        if (safeKey && mode !== "inherit") entries[safeKey] = { mode, at: finiteNonNegativeNumber(value?.at) || Date.now() };
      });
      const draft = normalizeThreadServiceTierDraft(parsed?.draft);
      const hasCustomState = !!draft || Object.keys(entries).length > 0;
      const mode = parsed?.mode ? normalizeCodexServiceTierControlMode(parsed.mode) : (hasCustomState ? "custom" : "inherit");
      return {
        mode,
        defaultMode: normalizeCodexThreadServiceTierMode(parsed?.defaultMode || codexServiceTierDefaultModeForControlMode(mode)),
        entries,
        draft,
      };
    } catch (_) {
      return { mode: "inherit", defaultMode: "inherit", entries: Object.create(null), draft: null };
    }
  }

  function writeThreadServiceTierState(state) {
    const mode = normalizeCodexServiceTierControlMode(state?.mode);
    const defaultMode = normalizeCodexThreadServiceTierMode(state?.defaultMode || codexServiceTierDefaultModeForControlMode(mode));
    const rawEntries = state?.entries && typeof state.entries === "object" ? state.entries : {};
    const entries = Object.create(null);
    Object.entries(rawEntries)
      .map(([key, value]) => {
        const safeKey = validThreadScrollSessionKey(key);
        const mode = normalizeCodexThreadServiceTierMode(value?.mode);
        return safeKey && mode !== "inherit" ? [safeKey, { mode, at: finiteNonNegativeNumber(value?.at) || Date.now() }] : null;
      })
      .filter(Boolean)
      .sort((left, right) => right[1].at - left[1].at)
      .slice(0, codexThreadServiceTierMaxEntries)
      .forEach(([key, value]) => {
        entries[key] = value;
      });
    const draft = normalizeThreadServiceTierDraft(state?.draft);
    try {
      localStorage.setItem(codexThreadServiceTierKey, JSON.stringify({
        version: codexThreadServiceTierVersion,
        mode,
        defaultMode,
        entries,
        ...(draft ? { draft } : {}),
      }));
    } catch (_) {}
  }

  function normalizeThreadServiceTierDraft(value) {
    if (!value || typeof value !== "object") return null;
    const mode = normalizeCodexThreadServiceTierMode(value.mode);
    if (mode === "inherit") return null;
    const at = finiteNonNegativeNumber(value.at) || Date.now();
    return { mode, at };
  }

  function codexThreadServiceTierOverride(threadId) {
    const key = validThreadScrollSessionKey(threadId);
    if (!key) return null;
    const entry = readThreadServiceTierState().entries[key];
    const mode = normalizeCodexThreadServiceTierMode(entry?.mode);
    return mode === "inherit" ? null : { mode, at: finiteNonNegativeNumber(entry?.at) || 0 };
  }

  function codexThreadServiceTierDraft() {
    const draft = readThreadServiceTierState().draft;
    if (!draft) return null;
    if (Date.now() - draft.at > codexThreadServiceTierDraftBindWindowMs) return null;
    return draft;
  }

  function setCodexThreadServiceTierOverride(threadId, mode) {
    const normalizedMode = normalizeCodexThreadServiceTierMode(mode);
    const state = readThreadServiceTierState();
    state.mode = "custom";
    const key = validThreadScrollSessionKey(threadId);
    if (key) {
      if (normalizedMode === "inherit") {
        delete state.entries[key];
      } else {
        state.entries[key] = { mode: normalizedMode, at: Date.now() };
      }
    } else if (normalizedMode === "inherit") {
      state.draft = null;
    } else {
      state.draft = { mode: normalizedMode, at: Date.now() };
    }
    writeThreadServiceTierState(state);
  }

  function bindDraftServiceTierToThread(threadId) {
    const key = validThreadScrollSessionKey(threadId);
    const draft = codexThreadServiceTierDraft();
    if (!key || !draft) return false;
    const state = readThreadServiceTierState();
    if (normalizeCodexServiceTierControlMode(state.mode) !== "custom") {
      state.draft = null;
      writeThreadServiceTierState(state);
      return false;
    }
    if (!state.entries[key]) state.entries[key] = { mode: draft.mode, at: Date.now() };
    state.draft = null;
    writeThreadServiceTierState(state);
    return true;
  }

  function setCodexServiceTierControlMode(mode) {
    if (alunixaXBackendStatus.status !== "ok") {
      showToast("后端未连接，无法切换服务模式", null);
      refreshCodexServiceTierControls();
      return;
    }
    const normalizedMode = normalizeCodexServiceTierControlMode(mode);
    if (normalizedMode === "global-fast") {
      const fastAvailability = codexServiceTierFastAvailability();
      if (!fastAvailability.supported) {
        codexServiceTierMaybeLoadModelCatalog(true);
        showToast(codexServiceTierFastUnsupportedMessage(fastAvailability.modelName), null);
        refreshCodexServiceTierControls();
        return;
      }
    }
    const state = readThreadServiceTierState();
    state.mode = normalizedMode;
    if (normalizedMode !== "custom") {
      state.defaultMode = codexServiceTierDefaultModeForControlMode(normalizedMode);
      state.entries = Object.create(null);
      state.draft = null;
    } else {
      state.defaultMode = normalizeCodexThreadServiceTierMode(state.defaultMode);
    }
    writeThreadServiceTierState(state);
    refreshCodexServiceTierControls();
    const labels = {
      inherit: "继承 Codex 默认设置",
      "global-standard": "全局 Standard",
      "global-fast": "全局 Fast",
      custom: "自定义",
    };
    showToast(`服务模式：${labels[normalizedMode] || normalizedMode}`, null);
  }

  function syncCodexServiceTierEffectiveState() {
    if (!alunixaXSettings().serviceTierControls) {
      codexServiceTierState = {
        ...codexServiceTierState,
        activeThreadId: "",
        threadMode: "inherit",
        effectiveServiceTier: codexServiceTierState.serviceTier || null,
        effectiveMode: codexServiceTierEffectiveMode(codexServiceTierState.serviceTier),
        message: "未启用",
      };
      return;
    }
    const activeThreadId = validThreadScrollSessionKey(currentSessionRef().session_id);
    if (activeThreadId) {
      bindDraftServiceTierToThread(activeThreadId);
      // 界面判 Fast 用「当前线程的模型」，不再回落全局 catalog：线程中途换模型后
      // 全局值可能是旧的，会让 UI 落后一拍（issue #1463）。
      const activeModel = codexServiceTierUiModelName(activeThreadId);
      if (activeModel) codexServiceTierRememberThreadModel(activeThreadId, activeModel);
    }
    const storedState = readThreadServiceTierState();
    const controlMode = normalizeCodexServiceTierControlMode(storedState.mode);
    const defaultMode = normalizeCodexThreadServiceTierMode(storedState.defaultMode);
    const override = activeThreadId ? codexThreadServiceTierOverride(activeThreadId) : codexThreadServiceTierDraft();
    const threadMode = normalizeCodexThreadServiceTierMode(override?.mode);
    const effectiveServiceTier = codexServiceTierValueForControlMode(controlMode, threadMode, defaultMode);
    const effectiveMode = codexServiceTierEffectiveMode(effectiveServiceTier);
    const fastAvailability = codexServiceTierFastAvailability();
    const message = effectiveMode === "fast" && !fastAvailability.supported
      ? codexServiceTierFastUnsupportedMessage(fastAvailability.modelName)
      : serviceTierStatusMessage(controlMode, threadMode, effectiveMode, defaultMode, effectiveServiceTier, codexServiceTierState.serviceTierSource);
    codexServiceTierState = {
      ...codexServiceTierState,
      controlMode,
      defaultMode,
      activeThreadId,
      threadMode,
      effectiveServiceTier,
      effectiveMode,
      fastModelName: fastAvailability.modelName,
      fastSupported: fastAvailability.supported,
      message,
    };
  }

  function codexServiceTierBadgeState() {
    if (alunixaXBackendStatus.status === "checking") return { tier: "loading", label: "...", disabled: true, title: "服务模式：正在检查后端连接" };
    if (alunixaXBackendStatus.status && alunixaXBackendStatus.status !== "ok") return { tier: "failed", label: "未连接", disabled: true, title: "服务模式：后端未连接，无法切换" };
    if (codexServiceTierState.status === "loading") return { tier: "loading", label: "...", title: "服务模式：正在读取" };
    if (codexServiceTierState.status === "failed") return { tier: "failed", label: "?", title: "服务模式：读取失败" };
    const fastAvailability = codexServiceTierFastAvailability();
    const effectiveMode = codexServiceTierState.effectiveMode || "standard";
    const inheritedDefault = codexServiceTierState.controlMode === "inherit" && codexServiceTierState.effectiveServiceTier == null;
    const scope = codexServiceTierState.controlMode === "custom" && codexServiceTierState.threadMode !== "inherit"
      ? `当前 thread：${codexServiceTierState.threadMode}`
      : serviceTierStatusMessage(codexServiceTierState.controlMode, codexServiceTierState.threadMode, effectiveMode, codexServiceTierState.defaultMode, codexServiceTierState.effectiveServiceTier, codexServiceTierState.serviceTierSource);
    const title = [
      `服务模式：${scope}`,
      "Standard：使用标准处理；不在请求上设置 priority。",
      `Fast：支持 ${codexServiceTierFastModelListLabel()} 或已声明 priority 的模型；使用 service_tier=\"priority\"，实际支持与计费由供应商决定，可在模型配置中明确声明。`,
    ].join("\n");
    if (effectiveMode === "fast" && !fastAvailability.supported) {
      return { tier: "unsupported", label: "不支持", title: `${title}\n${codexServiceTierFastUnsupportedMessage(fastAvailability.modelName)}；当前请求会按 Standard 发送。` };
    }
    if (effectiveMode === "fast") return { tier: "fast", label: "fast", title };
    if (inheritedDefault) return { tier: "default", label: "默认", title };
    return { tier: "standard", label: "standard", title };
  }

  function refreshCodexServiceTierBadges() {
    const state = codexServiceTierBadgeState();
    document.querySelectorAll(`[data-codex-service-tier-badge="true"]`).forEach((node) => {
      node.hidden = typeof codexNativeFastControlVisible === "function" && codexNativeFastControlVisible();
      node.dataset.tier = state.tier;
      node.dataset.disabled = String(!!state.disabled);
      node.textContent = state.label;
      node.title = state.title;
      node.setAttribute("aria-label", state.title);
      node.setAttribute("aria-disabled", String(!!state.disabled));
    });
  }

  function refreshCodexServiceTierControls() {
    syncCodexServiceTierEffectiveState();
    if (typeof notifyCodexNativeFastControls === "function") notifyCodexNativeFastControls();
    const featureEnabled = !!alunixaXSettings().serviceTierControls;
    const backendConnected = alunixaXBackendStatus.status === "ok";
    const backendChecking = alunixaXBackendStatus.status === "checking";
    if (featureEnabled && backendConnected) codexServiceTierMaybeLoadModelCatalog();
    const fastAvailability = codexServiceTierFastAvailability();
    const fastDisabled = !featureEnabled || !backendConnected || codexServiceTierState.status === "loading" || !fastAvailability.supported;
    const fastTitle = fastAvailability.supported
      ? "Fast：使用 service_tier=\"priority\""
      : codexServiceTierFastUnsupportedMessage(fastAvailability.modelName);
    const fastUnsupportedActive = codexServiceTierState.effectiveMode === "fast" && !fastAvailability.supported;
    document.querySelectorAll("[data-codex-service-tier-controls]").forEach((node) => {
      node.hidden = !featureEnabled;
    });
    document.querySelectorAll("[data-codex-service-tier-status]").forEach((node) => {
      node.dataset.status = fastUnsupportedActive ? "unsupported" : (featureEnabled && backendConnected ? (codexServiceTierState.status || "loading") : (backendChecking ? "loading" : "failed"));
      node.textContent = featureEnabled
        ? (backendConnected ? (codexServiceTierState.message || "未读取") : (backendChecking ? "正在检查后端…" : "未连接"))
        : "未启用";
    });
    document.querySelectorAll("[data-codex-service-tier-inherit]").forEach((button) => {
      button.disabled = !featureEnabled || !backendConnected || codexServiceTierState.status === "loading";
      button.dataset.active = String(codexServiceTierState.controlMode === "inherit");
    });
    document.querySelectorAll("[data-codex-service-tier-standard]").forEach((button) => {
      button.disabled = !featureEnabled || !backendConnected || codexServiceTierState.status === "loading";
      button.dataset.active = String(codexServiceTierState.controlMode === "global-standard");
    });
    document.querySelectorAll("[data-codex-service-tier-fast]").forEach((button) => {
      button.disabled = fastDisabled;
      button.dataset.active = String(codexServiceTierState.controlMode === "global-fast");
      button.title = fastTitle;
    });
    document.querySelectorAll("[data-codex-service-tier-custom]").forEach((button) => {
      button.disabled = !featureEnabled || !backendConnected || codexServiceTierState.status === "loading";
      button.dataset.active = String(codexServiceTierState.controlMode === "custom");
    });
    document.querySelectorAll("[data-codex-service-tier-thread-inherit]").forEach((button) => {
      button.disabled = !featureEnabled || !backendConnected || codexServiceTierState.status === "loading";
      button.dataset.active = String(codexServiceTierState.controlMode === "custom" && codexServiceTierState.threadMode === "inherit");
      button.title = `当前 thread 不单独覆盖，继承自定义默认 ${codexServiceTierState.defaultMode || "inherit"}`;
    });
    document.querySelectorAll("[data-codex-service-tier-thread-standard]").forEach((button) => {
      button.disabled = !featureEnabled || !backendConnected || codexServiceTierState.status === "loading";
      button.dataset.active = String(codexServiceTierState.controlMode === "custom" && codexServiceTierState.threadMode === "standard");
    });
    document.querySelectorAll("[data-codex-service-tier-thread-fast]").forEach((button) => {
      button.disabled = fastDisabled;
      button.dataset.active = String(codexServiceTierState.controlMode === "custom" && codexServiceTierState.threadMode === "fast");
      button.title = fastTitle;
    });
    refreshCodexServiceTierBadges();
  }

  async function getConfigTomlServiceTier() {
    const read = loadCodexModelCatalog();
    const catalog = await Promise.race([
      read,
      new Promise((_, reject) => setTimeout(() => reject(new Error("config.toml service_tier 读取超时")), codexServiceTierReadTimeoutMs)),
    ]);
    const rawTier = catalog && typeof catalog === "object" ? catalog.service_tier : null;
    const normalized = String(rawTier || "").trim();
    return normalized ? normalized : null;
  }

  async function resolveInheritedServiceTier() {
    let appSetting = null;
    let appSettingError = null;
    try {
      appSetting = await getCodexServiceTierSetting();
    } catch (error) {
      appSettingError = error;
    }
    if (appSetting != null && String(appSetting).trim() === "") appSetting = null;
    let configTier = null;
    let configError = null;
    try {
      configTier = await getConfigTomlServiceTier();
    } catch (error) {
      configError = error;
    }
    if (appSettingError && configError && appSetting == null && configTier == null) throw appSettingError;
    const serviceTierSource = appSetting != null ? "codex-app" : (configTier != null ? "config-toml" : null);
    return { serviceTier: appSetting, configServiceTier: configTier, serviceTierSource };
  }

  let codexServiceTierStateLoadPromise = null;
  let codexServiceTierStateLoadRevision = 0;
  async function loadCodexServiceTierState() {
    if (!alunixaXSettings().serviceTierControls) {
      // 禁用使旧读取失效；重新启用时不能复用旧供应商/设置的结果。
      codexServiceTierStateLoadRevision += 1;
      codexServiceTierStateLoadPromise = null;
      codexServiceTierState = { ...codexServiceTierState, status: "idle", message: "未启用" };
      refreshCodexServiceTierControls();
      return;
    }
    if (codexServiceTierStateLoadPromise) return codexServiceTierStateLoadPromise;
    const revision = ++codexServiceTierStateLoadRevision;
    const operation = (async () => {
      codexServiceTierState = { ...codexServiceTierState, status: "loading", message: "正在读取…" };
      refreshCodexServiceTierControls();
      try {
        const { serviceTier, configServiceTier, serviceTierSource } = await resolveInheritedServiceTier();
        if (revision !== codexServiceTierStateLoadRevision || !alunixaXSettings().serviceTierControls) return;
        codexServiceTierState = {
          ...codexServiceTierState,
          status: "ok",
          serviceTier,
          configServiceTier,
          serviceTierSource,
          message: serviceTierGlobalStatusMessage(serviceTier ?? configServiceTier),
        };
      } catch (error) {
        if (revision !== codexServiceTierStateLoadRevision || !alunixaXSettings().serviceTierControls) return;
        codexServiceTierState = {
          ...codexServiceTierState,
          status: "failed",
          message: "读取失败",
        };
        sendCodexPlusDiagnostic("service_tier_read_failed", {
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
      } finally {
        if (revision === codexServiceTierStateLoadRevision) refreshCodexServiceTierControls();
      }
    })();
    codexServiceTierStateLoadPromise = operation;
    try {
      await operation;
    } finally {
      if (codexServiceTierStateLoadPromise === operation) codexServiceTierStateLoadPromise = null;
    }
  }

  function setCodexThreadServiceTierMode(mode, modelName = "") {
    if (alunixaXBackendStatus.status !== "ok") {
      showToast("后端未连接，无法切换服务模式", null);
      refreshCodexServiceTierControls();
      return false;
    }
    const normalizedMode = normalizeCodexThreadServiceTierMode(mode);
    const threadId = validThreadScrollSessionKey(currentSessionRef().session_id);
    if (normalizedMode === "fast") {
      const fastAvailability = codexServiceTierFastAvailability(modelName || codexServiceTierUiModelName(threadId));
      if (!fastAvailability.supported) {
        codexServiceTierMaybeLoadModelCatalog(true);
        showToast(codexServiceTierFastUnsupportedMessage(fastAvailability.modelName), null);
        refreshCodexServiceTierControls();
        return false;
      }
    }
    setCodexThreadServiceTierOverride(threadId, normalizedMode);
    refreshCodexServiceTierControls();
    const target = threadId ? "当前 thread" : "新 thread 草稿";
    showToast(`${target}服务模式：${normalizedMode === "inherit" ? "继承" : normalizedMode}`, null);
    return true;
  }

  function toggleCodexServiceTierFromBadge() {
    if (alunixaXBackendStatus.status !== "ok") {
      showToast("后端未连接，无法切换服务模式", null);
      refreshCodexServiceTierControls();
      return;
    }
    syncCodexServiceTierEffectiveState();
    const nextMode = codexServiceTierState.effectiveMode === "fast" ? "standard" : "fast";
    if (nextMode === "fast") {
      const fastAvailability = codexServiceTierFastAvailability();
      if (!fastAvailability.supported) {
        codexServiceTierMaybeLoadModelCatalog(true);
        showToast(codexServiceTierFastUnsupportedMessage(fastAvailability.modelName), null);
        refreshCodexServiceTierControls();
        return;
      }
    }
    setCodexThreadServiceTierMode(nextMode);
  }

  function codexServiceTierRequestMethods() {
    return new Set(["thread/start", "thread/resume", "turn/start"]);
  }

  function codexServiceTierThreadIdForRequest(method, params, threadIdHint = "") {
    if (method === "thread/start") return validThreadScrollSessionKey(params?.threadId || threadIdHint);
    return validThreadScrollSessionKey(params?.threadId || params?.conversationId || threadIdHint || currentSessionRef().session_id);
  }

  function codexServiceTierOverrideResult(method, params, threadIdHint, mode, requestedServiceTier, modelHint = "") {
    const threadId = codexServiceTierThreadIdForRequest(method, params, threadIdHint);
    const requestedFast = isFastServiceTierValue(requestedServiceTier);
    const modelName = codexServiceTierModelForRequest(params, modelHint);
    // 请求路径是唯一能拿到「本 turn 真正用的模型」的地方，顺手记下来供界面判定使用，
    // 这样线程中途换模型后 UI 下一次刷新就跟得上（issue #1463）。
    codexServiceTierRememberThreadModel(threadId, modelName);
    const fastSupported = !requestedFast || codexServiceTierFastSupportedForModel(modelName);
    return {
      threadId,
      mode,
      serviceTier: requestedFast && fastSupported ? codexFastServiceTierValue() : null,
      requestedServiceTier: requestedServiceTier || null,
      modelName,
      fastSupported,
      fastBlocked: requestedFast && !fastSupported,
    };
  }

  function codexServiceTierOverrideForRequest(method, params, threadIdHint = "") {
    if (!alunixaXSettings().serviceTierControls) return null;
    if (!codexServiceTierRequestMethods().has(method) || !params || typeof params !== "object") return null;
    const state = readThreadServiceTierState();
    const controlMode = normalizeCodexServiceTierControlMode(state.mode);
    const defaultMode = normalizeCodexThreadServiceTierMode(state.defaultMode);
    if (controlMode === "inherit") {
      const inheritedServiceTier = params.serviceTier ?? params.service_tier ?? codexServiceTierInheritedValue();
      const override = codexServiceTierOverrideResult(method, params, threadIdHint, "inherit", inheritedServiceTier);
      return override.fastBlocked ? override : null;
    }
    if (controlMode === "global-standard" || controlMode === "global-fast") {
      return codexServiceTierOverrideResult(
        method,
        params,
        threadIdHint,
        controlMode,
        controlMode === "global-fast" ? codexFastServiceTierValue() : null
      );
    }
    const threadId = codexServiceTierThreadIdForRequest(method, params, threadIdHint);
    const override = threadId ? codexThreadServiceTierOverride(threadId) : codexThreadServiceTierDraft();
    const mode = codexServiceTierEffectiveThreadMode(override?.mode, defaultMode);
    if (mode === "inherit") {
      const inheritedServiceTier = params.serviceTier ?? params.service_tier ?? codexServiceTierInheritedValue();
      const inheritedOverride = codexServiceTierOverrideResult(method, params, threadIdHint, "inherit", inheritedServiceTier);
      return inheritedOverride.fastBlocked ? { ...inheritedOverride, threadId, mode } : null;
    }
    return {
      ...codexServiceTierOverrideResult(method, params, threadIdHint, mode, mode === "fast" ? codexFastServiceTierValue() : null),
      threadId,
      mode,
    };
  }

  function applyCodexServiceTierRequestOnly(method, params, threadIdHint = "") {
    const override = codexServiceTierOverrideForRequest(method, params, threadIdHint);
    if (!override) return params;
    const nextParams = { ...(params || {}), serviceTier: override.serviceTier };
    if (Object.prototype.hasOwnProperty.call(nextParams, "service_tier") || override.fastBlocked) {
      nextParams.service_tier = override.serviceTier;
    }
    sendCodexPlusDiagnostic("service_tier_request_override_applied", {
      method,
      threadId: override.threadId || "",
      mode: override.mode,
      serviceTier: override.serviceTier || "standard",
      model: override.modelName || "",
      fastSupported: override.fastSupported !== false,
      fastBlocked: !!override.fastBlocked,
    });
    return nextParams;
  }

  function applyCodexServiceTierRequestOverride(method, params, threadIdHint = "") {
    const providerParams = applyCodexRemoteSessionProviderOverride(method, params);
    return applyCodexServiceTierRequestOnly(method, providerParams, threadIdHint);
  }

  function codexRemoteSessionActiveProfile() {
    if (!alunixaXBackendSettings.relayProfilesEnabled) return null;
    const profiles = Array.isArray(alunixaXBackendSettings.relayProfiles)
      ? alunixaXBackendSettings.relayProfiles
      : [];
    const activeId = String(alunixaXBackendSettings.activeRelayId || "");
    return profiles.find((item) => String(item?.id || "") === activeId) || null;
  }

  function codexRemoteSessionProviderPatchEnabled() {
    const profile = codexRemoteSessionActiveProfile();
    if (!profile) return false;
    const relayMode = String(profile.relayMode || "");
    return relayMode === "pureApi"
      || (relayMode === "official" && !!profile.officialMixApiKey);
  }

  function codexRemoteSessionProviderNormalizationEnabled() {
    if (!codexRemoteSessionProviderPatchEnabled()) return false;
    const profile = codexRemoteSessionActiveProfile();
    if (String(profile?.relayMode || "") !== "official") return false;
    const sessionProvider = String(
      alunixaXBackendSettings.activeRelaySessionProvider || "custom"
    ).trim().toLowerCase();
    return sessionProvider !== "openai";
  }

  function codexRemoteSessionProviderOverrideEnabled() {
    const profile = codexRemoteSessionActiveProfile();
    if (!profile) return false;
    const relayMode = String(profile.relayMode || "");
    if (relayMode === "pureApi") return true;
    return codexRemoteSessionProviderNormalizationEnabled();
  }

  function codexRelayConfigModelProvider(configContents) {
    const text = String(configContents || "");
    const match = /(?:^|\n)\s*model_provider\s*=\s*["']([^"'\n]+)["']/m.exec(text);
    return match ? String(match[1]).trim() : "";
  }

  function codexRemoteSessionTargetProvider() {
    const profile = codexRemoteSessionActiveProfile();
    const relayMode = String(profile?.relayMode || "");
    // 解析中继实际写进 config.toml 的 model_provider（比如
    // `model_provider = "deepseek"` 配 [model_providers.deepseek]），而不是
    // 假定每个 pureApi 中继都叫 "custom"——那会让恢复会话报
    // "Model provider `custom` not found"。
    //
    // 顺序上先看 profile.configContents 再看 activeRelayCodexProvider：后者是
    // 全局缓存，切换供应商后可能还是上一个的值；profile 是当前这次调用现取的，
    // 更可信。反过来会让 pureApi 恢复会话拿到陈旧 provider。
    const fromConfig = codexRelayConfigModelProvider(profile?.configContents || "");
    if (fromConfig) return fromConfig;
    // pureApi 且 profile 自己没声明供应方时回到 "custom"，不去读可能陈旧的全局缓存。
    if (relayMode === "pureApi") return "custom";
    return String(
      alunixaXBackendSettings.activeRelayCodexProvider
      || codexModelCatalog?.codex_model_provider
      || codexModelCatalog?.codexModelProvider
      || codexModelCatalog?.model_provider
      || codexModelCatalog?.modelProvider
      || (String(profile?.relayMode || "") === "pureApi" ? "custom" : "")
      || ""
    ).trim();
  }

  function codexRemoteSessionProviderRequestMethod(method) {
    return [
      "thread/start",
      "thread/resume",
      "start-conversation",
      "start-thread-for-host",
      "thread-prewarm-start",
      "prewarm-thread-start-for-host",
      "turn/start",
    ].includes(String(method || ""));
  }

  function applyCodexRemoteSessionProviderOverride(method, params) {
    const requestMethod = String(method || "");
    if (!codexRemoteSessionProviderRequestMethod(requestMethod)) return params;
    if (!codexRemoteSessionProviderOverrideEnabled()) return params;
    if (!params || typeof params !== "object" || Array.isArray(params)) return params;
    const profile = codexRemoteSessionActiveProfile();
    const pureApi = String(profile?.relayMode || "") === "pureApi";
    // Pure API 恢复旧会话时必须覆盖持久化的 openai；官登会话保留原生恢复语义。
    if (requestMethod === "thread/resume" && !pureApi) return params;
    if (requestMethod === "turn/start" && !pureApi) return params;
    const hasModelProvider = Object.prototype.hasOwnProperty.call(params, "modelProvider")
      || Object.prototype.hasOwnProperty.call(params, "model_provider");
    if (requestMethod === "turn/start" && !hasModelProvider) return params;
    const targetProvider = codexRemoteSessionTargetProvider();
    if (!targetProvider || targetProvider === "openai") return params;
    const requestedProvider = String(params.modelProvider || params.model_provider || "").trim();
    if (requestedProvider && requestedProvider !== "openai" && requestedProvider !== targetProvider) {
      return params;
    }
    if (requestedProvider === targetProvider && !Object.prototype.hasOwnProperty.call(params, "model_provider")) {
      return params;
    }
    const nextParams = { ...params, modelProvider: targetProvider };
    delete nextParams.model_provider;
    sendCodexPlusDiagnostic("remote_session_provider_override_applied", {
      method: requestMethod,
      from: requestedProvider || "(missing)",
      to: targetProvider,
    });
    return nextParams;
  }

  function codexRemoteSessionStartedThreadId(value) {
    const queue = [{ value, depth: 0 }];
    const seen = new WeakSet();
    while (queue.length > 0) {
      const current = queue.shift();
      const candidate = current?.value;
      if (!candidate || typeof candidate !== "object") continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const method = String(candidate.method || candidate.type || "");
      if (method === "thread/started") {
        const thread = candidate.params?.thread || candidate.thread || candidate.payload?.thread;
        const threadId = String(thread?.id || candidate.params?.threadId || candidate.threadId || "").trim();
        if (threadId) return threadId;
      }
      if (method === "browser-use-session-route-capture") {
        const threadId = String(
          candidate.params?.conversationId
          || candidate.params?.conversation_id
          || candidate.conversationId
          || candidate.conversation_id
          || ""
        ).trim();
        if (threadId) return threadId;
      }
      if (method === "browser-sidebar-browser-use-state") {
        const isActive = candidate.params?.isActive ?? candidate.params?.is_active
          ?? candidate.isActive ?? candidate.is_active;
        if (isActive !== true) continue;
        const threadId = String(
          candidate.params?.conversationId
          || candidate.params?.conversation_id
          || candidate.conversationId
          || candidate.conversation_id
          || ""
        ).trim();
        if (threadId) return threadId;
      }
      if (current.depth >= 4) continue;
      for (const key of ["message", "response", "detail", "data", "payload", "params", "request"]) {
        const nested = candidate[key];
        if (nested && typeof nested === "object") {
          queue.push({ value: nested, depth: current.depth + 1 });
        }
      }
    }
    return "";
  }

  function requestCodexRemoteSessionRecovery(threadId, attempt) {
    const payload = { thread_id: threadId };
    const testHook = window.__ALUNIXA_X_TEST_REMOTE_RECOVERY__;
    const request = typeof testHook === "function"
      ? Promise.resolve(testHook(payload, attempt))
      : postJson("/remote-control-session/recover", payload);
    return request.then((result) => {
      if (attempt === 0
        || result?.message === "Remote Control session recovery complete"
        || result?.message === "Remote Control session catalog recovery complete") {
        sendCodexPlusDiagnostic("remote_session_recovery_requested", {
          threadId,
          attempt,
          status: result?.status || "",
          message: result?.message || "",
          changedSessionFiles: result?.changed_session_files || 0,
          catalogRowsInserted: result?.sqlite_catalog_rows_inserted || 0,
        });
      }
      return result;
    }).catch((error) => {
      if (attempt === 0) {
        sendCodexPlusDiagnostic("remote_session_recovery_failed", {
          threadId,
          attempt,
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
      }
      return null;
    });
  }

  function scheduleCodexRemoteSessionRecovery(threadId) {
    if (!codexRemoteSessionProviderNormalizationEnabled()) return false;
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId || normalizedThreadId.length > 128) return false;
    window.__alunixaXRemoteSessionRecoveryPending = window.__alunixaXRemoteSessionRecoveryPending || new Map();
    const pending = window.__alunixaXRemoteSessionRecoveryPending;
    if (pending.has(normalizedThreadId)) return false;
    const retryOffsets = [100, 350, 800, 1600, 3000];
    const state = { timer: 0 };
    const finish = () => {
      if (state.timer) window.clearTimeout(state.timer);
      state.timer = 0;
      if (pending.get(normalizedThreadId) === state) pending.delete(normalizedThreadId);
    };
    const runAttempt = async (attempt) => {
      state.timer = 0;
      if (!codexRemoteSessionProviderNormalizationEnabled()) {
        finish();
        return;
      }
      const result = await requestCodexRemoteSessionRecovery(normalizedThreadId, attempt);
      const message = String(result?.message || "");
      if (message === "Remote Control session recovery complete"
        || message === "Remote Control session catalog recovery complete"
        || message === "Remote Control session recovery is disabled for the active profile") {
        finish();
        return;
      }
      const nextAttempt = attempt + 1;
      if (nextAttempt >= retryOffsets.length) {
        finish();
        return;
      }
      const nextDelay = retryOffsets[nextAttempt] - retryOffsets[attempt];
      state.timer = window.setTimeout(() => void runAttempt(nextAttempt), nextDelay);
    };
    state.timer = window.setTimeout(() => void runAttempt(0), retryOffsets[0]);
    pending.set(normalizedThreadId, state);
    return true;
  }

  function observeCodexRemoteSessionNotification(value) {
    const threadId = codexRemoteSessionStartedThreadId(value);
    return threadId ? scheduleCodexRemoteSessionRecovery(threadId) : false;
  }

  function installCodexRemoteSessionRecoveryListener() {
    if (window.__alunixaXRemoteSessionRecoveryInstalled === codexRemoteSessionRecoveryVersion) return true;
    if (window.__alunixaXRemoteSessionRecoveryMessageHandler) {
      window.removeEventListener("message", window.__alunixaXRemoteSessionRecoveryMessageHandler, true);
    }
    if (window.__alunixaXRemoteSessionRecoveryViewHandler) {
      window.removeEventListener("codex-message-from-view", window.__alunixaXRemoteSessionRecoveryViewHandler, true);
    }
    const messageHandler = (event) => {
      if (event?.source !== window) return false;
      const origin = String(event?.origin || "");
      if (origin && origin !== "null" && origin !== window.location.origin) return false;
      return observeCodexRemoteSessionNotification(event?.data);
    };
    const viewHandler = (event) => observeCodexRemoteSessionNotification(event?.detail);
    window.__alunixaXRemoteSessionRecoveryMessageHandler = messageHandler;
    window.__alunixaXRemoteSessionRecoveryViewHandler = viewHandler;
    window.addEventListener("message", messageHandler, true);
    window.addEventListener("codex-message-from-view", viewHandler, true);
    window.__alunixaXRemoteSessionRecoveryInstalled = codexRemoteSessionRecoveryVersion;
    sendCodexPlusDiagnostic("remote_session_recovery_listener_installed", {
      version: codexRemoteSessionRecoveryVersion,
    });
    return true;
  }

  function installCodexRemoteSessionDispatcherSubscription(dispatcher, assetPrefix = "") {
    if (!dispatcher || typeof dispatcher.subscribe !== "function") return false;
    if (window.__alunixaXRemoteSessionRecoveryDispatcher === dispatcher
        && window.__alunixaXRemoteSessionRecoveryDispatcherVersion === codexRemoteSessionRecoveryVersion) {
      return true;
    }
    if (typeof window.__alunixaXRemoteSessionRecoveryDispatcherUnsubscribe === "function") {
      try {
        window.__alunixaXRemoteSessionRecoveryDispatcherUnsubscribe();
      } catch {
      }
    }
    const handler = (payload) => {
      if (observeCodexRemoteSessionNotification(payload)) return true;
      const params = payload && typeof payload === "object" ? payload : {};
      if (observeCodexRemoteSessionNotification({
        method: "thread/started",
        params,
      })) return true;
      return observeCodexRemoteSessionNotification({
        method: "thread/started",
        params: { thread: params },
      });
    };
    const browserUseHandler = (payload) => observeCodexRemoteSessionNotification({
      type: "browser-sidebar-browser-use-state",
      params: payload && typeof payload === "object" ? payload : {},
    });
    const unsubscribers = [
      dispatcher.subscribe("thread/started", handler),
      dispatcher.subscribe("browser-sidebar-browser-use-state", browserUseHandler),
    ];
    window.__alunixaXRemoteSessionRecoveryDispatcher = dispatcher;
    window.__alunixaXRemoteSessionRecoveryDispatcherHandler = handler;
    window.__alunixaXRemoteSessionRecoveryDispatcherUnsubscribe = () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe !== "function") continue;
        try {
          unsubscribe();
        } catch {
        }
      }
    };
    window.__alunixaXRemoteSessionRecoveryDispatcherVersion = codexRemoteSessionRecoveryVersion;
    sendCodexPlusDiagnostic("remote_session_dispatcher_subscription_installed", { assetPrefix });
    return true;
  }

  function codexServiceTierRequestOverride(message, skipFetchEnvelope = false) {
    if (!message || typeof message !== "object") return message;
    if (!skipFetchEnvelope && message.type === "fetch" && typeof message.url === "string") {
      const urlPrefix = "vscode://codex/";
      if (!message.url.startsWith(urlPrefix)) return message;
      const requestType = message.url.slice(urlPrefix.length).split(/[?#]/, 1)[0];
      let params = null;
      let bodyWasString = false;
      if (typeof message.body === "string") {
        try {
          params = JSON.parse(message.body);
          bodyWasString = true;
        } catch (_) {
          return message;
        }
      } else if (message.body && typeof message.body === "object") {
        params = message.body;
      } else {
        return message;
      }
      if (!params || typeof params !== "object" || Array.isArray(params)) return message;
      const bodyHadType = Object.prototype.hasOwnProperty.call(params, "type");
      const originalBodyType = params.type;
      const logicalMessage = { ...params, type: requestType };
      const patchedMessage = codexServiceTierRequestOverride(logicalMessage, true);
      if (patchedMessage === logicalMessage) return message;
      const nextParams = { ...patchedMessage };
      delete nextParams.type;
      if (bodyHadType) nextParams.type = originalBodyType;
      return {
        ...message,
        body: bodyWasString ? JSON.stringify(nextParams) : nextParams,
      };
    }
    if (message.type === "send-cli-request-for-host") {
      const method = String(message.method || "");
      const params = applyCodexServiceTierRequestOverride(method, message.params);
      return params === message.params ? message : { ...message, params };
    }
    if (message.type === "mcp-request" && message.request && typeof message.request === "object") {
      const method = String(message.request.method || "");
      const params = applyCodexServiceTierRequestOverride(method, message.request.params);
      if (params === message.request.params) return message;
      return { ...message, request: { ...message.request, params } };
    }
    if (message.type === "worker-request" && message.request && typeof message.request === "object") {
      const method = String(message.request.method || "");
      const params = applyCodexServiceTierRequestOverride(method, message.request.params);
      if (params === message.request.params) return message;
      return { ...message, request: { ...message.request, params } };
    }
    if (message.type === "thread-prewarm-start" && message.request && typeof message.request === "object") {
      const params = applyCodexServiceTierRequestOverride("thread/start", message.request.params);
      if (params === message.request.params) return message;
      return { ...message, request: { ...message.request, params } };
    }
    if (message.type === "start-conversation") {
      const nextMessage = applyCodexServiceTierRequestOverride("thread/start", message);
      return nextMessage === message ? message : nextMessage;
    }
    if (message.type === "prewarm-thread-start-for-host" && message.params && typeof message.params === "object") {
      const params = applyCodexServiceTierRequestOverride("thread/start", message.params);
      return params === message.params ? message : { ...message, params };
    }
    if (message.type === "start-thread-for-host") {
      const params = applyCodexServiceTierRequestOverride("thread/start", message);
      return params === message ? message : params;
    }
    if (message.type === "start-turn-for-host" && message.params && typeof message.params === "object") {
      const params = applyCodexServiceTierRequestOverride("turn/start", message.params, message.conversationId);
      return params === message.params ? message : { ...message, params };
    }
    return message;
  }

  function codexServiceTierDispatcherFromModule(module) {
    const directSingleton = module?.idt;
    if (directSingleton
        && typeof directSingleton === "object"
        && typeof directSingleton.dispatchMessage === "function"
        && typeof directSingleton.subscribe === "function") {
      return directSingleton;
    }
    const values = module && typeof module === "object" ? Object.values(module) : [];
    const singleton = values.find((candidate) => candidate
      && typeof candidate === "object"
      && typeof candidate.dispatchMessage === "function"
      && typeof candidate.subscribe === "function");
    if (singleton) return singleton;
    const dispatcherClass = values.find((candidate) => typeof candidate === "function"
      && typeof candidate.getInstance === "function"
      && typeof candidate.prototype?.dispatchMessage === "function");
    return dispatcherClass?.getInstance?.() || null;
  }

  const serviceTierDispatcherPatchMaxMisses = 8;
  let serviceTierDispatcherPatchMissCount = 0;
  let serviceTierDispatcherPatchDisabled = false;
  let serviceTierDispatcherPatchPromise = null;

  function codexServiceTierDispatcherPatchable(dispatcher) {
    if (!dispatcher || typeof dispatcher !== "object") return false;
    try {
      if (!Object.isExtensible(dispatcher)) return false;
      for (const key of ["__codexServiceTierOriginalDispatchMessage", "dispatchMessage"]) {
        const descriptor = Object.getOwnPropertyDescriptor(dispatcher, key);
        if (descriptor && descriptor.writable === false && typeof descriptor.set !== "function") return false;
      }
      return true;
    } catch {
      // Codex 26.908 RPC stubs can throw even while being inspected.
      return false;
    }
  }

  // issue #1960：这是 installAppServerModelRequestPatch（#1324）和插件市场那两层的同一个缺陷。
  // 补丁挂在 scanLightweight() 里每轮都跑，而早退守卫只在装上之后才写入，
  // Codex 侧 asset 改名后就永远装不上，于是每轮 scan 重新拉一遍全部 app asset，
  // 而且每轮都发一条相同的诊断。首次失败仍上报以便定位，之后噤声，连续失败够多次就停掉这一层。
  function installCodexServiceTierDispatcherPatch() {
    if (window.__codexServiceTierRequestOverrideInstalled === codexServiceTierRequestOverrideVersion) return;
    if (serviceTierDispatcherPatchDisabled) return;
    // 上一轮没跑完就不要再起一轮：loadDispatcher() 会依次试有界的四个前缀，
    // 没有这道去重时 scan 的频率就直接变成并发全量扫描的频率。
    if (serviceTierDispatcherPatchPromise) return;
    const loadDispatcher = async () => {
      const errors = [];
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
      throw new Error(`Codex dispatcher unavailable (${errors.join("; ")})`);
    };
    const patch = async () => {
      try {
        const { dispatcher, assetPrefix } = await loadDispatcher();
        if (!codexServiceTierDispatcherPatchable(dispatcher)) {
          throw new Error(`dispatcher is a non-writable RPC stub (${assetPrefix})`);
        }
        if (!dispatcher.__codexServiceTierOriginalDispatchMessage) {
          dispatcher.__codexServiceTierOriginalDispatchMessage = dispatcher.dispatchMessage.bind(dispatcher);
        }
        dispatcher.dispatchMessage = (type, payload) => {
          return dispatchCodexPlusMessage(dispatcher, type, payload);
        };
        installCodexRemoteSessionDispatcherSubscription(dispatcher, assetPrefix);
        window.__codexServiceTierRequestOverrideInstalled = codexServiceTierRequestOverrideVersion;
        serviceTierDispatcherPatchMissCount = 0;
        sendCodexPlusDiagnostic("service_tier_dispatcher_patch_installed", { assetPrefix });
      } catch (error) {
        serviceTierDispatcherPatchMissCount += 1;
        if (serviceTierDispatcherPatchMissCount === 1) {
          sendCodexPlusDiagnostic("service_tier_dispatcher_patch_failed", {
            errorName: error?.name || "",
            errorMessage: error?.message || String(error),
          });
        }
        if (serviceTierDispatcherPatchMissCount >= serviceTierDispatcherPatchMaxMisses
            && !serviceTierDispatcherPatchDisabled) {
          serviceTierDispatcherPatchDisabled = true;
          sendCodexPlusDiagnostic("service_tier_dispatcher_patch_skipped", {
            misses: serviceTierDispatcherPatchMissCount,
          });
        }
      } finally {
        serviceTierDispatcherPatchPromise = null;
      }
    };
    serviceTierDispatcherPatchPromise = patch();
  }

  // 保留旧调用入口，语音能力由独立的 opt-in 控件提供。
  function installDictationSupportPatch() {
    installCodexPlusDictation();
  }

  const codexAppServerPreparationTimeoutMs = 2000;

  // 发送前只读取辅助配置；桥接无回包时及时降级，迟到的结果也不再应用。
  // 写 RPC（尤其 thread/resume）不能这样竞速，否则会在 turn/start 后迟到修改会话。
  async function readCodexAppServerPreparation(path, payload, timeoutMs = codexAppServerPreparationTimeoutMs) {
    let timeoutId;
    try {
      return await Promise.race([
        postJson(path, payload),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            sendCodexPlusDiagnostic("app_server_preparation_read_timeout", { path, timeoutMs });
            reject(new Error(`Alunixa X preparation read timed out: ${path}`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function loadBackendSettingsState(timeoutMs = 0) {
    const seq = alunixaXBackendSettingsSeq;
    try {
      const settings = await (timeoutMs > 0
        ? readCodexAppServerPreparation("/settings/get", {}, timeoutMs)
        : postJson("/settings/get", {}));
      if (!settings || typeof settings !== "object" || (!("enhancementsEnabled" in settings) && !("providerSyncEnabled" in settings))) {
        throw new Error("invalid backend settings response");
      }
      if (seq !== alunixaXBackendSettingsSeq) {
        return false;
      }
      alunixaXBackendSettings = { ...alunixaXBackendSettings, ...settings };
      alunixaXBackendSettingsLoaded = true;
    } catch (_) {
      return false;
    }
    // 设置已加载成功；语音 UI 的异常不应使 provider/Fast 刷新误判为失败。
    // service-tier harness 在 70 分片提前返回，尚未初始化 93 分片的录音状态。
    if (!window.__ALUNIXA_X_TEST_SERVICE_TIER__) runScanStep(installCodexPlusDictation);
    return true;
  }
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
  async function loadBackendSettings() {
    const loaded = await loadBackendSettingsState();
    if (loaded && codexRemoteSessionProviderOverrideEnabled()) {
      void loadCodexModelCatalog();
    }
    refreshCodexPlusBackendToggles();
    // 输入框徽标可先于增强设置页出现；后端设置就绪后启动服务模式读取，
    // 不再依赖打开设置页才能结束初始的“正在读取…”。
    if (loaded) void loadCodexServiceTierState();
    if (loaded) syncOfficialUsagePolicy();
    if (loaded) runScanStep(syncCodexPlusTypingEffects);
    if (loaded && typeof syncCodexPlusWhaleWidget === "function") runScanStep(syncCodexPlusWhaleWidget);
    return loaded;
  }

  function loadBackendSettingsForStartup(attempt = 0) {
    loadBackendSettings().then((loaded) => {
      if (loaded) {
        scan();
        return;
      }
      if (attempt < 60) {
        setTimeout(() => loadBackendSettingsForStartup(attempt + 1), 250);
      }
    });
  }

  let syncBackendSettingsInFlight = false;
  async function syncBackendSettingsFromHeartbeat() {
    if (syncBackendSettingsInFlight) return;
    syncBackendSettingsInFlight = true;
    try {
      const previousConversationView = !!alunixaXSettings().conversationView;
      const previousServiceTierControls = !!alunixaXSettings().serviceTierControls;
      const loaded = await loadBackendSettingsState();
      if (loaded) {
        if (previousServiceTierControls !== !!alunixaXSettings().serviceTierControls) {
          void loadCodexServiceTierState();
          if (!alunixaXSettings().serviceTierControls) removeCodexServiceTierBadges();
        }
        syncOfficialUsagePolicy();
        runScanStep(syncCodexPlusTypingEffects);
        if (typeof syncCodexPlusWhaleWidget === "function") runScanStep(syncCodexPlusWhaleWidget);
        renderCodexPlusMenu();
        if (previousConversationView !== !!alunixaXSettings().conversationView) {
          refreshConversationView();
        }
      }
    } finally {
      syncBackendSettingsInFlight = false;
    }
  }

  async function setBackendSetting(key, value) {
    const previousServiceTierControls = !!alunixaXSettings().serviceTierControls;
    const seq = ++alunixaXBackendSettingsSeq;
    alunixaXBackendSettings = { ...alunixaXBackendSettings, [key]: value };
    alunixaXBackendSettingsLoaded = true;
    refreshCodexPlusBackendToggles();
    if (previousServiceTierControls !== !!alunixaXSettings().serviceTierControls) {
      void loadCodexServiceTierState();
      if (!alunixaXSettings().serviceTierControls) removeCodexServiceTierBadges();
    }
    try {
      const settings = await postJson("/settings/set", { [key]: value });
      if (seq === alunixaXBackendSettingsSeq) {
        const previousServiceTierControls = !!alunixaXSettings().serviceTierControls;
        alunixaXBackendSettings = { ...alunixaXBackendSettings, ...settings };
        if (previousServiceTierControls !== !!alunixaXSettings().serviceTierControls) {
          void loadCodexServiceTierState();
          if (!alunixaXSettings().serviceTierControls) removeCodexServiceTierBadges();
        }
      }
    } finally {
      refreshCodexPlusBackendToggles();
    }
  }

  function refreshCodexPlusBackendToggles() {
    document.querySelectorAll(".alunixa-x-toggle[data-codex-backend-setting]").forEach((button) => {
      const key = button.getAttribute("data-codex-backend-setting");
      button.dataset.enabled = String(!!alunixaXBackendSettings[key]);
      button.setAttribute("aria-checked", button.dataset.enabled);
    });
    syncStepwisePanel();
    runScanStep(syncCodexPlusTypingEffects);
    if (typeof syncCodexPlusWhaleWidget === "function") runScanStep(syncCodexPlusWhaleWidget);
    renderCodexPlusMenu();
    scan();
  }

  let alunixaXUserScripts = { enabled: true, builtin_dir: "", user_dir: "", scripts: [] };
  // 单独跟踪「读过了没有」：scripts 为空既可能是真没有脚本，也可能是还没读到。
  // 不区分就会在无后端时把「正在读取」直接显示成「未发现」。
  let alunixaXUserScriptsLoaded = false;
  // 市场清单。为空 + 未加载 = 还在拉；加载过为空 = 市场里确实没东西。
  let alunixaXScriptMarket = { scripts: [], loaded: false, loading: false, message: "" };
  // 「拓展」页左面板的搜索关键词，纯前端过滤。
  let alunixaXExtensionsQuery = "";
  let alunixaXExtensionsFilter = "market";
  // 当前选中的拓展（左面板点开后右侧显示详情）。空 = 还没选。
  let alunixaXExtensionsSelected = null;
  // 默认扩展图标：VSCode codicon 的 `extensions` 字形（\eae6），
  // 从本机 VSCode 的 codicon.ttf 抽出轮廓后归一到 16x16 视口。
  // 市场清单目前没有图标字段，所有市场条目都用它；本地脚本同理。
  const alunixaXDefaultExtensionIconPath = "M15.0 4.95 Q15.0 4.37 14.63 3.99 L12.01 1.37 Q11.63 1.0 11.05 1.0 Q10.46 1.0 10.08 1.37 L8.0 3.46 L8.0 3.3 Q8.0 2.71 7.6 2.31 Q7.2 1.91 6.61 1.91 L2.39 1.91 Q1.8 1.91 1.4 2.31 Q1.0 2.71 1.0 3.3 L1.0 13.61 Q1.0 14.2 1.4 14.6 Q1.8 15.0 2.39 15.0 L12.7 15.0 Q13.24 15.0 13.66 14.6 Q14.09 14.2 14.09 13.61 L14.09 9.39 Q14.09 8.8 13.66 8.4 Q13.24 8.0 12.7 8.0 L12.54 8.0 L14.63 5.92 Q15.0 5.54 15.0 4.95 Z M2.39 2.87 L6.61 2.87 Q6.77 2.87 6.93 3.0 Q7.09 3.14 7.09 3.3 L7.09 8.0 L1.91 8.0 L1.91 3.3 Q1.91 3.14 2.04 3.0 Q2.18 2.87 2.39 2.87 Z M1.91 13.61 L1.91 8.91 L7.09 8.91 L7.09 14.09 L2.39 14.09 Q2.18 14.09 2.04 13.96 Q1.91 13.82 1.91 13.61 Z M13.13 9.39 L13.13 13.61 Q13.13 13.82 13.0 13.96 Q12.86 14.09 12.7 14.09 L8.0 14.09 L8.0 8.91 L12.7 8.91 Q12.86 8.91 13.0 9.07 Q13.13 9.23 13.13 9.39 Z M8.0 8.0 L8.0 6.45 L9.55 8.0 Z M13.93 5.27 L11.37 7.84 Q11.21 8.0 11.02 8.0 Q10.83 8.0 10.73 7.84 L8.11 5.27 Q8.0 5.11 8.0 4.93 Q8.0 4.74 8.11 4.63 L10.73 2.02 Q10.83 1.91 11.02 1.91 Q11.21 1.91 11.37 2.02 L13.93 4.63 Q14.09 4.74 14.09 4.93 Q14.09 5.11 13.93 5.27 Z";
  let alunixaXBackendStatus = window.__alunixaXBackendStatus || { status: "checking", message: "正在检查后端…" };
  let alunixaXBackendCheckSeq = 0;
  let alunixaXBackendCheckInFlight = false;
  let alunixaXBackendFailureCount = 0;
  const ALUNIXA_X_BACKEND_FAILURE_THRESHOLD = 3;
  // 桥接通道（binding）与后端可用性分开统计：HTTP 回落成功会让后端状态保持绿色，
  // 但桥接持续失败时必须把降级呈现出来，否则启动器侧的重注入修复循环对用户完全不可见（issue #2169）。
  let alunixaXBridgeFailureCount = 0;
  const ALUNIXA_X_BRIDGE_FAILURE_THRESHOLD = 3;
  const alunixaXBackendGeneration = (Number(window.__alunixaXBackendGeneration) || 0) + 1;
  window.__alunixaXBackendGeneration = alunixaXBackendGeneration;

  function recordCodexPlusBridgeHealth(field) {
    if (alunixaXBackendGeneration !== window.__alunixaXBackendGeneration) return;
    const health = window.__alunixaXBridgeHealth || (window.__alunixaXBridgeHealth = {});
    health[field] = Date.now();
  }

  function recordCodexPlusBridgeSuccess() {
    recordCodexPlusBridgeHealth("lastSuccessAt");
    alunixaXBridgeFailureCount = 0;
  }

  function recordCodexPlusBridgeAttempt() {
    recordCodexPlusBridgeHealth("lastAttemptAt");
  }

  function recordCodexPlusBridgeFailure() {
    alunixaXBridgeFailureCount += 1;
  }

  function renderBackendStatus() {
    const bridgeDegraded = alunixaXBridgeFailureCount >= ALUNIXA_X_BRIDGE_FAILURE_THRESHOLD;
    const rawStatus = alunixaXBackendStatus.status || "failed";
    const status = bridgeDegraded && rawStatus === "ok" ? "degraded" : rawStatus;
    if (alunixaXBackendStatus.version) {
      alunixaXVersion = alunixaXBackendStatus.version;
      document.querySelectorAll("[data-alunixa-x-version]").forEach((node) => {
        node.textContent = `Alunixa X ${alunixaXVersion}`;
      });
    }
    const labelFallback = status === "ok" ? "后端已连接" : status === "degraded" ? "桥接降级，自动修复中" : status === "checking" ? "正在检查后端…" : "未连接";
    const label = document.querySelector("[data-codex-backend-status]");
    if (label) {
      label.dataset.status = status;
      label.textContent = status === "degraded" ? labelFallback : (alunixaXBackendStatus.message || labelFallback);
    }
    document.querySelectorAll("[data-codex-backend-indicator]").forEach((indicator) => {
      indicator.dataset.status = status;
      indicator.title = status === "ok" ? "后端已连接" : status === "degraded" ? "后端可达，桥接降级，正在自动修复" : status === "checking" ? "正在检查后端" : "未连接";
    });
    const sidebarStatus = document.querySelector(`#${alunixaXSidebarNavId} .alunixa-x-sidebar-nav-status`);
    if (sidebarStatus) {
      sidebarStatus.dataset.status = status;
      sidebarStatus.title = status === "ok" ? "后端已连接" : status === "degraded" ? "后端可达，桥接降级，正在自动修复" : status === "checking" ? "正在检查后端" : "未连接";
    }
    refreshCodexServiceTierControls();
  }

  function withBackendTimeout(request) {
    return Promise.race([
      request,
      new Promise((resolve) => setTimeout(() => resolve({ status: "failed", message: "后端检查超时", timeout: true }), 2000)),
    ]);
  }

  async function checkBackendStatus() {
    if (alunixaXBackendCheckInFlight) return;
    alunixaXBackendCheckInFlight = true;
    const seq = ++alunixaXBackendCheckSeq;
    try {
      const nextStatus = await postJson("/backend/status", {});
      if (seq !== alunixaXBackendCheckSeq || alunixaXBackendGeneration !== window.__alunixaXBackendGeneration) return;
      if (nextStatus?.status === "ok") {
        alunixaXBackendFailureCount = 0;
        alunixaXBackendStatus = window.__alunixaXBackendStatus = nextStatus;
        if (typeof nextStatus.hideOfficialUsageAlert === "boolean") {
          window.__ALUNIXA_X_HIDE_OFFICIAL_USAGE_ALERT__ = nextStatus.hideOfficialUsageAlert;
          syncOfficialUsagePolicy();
        }
        void syncBackendSettingsFromHeartbeat();
      } else {
        alunixaXBackendFailureCount += 1;
        sendCodexPlusDiagnostic("backend_check_failed", {
          status: nextStatus?.status || "unknown",
          message: nextStatus?.message || "",
          timeout: !!nextStatus?.timeout,
          consecutiveFailures: alunixaXBackendFailureCount,
        });
        if (alunixaXBackendFailureCount >= ALUNIXA_X_BACKEND_FAILURE_THRESHOLD) {
          alunixaXBackendStatus = window.__alunixaXBackendStatus = nextStatus;
        }
      }
      renderBackendStatus();
    } finally {
      alunixaXBackendCheckInFlight = false;
    }
  }

  async function openManagerFromCodex() {
    const result = await postJson("/manager/open", {});
    if (result.status === "ok") {
      showToast("管理工具已打开", null);
    } else {
      showToast(result.message || "打开管理工具失败", null);
    }
  }

  function scheduleBackendHeartbeat() {
    if (alunixaXBackendGeneration !== window.__alunixaXBackendGeneration) return;
    if (window.__alunixaXBackendHeartbeat &&
        window.__alunixaXBackendHeartbeatGeneration === alunixaXBackendGeneration) return;
    if (window.__alunixaXBackendHeartbeat) clearInterval(window.__alunixaXBackendHeartbeat);
    window.__alunixaXBackendHeartbeatGeneration = alunixaXBackendGeneration;
    window.__alunixaXBackendHeartbeat = setInterval(checkBackendStatus, 5000);
    checkBackendStatus();
  }

  function userScriptStatusLabel(status) {
    return { loaded: "已加载", failed: "失败", disabled: "已禁用", not_loaded: "未加载", loading: "加载中" }[status] || status || "未知";
  }

  // 使用已安装 Lucide Search / RotateCw / Plus / ArrowLeft 的 ISC 图标路径。
  const alunixaXDiscoveryIcons = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5"/></svg>',
  };

  /** 原生风格侧栏：浏览入口和已安装拓展的单行名称。 */
  function renderCodexPlusExtensionsNav() {
    const { installed } = alunixaXExtensionsEntries();
    const shown = filterCodexPlusExtensionsEntries(installed);
    const rows = shown.map((entry) => {
      const selected = alunixaXExtensionsSelected?.kind === "installed" && alunixaXExtensionsSelected.key === entry.key;
      const marketItem = alunixaXExtensionMarketItem(entry);
      return `
        <button type="button" class="alunixa-x-page-nav-item alunixa-x-extensions-nav-entry" data-codex-extensions-select="installed:${escapeHtml(entry.key)}" data-active="${String(selected)}" title="${escapeHtml(entry.name)}" aria-label="${escapeHtml(entry.name)}">
          <span class="alunixa-x-page-nav-item-icon" aria-hidden="true">${extensionIconMarkup(marketItem?.icon)}</span>
          <span class="alunixa-x-page-nav-item-text"><span class="alunixa-x-page-nav-item-name">${escapeHtml(entry.name)}</span></span>
          <span class="alunixa-x-page-nav-item-state" data-state="${entry.enabled ? "on" : "off"}" title="${entry.enabled ? "已启用" : "已禁用"}"></span>
        </button>
      `;
    }).join("");
    const empty = alunixaXExtensionsQuery.trim() ? "没有匹配的已安装拓展。" : alunixaXUserScriptsLoaded ? "未发现已安装的拓展。" : "正在读取用户拓展…";
    return `
      <button type="button" class="alunixa-x-page-nav-item alunixa-x-extensions-nav-entry" data-codex-extensions-browse="market" data-active="${String(!alunixaXExtensionsSelected && alunixaXExtensionsFilter === "market")}" title="浏览拓展" aria-label="浏览拓展">
        <span class="alunixa-x-page-nav-item-icon" aria-hidden="true">${extensionIconSvg()}</span>
        <span class="alunixa-x-page-nav-item-text"><span class="alunixa-x-page-nav-item-name">浏览拓展</span></span>
      </button>
      <div class="alunixa-x-page-nav-group">
        <div class="alunixa-x-page-nav-group-head"><span>已安装</span><span class="alunixa-x-page-nav-group-count">${installed.length}</span></div>
        ${rows || `<div class="alunixa-x-page-nav-empty">${escapeHtml(empty)}</div>`}
      </div>
    `;
  }

  /** 主区使用原生插件列表的图标、简介和独立操作列，避免嵌套按钮。 */
  function renderCodexPlusExtensionsOverview() {
    const { installed, market } = alunixaXExtensionsEntries();
    const isInstalled = alunixaXExtensionsFilter === "installed";
    const entries = filterCodexPlusExtensionsEntries(isInstalled ? installed : market);
    const cards = entries.map((entry) => {
      const item = alunixaXExtensionMarketItem(entry);
      const description = item?.description || entry.script?.description || entry.meta || "";
      const select = `${entry.kind}:${escapeHtml(entry.key)}`;
      const action = entry.kind === "market"
        ? `<button type="button" class="alunixa-x-discovery-icon-button" data-codex-market-install="${escapeHtml(entry.key)}" aria-label="安装 ${escapeHtml(entry.name)}" title="安装 ${escapeHtml(entry.name)}">${alunixaXDiscoveryIcons.plus}</button>`
        : `<button type="button" class="alunixa-x-toggle" data-codex-user-script-key="${escapeHtml(entry.key)}" data-enabled="${String(entry.enabled)}" role="switch" aria-checked="${String(entry.enabled)}" aria-label="启用 ${escapeHtml(entry.name)}"><span></span></button>`;
      return `
        <article class="alunixa-x-extension-card">
          <button type="button" class="alunixa-x-extension-card-select" data-codex-extensions-select="${select}" aria-label="查看 ${escapeHtml(entry.name)}">
            <span class="alunixa-x-extension-card-icon" aria-hidden="true">${extensionIconMarkup(item?.icon)}</span>
            <span class="alunixa-x-extension-card-copy">
              <span class="alunixa-x-extension-card-title">${escapeHtml(entry.name)}</span>
              <span class="alunixa-x-extension-card-description">${escapeHtml(description)}</span>
            </span>
          </button>
          <div class="alunixa-x-extension-card-actions">${action}</div>
        </article>
      `;
    }).join("");
    const empty = alunixaXExtensionsQuery.trim() ? `没有匹配「${alunixaXExtensionsQuery}」的拓展。`
      : isInstalled ? (alunixaXUserScriptsLoaded ? "未发现已安装的拓展。" : "正在读取用户拓展…")
      : alunixaXScriptMarket.loading && !alunixaXScriptMarket.loaded ? "正在读取拓展…"
      : alunixaXScriptMarket.message || "市场里没有可安装的拓展。";
    return `
      <div class="alunixa-x-extensions-filter" role="group" aria-label="拓展来源">
        <button type="button" data-codex-extensions-browse="market" data-active="${String(!isInstalled)}" aria-pressed="${String(!isInstalled)}">市场</button>
        <button type="button" data-codex-extensions-browse="installed" data-active="${String(isInstalled)}" aria-pressed="${String(isInstalled)}">已安装</button>
      </div>
      <h2 class="alunixa-x-discovery-section-title">${isInstalled ? "已安装拓展" : "市场拓展"}</h2>
      <div class="alunixa-x-extensions-grid" data-alunixa-x-extensions-list="true">
        ${cards || `<div class="alunixa-x-extensions-detail-empty" role="status">${escapeHtml(empty)}</div>`}
      </div>
    `;
  }

  /** 只刷新侧栏和结果区；搜索输入框保持原 DOM 与光标位置。 */
  function refreshCodexPlusExtensionsView() {
    if (alunixaXActiveEntry() !== "extensions") return;
    if (alunixaXExtensionsSelected && !alunixaXExtensionsSelectionDetail()) alunixaXExtensionsSelected = null;
    const active = document.activeElement;
    const focused = active?.getAttribute?.("data-codex-user-script-key");
    const focusedBrowse = active?.getAttribute?.("data-codex-extensions-browse");
    const focusedNav = !!active?.closest?.("[data-alunixa-x-page-nav-body]");
    const body = document.querySelector("[data-alunixa-x-page-nav-body]");
    if (body) body.innerHTML = renderCodexPlusExtensionsNav();
    const detail = document.querySelector("[data-alunixa-x-extensions-detail]");
    if (detail) detail.innerHTML = renderCodexPlusExtensionsDetail();
    if (focused) {
      Array.from(detail?.querySelectorAll("[data-codex-user-script-key]") || [])
        .find((button) => button.getAttribute("data-codex-user-script-key") === focused)?.focus({ preventScroll: true });
    } else if (focusedBrowse) {
      Array.from((focusedNav ? body : detail)?.querySelectorAll("[data-codex-extensions-browse]") || [])
        .find((button) => button.getAttribute("data-codex-extensions-browse") === focusedBrowse)?.focus({ preventScroll: true });
    }
  }

  /**
   * 解析当前选中项，拿到本地脚本与市场条目两边的信息。
   *
   * 已安装的市场脚本，本地清单里有 `market_id`，据此把市场的描述/作者等补上；
   * 纯本地脚本则只有本地那几个字段。
   */
  function alunixaXExtensionsSelectionDetail() {
    const sel = alunixaXExtensionsSelected;
    if (!sel) return null;
    const local = sel.kind === "installed"
      ? (alunixaXUserScripts.scripts || []).find((script) => script.key === sel.key) || null
      : null;
    const marketId = sel.kind === "market" ? sel.key : (local?.market_id || "");
    const marketItem = marketId
      ? (alunixaXScriptMarket.scripts || []).find((item) => item.id === marketId) || null
      : null;
    if ((sel.kind === "installed" && !local) || (sel.kind === "market" && !marketItem)) return null;
    return { sel, local, marketItem };
  }

  function extensionIconSvg() {
    return `<svg viewBox="0 0 16 16" fill="currentColor"><path d="${alunixaXDefaultExtensionIconPath}"/></svg>`;
  }

  /**
   * 条目图标：市场清单给了 `icon` 就用它，否则回退 VSCode 的默认扩展字形。
   *
   * 回退是必须的——清单里的老条目没有这个字段，而且 icon 指的是外链，
   * 加载失败时若不兜底就会留一块空白。失败替换交给委托监听（见 handleExtensionIconError），
   * 不用内联 onerror，避免在字符串拼 HTML 时引入另一处转义面。
   */
  function extensionIconMarkup(icon) {
    const url = String(icon || "").trim();
    if (!url) return extensionIconSvg();
    return `<img class="alunixa-x-extensions-icon-img" src="${escapeHtml(url)}" alt="" loading="lazy" />`;
  }

  /**
   * 图标加载失败时换回默认字形。
   *
   * `error` 事件不冒泡，只能在捕获阶段用委托收到；换掉节点本身即可，
   * 再失败也不会递归——替换出来的 svg 不触发 error。
   */
  function handleExtensionIconError(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("alunixa-x-extensions-icon-img")) return;
    const holder = document.createElement("span");
    holder.innerHTML = extensionIconSvg();
    const svg = holder.firstElementChild;
    if (svg) img.replaceWith(svg);
  }

  /** 原生风格详情：居中展示图标、名称、介绍与管理操作。 */
  function renderCodexPlusExtensionsDetail() {
    const detail = alunixaXExtensionsSelectionDetail();
    if (!detail) {
      alunixaXExtensionsSelected = null;
      return renderCodexPlusExtensionsOverview();
    }
    const { sel, local, marketItem } = detail;
    const name = marketItem?.name || local?.name || sel.key;
    const version = marketItem?.version || local?.version || "";
    const author = marketItem?.author || "";
    const description = marketItem?.description || local?.description || "";
    const tags = marketItem?.tags || [];
    const requirements = marketItem?.requirements || [];
    const limitations = marketItem?.limitations || [];
    const homepage = marketItem?.homepage || local?.homepage || "";
    const isInstalled = sel.kind === "installed";
    const updateAvailable = isInstalled && marketItem && version && local?.version && local.version !== version;

    // 详情沿用列表的内容宽度，管理操作保持独立。
    const publisherLine = [
      author ? escapeHtml(author) : "",
      version ? `v${escapeHtml(version)}` : "",
      local ? `${local.source === "builtin" ? "内置" : "用户"} · ${escapeHtml(userScriptStatusLabel(local.status))}` : "",
    ].filter(Boolean).join('<span class="alunixa-x-extensions-detail-sep">·</span>');

    const actions = [];
    if (isInstalled) {
      actions.push(`
        <button type="button" class="alunixa-x-toggle" data-codex-user-script-key="${escapeHtml(local?.key || "")}" data-enabled="${String(!!local?.enabled)}" role="switch" aria-checked="${String(!!local?.enabled)}" aria-label="启用 ${escapeHtml(name)}"><span></span></button>
      `);
      // 内置脚本在只读目录里，删不掉；只给用户目录的脚本提供卸载。
      if (local?.source === "user") {
        actions.push(`<button type="button" class="alunixa-x-extensions-detail-button" data-codex-extensions-uninstall="${escapeHtml(local.key)}">卸载</button>`);
      }
    } else if (marketItem) {
      actions.push(`<button type="button" class="alunixa-x-extensions-detail-button alunixa-x-extensions-detail-primary" data-codex-market-install="${escapeHtml(marketItem.id)}">安装</button>`);
    }

    // 使用要求与限制保留为独立正文分区。
    const list = (title, items) => items.length
      ? `<div class="alunixa-x-extensions-detail-section"><div class="alunixa-x-extensions-detail-section-title">${escapeHtml(title)}</div><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
      : "";

    return `
      <button type="button" class="alunixa-x-extensions-back" data-codex-extensions-browse="${alunixaXExtensionsFilter}" aria-label="返回拓展列表">${alunixaXDiscoveryIcons.back}<span>返回拓展列表</span></button>
      <div class="alunixa-x-extensions-detail-head">
        <div class="alunixa-x-extensions-detail-icon" aria-hidden="true">${extensionIconMarkup(marketItem?.icon)}</div>
        <div class="alunixa-x-extensions-detail-heading">
          <div class="alunixa-x-extensions-detail-title">${escapeHtml(name)}</div>
          ${publisherLine ? `<div class="alunixa-x-extensions-detail-meta">${publisherLine}</div>` : ""}
          ${updateAvailable ? `<div class="alunixa-x-extensions-detail-update">有新版本 v${escapeHtml(version)} 可更新</div>` : ""}
        </div>
        <div class="alunixa-x-extensions-detail-actions">${actions.join("")}</div>
      </div>
      <div class="alunixa-x-extensions-detail-body">
        ${description ? `<div class="alunixa-x-extensions-detail-description">${escapeHtml(description)}</div>` : ""}
        ${tags.length ? `<div class="alunixa-x-extensions-detail-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${list("使用要求", requirements)}
        ${list("已知限制", limitations)}
        ${homepage ? `<div class="alunixa-x-extensions-detail-link"><a href="${escapeHtml(homepage)}" target="_blank" rel="noreferrer">${escapeHtml(homepage)}</a></div>` : ""}
        ${local?.error ? `<div class="alunixa-x-extensions-detail-error">${escapeHtml(local.error)}</div>` : ""}
      </div>
    `;
  }

  /** 卸载用户脚本：删文件 + 清记录，然后刷新两侧。 */
  async function uninstallUserScript(key) {
    if (!key) return;
    await postJson("/user-scripts/delete", { key });
    if (alunixaXExtensionsSelected?.kind === "installed" && alunixaXExtensionsSelected.key === key) {
      alunixaXExtensionsSelected = null;
    }
    await loadUserScripts();
    refreshCodexPlusExtensionsView();
  }

  /** 左面板的导航项。Alunixa X 页面切分组，「拓展」页面列脚本。 */
  function renderCodexPlusPageNavItems(tab) {
    if (tab === alunixaXExtensionsTab) return renderCodexPlusExtensionsNav();
    return [
      { key: "home", label: "主页" },
    ].map((item) => `
      <button type="button" class="alunixa-x-page-nav-item" data-alunixa-x-page-nav="${item.key}" data-active="${String(tab === item.key)}">${item.label}</button>
    `).join("");
  }

  /**
   * 页面模式下把单栏内容改造成两栏：左面板 + 右内容区。
   *
   * 只搬动已有的 .alunixa-x-modal-body，不重建里面那些 data-codex-* 挂载点，
   * 免得 renderUserScripts / 各类 toggle 的 querySelector 找不到目标。
   */
  function installCodexPlusPageLayout(overlay, tab) {
    if (!overlay || overlay.querySelector(".alunixa-x-page-layout")) return;
    const content = overlay.querySelector(".alunixa-x-modal-content");
    const body = content?.querySelector(".alunixa-x-modal-body");
    if (!content || !body) return;
    const layout = document.createElement("div");
    layout.className = "alunixa-x-page-layout";
    const main = document.createElement("div");
    main.className = "alunixa-x-page-main";
    // 只有「拓展」需要左面板（它是脚本列表）。主页和推荐内容都是单栏内容页，
    // 页面切换交给图标栏那三个入口，再列一遍就是重复。
    if (tab === alunixaXExtensionsTab) {
      const nav = document.createElement("div");
      nav.className = "alunixa-x-page-nav";
      nav.innerHTML = `
        <div class="alunixa-x-page-nav-header"><div class="alunixa-x-page-nav-title">${alunixaXPageTitle(tab)}</div></div>
        <div class="alunixa-x-page-nav-body" data-alunixa-x-page-nav-body="true">${renderCodexPlusPageNavItems(tab)}</div>
      `;
      layout.appendChild(nav);
    }
    content.appendChild(layout);
    layout.appendChild(main);
    main.appendChild(body);
    if (tab === "home") {
      // 设置标题和卡片共用居中栏，并随内容滚动，保持原生设置页的阅读节奏。
      const header = content.querySelector(".alunixa-x-modal-header");
      if (header) body.querySelector(".alunixa-x-settings")?.prepend(header);
    }
  }

  /** 页面标题：每个 rail 入口一个名字，和图标栏上的标签保持一致。 */
  function alunixaXPageTitle(tab) {
    if (tab === alunixaXExtensionsTab) return "拓展";
    if (tab === alunixaXSponsorTab) return "推荐内容";
    return "Alunixa X";
  }

  /** 左面板内容随当前分组刷新（切 tab 后调用）。 */
  function refreshCodexPlusPageNav(tab) {
    const body = document.querySelector("[data-alunixa-x-page-nav-body]");
    if (!body) return;
    const title = document.querySelector(".alunixa-x-page-nav-title");
    if (title) title.textContent = tab === alunixaXExtensionsTab ? "拓展" : "Alunixa X";
    body.innerHTML = renderCodexPlusPageNavItems(tab);
  }

  /**
   * 脚本清单变化后同步左面板。
   *
   * 原来这里还要往「用户脚本」区块的开关与目录文本里写值，那个区块已经删掉，
   * 侧栏显示已安装清单，主区列表与详情由 refreshCodexPlusExtensionsView 同步。
   */
  function renderUserScripts() {
    // 左面板也要跟着刷新，否则脚本的启停/状态变化不会反映到列表上。
    if (alunixaXActiveEntry() === "extensions") refreshCodexPlusPageNav(alunixaXExtensionsTab);
  }

  async function loadUserScripts(path = "/user-scripts/list", payload = {}) {
    const requestPayload = path === "/user-scripts/list"
      ? { ...payload, runtime_status: window.__alunixaXUserScripts?.scripts || {} }
      : payload;
    const result = await postJson(path, requestPayload);
    if (result?.scripts) {
      alunixaXUserScripts = result;
      alunixaXUserScriptsLoaded = true;
      renderUserScripts();
      // 已安装状态变了，市场的「已安装/有更新」标记也要跟着刷新。
      if (alunixaXActiveEntry() === "extensions") refreshCodexPlusExtensionsView();
    }
  }

  /**
   * 拉市场清单。
   *
   * 清单与「已安装」状态都由后端合并好（见 script_market::market_scripts_payload），
   * 前端只需合并本地脚本清单来显示来源与状态。
   */
  async function loadScriptMarket(force = false) {
    if (alunixaXScriptMarket.loading) return;
    if (alunixaXScriptMarket.loaded && !force) return;
    alunixaXScriptMarket = { ...alunixaXScriptMarket, loading: true };
    if (alunixaXActiveEntry() === "extensions") refreshCodexPlusExtensionsView();
    const result = await postJson("/script-market/list", {});
    if (Array.isArray(result?.scripts)) {
      alunixaXScriptMarket = {
        scripts: result.scripts,
        loaded: true,
        loading: false,
        message: result.message || "",
      };
    } else {
      alunixaXScriptMarket = {
        ...alunixaXScriptMarket,
        loaded: true,
        loading: false,
        message: result?.message || "拓展加载失败",
      };
    }
    if (alunixaXActiveEntry() === "extensions") refreshCodexPlusExtensionsView();
  }

  async function installScriptFromMarket(id) {
    if (!id) return;
    const result = await postJson("/script-market/install", { id });
    if (Array.isArray(result?.scripts)) {
      alunixaXScriptMarket = {
        scripts: result.scripts,
        loaded: true,
        loading: false,
        message: result.message || "",
      };
    }
    // 后端装完会把本地清单一起带回来，省一次往返。
    if (result?.user_scripts?.scripts) {
      alunixaXUserScripts = result.user_scripts;
      alunixaXUserScriptsLoaded = true;
      renderUserScripts();
    } else {
      await loadUserScripts();
    }
    if (alunixaXExtensionsSelected?.kind === "market" && alunixaXExtensionsSelected.key === id) {
      const installed = (alunixaXUserScripts.scripts || []).find((script) => script.market_id === id);
      if (installed) alunixaXExtensionsSelected = { kind: "installed", key: installed.key };
    }
    if (alunixaXActiveEntry() === "extensions") refreshCodexPlusExtensionsView();
  }

  /**
   * 市场条目与本地脚本合并后的视图。
   *
   * 本地有市场装来的脚本（带 market_id），据此判断「已安装」并给出卸载入口；
   * 「市场」分组只列还没装的，避免同一脚本出现两次。
   */
  function alunixaXExtensionsEntries() {
    const local = alunixaXUserScripts.scripts || [];
    const marketById = new Map((alunixaXScriptMarket.scripts || []).map((item) => [item.id, item]));
    const localByMarketId = new Map(
      local.filter((script) => script.market_id).map((script) => [script.market_id, script]),
    );
    const installed = local.map((script) => ({
      kind: "installed",
      key: script.key,
      name: marketById.get(script.market_id)?.name || script.name || script.key,
      meta: `${script.source === "builtin" ? "内置" : script.market_id ? "市场" : "用户"} · ${userScriptStatusLabel(script.status)}`,
      enabled: !!script.enabled,
      script,
    }));
    const market = (alunixaXScriptMarket.scripts || [])
      .filter((item) => !localByMarketId.has(item.id))
      .map((item) => ({
        kind: "market",
        key: item.id,
        name: item.name || item.id,
        meta: `${item.author || "未知作者"} · v${item.version}`,
        item,
      }));
    const available = (alunixaXScriptMarket.scripts || []).filter((item) => localByMarketId.has(item.id));
    return { installed, market, available, localByMarketId };
  }

  /**
   * 取条目对应的市场清单项。
   *
   * 市场条目自带 `item`；已安装条目只有本地脚本（`script`），要靠脚本上的
   * `market_id` 回查，否则拿不到图标、简介、标签。纯本地脚本两者都没有。
   */
  function alunixaXExtensionMarketItem(entry) {
    if (entry.kind === "market") return entry.item || null;
    const marketId = entry.script?.market_id;
    if (!marketId) return null;
    return (alunixaXScriptMarket.scripts || []).find((item) => item.id === marketId) || null;
  }

  function filterCodexPlusExtensionsEntries(entries) {
    const query = alunixaXExtensionsQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => {
      const marketItem = alunixaXExtensionMarketItem(entry);
      return [entry.name, entry.key, entry.script?.name, entry.meta, marketItem?.description, ...(marketItem?.tags || [])]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(query));
    });
  }

  function selectCodexPlusTab(tab) {
    closeCodexPlusTypingEffectDropdown();
    // 归一化后再比对：panel 用的是 extensions，而旧调用点仍传 userScripts，
    // 不统一就会两边都对不上、所有 panel 全被隐藏。
    const normalized = alunixaXModalTab(tab);
    document.querySelectorAll(".alunixa-x-modal-content").forEach((modal) => {
      modal.dataset.alunixaXActiveTab = normalized;
    });
    document.querySelectorAll("[data-alunixa-x-panel]").forEach((panel) => {
      panel.hidden = alunixaXModalTab(panel.getAttribute("data-alunixa-x-panel")) !== normalized;
    });
    if (normalized === alunixaXExtensionsTab) {
      loadUserScripts();
      // 市场清单拉过一次就缓存，切换分组不再重复请求；失败后可从界面手动刷新。
      void loadScriptMarket();
    }
    refreshCodexPlusPageNav(normalized);
  }

  /** 两个 rail 入口各自对应一个页面，激活态要分别判断，不能只看页面开着没有。 */
  function alunixaXActiveEntry() {
    const overlay = document.querySelector(`.${alunixaXPageClass}`);
    if (!overlay) return null;
    const tab = overlay.querySelector(".alunixa-x-modal-content")?.dataset?.alunixaXActiveTab;
    if (tab === alunixaXExtensionsTab) return "extensions";
    if (tab === alunixaXSponsorTab) return "sponsor";
    if (tab === alunixaXPluginMarketTab) return "plugin-market";
    return "home";
  }

  function setCodexPlusSidebarNavActive(active, entry = "home") {
    const nav = document.getElementById(alunixaXSidebarNavId);
    const button = nav?.querySelector("button");
    if (button) {
      const on = Boolean(active) && entry === "home";
      button.dataset.active = String(on);
      button.setAttribute("aria-current", on ? "page" : "false");
    }
    [
      [alunixaXRailNavId, "home"],
      [alunixaXRailExtensionsId, "extensions"],
      [alunixaXRailSponsorId, "sponsor"],
    ].forEach(([id, name]) => {
      const railButton = document.querySelector(`#${id} > button`);
      if (!railButton) return;
      const on = Boolean(active) && entry === name;
      railButton.dataset.active = String(on);
      railButton.setAttribute("aria-current", on ? "page" : "false");
      // 原生 rail 按钮的选中色由 data-selected 驱动（且需无 data-suppress-active-style）。
      if (on) railButton.setAttribute("data-selected", "");
      else railButton.removeAttribute("data-selected");
    });
    syncCodexPlusRailNativeSelection();
  }

  /**
   * 我们的页面是叠加在 Codex 上的，Codex 不知道，所以它自己那个 destination
   * 的选中态会一直留着，表现为 rail 上同时亮两个。页面打开时给根节点打标记，
   * 由 CSS 把原生选中项压成未选中；关掉即移除标记，原生状态自动恢复。
   *
   * 未选中的颜色取自当前主题下真实的未选中项，避免把深浅色写死。
   */
  function syncCodexPlusRailNativeSelection() {
    const root = document.documentElement;
    if (!root) return;
    if (!document.querySelector(`.${alunixaXPageClass}`)) {
      root.removeAttribute("data-alunixa-x-page-open");
      root.style.removeProperty("--alunixa-x-rail-dim");
      return;
    }
    const rail = document.querySelector(alunixaXRailSelector);
    const unselected = rail?.querySelector(`${alunixaXRailDestinationSelector}:not([aria-current="page"])`);
    const dim = unselected ? getComputedStyle(unselected).color : "";
    if (dim) root.style.setProperty("--alunixa-x-rail-dim", dim);
    root.setAttribute("data-alunixa-x-page-open", "");
  }

  function positionCodexPlusPage(overlay) {
    if (!overlay?.classList?.contains(alunixaXPageClass)) return;
    const sidebar = document.querySelector("aside.app-shell-left-panel");
    const rect = sidebar?.getBoundingClientRect?.();
    const rail = document.querySelector(alunixaXRailSelector);
    const railRect = rail?.getBoundingClientRect?.();
    // 新版：页面要顶替原生侧边栏——从图标栏右边界起铺满，把宽面板整个盖住，
    // 而不是并排在其右侧多出一列（那样会变成「图标栏 + 会话列表 + 我们的面板」三段）。
    // 旧版没有图标栏，我们的入口就在 aside 内部，此时退回 aside 右边界。
    const left = railRect && railRect.width > 0
      ? Math.max(0, railRect.right)
      : (rect && rect.width > 0 ? Math.max(0, rect.right) : 0);
    // 量出来的是视觉坐标，而 overlay 在缩放空间里布局，所以统一折算成布局坐标。
    // CSS 的 calc(100vw / zoom - left) 用的也是这个空间的量，两边才配得上。
    const zoom = alunixaXWindowZoom();
    const layoutLeft = zoom === 1 ? left : left / zoom;
    overlay.style.setProperty("--alunixa-x-page-left", `${layoutLeft}px`);
    overlay.style.left = `${layoutLeft}px`;
    // 官方顶部有一条 header（返回/前进/隐藏侧边栏），图标栏与侧边栏都从它的下沿开始。
    // 我们的 overlay 若从 y=0 铺满就会把整条 header 盖住——用户反馈「比官方少了一条顶部栏」
    // 就是这个原因。这里同样量图标栏的顶边（而非硬编码高度），让 overlay 从 header 下沿开始。
    const top = railRect && railRect.height > 0
      ? Math.max(0, railRect.top)
      : (rect && rect.height > 0 ? Math.max(0, rect.top) : 0);
    const layoutTop = zoom === 1 ? top : top / zoom;
    overlay.style.setProperty("--alunixa-x-page-top", `${layoutTop}px`);
    overlay.style.top = `${layoutTop}px`;
    // 右侧与下方官方各留了一圈槽：整行的 [data-app-shell-workspace-row] 比视口小
    // （真机 1715x984 / 视口 1719x988，即右、下各 4px），官方内容面板正好收在行的右下角。
    // 我们原先 right/bottom 都贴 0，于是比官方多占这 4px。这里量取而不是硬编码 4。
    const row = document.querySelector("[data-app-shell-workspace-row]");
    const rowRect = row?.getBoundingClientRect?.();
    const rightGutter = rowRect && rowRect.width > 0 ? Math.max(0, window.innerWidth - rowRect.right) : 0;
    const bottomGutter = rowRect && rowRect.height > 0 ? Math.max(0, window.innerHeight - rowRect.bottom) : 0;
    const layoutRight = zoom === 1 ? rightGutter : rightGutter / zoom;
    const layoutBottom = zoom === 1 ? bottomGutter : bottomGutter / zoom;
    overlay.style.setProperty("--alunixa-x-page-right", `${layoutRight}px`);
    overlay.style.setProperty("--alunixa-x-page-bottom", `${layoutBottom}px`);
    overlay.style.right = `${layoutRight}px`;
    overlay.style.bottom = `${layoutBottom}px`;
    // 圆角同样量取官方面板自身的值，不写死 12px。
    // 这里量的是 _PageSurface_：官方那个与我们 overlay 同格子的页面面板（rect 都是
    // [52, 44, 1663, 940]），它四角同为 12px，左侧那一角也真实可见——真机像素扫描确认
    // 官方左边缘从 y=44 的 x=62 收到 y=54 的 x=52，是一条完整的弧。
    // 别改用 main[data-app-shell-main-surface] 的 --app-shell-main-surface-clip-start-radius：
    // 那个元素左边缘在 362（缩在侧边栏后面），左侧还用 inset 负内缩把圆角裁掉，start 恒为 0，
    // 会让人误判左侧不该圆——第一版就是这么写错的，用户反馈「少一个圆角」正是缺了左边两个角。
    // 类名是 CSS Modules 的哈希名，但 _PageSurface_ 这个片段稳定，且不会命中 _PageSurfaceLayout_
    //（其后紧跟 L 而非 _）。量到的是视觉值，同样折算成布局坐标。读不到就保持 0，不做猜测。
    const pageSurface = document.querySelector('[class*="_PageSurface_"]');
    const pageSurfaceStyle = pageSurface ? getComputedStyle(pageSurface) : null;
    const mainSurfaceStyle = (() => {
      const main = document.querySelector("main[data-app-shell-main-surface]");
      return main ? getComputedStyle(main) : null;
    })();
    const radius =
      parseFloat(pageSurfaceStyle?.borderTopLeftRadius || "") ||
      parseFloat(mainSurfaceStyle?.getPropertyValue("--app-shell-main-surface-clip-end-radius") || "") ||
      0;
    const layoutRadius = zoom === 1 ? radius : radius / zoom;
    overlay.style.setProperty("--alunixa-x-page-radius", `${layoutRadius}px`);
  }

  function alunixaXHostUsesLightTheme() {
    const root = document.documentElement;
    const body = document.body;
    const explicitTheme = [
      root?.getAttribute("data-theme"),
      body?.getAttribute("data-theme"),
      root?.getAttribute("data-color-scheme"),
      body?.getAttribute("data-color-scheme"),
    ].filter(Boolean).join(" ").toLowerCase();
    if (/\b(light|light-mode|theme-light)\b/.test(explicitTheme)) return true;
    if (/\b(dark|dark-mode|theme-dark)\b/.test(explicitTheme)) return false;

    const themeClasses = [root?.className, body?.className]
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (/(^|\s)(light|light-mode|theme-light)(\s|$)/.test(themeClasses)) return true;
    if (/(^|\s)(dark|dark-mode|theme-dark)(\s|$)/.test(themeClasses)) return false;

    return !window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  }

  /**
   * 取 Codex 当前的界面缩放系数。
   *
   * Codex 的界面缩放的实现是给内层布局节点设 CSS `zoom`（例如 1.2），而不是改
   * documentElement，所以固定在 body 下的 overlay 不会自动跟随。这里把它读出来，
   * 由 applyCodexPlusZoom 自己套上。
   */
  function alunixaXWindowZoom() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(alunixaXWindowZoomVar);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  /**
   * 让 overlay 跟随 Codex 的界面缩放，并保持满屏。
   *
   * 直接给 fixed 元素设 zoom 的话，它自身的 `inset: 0` / `100vw` 都还是按未缩放的
   * 视口算，再乘 zoom 就溢出（实测 zoom=1.2 时 100vw 得到 2072px，视口只有 1727）。
   * 所以 overlay 自身的尺寸改用 `calc(100vw / var(--alunixa-x-zoom))` 抵消，
   * 内部子元素则用百分比——它们在缩放空间里，百分比本来就对。
   *
   * 字号不在这里动：由 CSS 跟随 zoom 自然放大，与原生行为一致。
   */
  function applyCodexPlusZoom(overlay) {
    if (!overlay?.style) return 1;
    const zoom = alunixaXWindowZoom();
    overlay.style.setProperty("--alunixa-x-zoom", String(zoom));
    if (zoom === 1) {
      overlay.style.removeProperty("zoom");
      return 1;
    }
    overlay.style.setProperty("zoom", String(zoom));
    return zoom;
  }

  /**
   * 用 Codex 自己的语义令牌刷新 overlay 的变量。
   *
   * 早先这里内联写死了一套 zinc 调色板（深色正文 #f3f4f6、次要 #a1a1aa），
   * 内联优先级最高，把样式表里本来正确的令牌链整个盖掉了，表现为我们的文字
   * 比原生偏白偏冷。现在改成读宿主算好的值——取不到才回落到兜底色，
   * 这样浅色/深色主题都跟原生同源，也不会在 Codex 调色板变动后失配。
   */
  function applyCodexPlusTheme(overlay) {
    if (!overlay?.style) return;
    const light = alunixaXHostUsesLightTheme();
    const host = getComputedStyle(document.documentElement);
    const read = (names, fallback) => {
      for (const name of names) {
        const value = host.getPropertyValue(name).trim();
        if (value) return value;
      }
      return fallback;
    };
    const variables = {
      "--alunixa-x-bg-primary": read(
        ["--color-token-bg-primary", "--token-bg-primary", "--app-color-background-surface"],
        light ? "#ffffff" : "#141414",
      ),
      "--alunixa-x-bg-secondary": read(
        ["--color-token-bg-secondary", "--token-bg-secondary", "--color-surface-secondary"],
        light ? "#f7f7f7" : "#2f2f2f",
      ),
      "--alunixa-x-bg-elevated": read(
        ["--color-token-dropdown-background", "--color-surface-elevated-secondary", "--color-token-bg-elevated-secondary"],
        light ? "#ffffff" : "#2f2f2f",
      ),
      // 设置页使用独立 surface，正文背景令牌在部分版本中比原生设置页更深。
      "--alunixa-x-settings-page-bg": read(
        ["--color-background-surface", "--app-color-background-surface"],
        light ? "#ffffff" : "#181818",
      ),
      "--alunixa-x-nav-bg": read(
        ["--color-token-sidebar-background", "--color-background-sidebar"],
        light ? "#f7f7f7" : "#1e1e1e",
      ),
      "--alunixa-x-nav-selected-bg": read(
        ["--color-token-interactive-bg-secondary-selected", "--color-background-primary-soft-active"],
        light ? "#e9e9e9" : "#2f2f2f",
      ),
      "--alunixa-x-settings-card-bg": read(
        ["--color-background-surface-secondary", "--color-background-surface-raised"],
        light ? "#f7f7f7" : "#232323",
      ),
      "--alunixa-x-switch-on": read(
        ["--color-background-accent-solid", "--color-token-bg-accent"],
        "#3485ff",
      ),
      "--alunixa-x-switch-off": read(
        ["--color-background-switch-off", "--color-background-secondary-solid"],
        light ? "#dedede" : "#3a3a3a",
      ),
      "--alunixa-x-switch-thumb": read(
        ["--color-background-switch-thumb"],
        "#ffffff",
      ),
      "--alunixa-x-bg-hover": read(
        ["--color-token-interactive-bg-secondary-hover", "--color-background-primary-soft-hover", "--token-list-hover-background"],
        light ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.08)",
      ),
      "--alunixa-x-bg-selected": read(
        ["--color-token-interactive-bg-secondary-selected", "--color-background-primary-soft-active"],
        light ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.12)",
      ),
      "--alunixa-x-text": read(
        ["--color-token-text-primary", "--color-text-primary", "--token-text-primary"],
        light ? "#171717" : "#dfdfdf",
      ),
      "--alunixa-x-text-secondary": read(
        ["--color-token-text-secondary", "--color-text-secondary-solid", "--color-text-secondary"],
        light ? "#5d5d5d" : "rgba(255,255,255,.71)",
      ),
      "--alunixa-x-text-tertiary": read(
        ["--color-token-text-tertiary", "--color-text-tertiary"],
        light ? "#8a8a8a" : "rgba(255,255,255,.498)",
      ),
      "--alunixa-x-border": read(
        ["--color-token-border-default", "--color-token-border", "--color-border-primary-outline"],
        light ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.084)",
      ),
      "--alunixa-x-border-subtle": read(
        ["--color-token-border-subtle", "--color-border-disabled"],
        light ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.06)",
      ),
      "--alunixa-x-danger": read(
        ["--color-text-danger", "--color-token-text-error"],
        light ? "#dc2626" : "#ff6764",
      ),
      "--alunixa-x-success": read(
        ["--color-text-success", "--app-color-text-success"],
        light ? "#15803d" : "#40c977",
      ),
      "--alunixa-x-warning": read(
        ["--color-text-warning", "--color-text-caution-surface"],
        light ? "#a16207" : "#ffc300",
      ),
    };
    Object.entries(variables).forEach(([name, value]) => overlay.style.setProperty(name, value));
    overlay.dataset.alunixaXTheme = light ? "light" : "dark";
  }

  /**
   * 规范化页面/tab 名。
   *
   * 用户脚本从 Alunixa X 弹窗里拆出来成了独立的「拓展」页面，
   * 这里把旧名 userScripts 也映射过去，避免存量调用点失效。
   */
  function alunixaXModalTab(tab) {
    if (tab === "extensions" || tab === "userScripts") return alunixaXExtensionsTab;
    if (tab === "sponsor") return "sponsor";
    return "home";
  }

  let alunixaXTypingEffectDropdownCleanup = null;

  /** 保留 select 的值与 change 契约，只替换原生系统菜单的呈现。 */
  function syncCodexPlusTypingEffectDropdown(select) {
    const overlay = select.closest(".alunixa-x-modal-overlay, .alunixa-x-page-overlay");
    const trigger = overlay?.querySelector("[data-alunixa-x-typing-effect-trigger]");
    if (!trigger) return;
    trigger.disabled = select.disabled;
    const label = trigger.querySelector("[data-alunixa-x-dropdown-label]");
    if (label) label.textContent = select.selectedOptions[0]?.textContent || "关闭";
    overlay.querySelectorAll("[data-alunixa-x-typing-effect-option]").forEach((option) => {
      const selected = option.dataset.alunixaXTypingEffectOption === select.value;
      option.setAttribute("aria-selected", String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
    if (select.disabled) closeCodexPlusTypingEffectDropdown();
  }

  function closeCodexPlusTypingEffectDropdown(restoreFocus = false) {
    const menu = document.querySelector("[data-alunixa-x-typing-effect-menu]");
    const trigger = menu?.parentElement?.querySelector("[data-alunixa-x-typing-effect-trigger]");
    if (menu) menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    alunixaXTypingEffectDropdownCleanup?.();
    alunixaXTypingEffectDropdownCleanup = null;
    if (restoreFocus && trigger?.isConnected && !trigger.disabled) trigger.focus();
  }

  function openCodexPlusTypingEffectDropdown(overlay, last = false) {
    const select = overlay.querySelector("[data-alunixa-x-typing-effect]");
    const trigger = overlay.querySelector("[data-alunixa-x-typing-effect-trigger]");
    const menu = overlay.querySelector("[data-alunixa-x-typing-effect-menu]");
    if (!select || select.disabled || !trigger || !menu) return;
    closeCodexPlusTypingEffectDropdown();
    syncCodexPlusTypingEffectDropdown(select);
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    // 菜单直接挂 overlay，避开滚动内容的裁剪；坐标换算与页面缩放保持同源。
    const frame = overlay.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    const zoom = alunixaXWindowZoom();
    const width = frame.width / zoom;
    const height = frame.height / zoom;
    menu.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const left = (anchor.right - frame.left) / zoom - menu.offsetWidth;
    const below = (anchor.bottom - frame.top) / zoom + 4;
    const above = (anchor.top - frame.top) / zoom - menu.offsetHeight - 4;
    const top = below + menu.offsetHeight > height - 8 && above >= 8 ? above : below;
    menu.style.left = `${Math.max(8, Math.min(left, width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(top, height - menu.offsetHeight - 8))}px`;
    const options = Array.from(menu.querySelectorAll("[role=option]"));
    const focused = last ? options[options.length - 1] : options.find((option) => option.getAttribute("aria-selected") === "true") || options[0];
    focused?.focus({ preventScroll: true });
    const controller = new AbortController();
    const close = () => closeCodexPlusTypingEffectDropdown();
    document.addEventListener("pointerdown", (event) => {
      if (!menu.contains(event.target) && !trigger.contains(event.target)) close();
    }, { capture: true, signal: controller.signal });
    overlay.addEventListener("scroll", (event) => {
      if (!menu.contains(event.target)) close();
    }, { capture: true, signal: controller.signal });
    window.addEventListener("resize", close, { signal: controller.signal });
    window.addEventListener("blur", close, { signal: controller.signal });
    const observer = new MutationObserver(() => {
      if (!overlay.isConnected) close();
    });
    observer.observe(document.body, { childList: true });
    alunixaXTypingEffectDropdownCleanup = () => {
      controller.abort();
      observer.disconnect();
    };
  }

  function openCodexPlusModal(options = {}) {
    const pageMode = options.page === true;
    const initialTab = alunixaXModalTab(options.tab);
    closeCodexPlusTypingEffectDropdown();
    document.querySelectorAll(".alunixa-x-modal-overlay").forEach((node) => node.remove());
    document.querySelectorAll(`.${alunixaXPageClass}, [data-alunixa-x-dialog="true"]`).forEach((node) => node.remove());
    const overlay = document.createElement("div");
    overlay.className = pageMode ? alunixaXPageClass : "alunixa-x-modal-overlay";
    overlay.dataset.alunixaXPage = String(pageMode);
    applyCodexPlusTheme(overlay);
    // 跟随 Codex 的界面缩放。必须在写 innerHTML 之前设好，否则内部那些
    // calc(100% / var(--alunixa-x-zoom-inverse)) 会先按 1 算一遍再被 zoom 放大。
    applyCodexPlusZoom(overlay);
    // 下拉箭头与勾选图标使用已安装的 Lucide ChevronDown / Check（ISC）路径。
    overlay.innerHTML = `
      <div class="alunixa-x-modal-content" role="dialog" aria-modal="true" aria-label="Alunixa X">
        <div class="alunixa-x-modal-header">
          <div class="alunixa-x-modal-title"><span class="alunixa-x-backend-indicator" data-codex-backend-indicator="true" data-status="checking"></span><span data-alunixa-x-version="true">Alunixa X ${alunixaXVersion}</span></div>
          ${pageMode ? "" : `<button type="button" class="alunixa-x-modal-close" aria-label="关闭">×</button>`}
        </div>
        <div class="alunixa-x-modal-body">
          <div class="alunixa-x-panel alunixa-x-settings" data-alunixa-x-panel="home">
            <section class="alunixa-x-settings-section" aria-label="常规">
              <h2 class="alunixa-x-settings-section-title">常规</h2>
              <div class="alunixa-x-settings-card">
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">后端连接</div><div class="alunixa-x-row-description">每 5 秒检查一次 launcher 后端状态。</div></div>
                  <div class="alunixa-x-backend-status">
                    <div class="alunixa-x-backend-label" data-codex-backend-status="true" data-status="checking">正在检查后端…</div>
                  </div>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">Codex增强</div><div class="alunixa-x-row-description">关闭后停用删除、导出、插件相关和菜单位置增强。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-codex-backend-setting="enhancementsEnabled"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">插件市场解锁</div><div class="alunixa-x-row-description">扩展插件市场请求，尽量显示完整插件列表。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="pluginMarketplaceUnlock"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">模型白名单解锁</div><div class="alunixa-x-row-description">从环境变量和 Codex config.toml 中的中转站 /v1/models 拉取模型，并补进模型选择列表。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="modelWhitelistUnlock"><span></span></button>
                </div>
              </div>
            </section>
            <section class="alunixa-x-settings-section" aria-label="模型与服务">
              <h2 class="alunixa-x-settings-section-title">模型与服务</h2>
              <div class="alunixa-x-settings-card">
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">Fast 按钮</div><div class="alunixa-x-row-description">显示服务模式切换按钮；Fast 仅支持 ${codexServiceTierFastModelListLabel()}，其他模型按 Standard 发送。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="serviceTierControls"><span></span></button>
                </div>
                <div class="alunixa-x-row" data-codex-service-tier-controls="true">
                  <div><div class="alunixa-x-row-title">服务模式</div><div class="alunixa-x-row-description">继承优先读取 Codex 应用内设置，其次读取 config.toml 的 service_tier；全局模式覆盖全部 thread；自定义允许按 thread 覆盖。</div></div>
                  <div class="alunixa-x-service-tier-control">
                    <div class="alunixa-x-service-tier-status" data-codex-service-tier-status="true" data-status="loading">正在读取…</div>
                    <div class="alunixa-x-service-tier-actions">
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-inherit="true">继承</button>
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-standard="true">全局 Standard</button>
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-fast="true">全局 Fast</button>
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-custom="true">自定义</button>
                    </div>
                    <div class="alunixa-x-service-tier-actions alunixa-x-service-tier-thread-actions">
                      <span class="alunixa-x-service-tier-thread-label">当前 thread 覆盖</span>
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-thread-inherit="true" title="当前 thread 不单独覆盖，继承 Codex 默认设置">继承</button>
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-thread-standard="true" title="仅当前 thread 使用 Standard，并切到自定义模式">Standard</button>
                      <button type="button" class="alunixa-x-service-tier-button" data-codex-service-tier-thread-fast="true" title="仅当前 thread 使用 Fast，并切到自定义模式">Fast</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <section class="alunixa-x-settings-section" aria-label="对话与输入">
              <h2 class="alunixa-x-settings-section-title">对话与输入</h2>
              <div class="alunixa-x-settings-card">
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">悬浮球 · 下一步建议</div><div class="alunixa-x-row-description">生成下一步建议。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="stepwise"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">悬浮球 · 回答大纲</div><div class="alunixa-x-row-description">整理回答结构。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="answerOutline"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">会话删除</div><div class="alunixa-x-row-description">在会话列表悬停显示删除按钮，并支持撤销。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="sessionDelete"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">Markdown 导出</div><div class="alunixa-x-row-description">在会话列表显示导出按钮，按本地 rollout 导出带时间戳的 Markdown。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="markdownExport"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">分享会话按钮</div><div class="alunixa-x-row-description">在当前会话工具栏显示分享按钮，关闭后立即隐藏。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="sessionShare"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">粘贴修复</div><div class="alunixa-x-row-description">从 Word 等富文本来源粘贴到 Codex composer 时只保留纯文本，避免被识别为图片/文件附件。需重启 Codex 才生效。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="pasteFix"><span></span></button>
                </div>
              </div>
            </section>
            <section class="alunixa-x-settings-section" aria-label="外观与布局">
              <h2 class="alunixa-x-settings-section-title">外观与布局</h2>
              <div class="alunixa-x-settings-card">
                ${alunixaXIsWindowsPlatform ? `<div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">桌宠跟随真实鼠标</div><div class="alunixa-x-row-description">仅支持 V2 桌宠；不会修改宠物文件。将 V2 的 Computer Use 光标朝向动作映射到真实鼠标，V1 开启后安全不生效；拖拽、原生悬停或 Computer Use 活跃时自动让步。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="petRealMouseLook"><span></span></button>
                </div>` : ""}
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">打字特效（彩虹 P）</div><div class="alunixa-x-row-description">在输入框的光标附近显示彩虹粒子、烟花或星光。系统减少动态效果时暂停。</div></div>
                  <select class="alunixa-x-typing-effect-select" data-alunixa-x-typing-effect="true" aria-label="打字特效（彩虹 P）" hidden aria-hidden="true" tabindex="-1">
                    <option value="off">关闭</option>
                    <option value="rainbow">彩虹粒子</option>
                    <option value="fireworks">烟花</option>
                    <option value="stars">星光</option>
                  </select>
                  <button type="button" class="alunixa-x-dropdown-trigger" data-alunixa-x-typing-effect-trigger="true" aria-label="打字特效（彩虹 P）" aria-haspopup="listbox" aria-expanded="false" aria-controls="alunixa-x-typing-effect-menu">
                    <span data-alunixa-x-dropdown-label="true">关闭</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">会话 ID 标识</div><div class="alunixa-x-row-description">在侧边栏会话标题前显示短 ID 和 UUIDv7 创建时间，方便定位历史会话。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="threadIdBadge"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">对话居中宽度</div><div class="alunixa-x-row-description">开启后把主对话和输入框限制到固定最大宽度，适合大屏阅读。</div></div>
                  <div class="alunixa-x-width-control">
                    <input class="alunixa-x-width-input" data-alunixa-x-conversation-view-width="true" min="${conversationViewMinWidth}" max="${conversationViewMaxAllowedWidth}" step="10" type="number" value="${conversationViewWidth()}">
                    <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="conversationView"><span></span></button>
                  </div>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">切换对话保留位置</div><div class="alunixa-x-row-description">开启后在不同 thread 之间切换时恢复到上一次浏览位置，不再自动跳到底部。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="threadScrollRestore"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">Codex 用量挂件</div><div class="alunixa-x-row-description">显示当前 Codex 会话用量、任务状态与可用的供应商余额。可拖动、上传角色图片和设置提醒；默认静音。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-alunixa-x-setting="whaleWidget"><span></span></button>
                </div>
              </div>
            </section>
            <section class="alunixa-x-settings-section" aria-label="工具与关于">
              <h2 class="alunixa-x-settings-section-title">工具与关于</h2>
              <div class="alunixa-x-settings-card">
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">历史会话修复</div><div class="alunixa-x-row-description">切换官方登录、混合 API 或纯 API 后，让旧对话重新显示在当前模式下。</div></div>
                  <button type="button" class="alunixa-x-toggle" data-codex-backend-setting="providerSyncEnabled"><span></span></button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">管理工具</div><div class="alunixa-x-row-description">配置增强功能、模型和语音服务。</div></div>
                  <button type="button" class="alunixa-x-action-button" data-codex-open-manager="true">打开管理工具</button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">打开 DevTools</div><div class="alunixa-x-row-description">打开当前 Codex 页面开发者工具，方便查看用户拓展报错。</div></div>
                  <button type="button" class="alunixa-x-action-button" data-codex-open-devtools="true">打开 DevTools</button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">关于 Alunixa X</div><div class="alunixa-x-about">Alunixa X 是通过外部 launcher 注入的增强菜单，不修改 Codex App 原始安装文件。<br>Build: <span data-alunixa-x-build="true">${alunixaXBuild}</span><br>GitHub: <a href="https://github.com/Alunixa-Code/Alunixa-X" target="_blank" rel="noreferrer">https://github.com/BigPizzaV3/CodexPlusPlus</a><br>Discord: <a href="https://discord.gg/y96kX7A76v" target="_blank" rel="noreferrer">https://discord.gg/y96kX7A76v</a><br>Telegram: <a href="https://t.me/AlunixaX" target="_blank" rel="noreferrer">https://t.me/AlunixaX</a></div></div>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">Discord 社区</div><div class="alunixa-x-row-description">加入 Discord 获取更新消息、反馈问题或交流使用体验。</div></div>
                  <button type="button" class="alunixa-x-action-button" data-alunixa-x-discord="true">打开 Discord</button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">Telegram 频道</div><div class="alunixa-x-row-description">加入 Telegram 获取更新消息和交流使用体验。</div></div>
                  <button type="button" class="alunixa-x-action-button" data-alunixa-x-telegram="true">打开 Telegram</button>
                </div>
                <div class="alunixa-x-row">
                  <div><div class="alunixa-x-row-title">提出问题</div><div class="alunixa-x-row-description">打开 GitHub Issues 反馈问题或建议。</div></div>
                  <button type="button" class="alunixa-x-issue-button" data-alunixa-x-issue="true">提出问题</button>
                </div>
              </div>
            </section>
            ${renderCodexPlusExtensionMenuRows()}
          </div>
          <div class="alunixa-x-panel" data-alunixa-x-panel="${alunixaXExtensionsTab}" hidden>
            <div class="alunixa-x-discovery alunixa-x-extensions-page">
              <div class="alunixa-x-discovery-header">
                <div><h1 class="alunixa-x-discovery-title">拓展</h1><p class="alunixa-x-discovery-description">为 Codex 添加更多增强功能。</p></div>
                <div class="alunixa-x-discovery-toolbar">
                  <label class="alunixa-x-discovery-search">${alunixaXDiscoveryIcons.search}<input type="search" data-codex-extensions-search="true" aria-label="搜索拓展" placeholder="搜索拓展" value="${escapeHtml(alunixaXExtensionsQuery)}" spellcheck="false" /></label>
                  <button type="button" class="alunixa-x-discovery-icon-button" data-codex-market-refresh="true" title="刷新拓展" aria-label="刷新拓展">${alunixaXDiscoveryIcons.refresh}</button>
                </div>
              </div>
              <div class="alunixa-x-extensions-detail" data-alunixa-x-extensions-detail="true">${renderCodexPlusExtensionsDetail()}</div>
            </div>
          </div>

        </div>
      </div>
      <div id="alunixa-x-typing-effect-menu" class="alunixa-x-dropdown-menu" data-alunixa-x-typing-effect-menu="true" role="listbox" aria-label="打字特效（彩虹 P）" hidden>
        ${[["off", "关闭"], ["rainbow", "彩虹粒子"], ["fireworks", "烟花"], ["stars", "星光"]].map(([value, label]) => `
          <button type="button" class="alunixa-x-dropdown-option" data-alunixa-x-typing-effect-option="${value}" role="option" aria-selected="false" tabindex="-1">
            <span>${label}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
        `).join("")}
      </div>
    `;
    overlay.querySelectorAll(".alunixa-x-toggle[data-alunixa-x-setting], .alunixa-x-toggle[data-codex-backend-setting]").forEach((button) => {
      button.setAttribute("role", "switch");
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-label", button.closest(".alunixa-x-row")?.querySelector(".alunixa-x-row-title")?.textContent || "设置");
    });
    const closeButton = overlay.querySelector(".alunixa-x-modal-close");
    closeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      overlay.remove();
      if (pageMode) setCodexPlusSidebarNavActive(false);
    }, true);
    overlay.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const searchInput = target?.closest("[data-codex-extensions-search]");
      if (searchInput) {
        alunixaXExtensionsQuery = searchInput.value;
        alunixaXExtensionsSelected = null;
        refreshCodexPlusExtensionsView();
        return;
      }
      const widthInput = target?.closest("[data-alunixa-x-conversation-view-width]");
      if (widthInput) setConversationViewWidth(widthInput.value);
    }, true);
    overlay.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const typingEffectSelect = target?.closest("[data-alunixa-x-typing-effect]");
      if (typingEffectSelect) {
        if (!typingEffectSelect.disabled && ["off", "rainbow", "fireworks", "stars"].includes(typingEffectSelect.value)) {
          setCodexPlusSetting("typingEffect", typingEffectSelect.value);
        }
        return;
      }
      const widthInput = target?.closest("[data-alunixa-x-conversation-view-width]");
      if (widthInput) {
        const width = normalizeConversationViewWidth(widthInput.value);
        widthInput.value = String(width || conversationViewWidth());
        setConversationViewWidth(widthInput.value);
      }
    }, true);
    overlay.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      // 拓展注册的菜单项。放在最前面是因为它的判定完全基于自己的 data 属性，
      // 与下面那些内置分支不会重叠；万一将来重叠，也应当由拓展优先拿到。
      if (handleCodexPlusExtensionMenuClick(target)) return;
      const typingEffectTrigger = target?.closest("[data-alunixa-x-typing-effect-trigger]");
      if (typingEffectTrigger) {
        const menu = overlay.querySelector("[data-alunixa-x-typing-effect-menu]");
        if (menu?.hidden) openCodexPlusTypingEffectDropdown(overlay);
        else closeCodexPlusTypingEffectDropdown();
        return;
      }
      const typingEffectOption = target?.closest("[data-alunixa-x-typing-effect-option]");
      if (typingEffectOption) {
        const select = overlay.querySelector("[data-alunixa-x-typing-effect]");
        if (select && !select.disabled) {
          const value = typingEffectOption.dataset.alunixaXTypingEffectOption;
          if (select.value !== value) {
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        closeCodexPlusTypingEffectDropdown(true);
        return;
      }
      const extensionsBrowse = target?.closest("[data-codex-extensions-browse]");
      if (extensionsBrowse) {
        alunixaXExtensionsFilter = extensionsBrowse.dataset.codexExtensionsBrowse === "installed" ? "installed" : "market";
        alunixaXExtensionsSelected = null;
        refreshCodexPlusExtensionsView();
        return;
      }
      // 左面板的分组导航（仅拓展页有左面板）。
      const pageNav = target?.closest("[data-alunixa-x-page-nav]");
      if (pageNav) {
        selectCodexPlusTab(pageNav.getAttribute("data-alunixa-x-page-nav"));
        return;
      }
      if (target?.closest("[data-codex-open-devtools]")) {
        postJson("/devtools/open", {});
        return;
      }
      if (target?.closest("[data-codex-open-manager]")) {
        openManagerFromCodex();
        return;
      }
      // 推荐卡片用 window.open 而非原生 <a target="_blank">：Codex 是 Electron
      // 应用，原生新窗口跳转在它的 webview 里不会交给系统浏览器（同页的
      // Discord / Telegram / Issues 按钮也一律走 window.open）。
      const adCard = target?.closest("[data-alunixa-x-ad-url]");
      if (adCard) {
        const adUrl = adCard.getAttribute("data-alunixa-x-ad-url") || "";
        if (/^https?:\/\//i.test(adUrl)) {
          event.preventDefault();
          window.open(adUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (target?.closest("[data-alunixa-x-discord]")) {
        window.open("https://discord.gg/y96kX7A76v", "_blank");
        return;
      }
      if (target?.closest("[data-alunixa-x-telegram]")) {
        window.open("https://t.me/AlunixaX", "_blank");
        return;
      }
      const issueButton = target?.closest("[data-alunixa-x-issue]");
      if (issueButton) {
        const issueUrl = "https://github.com/Alunixa-Code/Alunixa-X/issues";
        window.open(issueUrl, "_blank");
        return;
      }
      if (target?.closest("[data-codex-service-tier-inherit]")) {
        setCodexServiceTierControlMode("inherit");
        return;
      }
      if (target?.closest("[data-codex-service-tier-standard]")) {
        setCodexServiceTierControlMode("global-standard");
        return;
      }
      if (target?.closest("[data-codex-service-tier-fast]")) {
        setCodexServiceTierControlMode("global-fast");
        return;
      }
      if (target?.closest("[data-codex-service-tier-custom]")) {
        setCodexServiceTierControlMode("custom");
        return;
      }
      if (target?.closest("[data-codex-service-tier-thread-inherit]")) {
        setCodexThreadServiceTierMode("inherit");
        return;
      }
      if (target?.closest("[data-codex-service-tier-thread-standard]")) {
        setCodexThreadServiceTierMode("standard");
        return;
      }
      if (target?.closest("[data-codex-service-tier-thread-fast]")) {
        setCodexThreadServiceTierMode("fast");
        return;
      }
      const userScriptToggle = target?.closest("[data-codex-user-script-key]");
      if (userScriptToggle) {
        loadUserScripts("/user-scripts/set-script-enabled", { key: userScriptToggle.getAttribute("data-codex-user-script-key"), enabled: userScriptToggle.dataset.enabled !== "true" });
        return;
      }
      // 市场条目的「安装」。id 挂在行/按钮上，点按钮才算。
      const marketInstall = target?.closest("[data-codex-market-install]");
      if (marketInstall) {
        void installScriptFromMarket(marketInstall.getAttribute("data-codex-market-install"));
        return;
      }
      const extensionsRefresh = target?.closest("[data-codex-market-refresh]");
      if (extensionsRefresh) {
        void loadScriptMarket(true);
        return;
      }
      const extensionsUninstall = target?.closest("[data-codex-extensions-uninstall]");
      if (extensionsUninstall) {
        void uninstallUserScript(extensionsUninstall.getAttribute("data-codex-extensions-uninstall"));
        return;
      }
      // 左面板点行 = 选中并在右侧显示详情。放在安装/卸载之后，
      // 免得点了行内的按钮又被当成一次选中。
      const extensionsSelect = target?.closest("[data-codex-extensions-select]");
      if (extensionsSelect) {
        const [kind, ...rest] = extensionsSelect.getAttribute("data-codex-extensions-select").split(":");
        alunixaXExtensionsSelected = { kind, key: rest.join(":") };
        refreshCodexPlusExtensionsView();
        overlay.querySelector(".alunixa-x-extensions-back")?.focus({ preventScroll: true });
        return;
      }
      const toggle = target?.closest("[data-alunixa-x-setting]");
      if (toggle) {
        if (toggle.disabled || toggle.dataset.pending === "true") return;
        const key = toggle.getAttribute("data-alunixa-x-setting");
        setCodexPlusSetting(key, !alunixaXSettings()[key]);
        return;
      }
      const backendToggle = target?.closest("[data-codex-backend-setting]");
      if (backendToggle) {
        const key = backendToggle.getAttribute("data-codex-backend-setting");
        setBackendSetting(key, !alunixaXBackendSettings[key]);
        return;
      }
    }, true);
    overlay.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest("[data-alunixa-x-typing-effect-trigger]") && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openCodexPlusTypingEffectDropdown(overlay, event.key === "ArrowUp");
        return;
      }
      const menu = target?.closest("[data-alunixa-x-typing-effect-menu]");
      if (!menu || menu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCodexPlusTypingEffectDropdown(true);
      } else if (event.key === "Tab") {
        // 回到触发器后让浏览器处理 Tab，焦点会自然进入下一项而不会停在隐藏菜单里。
        closeCodexPlusTypingEffectDropdown(true);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const options = Array.from(menu.querySelectorAll("[role=option]"));
        const current = options.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options.forEach((option, index) => { option.tabIndex = index === next ? 0 : -1; });
        options[next]?.focus({ preventScroll: true });
      }
    }, true);
    // 图标加载失败的回退：error 不冒泡，只能捕获阶段委托。
    overlay.addEventListener("error", handleExtensionIconError, true);
    document.body.appendChild(overlay);
    if (pageMode) {
      positionCodexPlusPage(overlay);
      // 必须在 selectCodexPlusTab 之前建好两栏，否则刷新左面板时找不到容器。
      installCodexPlusPageLayout(overlay, initialTab);
      if (!window.__alunixaXPageResizeHandler) {
        window.__alunixaXPageResizeHandler = () => positionCodexPlusPage(document.querySelector(`.${alunixaXPageClass}`));
        window.addEventListener("resize", window.__alunixaXPageResizeHandler);
      }
    }
    selectCodexPlusTab(initialTab);
    // 必须在 selectCodexPlusTab 之后：激活态要靠 data-alunixa-x-active-tab
    // 判断当前是 Alunixa X 还是「拓展」，提前调用会永远落到 home 上。
    if (pageMode) setCodexPlusSidebarNavActive(true, alunixaXActiveEntry() || "home");
    renderCodexPlusMenu();
    refreshCodexPlusBackendToggles();
    renderBackendStatus();
    void loadCodexServiceTierState();
    loadUserScripts();
  }

  function openCodexPlusPage() {
    openCodexPlusModal({ page: true });
  }

  /** 「拓展」页面：从弹窗里拆出来的用户脚本，形态对齐 VSCode 的扩展面板。 */
  function openCodexPlusExtensions() {
    alunixaXExtensionsSelected = null;
    openCodexPlusModal({ page: true, tab: alunixaXExtensionsTab });
  }

  /** 「推荐内容」页面：从弹窗的二级 tab 提出来，成为图标栏上的一级入口。 */

  function closeCodexPlusPage() {
    closeCodexPlusTypingEffectDropdown();
    document.querySelectorAll(`.${alunixaXPageClass}`).forEach((node) => node.remove());
    setCodexPlusSidebarNavActive(false);
  }

  function closeCodexPlusPageAfterNativeNavigation() {
    clearTimeout(window.__alunixaXPageNavigationCloseTimer);
    window.__alunixaXPageNavigationCloseTimer = setTimeout(() => {
      window.__alunixaXPageNavigationCloseTimer = null;
      closeCodexPlusPage();
    }, 0);
  }

  function installCodexPlusPageNavigationCloseHandler() {
    document.removeEventListener("click", window.__alunixaXPageNavigationCloseHandler, true);
    window.__alunixaXPageNavigationCloseHandler = (event) => {
      if (!document.querySelector(`.${alunixaXPageClass}`)) return;
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target?.closest(selectors.sidebarThread)) return;
      // Let Codex's own click handler update its route before removing our page.
      closeCodexPlusPageAfterNativeNavigation();
    };
    document.addEventListener("click", window.__alunixaXPageNavigationCloseHandler, true);
  }

  function installCodexPlusSidebarNavigation() {
    document.querySelectorAll(`#${alunixaXMenuId}, [data-alunixa-x-menu="true"]`).forEach((node) => node.remove());
    // 旧版的侧边栏会话列表在 aside 里带 role="navigation"。新版把这个 role 挪去了
    // 缩略图面板/演示目录，所以留一条限定在 aside 内的兜底。
    // 注意：新版图标栏也是 aside 里的 <nav>，且文档顺序在前，而 querySelector 的选择器
    // 列表是按文档顺序取首个命中项的——必须显式排除图标栏，否则会挂到它上面。
    const navigation = document.querySelector('aside.app-shell-left-panel nav[role="navigation"]')
      || Array.from(document.querySelectorAll("aside.app-shell-left-panel nav"))
        .find((nav) => !nav.hasAttribute("data-app-navigation-rail"))
      || null;
    if (!navigation) return;
    const navButtons = Array.from(navigation.querySelectorAll("button"));
    const pluginButton = navButtons.find((button) => {
      if (button.querySelector(selectors.pluginSvgPath)) return true;
      const label = (button.getAttribute("aria-label") || button.textContent || "").trim();
      return /^(插件|Plugins)$/i.test(label);
    });
    const insertionButton = pluginButton || navButtons.find((button) => {
      const label = (button.getAttribute("aria-label") || button.textContent || "").replace(/\s+/g, " ").trim();
      return /^(已安排|Scheduled|拉取请求|Pull requests|新对话|New chat)$/i.test(label);
    });
    if (navigation.dataset.alunixaXSidebarNavigationListener !== "true") {
      navigation.dataset.alunixaXSidebarNavigationListener = "true";
      navigation.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (target?.closest(`#${alunixaXSidebarNavId}`)) return;
        if (target?.closest("button, a")) closeCodexPlusPageAfterNativeNavigation();
      }, true);
    }
    let wrapper = document.getElementById(alunixaXSidebarNavId);
    const parent = insertionButton?.parentElement || navigation;
    if (!wrapper || wrapper.parentElement !== parent) {
      wrapper?.remove();
      wrapper = document.createElement("div");
      wrapper.id = alunixaXSidebarNavId;
      wrapper.dataset.alunixaXSidebarNav = "true";
      const button = (insertionButton || document.createElement("button")).cloneNode(true);
      if (!(button instanceof HTMLElement)) return;
      if (!button.className) button.className = "h-token-nav-row w-full flex items-center gap-2 px-3 py-2 text-sm";
      button.type = "button";
      button.removeAttribute("data-state");
      button.removeAttribute("aria-current");
      button.removeAttribute("disabled");
      button.removeAttribute("aria-disabled");
      button.setAttribute("aria-label", "Alunixa X");
      button.textContent = "";
      button.innerHTML = `<span class="alunixa-x-sidebar-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg></span><span class="truncate">Alunixa X</span><span class="alunixa-x-sidebar-nav-status" data-status="${alunixaXBackendStatus.status || "checking"}" aria-hidden="true"></span>`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openCodexPlusPage();
      }, true);
      wrapper.appendChild(button);
      if (insertionButton?.nextSibling) {
        parent.insertBefore(wrapper, insertionButton.nextSibling);
      } else {
        parent.appendChild(wrapper);
      }
    }
    const status = wrapper.querySelector(".alunixa-x-sidebar-nav-status");
    if (status) status.dataset.status = alunixaXBackendStatus.status || "checking";
    const active = !!document.querySelector(`.${alunixaXPageClass}`);
    setCodexPlusSidebarNavActive(active, alunixaXActiveEntry() || "home");
  }

  function removeCodexPlusRailNavigation() {
    [alunixaXRailNavId, alunixaXRailExtensionsId, alunixaXRailSponsorId, alunixaXRailPluginMarketId].forEach((id) => document.getElementById(id)?.remove());
  }

  function detachCodexPlusSidebarNavigation() {
    document.getElementById(alunixaXSidebarNavId)?.remove();
    document.getElementById(alunixaXSidebarPluginMarketId)?.remove();
  }

  /**
   * 挑一个原生 rail 按钮当模板。
   *
   * 优先 builtin:projects——它在 primary 区，且不像 builtin:library 那样会走
   * tooltip/triggerRef 的特殊分支。找不到就退回第一个可见 destination。
   */
  function alunixaXRailTemplateButton(rail) {
    const preferred = rail.querySelector(`${alunixaXRailDestinationSelector}[data-sidebar-destination="builtin:projects"]`);
    if (preferred) return preferred;
    const candidates = Array.from(rail.querySelectorAll(alunixaXRailDestinationSelector))
      .filter((node) => node.closest("nav") === rail);
    // 优先挑未选中的：clone 会把选中态的属性和配色一起带过来，
    // 表现为入口在没有任何页面打开时也显示成选中。
    const isSelected = (node) => node.getAttribute("aria-current") === "page" || node.hasAttribute("data-selected");
    return candidates.find((node) => !isSelected(node)) || candidates[0] || null;
  }

  function alunixaXRailPrimaryAnchor(rail) {
    const fixedIds = [
      'builtin:home',
      'builtin:customize',
    ];
    const buttons = Array.from(rail.querySelectorAll(alunixaXRailDestinationSelector));
    return buttons.find((node) => {
      const id = node.getAttribute("data-sidebar-destination") || "";
      return id && !fixedIds.includes(id);
    }) || null;
  }

  function createCodexPlusRailButton({ id, template, label, iconMarkup, withStatus, onActivate }) {
    const wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.dataset.alunixaXRail = id === alunixaXRailExtensionsId ? "extensions" : "home";
    // 模板拿不到时不回退到旧模式，而是自建一个按钮：rail 上 destination 可能在
    // 登录态/接口就绪前还是空的，那只是暂时状态，不该让入口整个消失。
    const button = template
      ? template.cloneNode(true)
      : document.createElement("button");
    if (!(button instanceof HTMLElement)) return null;
    button.type = "button";
    // 留着 data-sidebar-destination 会被 Codex 的自定义/排序逻辑当成真的 destination。
    button.removeAttribute("data-sidebar-destination");
    button.removeAttribute("data-state");
    button.removeAttribute("disabled");
    button.removeAttribute("aria-disabled");
    // 选中态由 data-selected 驱动，但它只在没有 data-suppress-active-style 时生效。
    // 模板若是未选中的按钮，会带着 suppress 过来，压制掉我们的选中样式——
    // 必须移除，否则按钮永远停在未选中的暗色。
    button.removeAttribute("data-suppress-active-style");
    // 起始为未选中；激活态由 setCodexPlusSidebarNavActive 切换 data-selected。
    button.removeAttribute("data-selected");
    button.removeAttribute("aria-current");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.textContent = "";
    // 原生 rail 按钮是纯图标，没有文字标签，所以只放图标 + 状态点。
    button.innerHTML = `<span class="alunixa-x-rail-icon" aria-hidden="true">${iconMarkup}</span>`
      + (withStatus
        ? `<span class="alunixa-x-sidebar-nav-status" data-status="${alunixaXBackendStatus.status || "checking"}" aria-hidden="true"></span>`
        : "");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onActivate();
    }, true);
    wrapper.appendChild(button);
    return wrapper;
  }

  /**
   * 把 Alunixa X / 拓展两个入口挂到新版图标栏。
   *
   * Codex 的 rail 渲染晚于注入，所以这里每次 scan 都会被调用；靠 id 判存避免重复插入。
   */
  function installCodexPlusRailNavigation() {
    document.querySelectorAll(`#${alunixaXMenuId}, [data-alunixa-x-menu="true"]`).forEach((node) => node.remove());
    const rail = document.querySelector(alunixaXRailSelector);
    if (!rail) return false;
    // 注意：模板按钮可能在 rail 还没渲染出 destination 时拿不到（登录态/接口未就绪）。
    // 那只是暂时状态，不能因此判定"没有 rail"而回退旧模式，否则入口会整个消失。
    const template = alunixaXRailTemplateButton(rail);

    // 旧逻辑把"点原生导航就关掉 Alunixa X 页面"的监听挂在侧边栏的 navigation 上，
    // 但 rail 模式下那个函数会提前 return，监听压根装不上，所以这里补一份。
    if (rail.dataset.alunixaXRailNavigationListener !== "true") {
      rail.dataset.alunixaXRailNavigationListener = "true";
      rail.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (target?.closest(`#${alunixaXRailNavId}, #${alunixaXRailExtensionsId}, #${alunixaXRailSponsorId}`)) return;
        // 拓展入口的 id 是动态生成的，不在上面三个之内。不排除它，点拓展入口会被
        // 当成「点了原生导航按钮」，刚打开的拓展页面立刻被关掉。
        if (target?.closest(`[${alunixaXExtensionConstants.extensionAttribute}]`)) return;
        if (target?.closest("button, a")) closeCodexPlusPageAfterNativeNavigation();
      }, true);
    }

    const icons = {
      home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>',
      // 「拓展」直接用 VSCode 的扩展字形（就是列表里默认图标那一份），
      // 和页面内部保持同一个符号，不再另画一个近似图形。
      extensions: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="${alunixaXDefaultExtensionIconPath}"/></svg>`,
      // Lucide 的 megaphone：与 home 同一套 24 格线性风格，笔画宽度和端点也一致。
      sponsor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
    };

    const specs = [
      { id: alunixaXRailNavId, label: "Alunixa X", iconMarkup: icons.home, withStatus: true, onActivate: openCodexPlusPage },
      { id: alunixaXRailExtensionsId, label: "拓展", iconMarkup: icons.extensions, withStatus: false, onActivate: openCodexPlusExtensions },
    ];

    const anchor = alunixaXRailPrimaryAnchor(rail);
    // 插到锚点所在的父容器里，而不是 nav 顶层：原生按钮可能嵌在 nav 内部的分组 div 中，
    // 直接插顶层会破坏它的 flex 布局。
    const host = anchor?.parentElement || rail;
    let cursor = anchor;
    specs.forEach((spec) => {
      let wrapper = document.getElementById(spec.id);
      if (!wrapper || wrapper.parentElement !== host) {
        wrapper?.remove();
        wrapper = createCodexPlusRailButton({ ...spec, template });
        if (!wrapper) return;
      }
      // 顺序：Alunixa X 在前，「拓展」在后；紧跟在 primary 区锚点后面。
      if (cursor?.nextSibling) {
        host.insertBefore(wrapper, cursor.nextSibling);
      } else if (cursor) {
        host.appendChild(wrapper);
      } else {
        host.insertBefore(wrapper, host.firstElementChild);
      }
      cursor = wrapper;
    });

    const status = document.getElementById(alunixaXRailNavId)?.querySelector(".alunixa-x-sidebar-nav-status");
    if (status) status.dataset.status = alunixaXBackendStatus.status || "checking";
    return true;
  }

  /** 图标栏存在时走它，否则回退到旧版宽面板侧边栏入口。两条路径互斥，不会重复出现。 */
  function installCodexPlusNavigationEntries() {
    // 插件入口沿用原生按钮，清理旧注入留下的重复商店入口。
    document.getElementById(alunixaXRailPluginMarketId)?.remove();
    document.getElementById(alunixaXSidebarPluginMarketId)?.remove();
    if (installCodexPlusRailNavigation()) {
      detachCodexPlusSidebarNavigation();
      return;
    }
    removeCodexPlusRailNavigation();
    installCodexPlusSidebarNavigation();
  }

  const codexPluginRemoteOnlyMarketplaceKinds = new Set(["created-by-me-remote", "shared-with-me"]);

  function pluginMarketplaceRequestProfile(params) {
    const marketplaceKinds = Array.isArray(params?.marketplaceKinds)
      ? Array.from(new Set(params.marketplaceKinds.map((kind) => restorePluginMarketplaceName(kind))))
      : [];
    const hasRemoteOnlyKind = marketplaceKinds.some((kind) => codexPluginRemoteOnlyMarketplaceKinds.has(kind));
    const hasLocalKind = marketplaceKinds.includes("local");
    const hasOtherKind = marketplaceKinds.some(
      (kind) => !codexPluginRemoteOnlyMarketplaceKinds.has(kind) && kind !== "vertical"
    );
    return {
      marketplaceKinds,
      remoteOnly: hasRemoteOnlyKind && !hasLocalKind && !hasOtherKind,
    };
  }

  function patchPluginMarketplaceRequestParams(method, params) {
    if (method === "list-plugins") {
      if (!params || typeof params !== "object") return params;
    } else {
      return params;
    }
    const next = { ...params };
    if (next.forceRefetch === true) clearPluginMarketplaceRemoteCatalogUnavailable();
    const requestProfile = pluginMarketplaceRequestProfile(next);
    const requestCwds = Array.isArray(next.cwds)
      ? next.cwds.filter((cwd) => typeof cwd === "string" && cwd.trim())
      : [];
    if (requestCwds.length > 0) {
      window.__codexPluginMarketplaceLastCwds = Array.from(new Set(requestCwds));
    } else if (!requestProfile.remoteOnly && Array.isArray(window.__codexPluginMarketplaceLastCwds) && window.__codexPluginMarketplaceLastCwds.length > 0) {
      next.cwds = [...window.__codexPluginMarketplaceLastCwds];
    }
    const hadMarketplaceKinds = Object.prototype.hasOwnProperty.call(next, "marketplaceKinds");
    const broadCatalogRequest = codexPluginUsesBroadCatalogKinds()
      && (!hadMarketplaceKinds || next.marketplaceKinds == null);
    const remoteCatalogUnavailable = pluginMarketplaceRemoteCatalogUnavailable();
    if (broadCatalogRequest && !remoteCatalogUnavailable) {
      sendCodexPlusDiagnostic("plugin_marketplace_request_expanded", {
        hadMarketplaceKinds,
        marketplaceKinds: hadMarketplaceKinds ? next.marketplaceKinds : null,
        broadCatalogPreserved: true,
        cwdCount: Array.isArray(next.cwds) ? next.cwds.length : 0,
        cwdRestored: requestCwds.length === 0 && Array.isArray(next.cwds) && next.cwds.length > 0,
        remoteCatalogUnavailable,
        remoteOnly: requestProfile.remoteOnly,
      });
      return next;
    }
    let nextKinds = Array.isArray(next.marketplaceKinds)
      ? next.marketplaceKinds.map((kind) => restorePluginMarketplaceName(kind))
      : ["local"];
    if (!requestProfile.remoteOnly && remoteCatalogUnavailable) {
      nextKinds = nextKinds.filter((kind) => kind !== "created-by-me-remote" && kind !== "shared-with-me");
    }
    if (!requestProfile.remoteOnly) {
      if (!nextKinds.includes("local")) nextKinds.push("local");
      if (!nextKinds.includes("vertical")) nextKinds.push("vertical");
    }
    next.marketplaceKinds = Array.from(new Set(nextKinds));
    sendCodexPlusDiagnostic("plugin_marketplace_request_expanded", {
      hadMarketplaceKinds,
      marketplaceKinds: next.marketplaceKinds,
      broadCatalogPreserved: false,
      cwdCount: Array.isArray(next.cwds) ? next.cwds.length : 0,
      cwdRestored: requestCwds.length === 0 && Array.isArray(next.cwds) && next.cwds.length > 0,
      remoteCatalogUnavailable,
      remoteOnly: requestProfile.remoteOnly,
    });
    return next;
  }

  function displayNameForPluginMarketplaceName(name, fallback) {
    if (name === "openai-bundled") return "OpenAI插件1(Alunixa X)";
    if (name === "openai-curated") return "OpenAI插件2(Alunixa X)";
    if (name === "openai-primary-runtime") return "OpenAI插件3(Alunixa X)";
    if (name === "openai-api-curated") return "OpenAI插件4(Alunixa X)";
    // 兼容原生返回的既有旧配置名称；这里不会注入、缓存或注册插件市场。
    if (name === "alunixa-x-curated" || name === "openai-curated-remote") return "OpenAI插件5(Alunixa X)";
    return fallback;
  }

  function patchPluginMarketplaceObject(marketplace) {
    if (!marketplace || typeof marketplace !== "object" || marketplace.__alunixaXMarketplaceUnlockPatched) return false;
    // 上游已经给了显示名就用上游的（issue #692：此前无条件用上面的中文编号覆盖，
    // 用户看到的是「OpenAI插件1(Alunixa X)」而不是市场真实名字）。
    // 编号映射只在市场上游确实没给显示名时兜底；去重仍走 restorePluginMarketplaceName，
    // 与显示名无关，所以不会因此退回重复条目。
    const upstreamDisplayName = marketplace.displayName || marketplace.title || marketplace.label || "";
    const displayName = upstreamDisplayName
      || displayNameForPluginMarketplaceName(marketplace.name, marketplace.name);
    if (!displayName || displayName === marketplace.name) return false;
    marketplace.displayName = displayName;
    marketplace.title = displayName;
    marketplace.label = displayName;
    if (marketplace.interface && typeof marketplace.interface === "object") {
      marketplace.interface = {
        ...marketplace.interface,
        displayName,
        name: displayName,
        title: displayName,
        label: displayName,
      };
    } else {
      marketplace.interface = { displayName, name: displayName, title: displayName, label: displayName };
    }
    marketplace.__alunixaXMarketplaceUnlockPatched = true;
    return true;
  }

  function restorePluginMarketplaceName(name) {
    if (name === "alunixa-x-openai-bundled") return "openai-bundled";
    if (name === "alunixa-x-openai-curated") return "openai-curated";
    if (name === "alunixa-x-openai-primary-runtime") return "openai-primary-runtime";
    if (name === "alunixa-x-openai-api-curated") return "openai-api-curated";
    if (name === "alunixa-x-openai-curated-remote") return "openai-curated-remote";
    return name;
  }

  function codexPluginOfficialMarketplaceName(name) {
    const restored = restorePluginMarketplaceName(name);
    return restored === "openai-bundled" || restored === "openai-curated" || restored === "openai-primary-runtime" || restored === "openai-api-curated" || restored === "openai-curated-remote";
  }

  const codexPluginFilterSourceCache = new WeakMap();

  function codexPluginFilterCallbackSource(callback) {
    if (codexPluginFilterSourceCache.has(callback)) {
      return codexPluginFilterSourceCache.get(callback);
    }
    let source = "";
    try {
      source = Function.prototype.toString.call(callback);
    } catch {
    }
    codexPluginFilterSourceCache.set(callback, source);
    return source;
  }

  // 这三种 marketplace 过滤器由 Codex 打包后压缩，标识符每版都会换名
  // （历史形态: !u(e.marketplaceName)||e.marketplaceName===r / !ne(...) / !Eu(...) /
  // 26.928.31416 起: !Mj(e.marketplaceName)||e.marketplaceName===n）。
  // 所以按「结构」而不是按字面量识别，避免每次发版都要补一个新变体。
  const codexPluginBuildFlavorFilterSourcePattern =
    /!\s*([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\.marketplaceName\s*\)\s*\|\|\s*\2\s*\.marketplaceName\s*===\s*[A-Za-z_$][\w$]*/;
  // featuredPluginIds 那条：{let t=Gj(e);return t==null||!Mj(t)||t===n}
  // 入参是 plugin id 字符串（不是对象），先取 marketplace 再判，形态和上面不同，需单独认。
  // 三个 X 必须同一个标识符，且 `===` 右边是标识符而非调用——否则会误伤 bundle 里
  // 形如 `t==null||r==null||!ds(r)||r===SFe(t)` 的无关函数（实测存在）。
  // 右值后面必须紧跟非标识符字符（`(?![\w$(])`），光写 `(?!\s*\()` 会被贪婪回溯绕过：
  // `===SFe(t)` 里 `SFe` 可退回 `SF`，后面 `e` 不是 `(`，前瞻就放行了。实测踩过。
  const codexPluginFeaturedFilterSourcePattern =
    /([A-Za-z_$][\w$]*)\s*==\s*null\s*\|\|\s*!\s*[A-Za-z_$][\w$]*\s*\(\s*\1\s*\)\s*\|\|\s*\1\s*===\s*[A-Za-z_$][\w$]*(?![\w$(])/;

  function isCodexPluginBuildFlavorFilter(callback, sample, filtered = null) {
    if (!Array.isArray(sample) || sample.length === 0 || typeof callback !== "function") return false;
    if (!sample.some((plugin) => codexPluginOfficialMarketplaceName(plugin?.marketplaceName))) return false;
    const source = codexPluginFilterCallbackSource(callback);
    if (!source) return false;
    if (!codexPluginBuildFlavorFilterSourcePattern.test(source)) return false;
    return sample.some((plugin) => codexPluginOfficialMarketplaceName(plugin?.marketplaceName)
      && (Array.isArray(filtered) ? !filtered.includes(plugin) : !callback(plugin)));
  }

  // featuredPluginIds 过滤：sample 是字符串数组，回调按 id 反查 marketplace 后剔除官方目录。
  // 外部拿不到 id→marketplace 的映射，所以这里只做「结构 + 确实过滤掉了元素」的判定。
  function isCodexPluginFeaturedFilter(callback, sample, filtered = null) {
    if (!Array.isArray(sample) || sample.length === 0 || typeof callback !== "function") return false;
    if (!sample.every((id) => typeof id === "string")) return false;
    const source = codexPluginFilterCallbackSource(callback);
    if (!source) return false;
    if (!codexPluginFeaturedFilterSourcePattern.test(source)) return false;
    if (Array.isArray(filtered) && filtered.length >= sample.length) return false;
    return true;
  }
  // 结构式匹配 `<arr>.filter(p => !<list>.includes(p.name))`：
  // list 标识符每版都换名，写死会失效（历史写死过 "!t.includes(e.name)"）。
  // filter 实际传入的是箭头回调，不含外层 `.filter(`；兼容两种源码形态。
  // 必须锚定箭头形态且箭头参数与 `.name` 的宿主同名，
  // 否则会误伤 bundle 里 `!w4.includes(t.name)` 这类与插件无关的守卫（实测存在）。
  const codexPluginHiddenFilterSourcePattern =
    /(?:filter\s*\(\s*|^\s*\(?\s*)([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*!\s*[A-Za-z_$][\w$]*\s*\.includes\s*\(\s*\1\s*\.name\s*\)/;

  function isCodexPluginMarketplaceHiddenFilter(callback, sample, filtered = null) {
    if (!Array.isArray(sample) || sample.length === 0 || typeof callback !== "function" || !Array.isArray(filtered)) return false;
    if (!sample.some((marketplace) => codexPluginOfficialMarketplaceName(marketplace?.name))) return false;
    const source = codexPluginFilterCallbackSource(callback);
    if (!source) return false;
    if (!codexPluginHiddenFilterSourcePattern.test(source)) return false;
    return sample.some((marketplace) => codexPluginOfficialMarketplaceName(marketplace?.name)
      && !filtered.includes(marketplace));
  }

  function installPluginBuildFlavorFilterPatch() {
    if (window.__codexPluginBuildFlavorFilterPatch === codexPluginMarketplaceUnlockVersion) return;
    if (!codexPluginMarketplacePatchEnabled()) return;
    const originalFilter = Array.prototype.__codexPluginBuildFlavorOriginalFilter || Array.prototype.filter;
    if (!Array.prototype.__codexPluginBuildFlavorOriginalFilter) {
      Object.defineProperty(Array.prototype, "__codexPluginBuildFlavorOriginalFilter", {
        value: originalFilter,
        configurable: true,
        writable: true,
      });
    }
    if (Array.prototype.filter.__codexPluginBuildFlavorPatched === codexPluginMarketplaceUnlockVersion) {
      window.__codexPluginBuildFlavorFilterPatch = codexPluginMarketplaceUnlockVersion;
      return;
    }
    const patchedFilter = function codexPluginBuildFlavorFilterPatch(callback, thisArg) {
      const filtered = originalFilter.call(this, callback, thisArg);
      if (filtered.length === this.length) return filtered;
      if (!codexPluginMarketplacePatchEnabled()) return filtered;
      if (isCodexPluginBuildFlavorFilter(callback, this, filtered)) {
        sendCodexPlusDiagnostic("plugin_build_flavor_filter_bypassed", { pluginCount: this.length });
        return Array.from(this);
      }
      if (isCodexPluginMarketplaceHiddenFilter(callback, this, filtered)) {
        sendCodexPlusDiagnostic("plugin_marketplace_hidden_filter_bypassed", { marketplaceCount: this.length });
        return Array.from(this);
      }
      if (isCodexPluginFeaturedFilter(callback, this, filtered)) {
        sendCodexPlusDiagnostic("plugin_featured_filter_bypassed", { featuredCount: this.length });
        return Array.from(this);
      }
      return filtered;
    };
    patchedFilter.__codexPluginBuildFlavorPatched = codexPluginMarketplaceUnlockVersion;
    Array.prototype.filter = patchedFilter;
    window.__codexPluginBuildFlavorFilterPatch = codexPluginMarketplaceUnlockVersion;
    sendCodexPlusDiagnostic("plugin_build_flavor_filter_patch_installed", {});
  }

  function restorePluginMarketplaceRequestParams(params, method = "") {
    if (!params || typeof params !== "object") return params;
    let next = params;
    if (Array.isArray(params.marketplaceKinds)) {
      const nextKinds = params.marketplaceKinds.map((kind) => {
        if (kind === "remote:openai-curated") return "openai-curated";
        return restorePluginMarketplaceName(kind);
      });
      next = { ...next, marketplaceKinds: Array.from(new Set(nextKinds)) };
    }
    if (method === "install-plugin") {
      next = next === params ? { ...params } : { ...next };
      if (next.remoteMarketplaceName) next.remoteMarketplaceName = restorePluginMarketplaceName(next.remoteMarketplaceName);
      if (typeof next.marketplacePath === "string" && next.marketplacePath.startsWith("remote:")) {
        const remoteMarketplaceName = next.marketplacePath.slice("remote:".length);
        delete next.marketplacePath;
        next.remoteMarketplaceName = restorePluginMarketplaceName(remoteMarketplaceName);
      }
    }
    return next;
  }

  function patchPluginMarketplaceResult(method, result) {
    if (method !== "list-plugins") return result;
    let patchedCount = 0;
    try {
      const pluginMarketplaceCounts = {};
      if (Array.isArray(result?.marketplaces)) {
        result.marketplaces.forEach((marketplace) => {
          if (Array.isArray(marketplace?.plugins)) {
            marketplace.plugins.forEach((plugin) => {
              const name = plugin?.marketplaceName || marketplace?.name || "";
              if (name) pluginMarketplaceCounts[name] = (pluginMarketplaceCounts[name] || 0) + 1;
            });
          }
          if (patchPluginMarketplaceObject(marketplace)) patchedCount += 1;
        });
        sendCodexPlusDiagnostic("plugin_marketplace_response_debug", {
          marketplaces: result.marketplaces.map((marketplace) => ({
            name: marketplace?.name || "",
            path: marketplace?.path || null,
            displayName: marketplace?.displayName || marketplace?.interface?.displayName || null,
            pluginCount: Array.isArray(marketplace?.plugins) ? marketplace.plugins.length : null,
            remoteMarketplaceName: marketplace?.remoteMarketplaceName || null,
          })),
          pluginMarketplaceCounts,
        });
      }
      if (patchedCount > 0) {
        sendCodexPlusDiagnostic("plugin_marketplace_response_expanded", { patchedCount });
      }
    } catch (error) {
      sendCodexPlusDiagnostic("plugin_marketplace_response_patch_failed", {
        errorName: error?.name || "",
        errorMessage: error?.message || String(error),
      });
    }
    return result;
  }

  function pluginMarketplaceErrorText(value, visited = new WeakSet(), depth = 0) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object" || depth > 4 || visited.has(value)) return "";
    visited.add(value);
    const parts = [];
    for (const key of ["message", "error", "detail", "cause", "data", "response"]) {
      const text = pluginMarketplaceErrorText(value[key], visited, depth + 1);
      if (text) parts.push(text);
    }
    return parts.join(" ");
  }

  function pluginMarketplaceRemoteAuthError(value) {
    const text = pluginMarketplaceErrorText(value).toLowerCase();
    return text.includes("chatgpt authentication required for remote plugin catalog") && text.includes("api key auth is not supported");
  }

  const codexPluginRemoteAuthRetryMs = 60_000;

  function clearPluginMarketplaceRemoteCatalogUnavailable() {
    delete window.__codexPluginMarketplaceRemoteCatalogUnavailable;
    delete window.__codexPluginMarketplaceRemoteCatalogRejectedAt;
  }

  function pluginMarketplaceRemoteCatalogUnavailable() {
    if (window.__codexPluginMarketplaceRemoteCatalogUnavailable !== true) return false;
    const now = Date.now();
    const rejectedAt = window.__codexPluginMarketplaceRemoteCatalogRejectedAt;
    // 兼容旧注入留下的标记；只暂时降级，下次浏览可重新验证登录态。
    if (!Number.isFinite(rejectedAt)) {
      window.__codexPluginMarketplaceRemoteCatalogRejectedAt = now;
      return true;
    }
    if (now < rejectedAt || now - rejectedAt >= codexPluginRemoteAuthRetryMs) {
      clearPluginMarketplaceRemoteCatalogUnavailable();
      return false;
    }
    return true;
  }

  function markPluginMarketplaceRemoteCatalogUnavailable(error) {
    window.__codexPluginMarketplaceRemoteCatalogUnavailable = true;
    window.__codexPluginMarketplaceRemoteCatalogRejectedAt = Date.now();
    sendCodexPlusDiagnostic("plugin_marketplace_remote_auth_fallback", {
      errorMessage: pluginMarketplaceErrorText(error),
      rememberedCwdCount: Array.isArray(window.__codexPluginMarketplaceLastCwds)
        ? window.__codexPluginMarketplaceLastCwds.length
        : 0,
    });
  }

  function pluginMarketplaceFallbackResult() {
    return patchPluginMarketplaceResult("list-plugins", {
      marketplaces: [],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
    });
  }

  function localPluginMarketplaceFallbackResult() {
    return pluginMarketplaceFallbackResult();
  }

  function remoteOnlyPluginMarketplaceFallbackResult() {
    return pluginMarketplaceFallbackResult();
  }

  function patchPluginMarketplaceRequestClient(client) {
    if (!client || typeof client.sendRequest !== "function") return false;
    if (client.__codexPluginMarketplaceUnlockPatch === codexPluginMarketplaceUnlockVersion) return true;
    const originalSendRequest = client.__codexPluginMarketplaceOriginalSendRequest || client.sendRequest.bind(client);
    client.__codexPluginMarketplaceOriginalSendRequest = originalSendRequest;
    client.sendRequest = async function codexPluginMarketplacePatchedSendRequest(method, params, options) {
      const managed = alunixaXPluginNativeInterceptClient(method, params, options,
        (nextOptions) => originalSendRequest(method, params, nextOptions), client.hostId);
      if (managed) return await managed;
      const requestMethod = appServerModelRequestMethod(String(method || ""), params);
      const restoredRequestParams = restorePluginMarketplaceRequestParams(params, requestMethod);
      const requestProfile = pluginMarketplaceRequestProfile(restoredRequestParams);
      const requestParams = patchPluginMarketplaceRequestParams(requestMethod, restoredRequestParams);
      if (requestMethod === "install-plugin") {
        sendCodexPlusDiagnostic("plugin_install_request_debug", {
          method: String(method || ""),
          requestMethod,
          originalMarketplacePath: params?.marketplacePath || null,
          originalRemoteMarketplaceName: params?.remoteMarketplaceName || null,
          originalPluginName: params?.pluginName || null,
          requestMarketplacePath: requestParams?.marketplacePath || null,
          requestRemoteMarketplaceName: requestParams?.remoteMarketplaceName || null,
          requestPluginName: requestParams?.pluginName || null,
        });
      }
      try {
        const result = await originalSendRequest(method, requestParams, options);
        return patchPluginMarketplaceResult(requestMethod, result);
      } catch (error) {
        if (requestMethod === "list-plugins" && pluginMarketplaceRemoteAuthError(error)) {
          markPluginMarketplaceRemoteCatalogUnavailable(error);
          return requestProfile.remoteOnly
            ? remoteOnlyPluginMarketplaceFallbackResult()
            : localPluginMarketplaceFallbackResult();
        }
        if (requestMethod === "install-plugin") {
          sendCodexPlusDiagnostic("plugin_install_request_failed", {
            method: String(method || ""),
            requestMethod,
            requestMarketplacePath: requestParams?.marketplacePath || null,
            requestRemoteMarketplaceName: requestParams?.remoteMarketplaceName || null,
            requestPluginName: requestParams?.pluginName || null,
            errorName: error?.name || "",
            errorMessage: error?.message || String(error),
          });
        }
        throw error;
      }
    };
    client.__codexPluginMarketplaceUnlockPatch = codexPluginMarketplaceUnlockVersion;
    return true;
  }

  function patchPluginMarketplaceRequestMessage(message) {
    if (!message || typeof message !== "object") return message;
    if (message.type === "fetch" && typeof message.url === "string") {
      const requestMethod = appServerModelRequestMethod(message.url, message.body);
      if (requestMethod !== "list-plugins" && requestMethod !== "install-plugin") return message;
      let requestBody = message.body;
      let params = null;
      if (typeof requestBody === "string" && requestBody.trim()) {
        try {
          params = JSON.parse(requestBody);
        } catch {
          params = null;
        }
      } else if (requestBody && typeof requestBody === "object") {
        params = requestBody;
      }
      const restoredRequestParams = restorePluginMarketplaceRequestParams(params, requestMethod);
      const requestProfile = pluginMarketplaceRequestProfile(restoredRequestParams);
      const requestParams = patchPluginMarketplaceRequestParams(requestMethod, restoredRequestParams);
      if (requestMethod === "list-plugins" && message.requestId != null) {
        window.__codexPluginMarketplaceFetchRequestIds = window.__codexPluginMarketplaceFetchRequestIds || new Set();
        const requestId = String(message.requestId);
        window.__codexPluginMarketplaceFetchRequestIds.add(requestId);
        window.__codexPluginMarketplaceFetchRequestProfiles = window.__codexPluginMarketplaceFetchRequestProfiles || new Map();
        window.__codexPluginMarketplaceFetchRequestProfiles.set(requestId, requestProfile);
      }
      if (requestParams === params) return message;
      if (requestMethod === "install-plugin") {
        sendCodexPlusDiagnostic("plugin_install_request_debug", {
          method: message.url,
          requestMethod,
          originalMarketplacePath: params?.marketplacePath || null,
          originalRemoteMarketplaceName: params?.remoteMarketplaceName || null,
          originalPluginName: params?.pluginName || null,
          requestMarketplacePath: requestParams?.marketplacePath || null,
          requestRemoteMarketplaceName: requestParams?.remoteMarketplaceName || null,
          requestPluginName: requestParams?.pluginName || null,
        });
      }
      return {
        ...message,
        body: typeof requestBody === "string" ? JSON.stringify(requestParams) : requestParams,
      };
    }
    if (message.type === "mcp-request" && message.request && typeof message.request === "object") {
      const requestMethod = appServerModelRequestMethod(String(message.request.method || ""), message.request.params);
      if (requestMethod !== "list-plugins" && requestMethod !== "install-plugin") return message;
      const restoredRequestParams = restorePluginMarketplaceRequestParams(message.request.params, requestMethod);
      const requestProfile = pluginMarketplaceRequestProfile(restoredRequestParams);
      const requestParams = patchPluginMarketplaceRequestParams(requestMethod, restoredRequestParams);
      if (requestMethod === "list-plugins" && message.request.id != null) {
        window.__codexPluginMarketplaceRequestIds = window.__codexPluginMarketplaceRequestIds || new Set();
        const requestId = String(message.request.id);
        window.__codexPluginMarketplaceRequestIds.add(requestId);
        window.__codexPluginMarketplaceRequestProfiles = window.__codexPluginMarketplaceRequestProfiles || new Map();
        window.__codexPluginMarketplaceRequestProfiles.set(requestId, requestProfile);
      }
      if (requestParams === message.request.params) return message;
      if (requestMethod === "install-plugin") {
        sendCodexPlusDiagnostic("plugin_install_request_debug", {
          method: String(message.request.method || ""),
          requestMethod,
          originalMarketplacePath: message.request.params?.marketplacePath || null,
          originalRemoteMarketplaceName: message.request.params?.remoteMarketplaceName || null,
          originalPluginName: message.request.params?.pluginName || null,
          requestMarketplacePath: requestParams?.marketplacePath || null,
          requestRemoteMarketplaceName: requestParams?.remoteMarketplaceName || null,
          requestPluginName: requestParams?.pluginName || null,
        });
      }
      return { ...message, request: { ...message.request, params: requestParams } };
    }
    return message;
  }

  function patchPluginMarketplaceResponseData(data) {
    if (data?.type === "fetch-response") {
      const requestId = data.requestId != null ? String(data.requestId) : "";
      const requestIds = window.__codexPluginMarketplaceFetchRequestIds;
      const requestProfiles = window.__codexPluginMarketplaceFetchRequestProfiles;
      const requestProfile = requestProfiles instanceof Map ? requestProfiles.get(requestId) : null;
      if (requestIds instanceof Set && requestIds.size > 0) {
        if (!requestIds.has(requestId)) return false;
        requestIds.delete(requestId);
      }
      if (requestProfiles instanceof Map) requestProfiles.delete(requestId);
      if (typeof data.bodyJsonString !== "string" || !data.bodyJsonString.trim()) return false;
      try {
        let result = JSON.parse(data.bodyJsonString);
        if (pluginMarketplaceRemoteAuthError(result?.error || result)) {
          markPluginMarketplaceRemoteCatalogUnavailable(result?.error || result);
          const fallback = requestProfile?.remoteOnly
            ? remoteOnlyPluginMarketplaceFallbackResult()
            : localPluginMarketplaceFallbackResult();
          if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "id")) {
            delete result.error;
            result.result = fallback;
          } else {
            result = fallback;
          }
        } else if (result && typeof result === "object") {
          patchPluginMarketplaceResult("list-plugins", result);
          patchPluginMarketplaceResult("list-plugins", result.data);
        }
        data.bodyJsonString = JSON.stringify(result);
        return true;
      } catch (error) {
        sendCodexPlusDiagnostic("plugin_marketplace_fetch_response_patch_failed", {
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
      }
      return false;
    }
    if (data?.type !== "mcp-response") return false;
    const message = data.message || data.response;
    const method = String(message?.method || data.method || "");
    if (appServerModelRequestMethod(method) === "install-plugin") {
      clearPluginMarketplaceQueryCache();
    }
    const requestId = message?.id != null ? String(message.id) : "";
    const requestIds = window.__codexPluginMarketplaceRequestIds;
    const requestProfiles = window.__codexPluginMarketplaceRequestProfiles;
    const requestProfile = requestProfiles instanceof Map ? requestProfiles.get(requestId) : null;
    if (requestIds instanceof Set && requestIds.size > 0) {
      if (!requestIds.has(requestId)) return false;
      requestIds.delete(requestId);
    }
    if (requestProfiles instanceof Map) requestProfiles.delete(requestId);
    if (pluginMarketplaceRemoteAuthError(message?.error)) {
      markPluginMarketplaceRemoteCatalogUnavailable(message.error);
      delete message.error;
      message.result = requestProfile?.remoteOnly
        ? remoteOnlyPluginMarketplaceFallbackResult()
        : localPluginMarketplaceFallbackResult();
      return true;
    }
    const result = message?.result;
    if (!result || typeof result !== "object") return false;
    patchPluginMarketplaceResult("list-plugins", result);
    patchPluginMarketplaceResult("list-plugins", result.data);
    return true;
  }

  if (window.__ALUNIXA_X_TEST_PLUGIN_MARKETPLACE__) {
    window.__alunixaXPluginMarketplaceTest = {
      patchRequestParams: patchPluginMarketplaceRequestParams,
      patchRequestMessage: patchPluginMarketplaceRequestMessage,
      patchResponseData: patchPluginMarketplaceResponseData,
      remoteAuthError: pluginMarketplaceRemoteAuthError,
      localFallback: localPluginMarketplaceFallbackResult,
      remoteOnlyFallback: remoteOnlyPluginMarketplaceFallbackResult,
      requestProfile: pluginMarketplaceRequestProfile,
      isBuildFlavorFilter: isCodexPluginBuildFlavorFilter,
      isHiddenMarketplaceFilter: isCodexPluginMarketplaceHiddenFilter,
      setCodexAppVersion: (version) => {
        alunixaXBackendSettings.codexAppVersion = String(version || "");
      },
      remoteCatalogUnavailable: pluginMarketplaceRemoteCatalogUnavailable,
      reset: () => {
        delete window.__codexPluginMarketplaceLastCwds;
        clearPluginMarketplaceRemoteCatalogUnavailable();
        window.__codexPluginMarketplaceRequestIds = new Set();
        window.__codexPluginMarketplaceFetchRequestIds = new Set();
        window.__codexPluginMarketplaceRequestProfiles = new Map();
        window.__codexPluginMarketplaceFetchRequestProfiles = new Map();
      },
    };
    return;
  }

  function clearPluginMarketplaceQueryCache() {
    clearPluginMarketplaceRemoteCatalogUnavailable();
    try {
      const queryClient = window.__REACT_QUERY_CLIENT__ || window.__codexQueryClient;
      if (queryClient && typeof queryClient.invalidateQueries === "function") {
        queryClient.invalidateQueries({ queryKey: ["plugins"] });
      }
    } catch {
    }
  }

  function installPluginMarketplaceBridgePatch() {
    ensureCodexPlusPluginNativeTransportReinjection();
    if (window.__codexPluginMarketplaceBridgePatch === codexPluginMarketplaceUnlockVersion) return;
    if (!codexPluginMarketplacePatchEnabled()) return;
    installCodexPlusPluginNativeTransportListener();
    installPluginMarketplaceWindowEventPatchOnly();
    const bridge = window.electronBridge;
    if (!bridge || typeof bridge.sendMessageFromView !== "function") {
      sendCodexPlusDiagnostic("plugin_marketplace_bridge_patch_not_found", {});
      return;
    }
    if (!bridge.__codexPluginMarketplaceOriginalSendMessageFromView) {
      bridge.__codexPluginMarketplaceOriginalSendMessageFromView = bridge.sendMessageFromView.bind(bridge);
      bridge.sendMessageFromView = function codexPluginMarketplacePatchedSendMessageFromView(message) {
        if (alunixaXPluginNativeInterceptOutgoing(message)) return Promise.resolve();
        let nextMessage = message;
        try {
          nextMessage = patchPluginMarketplaceRequestMessage(message);
        } catch (error) {
          sendCodexPlusDiagnostic("plugin_marketplace_bridge_request_patch_failed", {
            errorName: error?.name || "",
            errorMessage: error?.message || String(error),
          });
        }
        return bridge.__codexPluginMarketplaceOriginalSendMessageFromView(nextMessage);
      };
    }
    bridge.__codexPluginMarketplaceBridgePatch = codexPluginMarketplaceUnlockVersion;
    window.__codexPluginMarketplaceBridgePatch = codexPluginMarketplaceUnlockVersion;
    sendCodexPlusDiagnostic("plugin_marketplace_bridge_patch_installed", {});
  }

  function installPluginMarketplaceWindowEventPatchOnly() {
    if (window.__codexPluginMarketplaceWindowEventPatch === codexPluginMarketplaceUnlockVersion) return;
    if (!codexPluginMarketplacePatchEnabled()) return;
    const originalDispatchEvent = window.__codexPluginMarketplaceOriginalDispatchEvent || window.dispatchEvent;
    if (!window.__codexPluginMarketplaceOriginalDispatchEvent) {
      window.__codexPluginMarketplaceOriginalDispatchEvent = originalDispatchEvent;
      window.dispatchEvent = function patchedCodexPluginMarketplaceDispatchEvent(event) {
        try {
          const detail = event?.detail;
          if (event?.type === "codex-message-from-view" && event.__codexForwardedViaBridge
              && alunixaXPluginNativeSuppressForwarded(detail)) return true;
          if (event?.type === "codex-message-from-view" && !event.__codexForwardedViaBridge
              && alunixaXPluginNativeInterceptOutgoing(detail)) return true;
          if (event?.type === "message" && alunixaXPluginNativeInterceptIncoming(event.data)) return true;
          if (event?.type === "codex-message-from-view" && detail?.type === "mcp-request") {
            const patched = patchPluginMarketplaceRequestMessage(detail);
            if (patched !== detail) {
              Object.keys(detail).forEach((key) => delete detail[key]);
              Object.assign(detail, patched);
            }
          }
          if (event?.type === "message") patchPluginMarketplaceResponseData(event.data);
        } catch (error) {
          sendCodexPlusDiagnostic("plugin_marketplace_dispatch_event_patch_failed", {
            errorName: error?.name || "",
            errorMessage: error?.message || String(error),
          });
        }
        return originalDispatchEvent.call(this, event);
      };
    }
    if (!window.__codexPluginMarketplaceResponseListenerInstalled) {
      window.__codexPluginMarketplaceResponseListenerInstalled = true;
      window.addEventListener("message", (event) => {
        try {
          patchPluginMarketplaceResponseData(event?.data);
        } catch (error) {
          sendCodexPlusDiagnostic("plugin_marketplace_response_message_patch_failed", {
            errorName: error?.name || "",
            errorMessage: error?.message || String(error),
          });
        }
      }, true);
    }
    window.__codexPluginMarketplaceWindowEventPatch = codexPluginMarketplaceUnlockVersion;
  }

  const pluginMarketplaceRequestPatchMaxMisses = 8;
  let pluginMarketplaceRequestPatchMissCount = 0;
  let pluginMarketplaceRequestPatchDisabled = false;
  let pluginMarketplaceRequestPatchPromise = null;

  function notePluginMarketplaceRequestPatchMiss(event, detail) {
    pluginMarketplaceRequestPatchMissCount += 1;
    // 和 installAppServerModelRequestPatch 里那段(issue #1324)是同一类问题,当时只修了 model 那一层。
    // 这个补丁在 scanDeferred() 里每轮都会跑,而早退守卫 __codexPluginMarketplaceUnlockInstalled
    // 只在 patchedCount > 0 时才写入。Codex 侧改名/移除对应 asset 后这层永远成功不了,
    // 守卫就永远不设,于是每轮 scan 都重新把全部 app asset fetch 一遍再跑正则匹配,
    // 而且没有 in-flight 去重,尝试之间还会并发堆叠。
    // 实测空闲状态下 530 次 fetch/秒(单个 asset 最高 265 次/秒),渲染进程 CPU 40%~60% 且持续爬升(issue #1960)。
    // 首次 miss 仍然上报,保证 telemetry 能定位原因,之后噤声;连续失败够多次就停掉这一层。
    // 这是优雅降级:插件市场解锁还有 bridge / window-event 两层补丁各自独立工作。
    if (pluginMarketplaceRequestPatchMissCount === 1) {
      sendCodexPlusDiagnostic(event, detail);
    }
    if (
      pluginMarketplaceRequestPatchMissCount >= pluginMarketplaceRequestPatchMaxMisses
      && !pluginMarketplaceRequestPatchDisabled
    ) {
      pluginMarketplaceRequestPatchDisabled = true;
      sendCodexPlusDiagnostic("plugin_marketplace_request_patch_skipped", {
        misses: pluginMarketplaceRequestPatchMissCount,
        lastEvent: event,
      });
    }
  }

  function installPluginMarketplaceRequestPatch() {
    if (window.__codexPluginMarketplaceUnlockInstalled === codexPluginMarketplaceUnlockVersion) return;
    if (!codexPluginMarketplacePatchEnabled()) return;
    if (pluginMarketplaceRequestPatchDisabled) return;
    // 上一轮还没跑完就不要再起一轮:loadAppServerRequestCandidates() 会把所有 app asset 拉一遍,
    // 没有这道去重时 scan 的频率直接变成并发 fetch 的频率。
    if (pluginMarketplaceRequestPatchPromise) return;
    const patch = async () => {
      try {
        const { modules, candidates, sources, discovery } = await loadAppServerRequestCandidates();
        let patchedCount = 0;
        for (const candidate of candidates) {
          if (patchPluginMarketplaceRequestClient(candidate)) patchedCount += 1;
        }
        if (patchedCount > 0) {
          window.__codexPluginMarketplaceUnlockInstalled = codexPluginMarketplaceUnlockVersion;
          pluginMarketplaceRequestPatchMissCount = 0;
          sendCodexPlusDiagnostic("plugin_marketplace_request_patch_installed", {
            moduleCount: modules.length,
            candidateCount: candidates.length,
            patchedCount,
            sources,
            discovery,
          });
        } else {
          notePluginMarketplaceRequestPatchMiss("plugin_marketplace_request_patch_not_found", {
            moduleCount: modules.length,
            candidateCount: candidates.length,
            sources,
            discovery,
          });
        }
      } catch (error) {
        notePluginMarketplaceRequestPatchMiss("plugin_marketplace_request_patch_failed", {
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
      } finally {
        pluginMarketplaceRequestPatchPromise = null;
      }
    };
    pluginMarketplaceRequestPatchPromise = patch();
  }

  function codexPluginMarketplacePatchEnabled() {
    return alunixaXBackendSettingsLoaded && alunixaXBackendSettings.launchMode !== "relay"
      && !!alunixaXSettings().pluginMarketplaceUnlock;
  }

  let cachedSessionRows = [];
  let cachedSessionRowsAt = 0;
  let threadIdBadgeActive = false;

  function sessionRows(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && now - cachedSessionRowsAt < 150) {
      cachedSessionRows = cachedSessionRows.filter((row) => row.isConnected);
      if (cachedSessionRows.length > 0) return cachedSessionRows;
    }

    cachedSessionRows = Array.from(document.querySelectorAll(selectors.sidebarThread));
    cachedSessionRowsAt = now;
    return cachedSessionRows;
  }

  function archivePageHintVisible() {
    if (window.location.href.includes("archive")) return true;
    if (document.querySelector('[data-codex-archive-page-row="true"], [data-codex-archive-delete-all]')) return true;
    const archiveNav = document.querySelector(selectors.archiveNav);
    if (archiveNav?.className?.includes?.("bg-token-list-hover-background")) return true;
    return !!Array.from(document.querySelectorAll("h1, h2, h3")).find((element) => (element.textContent || "").trim() === "已归档对话");
  }

  function archiveRowFromUnarchiveButton(button) {
    return button.closest('[data-codex-archive-page-row="true"]')
      || button.closest('[role="listitem"], [role="row"]')
      || button.closest(".flex.w-full.items-center.justify-between")
      || button.parentElement;
  }

  function archivedPageRows() {
    if (!archivePageHintVisible()) return [];
    const rows = Array.from(document.querySelectorAll("button")).filter((button) => (button.textContent || "").trim() === "取消归档").map(archiveRowFromUnarchiveButton).filter(Boolean);
    rows.forEach((row) => {
      row.dataset.codexArchivePageRow = "true";
      row.setAttribute("data-codex-archive-page-row", "true");
    });
    return rows;
  }

  function archivedSessionRows() {
    if (!archivePageHintVisible()) return [];
    return sessionRows().filter((row) => row.querySelector('button[aria-label="取消归档对话"]') || row.outerHTML.includes("取消归档") || row.outerHTML.includes("unarchive"));
  }

  function archivedRows() {
    if (!archivePageHintVisible()) return [];
    return [...archivedSessionRows(), ...archivedPageRows()];
  }

  function archivedPageVisible() {
    return archivePageHintVisible() && archivedRows().length > 0;
  }

  function isClientNewThreadId(value) {
    return /^(?:local:)?client-new-thread:/i.test(String(value || "").trim());
  }

  function normalizedCodexThreadUuid(value) {
    const id = String(value || "").trim().replace(/^local:/i, "");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "";
  }

  function reactConversationIdFromRow(row) {
    const fiberKey = Object.getOwnPropertyNames(row).find((key) => key.startsWith("__reactFiber$"));
    let fiber = fiberKey ? row[fiberKey] : null;
    for (let fiberDepth = 0; fiber && fiberDepth < 16; fiberDepth += 1, fiber = fiber.return) {
      for (const props of [fiber.pendingProps, fiber.memoizedProps]) {
        const directId = normalizedCodexThreadUuid(props?.conversationId);
        if (directId) return directId;
        const childId = normalizedCodexThreadUuid(
          props?.children?.props?.conversationId,
        );
        if (childId) return childId;
      }
    }
    return "";
  }

  function sessionRefFromRow(row) {
    const href = row.getAttribute("href") || row.querySelector("a")?.getAttribute("href") || "";
    const idMatch = href.match(/(?:session|conversation|thread)[=/:-]([A-Za-z0-9_.-]+)/i) || href.match(/([A-Za-z0-9_-]{8,})$/);
    const codexThreadId = row.getAttribute("data-app-action-sidebar-thread-id") || "";
    const scopedThread = codexThreadId.match(/^(.+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    const fallbackId = row.getAttribute("data-session-id") || row.getAttribute("data-testid") || "";
    const placeholderThreadId = isClientNewThreadId(codexThreadId);
    const hrefId = idMatch && idMatch[1];
    const canonicalHrefId = normalizedCodexThreadUuid(hrefId);
    const hrefIsTemporary = isClientNewThreadId(href)
      || isClientNewThreadId(hrefId)
      || /(?:^|[=/])(?:local:)?client-new-thread:/i.test(href);
    const sessionId = placeholderThreadId
      ? canonicalHrefId || (!hrefIsTemporary ? reactConversationIdFromRow(row) : "")
      : normalizedCodexThreadUuid(codexThreadId)
        || (scopedThread ? scopedThread[2] : "")
        || canonicalHrefId
        || codexThreadId
        || hrefId
        || fallbackId;
    const titleNode = row.querySelector(`${selectors.threadTitle}, .truncate.select-none, .truncate.text-base`);
    const rawTitle = (titleNode?.textContent || (titleNode ? "" : (row.textContent || "Untitled session")));
    const title = (titleNode ? rawTitle : rawTitle.replace(/\s*(导出|删除|移动|移出项目)(\s*(导出|删除|移动|移出项目))*$/g, "")).trim().slice(0, 160);
    return { session_id: sessionId, title, host_id: sessionHostIdFromRow(row, sessionId, scopedThread?.[1]) };
  }

  function sessionHostIdFromRow(row, sessionId, scopedHost) {
    return sessionHostEvidenceFromRow(row, sessionId, scopedHost).hostId;
  }

  function sessionHostEvidenceFromRow(row, sessionId, scopedHost) {
    const hosts = new Set();
    let matchingMetadata = 0;
    let identityConflict = false;
    const add = (value) => {
      if (typeof value === "string" && value.trim()) hosts.add(value.trim());
    };
    const identity = (value) => {
      if (typeof value !== "string" || !value.trim()) return null;
      const raw = value.trim();
      const scoped = raw.match(/^(.+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      const id = normalizedCodexThreadUuid(raw) || scoped?.[2];
      return id ? { id: id.toLowerCase(), host: scoped?.[1] } : raw === sessionId ? { id: raw, host: null } : null;
    };
    const canonicalWanted = normalizedCodexThreadUuid(sessionId);
    const wanted = canonicalWanted ? canonicalWanted.toLowerCase() : sessionId || "";
    const identities = (record) => [record?.conversationId, record?.threadId, record?.id].map(identity).filter(Boolean);
    const collect = (record) => {
      if (!record || typeof record !== "object") return;
      const ownIds = identities(record);
      const matched = ownIds.some((candidate) => candidate.id === wanted);
      const nested = [record.threadSummary, record.thread, record.target].filter((value) => value && typeof value === "object");
      const allIds = [...ownIds, ...nested.flatMap(identities)];
      if (allIds.some((candidate) => candidate.id === wanted) && allIds.some((candidate) => candidate.id !== wanted)) {
        identityConflict = true;
        return;
      }
      if (matched) {
        matchingMetadata += 1;
        add(record.hostId);
        ownIds.forEach((candidate) => add(candidate.host));
        // 26.930 原生 sidebar 行的 {conversationId,hostId,threadSummary}：
        // hostId ?? threadSummary?.hostId。summary 没有自己的 id 时仍属于这条会话。
        if (record.threadSummary && !["conversationId", "threadId", "id"].some((key) => typeof record.threadSummary[key] === "string" && record.threadSummary[key].trim())) add(record.threadSummary.hostId);
      }
      for (const child of nested) {
        const childIds = identities(child);
        if (!childIds.some((candidate) => candidate.id === wanted)) continue;
        matchingMetadata += 1;
        add(child.hostId);
        childIds.forEach((candidate) => add(candidate.host));
      }
    };
    add(row.getAttribute("data-app-action-sidebar-thread-host-id"));
    const rowIdentity = identity(row.getAttribute("data-app-action-sidebar-thread-id"));
    if (rowIdentity?.id === wanted) add(scopedHost || rowIdentity.host);
    // 只接受同一条会话的成对身份。原生 locator 为 {hostId,threadId}，
    // sidebarThreadRow 为 {hostId,id}；bare UUID 或不相关祖先的 hostId 都不说明归属。
    const fiberKey = Object.getOwnPropertyNames(row).find((key) => key.startsWith("__reactFiber$"));
    let fiber = fiberKey ? row[fiberKey] : null;
    for (let depth = 0; fiber && depth < 16; depth += 1, fiber = fiber.return) {
      for (const props of [fiber.pendingProps, fiber.memoizedProps, fiber.pendingProps?.children?.props, fiber.memoizedProps?.children?.props]) {
        collect(props);
      }
    }
    const conflict = identityConflict || hosts.size > 1;
    return {
      hostId: !conflict && hosts.size === 1 ? [...hosts][0] : null,
      reason: conflict ? "conflicting" : hosts.size === 1 ? "resolved" : "unknown",
      hostCount: hosts.size,
      matchingMetadata,
    };
  }

  if (window.__ALUNIXA_X_TEST_SESSION_REF__) {
    window.__alunixaXSessionRefTest = {
      fromRow: sessionRefFromRow,
    };
  }

  // 注册数据跨重注入保留；只存弱引用，不缓存会重建的 sidebar DOM。
  const codexNativeHostClients = window.__alunixaXNativeHostClients instanceof Map
    ? window.__alunixaXNativeHostClients
    : (window.__alunixaXNativeHostClients = new Map());
  const codexNativeHostClientLimit = 32;

  function bindNativeHostClient(hostId, client, getterBound = false) {
    if (typeof hostId !== "string" || !hostId.trim() || !client || typeof client.sendRequest !== "function") return false;
    hostId = hostId.trim();
    if (typeof client.hostId === "string" && client.hostId !== hostId) return false;
    if (!getterBound && client.hostId !== hostId) return false;
    codexNativeHostClients.delete(hostId);
    codexNativeHostClients.set(hostId, {
      hostId, getterBound,
      ref: typeof WeakRef === "function" ? new WeakRef(client) : { deref: () => client },
    });
    while (codexNativeHostClients.size > codexNativeHostClientLimit) {
      codexNativeHostClients.delete(codexNativeHostClients.keys().next().value);
    }
    return true;
  }

  function registerNativeHostClient(client) {
    try {
      // 已安装客户端的 RequestClient 构造器把 hostId 绑定到 dispatcher。
      // 普通 HTTP/IPC duck-type sendRequest 对象不能充当这个删除客户端。
      if (!Function.prototype.toString.call(client?.constructor).includes(codexAppServerClientCaptureMarker)) return false;
      return bindNativeHostClient(client.hostId, client);
    } catch { return false; }
  }

  function nativeHostClient(hostId) {
    const entry = codexNativeHostClients.get(hostId);
    const client = entry?.ref?.deref();
    // AppScope 的 forHost RPC proxy 每次操作现取，避免跨账号/树重建复用旧 scope。
    if (entry?.getterBound) return null;
    if (!client || client.disposed === true || (typeof client.hostId === "string" && client.hostId !== hostId)
        || (!entry.getterBound && client.hostId !== hostId)) {
      codexNativeHostClients.delete(hostId);
      return null;
    }
    return client;
  }

  async function discoverNativeHostClient(ref) {
    // 原生 DeleteThreadDialog 的实装：getter(scope, hostId).sendRequest("thread/delete", {threadId})。
    // getter 读取 AppScope 的 manager RPC，再 forHost(hostId)。只接受这个已验证的签名。
    const module = await loadOptionalCodexAppModule("app-shared-");
    const values = Object.values(module || {});
    const getters = values.filter((value) => {
      if (typeof value !== "function") return false;
      const source = Function.prototype.toString.call(value);
      return source.includes("AppServerManager RPC is not connected") && /\.forHost\(/.test(source);
    });
    if (!getters.length) return null;
    for (const row of sessionRows(true)) {
      const rowRef = sessionRefFromRow(row);
      if (rowRef.session_id !== ref.session_id || rowRef.host_id !== ref.host_id) continue;
      const fiberKey = Object.getOwnPropertyNames(row).find((key) => key.startsWith("__reactFiber$"));
      let fiber = fiberKey ? row[fiberKey] : null;
      for (let depth = 0; fiber && depth < 16; depth += 1, fiber = fiber.return) {
        let hook = fiber.memoizedState;
        for (let index = 0; hook && index < 64; index += 1, hook = hook.next) {
          const scope = hook.memoizedState?.current;
          if (!scope || typeof scope.get !== "function" || !values.includes(scope.scope)) continue;
          for (const getter of getters) {
            try {
              const client = getter(scope, ref.host_id);
              if (bindNativeHostClient(ref.host_id, client, true)) return client;
            } catch {}
          }
        }
      }
    }
    return null;
  }

  function deletePayloadHost(payload) {
    if (!payload || typeof payload !== "object") return null;
    const parse = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
    const snake = parse(payload?.host_id);
    const camel = parse(payload?.hostId);
    if (payload && "host_id" in payload && "hostId" in payload && snake !== camel) return null;
    return snake || camel;
  }

  async function deleteRemoteSession(ref) {
    const failed = (message) => ({ status: "failed", session_id: ref.session_id, message, undo_token: null, backup_path: null });
    if (!ref.host_id || ref.host_id === "local" || !normalizedCodexThreadUuid(ref.session_id)) {
      return failed("无法安全确定远端会话归属，未进行本地删除");
    }
    try {
      let client = null;
      try { client = await discoverNativeHostClient(ref); } catch {}
      client = client || nativeHostClient(ref.host_id);
      if (!client) return failed("当前未找到对应主机的原生删除客户端；请使用 Codex 原生删除，未进行本地回退");
      const result = await client.sendRequest("thread/delete", { threadId: ref.session_id });
      if (result?.error || result?.status === "failed") throw new Error("native deletion failed");
      // 原生 thread/deleted 通知由同 host manager 清理缓存；这里不碰本地库或伪造 undo。
      return { status: "server_deleted", session_id: ref.session_id, message: "远端任务及子任务已永久删除，无法撤销", undo_token: null, backup_path: null };
    } catch {
      return failed("远端删除结果未确认，未进行本地回退；请先刷新远端状态再决定是否重试");
    }
  }

  if (window.__ALUNIXA_X_TEST_SESSION_REF__) {
    Object.assign(window.__alunixaXSessionRefTest, {
      registerNativeHostClient, deleteRemoteSession, deletePayloadHost,
    });
  }

  function threadIdBadgeTitleNode(row) {
    return row.querySelector(`${selectors.threadTitle}, .truncate.select-none, .truncate.text-base`);
  }

  function padThreadIdBadgePart(value) {
    return String(value).padStart(2, "0");
  }

  function threadIdBadgeCreatedAt(sessionId) {
    const timestampMs = uuidV7TimestampMs(sessionId);
    const minReasonableMs = Date.UTC(2020, 0, 1);
    const maxReasonableMs = Date.now() + 366 * 24 * 60 * 60 * 1000;
    if (!timestampMs || timestampMs < minReasonableMs || timestampMs > maxReasonableMs) return null;
    return new Date(timestampMs);
  }

  function formatThreadIdBadgeCreatedAt(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${padThreadIdBadgePart(date.getMonth() + 1)}-${padThreadIdBadgePart(date.getDate())} ${padThreadIdBadgePart(date.getHours())}:${padThreadIdBadgePart(date.getMinutes())}`;
  }

  function threadIdBadgeMeta(sessionId) {
    const id = sessionKey(sessionId);
    const compact = id.replaceAll("-", "");
    const shortId = compact.slice(0, 8);
    const createdAt = threadIdBadgeCreatedAt(sessionId);
    const createdLabel = formatThreadIdBadgeCreatedAt(createdAt);
    return {
      id,
      shortId,
      createdAt,
      label: shortId ? `[${shortId}${createdLabel ? ` ${createdLabel}` : ""}]` : "",
    };
  }

  // issue #2180：过去这里把官方 React 管理的标题节点塞进自建的 wrapper 里
  // （parent.insertBefore(wrapper, titleNode) + wrapper.appendChild(titleNode)）。
  // 标题节点一旦被搬走，React 的移除链路就会对着自己记录的旧父节点做
  // removeChild，抛 `NotFoundError: The node to be removed is not a child of this node`。
  // 新建对话几分钟后标题从临时名转正式名、侧栏重排时正好命中，页面直接进错误页。
  // 现在不搬动任何 React 节点：徽章作为 titleNode 的**兄弟**插在它前面，
  // 行的 flex 布局本来就按顺序排（徽章自带 flex:0 0 auto + margin-right）。
  function threadIdBadgeInsertBefore(titleNode) {
    return titleNode?.parentElement || titleNode?.parentNode || null;
  }

  // 存量数据清理：旧版留下的 wrapper 需要还原一次，否则标题会一直被困在里面。
  // 只做还原，不再新建任何 wrapper。
  function unwrapThreadIdBadgeWrappers(root = document) {
    root.querySelectorAll?.('[data-codex-thread-id-badge-wrap="true"]').forEach((wrapper) => {
      const parent = wrapper.parentElement;
      if (!parent) return;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    });
  }

  function removeThreadIdBadges(root = document) {
    root.querySelectorAll?.(`.${threadIdBadgeClass}`).forEach((badge) => badge.remove());
    unwrapThreadIdBadgeWrappers(root);
    const rows = root.matches?.(selectors.sidebarThread) ? [root] : Array.from(root.querySelectorAll?.(selectors.sidebarThread) || []);
    rows.forEach((row) => {
      delete row.dataset.codexThreadIdBadge;
      delete row.dataset.codexThreadIdBadgeVersion;
    });
  }

  function installThreadIdBadge(row) {
    const ref = sessionRefFromRow(row);
    if (!ref.session_id) {
      removeThreadIdBadges(row);
      return;
    }
    const meta = threadIdBadgeMeta(ref.session_id);
    const titleNode = threadIdBadgeTitleNode(row);
    if (!meta.label || !titleNode) {
      removeThreadIdBadges(row);
      return;
    }

    // 旧 wrapper 先还原，保证 badge 与 titleNode 在同一个父节点下做兄弟。
    unwrapThreadIdBadgeWrappers(row);

    const parent = threadIdBadgeInsertBefore(titleNode);
    if (!parent) return;

    let badge = row.querySelector(`.${threadIdBadgeClass}`);
    if (!badge || badge.parentElement !== parent) {
      badge?.remove();
      badge = document.createElement("span");
      badge.className = threadIdBadgeClass;
      // 只插自己的节点，不碰官方节点。
      parent.insertBefore(badge, titleNode);
    }

    badge.dataset.codexThreadIdBadgeVersion = codexThreadIdBadgeVersion;
    if (badge.textContent !== meta.label) badge.textContent = meta.label;
    const fullTitle = meta.createdAt
      ? `${meta.label}\nSession ID: ${meta.id}\nCreated: ${meta.createdAt.toLocaleString()}`
      : `${meta.label}\nSession ID: ${meta.id}`;
    badge.setAttribute("title", fullTitle);
    badge.setAttribute("aria-label", fullTitle);
    row.dataset.codexThreadIdBadge = meta.label;
    row.dataset.codexThreadIdBadgeVersion = codexThreadIdBadgeVersion;
  }

  function refreshThreadIdBadges() {
    if (!alunixaXSettings().threadIdBadge) {
      if (threadIdBadgeActive) {
        removeThreadIdBadges();
        threadIdBadgeActive = false;
      }
      return;
    }
    threadIdBadgeActive = true;
    sessionRows().forEach(installThreadIdBadge);
  }

  function alunixaXDiagnosticPayload(event, detail) {
    return {
      event,
      detail: detail || {},
      helperBase,
      hasBridge: !!window.__codexSessionDeleteBridge,
      location: window.location?.href || "",
      userAgent: navigator.userAgent || "",
      timestamp: new Date().toISOString(),
    };
  }

  function sendCodexPlusDiagnostic(event, detail) {
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

  sendCodexPlusDiagnostic("script_loaded", {
    version: alunixaXVersion,
    build: alunixaXBuild,
  });

  function locationThreadId() {
    const source = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const match = source.match(/(?:session|conversation|thread)(?:\/|=|:|-)([A-Za-z0-9_.-]+)/i)
      || source.match(/\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[/?#]|$)/)
      || source.match(/\/([A-Za-z0-9_-]{24,})(?:[/?#]|$)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function finiteNonNegativeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  function finiteScrollNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function validThreadScrollSessionKey(sessionId) {
    const key = sessionKey(sessionId);
    if (!key || key === "__proto__" || key === "prototype" || key === "constructor") return "";
    return /^[A-Za-z0-9_.-]{8,128}$/.test(key) ? key : "";
  }

  function currentSessionRef() {
    const rows = sessionRows();
    for (const row of rows) {
      const ref = sessionRefFromRow(row);
      if (ref.session_id && isCurrentSessionRow(row, ref)) return ref;
    }
    return { session_id: locationThreadId(), title: "" };
  }

  function readThreadScrollEntries() {
    if (window.__codexThreadScrollEntries && typeof window.__codexThreadScrollEntries === "object") {
      return { ...window.__codexThreadScrollEntries };
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(codexThreadScrollKey) || "{}");
      const rawEntries = parsed?.version === codexThreadScrollVersion && parsed?.entries && typeof parsed.entries === "object"
        ? parsed.entries
        : parsed && typeof parsed === "object"
          ? parsed
          : {};
      const entries = Object.create(null);
      Object.entries(rawEntries).forEach(([key, value]) => {
        const safeKey = validThreadScrollSessionKey(key);
        if (!safeKey || !value || typeof value !== "object") return;
        entries[safeKey] = {
          top: finiteScrollNumber(value.top),
          scrollHeight: finiteNonNegativeNumber(value.scrollHeight),
          clientHeight: finiteNonNegativeNumber(value.clientHeight),
          at: finiteNonNegativeNumber(value.at),
        };
      });
      window.__codexThreadScrollEntries = entries;
      return { ...entries };
    } catch {
      window.__codexThreadScrollEntries = Object.create(null);
      return {};
    }
  }

  function writeThreadScrollEntries(entries) {
    const pruned = Object.create(null);
    Object.entries(entries || {})
      .sort((left, right) => finiteNonNegativeNumber(right[1]?.at) - finiteNonNegativeNumber(left[1]?.at))
      .slice(0, codexThreadScrollMaxEntries)
      .forEach(([key, value]) => {
        const safeKey = validThreadScrollSessionKey(key);
        if (safeKey) pruned[safeKey] = value;
      });
    window.__codexThreadScrollEntries = pruned;
    const payload = JSON.stringify({ version: codexThreadScrollVersion, entries: pruned });
    try {
      localStorage.setItem(codexThreadScrollKey, payload);
    } catch {
      // 本地存储配额已满时不能把异常抛到页面全局，否则滚动保存会把渲染进程打进刷新循环。
      try {
        const newestKey = Object.keys(pruned)[0];
        const emergency = Object.create(null);
        if (newestKey) emergency[newestKey] = pruned[newestKey];
        window.__codexThreadScrollEntries = emergency;
        localStorage.removeItem(codexThreadScrollKey);
        localStorage.setItem(codexThreadScrollKey, JSON.stringify({ version: codexThreadScrollVersion, entries: emergency }));
      } catch {
        try { localStorage.removeItem(codexThreadScrollKey); } catch { /* 放弃持久化，内存副本仍可用 */ }
      }
    }
  }

  function currentThreadScroller() {
    const explicit = document.querySelector(".thread-scroll-container");
    if (explicit?.isConnected) return explicit;
    const root = conversationRoot();
    if (!root?.isConnected) return document.scrollingElement || document.documentElement;
    const style = getComputedStyle(root);
    if (/(auto|scroll)/.test(style.overflowY) && root.scrollHeight > root.clientHeight) return root;
    return nearestScrollableAncestor(root);
  }

  function threadScrollRuntime() {
    if (!window.__codexThreadScrollRuntime || typeof window.__codexThreadScrollRuntime !== "object") {
      window.__codexThreadScrollRuntime = {
        activeSessionId: "",
        activeScroller: null,
        scrollListener: null,
        scrollListenerUsesWindow: false,
        lastSavedTop: -1,
        lastSavedHeight: -1,
        lastSavedClientHeight: -1,
        restoreLock: null,
        applyingRestore: false,
        pendingNavigation: null,
        userScrollIntentUntil: 0,
        userCancelledRestoreSessionId: "",
      };
    }
    return window.__codexThreadScrollRuntime;
  }

  function clearThreadScrollRestoreTimers() {
    (window.__codexThreadScrollRestoreTimers || []).forEach((timer) => clearTimeout(timer));
    window.__codexThreadScrollRestoreTimers = [];
  }

  function clearThreadScrollSyncTimers() {
    (window.__codexThreadScrollSyncTimers || []).forEach((timer) => clearTimeout(timer));
    window.__codexThreadScrollSyncTimers = [];
  }

  function clearThreadScrollRestoreLock() {
    threadScrollRuntime().restoreLock = null;
  }

  function cancelThreadScrollRestoreForUserIntent() {
    const runtime = threadScrollRuntime();
    const cancelledSessionId = validThreadScrollSessionKey(runtime.restoreLock?.sessionId)
      || validThreadScrollSessionKey(currentSessionRef().session_id)
      || validThreadScrollSessionKey(runtime.activeSessionId);
    runtime.userScrollIntentUntil = Date.now() + codexThreadScrollUserIntentWindowMs;
    runtime.userCancelledRestoreSessionId = cancelledSessionId;
    window.__codexThreadScrollRestoreRevision = (window.__codexThreadScrollRestoreRevision || 0) + 1;
    window.__codexThreadScrollSyncRevision = (window.__codexThreadScrollSyncRevision || 0) + 1;
    clearThreadScrollRestoreTimers();
    clearThreadScrollSyncTimers();
    clearThreadScrollRestoreLock();
  }

  function userScrollIntentActive() {
    return finiteNonNegativeNumber(threadScrollRuntime().userScrollIntentUntil) > Date.now();
  }

  function threadScrollRestoreCancelledForSession(sessionId = threadScrollRuntime().activeSessionId) {
    const key = validThreadScrollSessionKey(sessionId);
    return !!key && threadScrollRuntime().userCancelledRestoreSessionId === key;
  }

  function activeThreadScrollRestoreLock(sessionId = threadScrollRuntime().activeSessionId) {
    const runtime = threadScrollRuntime();
    const key = validThreadScrollSessionKey(sessionId);
    const lock = runtime.restoreLock;
    if (!lock || !key || lock.sessionId !== key) return null;
    if (lock.expiresAt <= Date.now()) {
      clearThreadScrollRestoreLock();
      return null;
    }
    return lock;
  }

  function currentThreadScrollRestoreLock() {
    const sessionId = threadScrollRuntime().restoreLock?.sessionId;
    return sessionId ? activeThreadScrollRestoreLock(sessionId) : null;
  }

  function threadScrollIsReversed(scroller) {
    return getComputedStyle(scroller).flexDirection === "column-reverse";
  }

  function threadScrollRange(scroller) {
    const extent = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return threadScrollIsReversed(scroller)
      ? { min: -extent, max: 0, bottom: 0 }
      : { min: 0, max: extent, bottom: extent };
  }

  function startThreadScrollRestoreLock(sessionId, entry) {
    const key = validThreadScrollSessionKey(sessionId);
    if (!key || !entry) {
      clearThreadScrollRestoreLock();
      return null;
    }
    const runtime = threadScrollRuntime();
    runtime.restoreLock = {
      sessionId: key,
      targetTop: finiteScrollNumber(entry.top),
      expiresAt: Date.now() + codexThreadScrollRestoreWindowMs,
    };
    return runtime.restoreLock;
  }

  function prepareThreadScrollRestoreLock(sessionId) {
    const key = validThreadScrollSessionKey(sessionId);
    const entry = key ? readThreadScrollEntries()[key] : null;
    if (entry) startThreadScrollRestoreLock(key, entry);
  }

  function threadScrollTargetTop(scroller, targetTop) {
    const range = threadScrollRange(scroller);
    return Math.max(range.min, Math.min(range.max, finiteScrollNumber(targetTop)));
  }

  function threadScrollNearBottom(scroller, top) {
    const range = threadScrollRange(scroller);
    return Math.abs(range.bottom - finiteScrollNumber(top)) <= Math.max(24, scroller.clientHeight * 0.15);
  }

  function threadScrollGuardScroller(scroller) {
    if (!scroller) return null;
    const runtime = threadScrollRuntime();
    const rootScroller = document.scrollingElement || document.documentElement || document.body;
    const normalizedScroller = scroller === document.body || scroller === document.documentElement ? rootScroller : scroller;
    if (normalizedScroller === runtime.activeScroller) return normalizedScroller;
    const currentScroller = currentThreadScroller();
    if (normalizedScroller === currentScroller) return normalizedScroller;
    return null;
  }

  function shouldBlockThreadScrollAutobottom(scroller, top) {
    const runtime = threadScrollRuntime();
    const lock = currentThreadScrollRestoreLock();
    if (!lock || !alunixaXSettings().threadScrollRestore) return false;
    const guardScroller = threadScrollGuardScroller(scroller);
    if (runtime.applyingRestore || !guardScroller) return false;
    const targetTop = threadScrollTargetTop(guardScroller, lock.targetTop);
    return Math.abs(finiteScrollNumber(top) - targetTop) > 8 && threadScrollNearBottom(guardScroller, top);
  }

  function scrollToRequestedTop(args, scroller) {
    if (!args.length) return null;
    const first = args[0];
    if (typeof first === "object" && first !== null) return first.top == null ? null : finiteScrollNumber(first.top);
    if (args.length >= 2) return finiteScrollNumber(args[1]);
    return scroller?.scrollTop ?? null;
  }

  function scrollByRequestedTop(args, scroller) {
    if (!args.length || !scroller) return null;
    const first = args[0];
    let delta = null;
    if (typeof first === "object" && first !== null) {
      delta = first.top == null ? null : Number(first.top);
    } else if (args.length >= 2) {
      delta = Number(args[1]);
    }
    return Number.isFinite(delta) ? finiteScrollNumber(scroller.scrollTop + delta) : null;
  }

  function shouldBlockThreadScrollIntoView(element) {
    const runtime = threadScrollRuntime();
    const lock = currentThreadScrollRestoreLock();
    if (runtime.applyingRestore || !lock || !element) return false;
    const activeScroller = threadScrollGuardScroller(runtime.activeScroller) || threadScrollGuardScroller(currentThreadScroller());
    if (!activeScroller || element === activeScroller || !activeScroller.contains?.(element)) return false;
    if (threadScrollIsReversed(activeScroller) && shouldBlockThreadScrollAutobottom(activeScroller, 0)) return true;
    const elementRect = element.getBoundingClientRect?.();
    if (!elementRect) return false;
    const elementBottomTop = activeScroller.scrollTop + elementRect.bottom - scrollerViewportTop(activeScroller) - activeScroller.clientHeight;
    return shouldBlockThreadScrollAutobottom(activeScroller, elementBottomTop);
  }

  function installThreadScrollProgrammaticScrollGuard() {
    if (window.__codexThreadScrollProgrammaticGuardInstalled === codexThreadScrollProgrammaticGuardVersion) return;
    window.__codexThreadScrollProgrammaticGuardInstalled = codexThreadScrollProgrammaticGuardVersion;
    window.__codexThreadScrollOriginals = window.__codexThreadScrollOriginals || {};
    const originals = window.__codexThreadScrollOriginals;
    originals.elementScrollTo = originals.elementScrollTo || Element.prototype.scrollTo;
    if (typeof originals.elementScrollTo === "function") {
      Element.prototype.scrollTo = function codexThreadScrollGuardedScrollTo(...args) {
        const top = scrollToRequestedTop(args, this);
        if (top != null && window.__codexThreadScrollHandlers?.shouldBlockAutobottom?.(this, top)) return;
        return originals.elementScrollTo.apply(this, args);
      };
    }
    originals.elementScroll = originals.elementScroll || Element.prototype.scroll;
    if (typeof originals.elementScroll === "function") {
      Element.prototype.scroll = function codexThreadScrollGuardedScroll(...args) {
        const top = scrollToRequestedTop(args, this);
        if (top != null && window.__codexThreadScrollHandlers?.shouldBlockAutobottom?.(this, top)) return;
        return originals.elementScroll.apply(this, args);
      };
    }
    originals.elementScrollBy = originals.elementScrollBy || Element.prototype.scrollBy;
    if (typeof originals.elementScrollBy === "function") {
      Element.prototype.scrollBy = function codexThreadScrollGuardedScrollBy(...args) {
        const top = scrollByRequestedTop(args, this);
        if (top != null && window.__codexThreadScrollHandlers?.shouldBlockAutobottom?.(this, top)) return;
        return originals.elementScrollBy.apply(this, args);
      };
    }
    originals.scrollIntoView = originals.scrollIntoView || Element.prototype.scrollIntoView;
    if (typeof originals.scrollIntoView === "function") {
      Element.prototype.scrollIntoView = function codexThreadScrollGuardedScrollIntoView(...args) {
        if (window.__codexThreadScrollHandlers?.shouldBlockIntoView?.(this)) return;
        return originals.scrollIntoView.apply(this, args);
      };
    }
    originals.windowScrollTo = originals.windowScrollTo || window.scrollTo;
    if (typeof originals.windowScrollTo === "function") {
      window.scrollTo = function codexThreadScrollGuardedWindowScrollTo(...args) {
        const scroller = document.scrollingElement || document.documentElement || document.body;
        const top = scrollToRequestedTop(args, scroller);
        if (top != null && window.__codexThreadScrollHandlers?.shouldBlockAutobottom?.(scroller, top)) return;
        return originals.windowScrollTo.apply(this, args);
      };
    }
    originals.windowScroll = originals.windowScroll || window.scroll;
    if (typeof originals.windowScroll === "function") {
      window.scroll = function codexThreadScrollGuardedWindowScroll(...args) {
        const scroller = document.scrollingElement || document.documentElement || document.body;
        const top = scrollToRequestedTop(args, scroller);
        if (top != null && window.__codexThreadScrollHandlers?.shouldBlockAutobottom?.(scroller, top)) return;
        return originals.windowScroll.apply(this, args);
      };
    }
    originals.windowScrollBy = originals.windowScrollBy || window.scrollBy;
    if (typeof originals.windowScrollBy === "function") {
      window.scrollBy = function codexThreadScrollGuardedWindowScrollBy(...args) {
        const scroller = document.scrollingElement || document.documentElement || document.body;
        const top = scrollByRequestedTop(args, scroller);
        if (top != null && window.__codexThreadScrollHandlers?.shouldBlockAutobottom?.(scroller, top)) return;
        return originals.windowScrollBy.apply(this, args);
      };
    }
  }

  function bindThreadScrollListener(scroller) {
    const runtime = threadScrollRuntime();
    const currentUsesWindow = !runtime.activeScroller || runtime.activeScroller === document.scrollingElement || runtime.activeScroller === document.documentElement || runtime.activeScroller === document.body;
    const nextUsesWindow = !scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
    let listenerReplaced = false;
    if (runtime.scrollListener && runtime.scrollListenerVersion !== codexThreadScrollListenerVersion) {
      const currentTarget = currentUsesWindow ? window : runtime.activeScroller;
      currentTarget?.removeEventListener?.("scroll", runtime.scrollListener, true);
      runtime.scrollListener = null;
      runtime.scrollListenerVersion = "";
      listenerReplaced = true;
    }
    runtime.scrollListener = runtime.scrollListener || (() => scheduleThreadScrollSave());
    runtime.scrollListenerVersion = codexThreadScrollListenerVersion;
    if (!listenerReplaced && runtime.activeScroller === scroller && runtime.scrollListenerUsesWindow === nextUsesWindow) return;
    if (runtime.activeScroller) {
      const target = currentUsesWindow ? window : runtime.activeScroller;
      target.removeEventListener("scroll", runtime.scrollListener, true);
    }
    runtime.activeScroller = scroller;
    runtime.scrollListenerUsesWindow = nextUsesWindow;
    if (!scroller || !alunixaXSettings().threadScrollRestore) return;
    const target = nextUsesWindow ? window : scroller;
    target.addEventListener("scroll", runtime.scrollListener, true);
  }

  function saveThreadScrollPositionNow(sessionId = threadScrollRuntime().activeSessionId, scroller = threadScrollRuntime().activeScroller) {
    if (!alunixaXSettings().threadScrollRestore) return;
    const runtime = threadScrollRuntime();
    const key = validThreadScrollSessionKey(sessionId);
    if (!key || !scroller) return;
    if (activeThreadScrollRestoreLock(key)) return;
    const snapshot = {
      top: finiteScrollNumber(scroller.scrollTop),
      scrollHeight: finiteNonNegativeNumber(scroller.scrollHeight),
      clientHeight: finiteNonNegativeNumber(scroller.clientHeight),
      at: Date.now(),
    };
    if (Math.abs(runtime.lastSavedTop - snapshot.top) < 2 && runtime.lastSavedHeight === snapshot.scrollHeight && runtime.lastSavedClientHeight === snapshot.clientHeight) return;
    const entries = readThreadScrollEntries();
    entries[key] = snapshot;
    writeThreadScrollEntries(entries);
    runtime.lastSavedTop = snapshot.top;
    runtime.lastSavedHeight = snapshot.scrollHeight;
    runtime.lastSavedClientHeight = snapshot.clientHeight;
  }

  function scheduleThreadScrollSave() {
    if (!alunixaXSettings().threadScrollRestore || window.__codexThreadScrollSaveTimer) return;
    window.__codexThreadScrollSaveTimer = setTimeout(() => {
      window.__codexThreadScrollSaveTimer = null;
      saveThreadScrollPositionNow();
    }, codexThreadScrollSaveThrottleMs);
  }

  function restoreThreadScrollPosition(sessionId) {
    const runtime = threadScrollRuntime();
    const key = validThreadScrollSessionKey(sessionId);
    if (!alunixaXSettings().threadScrollRestore || !key || runtime.activeSessionId !== key || userScrollIntentActive() || threadScrollRestoreCancelledForSession(key)) return;
    const lock = activeThreadScrollRestoreLock(key);
    const entry = lock || readThreadScrollEntries()[key];
    if (!entry) return;
    const scroller = currentThreadScroller();
    if (!scroller) return;
    bindThreadScrollListener(scroller);
    const targetTop = threadScrollTargetTop(scroller, lock ? lock.targetTop : entry.top);
    if (Math.abs(scroller.scrollTop - targetTop) <= 1) return;
    runtime.applyingRestore = true;
    try {
      if (typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ top: targetTop, behavior: "auto" });
      } else {
        scroller.scrollTop = targetTop;
      }
    } finally {
      runtime.applyingRestore = false;
    }
    runtime.lastSavedTop = targetTop;
    runtime.lastSavedHeight = finiteNonNegativeNumber(scroller.scrollHeight);
    runtime.lastSavedClientHeight = finiteNonNegativeNumber(scroller.clientHeight);
  }

  function scheduleThreadScrollRestore(sessionId) {
    clearThreadScrollRestoreTimers();
    const key = validThreadScrollSessionKey(sessionId);
    if (!alunixaXSettings().threadScrollRestore || !key || userScrollIntentActive() || threadScrollRestoreCancelledForSession(key)) return;
    const entry = readThreadScrollEntries()[key];
    if (!entry) {
      clearThreadScrollRestoreLock();
      return;
    }
    startThreadScrollRestoreLock(key, entry);
    const restoreRevision = (window.__codexThreadScrollRestoreRevision || 0) + 1;
    window.__codexThreadScrollRestoreRevision = restoreRevision;
    window.__codexThreadScrollRestoreTimers = codexThreadScrollRestoreDelaysMs.map((delay) => setTimeout(() => {
      if (window.__codexThreadScrollRestoreRevision !== restoreRevision) return;
      restoreThreadScrollPosition(key);
    }, delay));
  }

  function syncThreadScrollState(forceRestore = false) {
    const runtime = threadScrollRuntime();
    const currentRef = currentSessionRef();
    const nextSessionId = validThreadScrollSessionKey(currentRef.session_id);
    if (!nextSessionId) return;
    if (!alunixaXSettings().threadScrollRestore) {
      bindThreadScrollListener(null);
      clearThreadScrollRestoreTimers();
      clearThreadScrollRestoreLock();
      runtime.activeSessionId = nextSessionId;
      return;
    }
    if (runtime.activeSessionId !== nextSessionId) prepareThreadScrollRestoreLock(nextSessionId);
    const nextScroller = currentThreadScroller();
    bindThreadScrollListener(nextScroller);
    if (runtime.activeSessionId !== nextSessionId) {
      runtime.lastSavedTop = -1;
      runtime.lastSavedHeight = -1;
      runtime.lastSavedClientHeight = -1;
      clearThreadScrollRestoreLock();
      runtime.activeSessionId = nextSessionId;
      runtime.pendingNavigation = null;
      runtime.userScrollIntentUntil = 0;
      if (runtime.userCancelledRestoreSessionId !== nextSessionId) runtime.userCancelledRestoreSessionId = "";
      scheduleThreadScrollRestore(nextSessionId);
      return;
    }
    runtime.activeSessionId = nextSessionId;
    if (forceRestore && !userScrollIntentActive() && !threadScrollRestoreCancelledForSession(nextSessionId)) scheduleThreadScrollRestore(nextSessionId);
  }

  function scheduleThreadScrollSyncAttempts(forceRestore = true) {
    const currentKey = validThreadScrollSessionKey(currentSessionRef().session_id) || validThreadScrollSessionKey(threadScrollRuntime().activeSessionId);
    if (userScrollIntentActive() || threadScrollRestoreCancelledForSession(currentKey)) return;
    clearThreadScrollSyncTimers();
    const syncRevision = (window.__codexThreadScrollSyncRevision || 0) + 1;
    window.__codexThreadScrollSyncRevision = syncRevision;
    window.__codexThreadScrollSyncTimers = codexThreadScrollRestoreDelaysMs.map((delay) => setTimeout(() => {
      if (window.__codexThreadScrollSyncRevision !== syncRevision) return;
      scheduleThreadScrollSync(forceRestore);
    }, delay));
  }

  function captureThreadScrollNavigation(targetSessionId) {
    if (!alunixaXSettings().threadScrollRestore) return;
    const runtime = threadScrollRuntime();
    const targetKey = validThreadScrollSessionKey(targetSessionId);
    const sessionChanged = !!targetKey && targetKey !== runtime.activeSessionId;
    if (sessionChanged) {
      runtime.userScrollIntentUntil = 0;
      runtime.userCancelledRestoreSessionId = "";
    }
    const pending = runtime.pendingNavigation;
    const duplicatePendingTarget = !!targetKey && pending?.targetSessionId === targetKey && Date.now() - finiteNonNegativeNumber(pending.at) < 5000;
    if (!duplicatePendingTarget) saveThreadScrollPositionNow();
    if (targetKey) {
      runtime.pendingNavigation = { fromSessionId: runtime.activeSessionId, targetSessionId: targetKey, at: Date.now() };
      prepareThreadScrollRestoreLock(targetKey);
    }
    scheduleThreadScrollSyncAttempts(true);
  }

  function editableThreadScrollTarget(element) {
    return !!element?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']");
  }

  function eventTargetsActiveThreadScroller(event) {
    const runtime = threadScrollRuntime();
    const scroller = threadScrollGuardScroller(runtime.activeScroller) || threadScrollGuardScroller(currentThreadScroller());
    if (!scroller) return false;
    const target = event?.target;
    if (!target || target === document || target === window) return true;
    return target === scroller || scroller.contains?.(target) || scroller.contains?.(document.activeElement);
  }

  function markThreadScrollUserIntent(event) {
    if (!alunixaXSettings().threadScrollRestore || !eventTargetsActiveThreadScroller(event)) return;
    cancelThreadScrollRestoreForUserIntent();
  }

  function markThreadScrollKeyboardIntent(event) {
    if (editableThreadScrollTarget(event.target)) return;
    if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(event.key)) return;
    markThreadScrollUserIntent(event);
  }

  function markThreadScrollPointerIntent(event) {
    const scroller = threadScrollGuardScroller(threadScrollRuntime().activeScroller) || threadScrollGuardScroller(currentThreadScroller());
    if (event.target === scroller) markThreadScrollUserIntent(event);
  }

  function updateThreadScrollHandlers() {
    window.__codexThreadScrollHandlers = {
      shouldBlockAutobottom: shouldBlockThreadScrollAutobottom,
      shouldBlockIntoView: shouldBlockThreadScrollIntoView,
      markUserIntent: markThreadScrollUserIntent,
      markKeyboardIntent: markThreadScrollKeyboardIntent,
      markPointerIntent: markThreadScrollPointerIntent,
      captureNavigation: captureThreadScrollNavigation,
      saveNow: saveThreadScrollPositionNow,
      prepareRestoreLock: prepareThreadScrollRestoreLock,
      scheduleSyncAttempts: scheduleThreadScrollSyncAttempts,
    };
  }

  function installThreadScrollUserIntentCapture() {
    if (window.__codexThreadScrollUserIntentInstalled === codexThreadScrollUserIntentVersion) return;
    document.removeEventListener("wheel", window.__codexThreadScrollWheelIntentHandler, true);
    document.removeEventListener("touchmove", window.__codexThreadScrollTouchIntentHandler, true);
    document.removeEventListener("keydown", window.__codexThreadScrollKeyIntentHandler, true);
    document.removeEventListener("pointerdown", window.__codexThreadScrollPointerIntentHandler, true);
    window.__codexThreadScrollWheelIntentHandler = (event) => window.__codexThreadScrollHandlers?.markUserIntent?.(event);
    window.__codexThreadScrollTouchIntentHandler = (event) => window.__codexThreadScrollHandlers?.markUserIntent?.(event);
    window.__codexThreadScrollKeyIntentHandler = (event) => window.__codexThreadScrollHandlers?.markKeyboardIntent?.(event);
    window.__codexThreadScrollPointerIntentHandler = (event) => window.__codexThreadScrollHandlers?.markPointerIntent?.(event);
    document.addEventListener("wheel", window.__codexThreadScrollWheelIntentHandler, { capture: true, passive: true });
    document.addEventListener("touchmove", window.__codexThreadScrollTouchIntentHandler, { capture: true, passive: true });
    document.addEventListener("keydown", window.__codexThreadScrollKeyIntentHandler, true);
    document.addEventListener("pointerdown", window.__codexThreadScrollPointerIntentHandler, true);
    window.__codexThreadScrollUserIntentInstalled = codexThreadScrollUserIntentVersion;
  }

  function installThreadScrollNavigationCapture() {
    document.removeEventListener("pointerdown", window.__codexThreadScrollNavigationHandler, true);
    document.removeEventListener("click", window.__codexThreadScrollClickNavigationHandler, true);
    document.removeEventListener("keydown", window.__codexThreadScrollKeyboardHandler, true);
    const navigationHandler = (event) => {
      if (!alunixaXSettings().threadScrollRestore) return;
      const row = event.target?.closest?.(selectors.sidebarThread);
      if (!row) return;
      window.__codexThreadScrollHandlers?.captureNavigation?.(sessionRefFromRow(row).session_id);
    };
    const clickHandler = (event) => {
      if (!alunixaXSettings().threadScrollRestore) return;
      const row = event.target?.closest?.(selectors.sidebarThread);
      if (!row) return;
      window.__codexThreadScrollHandlers?.captureNavigation?.(sessionRefFromRow(row).session_id);
    };
    const keyboardHandler = (event) => {
      if (!alunixaXSettings().threadScrollRestore) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target?.closest?.(selectors.sidebarThread);
      if (!row) return;
      window.__codexThreadScrollHandlers?.captureNavigation?.(sessionRefFromRow(row).session_id);
    };
    window.__codexThreadScrollNavigationHandler = navigationHandler;
    window.__codexThreadScrollClickNavigationHandler = clickHandler;
    window.__codexThreadScrollKeyboardHandler = keyboardHandler;
    document.addEventListener("pointerdown", navigationHandler, true);
    document.addEventListener("click", clickHandler, true);
    document.addEventListener("keydown", keyboardHandler, true);
  }

  function scheduleThreadScrollSync(forceRestore = false) {
    if (window.__codexThreadScrollSyncPending) return;
    window.__codexThreadScrollSyncPending = true;
    setTimeout(() => {
      window.__codexThreadScrollSyncPending = false;
      syncThreadScrollState(forceRestore);
    }, 0);
  }

  function installThreadScrollRouteHooks() {
    if (window.__codexThreadScrollRouteHooksInstalled === codexThreadScrollRouteHooksVersion) return;
    window.__codexThreadScrollRouteHooksInstalled = codexThreadScrollRouteHooksVersion;
    window.__codexThreadScrollOriginals = window.__codexThreadScrollOriginals || {};
    const originals = window.__codexThreadScrollOriginals;
    ["pushState", "replaceState"].forEach((method) => {
      const currentMethod = history[method];
      const original = originals[`history_${method}`] || currentMethod;
      originals[`history_${method}`] = original;
      if (typeof original !== "function") return;
      history[method] = function codexThreadScrollPatchedHistory(...args) {
        window.__codexThreadScrollHandlers?.saveNow?.();
        const result = original.apply(this, args);
        window.__codexThreadScrollHandlers?.captureNavigation?.(locationThreadId());
        return result;
      };
    });
    window.removeEventListener("popstate", window.__codexThreadScrollPopStateHandler, true);
    window.removeEventListener("hashchange", window.__codexThreadScrollHashChangeHandler, true);
    document.removeEventListener("visibilitychange", window.__codexThreadScrollVisibilityHandler, true);
    window.__codexThreadScrollPopStateHandler = () => {
      window.__codexThreadScrollHandlers?.saveNow?.();
      window.__codexThreadScrollHandlers?.captureNavigation?.(locationThreadId());
    };
    window.__codexThreadScrollHashChangeHandler = () => {
      window.__codexThreadScrollHandlers?.saveNow?.();
      window.__codexThreadScrollHandlers?.captureNavigation?.(locationThreadId());
    };
    window.__codexThreadScrollVisibilityHandler = () => {
      if (document.visibilityState === "hidden") window.__codexThreadScrollHandlers?.saveNow?.();
    };
    window.addEventListener("popstate", window.__codexThreadScrollPopStateHandler, true);
    window.addEventListener("hashchange", window.__codexThreadScrollHashChangeHandler, true);
    document.addEventListener("visibilitychange", window.__codexThreadScrollVisibilityHandler, true);
  }

  async function postJson(path, payload) {
    if (path === "/delete") {
      const hostId = deletePayloadHost(payload);
      if (!hostId) return { status: "failed", message: "无法确定会话主机归属，未删除", session_id: payload?.session_id || "" };
      if (hostId !== "local") return deleteRemoteSession({ ...payload, host_id: hostId });
    }
    async function fetchBackendStatusFromHelper(path, payload) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeoutId = setTimeout(() => controller?.abort(), 2000);
      try {
        const response = await fetch(`${helperBase}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload || {}),
          ...(controller ? { signal: controller.signal } : {}),
        });
        return await response.json();
      } catch (error) {
        return {
          status: "failed",
          message: error?.name === "AbortError" ? "后端检查超时" : "未连接",
          timeout: error?.name === "AbortError",
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (!window.__codexSessionDeleteBridge) {
      recordCodexPlusBridgeFailure();
      if (path === "/backend/status") {
        return await fetchBackendStatusFromHelper(path, payload);
      }
      sendCodexPlusDiagnostic("bridge_missing_for_route", { path });
      return { status: "failed", message: "桥接不可用，请重启启动器" };
    }
    function bridgeWithBackendTimeout(path, payload) {
      let request;
      try {
        request = window.__codexSessionDeleteBridge(path, payload);
      } catch (error) {
        recordCodexPlusBridgeFailure();
        return Promise.resolve({ status: "failed", message: error?.message || "未连接" });
      }
      return withBackendTimeout(request);
    }
    try {
      if (path === "/backend/status") {
        const result = await bridgeWithBackendTimeout(path, payload);
        if (result?.status === "ok") {
          recordCodexPlusBridgeSuccess();
          return result;
        }
        recordCodexPlusBridgeFailure();
        if (result?.timeout) {
          // 超时也要记 lastAttemptAt：15 秒内的尝试视为桥还活着，
          // 避免页面忙碌时被看门狗误判为桥已死而重复注入整份脚本（issue #2169 / #2274）。
          recordCodexPlusBridgeAttempt();
          sendCodexPlusDiagnostic("backend_bridge_timeout", { path });
        }
        const fallback = await fetchBackendStatusFromHelper(path, payload);
        if (fallback?.status === "ok") {
          sendCodexPlusDiagnostic("backend_status_bridge_failed_http_fallback_ok", {
            path,
            httpStatus: 200,
            responseStatus: fallback.status || "",
          });
          return fallback;
        }
        sendCodexPlusDiagnostic("backend_status_bridge_and_http_failed", {
          path,
          errorName: "",
          errorMessage: "",
        });
        return fallback;
      }
      const bridgeResult = await window.__codexSessionDeleteBridge(path, payload);
      recordCodexPlusBridgeSuccess();
      return bridgeResult;
    } catch (error) {
      recordCodexPlusBridgeFailure();
      sendCodexPlusDiagnostic("bridge_call_failed", {
        path,
        errorName: error?.name || "",
        errorMessage: error?.message || String(error),
      });
      if (path === "/backend/status") {
        const fallback = await fetchBackendStatusFromHelper(path, payload);
        if (fallback?.status === "ok") {
          sendCodexPlusDiagnostic("backend_status_bridge_failed_http_fallback_ok", {
            path,
            httpStatus: 200,
            responseStatus: fallback.status || "",
          });
          return fallback;
        }
        sendCodexPlusDiagnostic("backend_status_bridge_and_http_failed", {
          path,
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
        return fallback;
      }
      throw error;
    }
  }

  function downloadMarkdownFallback(filename, markdown) {
    if (!filename || typeof markdown !== "string") {
      throw new Error("导出结果不完整");
    }
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveMarkdown(filename, markdown) {
    if (!filename || typeof markdown !== "string") {
      throw new Error("导出结果不完整");
    }
    if (typeof window.showSaveFilePicker !== "function") {
      downloadMarkdownFallback(filename, markdown);
      return { status: "saved" };
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Markdown",
          accept: { "text/markdown": [".md", ".markdown"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(markdown);
      await writable.close();
      return { status: "saved" };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { status: "cancelled", message: "导出已取消" };
      }
      throw error;
    }
  }

  let codexStateApiPromise = null;
  let chatsSortInFlight = false;
  let chatsSortSignature = "";
  let chatsSortLastFetchAt = 0;

  function codexStateApiFromModule(module, assetPrefix = "") {
    if (assetPrefix.startsWith("vscode-api-")) {
      return typeof module?.n === "function" ? module.n : null;
    }
    if (assetPrefix.startsWith("app-initial-")) {
      return typeof module?.qut === "function" ? module.qut : null;
    }
    if (assetPrefix.startsWith("app-shared-")) {
      return codexStateCallByCapability(module);
    }
    return null;
  }

  // issue #2399：26.930 起 state API 随 AppServerRequestClient 一起搬进 app-shared-*，
  // 而这批产物每次构建都会重排压缩导出名（旧版是 qut），按字面量取必然落空。
  // 改成按能力找：函数源码里带 get-global-state / set-global-state 的就是它。
  function codexStateCallByCapability(module) {
    const values = module && typeof module === "object" ? Object.values(module) : [];
    return values.find((candidate) => {
      if (typeof candidate !== "function") return false;
      let source = "";
      try {
        source = String(candidate);
      } catch {
        return false;
      }
      return source.includes("get-global-state")
        && source.includes("set-global-state")
        && source.includes("params");
    }) || null;
  }

  async function codexStateApi() {
    codexStateApiPromise = codexStateApiPromise || (async () => {
      const errors = [];
      // 前三项是历史前缀（列表字面量本身是契约的一部分，不要改写）；
      // app-shared- 是 26.930+ 的新位置，靠内容识别，不依赖压缩导出名。
      for (const assetPrefix of [...["vscode-api-", "app-initial-"], "app-shared-"]) {
        try {
          const api = await loadCodexAppModule(assetPrefix);
          const call = codexStateApiFromModule(api, assetPrefix);
          if (typeof call === "function") return call;
          errors.push(`${assetPrefix}: state export unavailable`);
        } catch (error) {
          errors.push(`${assetPrefix}: ${error?.message || String(error)}`);
        }
      }
      throw new Error(`Codex 状态 API 不可用 (${errors.join("; ")})`);
    })();
    return await codexStateApiPromise;
  }

  async function codexStateCall(method, params) {
    const call = await codexStateApi();
    return await call(method, params);
  }

  async function getCodexGlobalState(key) {
    const result = await codexStateCall("get-global-state", { params: { key } });
    return result && Object.prototype.hasOwnProperty.call(result, "value") ? result.value : result;
  }
  /**
   * 独立插件市场只加载索引；安装由 launcher 下载所选插件并写入本地安装目录。
   * 不调用 Codex 的 plugin/install，避免在浏览目录时触发服务连接或 OAuth。
   * 状态存数据，页面每次打开重建；请求结果通过来源/序号校验后才刷新当前页面。
   */
  const alunixaXPluginMarketState = window.__alunixaXPluginMarketState || {
    source: "public", query: "", installedOnly: false, page: 1,
    catalogs: {}, jobs: {},
  };
  window.__alunixaXPluginMarketState = alunixaXPluginMarketState;
  Object.values(alunixaXPluginMarketState.jobs).forEach((job) => {
    clearTimeout(job.timer);
    job.timer = null;
  });
  const alunixaXPluginMarketPageSize = 50;

  function alunixaXPluginMarketCatalog(source = alunixaXPluginMarketState.source) {
    if (!alunixaXPluginMarketState.catalogs[source]) {
      alunixaXPluginMarketState.catalogs[source] = {
        plugins: [], loaded: false, loading: false, message: "", revision: 0, cached: false,
      };
    }
    return alunixaXPluginMarketState.catalogs[source];
  }

  function alunixaXPluginMarketPanel() {
    return document.querySelector('[data-codex-plugin-market-panel="true"]');
  }

  function alunixaXPluginMarketFilteredPlugins() {
    const state = alunixaXPluginMarketState;
    const query = state.query.trim().toLocaleLowerCase();
    return alunixaXPluginMarketCatalog().plugins.filter((plugin) => {
      if (state.installedOnly && !plugin.installed) return false;
      if (!query) return true;
      const text = [plugin.displayName, plugin.name, plugin.description, ...(Array.isArray(plugin.tags) ? plugin.tags : [])].join(" ").toLocaleLowerCase();
      return text.includes(query);
    });
  }

  function alunixaXPluginMarketBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function alunixaXPluginMarketStage(stage) {
    return ({ queued: "等待下载", downloading: "下载中", extracting: "解压中", installing: "安装中", validating: "校验中", complete: "安装完成" })[stage] || "正在安装";
  }

  function alunixaXPluginMarketCard(plugin, source) {
    const job = alunixaXPluginMarketState.jobs[`${source}:${plugin.id}`];
    const busy = job?.busy === true;
    const installed = plugin.installed === true;
    const label = busy ? `${alunixaXPluginMarketStage(job.stage)}…` : plugin.updateAvailable ? "更新" : installed ? "已安装" : "下载安装";
    const meta = [plugin.version ? `v${plugin.version}` : "", plugin.author || "", alunixaXPluginMarketBytes(plugin.bytes), Number(plugin.skills) > 0 ? `${plugin.skills} 个技能` : ""].filter(Boolean).join(" · ");
    const tags = (Array.isArray(plugin.tags) ? plugin.tags : []).slice(0, 4);
    return `<article class="alunixa-x-plugin-card" role="listitem">
      <div class="alunixa-x-plugin-card-info">
        <div class="alunixa-x-plugin-name">${escapeHtml(plugin.displayName || plugin.name || plugin.id)}</div>
        <div class="alunixa-x-plugin-id">${escapeHtml(plugin.name || plugin.id)}</div>
        <div class="alunixa-x-plugin-description">${escapeHtml(plugin.description || "暂无介绍")}</div>
        <div class="alunixa-x-plugin-meta">${escapeHtml(meta)}</div>
        <div class="alunixa-x-plugin-tags">${tags.map((tag) => `<span>${escapeHtml(String(tag))}</span>`).join("")}${plugin.requiresAuth ? "<span>需要服务授权</span>" : ""}${plugin.license ? `<span>${escapeHtml(plugin.license)}</span>` : ""}</div>
        ${job?.message ? `<div class="alunixa-x-plugin-job-message" data-status="${job.failed ? "failed" : "ok"}">${escapeHtml(job.message)}</div>` : ""}
      </div>
      <button type="button" class="alunixa-x-button alunixa-x-plugin-install" data-codex-plugin-install="${escapeHtml(plugin.id)}" aria-label="${escapeHtml(`${label} ${plugin.displayName || plugin.name || plugin.id}`)}" ${busy || (installed && !plugin.updateAvailable) ? "disabled" : ""}>${label}</button>
    </article>`;
  }

  function renderCodexPlusPluginMarket() {
    const panel = alunixaXPluginMarketPanel();
    if (!panel) return;
    const state = alunixaXPluginMarketState;
    const catalog = alunixaXPluginMarketCatalog();
    const filtered = alunixaXPluginMarketFilteredPlugins();
    const pages = Math.max(1, Math.ceil(filtered.length / alunixaXPluginMarketPageSize));
    state.page = Math.max(1, Math.min(pages, state.page));
    panel.querySelectorAll("[data-codex-plugin-source]").forEach((button) => {
      const active = button.dataset.codexPluginSource === state.source;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
    });
    const refresh = panel.querySelector("[data-codex-plugin-refresh]");
    if (refresh) refresh.disabled = catalog.loading;
    const sourceNote = panel.querySelector("[data-codex-plugin-source-note]");
    if (sourceNote) {
      sourceNote.hidden = state.source !== "full";
      sourceNote.textContent = "完整市场需要 GitHub 私有仓库访问权限。请使用有权限的账号执行 gh auth login 后刷新目录。";
    }
    const status = panel.querySelector("[data-codex-plugin-market-status]");
    if (status) status.textContent = catalog.loading ? "正在加载插件目录…" : catalog.message || `${catalog.plugins.length.toLocaleString()} 个插件${catalog.cached ? " · 使用缓存目录" : ""}`;
    const results = panel.querySelector("[data-codex-plugin-results]");
    if (results) results.innerHTML = filtered.length
      ? filtered.slice((state.page - 1) * alunixaXPluginMarketPageSize, state.page * alunixaXPluginMarketPageSize).map((plugin) => alunixaXPluginMarketCard(plugin, state.source)).join("")
      : `<div class="alunixa-x-plugin-empty">${catalog.loading ? "正在加载…" : !catalog.loaded ? "目录尚未加载，请刷新重试。" : catalog.plugins.length ? "没有找到符合条件的插件。" : "此来源暂无可显示的插件。"}</div>`;
    const count = panel.querySelector("[data-codex-plugin-result-count]");
    if (count) count.textContent = `${filtered.length.toLocaleString()} 个结果 · 第 ${state.page} / ${pages} 页`;
    const previous = panel.querySelector('[data-codex-plugin-page="previous"]');
    const next = panel.querySelector('[data-codex-plugin-page="next"]');
    if (previous) previous.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= pages;
  }

  async function loadCodexPlusPluginMarket(source, refresh = false) {
    const catalog = alunixaXPluginMarketCatalog(source);
    if (catalog.loading || (catalog.loaded && !refresh)) {
      renderCodexPlusPluginMarket();
      return;
    }
    const revision = ++catalog.revision;
    catalog.loading = true;
    catalog.message = "";
    renderCodexPlusPluginMarket();
    let result;
    try {
      result = await postJson("/plugin-market/list", { source, refresh });
    } catch (error) {
      result = { status: "failed", message: error?.message || "插件目录加载失败" };
    }
    if (catalog.revision !== revision) return;
    catalog.loading = false;
    if (Array.isArray(result?.plugins)) {
      catalog.plugins = result.plugins.filter((plugin) => plugin && typeof plugin.id === "string");
      catalog.loaded = true;
      catalog.cached = result.cached === true;
      catalog.message = result.message || "";
    } else {
      catalog.message = result?.message || "插件目录加载失败，请刷新重试。";
    }
    // 切换来源后，旧请求只更新自己的数据；当前页面始终按当前来源重绘。
    if (alunixaXPluginMarketState.source === source) renderCodexPlusPluginMarket();
  }

  function updateCodexPlusPluginMarketInstalled(source, plugin) {
    if (!plugin || typeof plugin.id !== "string") return;
    const catalog = alunixaXPluginMarketCatalog(source);
    // 安装以 source + id 隔离，另一来源即使同 id 也不能被标为已安装。
    // 丢弃此前发出的本来源清单请求，避免旧 installed 状态覆盖新结果。
    catalog.revision += 1;
    catalog.loading = false;
    catalog.plugins = catalog.plugins.map((item) => {
      if (item.id !== plugin.id) return item;
      const installedVersion = plugin.installedVersion || plugin.version || item.version;
      return { ...item, installed: true, installedVersion, updateAvailable: Boolean(item.version && installedVersion && item.version !== installedVersion) };
    });
  }

  function scheduleCodexPlusPluginMarketInstallPoll(source, id, delay = 1200) {
    const job = alunixaXPluginMarketState.jobs[`${source}:${id}`];
    if (!job?.busy || job.polling || job.timer || !alunixaXPluginMarketPanel()) return;
    job.timer = setTimeout(() => {
      job.timer = null;
      void pollCodexPlusPluginMarketInstall(source, id);
    }, delay);
  }

  async function pollCodexPlusPluginMarketInstall(source, id) {
    const job = alunixaXPluginMarketState.jobs[`${source}:${id}`];
    if (!job?.busy || job.polling) return;
    job.polling = true;
    let result;
    try {
      result = await postJson("/plugin-market/install-status", { source, id });
    } catch (error) {
      result = { timeout: true, message: error?.message || "正在等待安装状态" };
    }
    job.polling = false;
    if (result?.busy === true) {
      job.stage = result.stage || job.stage;
      job.message = result.message || "";
    } else if (result?.busy === false) {
      const completed = result.status === "ok" && result.stage === "complete"
        && (result.plugin || (typeof result.installedVersion === "string" && result.installedVersion.length > 0));
      job.busy = false;
      job.failed = !completed;
      job.message = result.message || (job.failed ? "安装未完成，请重试。" : "安装完成，重启 Codex 后加载插件。");
      if (completed) updateCodexPlusPluginMarketInstalled(source, result.plugin || { id, installedVersion: result.installedVersion });
    } else {
      // 桥接超时不能重新发起安装；持续查询原任务，防止并发写同一插件。
      job.message = result?.message || "正在等待安装状态，可稍后重新打开此页查看。";
    }
    renderCodexPlusPluginMarket();
    scheduleCodexPlusPluginMarketInstallPoll(source, id, result?.timeout ? 4000 : 1200);
  }

  async function installCodexPlusPluginMarketPlugin(source, id) {
    const key = `${source}:${id}`;
    if (alunixaXPluginMarketState.jobs[key]?.busy) return;
    const plugin = alunixaXPluginMarketCatalog(source).plugins.find((item) => item.id === id);
    if (!plugin || (plugin.installed && !plugin.updateAvailable)) return;
    const job = { busy: true, stage: "downloading", message: "正在下载所选插件…", failed: false, timer: null, polling: false };
    alunixaXPluginMarketState.jobs[key] = job;
    renderCodexPlusPluginMarket();
    let result;
    try {
      result = await postJson("/plugin-market/install", { source, id });
    } catch (error) {
      result = { timeout: true, message: error?.message || "正在等待安装结果" };
    }
    if (result?.status === "ok" && result?.plugin && result?.busy !== true) {
      job.busy = false;
      job.message = result.message || "安装完成，重启 Codex 后加载插件。";
      updateCodexPlusPluginMarketInstalled(source, result.plugin);
    } else if (result?.status === "failed" && !result?.timeout && result?.busy !== true && !/超时|timeout/i.test(result.message || "")) {
      job.busy = false;
      job.failed = true;
      job.message = result.message || "安装失败";
    } else {
      job.stage = result?.stage || job.stage;
      job.message = result?.message || "正在等待下载完成…";
      scheduleCodexPlusPluginMarketInstallPoll(source, id);
    }
    renderCodexPlusPluginMarket();
  }

  function openCodexPlusPluginMarket() {
    closeCodexPlusPage();
    document.querySelectorAll('.alunixa-x-modal-overlay, [data-alunixa-x-dialog="true"]').forEach((node) => node.remove());
    const overlay = document.createElement("div");
    overlay.className = `${alunixaXPageClass} alunixa-x-plugin-market-page`;
    overlay.dataset.alunixaXPage = "true";
    markCodexPlusExtensionNode(overlay, "builtin-plugin-market");
    applyCodexPlusTheme(overlay);
    applyCodexPlusZoom(overlay);
    const state = alunixaXPluginMarketState;
    overlay.innerHTML = `<div class="alunixa-x-modal-content" role="region" aria-label="CodeX 插件市场" data-alunixa-x-active-tab="${alunixaXPluginMarketTab}">
      <div class="alunixa-x-modal-header"><div class="alunixa-x-modal-title">CodeX 插件市场</div></div>
      <div class="alunixa-x-modal-body"><div class="alunixa-x-panel alunixa-x-plugin-market-panel" data-codex-plugin-market-panel="true">
        <p class="alunixa-x-plugin-intro">检索插件目录，选中后下载并安装。目录浏览仅获取索引，插件文件按需下载。</p>
        <div class="alunixa-x-plugin-toolbar">
          <div class="alunixa-x-plugin-sources" role="group" aria-label="插件来源"><button type="button" data-codex-plugin-source="public" aria-pressed="false">公开市场</button><button type="button" data-codex-plugin-source="full" aria-pressed="false">完整市场</button></div>
          <button type="button" class="alunixa-x-button" data-codex-plugin-refresh="true">刷新目录</button>
        </div>
        <div class="alunixa-x-plugin-status" data-codex-plugin-source-note="true" hidden></div>
        <div class="alunixa-x-plugin-toolbar"><input type="search" class="alunixa-x-plugin-search" data-codex-plugin-query="true" aria-label="搜索插件" placeholder="搜索插件名称、简介或标签" value="${escapeHtml(state.query)}"><label class="alunixa-x-plugin-filter"><input type="checkbox" data-codex-plugin-installed="true" ${state.installedOnly ? "checked" : ""}>仅已安装</label></div>
        <div class="alunixa-x-plugin-status" data-codex-plugin-market-status="true" role="status" aria-live="polite"></div>
        <div class="alunixa-x-plugin-results" data-codex-plugin-results="true" role="list" aria-label="插件结果"></div>
        <div class="alunixa-x-plugin-pagination"><span data-codex-plugin-result-count="true"></span><button type="button" class="alunixa-x-button" data-codex-plugin-page="previous">上一页</button><button type="button" class="alunixa-x-button" data-codex-plugin-page="next">下一页</button></div>
      </div></div></div>`;
    overlay.addEventListener("input", (event) => {
      if (!event.target?.matches?.("[data-codex-plugin-query]")) return;
      state.query = event.target.value;
      state.page = 1;
      renderCodexPlusPluginMarket();
    });
    overlay.addEventListener("change", (event) => {
      if (!event.target?.matches?.("[data-codex-plugin-installed]")) return;
      state.installedOnly = event.target.checked;
      state.page = 1;
      renderCodexPlusPluginMarket();
    });
    overlay.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const source = target?.closest("[data-codex-plugin-source]");
      if (source) {
        state.source = source.dataset.codexPluginSource === "full" ? "full" : "public";
        state.page = 1;
        void loadCodexPlusPluginMarket(state.source);
        return;
      }
      if (target?.closest("[data-codex-plugin-refresh]")) {
        void loadCodexPlusPluginMarket(state.source, true);
        return;
      }
      const install = target?.closest("[data-codex-plugin-install]");
      if (install && !install.disabled) {
        void installCodexPlusPluginMarketPlugin(state.source, install.dataset.codexPluginInstall);
        return;
      }
      const page = target?.closest("[data-codex-plugin-page]");
      if (page && !page.disabled) {
        state.page += page.dataset.codexPluginPage === "next" ? 1 : -1;
        renderCodexPlusPluginMarket();
        overlay.querySelector(".alunixa-x-modal-body")?.scrollTo?.({ top: 0 });
      }
    });
    document.body.appendChild(overlay);
    positionCodexPlusPage(overlay);
    document.querySelectorAll('[data-alunixa-x-ext-rail-active="true"]').forEach((node) => {
      node.removeAttribute("data-alunixa-x-ext-rail-active");
      const button = node.querySelector("button") || node;
      button.dataset.active = "false";
      button.removeAttribute("data-selected");
      button.removeAttribute("aria-current");
    });
    setCodexPlusSidebarNavActive(true, "plugin-market");
    // 拓展页面可能留下捕获旧 overlay 的 resize 回调，重开后必须改为查询当前 DOM。
    window.removeEventListener("resize", window.__alunixaXPageResizeHandler);
    window.__alunixaXPageResizeHandler = () => positionCodexPlusPage(document.querySelector(`.${alunixaXPageClass}`));
    window.addEventListener("resize", window.__alunixaXPageResizeHandler);
    renderCodexPlusPluginMarket();
    void loadCodexPlusPluginMarket(state.source);
    Object.entries(state.jobs).forEach(([key, job]) => {
      if (!job.busy) return;
      const colon = key.indexOf(":");
      scheduleCodexPlusPluginMarketInstallPoll(key.slice(0, colon), key.slice(colon + 1));
    });
  }
  /**
   * 复用原生插件页面：仅接管带独立索引标记的详情与安装，其他插件仍走原接口。
   * 当前验证的传输有 client.sendRequest、fetch envelope 和 mcp-request envelope。
   * 安装请求只发一次；桥接超时后查询后台任务，不能回落到原生 plugin/install。
   */
  const alunixaXPluginNativeVersion = "1";
  const alunixaXPluginNativeState = window.__alunixaXPluginNativeState || {
    bypass: Symbol("alunixa-x-plugin-native-bypass"), requests: new Map(), synthetic: new WeakSet(),
    ids: new Map(), catalogs: new Map(), installJobs: new Map(),
  };
  window.__alunixaXPluginNativeState = alunixaXPluginNativeState;
  const alunixaXPluginNativeBypass = alunixaXPluginNativeState.bypass;
  const alunixaXPluginNativeRequests = alunixaXPluginNativeState.requests;
  const alunixaXPluginNativeSyntheticMessages = alunixaXPluginNativeState.synthetic;
  const alunixaXPluginNativeIds = alunixaXPluginNativeState.ids;
  const alunixaXPluginNativeCatalogs = alunixaXPluginNativeState.catalogs;
  const alunixaXPluginNativeInstallJobs = alunixaXPluginNativeState.installJobs;

  function alunixaXPluginNativeOperation(method, params, hostId) {
    const wrapped = String(method || "") === "send-cli-request-for-host";
    const requestParams = wrapped ? params?.params || {} : params || {};
    const hosts = [hostId, params?.hostId, wrapped ? requestParams?.hostId : null].filter((value) => value != null);
    return {
      method: appServerModelRequestMethod(String(method || ""), params),
      params: requestParams,
      hostId: hosts.find((value) => value !== "local") ?? hosts[0],
    };
  }

  function alunixaXPluginNativeSource(params) {
    const path = String(params?.marketplacePath || "").replace(/\\/g, "/");
    const pathMatch = /(?:^|\/)alunixa-x-plugin-market\/virtual-(public|full)\/\.agents\/plugins\/marketplace\.json$/.exec(path);
    if (pathMatch) return pathMatch[1];
    const name = String(params?.remoteMarketplaceName || params?.localMarketplaceName || "");
    const nameMatch = /^alunixa-x-index-(public|full)$/.exec(name);
    return nameMatch ? nameMatch[1] : "";
  }

  function alunixaXPluginNativeLocal(operation) {
    return operation.hostId == null || operation.hostId === "local";
  }

  function alunixaXPluginNativeListAllowed(operation) {
    if (!alunixaXPluginNativeLocal(operation)) return false;
    if (operation.method === "installed-plugins") return true;
    if (operation.method !== "list-plugins") return false;
    const kinds = operation.params?.marketplaceKinds;
    return !Array.isArray(kinds) || kinds.length === 0 || kinds.includes("local");
  }

  function alunixaXPluginNativeRemember(result) {
    const marketplaces = result?.marketplaces;
    if (!Array.isArray(marketplaces)) return;
    marketplaces.forEach((market) => {
      const source = alunixaXPluginNativeSource({ marketplacePath: market.path, localMarketplaceName: market.name });
      if (!source || !Array.isArray(market.plugins)) return;
      market.plugins.forEach((plugin) => {
        if (typeof plugin?.name === "string" && typeof plugin?.alunixaXIndexId === "string") {
          alunixaXPluginNativeIds.set(`${source}:${plugin.name}`, plugin.alunixaXIndexId);
        }
      });
    });
  }

  async function alunixaXPluginNativeBackend(method, params, source) {
    let result;
    try {
      result = await postJson("/plugin-market/native", { method, params: params || {}, ...(source ? { source } : {}) });
    } catch (error) {
      // 传输中断不能证明后台未接到请求；安装提交后的异常要查询原任务。
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.outcomeUnknown = true;
      failure.timeout = /timeout|timed out|超时|deadline/i.test(failure.message);
      throw failure;
    }
    if (!result || typeof result !== "object" || result.status === "failed") {
      const error = new Error(result?.message || "CodeX 插件市场请求失败");
      error.timeout = result?.timeout === true || /timeout|timed out|超时/i.test(error.message);
      throw error;
    }
    return result;
  }

  async function alunixaXPluginNativeCatalog(operation) {
    const key = operation.method;
    const now = Date.now();
    const cached = alunixaXPluginNativeCatalogs.get(key);
    const ttl = key === "installed-plugins" ? 1000 : 60_000;
    if (cached?.promise) return JSON.parse(JSON.stringify(await cached.promise));
    if (cached?.value && !operation.params?.forceRefetch && now - cached.at < ttl) {
      return JSON.parse(JSON.stringify(cached.value));
    }
    const entry = { at: now, value: null, promise: null };
    const promise = alunixaXPluginNativeBackend(operation.method, operation.params).then((result) => {
      if (!Array.isArray(result.marketplaces)) throw new Error("CodeX 插件市场列表格式错误");
      alunixaXPluginNativeRemember(result);
      entry.value = result;
      entry.at = Date.now();
      return result;
    }).finally(() => { entry.promise = null; });
    entry.promise = promise;
    alunixaXPluginNativeCatalogs.set(key, entry);
    return JSON.parse(JSON.stringify(await promise));
  }

  function alunixaXPluginNativeMerge(original, extra, method) {
    const base = original && typeof original === "object" ? original : {};
    const managedIds = new Set((extra?.marketplaces || []).flatMap((market) =>
      alunixaXPluginNativeSource({ marketplacePath: market.path, localMarketplaceName: market.name })
        ? (market.plugins || []).map((plugin) => plugin.id) : []));
    const markets = Array.isArray(base.marketplaces) ? base.marketplaces.map((market) => {
      if (!/^alunixa-x-plugin-market-[a-f0-9]{12}$/.test(market.name || "") || !Array.isArray(market.plugins)) return market;
      // 已安装目录也会从原生本地市场返回；只消除我们自己 namespace 内同 id 的重复。
      return { ...market, plugins: market.plugins.filter((plugin) => !managedIds.has(plugin.id)) };
    }) : [];
    for (const market of extra?.marketplaces || []) {
      const existing = markets.find((item) => item.name === market.name && item.path === market.path);
      if (!existing) {
        markets.push(market);
      } else {
        const ids = new Set((existing.plugins || []).map((plugin) => plugin.id));
        existing.plugins = [...(existing.plugins || []), ...(market.plugins || []).filter((plugin) => !ids.has(plugin.id))];
      }
    }
    const result = {
      ...base, marketplaces: markets,
      marketplaceLoadErrors: [...(Array.isArray(base.marketplaceLoadErrors) ? base.marketplaceLoadErrors : []), ...(extra?.marketplaceLoadErrors || [])],
      __alunixaXIndexMerged: true,
    };
    if (method === "list-plugins") result.featuredPluginIds = [...new Set([...(base.featuredPluginIds || []), ...(extra?.featuredPluginIds || [])])];
    alunixaXPluginNativeRemember(result);
    return result;
  }

  async function alunixaXPluginNativeExtend(operation, original) {
    if (original?.__alunixaXIndexMerged) return original;
    try {
      return alunixaXPluginNativeMerge(original, await alunixaXPluginNativeCatalog(operation), operation.method);
    } catch (error) {
      // 自定义市场暂时离线时保留原生列表，不能把系统插件清空。
      const fallbackPath = alunixaXIsWindowsPlatform ? "C:\\alunixa-x-plugin-market" : "/alunixa-x-plugin-market";
      return alunixaXPluginNativeMerge(original, { marketplaceLoadErrors: [{ marketplacePath: fallbackPath, message: error?.message || "CodeX 插件市场暂时不可用" }] }, operation.method);
    }
  }

  function alunixaXPluginNativeInvalidate() {
    alunixaXPluginNativeCatalogs.clear();
    clearPluginMarketplaceQueryCache();
    showToast("插件已安装，新开聊天或重启 Codex 后加载。");
  }

  async function alunixaXPluginNativeManaged(operation, source) {
    if (!alunixaXPluginNativeLocal(operation)) throw new Error("CodeX 插件市场目前仅支持本机安装，请切换到本机。");
    if (operation.method === "read-plugin") {
      const result = await alunixaXPluginNativeBackend(operation.method, operation.params, source);
      const summary = result?.plugin?.summary;
      if (typeof summary?.alunixaXIndexId === "string") alunixaXPluginNativeIds.set(`${source}:${operation.params.pluginName}`, summary.alunixaXIndexId);
      return result;
    }
    const key = `${source}:${operation.params.pluginName || ""}`;
    if (alunixaXPluginNativeInstallJobs.has(key)) return await alunixaXPluginNativeInstallJobs.get(key);
    const promise = (async () => {
      let id = alunixaXPluginNativeIds.get(key);
      if (!id) {
        // 未浏览列表也可能直接进入详情，先获取真实索引 id；这一步不会下载插件文件。
        const detail = await alunixaXPluginNativeBackend("read-plugin", operation.params, source);
        id = detail?.plugin?.summary?.alunixaXIndexId;
        if (typeof id !== "string" || !id) throw new Error("插件索引缺少安装标识，请刷新目录后重试。");
        alunixaXPluginNativeIds.set(key, id);
      }
      try {
        const result = await alunixaXPluginNativeBackend("install-plugin", operation.params, source);
        if (result?.authPolicy && Array.isArray(result.appsNeedingAuth)) {
          alunixaXPluginNativeInvalidate();
          return result;
        }
        throw new Error("正在等待插件安装结果");
      } catch (error) {
        if (!error?.timeout && !error?.outcomeUnknown && !/正在等待/.test(error?.message || "")) throw error;
      }
      // 安装已经提交，后续只能读取同一后台任务，绝不能再次提交或发给原生接口。
      const deadline = Date.now() + 10 * 60_000;
      let communicationFailures = 0;
      const outcomeUnknown = () => new Error("暂时无法确认安装结果，请刷新已安装目录查看；后台任务可能仍在运行。");
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        let status;
        try { status = await postJson("/plugin-market/install-status", { source, id }); } catch {
          if (++communicationFailures >= 5) throw outcomeUnknown();
          continue;
        }
        if (status?.busy === true) { communicationFailures = 0; continue; }
        if (status?.busy === false && status.stage === "complete" && status.nativeResult?.authPolicy && Array.isArray(status.nativeResult.appsNeedingAuth)) {
          alunixaXPluginNativeInvalidate();
          return status.nativeResult;
        }
        if (status?.busy === false) throw new Error(status.message || "插件安装未完成，请重试。");
        if (++communicationFailures >= 5) throw outcomeUnknown();
      }
      throw outcomeUnknown();
    })().finally(() => { alunixaXPluginNativeInstallJobs.delete(key); });
    alunixaXPluginNativeInstallJobs.set(key, promise);
    return await promise;
  }

  /** 返回 null 表示原接口继续执行；返回 Promise 表示已由本层接管。 */
  function alunixaXPluginNativeInterceptClient(method, params, options, original, hostId) {
    if (!codexPluginMarketplacePatchEnabled() || options?.[alunixaXPluginNativeBypass]) return null;
    const operation = alunixaXPluginNativeOperation(method, params, hostId);
    const source = alunixaXPluginNativeSource(operation.params);
    if (source && ["read-plugin", "install-plugin"].includes(operation.method)) return alunixaXPluginNativeManaged(operation, source);
    if (!alunixaXPluginNativeListAllowed(operation)) return null;
    return (async () => {
      let result;
      try {
        result = await original({ ...(options || {}), [alunixaXPluginNativeBypass]: true });
      } catch (error) {
        if (!pluginMarketplaceRemoteAuthError(error)) throw error;
        result = { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] };
      }
      return await alunixaXPluginNativeExtend(operation, result);
    })();
  }

  function alunixaXPluginNativeEnvelope(message) {
    if (!message || typeof message !== "object") return null;
    if (message.type === "mcp-request" && message.request?.id != null) {
      return {
        transport: "mcp", id: message.request.id,
        key: `mcp:${message.hostId || "local"}:${message.request.id}`,
        operation: alunixaXPluginNativeOperation(message.request.method, message.request.params, message.hostId),
        request: message,
      };
    }
    if (message.type === "fetch" && message.requestId != null && typeof message.url === "string") {
      let params = message.body || {};
      if (typeof params === "string") {
        try { params = JSON.parse(params); } catch { return null; }
      }
      return {
        transport: "fetch", id: message.requestId, key: `fetch:${message.requestId}`,
        operation: alunixaXPluginNativeOperation(message.url, params, message.hostId), request: message,
      };
    }
    return null;
  }

  function alunixaXPluginNativeDeliver(data) {
    alunixaXPluginNativeSyntheticMessages.add(data);
    window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: window.location.origin }));
  }

  function alunixaXPluginNativeReply(envelope, result, error) {
    if (envelope.transport === "fetch") {
      alunixaXPluginNativeDeliver({ type: "fetch-response", requestId: envelope.id, responseType: error ? "error" : "success", status: error ? 500 : 200,
        headers: { "content-type": "application/json" }, ...(error ? { error: error.message || String(error) } : { bodyJsonString: JSON.stringify(result) }) });
    } else {
      alunixaXPluginNativeDeliver({ type: "mcp-response", hostId: envelope.request.hostId || "local", message: { id: envelope.id,
        ...(error ? { error: { code: -32000, message: error.message || String(error) } } : { result }) } });
    }
  }

  function alunixaXPluginNativeInterceptOutgoing(message) {
    if (!codexPluginMarketplacePatchEnabled()) return false;
    const envelope = alunixaXPluginNativeEnvelope(message);
    if (!envelope) return false;
    const source = alunixaXPluginNativeSource(envelope.operation.params);
    if (source && ["read-plugin", "install-plugin"].includes(envelope.operation.method)) {
      void alunixaXPluginNativeManaged(envelope.operation, source).then(
        (result) => alunixaXPluginNativeReply(envelope, result),
        (error) => alunixaXPluginNativeReply(envelope, null, error));
      return true;
    }
    if (alunixaXPluginNativeListAllowed(envelope.operation)) {
      alunixaXPluginNativeRequests.set(envelope.key, envelope);
      // 只跟踪当前原生请求；超时不自发重发任何请求。
      setTimeout(() => alunixaXPluginNativeRequests.delete(envelope.key), 90_000);
    }
    return false;
  }

  function alunixaXPluginNativeSuppressForwarded(message) {
    if (!codexPluginMarketplacePatchEnabled()) return false;
    const envelope = alunixaXPluginNativeEnvelope(message);
    return Boolean(envelope && alunixaXPluginNativeSource(envelope.operation.params)
      && ["read-plugin", "install-plugin"].includes(envelope.operation.method));
  }

  function alunixaXPluginNativeInterceptIncoming(data) {
    if (!data || alunixaXPluginNativeSyntheticMessages.has(data)) return false;
    const fetchResponse = data.type === "fetch-response";
    const mcpResponse = data.type === "mcp-response";
    if (!fetchResponse && !mcpResponse) return false;
    const key = fetchResponse ? `fetch:${data.requestId}` : `mcp:${data.hostId || "local"}:${data.message?.id}`;
    const envelope = alunixaXPluginNativeRequests.get(key);
    if (!envelope) return false;
    alunixaXPluginNativeRequests.delete(key);
    void (async () => {
      let payload;
      let nativeError;
      let wrapped = false;
      if (fetchResponse) {
        if (data.responseType === "error" || Number(data.status) >= 400) nativeError = data.error || data.bodyJsonString || "原生插件接口请求失败";
        try { payload = "body" in data ? data.body : JSON.parse(data.bodyJsonString || "{}"); } catch {
          alunixaXPluginNativeDeliver(data);
          return;
        }
        if (payload?.error) nativeError = payload.error;
        wrapped = payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "id");
      } else {
        payload = data.message?.result;
        nativeError = data.message?.error;
      }
      if (nativeError && !pluginMarketplaceRemoteAuthError(nativeError)) {
        alunixaXPluginNativeDeliver(data);
        return;
      }
      const original = nativeError ? {} : wrapped ? payload.result : payload;
      const merged = await alunixaXPluginNativeExtend(envelope.operation, original);
      if (fetchResponse) {
        const response = wrapped ? { ...payload, result: merged } : merged;
        if (wrapped) delete response.error;
        const next = { ...data, responseType: "success", status: 200, bodyJsonString: JSON.stringify(response) };
        delete next.body;
        delete next.error;
        alunixaXPluginNativeDeliver(next);
      } else {
        const message = { ...data.message, result: merged };
        delete message.error;
        alunixaXPluginNativeDeliver({ ...data, message });
      }
    })().catch((error) => alunixaXPluginNativeReply(envelope, null, error));
    return true;
  }

  function installCodexPlusPluginNativeTransportListener() {
    if (window.__alunixaXPluginNativeResponseListener) window.removeEventListener("message", window.__alunixaXPluginNativeResponseListener, true);
    window.__alunixaXPluginNativeResponseListener = (event) => {
      if (event.source != null && event.source !== window) return;
      if (alunixaXPluginNativeInterceptIncoming(event.data)) event.stopImmediatePropagation();
    };
    window.addEventListener("message", window.__alunixaXPluginNativeResponseListener, true);
  }

  function ensureCodexPlusPluginNativeTransportReinjection() {
    if (!codexPluginMarketplacePatchEnabled()) return;
    const bridge = window.electronBridge;
    if (bridge?.__codexPluginMarketplaceOriginalSendMessageFromView
        && bridge.__codexPluginMarketplaceBridgePatch !== codexPluginMarketplaceUnlockVersion
        && bridge.sendMessageFromView?.__alunixaXPluginNativeTransport !== alunixaXPluginNativeVersion) {
      const original = bridge.sendMessageFromView.bind(bridge);
      const patched = (message) => alunixaXPluginNativeInterceptOutgoing(message) ? Promise.resolve() : original(message);
      patched.__alunixaXPluginNativeTransport = alunixaXPluginNativeVersion;
      bridge.sendMessageFromView = patched;
    }
    if (window.__codexPluginMarketplaceOriginalDispatchEvent
        && window.__codexPluginMarketplaceWindowEventPatch !== codexPluginMarketplaceUnlockVersion
        && window.dispatchEvent?.__alunixaXPluginNativeTransport !== alunixaXPluginNativeVersion) {
      const original = window.dispatchEvent.bind(window);
      const patched = (event) => {
        if (event?.type === "codex-message-from-view") {
          if (event.__codexForwardedViaBridge && alunixaXPluginNativeSuppressForwarded(event.detail)) return true;
          if (!event.__codexForwardedViaBridge && alunixaXPluginNativeInterceptOutgoing(event.detail)) return true;
        }
        if (event?.type === "message" && alunixaXPluginNativeInterceptIncoming(event.data)) return true;
        return original(event);
      };
      patched.__alunixaXPluginNativeTransport = alunixaXPluginNativeVersion;
      window.dispatchEvent = patched;
    }
  }

  function alunixaXNativePluginNavigationEntry() {
    // 每次重查原生导航；注入入口和第三方 Plugins 按钮不能充当原生目标。
    const destinations = Array.from(document.querySelectorAll('nav [data-sidebar-destination], aside.app-shell-left-panel nav button, nav[data-app-navigation-rail] button'));
    return destinations.find((button) => {
      if (button.closest('[data-alunixa-x-ext], [data-alunixa-x-rail]')) return false;
      if (button.closest(`#${alunixaXSidebarPluginMarketId}, #${alunixaXRailPluginMarketId}`)) return false;
      if (typeof isExtensionUiNode === "function" && isExtensionUiNode(button)) return false;
      if (typeof visibleElement === "function" && !visibleElement(button)) return false;
      const destination = (button.getAttribute("data-sidebar-destination") || "").trim();
      const label = (button.getAttribute("aria-label") || button.textContent || "").replace(/\s+/g, " ").trim();
      return destination === "plugins" || destination === "builtin:plugins" || /^(插件|Plugins)$/i.test(label);
    });
  }

  function openCodexPlusNativePluginMarket() {
    closeCodexPlusPage();
    clearPluginMarketplaceQueryCache();
    const native = alunixaXNativePluginNavigationEntry();
    if (native && !native.disabled && native.getAttribute("aria-disabled") !== "true") {
      native.click();
      return;
    }
    // 没有可验证的原生入口时打开管理工具，不猜测内部路由或跳转外部浏览器。
    void postJson("/manager/open", { page: "pluginMarket" });
  }
  async function setCodexGlobalState(key, value) {
    return await codexStateCall("set-global-state", { params: { key, value } });
  }

  function dispatchCodexPlusMessage(dispatcher, type, payload) {
    const message = codexServiceTierRequestOverride({ ...(payload || {}), type });
    const nextType = message?.type || type;
    const { type: _type, ...nextPayload } = message || {};
    if (nextType === "browser-use-session-route-capture") {
      observeCodexRemoteSessionNotification({ type: nextType, params: nextPayload });
    }
    return dispatcher.__codexServiceTierOriginalDispatchMessage(nextType, nextPayload);
  }

  function objectGlobalState(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  }

  function uniqueValues(values) {
    return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)));
  }

  let codexModelCatalog = { status: "loading", model: "", default_model: "", model_provider: "", codex_model_provider: "", provider_name: "", models: [], sources: [], responses_api: { status: "unknown", message: "" } };
  let codexModelCatalogLoadedAt = 0;
  let codexModelCatalogPromise = null;
  let codexModelWhitelistRefreshTimer = 0;
  let codexModelWhitelistRefreshUntil = 0;
  const alunixaXModelListRequestIds = new Set();
  const alunixaXModelListRequestHosts = new Map();
  // 跨重注入保留原生数据快照；WeakMap 仅持有模型集合，不缓存 DOM。
  const alunixaXModelCollectionSnapshots = window.__alunixaXModelCollectionSnapshots
    || (window.__alunixaXModelCollectionSnapshots = new WeakMap());
  const alunixaXModelDefaultSnapshots = window.__alunixaXModelDefaultSnapshots
    || (window.__alunixaXModelDefaultSnapshots = new WeakMap());

  if (window.__ALUNIXA_X_TEST_SERVICE_TIER__) {
    window.__alunixaXServiceTierTest = {
      applyServiceTierOverride: (method, params, threadIdHint = "") => applyCodexServiceTierRequestOverride(method, params, threadIdHint),
      applyProviderOverride: (method, params) => applyCodexRemoteSessionProviderOverride(method, params),
      remoteSessionStartedThreadId: (value) => codexRemoteSessionStartedThreadId(value),
      observeRemoteSessionNotification: (value) => observeCodexRemoteSessionNotification(value),
      installRemoteSessionRecoveryListener: () => installCodexRemoteSessionRecoveryListener(),
      installRemoteSessionDispatcherSubscription: (dispatcher, assetPrefix = "test") => installCodexRemoteSessionDispatcherSubscription(dispatcher, assetPrefix),
      dispatchMessage: (dispatcher, type, payload) => dispatchCodexPlusMessage(dispatcher, type, payload),
      requestOverride: (message) => codexServiceTierRequestOverride(message),
      diagnostics: () => [...(window.__alunixaXServiceTierTestDiagnostics || [])],
      statusSummary: (state = {}) => {
        const summaryState = { ...codexServiceTierState, ...state };
        return serviceTierStatusMessage(
          summaryState.controlMode,
          summaryState.threadMode,
          summaryState.effectiveMode,
          summaryState.defaultMode,
          summaryState.effectiveServiceTier,
          summaryState.serviceTierSource
        );
      },
      resolveInheritedServiceTier: () => resolveInheritedServiceTier(),
      currentModelName: () => codexServiceTierCurrentModelName(),
      fastAvailability: (modelName = codexServiceTierCurrentModelName()) => codexServiceTierFastAvailability(modelName),
      modelDescriptor: (modelName) => alunixaXModelDescriptor(modelName),
      setModelCatalog: (catalog = {}) => {
        codexModelCatalog = {
          status: "ok",
          model: "",
          default_model: "",
          model_provider: "",
          codex_model_provider: "",
          provider_name: "",
          models: [],
          sources: [],
          responses_api: { status: "unknown", message: "" },
          ...catalog,
        };
        codexModelCatalogLoadedAt = Date.now();
        codexModelCatalogPromise = null;
      },
      loadModelCatalog: (force = false) => loadCodexModelCatalog(force),
      patchModelContainer: (value, hostId = "local") => patchModelContainer(value, hostId),
      patchModelArray: (models, allowEmpty = false, hostId = "local") => patchModelArray(models, allowEmpty, hostId),
      patchStatsigModelDynamicConfig: (config, hostId = "local") => patchStatsigModelDynamicConfig(config, hostId),
      patchModelJsonResponse,
      patchMcpModelResponseData,
      recordModelListRequest,
      setBackendSettings: (settings = {}) => {
        alunixaXBackendSettings = { ...alunixaXBackendSettings, ...settings };
        alunixaXBackendSettingsLoaded = true;
      },
      providerPatchEnabled: () => codexRemoteSessionProviderPatchEnabled(),
      providerNormalizationEnabled: () => codexRemoteSessionProviderNormalizationEnabled(),
      setServiceTierState: (state = {}) => {
        codexServiceTierState = { ...codexServiceTierState, ...state };
      },
      setThreadState: (state = {}) => {
        localStorage.setItem(codexThreadServiceTierKey, JSON.stringify({
          version: codexThreadServiceTierVersion,
          mode: "inherit",
          defaultMode: "inherit",
          entries: {},
          ...state,
        }));
      },
      settingStorageFromModule: codexSettingStorageFromModule,
      stateApiFromModule: codexStateApiFromModule,
      dispatcherFromModule: codexServiceTierDispatcherFromModule,
      patchAppServerClient: patchAppServerModelRequestClient,
      locateAppServerClientBreakpoint: locateCodexAppServerClientBreakpoint,
      installAppServerClientPrototypePatch: installCodexAppServerClientPrototypePatch,
      appServerClientPrototypeState: () => ({
        hasClass: typeof window.__alunixaXAppServerClientClass === "function",
        installed: window.__alunixaXAppServerClientPrototypePatchInstalled || null,
      }),
    };
    return;
  }

  function alunixaXModelUnlockEnabled() {
    return !!alunixaXSettings().modelWhitelistUnlock;
  }

  function alunixaXModelNames() {
    return uniqueValues([
      codexModelCatalog.default_model,
      codexModelCatalog.model,
      ...(Array.isArray(codexModelCatalog.models) ? codexModelCatalog.models : []),
    ]);
  }

  async function loadCodexModelCatalog(force = false) {
    if (!force && codexModelCatalogPromise) return codexModelCatalogPromise;
    if (!force && codexModelCatalogLoadedAt && Date.now() - codexModelCatalogLoadedAt < 10000) return codexModelCatalog;
    codexModelCatalogPromise = readCodexAppServerPreparation("/codex-model-catalog", {})
      .then(async (result) => {
        codexModelCatalog = result && typeof result === "object" ? result : { status: "failed", model: "", default_model: "", model_provider: "", codex_model_provider: "", provider_name: "", models: [], sources: [], responses_api: { status: "unknown", message: "" } };
        if ((!codexModelCatalog.models || codexModelCatalog.models.length === 0) && codexModelCatalog.status === "not_configured") {
          try {
            const settingsResp = await readCodexAppServerPreparation("/settings/get", {});
            if (settingsResp && settingsResp.relayProfiles && Array.isArray(settingsResp.relayProfiles)) {
              const activeId = settingsResp.activeRelayId || "";
              const profile = settingsResp.relayProfiles.find(p => p.id === activeId);
              if (profile && profile.modelList) {
                const extraModels = profile.modelList.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
                if (extraModels.length > 0) {
                  codexModelCatalog.models = extraModels;
                  codexModelCatalog.default_model = codexModelCatalog.default_model || extraModels[0];
                  sendCodexPlusDiagnostic("model_catalog_fallback_applied", { count: extraModels.length });
                }
              }
            }
          } catch (fallbackError) {
            sendCodexPlusDiagnostic("model_catalog_fallback_error", { error: String(fallbackError?.message || fallbackError) });
          }
        }
        codexModelCatalogLoadedAt = Date.now();
        renderCodexPlusMenu();
        scheduleCodexModelWhitelistRefresh();
        return codexModelCatalog;
      })
      .catch((error) => {
        codexModelCatalog = { status: "failed", message: String(error?.message || error), model: "", default_model: "", model_provider: "", codex_model_provider: "", provider_name: "", models: [], sources: [], responses_api: { status: "unknown", message: "" } };
        codexModelCatalogLoadedAt = Date.now();
        return codexModelCatalog;
      })
      .finally(() => {
        codexModelCatalogPromise = null;
      });
    return codexModelCatalogPromise;
  }

  function alunixaXModelMetadata(modelName) {
    const metadata = codexModelCatalog.modelMetadata || codexModelCatalog.model_metadata;
    const normalizedName = codexServiceTierModelFromValue(modelName);
    const exact = metadata && typeof metadata === "object" ? metadata[normalizedName] : null;
    const matchedKey = !exact && metadata && typeof metadata === "object"
      ? Object.keys(metadata).find((key) => key.toLowerCase() === normalizedName.toLowerCase())
      : null;
    const value = exact || (matchedKey ? metadata[matchedKey] : null);
    return value && typeof value === "object" ? value : null;
  }

  function modelReasoningEfforts(modelName) {
    const supported = alunixaXModelMetadata(modelName)?.supportedReasoningEfforts;
    if (Array.isArray(supported) && supported.length > 0) {
      const efforts = supported.map((entry) => ({ ...entry }));
      const hasMax = efforts.some((e) => e.reasoningEffort === "max");
      const hasUltra = efforts.some((e) => e.reasoningEffort === "ultra");
      if (!hasMax) efforts.push({ reasoningEffort: "max", description: "Maximum reasoning depth for the hardest problems" });
      if (!hasUltra) {
        const shouldAddUltra = /sol|terra|gpt-5\.6|gpt-5\.5|gpt-5\.4|deepseek/i.test(String(modelName || ""));
        if (shouldAddUltra || efforts.length >= 4) efforts.push({ reasoningEffort: "ultra", description: "Maximum reasoning with automatic task delegation" });
      }
      return efforts;
    }
    return ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: `${reasoningEffort} effort` }));
  }

  function applyCodexPlusModelMetadata(descriptor, modelName) {
    const metadata = alunixaXModelMetadata(modelName);
    if (!descriptor || !metadata) return false;
    let changed = false;
    for (const key of ["displayName", "description", "defaultReasoningEffort"]) {
      if (typeof metadata[key] === "string" && metadata[key] && descriptor[key] !== metadata[key]) {
        descriptor[key] = metadata[key];
        changed = true;
      }
    }
    if (Array.isArray(metadata.supportedReasoningEfforts) && metadata.supportedReasoningEfforts.length > 0) {
      const nextEfforts = modelReasoningEfforts(modelName);
      if (JSON.stringify(descriptor.supportedReasoningEfforts || []) !== JSON.stringify(nextEfforts)) {
        descriptor.supportedReasoningEfforts = nextEfforts;
        changed = true;
      }
    }
    return changed;
  }

  function alunixaXModelDescriptor(modelName) {
    const metadata = alunixaXModelMetadata(modelName);
    return {
      model: modelName,
      id: modelName,
      slug: modelName,
      name: modelName,
      displayName: metadata?.displayName || modelName,
      description: metadata?.description || codexModelCatalog.provider_name || codexModelCatalog.model_provider || "Custom model",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: metadata?.defaultReasoningEffort || "medium",
      supportedReasoningEfforts: modelReasoningEfforts(modelName),
    };
  }

  function modelArrayLooksPatchable(value, allowEmpty = false) {
    return Array.isArray(value)
      && (allowEmpty || value.length > 0)
      && value.every((item) => item && typeof item === "object" && typeof item.model === "string");
  }

  function stringArrayLooksPatchable(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  }

  function patchModelNameArray(models, hostId) {
    if (!stringArrayLooksPatchable(models)) return false;
    const allowed = codexPureApiAllowedModelSet(hostId);
    let changed = prepareModelCollection(models, allowed);
    const customModels = alunixaXModelNames();
    if (!customModels.length) return changed;
    if (allowed) {
      const retained = models.filter((name) => allowed.has(name));
      if (retained.length !== models.length) {
        models.splice(0, models.length, ...retained);
        changed = true;
      }
    }
    customModels.forEach((modelName) => {
      if (!models.includes(modelName)) {
        models.push(modelName);
        changed = true;
      }
    });
    finishModelCollection(models);
    return changed;
  }

  function modelFilterPolicy(allowed) {
    return allowed ? `${codexRemoteSessionActiveProfile()?.id || ""}:${codexModelCatalog.model || ""}:${JSON.stringify([...allowed].sort())}` : "";
  }

  function sameModelCollection(left, right) {
    return !!right && left.length === right.length && left.every((item, index) => item === right[index]);
  }

  function prepareModelCollection(collection, allowed) {
    const policy = modelFilterPolicy(allowed);
    const previous = alunixaXModelCollectionSnapshots.get(collection);
    let current = [...collection];
    let changed = false;
    if (previous && previous.policy !== policy && sameModelCollection(current, previous.patched)) {
      if (!sameModelCollection(current, previous.original)) {
        if (Array.isArray(collection)) collection.splice(0, collection.length, ...previous.original);
        else { collection.clear(); previous.original.forEach((item) => collection.add(item)); }
        current = [...collection];
        changed = true;
      }
    }
    if (!allowed) alunixaXModelCollectionSnapshots.delete(collection);
    else if (!previous || previous.policy !== policy || !sameModelCollection(current, previous.patched)) {
      alunixaXModelCollectionSnapshots.set(collection, { policy, original: current, patched: null });
    }
    return changed;
  }

  function finishModelCollection(collection) {
    const snapshot = alunixaXModelCollectionSnapshots.get(collection);
    if (snapshot) snapshot.patched = [...collection];
  }

  function patchModelDefaults(value, allowed) {
    const policy = modelFilterPolicy(allowed);
    const previous = alunixaXModelDefaultSnapshots.get(value);
    let changed = false;
    if (previous && previous.policy !== policy) {
      for (const [key, state] of Object.entries(previous.fields)) {
        if (value[key] === state.patched && value[key] !== state.original) {
          value[key] = state.original;
          changed = true;
        }
      }
      alunixaXModelDefaultSnapshots.delete(value);
    }
    if (!allowed) return changed;
    const snapshot = alunixaXModelDefaultSnapshots.get(value) || { policy, fields: {} };
    const fallback = [codexModelCatalog.model, codexModelCatalog.default_model, ...allowed]
      .find((name) => typeof name === "string" && allowed.has(name));
    for (const key of ["defaultModel", "default_model"]) {
      const original = value[key];
      const name = typeof original === "string" ? original : original?.model || original?.id || original?.slug;
      if (!name || allowed.has(name)) continue;
      const patched = typeof original === "string" ? fallback : alunixaXModelDescriptor(fallback);
      if (!snapshot.fields[key] || original !== snapshot.fields[key].patched) {
        snapshot.fields[key] = { original, patched };
      }
      value[key] = patched;
      changed = true;
    }
    alunixaXModelDefaultSnapshots.set(value, snapshot);
    return changed;
  }

  // 只收窄当前纯 API 供应商的有效目录；名单里的 GPT 也是可用模型，不能按前缀删。
  // 目录失败/未配置/仍属于上一个供应商时继续保留原生列表。
  function modelResponseHostId(...values) {
    let local = false;
    for (const value of values) {
      let candidates;
      try { candidates = typeof value === "string" ? [value] : [value?.hostId, value?.host_id]; }
      catch { return ""; }
      for (const candidate of candidates) {
        if (typeof candidate !== "string" || !candidate.trim()) continue;
        const host = candidate.trim();
        if (host !== "local") return host;
        local = true;
      }
    }
    return local ? "local" : "";
  }

  function codexPureApiAllowedModelSet(hostId) {
    if (hostId !== "local") return null;
    const profile = codexRemoteSessionActiveProfile();
    if (!alunixaXModelUnlockEnabled() || !alunixaXBackendSettingsLoaded
        || profile?.relayMode !== "pureApi" || codexModelCatalog.status !== "ok") return null;
    const profileId = String(profile.id || "").trim();
    const belongsToProfile = profileId && (codexModelCatalog.model_provider === profileId
      || (Array.isArray(codexModelCatalog.sources)
        && codexModelCatalog.sources.some((source) => source?.id === `relay-profile:${profileId}`)));
    const names = alunixaXModelNames();
    return belongsToProfile && names.length ? new Set(names) : null;
  }

  function patchModelArray(models, allowEmpty = false, hostId) {
    if (!modelArrayLooksPatchable(models, allowEmpty)) return false;
    const allowed = codexPureApiAllowedModelSet(hostId);
    let changed = prepareModelCollection(models, allowed);
    const customModels = alunixaXModelNames();
    if (!customModels.length) return changed;
    if (allowed) {
      const retained = models.filter((item) => allowed.has(item.model));
      if (retained.length !== models.length) {
        models.splice(0, models.length, ...retained);
        changed = true;
      }
    }
    const existing = new Map(models.map((item) => [item.model, item]));
    models.forEach((item) => {
      if (customModels.includes(item.model)) {
        if (item.hidden !== false) {
          item.hidden = false;
          changed = true;
        }
        if (applyCodexPlusModelMetadata(item, item.model)) changed = true;
      }
    });
    customModels.forEach((modelName) => {
      if (!existing.has(modelName)) {
        models.push(alunixaXModelDescriptor(modelName));
        changed = true;
      }
    });
    finishModelCollection(models);
    return changed;
  }

  function patchModelContainer(value, hostId) {
    if (!value || typeof value !== "object") return false;
    hostId = modelResponseHostId(hostId, value, value.message, value.result);
    let changed = false;
    if (patchModelArray(value.models, "defaultModel" in value || "availableModels" in value, hostId)) changed = true;
    if (patchModelNameArray(value.models, hostId)) changed = true;
    if (patchModelArray(value.data, false, hostId)) changed = true;
    if (patchModelArray(value.result, false, hostId)) changed = true;
    if (patchModelArray(value.pages?.[0]?.data, false, hostId)) changed = true;
    if (patchModelArray(value.result?.data, false, hostId)) changed = true;
    if (patchModelArray(value.result?.models, false, hostId)) changed = true;
    if (patchModelArray(value.message?.result?.data, false, hostId)) changed = true;
    if (patchModelArray(value.message?.result?.models, false, hostId)) changed = true;
    const names = alunixaXModelNames();
    const allowed = codexPureApiAllowedModelSet(hostId);
    if (value.availableModels instanceof Set) {
      if (prepareModelCollection(value.availableModels, allowed)) changed = true;
      if (allowed) for (const name of value.availableModels) {
        if (!allowed.has(name)) { value.availableModels.delete(name); changed = true; }
      }
      names.forEach((name) => {
        if (!value.availableModels.has(name)) {
          value.availableModels.add(name);
          changed = true;
        }
      });
      finishModelCollection(value.availableModels);
    }
    if (value.available_models instanceof Set) {
      if (prepareModelCollection(value.available_models, allowed)) changed = true;
      if (allowed) for (const name of value.available_models) {
        if (!allowed.has(name)) { value.available_models.delete(name); changed = true; }
      }
      names.forEach((name) => {
        if (!value.available_models.has(name)) {
          value.available_models.add(name);
          changed = true;
        }
      });
      finishModelCollection(value.available_models);
    }
    if (Array.isArray(value.availableModels)) {
      if (patchModelNameArray(value.availableModels, hostId)) changed = true;
    }
    if (Array.isArray(value.available_models)) {
      if (patchModelNameArray(value.available_models, hostId)) changed = true;
    }
    if (Array.isArray(value.hiddenModels)) {
      const before = value.hiddenModels.length;
      value.hiddenModels = value.hiddenModels.filter((name) => !names.includes(name));
      if (value.hiddenModels.length !== before) changed = true;
    }
    if (Array.isArray(value.hidden_models)) {
      const before = value.hidden_models.length;
      value.hidden_models = value.hidden_models.filter((name) => !names.includes(name));
      if (value.hidden_models.length !== before) changed = true;
    }
    if (patchModelDefaults(value, allowed)) changed = true;
    return changed;
  }

  function modelJsonResponseLooksPatchable(payload) {
    if (!payload || typeof payload !== "object") return false;
    const descriptorArrays = [
      payload.models,
      payload.data,
      payload.result,
      payload.pages?.[0]?.data,
      payload.result?.data,
      payload.result?.models,
      payload.message?.result?.data,
      payload.message?.result?.models,
    ];
    if (descriptorArrays.some((value) => modelArrayLooksPatchable(value))) return true;
    const hasModelContainerSignal = "defaultModel" in payload
      || "default_model" in payload
      || "availableModels" in payload
      || "available_models" in payload
      || "hiddenModels" in payload
      || "hidden_models" in payload
      || "modelMetadata" in payload
      || "model_metadata" in payload;
    return hasModelContainerSignal && Array.isArray(payload.models)
      && payload.models.every((value) => typeof value === "string");
  }

  async function patchModelJsonResponse(payload) {
    if (!alunixaXModelUnlockEnabled()) return payload;
    if (!alunixaXModelNames().length) await loadCodexModelCatalog();
    if (!modelJsonResponseLooksPatchable(payload)) return payload;
    try {
      patchModelContainer(payload, modelResponseHostId(payload, payload.result, payload.message));
    } catch (error) {
      window.__alunixaXModelPatchFailures = window.__alunixaXModelPatchFailures || [];
      window.__alunixaXModelPatchFailures.push(String(error?.stack || error));
    }
    return payload;
  }

  function installModelJsonResponsePatch() {
    if (window.__alunixaXModelJsonResponsePatchInstalled === "3") return;
    window.__alunixaXModelJsonResponsePatchInstalled = "3";
    window.__alunixaXModelJsonResponseOriginals = window.__alunixaXModelJsonResponseOriginals || {};
    const originals = window.__alunixaXModelJsonResponseOriginals;
    originals.responseJson = originals.responseJson || Response.prototype.json;
    if (typeof originals.responseJson !== "function") return;
    Response.prototype.json = async function alunixaXPatchedResponseJson(...args) {
      const payload = await originals.responseJson.apply(this, args);
      return await patchModelJsonResponse(payload);
    };
  }

  function patchStatsigModelDynamicConfig(config, hostId) {
    const value = config?.value;
    if (!value || typeof value !== "object") return config;
    const availableModels = Array.isArray(value.available_models) ? [...value.available_models] : [];
    const collectionSnapshot = alunixaXModelCollectionSnapshots.get(value.available_models);
    if (collectionSnapshot) alunixaXModelCollectionSnapshots.set(availableModels, { ...collectionSnapshot });
    const nextValue = { ...value, available_models: availableModels };
    const defaultSnapshot = alunixaXModelDefaultSnapshots.get(value);
    if (defaultSnapshot) alunixaXModelDefaultSnapshots.set(nextValue, { ...defaultSnapshot, fields: { ...defaultSnapshot.fields } });
    hostId = modelResponseHostId(hostId, value);
    const listChanged = patchModelNameArray(availableModels, hostId);
    const defaultsChanged = patchModelDefaults(nextValue, codexPureApiAllowedModelSet(hostId));
    if (!listChanged && !defaultsChanged) return config;
    try {
      config.value = nextValue;
    } catch {
      return { ...config, value: nextValue };
    }
    return config;
  }

  function statsigClients() {
    const root = window.__STATSIG__ || globalThis.__STATSIG__;
    if (!root || typeof root !== "object") return [];
    const clients = [root.firstInstance, typeof root.instance === "function" ? root.instance() : null];
    if (root.instances && typeof root.instances === "object") clients.push(...Object.values(root.instances));
    return clients.filter((client, index, array) => client && typeof client === "object" && array.indexOf(client) === index);
  }

  function patchStatsigModelWhitelist() {
    statsigClients().forEach((client) => {
      if (typeof client.getDynamicConfig !== "function") return;
      if (client.__alunixaXModelWhitelistPatched !== "3") {
        const originalGetDynamicConfig = client.getDynamicConfig.bind(client);
        client.getDynamicConfig = (name, options) => {
          const result = originalGetDynamicConfig(name, options);
          return String(name) === "107580212" ? patchStatsigModelDynamicConfig(result) : result;
        };
        client.__alunixaXModelWhitelistPatched = "3";
      }
      try {
        patchStatsigModelDynamicConfig(client.getDynamicConfig("107580212", { disableExposureLog: true }));
      } catch {
      }
    });
  }

  function patchAppServerModelMessages() {
    if (window.__alunixaXModelMessagePatchInstalled === "3") return;
    window.__alunixaXModelMessagePatchInstalled = "3";
    window.addEventListener("codex-message-from-view", (event) => {
      try {
        const detail = event?.detail;
        const request = detail?.request;
        if (detail?.type === "mcp-request" && request?.method === "model/list") {
          request.params = { ...(request.params || {}), includeHidden: true };
          if (request.id != null) {
            const requestId = String(request.id);
            recordModelListRequest(requestId, modelResponseHostId(detail, request, request.params));
          }
        }
      } catch (error) {
        window.__alunixaXModelPatchFailures = window.__alunixaXModelPatchFailures || [];
        window.__alunixaXModelPatchFailures.push(String(error?.stack || error));
      }
    }, true);

    window.addEventListener("message", (event) => {
      try {
        patchMcpModelResponseData(event?.data);
      } catch (error) {
        window.__alunixaXModelPatchFailures = window.__alunixaXModelPatchFailures || [];
        window.__alunixaXModelPatchFailures.push(String(error?.stack || error));
      }
    }, true);
  }

  function recordModelListRequest(requestId, hostId) {
    if (alunixaXModelListRequestIds.has(requestId)
        && alunixaXModelListRequestHosts.get(requestId) !== hostId) hostId = "";
    alunixaXModelListRequestIds.add(requestId);
    alunixaXModelListRequestHosts.set(requestId, hostId);
    if (alunixaXModelListRequestIds.size > 64) {
      const oldest = alunixaXModelListRequestIds.values().next().value;
      alunixaXModelListRequestIds.delete(oldest);
      alunixaXModelListRequestHosts.delete(oldest);
    }
    window.setTimeout(() => {
      alunixaXModelListRequestIds.delete(requestId);
      alunixaXModelListRequestHosts.delete(requestId);
    }, 30_000);
  }

  function patchMcpModelResponseData(data) {
    if (!alunixaXModelUnlockEnabled()) return false;
    if (data?.type !== "mcp-response") return false;
    const message = data.message || data.response;
    const requestId = message?.id != null ? String(message.id) : "";
    if (alunixaXModelListRequestIds.size === 0 || !alunixaXModelListRequestIds.has(requestId)) return false;
    const hostId = modelResponseHostId(data, message, alunixaXModelListRequestHosts.get(requestId));
    alunixaXModelListRequestIds.delete(requestId);
    alunixaXModelListRequestHosts.delete(requestId);
    let changed = false;
    if (patchModelArray(message?.result?.data, true, hostId)) changed = true;
    if (patchModelArray(message?.result?.models, true, hostId)) changed = true;
    return changed;
  }

  function appServerModelRequestMethod(method, params) {
    if (method === "send-cli-request-for-host" && params?.method) return appServerModelRequestMethod(String(params.method), params.params);
    if (method === "vscode://codex/list-plugins") return "list-plugins";
    if (method === "vscode://codex/plugin/install") return "install-plugin";
    if (method === "vscode://codex/plugin/uninstall") return "uninstall-plugin";
    if (method === "plugin/list") return "list-plugins";
    if (method === "plugin/install") return "install-plugin";
    if (method === "plugin/read") return "read-plugin";
    if (method === "plugin/installed") return "installed-plugins";
    if (method === "plugin/uninstall") return "uninstall-plugin";
    return String(method || "");
  }

  function patchAppServerModelResult(method, result, hostId) {
    if (!["list-models-for-host", "model/list"].includes(method)) return result;
    hostId = modelResponseHostId(hostId, result);
    try {
      if (Array.isArray(result)) patchModelArray(result, true, hostId);
      if (Array.isArray(result?.data)) patchModelArray(result.data, true, hostId);
      if (Array.isArray(result?.models)) patchModelArray(result.models, true, hostId);
      sendCodexPlusDiagnostic("model_app_server_result_patched", {
        method,
        modelCount: Array.isArray(result?.data) ? result.data.length : Array.isArray(result?.models) ? result.models.length : Array.isArray(result) ? result.length : null,
      });
    } catch (error) {
      window.__alunixaXModelPatchFailures = window.__alunixaXModelPatchFailures || [];
      window.__alunixaXModelPatchFailures.push(String(error?.stack || error));
    }
    return result;
  }

  function codexPerModelContextEnabled() {
    const profile = codexRemoteSessionActiveProfile();
    if (!profile) return false;
    return [profile.modelWindows, profile.modelAutoCompact, profile.modelMetadata]
      .some((value) => typeof value === "string" && value.trim() && value.trim() !== "{}");
  }

  function codexThreadModelRequestState(method, params, result) {
    const requestMethod = String(method || "");
    const threadId = String(
      params?.threadId
      || params?.conversationId
      || result?.thread?.id
      || result?.threadId
      || ""
    ).trim();
    const model = String(params?.model || result?.thread?.model || "").trim();
    return { requestMethod, threadId, model };
  }

  async function refreshCodexThreadModelBeforeTurn(client, originalSendRequest, method, params, options) {
    if (String(method || "") !== "turn/start" || !codexPerModelContextEnabled()) return null;
    const { threadId, model } = codexThreadModelRequestState(method, params);
    if (!threadId || !model) return null;
    const previousModel = client.__alunixaXThreadModels?.get(threadId) || "";
    if (!previousModel || previousModel === model) return null;
    let resumeParams = { threadId, model };
    resumeParams = applyCodexRemoteSessionProviderOverride("thread/resume", resumeParams);
    try {
      await originalSendRequest("thread/resume", resumeParams, options);
      client.__alunixaXThreadModels.set(threadId, model);
      sendCodexPlusDiagnostic("thread_model_context_refreshed", {
        threadId,
        from: previousModel,
        to: model,
      });
      return true;
    } catch (error) {
      sendCodexPlusDiagnostic("thread_model_context_refresh_failed", {
        threadId,
        from: previousModel,
        to: model,
        errorName: error?.name || "",
        errorMessage: error?.message || String(error),
      });
      return false;
    }
  }

  function patchAppServerModelRequestClient(client) {
    if (!client || typeof client.sendRequest !== "function") return false;
    if (typeof patchCodexQueuedFollowUpCoordinator === "function") patchCodexQueuedFollowUpCoordinator(client);
    registerNativeHostClient(client);
    try {
      if (!Object.isExtensible(client)) return false;
      for (const key of [
        "__alunixaXModelRequestPatch",
        "__alunixaXModelOriginalSendRequest",
        "__alunixaXThreadModels",
        "__alunixaXServiceTierOriginalPrewarmThreadStart",
        "sendRequest",
        "prewarmThreadStart",
      ]) {
        const descriptor = Object.getOwnPropertyDescriptor(client, key);
        if (descriptor && descriptor.writable === false && typeof descriptor.set !== "function") return false;
      }
    } catch {
      return false;
    }
    if (client.__alunixaXModelRequestPatch === codexAppServerModelRequestPatchVersion) return true;
    const originalSendRequest = client.__alunixaXModelOriginalSendRequest || client.sendRequest.bind(client);
    client.__alunixaXModelOriginalSendRequest = originalSendRequest;
    client.__alunixaXThreadModels = client.__alunixaXThreadModels || new Map();
    client.sendRequest = async function alunixaXModelPatchedSendRequest(method, params, options) {
      const managed = alunixaXPluginNativeInterceptClient(method, params, options,
        (nextOptions) => originalSendRequest(method, params, nextOptions), client.hostId);
      if (managed) return await managed;
      const requestMethod = appServerModelRequestMethod(String(method || ""), params);
      let providerRefreshFailed = false;
      if (codexRemoteSessionProviderRequestMethod(requestMethod)
          && codexRemoteSessionProviderPatchEnabled()
          && window.__codexSessionDeleteBridge) {
        const settingsLoaded = await loadBackendSettingsState(codexAppServerPreparationTimeoutMs);
        providerRefreshFailed = !settingsLoaded;
        if (providerRefreshFailed) {
          sendCodexPlusDiagnostic("remote_session_provider_refresh_failed", {});
        }
      } else if (codexRemoteSessionProviderRequestMethod(requestMethod)
          && codexRemoteSessionProviderOverrideEnabled()
          && !codexRemoteSessionTargetProvider()) {
        providerRefreshFailed = (await loadCodexModelCatalog())?.status === "failed";
      }
      const providerParams = providerRefreshFailed
        ? params
        : applyCodexRemoteSessionProviderOverride(requestMethod, params);
      const nextParams = applyCodexServiceTierRequestOnly(requestMethod, providerParams);
      const modelContextRefresh = await refreshCodexThreadModelBeforeTurn(
        client,
        originalSendRequest,
        method,
        nextParams,
        options
      );
      const result = await originalSendRequest(method, nextParams, options);
      const threadState = codexThreadModelRequestState(requestMethod, nextParams, result);
      if (modelContextRefresh !== false && threadState.threadId && threadState.model
          && ["thread/start", "thread/resume", "turn/start"].includes(threadState.requestMethod)) {
        client.__alunixaXThreadModels.set(threadState.threadId, threadState.model);
      }
      if (!alunixaXModelUnlockEnabled() || !["list-models-for-host", "model/list"].includes(requestMethod)) return result;
      if (!alunixaXModelNames().length) await loadCodexModelCatalog();
      return patchAppServerModelResult(requestMethod, result, modelResponseHostId(params, client));
    };
    if (typeof client.prewarmThreadStart === "function"
        && !client.__alunixaXServiceTierOriginalPrewarmThreadStart) {
      const originalPrewarmThreadStart = client.prewarmThreadStart.bind(client);
      client.__alunixaXServiceTierOriginalPrewarmThreadStart = originalPrewarmThreadStart;
      client.prewarmThreadStart = async function alunixaXServiceTierPrewarmThreadStart(params, options) {
        const nextParams = applyCodexServiceTierRequestOnly("thread/start", params);
        return originalPrewarmThreadStart(nextParams, options);
      };
    }
    client.__alunixaXModelRequestPatch = codexAppServerModelRequestPatchVersion;
    return true;
  }

  // issue #2177：Codex 26.908 把 AppServerRequestClient 类藏进模块闭包且不再导出，
  // 渲染层扫描在新版上永远 not_found，直接改写 dispatcher 又会撞上不可写的 RPC stub。
  // 改为两段式接管：这里先用纯文本定位算出 sendRequest 的断点坐标（按 UTF-16 计数，
  // 与 V8 断点坐标语义一致），launcher 侧 bridge.rs 再用 CDP Debugger 按坐标下条件断点，
  // 命中时把类构造器挂到 window.__alunixaXAppServerClientClass，随后对原型套用与
  // 实例版完全一致的请求补丁。断点条件 `!window.__alunixaXAppServerClientClass`
  // 保证页面重载后自动重新捕获，且每次页面生命周期内只暂停一次。
    function locateCodexAppServerClientBreakpoint(text) {
    if (typeof text !== "string" || !text) return null;
    const markerIdx = text.indexOf(codexAppServerClientCaptureMarker);
    if (markerIdx < 0) return null;
    const anchorIdx = text.lastIndexOf(codexAppServerClientCaptureAnchor, markerIdx);
    if (anchorIdx < 0 || markerIdx - anchorIdx > 220) return null;
    const braceIdx = text.indexOf("{", anchorIdx);
    if (braceIdx < 0) return null;
    let lineNumber = 0;
    let lastNewline = -1;
    for (let i = 0; i < braceIdx; i++) {
      if (text.charCodeAt(i) === 10) {
        lineNumber += 1;
        lastNewline = i;
      }
    }
    return { lineNumber, columnNumber: braceIdx - lastNewline - 1 };
  }

  // issue #2399：抓取目标不能再按 asset 文件名前缀写死。Codex 26.930 把
  // AppServerRequestClient 从 `app-initial-*.js` 搬到了 `app-shared-*.js`，
  // 按前缀找资产必然 anchor_missing，模型白名单解锁在整条 app-server 路径上失效。
  // 加一项前缀只治当前这一版，下次改名又会失灵，所以改成**按内容找类定义**：
  // 遍历已加载的 app asset，谁包含 marker 文本谁就是目标，两代产物都能覆盖。
  // 排序只做「可能的更靠前」的启发式，不影响正确性；命中全靠文本匹配。
  const codexAppServerClientBundleHints = ["app-shared-", "app-initial-", "app-main-", "chatg"];
  const codexAppServerClientAssetFetchLimit = 24;

  function codexAppServerClientAssetCandidateUrls() {
    const urls = codexAppAssetCandidateUrls();
    const rank = (url) => {
      const name = (url.split("/").pop() || "").toLowerCase();
      const hint = codexAppServerClientBundleHints.findIndex((part) => name.includes(part));
      return hint < 0 ? codexAppServerClientBundleHints.length : hint;
    };
    // 按「像主 bundle」在前、体积（URL 长度做代理）大的在前排序，再截断。
    // 全量 fetch 所有 app asset 会重蹈 #1960 的覆辙，所以限制尝试数量。
    return urls
      .slice()
      .sort((left, right) => rank(left) - rank(right) || right.length - left.length)
      .slice(0, codexAppServerClientAssetFetchLimit);
  }

  // 返回 { url, location }；找不到返回 null。diagnostics 由调用方按命中/未命中归类。
  async function locateCodexAppServerClientInAssets() {
    const urls = codexAppServerClientAssetCandidateUrls();
    if (urls.length === 0) return { urls, hit: null };
    // 先走廉价的 asset loader（有 30s 失败冷却与重试上限），脚本里已经内联了
    // asset 名时能直接命中，省掉整轮 fetch；不可用就退回到全量文本匹配。
    const hinted = resolveCodexAppServerClientHintedUrl();
    const ordered = hinted
      ? [hinted, ...urls.filter((url) => url !== hinted)]
      : urls;
    for (const url of ordered) {
      try {
        const text = await fetch(url).then((response) => response.ok ? response.text() : "");
        if (!text) continue;
        const location = locateCodexAppServerClientBreakpoint(text);
        if (location) return { urls, hit: { url, location } };
      } catch {
        // 单个 asset 拉取失败不影响其余候选，继续下一个。
      }
    }
    return { urls, hit: null };
  }

  // 兼容旧路径：asset 名确实内联在入口脚本里时，用 loader 的缓存直接拿到 URL，
  // 不必为了它把所有 asset 拉一遍。找不到就返回空串，交给内容匹配兜底。
  function resolveCodexAppServerClientHintedUrl() {
    for (const prefix of codexAppServerClientBundleHints) {
      const url = codexAppAssetUrl(prefix);
      if (url) return url;
    }
    return "";
  }

    let codexAppServerClientCaptureStarted = false;
  async function installCodexAppServerClientCapture() {
    if (codexAppServerClientCaptureStarted || window.__alunixaXAppServerClientCapture) return;
    codexAppServerClientCaptureStarted = true;
    try {
      if (typeof fetch !== "function") return;
      const { urls, hit } = await locateCodexAppServerClientInAssets();
      if (!hit) {
        // 区分「一个候选资产都没有」和「有资产但没有类定义」：
        // 前者是页面还没加载完，后者才是 Codex 真的改了产物形状。
        sendCodexPlusDiagnostic("app_server_client_capture_locate_failed", {
          reason: urls.length === 0 ? "asset_url_missing" : "anchor_missing",
          candidateCount: urls.length,
        });
        return;
      }
      const urlRegex = hit.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      window.__alunixaXAppServerClientCapture = { urlRegex, ...hit.location };
      sendCodexPlusDiagnostic("app_server_client_capture_located", {
        lineNumber: hit.location.lineNumber,
        columnNumber: hit.location.columnNumber,
        asset: (hit.url.split("/").pop() || "").split("?")[0],
      });
    } catch (error) {
      codexAppServerClientCaptureStarted = false;
      sendCodexPlusDiagnostic("app_server_client_capture_locate_failed", {
        errorName: error?.name || "",
        errorMessage: error?.message || String(error),
      });
    }
  }

    function installCodexAppServerClientPrototypePatch() {
    if (window.__alunixaXAppServerClientPrototypePatchInstalled === codexAppServerModelRequestPatchVersion) return true;
    const wanted = alunixaXModelUnlockEnabled()
      || codexPluginMarketplacePatchEnabled()
      || (alunixaXBackendSettingsLoaded && codexRemoteSessionProviderPatchEnabled())
      || alunixaXSettings().serviceTierControls
      || alunixaXSettings().sessionDelete;
    if (!wanted) return false;
    const klass = window.__alunixaXAppServerClientClass;
    if (!klass || typeof klass !== "function" || !klass.prototype) return false;
    const proto = klass.prototype;
    if (proto.__alunixaXModelRequestPatch === codexAppServerModelRequestPatchVersion) {
      window.__alunixaXAppServerClientPrototypePatchInstalled = codexAppServerModelRequestPatchVersion;
      return true;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(proto, "sendRequest");
      if (!descriptor || descriptor.writable === false) {
        sendCodexPlusDiagnostic("app_server_client_prototype_patch_skipped", {});
        window.__alunixaXAppServerClientPrototypePatchInstalled = codexAppServerModelRequestPatchVersion;
        return false;
      }
    } catch {
      window.__alunixaXAppServerClientPrototypePatchInstalled = codexAppServerModelRequestPatchVersion;
      return false;
    }
    const originalSendRequest = proto.__alunixaXModelOriginalSendRequest || proto.sendRequest;
    proto.__alunixaXModelOriginalSendRequest = originalSendRequest;
    proto.__alunixaXThreadModels = proto.__alunixaXThreadModels || new Map();
    proto.sendRequest = async function alunixaXModelPatchedSendRequest(method, params, options) {
      const client = this;
      registerNativeHostClient(client);
      const managed = alunixaXPluginNativeInterceptClient(method, params, options,
        (nextOptions) => originalSendRequest.call(client, method, params, nextOptions), client.hostId);
      if (managed) return await managed;
      const requestMethod = appServerModelRequestMethod(String(method || ""), params);
      let providerRefreshFailed = false;
      if (codexRemoteSessionProviderRequestMethod(requestMethod)
          && codexRemoteSessionProviderPatchEnabled()
          && window.__codexSessionDeleteBridge) {
        const settingsLoaded = await loadBackendSettingsState(codexAppServerPreparationTimeoutMs);
        providerRefreshFailed = !settingsLoaded;
        if (providerRefreshFailed) {
          sendCodexPlusDiagnostic("remote_session_provider_refresh_failed", {});
        }
      } else if (codexRemoteSessionProviderRequestMethod(requestMethod)
          && codexRemoteSessionProviderOverrideEnabled()
          && !codexRemoteSessionTargetProvider()) {
        providerRefreshFailed = (await loadCodexModelCatalog())?.status === "failed";
      }
      const providerParams = providerRefreshFailed
        ? params
        : applyCodexRemoteSessionProviderOverride(requestMethod, params);
      const nextParams = applyCodexServiceTierRequestOnly(requestMethod, providerParams);
      const modelContextRefresh = await refreshCodexThreadModelBeforeTurn(
        client,
        originalSendRequest.bind(client),
        method,
        nextParams,
        options
      );
      const result = await originalSendRequest.call(client, method, nextParams, options);
      const threadState = codexThreadModelRequestState(requestMethod, nextParams, result);
      if (modelContextRefresh !== false && threadState.threadId && threadState.model
          && ["thread/start", "thread/resume", "turn/start"].includes(threadState.requestMethod)) {
        client.__alunixaXThreadModels.set(threadState.threadId, threadState.model);
      }
      if (!alunixaXModelUnlockEnabled() || !["list-models-for-host", "model/list"].includes(requestMethod)) return result;
      if (!alunixaXModelNames().length) await loadCodexModelCatalog();
      return patchAppServerModelResult(requestMethod, result, modelResponseHostId(params, client));
    };
    if (typeof proto.prewarmThreadStart === "function"
        && !proto.__alunixaXServiceTierOriginalPrewarmThreadStart) {
      const originalPrewarmThreadStart = proto.prewarmThreadStart;
      proto.__alunixaXServiceTierOriginalPrewarmThreadStart = originalPrewarmThreadStart;
      proto.prewarmThreadStart = async function alunixaXServiceTierPrewarmThreadStart(params, options) {
        const nextParams = applyCodexServiceTierRequestOnly("thread/start", params);
        return originalPrewarmThreadStart.call(this, nextParams, options);
      };
    }
    proto.__alunixaXModelRequestPatch = codexAppServerModelRequestPatchVersion;
    window.__alunixaXAppServerClientPrototypePatchInstalled = codexAppServerModelRequestPatchVersion;
    sendCodexPlusDiagnostic("app_server_client_prototype_patch_installed", {});
    return true;
  }

  const appServerModelRequestPatchMaxMisses = 8;
  const appServerModelRequestPatchMaxRetryDelayMs = 30000;
  let appServerModelRequestPatchMissCount = 0;
  let appServerModelRequestPatchDisabled = false;
  let appServerModelRequestPatchPromise = null;
  let appServerModelRequestPatchRetryTimer = 0;
  let appServerModelRequestPatchRetryDelayMs = 250;

  function scheduleAppServerModelRequestPatchRetry() {
    if (!codexRemoteSessionProviderPatchEnabled()) return;
    if (appServerModelRequestPatchRetryTimer) return;
    // issue #2256/#2255：固定 250ms 重试在 Codex 改 asset 命名后变成每秒 4 轮的全量
    // rescan（每轮 fetch 全部 app asset）。改为指数退避， miss 计满后由熔断停掉。
    appServerModelRequestPatchRetryTimer = window.setTimeout(() => {
      appServerModelRequestPatchRetryTimer = 0;
      installAppServerModelRequestPatch();
    }, appServerModelRequestPatchRetryDelayMs);
    appServerModelRequestPatchRetryDelayMs = Math.min(appServerModelRequestPatchRetryDelayMs * 4, appServerModelRequestPatchMaxRetryDelayMs);
  }

  function noteAppServerModelRequestPatchMiss(event, detail) {
    appServerModelRequestPatchMissCount += 1;
    // installAppServerModelRequestPatch() runs on every model-whitelist
    // refresh tick (~120ms). On Codex builds where the app-server module was
    // renamed/removed (e.g. 26.623+, issue #1324) this layer never succeeds
    // and would otherwise emit the same diagnostic on every tick forever.
    // Report the first miss so telemetry still captures the cause, then stay
    // quiet, and finally disable this layer once it is clearly unavailable.
    // This is a graceful fallback: the remaining whitelist layers (Statsig
    // config / React state / response JSON patch) keep injecting the custom
    // models on their own.
    if (appServerModelRequestPatchMissCount === 1) {
      sendCodexPlusDiagnostic(event, detail);
    }
    // issue #2256：provider 重试路径以前在这里提前 return，绕过下面的 maxMisses
    // 熔断，失败变成 250ms 无限重试（每轮全量 rescan 全部 app assets）。
    // 现在两个路径统一计数：先按 maxMisses 熔断，未熔断时再走指数退避重试。
    if (appServerModelRequestPatchMissCount >= appServerModelRequestPatchMaxMisses && !appServerModelRequestPatchDisabled) {
      appServerModelRequestPatchDisabled = true;
      clearTimeout(appServerModelRequestPatchRetryTimer);
      appServerModelRequestPatchRetryTimer = 0;
      sendCodexPlusDiagnostic("model_app_server_request_patch_skipped", {
        misses: appServerModelRequestPatchMissCount,
        lastEvent: event,
      });
      return;
    }
    if (!appServerModelRequestPatchDisabled) {
      scheduleAppServerModelRequestPatchRetry();
    }
  }

  function installAppServerModelRequestPatch() {
    if (window.__alunixaXAppServerModelRequestPatchInstalled === codexAppServerModelRequestPatchVersion) return;
    if (appServerModelRequestPatchDisabled) return;
    if (appServerModelRequestPatchPromise) return;
    const patch = async () => {
      try {
        const { modules, candidates, sources, discovery } = await loadAppServerRequestCandidates();
        if (modules.length === 0) {
          noteAppServerModelRequestPatchMiss("model_app_server_request_patch_skipped", {
            reason: "app_server_request_assets_missing",
          });
          return;
        }
        let patchedCount = 0;
        for (const candidate of candidates) {
          if (patchAppServerModelRequestClient(candidate)) patchedCount += 1;
        }
        if (patchedCount > 0) {
          clearTimeout(appServerModelRequestPatchRetryTimer);
          appServerModelRequestPatchRetryTimer = 0;
          appServerModelRequestPatchMissCount = 0;
          appServerModelRequestPatchRetryDelayMs = 250;
          window.__alunixaXAppServerModelRequestPatchInstalled = codexAppServerModelRequestPatchVersion;
          sendCodexPlusDiagnostic("model_app_server_request_patch_installed", {
            moduleCount: modules.length,
            candidateCount: candidates.length,
            patchedCount,
            sources,
            discovery,
          });
        } else {
          noteAppServerModelRequestPatchMiss("model_app_server_request_patch_not_found", {
            moduleCount: modules.length,
            candidateCount: candidates.length,
            sources,
            discovery,
          });
        }
      } catch (error) {
        noteAppServerModelRequestPatchMiss("model_app_server_request_patch_failed", {
          errorName: error?.name || "",
          errorMessage: error?.message || String(error),
        });
      }
    };
    appServerModelRequestPatchPromise = patch().finally(() => {
      appServerModelRequestPatchPromise = null;
    });
    void appServerModelRequestPatchPromise;
  }

  function ensureCodexModelWhitelistInstalls() {
    if (alunixaXModelUnlockEnabled()
        || codexPluginMarketplacePatchEnabled()
        || (alunixaXBackendSettingsLoaded && codexRemoteSessionProviderPatchEnabled())
        || alunixaXSettings().serviceTierControls
        || alunixaXSettings().sessionDelete) {
      installAppServerModelRequestPatch();
      void installCodexAppServerClientCapture().catch(() => {});
    }
    void installDictationSupportPatch();
    if (!alunixaXModelUnlockEnabled()) return;
    installModelJsonResponsePatch();
    patchAppServerModelMessages();
  }

  function runCodexModelWhitelistRefreshPass() {
    if (!alunixaXModelUnlockEnabled() || !alunixaXModelNames().length) return false;
    try {
      patchStatsigModelWhitelist();
      installAppServerModelRequestPatch();
    } catch (error) {
      window.__alunixaXModelPatchFailures = window.__alunixaXModelPatchFailures || [];
      window.__alunixaXModelPatchFailures.push(String(error?.stack || error));
    }
    return false;
  }

  function scheduleCodexModelWhitelistRefresh(durationMs = 2500) {
    if (!alunixaXModelUnlockEnabled()) return;
    codexModelWhitelistRefreshUntil = Math.max(codexModelWhitelistRefreshUntil, Date.now() + durationMs);
    if (codexModelWhitelistRefreshTimer) return;
    sendCodexPlusDiagnostic("model_whitelist_refresh_scheduled", { durationMs });
    const tick = () => {
      codexModelWhitelistRefreshTimer = 0;
      runCodexModelWhitelistRefreshPass();
      if (Date.now() < codexModelWhitelistRefreshUntil) {
        codexModelWhitelistRefreshTimer = window.setTimeout(tick, 120);
      }
    };
    tick();
  }

  function refreshCodexModelWhitelistFromScan(mutations) {
    ensureCodexModelWhitelistInstalls();
    if (!alunixaXModelNames().length) {
      loadCodexModelCatalog();
      return;
    }
    runCodexModelWhitelistRefreshPass();
  }

  function threadIdVariants(sessionId) {
    if (typeof sessionId !== "string" || !sessionId.trim()) return [];
    const id = sessionId.trim();
    const bareId = id.startsWith("local:") ? id.slice("local:".length) : id;
    return uniqueValues([id, bareId, `local:${bareId}`]);
  }

  function sessionKey(sessionId) {
    const variants = threadIdVariants(sessionId);
    const bareId = variants.find((id) => !id.startsWith("local:"));
    return bareId || variants[0] || "";
  }

  function uuidV7TimestampMs(sessionId) {
    const id = sessionKey(sessionId).replaceAll("-", "");
    if (!/^[0-9a-fA-F]{12}/.test(id)) return 0;
    const timestamp = Number.parseInt(id.slice(0, 12), 16);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  function normalizeWorkspacePath(path) {
    const normalized = String(path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized || String(path || "").trim();
  }

  function sameWorkspacePath(left, right) {
    const leftPath = normalizeWorkspacePath(left);
    const rightPath = normalizeWorkspacePath(right);
    return !!leftPath && !!rightPath && leftPath === rightPath;
  }

  function displayProjectName(path) {
    const trimmed = String(path || "").replace(/\/+$/, "");
    return trimmed.split(/[\\/]+/).filter(Boolean).pop() || trimmed || "未命名项目";
  }

  function normalizeProjectLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function projectsSection() {
    return document.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
  }

  async function refreshRecentConversationsForHost() {
    try {
      const signals = await loadOptionalCodexAppModule("app-server-manager-signals-");
      const sendRequest = Object.values(signals || {}).find((candidate) => {
        if (typeof candidate !== "function") return false;
        try {
          const source = Function.prototype.toString.call(candidate).replace(/\s+/g, "");
          return /^function[$\w]+\(e,t\)\{return[$\w]+\.sendRequest\(e,t\)\}$/.test(source);
        } catch {
          return false;
        }
      });
      if (typeof sendRequest !== "function") return false;
      await sendRequest("refresh-recent-conversations-for-host", { hostId: "local", sortKey: "updated_at" });
      return true;
    } catch (error) {
      window.__codexRecentConversationRefreshFailures = window.__codexRecentConversationRefreshFailures || [];
      window.__codexRecentConversationRefreshFailures.push(String(error?.stack || error));
      return false;
    }
  }

  /**
   * 同一时间最多显示几条 toast。
   *
   * 原来是「新 toast 顶掉旧 toast」的单例语义。拓展也能弹 toast 之后，单例会让
   * 第三方提示把「删除成功（可撤销）」这类关键反馈挤掉，所以改成有界队列：超出
   * 上限时挤掉最旧的一条，而不是最关键的当前一条。
   */
  const alunixaXToastLimit = 3;
  const alunixaXToastLifetimeMs = 10000;
  const alunixaXToastGapPx = 48;

  /**
   * 按当前 DOM 顺序重排所有提示的纵向位置。
   *
   * 必须在每次「新增」和「移除」之后都调用：位置只在插入那一刻算的话，一旦有
   * 人被挤掉或超时消失，剩下几条会停在自己的旧层号上，出现空档和重叠。
   */
  function layoutCodexPlusToasts() {
    document.querySelectorAll(".codex-delete-toast").forEach((node, index) => {
      node.style.bottom = `${18 + index * alunixaXToastGapPx}px`;
    });
  }

  /** 移除一条提示并立刻重排剩下的。 */
  function dismissCodexPlusToast(toast) {
    toast.remove();
    layoutCodexPlusToasts();
  }

  /**
   * 显示一条提示。
   *
   * `options.type` 取 info / success / warn / error，对应 styles 里的四条配色；
   * 不传则保持原先的默认外观。`options.undoToken` 会追加「撤销」按钮——这是
   * 内部删除流程用的，拓展一般用不到。
   */
  function showToast(message, options = {}) {
    // 兼容旧调用点：老签名是 showToast(message, undoToken)。第二个参数传字符串
    // 时按 undoToken 处理，传对象时按新签名处理。
    const settings = typeof options === "string" ? { undoToken: options } : (options || {});
    const undoToken = settings.undoToken;
    const type = typeof settings.type === "string" ? settings.type : "";
    const live = document.querySelectorAll(".codex-delete-toast");
    // 队列满时挤掉最旧的（DOM 顺序即插入顺序）。用 dismiss 而不是裸 remove，
    // 它会顺带重排剩下几条的位置。
    if (live.length >= alunixaXToastLimit) {
      for (let index = 0; index <= live.length - alunixaXToastLimit; index += 1) {
        dismissCodexPlusToast(live[index]);
      }
    }
    const toast = document.createElement("div");
    toast.className = "codex-delete-toast";
    if (type) toast.dataset.toastType = type;
    toast.textContent = message;
    if (undoToken) {
      const undo = document.createElement("button");
      undo.textContent = "撤销";
      undo.addEventListener("click", async () => {
        const result = await postJson("/undo", { undo_token: undoToken });
        toast.textContent = result.message || "撤销完成";
        if (result.status === "undone") {
          const refreshed = await refreshRecentConversationsForHost();
          if (!refreshed) window.location.reload();
        }
        setTimeout(() => dismissCodexPlusToast(toast), 5000);
      });
      toast.appendChild(undo);
    }
    document.body.appendChild(toast);
    // append 之后统一重排：此时这条才进入 DOM，索引才是它真实的层号。
    layoutCodexPlusToasts();
    setTimeout(() => dismissCodexPlusToast(toast), alunixaXToastLifetimeMs);
    return () => dismissCodexPlusToast(toast);
  }

  function shareBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function shareTextFromElement(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.("button, textarea, input, select, [contenteditable='true'], .codex-delete-toast, .alunixa-x-modal-overlay, .alunixa-x-page-overlay, .codex-session-share-button").forEach((node) => node.remove());
    return String(clone.innerText || clone.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function sessionShareMarkdown() {
    const ref = currentSessionRef();
    if (!ref.session_id) return { ref, markdown: "" };
    const root = conversationRoot();
    if (!root) return { ref, markdown: "" };
    const authored = Array.from(root.querySelectorAll("[data-message-author-role]"));
    const knownTurns = Array.from(root.querySelectorAll([
      '[data-testid="conversation-turn"]',
      '[data-testid*="message"]',
      '[data-message-content]',
      'main .prose',
      '[class*="message-bubble"]',
      '[class*="MessageBubble"]',
      '[class*="user-message"]',
      '[class*="UserMessage"]',
    ].join(",")));
    const turns = authored.length ? authored : knownTurns;
    const seen = new Set();
    const messages = turns.map((node) => {
      if (!(node instanceof HTMLElement) || seen.has(node)) return "";
      if (node.parentElement?.closest?.('[data-message-author-role], [data-testid="conversation-turn"]')) return "";
      seen.add(node);
      const text = shareTextFromElement(node);
      if (!text) return "";
      const role = String(node.getAttribute("data-message-author-role") || "").toLowerCase();
      const label = role === "user" ? "用户" : role === "assistant" ? "助手" : "消息";
      return { role: role === "user" || role === "assistant" ? role : "message", label, text };
    }).filter(Boolean);
    const title = String(ref.title || document.querySelector(selectors.threadTitle)?.textContent || "未命名会话").replace(/\s+/g, " ").trim();
    let content = messages.map((message) => `### ${message.label}\n\n${message.text}`).join("\n\n");
    if (!content) {
      const fallback = root.cloneNode(true);
      fallback.querySelectorAll?.([
        ".composer-footer", ".composer-surface-chrome", "form", "header", "nav", "aside",
        "button", "textarea", "input", "select", "[contenteditable='true']",
        ".codex-delete-toast", ".alunixa-x-modal-overlay", ".alunixa-x-page-overlay",
        ".codex-session-share-button",
      ].join(",")).forEach((node) => node.remove());
      content = String(fallback.innerText || fallback.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (content) messages.push({ role: "message", label: "会话", text: content });
    }
    const markdown = `# ${title || "未命名会话"}\n\n- 会话 ID：\`${ref.session_id}\`\n\n${content}`.slice(0, alunixaXShareMaxCharacters);
    return {
      ref,
      markdown: content ? markdown : "",
      session: content ? {
        version: 1,
        kind: "codex-session",
        session_id: ref.session_id,
        title: title || "未命名会话",
        messages: messages.map(({ role, text }) => ({ role, text })),
      } : null,
    };
  }

  async function encryptSessionShare(value) {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
    const exportedKey = await crypto.subtle.exportKey("raw", key);
    return {
      key: shareBase64Url(new Uint8Array(exportedKey)),
      encrypted: {
        v: 1,
        iv: shareBase64Url(iv),
        ciphertext: shareBase64Url(new Uint8Array(ciphertext)),
      },
    };
  }

  async function createSessionShare() {
    const { ref, markdown, session } = sessionShareMarkdown();
    if (!ref.session_id) {
      showToast("当前页面还没有可分享的会话", null);
      return;
    }
    if (!markdown || !session) {
      showToast("当前会话还没有可分享的消息", null);
      return;
    }
    const shareWindow = window.open("about:blank", "_blank");
    const button = document.querySelector(`.${sessionShareButtonClass}`);
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "正在创建…";
    }
    try {
      let shareDocument = session;
      const nativeSession = await postJson("/session/export", {
        session_id: ref.session_id,
        title: session.title,
      });
      if (nativeSession?.status !== "ok" || nativeSession.kind !== "codex-rollout" || typeof nativeSession.content !== "string") {
        throw new Error(nativeSession?.message || "无法读取完整 Codex 会话文件");
      }
      shareDocument = { ...nativeSession, title: session.title };
      const encrypted = await encryptSessionShare(JSON.stringify(shareDocument));
      const payload = { ttl: 604800, encrypted: encrypted.encrypted };
      let result;
      let baseUrl = alunixaXShareBaseUrl;
      try {
        result = await postJson("/share/create", payload);
        if (result?.id) {
          baseUrl = alunixaXShareBaseUrl;
        } else if (result?.status !== "failed") {
          throw new Error(result?.message || "创建分享失败");
        }
      } catch (_) {
        result = null;
      }
      if (!result?.id) {
        let response;
        try {
          response = await fetch(`${baseUrl}/api/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        } catch (_) {
          baseUrl = alunixaXShareFallbackBaseUrl;
          response = await fetch(`${baseUrl}/api/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        }
        result = await response.json().catch(() => ({}));
        if (!response.ok || !result.id) throw new Error(result.error || `创建分享失败（HTTP ${response.status}）`);
      }
      const shareUrl = `${baseUrl}/?s=${encodeURIComponent(result.id)}#k=${encrypted.key}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch (_) {
        const input = document.createElement("input");
        input.value = shareUrl;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      showToast("会话分享链接已复制", null);
      if (shareWindow && !shareWindow.closed) shareWindow.location.href = shareUrl;
    } catch (error) {
      if (shareWindow && !shareWindow.closed) shareWindow.close();
      showToast(error?.message || "创建分享失败，请稍后重试", null);
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = "分享会话";
      }
    }
  }

  function sessionSharePlacement() {
    // 会话操作锚点唯一时才挂载，不能把右侧审查/浏览器的 header 当作会话栏。
    const headerSelector = 'header, [data-app-shell-header-edge-scroll], [class*="_Header_"]';
    const anchors = Array.from(document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"]'))
      .filter((node) => visibleElement(node) && !node.closest('[data-alunixa-x-ext]'));
    if (anchors.length !== 1) return null;
    const header = anchors[0].closest(headerSelector);
    if (!(header instanceof HTMLElement) || !visibleElement(header)) return null;
    const nativeShare = Array.from(header.querySelectorAll('button[aria-label="Share"], button[aria-label="分享"], button[aria-label*="Share"], button[aria-label*="分享"]'))
      .find((node) => visibleElement(node) && !node.closest('[data-alunixa-x-ext]') && !node.classList.contains(sessionShareButtonClass) && node.closest(headerSelector) === header);
    const nativeGroup = nativeShare?.closest?.(".ms-auto");
    if (nativeGroup && header.contains(nativeGroup)) return nativeGroup;
    const groups = Array.from(header.querySelectorAll(".ms-auto"))
      .filter((node) => visibleElement(node) && !node.closest('[data-alunixa-x-ext]') && node.closest(headerSelector) === header);
    return groups.length === 1 ? groups[0] : null;
  }

  function installSessionShareButton() {
    const existing = document.querySelectorAll(`.${sessionShareButtonClass}`);
    const ref = currentSessionRef();
    const actionGroup = alunixaXSettings().sessionShare && ref.session_id ? sessionSharePlacement() : null;
    if (!(actionGroup instanceof HTMLElement)) {
      existing.forEach((button) => button.remove());
      return;
    }
    let button = existing[0];
    existing.forEach((node) => { if (node !== button) node.remove(); });
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = `${sessionShareButtonClass} ${headerContextButtonClass}`;
      button.textContent = "分享会话";
      button.setAttribute("aria-label", "分享当前会话");
      button.setAttribute("data-alunixa-x-ext", "session-share");
      button.dataset.codexSessionShareVersion = sessionShareButtonVersion;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void createSessionShare();
      }, true);
    }
    button.setAttribute("data-alunixa-x-ext", "session-share");
    button.style.position = "static";
    button.style.pointerEvents = "auto";
    button.style.webkitAppRegion = "no-drag";
    button.style.marginLeft = "";
    // 宿主重建时才搬动，避免每轮扫描再次触发 DOM mutation（issue #1960）。
    if (button.parentElement !== actionGroup) actionGroup.appendChild(button);
  }

  function sessionImportMarkdown(session) {
    const title = String(session?.title || "未命名会话").trim() || "未命名会话";
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const body = messages.map((message) => {
      const role = message?.role === "user" ? "用户" : message?.role === "assistant" ? "助手" : "消息";
      const text = String(message?.text || "").trim();
      return text ? `### ${role}\n\n${text}` : "";
    }).filter(Boolean).join("\n\n");
    return `# ${title}\n\n${body}`.trim();
  }

  function importSharedSessionIntoNewChat(session) {
    if (session?.kind === "codex-rollout" && typeof session.content === "string") {
      void postJson("/session/import", session).then((result) => {
        if (result?.status !== "ok") {
          showToast(result?.message || "原生会话导入失败", null);
          return;
        }
        void refreshRecentConversationsForHost();
        showToast("已导入完整 Codex 会话", null);
      }).catch((error) => showToast(error?.message || "原生会话导入失败", null));
      return;
    }
    const markdown = sessionImportMarkdown(session);
    if (!markdown) {
      showToast("分享内容为空，无法导入", null);
      return;
    }
    const newChat = Array.from(document.querySelectorAll("button")).find((button) => {
      if (!visibleElement(button) || isExtensionUiNode(button)) return false;
      const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
      const label = button.getAttribute("aria-label") || "";
      return /^(新对话|New chat)$/i.test(text) || /^(新对话|New chat)$/i.test(label);
    });
    if (newChat instanceof HTMLElement) newChat.click();
    const deadline = Date.now() + 5000;
    const fill = () => {
      const editor = Array.from(document.querySelectorAll("textarea, [contenteditable='true']"))
        .filter((node) => visibleElement(node))
        .at(-1);
      if (!(editor instanceof HTMLElement)) {
        if (Date.now() < deadline) window.setTimeout(fill, 100);
        else showToast("无法找到 Codex 输入框，请手动打开新对话后重试", null);
        return;
      }
      editor.focus();
      if (editor instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(editor, markdown);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        document.execCommand("insertText", false, markdown);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: markdown }));
      }
      showToast("已导入完整会话内容，请发送以继续", null);
    };
    window.setTimeout(fill, newChat ? 350 : 0);
  }

  function installSessionShareImportListener() {
    window.removeEventListener("message", window.__codexSessionShareImportHandler);
    window.__codexSessionShareImportHandler = (event) => {
      if (!/^(https:\/\/share\.codexpp\.cc|https:\/\/codexpp-share\.pages\.dev)$/.test(event.origin || "") || event.data?.type !== "codexpp-import-session") return;
      const session = event.data?.session;
      if (!session || !["codex-session", "codex-rollout"].includes(session.kind)) return;
      if (session.kind === "codex-session" && !Array.isArray(session.messages)) return;
      if (session.kind === "codex-rollout" && typeof session.content !== "string") return;
      importSharedSessionIntoNewChat(session);
    };
    window.addEventListener("message", window.__codexSessionShareImportHandler);
  }

  function visibleElement(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect?.();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function normalizedElementText(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function confirmDelete(title, hostId = "local") {
    document.querySelectorAll(".codex-delete-confirm-overlay").forEach((node) => node.remove());
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "codex-delete-confirm-overlay";
      overlay.innerHTML = `
        <div class="codex-delete-confirm-content" role="dialog" aria-modal="true" aria-label="删除会话">
          <div class="codex-delete-confirm-title">删除会话</div>
          <div class="codex-delete-confirm-message">删除“${escapeHtml(title)}”？${hostId !== "local" ? "这将永久删除远端任务及其子任务，无法撤销。" : ""}</div>
          <div class="codex-delete-confirm-actions">
            <button type="button" data-codex-delete-cancel="true">取消</button>
            <button type="button" data-codex-delete-confirm="true">删除</button>
          </div>
        </div>
      `;
      const finish = (value, event) => {
        event?.preventDefault();
        event?.stopPropagation();
        event?.target?.blur?.();
        overlay.remove();
        resolve(value);
      };
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-codex-delete-cancel]")) {
          finish(false, event);
          return;
        }
        if (event.target.closest("[data-codex-delete-confirm]")) {
          finish(true, event);
        }
      }, true);
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") finish(false, event);
      }, true);
      document.body.appendChild(overlay);
      overlay.querySelector("[data-codex-delete-cancel]")?.focus();
    });
  }

  function rowHref(row) {
    return row.getAttribute("href") || row.querySelector("a")?.getAttribute("href") || "";
  }

  function isCurrentSessionRow(row, ref) {
    const currentId = locationThreadId();
    const currentIdentity = normalizedCodexThreadUuid(currentId) || currentId;
    const rowIdentity = normalizedCodexThreadUuid(ref.session_id) || ref.session_id;
    if (currentIdentity && currentIdentity !== rowIdentity) return false;
    // 新版原生 sidebarThreadRow 明确提供 active；false 不能被相同 pathname 覆盖。
    const nativeActive = row.getAttribute("data-app-action-sidebar-thread-active");
    if (nativeActive === "true" || nativeActive === "false") return nativeActive === "true";
    if (row.getAttribute("aria-current") === "page" || row.getAttribute("aria-current") === "true") return true;
    const href = rowHref(row);
    if (href) {
      try {
        const url = new URL(href, window.location.href);
        if (currentIdentity && url.href === window.location.href) return true;
      } catch {}
    }
    return !!currentIdentity && currentIdentity === rowIdentity;
  }

  function releaseDeleteFocus(row, button) {
    button.blur();
    if (row.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function sameDeletedSessionRef(left, right) {
    return !!left?.session_id && !!left?.host_id && left.session_id === right?.session_id && left.host_id === right?.host_id;
  }

  function removeDeletedRow(row, button, ref, requestContext) {
    // 删除响应期间，React 可能复用或替换 sidebar 行；不能删除其新身份的 DOM。
    if (!row.isConnected || !sameDeletedSessionRef(sessionRefFromRow(row), ref)) return null;
    releaseDeleteFocus(row, button);
    const activeRefs = sessionRows().map((candidate) => ({ row: candidate, ref: sessionRefFromRow(candidate) }))
      .filter((candidate) => isCurrentSessionRow(candidate.row, candidate.ref)).map((candidate) => candidate.ref);
    const shouldLeave = requestContext?.wasCurrent && requestContext.locationHref === window.location.href
      && activeRefs.length > 0 && activeRefs.every((active) => sameDeletedSessionRef(active, ref));
    let navigated = false;
    if (shouldLeave) {
      // 已审 native 的 New chat 按钮以 aria-label/newChatMessage 调用 onStartChat。
      // 只走唯一可见的原生 sidebar 控件；不猜内部路由，也不强制 reload。
      const navigation = Array.from(document.querySelectorAll("aside.app-shell-left-panel button, nav[data-app-navigation-rail] button"))
        .filter((candidate) => visibleElement(candidate) && !candidate.disabled && !isExtensionUiNode(candidate)
          && candidate.closest("aside.app-shell-left-panel, nav[data-app-navigation-rail]")
          && /^(新聊天|新对话|New chat|New thread)$/i.test((candidate.getAttribute("aria-label") || candidate.textContent || "").trim()));
      if (navigation.length === 1) {
        navigation[0].click();
        navigated = true;
      }
    }
    // 原生导航也可能同步重建行，移除前再确认一次，保护被复用的节点。
    if (row.isConnected && sameDeletedSessionRef(sessionRefFromRow(row), ref)) row.remove();
    return shouldLeave && !navigated ? "会话已删除，请点击新聊天继续" : null;
  }

  function updateDeleteButtonOffsets() {
    sessionRows().forEach((row) => {
      const hasArchiveConfirm = Array.from(row.querySelectorAll("button")).some((button) => {
        const rect = button.getBoundingClientRect();
        const label = button.getAttribute("aria-label") || "";
        const text = (button.textContent || "").trim();
        if (button.classList.contains(buttonClass) || button.classList.contains(exportButtonClass) || label === "归档对话" || label === "置顶对话") return false;
        return text === "确认" || (text.length > 0 && rect.width > 0 && rect.width <= 36 && rect.x > row.getBoundingClientRect().right - 50);
      });
      row.classList.toggle("codex-archive-confirm-visible", hasArchiveConfirm);
    });
  }

  function openDeleteConfirmForRow(row, button, ref, event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    releaseDeleteFocus(row, button);
    if (!ref.host_id) {
      const evidence = sessionHostEvidenceFromRow(row, ref.session_id);
      sendCodexPlusDiagnostic("delete_session_host_unresolved", {
        reason: evidence.reason, hostCount: evidence.hostCount, matchingMetadata: evidence.matchingMetadata,
        nativeHostAttributePresent: !!row.getAttribute("data-app-action-sidebar-thread-host-id"),
      });
      showToast("无法确定会话主机归属，请使用 Codex 原生会话管理", null);
      return;
    }
    ref = { session_id: ref.session_id, title: ref.title, host_id: ref.host_id };
    return confirmDelete(ref.title, ref.host_id).then(async (confirmed) => {
      if (!confirmed) return;
      if (!row.isConnected || !sameDeletedSessionRef(sessionRefFromRow(row), ref)) {
        showToast("会话已变化，请重新选择后删除", null);
        return;
      }
      releaseDeleteFocus(row, button);
      const requestContext = { wasCurrent: isCurrentSessionRow(row, ref), locationHref: window.location.href };
      const result = await postJson("/delete", ref);
      if (result.status === "server_deleted" || result.status === "local_deleted") {
        if (result.session_id && result.session_id !== ref.session_id) {
          showToast("删除结果与请求会话不一致，未更新界面", null);
          return;
        }
        // 远端由原生同主机 thread/deleted 通知更新，不能移除可能已重用的本地 DOM。
        let navigationNotice = null;
        if (ref.host_id === "local") {
          navigationNotice = removeDeletedRow(row, button, ref, requestContext);
          await refreshRecentConversationsForHost();
        }
        showToast(navigationNotice || result.message || "删除成功", result.undo_token);
      } else {
        showToast(result.message || "删除失败", null);
      }
    });
  }

  async function exportMarkdown(ref) {
    const result = await postJson("/export-markdown", ref);
    if (result.status === "exported" && result.filename && typeof result.markdown === "string") {
      const saveResult = await saveMarkdown(result.filename, result.markdown);
      if (saveResult?.status === "cancelled") {
        showToast(saveResult.message || "导出已取消", null);
      } else {
        showToast(result.message || "导出成功", null);
      }
      return;
    }
    showToast(result.message || "导出失败", null);
  }

  function installDeleteButtonEventDelegation() {
    document.removeEventListener("click", window.__codexSessionDeleteDocumentDeleteHandler, true);
    const handler = (event) => {
      const button = event.target?.closest?.(`.${buttonClass}`);
      const row = button?.closest?.("[data-app-action-sidebar-thread-id]");
      if (!button || !row) return;
      const ref = sessionRefFromRow(row);
      if (!ref.session_id) {
        const placeholderId = row.getAttribute("data-app-action-sidebar-thread-id");
        if (isClientNewThreadId(placeholderId)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          showToast("会话仍在同步，请稍后重试", null);
        }
        return;
      }
      openDeleteConfirmForRow(row, button, ref, event);
    };
    window.__codexSessionDeleteDocumentDeleteHandler = handler;
    document.addEventListener("click", handler, true);
  }

  function actionGroupFromRow(row) {
    return row.querySelector(`.${actionGroupClass}`);
  }

  function nativeActionButtonsFromRow(row) {
    return [...row.querySelectorAll('button,[role="button"],a')]
      .filter((node) => !node.closest(`.${actionGroupClass}`))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 12 || rect.height < 12) return false;
        const label = [
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.dataset?.state,
          node.textContent,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (/(pin|archive|置顶|归档)/i.test(label)) return true;
        const rowRect = row.getBoundingClientRect();
        return rect.left > rowRect.left + rowRect.width * 0.68;
      });
  }

  function syncActionGroupLayout(row, group) {
    if (!row || !group) return;
    if (group.dataset.codexActionLayoutStable === "true") return;
    const rowRect = row.getBoundingClientRect();
    const nativeButtons = nativeActionButtonsFromRow(row);
    const leftmostNative = nativeButtons
      .map((button) => button.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.left - b.left)[0];
    const gap = 8;
    const fallbackRight = 28;
    const right = leftmostNative
      ? Math.max(fallbackRight, Math.round(rowRect.right - leftmostNative.left + gap))
      : fallbackRight;
    const groupWidth = Math.ceil(group.getBoundingClientRect().width || 96);
    const titleNode = row.querySelector(selectors.threadTitle);
    const titleRect = titleNode?.getBoundingClientRect();
    const titleLeft = titleRect?.left || rowRect.left + 40;
    let effectiveRight = right;
    group.style.setProperty("--codex-session-actions-right", `${effectiveRight}px`);
    if (leftmostNative) {
      const nativeStyle = getComputedStyle(nativeButtons.find((button) => button.getBoundingClientRect().left === leftmostNative.left) || nativeButtons[0]);
      group.style.setProperty("--codex-session-action-color", nativeStyle.color);
      group.style.setProperty("--codex-session-action-hover-color", nativeStyle.color);
      group.style.setProperty("--codex-session-action-hover-background", nativeStyle.backgroundColor);
      const groupRight = group.getBoundingClientRect().right;
      const targetRight = leftmostNative.left - 2;
      if (Number.isFinite(groupRight) && Number.isFinite(targetRight)) {
        const renderScale = row.offsetWidth > 0 ? rowRect.width / row.offsetWidth : 1;
        effectiveRight = Math.max(0, right + (groupRight - targetRight) / Math.max(0.1, renderScale));
        group.style.setProperty("--codex-session-actions-right", `${effectiveRight}px`);
      }
    }
    const renderScale = row.offsetWidth > 0 ? rowRect.width / row.offsetWidth : 1;
    const finalGroupLeft = group.getBoundingClientRect().left;
    const titleMaxWidth = Math.max(24, (finalGroupLeft - titleLeft - 8) / Math.max(0.1, renderScale));
    row.style.setProperty("--codex-session-title-mask", `${effectiveRight + groupWidth + 12}px`);
    row.style.setProperty("--codex-session-title-max-width", `${titleMaxWidth}px`);
    group.dataset.codexActionLayoutStable = "true";
  }
  function syncActionGroupsLayout() {
    sessionRows().forEach((row) => {
      const group = actionGroupFromRow(row);
      if (group) syncActionGroupLayout(row, group);
    });
  }

  function removeActionGroups(row) {
    document.querySelectorAll(`.${moreMenuClass}`).forEach((menu) => {
      if (menu.__codexSessionMoreRow === row) menu.remove();
    });
    row.querySelectorAll(`.${actionGroupClass}`).forEach((group) => group.remove());
  }

  function stopActionButtonEvent(row, button, event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    releaseDeleteFocus(row, button);
  }

  function installActionButtonEvents(row, button, onActivate) {
    ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => stopActionButtonEvent(row, button, event), true);
    });
    button.addEventListener("pointerenter", () => showActionButtonTooltip(button));
    button.addEventListener("pointerleave", hideActionButtonTooltip);
    button.addEventListener("focus", () => showActionButtonTooltip(button));
    button.addEventListener("blur", hideActionButtonTooltip);
    button.addEventListener("click", (event) => {
      hideActionButtonTooltip();
      onActivate(event);
    }, true);
  }

  function installMoreButtonEvents(row, button, onActivate) {
    ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => stopActionButtonEvent(row, button, event), true);
    });
    button.addEventListener("pointerup", onActivate, true);
    button.addEventListener("click", (event) => {
      hideActionButtonTooltip();
      stopActionButtonEvent(row, button, event);
    }, true);
  }

  function hideActionButtonTooltip() {
    document.querySelectorAll(`.${actionTooltipClass}`).forEach((node) => node.remove());
  }

  function closeSessionMoreMenus(exceptMenu = null) {
    document.querySelectorAll(`.${moreMenuClass}`).forEach((menu) => {
      if (menu !== exceptMenu) {
        menu.hidden = true;
        menu.closest?.("[data-codex-delete-row]")?.classList.remove("codex-session-more-open");
        menu.__codexSessionMoreRow?.classList?.remove("codex-session-more-open");
      }
    });
  }

  function toggleSessionMoreMenu(row, button, menu) {
    const nextHidden = !menu.hidden;
    closeSessionMoreMenus(menu);
    menu.hidden = nextHidden;
    row.classList.toggle("codex-session-more-open", !menu.hidden);
    button.setAttribute("aria-expanded", String(!menu.hidden));
  }

  function installSessionMoreMenuAutoClose(row, menu) {
    const group = menu.__codexSessionMoreGroup || menu.closest?.(`.${actionGroupClass}`);
    const closeIfOutside = () => {
      window.setTimeout(() => {
        if (menu.hidden) return;
        const active = document.activeElement;
        if (group?.matches?.(":hover") || menu.matches?.(":hover") || menu.contains(active)) return;
        menu.hidden = true;
        row.classList.remove("codex-session-more-open");
        group?.querySelector?.(`.${moreButtonClass}`)?.setAttribute("aria-expanded", "false");
      }, 80);
    };
    group?.addEventListener("pointerleave", closeIfOutside, true);
    menu.addEventListener("pointerleave", closeIfOutside, true);
    menu.addEventListener("focusout", closeIfOutside, true);
  }

  function updateSessionMoreMenuDirection(button, menu) {
    menu.classList.remove("codex-session-more-menu-open-up");
    const buttonRect = button.getBoundingClientRect();
    const estimatedMenuHeight = Math.max(80, menu.getBoundingClientRect().height || 76);
    if (buttonRect.bottom + 30 + estimatedMenuHeight > window.innerHeight - 8) {
      menu.classList.add("codex-session-more-menu-open-up");
    }
  }

  function positionSessionMoreMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const menuWidth = Math.max(104, menu.getBoundingClientRect().width || 104);
    const left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth));
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, rect.bottom + 4)}px`;
  }

  function createSessionMoreMenuItem(label, icon, onActivate) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "codex-session-more-menu-item";
    item.innerHTML = `<span class="codex-session-more-menu-icon">${icon}</span><span>${label}</span>`;
    item.addEventListener("click", onActivate, true);
    return item;
  }

  function showActionButtonTooltip(button) {
    const label = button.dataset.codexActionLabel || button.getAttribute("aria-label") || "";
    if (!label) return;
    hideActionButtonTooltip();
    const tooltip = document.createElement("div");
    tooltip.className = actionTooltipClass;
    tooltip.textContent = label;
    document.body.appendChild(tooltip);
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(
      window.innerWidth - tooltipRect.width - 8,
      Math.max(8, buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2),
    );
    const top = Math.min(
      window.innerHeight - tooltipRect.height - 8,
      buttonRect.bottom + gap,
    );
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function refreshActionButton(originalButton, row, onActivate) {
    if (!originalButton.isConnected) return;
    const replacement = originalButton.cloneNode(true);
    installActionButtonEvents(row, replacement, onActivate);
    originalButton.replaceWith(replacement);
    return replacement;
  }

  function configureActionButton(button, label, icon) {
    button.setAttribute("aria-label", label);
    button.dataset.codexActionLabel = label;
    button.removeAttribute("title");
    button.textContent = icon;
  }

  function trashIconSvg() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M19 6l-1 14H6L5 6"></path>
        <path d="M10 11v5"></path>
        <path d="M14 11v5"></path>
      </svg>
    `;
  }

  function configureSvgActionButton(button, label, svg) {
    button.setAttribute("aria-label", label);
    button.dataset.codexActionLabel = label;
    button.removeAttribute("title");
    button.innerHTML = svg;
  }

  function attachButton(row) {
    const settings = alunixaXSettings();
    const sessionMenuEnabled = alunixaXBackendSettings.enhancementsEnabled !== false;
    if (!settings.sessionDelete && !settings.markdownExport && !sessionMenuEnabled) {
      removeActionGroups(row);
      row.dataset.codexDeleteRow = "false";
      return;
    }
    const existingGroup = actionGroupFromRow(row);
    const existingDeleteButton = existingGroup?.querySelector(`.${buttonClass}`);
    const existingMoreButton = existingGroup?.querySelector(`.${moreButtonClass}`);
    const existingExportButton = existingGroup?.querySelector(`.${exportButtonClass}`);
    const needsMoreMenu = sessionMenuEnabled;
    const hasUnexpectedDelete = !settings.sessionDelete && !!existingDeleteButton;
    const hasUnexpectedMore = !needsMoreMenu && !!existingMoreButton;
    const hasUnexpectedExport = !!existingExportButton;
    const missingDelete = settings.sessionDelete && !existingDeleteButton;
    const missingMore = needsMoreMenu && !existingMoreButton;
    const deleteReady = !settings.sessionDelete || existingDeleteButton?.dataset.codexDeleteVersion === codexDeleteVersion;
    const groupReady = existingGroup?.dataset.codexActionGroupVersion === codexActionGroupVersion
      && existingGroup?.dataset.codexProjectMoveEnabled === String(!!settings.projectMove);
    if (groupReady && deleteReady && !hasUnexpectedDelete && !hasUnexpectedMore && !hasUnexpectedExport && !missingDelete && !missingMore) {
      return;
    }
    removeActionGroups(row);
    row.dataset.codexDeleteRow = "false";
    const ref = sessionRefFromRow(row);
    if (!ref.session_id) return;
    row.dataset.codexDeleteRow = "true";
    const group = document.createElement("div");
    group.className = actionGroupClass;
    group.dataset.codexActionGroupVersion = codexActionGroupVersion;
    group.dataset.codexProjectMoveEnabled = String(!!settings.projectMove);
    if (needsMoreMenu) {
      const moreButton = document.createElement("button");
      moreButton.type = "button";
      moreButton.className = `${actionButtonClass} ${moreButtonClass}`;
      moreButton.setAttribute("aria-haspopup", "menu");
      moreButton.setAttribute("aria-expanded", "false");
      configureActionButton(moreButton, "更多操作", "…");
      const moreMenu = document.createElement("div");
      moreMenu.className = moreMenuClass;
      moreMenu.setAttribute("role", "menu");
      moreMenu.hidden = true;
      if (settings.markdownExport) {
        moreMenu.appendChild(createSessionMoreMenuItem("导出", "⇩", (event) => {
          stopActionButtonEvent(row, moreButton, event);
          closeSessionMoreMenus();
          exportMarkdown(ref);
        }));
      }
      if (sessionMenuEnabled) {
        const sessionCopyItem = createSessionMoreMenuItem("原地复制会话 - Alunixa X", "⧉", activateSessionCopyMenuItem);
        sessionCopyItem.dataset.codexSessionCopyMenu = "true";
        sessionCopyItem.dataset.codexSessionCopyVersion = sessionCopyMenuItemVersion;
        sessionCopyItem.__codexSessionCopyRow = row;
        moreMenu.appendChild(sessionCopyItem);
        const sessionAutoRenameItem = createSessionMoreMenuItem("自动重命名当前会话", "✦", activateSessionAutoRenameMenuItem);
        sessionAutoRenameItem.dataset.codexSessionAutoRenameMenu = "true";
        sessionAutoRenameItem.__codexSessionAutoRenameRow = row;
        moreMenu.appendChild(sessionAutoRenameItem);
      }
      if (settings.projectMove) {
        moreMenu.appendChild(createSessionMoreMenuItem("移动到项目", "↗", (event) => {
          closeSessionMoreMenus();
          void openProjectMoveMenuForRow(row,moreButton,ref,event);
        }));
      }
      if (settings.upstreamWorktreeCreate) {
        moreMenu.appendChild(createSessionMoreMenuItem("Upstream worktree", "⑂", (event) => {
          stopActionButtonEvent(row,moreButton,event);
          closeSessionMoreMenus();
          void openUpstreamWorktreeDialog(row,ref);
        }));
      }
      // 拓展注册的会话行操作追加在内置项之后。菜单每次重建（版本号变化）都会
      // 重新走一遍这里，所以拓展项不会因为重建而丢失。
      appendCodexPlusExtensionRowActions(moreMenu, row, moreButton);
      const openMoreMenu = (event) => {
        stopActionButtonEvent(row, moreButton, event);
        hideActionButtonTooltip();
        toggleSessionMoreMenu(row, moreButton, moreMenu);
        if (!moreMenu.hidden) {
          positionSessionMoreMenu(moreButton, moreMenu);
          updateSessionMoreMenuDirection(moreButton, moreMenu);
        }
      };
      installMoreButtonEvents(row, moreButton, openMoreMenu);
      group.appendChild(moreButton);
      moreMenu.__codexSessionMoreRow = row;
      moreMenu.__codexSessionMoreGroup = group;
      document.body.appendChild(moreMenu);
      installSessionMoreMenuAutoClose(row, moreMenu);
    }
    if (settings.sessionDelete) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = `${actionButtonClass} ${buttonClass}`;
      deleteButton.dataset.codexDeleteVersion = codexDeleteVersion;
      configureSvgActionButton(deleteButton, "删除", trashIconSvg());
      const openDeleteConfirm = (event) => openDeleteConfirmForRow(row, deleteButton, sessionRefFromRow(row), event);
      installActionButtonEvents(row, deleteButton, openDeleteConfirm);
      group.appendChild(deleteButton);
      setTimeout(() => refreshActionButton(deleteButton, row, openDeleteConfirm), 0);
    }
    row.appendChild(group);
    syncActionGroupLayout(row, group);
  }

  function tryAttachButton(row) {
    try {
      attachButton(row);
    } catch (error) {
      window.__codexSessionDeleteAttachButtonFailures = window.__codexSessionDeleteAttachButtonFailures || [];
      window.__codexSessionDeleteAttachButtonFailures.push(String(error?.stack || error));
    }
  }

  function reactArchivedThreadFromNode(node) {
    const reactKey = Object.keys(node).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
    let fiber = reactKey ? node[reactKey] : null;
    for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      if (props.archivedThread?.id) return props.archivedThread;
      const childThread = props.children?.props?.archivedThread;
      if (childThread?.id) return childThread;
    }
    return null;
  }

  function archivedThreadFromRow(row) {
    for (const node of [row, ...row.querySelectorAll("*")]) {
      const thread = reactArchivedThreadFromNode(node);
      if (thread?.id || thread?.sessionId) return thread;
    }
    return null;
  }

  function archivedRefFromRow(row) {
    const archivedThread = archivedThreadFromRow(row);
    if (archivedThread?.id || archivedThread?.sessionId) {
      return { session_id: archivedThread.id || archivedThread.sessionId, title: archivedThread.title || row.querySelector(".truncate.text-base")?.textContent?.trim() || "Untitled session" };
    }
    const sidebarRef = sessionRefFromRow(row);
    if (sidebarRef.session_id) return sidebarRef;
    const titleNode = row.querySelector(".truncate.text-base, [data-thread-title], a, div");
    const title = ((titleNode || row).textContent || "Untitled session")
      .replace("取消归档", "")
      .replace("删除", "")
      .replace(/\d{4}年\d{1,2}月\d{1,2}日.*$/, "")
      .replace(/\s+·\s+.*$/, "")
      .trim()
      .slice(0, 160);
    return { session_id: "", title };
  }

  async function resolveArchivedThread(row) {
    const ref = archivedRefFromRow(row);
    if (ref.session_id) return ref;
    const resolved = await postJson("/archived-thread", { title: ref.title });
    return resolved?.session_id ? resolved : ref;
  }

  function stopArchivedButtonEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function attachArchivedPageDeleteButton(row) {
    const settings = alunixaXSettings();
    row.querySelectorAll("[data-codex-archive-row-action]").forEach((button) => button.remove());
    row.dataset.codexArchiveDeleteRow = "false";
    if (!settings.sessionDelete && !settings.markdownExport) return;
    const unarchiveButton = Array.from(row.querySelectorAll("button")).find((button) => (button.textContent || "").trim() === "取消归档");
    if (!unarchiveButton) return;
    row.dataset.codexArchiveDeleteRow = "true";
    row.dataset.codexArchiveRowActionsVersion = codexArchiveRowActionsVersion;
    let insertionPoint = unarchiveButton;
    if (settings.markdownExport) {
      const exportButton = document.createElement("button");
      exportButton.type = "button";
      exportButton.className = `codex-archive-delete-all codex-archive-row-button ${exportButtonClass}`;
      exportButton.dataset.codexArchiveRowAction = "export";
      exportButton.textContent = "导出";
      ["pointerdown", "mousedown", "mouseup", "touchstart"].forEach((eventName) => {
        exportButton.addEventListener(eventName, stopArchivedButtonEvent, true);
      });
      exportButton.addEventListener("click", async (event) => {
        stopArchivedButtonEvent(event);
        const ref = await resolveArchivedThread(row);
        if (!ref.session_id) {
          showToast("导出失败：未找到归档会话 ID", null);
          return;
        }
        await exportMarkdown(ref);
      }, true);
      insertionPoint.insertAdjacentElement("afterend", exportButton);
      insertionPoint = exportButton;
    }
  }

  function conversationRoot() {
    return document.querySelector(".thread-scroll-container") || document.querySelector("main") || document.querySelector('[role="main"]');
  }

  function nodeOrAncestorLooksLikeCodexUserBubble(node) {
    if (node.nodeType !== 1) return false;
    const className = String(node.className || "");
    if (className.includes("bg-token-foreground/5") && node.parentElement?.classList?.contains("items-end")) return true;
    const bubble = node.closest?.("[class*='bg-token-foreground/5']");
    return !!bubble?.parentElement?.classList?.contains("items-end");
  }

  function nodeLooksLikeCodexUserBubble(node) {
    if (nodeOrAncestorLooksLikeCodexUserBubble(node)) return true;
    return !!node.querySelector?.(".group.flex.w-full.flex-col.items-end.justify-end.gap-1 > [class*='bg-token-foreground/5']");
  }

  function scrollerViewportTop(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) return 0;
    return scroller.getBoundingClientRect().top;
  }

  function nearestScrollableAncestor(node) {
    for (let current = node?.parentElement; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current;
    }
    return document.querySelector(".thread-scroll-container") || document.scrollingElement || document.documentElement;
  }

  // 旧版（26.9xx 之前）内容容器类名清单。保留它当候选之一，但**不再当唯一判据**：
  // 新版 Codex 把 `max-w-(--thread-content-max-width)` 换成了 `max-w-(--thread-body-max-width)`，
  // `pb-8` 也并入 `has-[[…]]:pb-0` 的条件组合，全等匹配必然归零（issue #2258）。
  const conversationViewContentClasses = [
    "mx-auto",
    "w-full",
    "max-w-(--thread-content-max-width)",
    "px-toolbar",
    "relative",
    "flex",
    "shrink-0",
    "flex-col",
    "pb-8",
  ];
  const conversationViewComposerClasses = [
    "relative",
    "z-10",
    "flex",
    "flex-col",
    "mx-auto",
    "w-full",
    "max-w-(--thread-content-max-width)",
    "px-toolbar",
  ];
  // Codex 把中间栏宽度的工具类写成 `max-w-(--thread-<用途>-max-width)`，用途词换过好几轮
  // （content → body、content-responsive…）。所以只钉住「结构」——`max-w-(--thread-*-max-width)`
  // 这个形状本身——而不是某个具体用途词。哈希类名（`_shell_151xi_3` 那类）一律不写死。
  const conversationViewThreadWidthTokenPattern = /^(?:[a-z-]+:)*max-w-\(--thread-[a-z-]+-max-width\)$/;
  // 内容容器的新版稳定锚点。它是虚拟列表宿主（data-mcp-app-portal-target 同节点），
  // 由 Codex 自己维护在滚动容器内部，比类名抗改。选择器统一登记在 00-prelude.js 的
  // selectors 表里，不在这里另起一份。
  const conversationViewContentAnchorSelector = selectors.conversationViewContentAnchor;
  const conversationViewScrollContainerSelector = selectors.conversationViewScrollContainer;
  // 页脚包裹层同样带 `max-w-(--thread-…-max-width)`，会被结构候选误当成内容容器。
  // 用 Codex 自己的页脚标记把它排掉。
  const conversationViewFooterSelector = selectors.conversationViewFooter;
  const conversationViewPaneBoundarySelector = "#app-shell-sidebar, .app-shell-left-panel, .sidebar-navigation, nav[data-app-navigation-rail], [data-summary-panel-variant]";
  // 两侧留白：Codex 的 `--padding-toolbar` 是 `calc(var(--spacing) * 2)`（= 8px * 2）。
  // 仅在拿不到父节点 computed style 时作为回落的单侧留白。
  const conversationViewSideInset = 8;
  const conversationViewState = {
    contentEl: null,
    composerEl: null,
    rafId: 0,
    settleFramesLeft: 0,
    mo: null,
    ro: null,
    pollId: 0,
    runtimeStarted: false,
    moObserved: false,
    targetsReported: false,
    observed: new WeakSet(),
    elements: new Set(),
  };

  function conversationViewTokenSet(el) {
    return new Set(String(el?.className || "").split(/\s+/).filter(Boolean));
  }

  function conversationViewHasAllClasses(el, classes) {
    const set = conversationViewTokenSet(el);
    return classes.every((cls) => set.has(cls));
  }

  function conversationViewFindByClasses(classes, root, accept) {
    return Array.from(root?.querySelectorAll("div") || [])
      .find((el) => conversationViewHasAllClasses(el, classes) && accept(el)) || null;
  }

  function conversationViewHasThreadWidthToken(el) {
    for (const token of conversationViewTokenSet(el)) {
      if (conversationViewThreadWidthTokenPattern.test(token)) return true;
    }
    return false;
  }

  // 结构性判定：居中 + 满宽 + 线程宽度工具类。不依赖任何具体用途词或哈希类名。
  function conversationViewLooksLikeThreadWidthBox(el) {
    if (el?.tagName !== "DIV") return false;
    const set = conversationViewTokenSet(el);
    if (!set.has("mx-auto") || !set.has("w-full")) return false;
    return conversationViewHasThreadWidthToken(el);
  }

  // 页脚包裹层**自身**也带宽度工具类，所以这里不仅要排掉它的后代，还要排掉它本身。
  function conversationViewIsInsideFooter(el) {
    if (!el) return false;
    try {
      return el.matches?.(conversationViewFooterSelector) === true
        || el.closest?.(conversationViewFooterSelector) != null;
    } catch (_) {
      return false;
    }
  }

  function conversationViewScrollContainer() {
    const scrollers = Array.from(document.querySelectorAll(conversationViewScrollContainerSelector))
      .filter((el) => typeof visibleElement !== "function" || visibleElement(el));
    // 多个可见会话没有可靠的当前目标，不把任一 pane 当成整页正文。
    return scrollers.length === 1 ? scrollers[0] : null;
  }

  function conversationViewSafeWidthTarget(el, scope) {
    if (!el || !scope || el === scope || !scope.contains?.(el)) return false;
    if (scope.matches?.(conversationViewScrollContainerSelector)
        && el.closest?.(conversationViewScrollContainerSelector) !== scope) return false;
    return conversationViewSafeWidthNode(el);
  }

  function conversationViewSafeWidthNode(el) {
    if (!el) return false;
    if (["MAIN", "ASIDE", "NAV", "HEADER", "BODY", "HTML"].includes(el.tagName)) return false;
    if (el.closest?.(`${conversationViewPaneBoundarySelector}, [data-alunixa-x-ext]`)) return false;
    // CSS 变量可继承给整棵布局树；包含其他 pane 的祖先不能改 width/margin/left。
    // composer 内的状态提示也会用 aside，不能仅按语义标签把它误判为侧栏。
    return !el.querySelector?.(`${conversationViewPaneBoundarySelector}, .thread-scroll-container`);
  }

  function conversationViewSamePane(scroller, el) {
    if (scroller.contains?.(el)) return el.closest?.(conversationViewScrollContainerSelector) === scroller;
    if (el.closest?.(conversationViewScrollContainerSelector)) return false;
    if (el.parentElement === scroller.parentElement && el.parentElement !== document.body) return true;
    for (let pane = scroller.parentElement; pane && pane !== document.body; pane = pane.parentElement) {
      if (!pane.contains?.(el)) continue;
      return !pane.querySelector?.(conversationViewPaneBoundarySelector);
    }
    return false;
  }

  function conversationViewFootersFor(scroller) {
    return Array.from(document.querySelectorAll(conversationViewFooterSelector)).filter((footer) => {
      if (typeof visibleElement === "function" && !visibleElement(footer)) return false;
      return !footer.closest?.(`${conversationViewPaneBoundarySelector}, [data-alunixa-x-ext]`) && conversationViewSamePane(scroller, footer);
    });
  }

  function conversationViewFindNativeComposer(scroller) {
    const roots = Array.from(document.querySelectorAll("[data-codex-composer-root]"))
      .filter((el) => (typeof visibleElement !== "function" || visibleElement(el))
        && !el.closest?.(`${conversationViewPaneBoundarySelector}, [data-alunixa-x-ext]`) && (!scroller || conversationViewSamePane(scroller, el)));
    if (roots.length !== 1) return null;
    const root = roots[0];
    const accept = (el) => conversationViewLooksLikeThreadWidthBox(el) && conversationViewSafeWidthNode(el)
      && !el.matches?.(conversationViewFooterSelector) && !el.querySelector?.(conversationViewContentAnchorSelector);
    const inside = [root, ...root.querySelectorAll("div")].find(accept);
    if (inside) return inside;
    // 原生 composer 锚点可能在宽度宿主内部；只爬到局部宿主，不收窄含正文的布局。
    for (let host = root.parentElement; host && host !== document.body; host = host.parentElement) {
      if (accept(host)) return host;
      if (host.matches?.(conversationViewScrollContainerSelector) || host.querySelector?.(conversationViewScrollContainerSelector)) break;
    }
    return null;
  }

  function conversationViewCollectThreadWidthBoxes(root) {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll("div")).filter(conversationViewLooksLikeThreadWidthBox);
  }

  /**
   * 按候选顺序找内容容器，任一候选命中即返回。
   *
   * 候选链刻意从「最精确」排到「最宽松」：
   * 所有候选都必须在唯一的会话滚动区内，并排除布局祖先：
   *   1. 旧版类名全等（老版本 Codex 上仍然最准）；
   *   2. Codex 自己的 data-* 锚点（当前版本）；
   *   3. 结构判定（滚动容器内、居中满宽、带 thread 宽度工具类）；
   *   4. #2085 报告里提到的兜底：两处类名都没命中时，按 CSS 变量反查宿主节点。
   *
   * 顺序不能反：结构判定会把页脚包裹层也算进来，而它和内容容器在同一棵子树里。
   */
  function conversationViewFindContentEl() {
    const scroller = conversationViewScrollContainer();
    if (!scroller) return null;
    const accept = (el) => conversationViewSafeWidthTarget(el, scroller) && !conversationViewIsInsideFooter(el)
      && !el.querySelector?.(conversationViewFooterSelector);
    const legacy = conversationViewFindByClasses(conversationViewContentClasses, scroller, accept);
    if (legacy) return legacy;
    const anchored = Array.from(scroller.querySelectorAll(conversationViewContentAnchorSelector)).find(accept);
    if (anchored) return anchored;
    const structural = conversationViewCollectThreadWidthBoxes(scroller)
      // 页脚包裹层（data-thread-scroll-footer）也带同样的宽度工具类，必须排掉。
      .find(accept);
    if (structural) return structural;
    return conversationViewFindByThreadWidthVariable(scroller, accept);
  }

  function conversationViewFindComposerEl() {
    const scroller = conversationViewScrollContainer();
    if (!scroller) {
      // 首页没有消息 scroller；只用明确的原生 composer 锚点，不能全页猜宽度变量。
      if (Array.from(document.querySelectorAll(conversationViewScrollContainerSelector))
          .some((el) => typeof visibleElement !== "function" || visibleElement(el))) return null;
      const native = conversationViewFindNativeComposer(null);
      if (native) return native;
      const legacy = Array.from(document.querySelectorAll("div")).filter((el) =>
        conversationViewHasAllClasses(el, conversationViewComposerClasses) && conversationViewSafeWidthNode(el)
        && !conversationViewIsInsideFooter(el) && el.querySelector?.('textarea, [contenteditable="true"]'));
      return legacy.length === 1 ? legacy[0] : null;
    }
    // 页脚包裹层带的是和作曲器同一套工具类，会被旧清单全等命中，所以要排除它。
    const footers = conversationViewFootersFor(scroller);
    if (footers.length > 1) return null;
    const footer = footers[0];
    const accept = (el) => conversationViewSafeWidthTarget(el, footer || scroller)
      && !el.matches?.(conversationViewFooterSelector) && !conversationViewIsContentCandidate(el);
    // 新版作曲器在页脚包裹层内部——页脚自身也是 max-w 盒子，得往里再找一层。
    const insideFooter = conversationViewCollectThreadWidthBoxes(footer).find(accept);
    if (insideFooter) return insideFooter;
    if (footer) return conversationViewFindByThreadWidthVariable(footer, (el) => el !== footer && accept(el));
    const native = conversationViewFindNativeComposer(scroller);
    if (native) return native;
    // 保留同一会话内的旧类名；无 footer 的新版结构还必须包含明确编辑器。
    const legacy = conversationViewFindByClasses(conversationViewComposerClasses, scroller, (el) => accept(el) && !conversationViewIsInsideFooter(el));
    if (legacy) return legacy;
    return conversationViewCollectThreadWidthBoxes(scroller).find((el) => accept(el)
      && !conversationViewIsInsideFooter(el) && !el.querySelector?.(conversationViewContentAnchorSelector)
      && el.querySelector?.('textarea, [contenteditable="true"]')) || null;
  }

  // 内容容器的判定（锚点或全等类名），供作曲器查找排除同形节点用。
  function conversationViewIsContentCandidate(el) {
    if (!el) return false;
    if (el.matches?.(conversationViewContentAnchorSelector)) return true;
    return conversationViewHasAllClasses(el, conversationViewContentClasses);
  }

  // 兜底：类名全不对时，看计算样式里 Codex 是否在该节点上定义了线程宽度变量。
  // 变量名只按 `--thread-*-max-width` 这个形状匹配，同样不绑具体用途词。
  // accept 为 null 时默认排除页脚内部节点（内容容器的用法）；作曲器查找会传自己的判定。
  function conversationViewFindByThreadWidthVariable(root, accept = null) {
    if (!root?.querySelectorAll) return null;
    const candidates = Array.from(root.querySelectorAll("div"));
    return candidates.find((el) => {
      if (accept ? !accept(el) : conversationViewIsInsideFooter(el)) return false;
      try {
        const style = getComputedStyle(el);
        // --thread-* 在后代继承，不代表该节点自身受 max-width 约束（#2414）。
        if (!style.maxWidth || style.maxWidth === "none") return false;
        for (const name of conversationViewThreadWidthCustomProperties(style)) {
          if (String(style.getPropertyValue(name) || "").trim()) return true;
        }
      } catch (_) {
        return false;
      }
      return false;
    }) || null;
  }

  function conversationViewThreadWidthCustomProperties(style) {
    // CSSStyleDeclaration 的索引属性在 Chromium 里可用；拿不到时退回固定候选名，
    // 保证兜底在受限环境（测试夹具）里也不会抛。
    const names = [];
    const length = Number(style?.length) || 0;
    for (let index = 0; index < length; index += 1) {
      const name = style[index];
      if (typeof name === "string" && name.startsWith("--thread-") && name.endsWith("-max-width")) names.push(name);
    }
    if (!names.length) names.push("--thread-body-max-width", "--thread-content-max-width");
    return names;
  }

  function codexServiceTierBadgeVisibleElement(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    if (element.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function codexServiceTierBadgeText(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function codexServiceTierKnownProviderNames() {
    return uniqueValues([
      codexModelCatalog.provider_name,
      codexModelCatalog.model_provider,
    ]).map((value) => value.toLowerCase());
  }

  function codexServiceTierLooksLikeProviderButton(button, providerNames) {
    const text = codexServiceTierBadgeText(button);
    if (!text || text.length > 32) return false;
    const lower = text.toLowerCase();
    if (providerNames.includes(lower)) return true;
    if (/\s/.test(text)) return false;
    if (!/[a-z]/i.test(text)) return false;
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/i.test(text)) return false;
    if (/^(local|remote|cloud|standard|default|fast|worktree|new|send|stop|codex)$/i.test(text)) return false;
    if (/^(gpt|o[1-9]|claude|gemini|deepseek|qwen|kimi|moonshot|mistral|llama|sonnet|opus|haiku)[a-z0-9._-]*$/i.test(text)) return false;
    return true;
  }

  function codexServiceTierBadgeButtonCandidates(composer) {
    const composerRect = composer.getBoundingClientRect();
    return Array.from(composer.querySelectorAll("button, [role='button']"))
      .filter((button) => !button.closest?.(`[data-codex-service-tier-badge="true"]`))
      .filter(codexServiceTierBadgeVisibleElement)
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.bottom >= composerRect.top + composerRect.height * 0.35;
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.bottom - leftRect.bottom) || (leftRect.left - rightRect.left);
      });
  }

  const codexServiceTierComposerFooterSelector = '.composer-footer, [data-composer-footer-responsive], [class*="_ComposerFooter_"], [class*="_ComposerLayoutFooter_"]';

  function codexServiceTierVisibleComposerFooters(root = document) {
    const footers = [
      ...(root?.matches?.(codexServiceTierComposerFooterSelector) ? [root] : []),
      ...Array.from(root?.querySelectorAll?.(codexServiceTierComposerFooterSelector) || []),
    ];
    return footers
      .filter(codexServiceTierBadgeVisibleElement)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.bottom - leftRect.bottom) || (rightRect.width - leftRect.width);
      });
  }

  function codexServiceTierComposerScore(composer) {
    const text = codexServiceTierBadgeText(composer).toLowerCase();
    const providerNames = codexServiceTierKnownProviderNames();
    let score = 0;
    if (providerNames.some((name) => name && text.includes(name))) score += 40;
    if (/完全访问权限|full access|model|超高|high|sub2api|provider/i.test(text)) score += 20;
    if (/本地模式|local mode|worktree|branch|codex\//i.test(text)) score -= 30;
    if (composer.matches?.(codexServiceTierComposerFooterSelector)) score += 4;
    if (composer.querySelector?.(codexServiceTierComposerFooterSelector)) score += 8;
    const buttons = Array.from(composer.querySelectorAll?.("button, [role='button']") || []).filter(codexServiceTierBadgeVisibleElement);
    if (buttons.some((button) => codexServiceTierLooksLikeProviderButton(button, providerNames))) score += 30;
    score += Math.min(10, buttons.length);
    return score;
  }

  function codexServiceTierComposerCandidates() {
    const threadComposer = conversationViewFindComposerEl();
    if (threadComposer && codexServiceTierBadgeVisibleElement(threadComposer)) return [threadComposer];
    const footers = codexServiceTierVisibleComposerFooters().filter((footer) =>
      !footer.closest?.(`${conversationViewPaneBoundarySelector}, [data-alunixa-x-ext]`));
    // 只认唯一的原生 footer；不能爬到页面/侧栏祖先，或把 review 的栏当成输入区。
    return footers.length === 1 ? footers : [];
  }

  function codexServiceTierBestComposerFooter(root = document) {
    return codexServiceTierVisibleComposerFooters(root)
      .map((footer, index) => ({ footer, index, score: codexServiceTierComposerScore(footer) }))
      .sort((left, right) => (right.score - left.score) || (left.index - right.index))[0]?.footer || null;
  }

  function codexServiceTierFindComposerEl() {
    return codexServiceTierComposerCandidates()
      .map((composer, index) => ({ composer, index, score: codexServiceTierComposerScore(composer) }))
      .sort((left, right) => (right.score - left.score) || (left.index - right.index))[0]?.composer || null;
  }

  function codexServiceTierBadgeAnchor(composer) {
    const providerNames = codexServiceTierKnownProviderNames();
    const buttons = codexServiceTierBadgeButtonCandidates(composer);
    const exact = buttons.find((button) => providerNames.includes(codexServiceTierBadgeText(button).toLowerCase()));
    if (exact) return exact;
    const composerRect = composer.getBoundingClientRect();
    return buttons.find((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= composerRect.left + composerRect.width * 0.42 && codexServiceTierLooksLikeProviderButton(button, providerNames);
    }) || null;
  }

  function codexServiceTierComposerFooter(composer) {
    if (composer?.matches?.(codexServiceTierComposerFooterSelector)) return composer;
    return codexServiceTierBestComposerFooter(composer) || null;
  }

  function codexServiceTierBadgeFooterGroup(composer) {
    const footer = codexServiceTierComposerFooter(composer);
    if (!footer) return null;
    const children = Array.from(footer.children)
      .filter(codexServiceTierBadgeVisibleElement)
      .filter((child) => !child.closest?.('[data-codex-service-tier-badge="true"]')
        && !child.matches?.("button, [role='button'], a, input, select, textarea, label")
        && child.children?.length > 0);
    if (!children.length) return footer;
    const providerNames = codexServiceTierKnownProviderNames();
    const providerGroup = children.find((child) => {
      const text = codexServiceTierBadgeText(child).toLowerCase();
      return providerNames.some((name) => name && text.includes(name));
    });
    return providerGroup || children[children.length - 1] || footer;
  }

  function codexServiceTierBadgePlacement(composer) {
    const anchor = composer ? codexServiceTierBadgeAnchor(composer) : null;
    if (anchor?.parentElement) return { parent: anchor.parentElement, before: anchor };
    const group = composer ? codexServiceTierBadgeFooterGroup(composer) : null;
    if (group) return {
      parent: group,
      before: Array.from(group.childNodes || group.children || [])
        .find((node) => !node.matches?.('[data-codex-service-tier-badge="true"]')) || null,
    };
    return null;
  }

  function wireCodexServiceTierBadge(badge) {
    if (!badge || badge.dataset.codexServiceTierBadgeWired === codexServiceTierBadgeVersion) return;
    badge.dataset.codexServiceTierBadgeWired = codexServiceTierBadgeVersion;
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (codexServiceTierState.status === "loading" || badge.dataset.disabled === "true") return;
      toggleCodexServiceTierFromBadge();
    });
    badge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      if (codexServiceTierState.status === "loading" || badge.dataset.disabled === "true") return;
      toggleCodexServiceTierFromBadge();
    });
  }

  function installCodexServiceTierBadge() {
    if (!alunixaXSettings().serviceTierControls) {
      removeCodexServiceTierBadges();
      return;
    }
    const composer = codexServiceTierFindComposerEl();
    const placement = composer ? codexServiceTierBadgePlacement(composer) : null;
    const existingBadges = Array.from(document.querySelectorAll(`[data-codex-service-tier-badge="true"]`));
    if (!composer || !placement?.parent) {
      existingBadges.forEach((badge) => badge.remove());
      return;
    }
    let badge = existingBadges.find((node) => node.closest?.(codexServiceTierComposerFooterSelector) || node.closest?.("button") == null) || existingBadges[0];
    existingBadges.forEach((node) => {
      if (node !== badge) node.remove();
    });
    if (!badge || badge.dataset.codexServiceTierBadgeVersion !== codexServiceTierBadgeVersion) {
      badge?.remove();
      badge = document.createElement("span");
      badge.className = codexServiceTierBadgeClass;
      badge.dataset.codexServiceTierBadge = "true";
      badge.dataset.codexServiceTierBadgeVersion = codexServiceTierBadgeVersion;
    }
    wireCodexServiceTierBadge(badge);
    const before = placement.before?.parentElement === placement.parent ? placement.before : null;
    if (badge.parentElement !== placement.parent || badge.nextSibling !== before) {
      placement.parent.insertBefore(badge, before);
    }
    refreshCodexServiceTierBadges();
  }

  function removeCodexServiceTierBadges() {
    document.querySelectorAll(`[data-codex-service-tier-badge="true"]`).forEach((badge) => badge.remove());
  }

  function conversationViewRememberOriginals(el) {
    if (!el) return;
    conversationViewState.elements.add(el);
    const original = {
      width: el.style.width || "",
      maxWidth: el.style.maxWidth || "",
      marginLeft: el.style.marginLeft || "",
      marginRight: el.style.marginRight || "",
      left: el.style.left || "",
      transform: el.style.transform || "",
      boxSizing: el.style.boxSizing || "",
    };
    if (!("alunixaXConversationViewOriginalWidth" in el.dataset)) el.dataset.alunixaXConversationViewOriginalWidth = original.width;
    if (!("alunixaXConversationViewOriginalMaxWidth" in el.dataset)) el.dataset.alunixaXConversationViewOriginalMaxWidth = original.maxWidth;
    if (!("alunixaXConversationViewOriginalMarginLeft" in el.dataset)) el.dataset.alunixaXConversationViewOriginalMarginLeft = original.marginLeft;
    if (!("alunixaXConversationViewOriginalMarginRight" in el.dataset)) el.dataset.alunixaXConversationViewOriginalMarginRight = original.marginRight;
    if (!("alunixaXConversationViewOriginalLeft" in el.dataset)) el.dataset.alunixaXConversationViewOriginalLeft = original.left;
    if (!("alunixaXConversationViewOriginalTransform" in el.dataset)) el.dataset.alunixaXConversationViewOriginalTransform = original.transform;
    if (!("alunixaXConversationViewOriginalBoxSizing" in el.dataset)) el.dataset.alunixaXConversationViewOriginalBoxSizing = original.boxSizing;
  }

  function conversationViewRestoreElement(el) {
    if (!el) return;
    if ("alunixaXConversationViewOriginalWidth" in el.dataset) {
      el.style.width = el.dataset.alunixaXConversationViewOriginalWidth;
      delete el.dataset.alunixaXConversationViewOriginalWidth;
    }
    if ("alunixaXConversationViewOriginalMaxWidth" in el.dataset) {
      el.style.maxWidth = el.dataset.alunixaXConversationViewOriginalMaxWidth;
      delete el.dataset.alunixaXConversationViewOriginalMaxWidth;
    }
    if ("alunixaXConversationViewOriginalMarginLeft" in el.dataset) {
      el.style.marginLeft = el.dataset.alunixaXConversationViewOriginalMarginLeft;
      delete el.dataset.alunixaXConversationViewOriginalMarginLeft;
    }
    if ("alunixaXConversationViewOriginalMarginRight" in el.dataset) {
      el.style.marginRight = el.dataset.alunixaXConversationViewOriginalMarginRight;
      delete el.dataset.alunixaXConversationViewOriginalMarginRight;
    }
    if ("alunixaXConversationViewOriginalLeft" in el.dataset) {
      el.style.left = el.dataset.alunixaXConversationViewOriginalLeft;
      delete el.dataset.alunixaXConversationViewOriginalLeft;
    }
    if ("alunixaXConversationViewOriginalTransform" in el.dataset) {
      el.style.transform = el.dataset.alunixaXConversationViewOriginalTransform;
      delete el.dataset.alunixaXConversationViewOriginalTransform;
    }
    if ("alunixaXConversationViewOriginalBoxSizing" in el.dataset) {
      el.style.boxSizing = el.dataset.alunixaXConversationViewOriginalBoxSizing;
      delete el.dataset.alunixaXConversationViewOriginalBoxSizing;
    }
  }

  function conversationViewResetOwnOffset(el) {
    if (!el) return;
    const originalTransform = el.dataset.alunixaXConversationViewOriginalTransform || "";
    const originalLeft = el.dataset.alunixaXConversationViewOriginalLeft || "";
    if (el.style.left !== originalLeft) el.style.left = originalLeft;
    if (el.style.transform !== originalTransform) el.style.transform = originalTransform;
    const transform = String(el.style.transform || "").trim();
    if (/^(translateX\([^)]*\)\s*)+$/i.test(transform)) {
      el.style.transform = "";
    }
  }

  // #2085：设置值是**上限**，不是必须写死的宽度。容器比上限窄时按容器可用宽度
  // 收敛，否则 900px 会让内容溢出滚动容器、两侧被裁。
  // 容器宽度已由调用方在读取阶段量好，这里只做纯计算，不读几何——见 conversationViewAlignNow。
  function conversationViewEffectiveWidth(containerWidth) {
    const configured = conversationViewWidth();
    if (!Number.isFinite(containerWidth) || containerWidth <= 0) return configured;
    return Math.max(conversationViewMinWidth, Math.min(configured, Math.round(containerWidth)));
  }

  function conversationViewApplyNativeWidth(el, effectiveWidth) {
    conversationViewRememberOriginals(el);
    const width = Number.isFinite(effectiveWidth) ? effectiveWidth : conversationViewWidth();
    const maxWidth = `${width}px`;
    if (el.style.boxSizing !== "border-box") el.style.boxSizing = "border-box";
    if (el.style.width !== "100%") el.style.width = "100%";
    if (el.style.maxWidth !== maxWidth) el.style.maxWidth = maxWidth;
    if (el.style.marginLeft !== "auto") el.style.marginLeft = "auto";
    if (el.style.marginRight !== "auto") el.style.marginRight = "auto";
  }

  function conversationViewSessionRectFor(el) {
    return el?.parentElement?.getBoundingClientRect() || null;
  }

  // 容器可用宽度：取宿主节点的内容盒宽（rect.width 含内边距，减掉左右 padding 才是可用空间）。
  // 拿不到几何（离屏、display:none、父节点缺失）时返回 0，由 effectiveWidth 回落设置上限。
  function conversationViewAvailableWidth(el) {
    const host = el?.parentElement;
    const rect = conversationViewSessionRectFor(el);
    if (!host || !rect || !(rect.width > 0)) return 0;
    let inlinePadding = conversationViewSideInset * 2;
    try {
      const style = getComputedStyle(host);
      inlinePadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    } catch (_) {
      inlinePadding = conversationViewSideInset * 2;
    }
    return Math.max(0, rect.width - inlinePadding);
  }

  function conversationViewHtmlCenter() {
    const rect = document.documentElement.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function conversationViewObserveIfNeeded(el) {
    if (!el || !conversationViewState.ro || conversationViewState.observed.has(el)) return;
    conversationViewState.observed.add(el);
    conversationViewState.ro.observe(el);
  }

  function conversationViewResolveTargets() {
    for (const [key, next] of [
      ["contentEl", conversationViewFindContentEl()],
      ["composerEl", conversationViewFindComposerEl()],
    ]) {
      const previous = conversationViewState[key];
      if (previous && previous !== next) {
        conversationViewRestoreElement(previous);
        conversationViewState.elements.delete(previous);
        [previous, previous.parentElement, previous.parentElement?.parentElement].forEach((el) => {
          if (!el) return;
          conversationViewState.ro?.unobserve?.(el);
          conversationViewState.observed.delete(el);
        });
      }
      conversationViewState[key] = next;
    }
    [
      document.documentElement,
      document.body,
      conversationViewState.contentEl,
      conversationViewState.contentEl?.parentElement,
      conversationViewState.contentEl?.parentElement?.parentElement,
      conversationViewState.composerEl,
      conversationViewState.composerEl?.parentElement,
      conversationViewState.composerEl?.parentElement?.parentElement,
    ].forEach(conversationViewObserveIfNeeded);
  }

  function conversationViewAlignNow() {
    if (!alunixaXSettings().conversationView) return;
    conversationViewResolveTargets();
    const targets = [
      conversationViewState.contentEl,
      conversationViewState.composerEl,
    ].filter((el) => el?.isConnected);
    if (!targets.length) {
      conversationViewReportMissingTargets();
      return;
    }
    conversationViewState.targetsReported = false;
    // 三阶段批量对齐，全程不出现读-写交替（否则退回 commit 82fb0924 修掉的强制重排）：
    //   ① 读：一次性量完全部目标的宿主可用宽度，算出各自的有效上限；
    //   ② 写：按算好的宽度统一写 style（宽度 + 复位自身偏移）；
    //   ③ 读 + 写 left：统一读几何，决定是否需要再写 left。
    // #2085 的自适应计算落在 ①，写动作仍集中在 ②，与原有两阶段结构一致。
    const availableWidths = targets.map((el) => conversationViewAvailableWidth(el));
    const effectiveWidths = availableWidths.map((width) => conversationViewEffectiveWidth(width));
    targets.forEach((el, index) => {
      conversationViewApplyNativeWidth(el, effectiveWidths[index]);
      conversationViewResetOwnOffset(el);
    });
    const htmlCenter = conversationViewHtmlCenter();
    targets.forEach((el) => {
      const nativeRect = el.getBoundingClientRect();
      const bounds = conversationViewSessionRectFor(el);
      if (!conversationViewHasRoomForHtmlCenterAt(nativeRect, bounds, htmlCenter)) return;
      const targetLeft = htmlCenter - nativeRect.width / 2;
      const delta = targetLeft - nativeRect.left;
      if (Math.abs(delta) > 0.5) {
        const nextLeft = `${delta.toFixed(2)}px`;
        if (el.style.left !== nextLeft) el.style.left = nextLeft;
      }
    });
  }

  /**
   * #2258 最贵的地方是「静默」：类名变化导致目标归零时，对齐整段直接 return，
   * 用户只看到居中失效，日志里什么都没有。这里每个会话只上报一次，
   * 并在下一次成功命中时重置，避免长时间运行时刷屏。
   */
  function conversationViewReportMissingTargets() {
    if (conversationViewState.targetsReported) return;
    conversationViewState.targetsReported = true;
    const scroller = conversationViewScrollContainer();
    sendCodexPlusDiagnostic("conversation_view_target_not_found", {
      hasScrollContainer: !!scroller,
      hasContentAnchor: !!document.querySelector(conversationViewContentAnchorSelector),
      hasFooter: !!document.querySelector(conversationViewFooterSelector),
      threadWidthBoxes: conversationViewCollectThreadWidthBoxes(scroller || document).length,
      configuredWidth: conversationViewWidth(),
    });
  }

  function conversationViewHasRoomForHtmlCenterAt(nativeRect, bounds, htmlCenter) {
    if (!nativeRect || !bounds) return false;
    const targetLeft = htmlCenter - nativeRect.width / 2;
    const targetRight = targetLeft + nativeRect.width;
    return targetLeft >= bounds.left - 0.5 && targetRight <= bounds.right + 0.5;
  }

  function scheduleConversationViewAlign(frames = 16) {
    conversationViewState.settleFramesLeft = Math.max(conversationViewState.settleFramesLeft, frames);
    if (conversationViewState.rafId) return;
    const tick = () => {
      conversationViewState.rafId = 0;
      conversationViewAlignNow();
      conversationViewState.settleFramesLeft -= 1;
      if (conversationViewState.settleFramesLeft > 0) {
        conversationViewState.rafId = requestAnimationFrame(tick);
      }
    };
    conversationViewState.rafId = requestAnimationFrame(tick);
  }

  function cleanupConversationView() {
    if (conversationViewState.rafId) cancelAnimationFrame(conversationViewState.rafId);
    if (conversationViewState.pollId) clearInterval(conversationViewState.pollId);
    conversationViewState.rafId = 0;
    conversationViewState.pollId = 0;
    conversationViewState.mo?.disconnect();
    conversationViewState.ro?.disconnect();
    conversationViewState.mo = null;
    conversationViewState.ro = null;
    conversationViewState.moObserved = false;
    conversationViewState.runtimeStarted = false;
    conversationViewState.observed = new WeakSet();
    conversationViewState.elements.forEach(conversationViewRestoreElement);
    conversationViewState.elements.clear();
    conversationViewState.contentEl = null;
    conversationViewState.composerEl = null;
  }

  window.__alunixaXConversationViewCleanup = cleanupConversationView;
  /**
   * 对外接口层：window.alunixaX
   *
   * 第三方用户脚本不认识 Alunixa X 内部的闭包函数，只能通过这个对象调用能力。
   * 设计要点：
   *
   *   1. 只挂一个全局名。之前 42 个 window.__alunixaX* 里绝大多数是补丁哨兵，
   *      对外没有价值；新能力统一收进这里，避免命名空间继续发散。
   *   2. 注册表持久、DOM 瞬态。每个 register* 只把数据写进注册中心，渲染由消费方
   *      负责。第三方不需要关心宿主何时重建（overlay 重开、会话行重建）。
   *   3. 失败隔离。第三方回调一律经 runCodexPlusExtensionCallback 包一层，抛错
   *      记进该脚本的状态通道，不会让 Alunixa X 自己的 UI 白屏。
   *
   * 这个分片必须在 renderer-inject 内部的所有 UI 消费方之前执行，因为它只做定义、
   * 不读 DOM；实际挂载发生在 99-tail 之前，那时所有依赖函数都已可用。
   */
  const alunixaXExtensionApiVersion = 1;
  const alunixaXExtensionAdapterVersion = "1.0.0";

  /** 类名与属性契约。一旦发布不再更名，新增用新名字。 */
  const alunixaXExtensionConstants = {
    pageClass: alunixaXPageClass,
    pageNavAttribute: "data-alunixa-x-page-nav",
    railSelector: alunixaXRailSelector,
    railDestinationSelector: alunixaXRailDestinationSelector,
    actionGroupClass,
    moreMenuClass,
    toastClass: "codex-delete-toast",
    // 拓展自己插入的节点必须带这个属性，值是该脚本的 key。
    // 扫描调度靠它把拓展的写入排除在自喂循环之外（issue #1960）。
    extensionAttribute: "data-alunixa-x-ext",
  };

  /**
   * 路由白名单。未在此声明的路由即使后端支持也不允许拓展调用。
   *
   * 刻意做成白名单而不是黑名单：新增路由时默认不可用，需要显式决定是否开放，
   * 避免内部路由（例如 `/settings/set`、`/manager/open-transient`）被顺手暴露出去。
   */
  const alunixaXExtensionRoutes = new Set([
    "/diagnostics/log",
    "/session/export",
    "/thread-usage-history",
    "/archived-thread",
    "/export-markdown",
    "/user-scripts/list",
  ]);

  /** 单次调用的默认超时，略短于桥接自身的 26s，让拓展先拿到可读的错误。 */
  const alunixaXExtensionCallTimeoutMs = 26000;

  /**
   * 调用后端。
   *
   * 直接暴露 __codexSessionDeleteBridge 有三个问题：名字语义错位（它早就不只用于
   * 会话删除）、没有超时、错误风格不统一（路由层返回 {status:"failed"}，浮层面板
   * 返回 {error}）。这里统一成 Promise reject，让拓展用 try/catch。
   */
  function alunixaXExtensionCall(route, payload = {}, options = {}) {
    if (typeof route !== "string" || !alunixaXExtensionRoutes.has(route)) {
      return Promise.reject(new Error(`未开放的路由：${route}`));
    }
    const bridge = window.__codexSessionDeleteBridge;
    if (typeof bridge !== "function") {
      return Promise.reject(new Error("Codex 页面尚未连接，请稍后重试"));
    }
    const timeout = Number.isFinite(options.timeout) ? Number(options.timeout) : alunixaXExtensionCallTimeoutMs;
    // 桥接协议没有 cancel 通道，超时只能放弃等待，服务端任务仍会跑完。
    const request = bridge(route, payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`调用 ${route} 超时`)), timeout);
      Promise.resolve(request).then(
        (result) => {
          clearTimeout(timer);
          if (result?.status === "failed" || result?.error) {
            reject(new Error(result.message || result.error || `${route} 调用失败`));
            return;
          }
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * 当前脚本的 key。
   *
   * wrap_script 只在脚本初始化期间把 currentKey 设为脚本 key，异步回调里就是 null。
   * 而拓展完全可能在 await 之后才注册 UI，所以不能只看 currentKey——那样这些项会
   * 丢失归属，出问题时无法定位到是哪个脚本，扫描调度也认不出它的节点。
   * 这里保留 options.scriptKey 作为显式覆盖，默认回退到 currentKey。
   */
  function alunixaXCurrentExtensionScriptKey(options) {
    return options?.scriptKey || window.__alunixaXUserScripts?.currentKey || "";
  }

  /** 注册一个带 order 的拓展项，统一处理 id 前缀与失败上报。 */
  function alunixaXRegisterExtensionItem(kind, registry, definition, options = {}) {
    const scriptKey = alunixaXCurrentExtensionScriptKey(options);
    const id = `${scriptKey}:${kind}:${options.id || alunixaXExtensionIdSeed()}`;
    const dispose = registerCodexPlusExtension(kind, registry, id, definition, scriptKey);
    // 注册后立刻让所有入口重画一次，否则用户要等下一次 scan 才看得到新项。
    alunixaXRefreshExtensionHosts();
    return () => {
      dispose();
      alunixaXRefreshExtensionHosts();
    };
  }

  let alunixaXExtensionIdCounter = 0;
  function alunixaXExtensionIdSeed() {
    alunixaXExtensionIdCounter += 1;
    return `item-${alunixaXExtensionIdCounter}`;
  }

  /**
   * 通知各消费方重画。
   *
   * 每个消息都可能有消费方尚未初始化（例如浮层面板按需注入、overlay 未打开），
   * 所以逐项 try/catch，任何一个不存在或抛错都不影响其余。
   */
  function alunixaXRefreshExtensionHosts() {
    for (const refresh of [
      refreshCodexPlusPageNav,
      refreshCodexPlusRailNavigation,
      refreshExtensionSessionRows,
      refreshCodexPlusExtensionMenu,
    ]) {
      try {
        refresh?.();
      } catch {}
    }
  }

  /**
   * 已打开的菜单里补上／摘掉拓展项。
   *
   * 菜单是打开时一次性构建的 innerHTML，注册发生在它打开之后时不会自动出现。
   * 这里只处理「已打开」这一种情况：整块替换掉带 data-alunixa-x-ext-menu 的容器。
   * 菜单没打开时什么都不做——下次打开自然会带上。
   */
  function refreshCodexPlusExtensionMenu() {
    const overlay = document.querySelector(".alunixa-x-modal-overlay, .alunixa-x-page-overlay");
    if (!overlay) return;
    const panel = overlay.querySelector('[data-alunixa-x-panel="home"]');
    if (!panel) return;
    panel.querySelector("[data-alunixa-x-ext-menu]")?.remove();
    const markup = renderCodexPlusExtensionMenuRows();
    if (markup) panel.insertAdjacentHTML("beforeend", markup);
  }

  /** 会话行按钮重画：让扫描在下一轮把这些行重建，从而带上拓展的项。 */
  function refreshExtensionSessionRows() {
    try {
      sessionRows().forEach((row) => {
        const group = actionGroupFromRow(row);
        if (group) delete group.dataset.codexActionLayoutStable;
      });
    } catch {}
  }

  /**
   * 构建对外对象。
   *
   * 拆成函数而不是直接字面量，是为了让 99-tail 之前的挂载点能按顺序装配：
   * 依赖的函数都已在同一闭包里，此处只做引用。
   */
  function buildCodexPlusExtensionApi() {
    return {
      version: alunixaXExtensionAdapterVersion,
      apiVersion: alunixaXExtensionApiVersion,
      constants: alunixaXExtensionConstants,
      // 用 getter 而不是快照：脚本初始化结束后再读也能拿到自己的 key。
      get script() {
        return { key: alunixaXCurrentExtensionScriptKey() };
      },

      /** 显示提示。type: info | success | warn | error */
      toast(message, options) {
        return runCodexPlusExtensionCallback(
          alunixaXCurrentExtensionScriptKey(),
          "toast",
          () => showToast(String(message ?? ""), options || {}),
        );
      },

      /** 调用后端白名单路由，失败时 reject。 */
      call: alunixaXExtensionCall,

      /** 在会话行「更多操作」里加一项。 */
      registerRowAction(definition, options = {}) {
        return alunixaXRegisterExtensionItem("rowAction", alunixaXRegistry.rowActions, definition, options);
      },

      /** 加一个图标栏入口（点击后走 registerPage 注册的页面）。 */
      registerNavEntry(definition, options = {}) {
        return alunixaXRegisterExtensionItem("navEntry", alunixaXRegistry.navEntries, definition, options);
      },

      /**
       * 在 Alunixa X 菜单的「主页」面板里加一行。
       *
       * 两种形态，按 definition 里给的字段决定：
       *   - 开关：给 `onChange(next)`，可选 `toggleValue()` 提供当前值
       *   - 按钮：给 `onActivate({ close })`
       *
       * 这些是 Alunixa X 自己的设置面板，改动会立刻反映到当前打开的菜单上；
       * 菜单重新打开时会从 `toggleValue()` 重新读一次状态。
       */
      registerMenuItem(definition, options = {}) {
        return alunixaXRegisterExtensionItem("menuItem", alunixaXRegistry.menuItems, definition, options);
      },

      /**
       * 注册一个整页视图。
       *
       * 同时自动配一个图标栏入口——内置的三个页面（Alunixa X / 拓展 / 推荐内容）
       * 都是「rail 入口 + 整页」的形态，第三方页面沿用同一种形态，用户才不会
       * 在弹窗里找入口。`options.navLabel` / `options.icon` 控制入口外观。
       *
       * render 每次打开都被重新调用，不要缓存 DOM（见本文件顶部的生命周期约定）。
       */
      registerPage(definition, options = {}) {
        const scriptKey = alunixaXCurrentExtensionScriptKey(options);
        const pageId = `${scriptKey}:page:${options.id || alunixaXExtensionIdSeed()}`;
        const disposePage = registerCodexPlusExtension("page", alunixaXRegistry.pages, pageId, definition, scriptKey);
        // 入口与页面成对存在：页面没了，入口也该消失，否则点了没有任何反应。
        const entry = {
          ...definition,
          label: options.navLabel || definition.navLabel || definition.title || pageId,
          icon: options.icon || definition.icon,
          pageId,
          order: Math.max(1000, Number.isFinite(options.order) ? Number(options.order) : 0),
        };
        const navId = `${scriptKey}:navEntry:${pageId}`;
        let disposeNav = null;
        try {
          disposeNav = registerCodexPlusExtension("navEntry", alunixaXRegistry.navEntries, navId, entry, scriptKey);
        } catch {
          // 入口注册失败（配额满）时页面本身仍可用，不要回滚已成功的页面注册。
        }
        alunixaXRefreshExtensionHosts();
        return () => {
          try {
            disposeNav?.();
          } catch {}
          disposePage();
          alunixaXRefreshExtensionHosts();
        };
      },

      /** 注册清理函数，热重载时逆序执行。 */
      onCleanup(cleanup) {
        return window.__alunixaXUserScripts?.registerCleanup?.(cleanup);
      },

      /** 主动上报失败，供异步阶段的错误使用（同步阶段由 wrap_script 捕获）。 */
      fail(error) {
        alunixaXMarkExtensionFailure(
          window.__alunixaXUserScripts?.currentKey,
          String(error?.stack || error?.message || error),
        );
      },
    };
  }
  /**
   * 拓展宿主：把注册中心里的第三方项渲染出来。
   *
   * 与 91-extension-api.js 的分工：那边负责「收」（校验、配额、挂 API），这边负责
   * 「画」（把数据变成 DOM）。分开是因为画的部分要贴着既有 UI 的类名与结构走，
   * 而收的部分只需要一份数据契约。
   *
   * 全部采用「追加」而不是「重写」：内置项仍由原路径渲染，拓展项在其后补上。
   * 这样内置 UI 的行为零变化，出问题时摘掉这个分片即可回滚。
   */

  /**
   * 拓展节点的统一标记，扫描调度靠它识别（见 01-registry.js 的注释）。
   *
   * 选择器按「有归属/无归属」两档登记，而不是按脚本 key 逐个登记：一个脚本可能
   * 注册很多项，按 key 登记会白白吃掉全局选择器配额（上限 64），而扫描调度只需要
   * 知道「这个节点是我们的」——精确到脚本对排除自喂循环没有任何额外价值。
   */
  function markCodexPlusExtensionNode(node, scriptKey) {
    node.setAttribute(alunixaXExtensionConstants.extensionAttribute, scriptKey || "");
    registerCodexPlusExtensionSelector(`[${alunixaXExtensionConstants.extensionAttribute}]`);
    return node;
  }

  /** 取一个拓展项的图标：允许传 SVG 字符串，没给就用默认字形。 */
  function alunixaXExtensionIconMarkup(definition) {
    const icon = definition?.icon;
    if (typeof icon !== "string" || !icon.trim()) return `<span aria-hidden="true">◇</span>`;
    // 只接受 svg 或文本字形：注入任意 HTML 会让拓展有机会破坏内置 UI 结构。
    if (/^\s*<svg[\s>]/i.test(icon)) return `<span class="alunixa-x-ext-icon" aria-hidden="true">${icon}</span>`;
    return `<span class="alunixa-x-ext-icon" aria-hidden="true">${escapeHtml(icon)}</span>`;
  }

  /**
   * 打开一个拓展注册的整页视图。
   *
   * 复用内置的页面骨架（rail 高亮同步、缩放跟随、原生选中态压制都白拿），只是把
   * 内容区换掉。注意 overlay 每次打开都重建，所以 render 每次都要重新调用。
   */
  function openCodexPlusExtensionPage(id) {
    const definition = alunixaXRegistry.pages.get(id);
    if (!definition) return false;
    openCodexPlusModalForExtension(id, definition);
    return true;
  }

  /**
   * 渲染拓展页面。
   *
   * 不走 openCodexPlusModal 是因为那个函数的内容区来自内置模板字符串；这里要的是
   * 同一套外壳 + 自定义内容，所以单独走一遍，但外壳结构与类名完全对齐。
   */
  function openCodexPlusModalForExtension(id, definition) {
    document.querySelectorAll(".alunixa-x-modal-overlay").forEach((node) => node.remove());
    document.querySelectorAll(`.${alunixaXPageClass}, [data-alunixa-x-dialog="true"]`).forEach((node) => node.remove());
    const overlay = document.createElement("div");
    overlay.className = alunixaXPageClass;
    overlay.dataset.alunixaXPage = "true";
    overlay.dataset.alunixaXExtensionPage = id;
    applyCodexPlusTheme(overlay);
    // 必须在写 innerHTML 之前设好缩放，否则内部 calc 会先按 1 算一遍（见内置实现注释）。
    applyCodexPlusZoom(overlay);
    overlay.innerHTML = `
      <div class="alunixa-x-modal-content" role="dialog" aria-modal="true" aria-label="${escapeHtml(definition.title || "拓展页面")}">
        <div class="alunixa-x-modal-header">
          <div class="alunixa-x-modal-title"><span class="alunixa-x-backend-indicator" data-codex-backend-indicator="true" data-status="checking"></span><span>${escapeHtml(definition.title || "拓展页面")}</span></div>
        </div>
        <div class="alunixa-x-modal-body">
          <div class="alunixa-x-panel" data-alunixa-x-panel="extension" data-alunixa-x-extension-panel="${id}"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    positionCodexPlusPage(overlay);
    // 拓展入口不在内置的三个 id 里，setCodexPlusSidebarNavActive 认不出来，
    // 所以自己点亮该入口，再调一次 sync 让原生选中态被压下去。
    setCodexPlusExtensionNavActive(id);
    window.removeEventListener("resize", window.__alunixaXPageResizeHandler);
    window.__alunixaXPageResizeHandler = () => positionCodexPlusPage(overlay);
    window.addEventListener("resize", window.__alunixaXPageResizeHandler);
    // 与内置页面一致：点图标栏上的任何原生按钮就关掉这个覆盖层。
    //
    // 注意必须连拓展自己的入口一起排除：拓展入口 id 是动态生成的，不在那三个内置
    // id 里，若只排除内置项，点自己的入口会被当成「点了原生按钮」，页面刚打开就
    // 被这条监听关掉。
    const rail = document.querySelector(alunixaXRailSelector);
    rail?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest(`#${alunixaXRailNavId}, #${alunixaXRailExtensionsId}, #${alunixaXRailSponsorId}`)) return;
      if (target?.closest(`[${alunixaXExtensionConstants.extensionAttribute}]`)) return;
      if (target?.closest("button, a")) closeCodexPlusPageAfterNativeNavigation();
    }, true);

    const panel = overlay.querySelector(`[data-alunixa-x-extension-panel="${id}"]`);
    if (!panel) return;
    // 拓展的 render 每次打开都重新调用，禁止缓存 DOM——见 91 顶部的生命周期约定。
    const outcome = runCodexPlusExtensionCallback(definition.scriptKey, "page.render", () =>
      definition.render({ container: panel, close: () => closeCodexPlusPage(), script: definition.scriptKey }));
    if (!outcome.ok) {
      panel.innerHTML = `<div class="alunixa-x-row"><div><div class="alunixa-x-row-title">拓展页面加载失败</div><div class="alunixa-x-row-description">${escapeHtml(definition.scriptKey || "")}：${escapeHtml(outcome.error)}</div></div></div>`;
      panel.dataset.extensionError = "true";
    }
    definition.onCleanup && runCodexPlusExtensionCallback(definition.scriptKey, "page.onCleanup", () => {
      window.__alunixaXExtensionPageCleanup = definition.onCleanup;
    });
  }

  /**
   * 点亮某个拓展的图标栏入口。
   *
   * 内置的 setCodexPlusSidebarNavActive 只认三个固定 id，拓展入口的 id 是动态的，
   * 所以这里单独处理：先把内置项全部置为未选中，再点亮目标，最后统一压原生选中态。
   */
  function setCodexPlusExtensionNavActive(pageId) {
    setCodexPlusSidebarNavActive(false);
    const entry = alunixaXExtensionItems(alunixaXRegistry.navEntries)
      .find((item) => item.pageId === pageId);
    const elementId = entry ? `alunixa-x-ext-rail-${entry.id.replace(/[^\w-]/g, "_")}` : "";
    // 先清掉所有拓展入口的选中态，避免两个页面之间切换时残留。
    document.querySelectorAll('[data-alunixa-x-ext-rail-active="true"]').forEach((node) => {
      node.removeAttribute("data-alunixa-x-ext-rail-active");
      const button = node.querySelector("button") || node;
      button?.removeAttribute("data-selected");
      button?.removeAttribute("aria-current");
    });
    if (!elementId) return;
    const wrapper = document.getElementById(elementId);
    if (!wrapper) return;
    wrapper.setAttribute("data-alunixa-x-ext-rail-active", "true");
    const button = wrapper.querySelector("button") || wrapper;
    button.dataset.active = "true";
    button.setAttribute("aria-current", "page");
    button.setAttribute("data-selected", "");
    // setCodexPlusSidebarNavActive(false) 内部的 sync 是在还没有选中项时跑的，
    // 这里要再跑一次，否则原生选中态压制会基于过期状态。
    syncCodexPlusRailNativeSelection();
  }

  /** 关闭当前拓展页面并执行其 onCleanup。 */
  function closeCodexPlusPage() {
    const cleanup = window.__alunixaXExtensionPageCleanup;
    window.__alunixaXExtensionPageCleanup = null;
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch {}
    }
    window.removeEventListener("resize", window.__alunixaXPageResizeHandler);
    document.querySelectorAll(`.${alunixaXPageClass}`).forEach((node) => node.remove());
    setCodexPlusSidebarNavActive(false);
  }

  /** 拓展入口的 DOM 标记：用它反查注册表项，dispose 后据此清理。 */
  const alunixaXExtensionRailAttribute = "data-alunixa-x-ext-rail";

  /** 拓展入口的稳定 id。用注册表 id 推导，dispose 与重建都能算回同一个值。 */
  function alunixaXExtensionRailElementId(entry) {
    return `alunixa-x-ext-rail-${String(entry.id).replace(/[^\w-]/g, "_")}`;
  }

  /**
   * 图标栏上的拓展入口。
   *
   * 与内置的三个入口并列插在 primary 锚点之后。内置项由
   * installCodexPlusRailNavigation 负责，这里只补第三方项，靠 id 幂等。
   */
  function refreshCodexPlusRailNavigation() {
    const rail = document.querySelector(alunixaXRailSelector);
    if (!rail) return false;
    const entries = alunixaXExtensionItems(alunixaXRegistry.navEntries);
    // 注意值域：属性里存的是注册表 id，所以这里也必须用注册表 id 比对。
    // 若拿元素 id（alunixa-x-ext-rail-xxx）去比，两边永远不等，每次刷新都会把
    // 自己的入口当孤儿删掉，表现为「点了入口高亮立刻消失」。
    const liveIds = new Set(entries.map((entry) => entry.id));
    // 先清掉已不在注册表里的入口。dispose 之后没人来删 DOM，必须在这里收口，
    // 否则用户点一个已经注销的入口会什么都不发生。
    document.querySelectorAll(`[${alunixaXExtensionRailAttribute}]`).forEach((node) => {
      if (!liveIds.has(node.getAttribute(alunixaXExtensionRailAttribute) || "")) node.remove();
    });
    if (!entries.length) return false;
    const anchor = alunixaXRailPrimaryAnchor(rail);
    const host = anchor?.parentElement || rail;
    const template = alunixaXRailTemplateButton(rail);
    let cursor = anchor;
    // 内置三项先占位，第三方从它们之后开始排。
    [alunixaXRailNavId, alunixaXRailExtensionsId, alunixaXRailSponsorId].forEach((id) => {
      const node = document.getElementById(id);
      if (node) cursor = node;
    });
    entries.forEach((entry) => {
      const elementId = alunixaXExtensionRailElementId(entry);
      let wrapper = document.getElementById(elementId);
      if (!wrapper || wrapper.parentElement !== host) {
        wrapper?.remove();
        wrapper = createCodexPlusRailButton({
          id: elementId,
          template,
          label: entry.label || entry.id,
          iconMarkup: alunixaXExtensionIconMarkup(entry),
          withStatus: false,
          onActivate: () => {
            // 注册时若带了 pageId 就打开对应页面；否则交给拓展自己的 onActivate。
            const navigate = () => {
              if (entry.pageId && alunixaXRegistry.pages.has(entry.pageId)) {
                entry.navId = elementId;
                openCodexPlusExtensionPage(entry.pageId);
              } else if (typeof entry.onActivate === "function") {
                runCodexPlusExtensionCallback(entry.scriptKey, "navEntry.onActivate", () => entry.onActivate());
              }
            };
            navigate();
          },
        });
        if (!wrapper) return;
        // 这个属性是 dispose 后清理 DOM 的唯一线索，必须写。只靠
        // data-alunixa-x-ext 认不出「这是 rail 入口」还是别的什么扩展节点。
        wrapper.setAttribute(alunixaXExtensionRailAttribute, entry.id);
        markCodexPlusExtensionNode(wrapper, entry.scriptKey);
        markCodexPlusExtensionNode(wrapper.firstElementChild || wrapper, entry.scriptKey);
      }
      if (cursor?.nextSibling) {
        if (cursor.nextSibling !== wrapper) host.insertBefore(wrapper, cursor.nextSibling);
      } else if (cursor) {
        host.appendChild(wrapper);
      }
      cursor = wrapper;
    });
    return true;
  }

  /**
   * 拓展注册的菜单项。
   *
   * 接入方式是「在 home 面板末尾追加一块」而不是把内置的一百多行模板拆成数组——
   * 拆模板动的是内置 UI 主干，出问题会影响所有人；追加只影响新内容，回滚时删掉
   * 这个调用即可。
   *
   * 每次 openCodexPlusModal 都会重新调用，所以不需要在别处维护刷新逻辑。
   */
  function renderCodexPlusExtensionMenuRows() {
    const items = alunixaXExtensionItems(alunixaXRegistry.menuItems);
    if (!items.length) return "";
    const rows = items.map((item) => {
      const title = escapeHtml(item.label || item.id);
      const description = escapeHtml(item.description || "");
      // 有 onChange 的渲染成开关，否则渲染成动作按钮。
      let control;
      if (typeof item.onChange === "function") {
        const enabled = typeof item.toggleValue === "function" ? item.toggleValue() === true : false;
        control = `<button type="button" class="alunixa-x-toggle" data-alunixa-x-ext-setting="${escapeHtml(item.id)}" data-enabled="${String(enabled)}" aria-pressed="${String(enabled)}"><span></span></button>`;
      } else {
        control = `<button type="button" class="alunixa-x-action-button" data-alunixa-x-ext-action="${escapeHtml(item.id)}">${escapeHtml(item.buttonLabel || "打开")}</button>`;
      }
      return `<div class="alunixa-x-row" data-alunixa-x-ext-row="${escapeHtml(item.id)}">`
        + `<div><div class="alunixa-x-row-title">${title}</div>`
        + (description ? `<div class="alunixa-x-row-description">${description}</div>` : "")
        + `</div>${control}</div>`;
    }).join("");
    // 整块包一层：dispose 后能一次性摘掉，测试也好定位。
    return `<div data-alunixa-x-ext-menu="true">${rows}</div>`;
  }

  /**
   * 处理拓展菜单项的点击。
   *
   * 由 openCodexPlusModal 的委托监听调用；返回 true 表示已处理，调用方应 return。
   */
  function handleCodexPlusExtensionMenuClick(target) {
    const action = target?.closest?.("[data-alunixa-x-ext-action]");
    if (action) {
      const id = action.getAttribute("data-alunixa-x-ext-action") || "";
      const item = alunixaXRegistry.menuItems.get(id);
      if (!item) return true;
      runCodexPlusExtensionCallback(item.scriptKey, "menuItem.onActivate", () =>
        item.onActivate({ close: () => document.querySelector(".alunixa-x-modal-close")?.click() }));
      return true;
    }
    const toggle = target?.closest?.("[data-alunixa-x-ext-setting]");
    if (toggle) {
      const id = toggle.getAttribute("data-alunixa-x-ext-setting") || "";
      const item = alunixaXRegistry.menuItems.get(id);
      if (!item) return true;
      const next = toggle.getAttribute("data-enabled") !== "true";
      toggle.setAttribute("data-enabled", String(next));
      toggle.setAttribute("aria-pressed", String(next));
      runCodexPlusExtensionCallback(item.scriptKey, "menuItem.onChange", () => item.onChange(next));
      return true;
    }
    return false;
  }

  /**
   * 会话行「更多操作」里的拓展项。
   *
   * 由 attachButton 在构建 moreMenu 时调用。返回的节点直接 append 进菜单，
   * 所以样式与内置项一致；点击后关闭菜单再执行回调。
   */
  function appendCodexPlusExtensionRowActions(moreMenu, row, moreButton) {
    const items = alunixaXExtensionItems(alunixaXRegistry.rowActions);
    if (!items.length) return;
    items.forEach((definition) => {
      const item = createSessionMoreMenuItem(definition.label || definition.id, definition.icon || "◇", (event) => {
        stopActionButtonEvent(row, moreButton, event);
        closeSessionMoreMenus();
        runCodexPlusExtensionCallback(definition.scriptKey, "rowAction.onActivate", () =>
          definition.onActivate({
            row,
            session_id: sessionRefFromRow(row).session_id,
            close: () => closeSessionMoreMenus(),
          }));
      });
      // 加分隔线：拓展项与内置项在语义上没有关联，挨着排会让人以为是一组。
      item.dataset.alunixaXExtensionItem = definition.id;
      markCodexPlusExtensionNode(item, definition.scriptKey);
      moreMenu.appendChild(item);
    });
  }
  // API Key 听写使用独立的 ASR 服务。新版原生 capability / app-host RPC 是只读的，
  // 因此入口与录音由 CPP 管理，识别结果通过原生编辑器事务回填，保持草稿和附件。
  window.__alunixaXDictationRuntime?.dispose?.();
  const alunixaXDictation = {
    phase: "idle", revision: 0, target: null, stream: null, recorder: null,
    chunks: [], blob: null, text: "", error: "", action: "insert", startedAt: 0,
    controller: null, timer: null, status: null, statusAt: 0, statusPromise: null,
    nativeApi: null, nativeApiPromise: null, pendingSend: false,
  };
  const alunixaXDictationMaxBytes = 25 * 1024 * 1024;
  registerCodexPlusExtensionSelector('[data-alunixa-x-ext="builtin-dictation"]');

  function alunixaXDictationEnabled() {
    return alunixaXBackendSettingsLoaded && alunixaXBackendSettings.enhancementsEnabled !== false
      && alunixaXBackendSettings.dictation?.enabled === true;
  }

  function alunixaXDictationEditor(scope) {
    return [...scope.querySelectorAll('.ProseMirror[contenteditable="true"], textarea:not(:disabled):not([readonly]), [role="textbox"][contenteditable="true"]')]
      .find((node) => visibleElement(node) && !isExtensionUiNode(node) && !node.closest('[inert], [aria-hidden="true"]')) || null;
  }

  function alunixaXDictationScope(footer) {
    let scope = footer?.parentElement;
    while (scope && scope !== document.body) {
      if (alunixaXDictationEditor(scope)) return scope;
      if (scope.matches?.('[data-codex-composer-root], [data-composer-surface-variant], form')) break;
      scope = scope.parentElement;
    }
    return null;
  }

  function alunixaXDictationTargetEditor() {
    const target = alunixaXDictation.target;
    if (!target || window.location.href !== target.href) return null;
    const editor = [...document.querySelectorAll('[data-alunixa-x-dictation-target]')]
      .find((node) => node.dataset.alunixaXDictationTarget === target.id && visibleElement(node));
    if (editor) return editor;
    const root = [...document.querySelectorAll('[data-alunixa-x-dictation-root]')]
      .find((node) => node.dataset.alunixaXDictationRoot === target.id && visibleElement(node));
    return root ? alunixaXDictationEditor(root) : null;
  }

  async function loadCodexPlusDictationNativeApi() {
    if (alunixaXDictation.nativeApiPromise) return alunixaXDictation.nativeApiPromise;
    alunixaXDictation.nativeApiPromise = loadOptionalCodexAppModule("app-initial-").then((module) => {
      // 构建间压缩导出名会变化，只按能力识别函数；从不写 ESM namespace。
      const functions = Object.values(module || {}).filter((value) => typeof value === "function");
      const append = functions.find((fn) => {
        const source = String(fn);
        return source.length < 3000 && source.includes(".composerId===") && source.includes(".appendPromptText")
          && source.includes(".isDictationInProgress") && source.includes("[readonly]") && source.includes(".focus()");
      });
      const context = functions.find((fn) => {
        const source = String(fn);
        return source.length < 3000 && source.includes("document.activeElement?.closest")
          && source.includes("[data-codex-composer-root]") && source.includes("composerId:") && source.includes("root:");
      });
      alunixaXDictation.nativeApi = append && context ? { append, context } : null;
      return alunixaXDictation.nativeApi;
    }).catch(() => null);
    return alunixaXDictation.nativeApiPromise;
  }

  function alunixaXDictationView(editor) {
    const view = editor?.pmViewDesc?.view;
    return view && !view.isDestroyed && view.dom === editor && view.state?.tr && typeof view.dispatch === "function" ? view : null;
  }

  function alunixaXInsertDictation(editor, transcript, nativeApi = alunixaXDictation.nativeApi, composerId = alunixaXDictation.target?.composerId) {
    const text = String(transcript || "").trim();
    if (!text || !editor?.isConnected || editor.matches?.(':disabled, [readonly], [contenteditable="false"]')
        || editor.closest?.('[inert], [aria-hidden="true"]')) return false;
    editor.focus();
    if (nativeApi && composerId) {
      const context = nativeApi.context();
      if (context?.composerId !== composerId || !context.root?.contains(editor)) return false;
      return nativeApi.append(composerId, text) === true;
    }
    const view = alunixaXDictationView(editor);
    if (view) {
      // 用原生事务更新 React/ProseMirror 状态；不能直接改 innerHTML/textContent。
      const { from, to } = view.state.selection;
      const before = view.state.doc.textBetween(Math.max(0, from - 1), from, "\n");
      const prefix = before && !/\s$/.test(before) ? " " : "";
      view.dispatch(view.state.tr.insertText(prefix + text, from, to).scrollIntoView());
      return true;
    }
    if (editor instanceof HTMLTextAreaElement) {
      const from = editor.selectionStart ?? editor.value.length;
      const to = editor.selectionEnd ?? from;
      const prefix = from > 0 && !/\s/.test(editor.value[from - 1]) ? " " : "";
      const inserted = prefix + text;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(editor, editor.value.slice(0, from) + inserted + editor.value.slice(to));
      editor.setSelectionRange(from + inserted.length, from + inserted.length);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // 老版本的 contenteditable 交给浏览器编辑命令，失败时保留可复制的识别结果。
    const selection = window.getSelection?.();
    if (document.activeElement !== editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return false;
    return document.execCommand("insertText", false, text) === true;
  }

  function alunixaXDictationSendButton(editor) {
    let scope = editor.parentElement;
    while (scope && scope !== document.body) {
      const button = [...scope.querySelectorAll('button')].find((node) => {
        if (isExtensionUiNode(node) || !visibleElement(node) || node.disabled || node.getAttribute("aria-disabled") === "true") return false;
        const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`.trim();
        return /^(?:Send|Send message|Send prompt|Submit|发送|发送消息|发送提示|提交)(?:\s|\(|（|$)/i.test(label)
          || node.getAttribute("data-testid") === "send-button" || node.getAttribute("data-action") === "send";
      });
      if (button) return button;
      if (scope.hasAttribute("data-codex-composer-root") || scope.hasAttribute("data-composer-surface-variant") || scope.tagName === "FORM") break;
      scope = scope.parentElement;
    }
    return null;
  }

  function alunixaXDictationStopTracks() {
    alunixaXDictation.stream?.getTracks().forEach((track) => track.stop());
    alunixaXDictation.stream = null;
    clearInterval(alunixaXDictation.timer);
    alunixaXDictation.timer = null;
  }

  function cancelCodexPlusDictation() {
    ++alunixaXDictation.revision;
    alunixaXDictation.controller?.abort();
    alunixaXDictation.controller = null;
    const recorder = alunixaXDictation.recorder;
    alunixaXDictation.recorder = null;
    if (recorder?.state !== "inactive") { try { recorder?.stop(); } catch {} }
    alunixaXDictationStopTracks();
    document.querySelectorAll('[data-alunixa-x-dictation-target], [data-alunixa-x-dictation-root]').forEach((node) => {
      delete node.dataset.alunixaXDictationTarget; delete node.dataset.alunixaXDictationRoot;
    });
    Object.assign(alunixaXDictation, { phase: "idle", target: null, chunks: [], blob: null, text: "", error: "", pendingSend: false });
    renderCodexPlusDictation();
  }

  async function loadCodexPlusDictationStatus(force = false) {
    if (alunixaXDictation.statusPromise) return alunixaXDictation.statusPromise;
    if (!force && Date.now() - alunixaXDictation.statusAt < 5000) return alunixaXDictation.status;
    alunixaXDictation.statusPromise = postJson("/dictation/status", {}).then((status) => {
      alunixaXDictation.status = status;
      alunixaXDictation.statusAt = Date.now();
      return status;
    }).finally(() => { alunixaXDictation.statusPromise = null; });
    return alunixaXDictation.statusPromise;
  }

  async function startCodexPlusDictation(footer) {
    if (!alunixaXDictationEnabled() || alunixaXDictation.phase !== "idle") return;
    const editor = alunixaXDictationScope(footer) && alunixaXDictationEditor(alunixaXDictationScope(footer));
    if (!editor) { showToast("无法找到可编辑的 Codex 输入框", null); return; }
    if (footer.getAttribute("data-dictation-view")) { showToast("请先结束原生语音输入", null); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== "function") {
      showToast("当前环境不支持麦克风录音", null); return;
    }
    const revision = ++alunixaXDictation.revision;
    const id = crypto.randomUUID();
    editor.dataset.alunixaXDictationTarget = id;
    Object.assign(alunixaXDictation, {
      phase: "requesting", target: { id, href: window.location.href },
      error: "", text: "", chunks: [], blob: null, action: "insert",
    });
    installCodexPlusDictation();
    try {
      const nativeApi = await loadCodexPlusDictationNativeApi();
      if (revision !== alunixaXDictation.revision) return;
      if (!alunixaXDictationTargetEditor()) throw new Error("输入框或会话已变化，请返回目标会话后重录");
      editor.focus();
      const context = nativeApi?.context();
      if (context?.root?.contains(editor) && context.composerId) {
        alunixaXDictation.target.composerId = context.composerId;
        context.root.dataset.alunixaXDictationRoot = id;
      }
      const status = await loadCodexPlusDictationStatus(true);
      if (revision !== alunixaXDictation.revision) return;
      if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
      if (!status?.enabled || !status?.configured || !status?.helperToken) throw new Error(status?.message || "请先在管理工具中配置并启用语音服务");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      if (revision !== alunixaXDictation.revision) {
        stream.getTracks().forEach((track) => track.stop()); return;
      }
      if (!alunixaXDictationEnabled()) {
        stream.getTracks().forEach((track) => track.stop()); cancelCodexPlusDictation(); return;
      }
      alunixaXDictation.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      alunixaXDictation.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (revision !== alunixaXDictation.revision || !event.data?.size) return;
        alunixaXDictation.chunks.push(event.data);
        if (alunixaXDictation.chunks.reduce((sum, chunk) => sum + chunk.size, 0) > alunixaXDictationMaxBytes) {
          alunixaXDictation.error = "录音超过 25 MiB，请缩短后重录";
          stopCodexPlusDictation("discard");
        }
      };
      recorder.onerror = () => {
        if (revision !== alunixaXDictation.revision) return;
        alunixaXDictation.error = "录音失败，请检查麦克风后重录";
        stopCodexPlusDictation("discard");
      };
      recorder.onstop = () => {
        if (revision !== alunixaXDictation.revision) return;
        alunixaXDictationStopTracks();
        alunixaXDictation.recorder = null;
        const blob = new Blob(alunixaXDictation.chunks, { type: recorder.mimeType || "audio/webm" });
        alunixaXDictation.chunks = [];
        if (alunixaXDictation.action === "discard" || blob.size > alunixaXDictationMaxBytes) {
          alunixaXDictation.phase = "error"; renderCodexPlusDictation(); return;
        }
        if (!blob.size || Date.now() - alunixaXDictation.startedAt < 250) { cancelCodexPlusDictation(); return; }
        alunixaXDictation.blob = blob;
        void transcribeCodexPlusDictation();
      };
      recorder.start(1000);
      alunixaXDictation.phase = "recording";
      alunixaXDictation.startedAt = Date.now();
      alunixaXDictation.timer = setInterval(() => {
        if (Date.now() - alunixaXDictation.startedAt >= 595000) stopCodexPlusDictation("insert");
        renderCodexPlusDictation();
      }, 1000);
      renderCodexPlusDictation();
    } catch (error) {
      if (revision !== alunixaXDictation.revision) return;
      alunixaXDictationStopTracks();
      alunixaXDictation.phase = "error";
      alunixaXDictation.error = ["NotAllowedError", "SecurityError"].includes(error?.name)
        ? "麦克风权限被拒绝，请在系统设置中允许 Codex 使用麦克风后重录"
        : error?.name === "NotFoundError" ? "未找到麦克风" : error?.message || "无法开始录音";
      renderCodexPlusDictation();
    }
  }

  function stopCodexPlusDictation(action) {
    alunixaXDictation.action = action;
    if (alunixaXDictation.phase === "transcribing") { renderCodexPlusDictation(); return; }
    if (alunixaXDictation.phase !== "recording") return;
    alunixaXDictation.phase = "transcribing";
    clearInterval(alunixaXDictation.timer);
    try { alunixaXDictation.recorder.stop(); }
    catch { alunixaXDictationStopTracks(); alunixaXDictation.phase = "error"; alunixaXDictation.error = "无法结束录音，请重录"; }
    renderCodexPlusDictation();
  }

  async function finishCodexPlusDictation() {
    if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
    const editor = alunixaXDictationTargetEditor();
    if (!editor || !alunixaXInsertDictation(editor, alunixaXDictation.text)) {
      alunixaXDictation.phase = "result";
      alunixaXDictation.error = "输入框或会话已变化，请复制识别结果到目标输入框";
      renderCodexPlusDictation(); return;
    }
    const send = alunixaXDictation.action === "send";
    const target = { ...alunixaXDictation.target };
    cancelCodexPlusDictation();
    if (send) {
      const revision = alunixaXDictation.revision;
      alunixaXDictation.pendingSend = true;
      // 给原生状态一个渲染周期，再点击它自己的发送按钮；找不到时保留已插入的草稿。
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (revision !== alunixaXDictation.revision) return;
      alunixaXDictation.pendingSend = false;
      if (!alunixaXDictationEnabled() || window.location.href !== target.href) return;
      const context = alunixaXDictation.nativeApi?.context();
      const currentEditor = target.composerId && context?.composerId === target.composerId
        ? alunixaXDictationEditor(context.root) : editor.isConnected && !target.composerId ? editor : null;
      if (!currentEditor) return;
      const button = alunixaXDictationSendButton(currentEditor);
      if (button) button.click();
      else showToast("识别结果已插入，请点击发送", null);
    }
  }

  async function alunixaXDictationAudioBase64(blob, signal) {
    if (blob.size > alunixaXDictationMaxBytes) throw new Error("录音超过 25 MiB，请缩短后重录");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let encoded = "";
    // 按 3 字节对齐分段编码，避免一次展开大录音耗尽调用栈；让取消事件有机会执行。
    for (let offset = 0; offset < bytes.length; offset += 49152) {
      if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
      encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 49152)));
      if (offset && offset % (49152 * 8) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return encoded;
  }

  // SenseVoice 接收 16 kHz/单声道 PCM WAV；MediaRecorder 在 Chromium 中通常只提供 WebM/Opus，
  // 因此只在选择本地 provider 时通过浏览器音频解码器做一次无损 PCM 转换。
  async function alunixaXDictationSenseVoiceWav(blob, signal) {
    if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const OfflineContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioContextCtor || !OfflineContextCtor) throw new Error("当前环境无法转换本地 SenseVoice 音频");
    const context = new AudioContextCtor();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
      const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
      const offline = new OfflineContextCtor(1, frames, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const bytes = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(bytes);
      const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
      write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      write(36, "data"); view.setUint32(40, samples.length * 2, true);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return new Blob([bytes], { type: "audio/wav" });
    } finally {
      void context.close?.();
    }
  }

  async function transcribeCodexPlusDictation() {
    if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
    if (!alunixaXDictation.blob) return;
    const revision = ++alunixaXDictation.revision;
    const controller = new AbortController();
    alunixaXDictation.controller = controller;
    alunixaXDictation.phase = "transcribing";
    alunixaXDictation.error = "";
    renderCodexPlusDictation();
    let cancelRequest = null;
    try {
      const status = await loadCodexPlusDictationStatus(true);
      if (revision !== alunixaXDictation.revision) return;
      if (!status?.enabled || !status?.configured || !status?.helperToken) throw new Error(status?.message || "语音服务尚未配置");
      const requestId = crypto.randomUUID();
      let requestStarted = false;
      cancelRequest = () => {
        if (requestStarted) void postJson("/dictation/cancel", { requestId, helperToken: status.helperToken }).catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelRequest, { once: true });
      const uploadBlob = status.provider === "sensevoice"
        ? await alunixaXDictationSenseVoiceWav(alunixaXDictation.blob, controller.signal)
        : alunixaXDictation.blob;
      const audioBase64 = await alunixaXDictationAudioBase64(uploadBlob, controller.signal);
      if (revision !== alunixaXDictation.revision || controller.signal.aborted) return;
      if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
      const extension = uploadBlob.type.includes("wav") ? "wav" : uploadBlob.type.includes("mp4") ? "m4a" : "webm";
      requestStarted = true;
      // app:// 的 CSP 不允许 renderer 直接 fetch localhost；音频经既有特权桥接交给 Rust。
      const result = await postJson("/dictation/transcribe", {
        requestId, audioBase64, mimeType: uploadBlob.type || "audio/webm",
        filename: `dictation.${extension}`, helperToken: status.helperToken,
      });
      controller.signal.removeEventListener("abort", cancelRequest);
      cancelRequest = null;
      if (revision !== alunixaXDictation.revision) return;
      if (result?.status === "failed" || result?.status === "cancelled") throw new Error(result?.message || "语音转写失败");
      if (typeof result?.text !== "string") throw new Error("语音服务没有返回 text 字段");
      alunixaXDictation.text = result.text.trim();
      if (!alunixaXDictation.text) { cancelCodexPlusDictation(); showToast("未识别到文字，请重录", null); return; }
      await finishCodexPlusDictation();
    } catch (error) {
      if (revision !== alunixaXDictation.revision) return;
      alunixaXDictation.phase = "error";
      alunixaXDictation.error = error?.name === "AbortError" ? "转写已取消" : error?.message || "语音转写失败";
      renderCodexPlusDictation();
    } finally {
      if (cancelRequest) controller.signal.removeEventListener("abort", cancelRequest);
      if (revision === alunixaXDictation.revision) alunixaXDictation.controller = null;
    }
  }

  function alunixaXDictationControl(action, label, disabled = false) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.dataset.dictationAction = action;
    button.disabled = disabled;
    return button;
  }

  function renderCodexPlusDictation() {
    const state = alunixaXDictation;
    document.querySelectorAll('[data-alunixa-x-ext="builtin-dictation"][data-dictation-controls]').forEach((root) => {
      const active = state.phase !== "idle" && (root.dataset.dictationTarget === state.target?.id || root.dataset.floating === "true");
      const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
      const recordingLabel = `● 录音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      const key = active ? `${state.phase}:${state.action}:${state.error}:${state.text}` : "idle";
      if (root.dataset.renderKey === key) {
        // 计时只改文本，不能每秒销毁按钮，否则键盘焦点和进行中的点击会丢失。
        if (active && state.phase === "recording") root.querySelector('[role="status"]').textContent = recordingLabel;
        return;
      }
      root.dataset.renderKey = key; root.replaceChildren();
      if (!active) { root.append(alunixaXDictationControl("start", "语音输入", state.phase !== "idle")); return; }
      const status = document.createElement("span"); status.setAttribute("role", "status");
      if (state.phase === "recording") status.setAttribute("aria-live", "off");
      status.textContent = state.phase === "requesting" ? "正在请求麦克风…"
        : state.phase === "recording" ? recordingLabel
        : state.phase === "transcribing" ? "正在转写…" : state.error;
      root.append(status);
      if (state.phase === "recording") {
        root.append(alunixaXDictationControl("insert", "停止并插入"), alunixaXDictationControl("send", "停止并发送"));
      } else if (state.phase === "transcribing") {
        root.append(alunixaXDictationControl("send", "完成后发送", state.action === "send"));
      } else if (state.phase === "error") {
        if (state.blob) root.append(alunixaXDictationControl("retry", "重试转写"));
        root.append(alunixaXDictationControl("rerecord", "重录"));
      } else if (state.phase === "result") {
        const text = document.createElement("textarea"); text.readOnly = true; text.value = state.text; text.setAttribute("aria-label", "语音识别结果");
        root.append(text, alunixaXDictationControl("copy", "复制文字"));
      }
      root.append(alunixaXDictationControl("cancel", state.phase === "result" ? "关闭" : "取消"));
    });
    const floating = document.getElementById("alunixa-x-dictation-recovery");
    if (state.phase === "idle") floating?.remove();
    else if (!alunixaXDictationTargetEditor() && !floating) {
      const root = createCodexPlusDictationControls();
      root.id = "alunixa-x-dictation-recovery"; root.dataset.floating = "true";
      document.body.append(root); renderCodexPlusDictation();
    }
  }

  function createCodexPlusDictationControls() {
    const root = document.createElement("div");
    root.dataset.alunixaXExt = "builtin-dictation"; root.dataset.dictationControls = "true";
    root.className = "alunixa-x-dictation-controls";
    root.addEventListener("pointerdown", (event) => { if (event.target.closest("button")) event.preventDefault(); });
    root.addEventListener("click", (event) => {
      const action = event.target.closest('[data-dictation-action]')?.dataset.dictationAction;
      if (!action) return;
      event.preventDefault(); event.stopPropagation();
      if (action === "start") void startCodexPlusDictation(root.closest(".composer-footer, [data-composer-footer-responsive]"));
      else if (action === "cancel") cancelCodexPlusDictation();
      else if (action === "retry") void transcribeCodexPlusDictation();
      else if (action === "rerecord") {
        const footer = alunixaXDictationTargetEditor()?.closest('[data-composer-surface-variant], form')?.querySelector('.composer-footer, [data-composer-footer-responsive]')
          || root.closest(".composer-footer, [data-composer-footer-responsive]");
        cancelCodexPlusDictation();
        if (footer) void startCodexPlusDictation(footer);
        else showToast("请返回目标会话后重新录音", null);
      } else if (action === "copy") {
        if (!navigator.clipboard?.writeText) { showToast("请选中识别结果手动复制", null); return; }
        void navigator.clipboard.writeText(alunixaXDictation.text)
          .then(() => showToast("已复制识别结果", null)).catch(() => showToast("复制失败，请选中识别结果手动复制", null));
      } else stopCodexPlusDictation(action);
    });
    return root;
  }

  function installCodexPlusDictation() {
    if (!alunixaXDictationEnabled()) {
      if (alunixaXDictation.phase !== "idle" || alunixaXDictation.pendingSend) cancelCodexPlusDictation();
      document.querySelectorAll('[data-alunixa-x-ext="builtin-dictation"]').forEach((node) => node.remove());
      return;
    }
    if (!document.getElementById("alunixa-x-dictation-style")) {
      const style = document.createElement("style"); style.id = "alunixa-x-dictation-style";
      style.dataset.alunixaXExt = "builtin-dictation";
      style.textContent = `.alunixa-x-dictation-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-inline:6px;font-size:12px;max-width:100%}
        .alunixa-x-dictation-controls button{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:8px;padding:5px 8px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
        .alunixa-x-dictation-controls button:disabled{opacity:.5;cursor:default}.alunixa-x-dictation-controls button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
        #alunixa-x-dictation-recovery{position:fixed;bottom:24px;right:24px;z-index:2147483000;padding:12px;border-radius:12px;background:var(--background,#252525);color:var(--foreground,#eee);box-shadow:0 4px 24px #0006;max-width:480px}
        #alunixa-x-dictation-recovery textarea{width:100%;min-height:80px;color:inherit;background:transparent}`;
      document.head.append(style);
    }
    document.querySelectorAll(".composer-footer, [data-composer-footer-responsive]").forEach((footer) => {
      if (!visibleElement(footer) || isExtensionUiNode(footer)) return;
      const scope = alunixaXDictationScope(footer);
      const editor = scope && alunixaXDictationEditor(scope);
      if (!editor) return;
      let controls = footer.querySelector('[data-dictation-controls]');
      if (!controls) { controls = createCodexPlusDictationControls(); footer.append(controls); }
      const target = editor.dataset.alunixaXDictationTarget || editor.closest('[data-alunixa-x-dictation-root]')?.dataset.alunixaXDictationRoot || "";
      if (controls.dataset.dictationTarget !== target) { controls.dataset.dictationTarget = target; delete controls.dataset.renderKey; }
    });
    renderCodexPlusDictation();
  }

  const alunixaXDictationKeyHandler = (event) => {
    if (event.key === "Escape" && (alunixaXDictation.phase !== "idle" || alunixaXDictation.pendingSend)) {
      event.preventDefault(); event.stopImmediatePropagation(); cancelCodexPlusDictation();
      return;
    }
    const editor = alunixaXDictationTargetEditor();
    if (event.key === "Enter" && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
        && editor && (document.activeElement === editor || editor.contains?.(document.activeElement))
        && ["requesting", "recording", "transcribing"].includes(alunixaXDictation.phase)) {
      // 在录音期间，Enter 先结束转写再发送，不能让原生输入框先提交旧草稿。
      event.preventDefault(); event.stopImmediatePropagation();
      if (alunixaXDictation.phase !== "requesting") stopCodexPlusDictation("send");
    }
  };
  document.addEventListener("keydown", alunixaXDictationKeyHandler, true);
  const alunixaXDictationDispose = () => {
    cancelCodexPlusDictation();
    document.removeEventListener("keydown", alunixaXDictationKeyHandler, true);
    document.querySelectorAll('[data-alunixa-x-ext="builtin-dictation"]').forEach((node) => node.remove());
  };
  window.addEventListener("pagehide", alunixaXDictationDispose, { once: true });
  window.__alunixaXDictationRuntime = { dispose: () => {
    window.removeEventListener("pagehide", alunixaXDictationDispose);
    alunixaXDictationDispose();
  } };
  // 特效只观察原生编辑事件；不写输入框、不改选区，也不触发 React 输入事务。
  window.__alunixaXTypingEffectsRuntime?.dispose?.();
  const alunixaXTypingEffects = {
    installed: false, disposed: false, mode: "off", canvas: null, context: null,
    bounds: null, particles: [], frame: null, frameAt: 0, lastBurstAt: -Infinity,
    editor: null, composition: null, compositionFrame: null, media: null,
  };
  const alunixaXTypingEffectMaxParticles = 180;
  const alunixaXTypingEffectInterval = 40;
  const alunixaXTypingEffectOwner = "builtin-typing-effects";
  registerCodexPlusExtensionSelector('[data-alunixa-x-ext="builtin-typing-effects"]');

  function alunixaXTypingEffectMode() {
    const value = alunixaXSettings().typingEffect;
    return ["rainbow", "fireworks", "stars"].includes(value) ? value : "off";
  }

  function clearCodexPlusTypingEffects(resetComposition = true) {
    const state = alunixaXTypingEffects;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.canvas?.remove();
    state.canvas = state.context = state.bounds = state.editor = null;
    if (resetComposition !== false) {
      state.composition = null;
      if (state.compositionFrame !== null) cancelAnimationFrame(state.compositionFrame);
      state.compositionFrame = null;
    }
    state.particles.length = 0;
    state.frameAt = 0;
    state.lastBurstAt = -Infinity;
  }

  function syncCodexPlusTypingEffects() {
    const state = alunixaXTypingEffects;
    const mode = alunixaXTypingEffectMode();
    if (state.mode !== mode || mode === "off" || state.media?.matches || document.hidden) clearCodexPlusTypingEffects();
    state.mode = mode;
  }

  function alunixaXTypingEffectEditor(target) {
    const editor = target?.closest?.('.ProseMirror[contenteditable="true"], textarea, [role="textbox"][contenteditable="true"]');
    if (!editor?.isConnected || editor.matches(':disabled, [readonly], [contenteditable="false"]')
        || isExtensionUiNode(editor) || editor.closest('[inert], [aria-hidden="true"]') || !visibleElement(editor)) return null;
    // 新版有明确 composer 标记；旧版必须与 composer-footer 同属一个局部容器。
    let composer = editor.closest('[data-codex-composer-root], [data-composer-surface-variant]');
    if (!composer) {
      let parent = editor.parentElement;
      for (let depth = 0; parent && parent !== document.body && depth < 4; depth++, parent = parent.parentElement) {
        if (parent.querySelector?.('.composer-footer')) { composer = parent; break; }
        if (parent.tagName === "FORM") break;
      }
    }
    return composer && (document.activeElement === editor || editor.contains(document.activeElement)) ? editor : null;
  }

  function alunixaXTypingEffectText(editor) {
    return editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent || "";
  }

  function alunixaXTypingEffectTextareaCaret(editor) {
    const style = getComputedStyle(editor);
    const rect = editor.getBoundingClientRect();
    const width = editor.offsetWidth || rect.width;
    const height = editor.offsetHeight || rect.height;
    // 镜像不显示滚动条，须扣除原生 textarea 的滚动条占用，保持实际换行列宽。
    const mirrorWidth = editor.clientWidth > 0
      ? editor.clientWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0) : width;
    const mirror = document.createElement("div");
    mirror.setAttribute("data-alunixa-x-ext", alunixaXTypingEffectOwner);
    mirror.setAttribute("aria-hidden", "true");
    // offsetWidth 使用布局尺寸，最终按真实 rect 缩放，兼容编辑器祖先上的 CSS zoom。
    const properties = ["direction", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch",
      "fontKerning", "fontFeatureSettings", "fontVariationSettings", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "textAlign", "tabSize", "wordBreak",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"];
    for (const property of properties) mirror.style[property] = style[property];
    Object.assign(mirror.style, {
      position: "fixed", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none",
      boxSizing: "border-box", width: `${mirrorWidth}px`, height: "auto", minHeight: "0", maxHeight: "none",
      borderStyle: "solid", overflow: "hidden", whiteSpace: editor.wrap === "off" ? "pre" : "pre-wrap",
      overflowWrap: editor.wrap === "off" ? "normal" : "break-word", zoom: "1",
    });
    const position = editor.selectionEnd ?? editor.value.length;
    mirror.textContent = editor.value.slice(0, position);
    const marker = document.createElement("span");
    marker.textContent = editor.value.slice(position) || "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    try {
      const mirrorRect = mirror.getBoundingClientRect();
      const markerRect = marker.getClientRects()[0] || marker.getBoundingClientRect();
      const mirrorScale = mirrorRect.width / mirrorWidth || 1;
      const scaleX = rect.width / width || 1;
      const scaleY = rect.height / height || 1;
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25 || 20;
      return {
        x: rect.left + ((markerRect.left - mirrorRect.left) / mirrorScale - editor.scrollLeft) * scaleX,
        y: rect.top + ((markerRect.top - mirrorRect.top) / mirrorScale - editor.scrollTop + lineHeight * .55) * scaleY,
      };
    } finally { mirror.remove(); }
  }

  function alunixaXTypingEffectCaret(editor) {
    const box = editor.getBoundingClientRect();
    let point;
    if (editor instanceof HTMLTextAreaElement) point = alunixaXTypingEffectTextareaCaret(editor);
    else {
      const selection = window.getSelection?.();
      if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null;
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      let rect = range.getClientRects()[0] || range.getBoundingClientRect();
      let precedingCharacter = false;
      if (!rect?.height && range.endContainer?.nodeType === 3 && range.endOffset > 0) {
        range.setStart(range.endContainer, range.endOffset - 1);
        rect = range.getBoundingClientRect();
        precedingCharacter = true;
      }
      const style = getComputedStyle(editor);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25 || 20;
      if (rect?.height) point = {
        x: precedingCharacter && style.direction !== "rtl" ? rect.right : rect.left,
        y: rect.top + rect.height * .55,
      };
      else {
        // 空段落/BR 的 collapsed Range 可能没有几何，使用所在行而非整个 editor 的首行。
        let node = range.endContainer?.nodeType === 1 ? range.endContainer : range.endContainer?.parentElement;
        const child = node?.childNodes?.[range.endOffset] || node?.childNodes?.[Math.max(0, range.endOffset - 1)];
        if (child?.nodeType === 1) node = child;
        let fallback = box;
        let fallbackStyle = style;
        for (let depth = 0; node && editor.contains(node) && depth < 4; depth++, node = node.parentElement) {
          const nodeRect = node.getBoundingClientRect?.();
          if (nodeRect?.height > 0) { fallback = nodeRect; fallbackStyle = getComputedStyle(node); break; }
        }
        const scaleX = box.width / (editor.offsetWidth || box.width) || 1;
        const scaleY = box.height / (editor.offsetHeight || box.height) || 1;
        const fallbackLineHeight = parseFloat(fallbackStyle.lineHeight) || parseFloat(fallbackStyle.fontSize) * 1.25 || lineHeight;
        point = {
          x: fallback.left + (parseFloat(fallbackStyle.paddingLeft) || 0) * scaleX,
          y: fallback.top + ((parseFloat(fallbackStyle.paddingTop) || 0) + fallbackLineHeight * .55) * scaleY,
        };
      }
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { x: Math.max(box.left, Math.min(box.right, point.x)), y: Math.max(box.top, Math.min(box.bottom, point.y)) };
  }

  function createCodexPlusTypingEffectCanvas() {
    const state = alunixaXTypingEffects;
    if (state.canvas?.isConnected) return true;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-alunixa-x-ext", alunixaXTypingEffectOwner);
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed", top: "0", left: "0", width: "100%", height: "100%", pointerEvents: "none",
      zIndex: "2147483000", background: "transparent",
    });
    const context = canvas.getContext("2d");
    if (!context) return false;
    document.documentElement.appendChild(canvas);
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    Object.assign(state, { canvas, context, bounds });
    return true;
  }

  function drawCodexPlusTypingEffects(timestamp) {
    const state = alunixaXTypingEffects;
    state.frame = null;
    if (state.disposed || state.mode !== alunixaXTypingEffectMode() || state.media?.matches || document.hidden
        || !state.editor?.isConnected || alunixaXTypingEffectEditor(document.activeElement) !== state.editor || !state.canvas?.isConnected) {
      clearCodexPlusTypingEffects(); return;
    }
    const elapsed = state.frameAt ? Math.max(0, Math.min(32, timestamp - state.frameAt)) : 16;
    state.frameAt = timestamp;
    const context = state.context;
    context.clearRect(0, 0, state.bounds.width, state.bounds.height);
    state.particles = state.particles.filter((particle) => {
      particle.age += elapsed;
      if (particle.age >= particle.life) return false;
      particle.x += particle.vx * elapsed / 1000;
      particle.y += particle.vy * elapsed / 1000;
      particle.vy += particle.gravity * elapsed / 1000;
      const alpha = (1 - particle.age / particle.life) ** 1.5;
      context.save();
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      context.translate(particle.x - state.bounds.left, particle.y - state.bounds.top);
      context.rotate(particle.rotation + particle.age / 700);
      if (particle.star) {
        context.beginPath();
        for (let index = 0; index < 10; index++) {
          const radius = particle.size * (index % 2 ? .42 : 1);
          const angle = index * Math.PI / 5 - Math.PI / 2;
          if (index === 0) context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          else context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        context.closePath(); context.fill();
      } else context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 1.7);
      context.restore();
      return true;
    });
    if (state.particles.length) state.frame = requestAnimationFrame(drawCodexPlusTypingEffects);
    else clearCodexPlusTypingEffects(false);
  }

  function emitCodexPlusTypingEffects(editor) {
    const state = alunixaXTypingEffects;
    syncCodexPlusTypingEffects();
    if (state.disposed || state.mode === "off" || state.media?.matches || document.hidden) return false;
    const now = performance.now();
    if (now - state.lastBurstAt < alunixaXTypingEffectInterval) return false;
    const point = alunixaXTypingEffectCaret(editor);
    if (!point || !createCodexPlusTypingEffectCanvas()) return false;
    state.lastBurstAt = now;
    state.editor = editor;
    const count = state.mode === "fireworks" ? 26 : state.mode === "stars" ? 10 : 16;
    const available = Math.max(0, alunixaXTypingEffectMaxParticles - state.particles.length);
    if (!available) return false;
    const hue = now / 9 % 360;
    for (let index = 0; index < Math.min(count, available); index++) {
      const angle = state.mode === "fireworks" ? index / count * Math.PI * 2 : -Math.PI + Math.random() * Math.PI;
      const speed = state.mode === "fireworks" ? 65 + Math.random() * 100 : 35 + Math.random() * 95;
      state.particles.push({
        x: point.x, y: point.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        gravity: state.mode === "stars" ? 95 : 180, age: 0, life: 420 + Math.random() * 360,
        size: state.mode === "stars" ? 3 + Math.random() * 3 : 1.5 + Math.random() * 2.2,
        star: state.mode === "stars", rotation: Math.random() * Math.PI,
        color: `hsl(${state.mode === "stars" ? 38 + Math.random() * 22 : hue + index * 360 / count} 95% 68%)`,
      });
    }
    if (state.particles.length && state.frame === null) state.frame = requestAnimationFrame(drawCodexPlusTypingEffects);
    return true;
  }

  function createCodexPlusTypingEffectComposition(editor, before = alunixaXTypingEffectText(editor)) {
    return { editor, before, ended: false, emitted: false, lastEmittedText: null, lastInputText: before, sawTrustedInput: false, attempts: 0 };
  }

  function commitCodexPlusTypingEffectComposition(composition) {
    const state = alunixaXTypingEffects;
    if (state.composition !== composition || !composition.data || !composition.trusted
        || !alunixaXTypingEffectEditor(composition.editor)) return false;
    const text = alunixaXTypingEffectText(composition.editor);
    if (composition.emitted && text === composition.committed) return true;
    // 最终 input 通常紧接组词 input；同一份已绘制文本不重复发射。
    if (text !== composition.lastEmittedText) {
      if (text === composition.before || !emitCodexPlusTypingEffects(composition.editor)) return false;
    }
    composition.emitted = true;
    composition.committed = text;
    composition.lastEmittedText = text;
    return true;
  }

  function updateCodexPlusTypingEffectComposition(composition) {
    const state = alunixaXTypingEffects;
    if (state.composition !== composition || state.disposed || !alunixaXTypingEffectEditor(composition.editor)) return;
    let emitted;
    if (composition.ended) emitted = commitCodexPlusTypingEffectComposition(composition);
    else {
      const text = alunixaXTypingEffectText(composition.editor);
      emitted = text === composition.lastEmittedText || (composition.lastInputData === "" && !composition.backwardDeletion);
      if (!emitted && (text !== composition.before || composition.backwardDeletion) && emitCodexPlusTypingEffects(composition.editor)) {
        composition.lastEmittedText = text;
        emitted = true;
      }
    }
    if (emitted) {
      if (state.compositionFrame !== null) cancelAnimationFrame(state.compositionFrame);
      state.compositionFrame = null;
      composition.attempts = 0;
    } else if (state.composition === composition && state.compositionFrame === null && composition.attempts < 3) {
      // 输入法/编辑器可能在事件之后才恢复选区；只做有界补发，不开启常驻扫描。
      state.compositionFrame = requestAnimationFrame(() => {
        state.compositionFrame = null;
        composition.attempts += 1;
        updateCodexPlusTypingEffectComposition(composition);
      });
    }
  }

  function alunixaXTypingEffectInput(event) {
    if (event.isTrusted !== true) return;
    const backwardDeletion = ["deleteContentBackward", "deleteWordBackward", "deleteSoftLineBackward", "deleteHardLineBackward"].includes(event.inputType);
    if (!backwardDeletion && !["insertText", "insertLineBreak", "insertParagraph", "insertCompositionText", "insertFromComposition"].includes(event.inputType)) return;
    const editor = alunixaXTypingEffectEditor(event.target);
    if (!editor) return;
    const state = alunixaXTypingEffects;
    let composition = state.composition;
    const compositionInput = event.isComposing || ["insertCompositionText", "insertFromComposition"].includes(event.inputType);
    if (compositionInput && (!composition || composition.editor !== editor
        || (composition.ended && composition.emitted && (event.isComposing || alunixaXTypingEffectText(editor) !== composition.committed)))) {
      // 部分输入法不会派发 compositionstart，但仍有可信的原生组词 input。
      if (state.compositionFrame !== null) cancelAnimationFrame(state.compositionFrame);
      state.compositionFrame = null;
      composition = state.composition = createCodexPlusTypingEffectComposition(editor, null);
      if (event.inputType === "insertFromComposition") Object.assign(composition, { ended: true, data: event.data, trusted: true });
    }
    if (composition?.editor === editor) {
      if (backwardDeletion && composition.ended && !event.isComposing) {
        if (state.compositionFrame !== null) cancelAnimationFrame(state.compositionFrame);
        state.compositionFrame = null;
        state.composition = null;
        emitCodexPlusTypingEffects(editor);
        return;
      }
      if (!composition.ended || !composition.emitted) {
        const text = alunixaXTypingEffectText(editor);
        // 输入法退格也可能沿用 insertCompositionText，且清空组词时 data 为空。
        const shorterPreedit = compositionInput && typeof composition.lastInputText === "string" && text.length < composition.lastInputText.length;
        Object.assign(composition, {
          sawTrustedInput: true, lastInputData: event.data, lastInputText: text,
          backwardDeletion: backwardDeletion || shorterPreedit, attempts: 0,
        });
        updateCodexPlusTypingEffectComposition(composition);
        return;
      }
      if (alunixaXTypingEffectText(editor) === composition.committed) return;
      state.composition = null;
    }
    if (event.isComposing || (!backwardDeletion && !["insertText", "insertLineBreak", "insertParagraph"].includes(event.inputType))) return;
    if (event.inputType === "insertText" && !event.data) return;
    emitCodexPlusTypingEffects(editor);
  }

  function alunixaXTypingEffectCompositionStart(event) {
    if (event.isTrusted !== true) return;
    syncCodexPlusTypingEffects();
    if (alunixaXTypingEffects.mode === "off" || alunixaXTypingEffects.media?.matches || document.hidden) return;
    const editor = alunixaXTypingEffectEditor(event.target);
    if (editor) {
      if (alunixaXTypingEffects.compositionFrame !== null) cancelAnimationFrame(alunixaXTypingEffects.compositionFrame);
      alunixaXTypingEffects.compositionFrame = null;
      alunixaXTypingEffects.composition = createCodexPlusTypingEffectComposition(editor);
    }
  }

  function alunixaXTypingEffectCompositionEnd(event) {
    const composition = alunixaXTypingEffects.composition;
    if (!composition || composition.editor !== alunixaXTypingEffectEditor(event.target)) return;
    // 有些输入法/宿主转发结束事件，isTrusted 为 false；仅接纳之前已观察到的可信组词内容。
    if (event.isTrusted !== true && (!composition.sawTrustedInput || (event.data && event.data !== composition.lastInputData))) return;
    if (!event.data) {
      alunixaXTypingEffects.composition = null;
      if (alunixaXTypingEffects.compositionFrame !== null) cancelAnimationFrame(alunixaXTypingEffects.compositionFrame);
      alunixaXTypingEffects.compositionFrame = null;
      return;
    }
    Object.assign(composition, { ended: true, data: event.data, trusted: event.isTrusted === true || composition.sawTrustedInput });
    queueMicrotask(() => {
      updateCodexPlusTypingEffectComposition(composition);
    });
  }

  function alunixaXTypingEffectFocusOut(event) {
    const state = alunixaXTypingEffects;
    if (event.target === state.editor || event.target === state.composition?.editor) clearCodexPlusTypingEffects();
  }

  function installCodexPlusTypingEffects() {
    const state = alunixaXTypingEffects;
    if (state.disposed) return;
    if (!state.installed) {
      state.installed = true;
      state.media = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
      document.addEventListener("input", alunixaXTypingEffectInput, true);
      document.addEventListener("compositionstart", alunixaXTypingEffectCompositionStart, true);
      document.addEventListener("compositionend", alunixaXTypingEffectCompositionEnd, true);
      document.addEventListener("focusout", alunixaXTypingEffectFocusOut, true);
      document.addEventListener("visibilitychange", syncCodexPlusTypingEffects);
      window.addEventListener("blur", clearCodexPlusTypingEffects);
      window.addEventListener("resize", clearCodexPlusTypingEffects);
      state.media?.addEventListener?.("change", syncCodexPlusTypingEffects);
    }
    syncCodexPlusTypingEffects();
  }

  window.__alunixaXTypingEffectsRuntime = {
    dispose() {
      const state = alunixaXTypingEffects;
      state.disposed = true;
      clearCodexPlusTypingEffects();
      if (!state.installed) return;
      document.removeEventListener("input", alunixaXTypingEffectInput, true);
      document.removeEventListener("compositionstart", alunixaXTypingEffectCompositionStart, true);
      document.removeEventListener("compositionend", alunixaXTypingEffectCompositionEnd, true);
      document.removeEventListener("focusout", alunixaXTypingEffectFocusOut, true);
      document.removeEventListener("visibilitychange", syncCodexPlusTypingEffects);
      window.removeEventListener("blur", clearCodexPlusTypingEffects);
      window.removeEventListener("resize", clearCodexPlusTypingEffects);
      state.media?.removeEventListener?.("change", syncCodexPlusTypingEffects);
      state.installed = false;
    },
  };
  function ensureConversationViewRuntime() {
    if (conversationViewState.runtimeStarted) return;
    conversationViewState.ro = conversationViewState.ro || new ResizeObserver(() => scheduleConversationViewAlign());
    conversationViewState.mo = conversationViewState.mo || new MutationObserver(() => scheduleConversationViewAlign());
    if (document.body && !conversationViewState.moObserved) {
      conversationViewState.mo.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "data-state", "aria-hidden"],
      });
      conversationViewState.moObserved = true;
    }
    conversationViewState.runtimeStarted = true;
  }

  function refreshConversationView() {
    if (!alunixaXSettings().conversationView) {
      cleanupConversationView();
      return;
    }
    ensureConversationViewRuntime();
    scheduleConversationViewAlign();
  }


  const officialUsageWindowMarker = "data-alunixa-x-official-usage-window";
  // 重新注入会替换局部配置；已有 Query 钩子必须通过同一个运行时读取新策略。
  const officialUsageRuntime = window.__alunixaXOfficialUsageRuntime ||= {
    rawPayloads: new WeakMap(),
    rewriteDepth: 0,
  };
  officialUsageRuntime.pendingPublications ||= new WeakMap();
  officialUsageRuntime.rewrite = rewriteTrackedOfficialUsagePayload;
  window.__alunixaXOfficialUsageWindowCleanup?.();

  function isOfficialLowQuotaSidebarCard(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE || node.getAttribute("role") !== "status") return false;
    const className = typeof node.className === "string" ? node.className : "";
    if (!className.includes("rounded-2xl") || !className.includes("ring-border")) return false;
    const content = node.textContent || "";
    return content.includes("usage remaining")
      || (content.includes("剩余") && content.includes("使用量"))
      || content.includes("重新加入 Plus")
      || content.includes("Rejoin Plus");
  }

  function isOfficialLowQuotaComposerBanner(node) {
    return isOfficialLowQuotaUpsellBanner(node) || isOfficialLowQuotaComposerAside(node);
  }

  function isOfficialLowQuotaUpsellBanner(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE || node.getAttribute("role") !== "status") return false;
    const labelledBy = node.getAttribute("aria-labelledby") || "";
    const describedBy = node.getAttribute("aria-describedby") || "";
    if (!labelledBy.startsWith("upsell-banner-title-") || !describedBy.startsWith("upsell-banner-description-")) return false;
    const content = node.textContent || "";
    return content.includes("Codex 和工作使用额度已用完")
      || content.includes("You’re out of Codex and Work usage")
      || content.includes("You're out of Codex and Work usage")
      || content.includes("立即升级以获取更多使用量")
      || content.includes("Upgrade for more now");
  }

  function isOfficialLowQuotaComposerAside(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE || node.tagName !== "ASIDE") return false;
    const className = typeof node.className === "string" ? node.className : "";
    if (!className.includes("rounded-3xl")) return false;
    const content = node.textContent || "";
    if (content.length > 400) return false;
    return content.includes("Codex 和工作使用额度已用完")
      || content.includes("You’re out of Codex and Work usage")
      || content.includes("You're out of Codex and Work usage");
  }

  function isOfficialLowQuotaWindow(node) {
    return isOfficialLowQuotaSidebarCard(node) || isOfficialLowQuotaComposerBanner(node);
  }

  let officialUsageWindowObserver = null;
  let officialUsageWindowHidden = false;
  let officialUsageWindowStartPending = false;
  let officialUsageWindowActive = true;
  const officialUsageWindowDisplays = new WeakMap();

  function restoreOfficialUsageWindow(node) {
    if (node.getAttribute(officialUsageWindowMarker) !== "hidden") return;
    node.removeAttribute(officialUsageWindowMarker);
    const display = officialUsageWindowDisplays.get(node);
    if (display?.value) node.style.setProperty("display", display.value, display.priority);
    else node.style.removeProperty("display");
    officialUsageWindowDisplays.delete(node);
  }

  function syncOfficialUsageWindow(node) {
    if (!isOfficialLowQuotaWindow(node)) {
      restoreOfficialUsageWindow(node);
      return;
    }
    if (node.getAttribute(officialUsageWindowMarker) !== "hidden") {
      officialUsageWindowDisplays.set(node, {
        value: node.style.getPropertyValue("display"),
        priority: node.style.getPropertyPriority("display"),
      });
      node.setAttribute(officialUsageWindowMarker, "hidden");
      node.style.setProperty("display", "none", "important");
    }
  }

  function hideOfficialUsageWindowsWithin(root) {
    if (typeof Node === "undefined" || !root || root.nodeType !== Node.ELEMENT_NODE) return;
    const nodes = [root, ...root.querySelectorAll(`[role="status"], aside, [${officialUsageWindowMarker}]`)];
    for (const node of nodes) syncOfficialUsageWindow(node);
  }

  function restoreOfficialUsageWindows() {
    for (const node of document.querySelectorAll(`[${officialUsageWindowMarker}="hidden"]`)) {
      restoreOfficialUsageWindow(node);
    }
  }

  function startOfficialUsageWindowBlock() {
    if (officialUsageWindowObserver || typeof MutationObserver !== "function" || !document.body) return;
    officialUsageWindowObserver = new MutationObserver((records) => {
      if (!officialUsageWindowActive || !officialUsageWindowHidden) return;
      const changedContainers = new Set();
      for (const record of records) {
        // React 可只更新已有文本或插入卡片内部节点，因此也检查变更目标的祖先。
        let parent = record.target?.nodeType === Node.ELEMENT_NODE ? record.target : record.target?.parentElement;
        for (; parent; parent = parent.parentElement) {
          if (parent.matches?.(`[role="status"], aside, [${officialUsageWindowMarker}]`)) changedContainers.add(parent);
        }
        for (const node of record.addedNodes || []) {
          if (node?.nodeType !== Node.ELEMENT_NODE) continue;
          hideOfficialUsageWindowsWithin(node);
        }
      }
      for (const node of changedContainers) syncOfficialUsageWindow(node);
    });
    officialUsageWindowObserver.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["role", "class", "aria-labelledby", "aria-describedby"],
    });
    hideOfficialUsageWindowsWithin(document.body);
  }

  function stopOfficialUsageWindowBlock() {
    officialUsageWindowObserver?.disconnect();
    officialUsageWindowObserver = null;
    restoreOfficialUsageWindows();
  }

  function startOfficialUsageWindowsAfterReady() {
    officialUsageWindowStartPending = false;
    if (officialUsageWindowActive) syncOfficialUsageWindowMode(officialUsagePolicyKey());
  }

  window.__alunixaXOfficialUsageWindowCleanup = () => {
    officialUsageWindowActive = false;
    officialUsageWindowHidden = false;
    document.removeEventListener("DOMContentLoaded", startOfficialUsageWindowsAfterReady);
    stopOfficialUsageWindowBlock();
  };

  // 卡片不读用量字段。观察器只在开关打开时挂一次；心跳不查页面。
  // 关掉或离开官登时只按标记恢复，不再整页重认。
  function syncOfficialUsageWindowMode(key) {
    if (!officialUsageWindowActive) return;
    const hide = key === "official-hide";
    if (!hide) {
      if (!officialUsageWindowHidden && !officialUsageWindowObserver) return;
      officialUsageWindowHidden = false;
      officialUsageWindowStartPending = false;
      stopOfficialUsageWindowBlock();
      return;
    }
    officialUsageWindowHidden = true;
    if (officialUsageWindowObserver) return;
    if (!document.body) {
      if (officialUsageWindowStartPending) return;
      officialUsageWindowStartPending = true;
      document.addEventListener("DOMContentLoaded", startOfficialUsageWindowsAfterReady, { once: true });
      return;
    }
    startOfficialUsageWindowBlock();
  }

  function scanLightweight() {
    installStyle();
    installCodexServiceTierDispatcherPatch();
    installCodexAppServerClientPrototypePatch();
    installCodexRemoteSessionRecoveryListener();
    if (window.__alunixaXRemoteSessionRecoveryDispatcher) {
      installCodexRemoteSessionDispatcherSubscription(
        window.__alunixaXRemoteSessionRecoveryDispatcher,
        "existing-renderer"
      );
    }
    installCodexPlusNavigationEntries();
    // 拓展注册的图标栏入口与内置入口走同一条刷新路径：rail 渲染晚于注入，
    // 所以要每轮扫描都补一次（内部靠 id 幂等，不会重复插入）。
    refreshCodexPlusRailNavigation();
    installCodexPlusPageNavigationCloseHandler();
    scheduleBackendHeartbeat();
    installDeleteButtonEventDelegation();
    updateThreadScrollHandlers();
    installThreadScrollProgrammaticScrollGuard();
    installThreadScrollNavigationCapture();
    installThreadScrollUserIntentCapture();
    installThreadScrollRouteHooks();
    scheduleThreadScrollSync(true);
    refreshCodexServiceTierControls();
  }

  function officialUsagePolicy() {
    // 新一代设置尚未返回时沿用最后一次真实配置，避免重新注入短暂恢复额度锁。
    if (!alunixaXBackendSettingsLoaded && officialUsageRuntime.lastPolicy) return officialUsageRuntime.lastPolicy;
    const profile = codexRemoteSessionActiveProfile();
    const official = String(profile?.relayMode || "") === "official";
    const mixed = official && profile?.officialMixApiKey === true;
    const policy = {
      official,
      hideAlerts: mixed,
      unlockSend: mixed,
    };
    if (alunixaXBackendSettingsLoaded) officialUsageRuntime.lastPolicy = policy;
    return policy;
  }

  function officialUsagePolicyKey(policy = officialUsagePolicy()) {
    if (!policy.hideAlerts && !policy.unlockSend) return "off";
    return "official-hide";
  }

  function isOfficialUsageStatus(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const rateLimit = value.rate_limit;
    if (!rateLimit || typeof rateLimit !== "object" || typeof rateLimit.allowed !== "boolean") return false;
    return typeof value.plan_type === "string"
      || typeof value.user_id === "string"
      || typeof value.account_id === "string";
  }

  function isImageGenerationUpsell(value) {
    return String(value?.banner_type || "") === "image_generation_limit_reached";
  }

  function isMainRateLimitQueryKey(queryKey) {
    return Array.isArray(queryKey)
      && queryKey[0] === "rate-limit-status"
      && queryKey[1] !== "image-generation";
  }

  // 低额度提示和发送锁都只看当前是不是官登混入 Key。纯官登不改这份用量。
  // 桌面端发送按钮读 rate_limit.allowed；limit_reached 为 true 也会被当成已用完。
  // 混入时在查询发布前把 allowed 写成 true，并清掉 limit_reached。
  // 百分比、重置时间、账号、积分和消费上限不动。图片额度横幅单独留下。
  function rewriteOfficialUsageStatus(value, policy = officialUsagePolicy()) {
    if (!policy.official || (!policy.hideAlerts && !policy.unlockSend) || !isOfficialUsageStatus(value)) return null;
    const next = { ...value };
    let changed = false;
    if (value.rate_limit_reached_type != null) {
      next.rate_limit_reached_type = null;
      changed = true;
    }
    if (value.model_picker_upsell != null) {
      next.model_picker_upsell = null;
      changed = true;
    }
    const rateLimit = value.rate_limit;
    if (policy.unlockSend && (rateLimit.allowed !== true || rateLimit.limit_reached === true)) {
      next.rate_limit = { ...rateLimit, allowed: true, limit_reached: false };
      changed = true;
    }
    if (policy.hideAlerts) {
      if (value.sidebar_usage_warnings != null) {
        next.sidebar_usage_warnings = null;
        changed = true;
      }
      if (value.rate_limit_warning != null) {
        next.rate_limit_warning = null;
        changed = true;
      }
      if (value.rate_limit_upsell != null && !isImageGenerationUpsell(value.rate_limit_upsell)) {
        next.rate_limit_upsell = null;
        changed = true;
      }
    }
    return changed ? next : null;
  }

  function rewriteOfficialUsagePayload(value, policy = officialUsagePolicy()) {
    if (!value || typeof value !== "object") return value;
    if (isOfficialUsageStatus(value)) return rewriteOfficialUsageStatus(value, policy) || value;
    if (value.usage && value.usage !== value && isOfficialUsageStatus(value.usage)) {
      const usage = rewriteOfficialUsageStatus(value.usage, policy);
      return usage ? { ...value, usage } : value;
    }
    return value;
  }

  function rewriteTrackedOfficialUsagePayload(value) {
    const raw = officialUsageRuntime.rawPayloads.get(value) || value;
    if (officialUsagePolicyKey() === "off") return raw;
    const next = rewriteOfficialUsagePayload(value);
    if (next !== value) officialUsageRuntime.rawPayloads.set(next, raw);
    return next;
  }

  function looksLikeQueryClient(value) {
    return !!value
      && typeof value.getQueryCache === "function"
      && typeof value.setQueryData === "function";
  }

  // 图片额度使用同一条 /wham/usage，只能靠查询键 image-generation 排除。
  // 这里只在第一次挂上缓存时找客户端，不进每轮 DOM 扫描。
  function queryClientFromFiber(fiber) {
    const seen = new Set();
    const stack = [fiber];
    let visited = 0;
    while (stack.length && visited < 8000) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      visited += 1;
      const props = node.memoizedProps || node.pendingProps;
      if (looksLikeQueryClient(props?.client)) return props.client;
      if (looksLikeQueryClient(props?.value)) return props.value;
      if (looksLikeQueryClient(node.stateNode)) return node.stateNode;
      const state = node.memoizedState;
      if (state && typeof state === "object" && looksLikeQueryClient(state.memoizedState)) return state.memoizedState;
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
    }
    return null;
  }

  let officialUsageClient = null;

  function findCodexQueryClient() {
    const explicit = window.__REACT_QUERY_CLIENT__ || window.__codexQueryClient;
    if (looksLikeQueryClient(explicit)) return explicit;
    if (looksLikeQueryClient(officialUsageClient)) return officialUsageClient;
    const roots = [document.getElementById?.("root"), document.body, document.documentElement].filter(Boolean);
    for (const root of roots) {
      let key = "";
      try {
        key = Object.keys(root).find((name) => name.startsWith("__reactContainer$") || name.startsWith("__reactFiber$")) || "";
      } catch {
        key = "";
      }
      if (!key) continue;
      let fiber = root[key];
      if (fiber?.stateNode?.current) fiber = fiber.stateNode.current;
      const client = queryClientFromFiber(fiber);
      if (client) {
        officialUsageClient = client;
        return client;
      }
    }
    return null;
  }

  function mainRateLimitQueries(client) {
    const cache = client.getQueryCache?.();
    if (cache && typeof cache.findAll === "function") {
      return cache.findAll({ queryKey: ["rate-limit-status"] }).filter((query) => isMainRateLimitQueryKey(query?.queryKey));
    }
    if (typeof client.getQueriesData === "function") {
      return client.getQueriesData({ queryKey: ["rate-limit-status"] })
        .filter(([queryKey]) => isMainRateLimitQueryKey(queryKey))
        .map(([queryKey, data]) => ({ queryKey, state: { data } }));
    }
    return [];
  }

  // Query.setData 是 GET /wham/usage 和 SSE snapshot 共用的发布点。
  // 在通知订阅者之前改写，RK 第一次读到的 allowed 就是结果。
  function patchOfficialUsageQueryPublication(client) {
    const cache = client.getQueryCache?.();
    if (!cache) return;
    const listed = typeof cache.getAll === "function"
      ? cache.getAll()
      : (typeof cache.findAll === "function" ? cache.findAll({ queryKey: ["rate-limit-status"] }) : []);
    const query = listed.find((item) => typeof Object.getPrototypeOf(item)?.setData === "function");
    if (!query) return;
    const proto = Object.getPrototypeOf(query);
    if (typeof proto.setData !== "function" || proto.setData.__alunixaXUsagePublication) return;
    const original = proto.setData;
    function alunixaXPublishUsageData(data, ...rest) {
      if (!isMainRateLimitQueryKey(this?.queryKey)) return original.call(this, data, ...rest);
      const raw = officialUsageRuntime.rawPayloads.get(data) || data;
      const next = officialUsageRuntime.rewrite(data);
      const previousPublication = officialUsageRuntime.pendingPublications.get(this);
      const publication = { raw };
      officialUsageRuntime.pendingPublications.set(this, publication);
      officialUsageRuntime.rewriteDepth += 1;
      try {
        const stored = original.call(this, next, ...rest);
        // TanStack 结构共享可能返回另一对象；快照绑定实际缓存对象，不绑定输入副本。
        // 若订阅者已嵌套发布更新，沿用它登记的快照，不能用外层旧值覆盖。
        if (publication.raw === raw && stored && typeof stored === "object") {
          if (next !== raw) officialUsageRuntime.rawPayloads.set(stored, raw);
          else officialUsageRuntime.rawPayloads.delete(stored);
        }
        if (previousPublication) previousPublication.raw = publication.raw;
        return stored;
      } finally {
        officialUsageRuntime.rewriteDepth -= 1;
        if (previousPublication) officialUsageRuntime.pendingPublications.set(this, previousPublication);
        else officialUsageRuntime.pendingPublications.delete(this);
      }
    }
    alunixaXPublishUsageData.__alunixaXUsagePublication = true;
    proto.setData = alunixaXPublishUsageData;
  }

  function patchOfficialUsageQueryClient(client) {
    if (!client || typeof client.setQueryData !== "function") return;
    patchOfficialUsageQueryPublication(client);
    if (client.__alunixaXUsageRewrite) return;
    const original = client.setQueryData;
    client.setQueryData = function alunixaXSetUsageQueryData(queryKey, updater, ...rest) {
      if (!isMainRateLimitQueryKey(queryKey)) {
        return original.call(this, queryKey, updater, ...rest);
      }
      const nextUpdater = typeof updater === "function"
        ? (previous) => {
          // setData 的同步订阅者可能马上写回，此时结构共享对象尚未返回。
          const query = this.getQueryCache?.()?.find?.({ queryKey, exact: true });
          const publishing = query && officialUsageRuntime.pendingPublications.get(query);
          const raw = publishing ? publishing.raw : (officialUsageRuntime.rawPayloads.get(previous) || previous);
          return officialUsageRuntime.rewrite(updater(raw));
        }
        : officialUsageRuntime.rewrite(updater);
      officialUsageRuntime.rewriteDepth += 1;
      try {
        return original.call(this, queryKey, nextUpdater, ...rest);
      } finally {
        officialUsageRuntime.rewriteDepth -= 1;
      }
    };
    const cache = client.getQueryCache?.();
    if (cache && typeof cache.subscribe === "function") {
      cache.subscribe((event) => {
        if (officialUsageRuntime.rewriteDepth > 0) return;
        const query = event?.query;
        if (!isMainRateLimitQueryKey(query?.queryKey)) return;
        const current = query.state?.data;
        const next = officialUsageRuntime.rewrite(current);
        if (next === current) return;
        client.setQueryData(query.queryKey, next);
      });
    }
    client.__alunixaXUsageRewrite = true;
  }

  function rewriteCachedOfficialUsage(client) {
    if (!client || !officialUsagePolicy().official) return;
    for (const query of mainRateLimitQueries(client)) {
      const current = query.state?.data;
      const next = officialUsageRuntime.rewrite(current);
      if (next !== current) client.setQueryData(query.queryKey, next);
    }
  }

  function invalidateMainRateLimitQueries(client) {
    if (!client || typeof client.invalidateQueries !== "function") return;
    for (const query of mainRateLimitQueries(client)) {
      try {
        Promise.resolve(client.invalidateQueries({ queryKey: query.queryKey, exact: true })).catch(() => {});
      } catch {
      }
    }
  }

  let officialUsagePolicyApplied = "";
  let officialUsageClientTimer = null;

  function syncOfficialUsagePolicy() {
    const key = officialUsagePolicyKey();
    syncOfficialUsageWindowMode(key);
    const client = findCodexQueryClient();
    if (client) {
      officialUsageClient = client;
      patchOfficialUsageQueryClient(client);
      if (officialUsageClientTimer) {
        clearTimeout(officialUsageClientTimer);
        officialUsageClientTimer = null;
      }
    } else if (!officialUsageClientTimer) {
      let attempts = 0;
      const retry = () => {
        attempts += 1;
        officialUsageClientTimer = null;
        if (findCodexQueryClient()) {
          syncOfficialUsagePolicy();
          return;
        }
        if (attempts < 20) officialUsageClientTimer = setTimeout(retry, 300);
      };
      officialUsageClientTimer = setTimeout(retry, 300);
      return;
    } else {
      return;
    }
    const recoveredHomeReads = window.__alunixaXComposerReadiness?.tick(client, officialUsagePolicy().unlockSend) || 0;
    if (recoveredHomeReads > 0) {
      sendCodexPlusDiagnostic("composer_home_read_retried", { count: recoveredHomeReads });
    }
    if (key === officialUsagePolicyApplied) {
      if (key !== "off") rewriteCachedOfficialUsage(client);
      return;
    }
    const previous = officialUsagePolicyApplied;
    officialUsagePolicyApplied = key;
    if (key === "off") {
      // 先同步恢复真实用量；断网或刷新悬挂时也不能沿用混入模式的解锁结果。
      for (const query of mainRateLimitQueries(client)) {
        const raw = officialUsageRuntime.rawPayloads.get(query.state?.data);
        if (raw) client.setQueryData(query.queryKey, raw);
      }
      if (previous) invalidateMainRateLimitQueries(client);
      return;
    }
    rewriteCachedOfficialUsage(client);
    if (previous) invalidateMainRateLimitQueries(client);
  }

  if (window.__ALUNIXA_X_TEST_RATE_LIMIT_UNLOCK__) {
    window.__alunixaXRateLimitUnlockTest = {
      setBackendSettings: (settings) => {
        alunixaXBackendSettings = { ...alunixaXBackendSettings, ...settings };
        alunixaXBackendSettingsLoaded = true;
      },
      setHideAlerts: (hidden) => {
        window.__ALUNIXA_X_HIDE_OFFICIAL_USAGE_ALERT__ = hidden === true;
      },
      install: () => syncOfficialUsagePolicy(),
      policyKey: () => officialUsagePolicyKey(),
      isRateLimitQueryKey: (queryKey) => isMainRateLimitQueryKey(queryKey),
      rewrite: (value) => rewriteOfficialUsagePayload(value),
    };
  }

  function sessionCopyMenuRow(menu) {
    const triggerId = menu?.getAttribute?.("aria-labelledby") || "";
    const trigger = triggerId ? document.getElementById(triggerId) : null;
    const labeledTrigger = trigger && /^(聊天操作|Chat actions)$/i.test(trigger.getAttribute("aria-label") || "")
      ? trigger
      : null;
    const fallbackTrigger = lastSessionActionTrigger?.isConnected
      ? lastSessionActionTrigger
      : document.querySelector('button[aria-label="聊天操作"], button[aria-label="Chat actions"]');
    const row = (labeledTrigger || fallbackTrigger)?.closest?.(selectors.sidebarThread)
      || [...document.querySelectorAll(selectors.sidebarThread)]
        .find((candidate) => candidate.getAttribute("data-app-action-sidebar-thread-selected") === "true");
    const ref = row ? sessionRefFromRow(row) : null;
    if (!row || !ref?.session_id || isClientNewThreadId(ref.session_id)) return null;
    return row;
  }

  function looksLikeSessionActionMenu(menu) {
    if (!(menu instanceof HTMLElement) || menu.hidden) return false;
    if (menu.matches(`.${moreMenuClass}, .${alunixaXMenuFloatingClass}, #${alunixaXMenuId}`)) return false;
    const text = normalizedElementText(menu);
    const hasRename = /(?:重命名|rename)/i.test(text);
    const hasOtherSessionAction = /(?:置顶|取消置顶|pin|unpin|归档|archive|删除|delete|移动|move)/i.test(text);
    return hasRename || hasOtherSessionAction;
  }

  function isNativeSessionRenameMenuItem(candidate) {
    if (!(candidate instanceof HTMLElement) || !visibleElement(candidate)) return false;
    const text = normalizedElementText(candidate);
    const label = candidate.getAttribute("aria-label") || "";
    const testid = candidate.getAttribute("data-testid") || "";
    // Codex 26.1007 changed the visible label from the bare "重命名"/
    // "Rename" to a longer localized label. Match the native semantic
    // affordance while excluding Alunixa X's own auto-rename entry.
    if (/自动重命名当前会话|auto.?rename current session/i.test(`${text} ${label}`)) return false;
    return /重命名|rename/i.test(`${text} ${label} ${testid}`);
  }

  function rememberSessionActionTrigger(event) {
    const trigger = event.target?.closest?.('button[aria-label="聊天操作"], button[aria-label="Chat actions"]');
    if (trigger) lastSessionActionTrigger = trigger;
  }

  function sessionCopyMenuScopes(scope = document) {
    const root = scope?.querySelectorAll ? scope : document;
    const menus = [];
    if (scope instanceof HTMLElement && scope.matches?.('[role="menu"]')) menus.push(scope);
    root.querySelectorAll?.('[role="menu"]').forEach((menu) => menus.push(menu));
    return Array.from(new Set(menus));
  }

  function sessionCopyMenuItemIcon() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>';
  }

  function sessionCopyMenuActivationIsDuplicate(target) {
    if (!(target instanceof HTMLElement)) return false;
    const now = Date.now();
    const activatedAt = Number(target.dataset.codexSessionCopyActivatedAt || 0);
    if (activatedAt && now - activatedAt < 600) return true;
    target.dataset.codexSessionCopyActivatedAt = String(now);
    return false;
  }

  async function selectSessionRowForAction(row) {
    if (!(row instanceof HTMLElement) || !row.isConnected) return false;
    const targetId = row.getAttribute("data-app-action-sidebar-thread-id") || "";
    if (!targetId) return false;
    if (row.getAttribute("data-app-action-sidebar-thread-selected") !== "true") row.click();

    const deadline = Date.now() + sessionCopyMenuActivationTimeoutMs;
    while (Date.now() < deadline) {
      const selected = [...document.querySelectorAll(selectors.sidebarThread)]
        .find((candidate) => candidate.getAttribute("data-app-action-sidebar-thread-selected") === "true");
      if (selected?.getAttribute("data-app-action-sidebar-thread-id") === targetId) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  function dispatchNativePointerClick(node) {
    if (!(node instanceof HTMLElement)) return;
    node.focus?.();
    if (typeof PointerEvent === "function") {
      node.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }));
      node.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }));
    }
    node.click();
  }

  async function waitForSessionElement(resolveElement, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const element = resolveElement();
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  function visibleSessionRenameDialog() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter(visibleElement)
      .find((dialog) => dialog.querySelector('input[aria-label="聊天标题"], input[aria-label="Chat title"]')) || null;
  }

  function closeSessionRenameDialog(dialog) {
    const cancelButton = [...dialog?.querySelectorAll?.("button") || []]
      .find((button) => /^(取消|Cancel)$/i.test(normalizedElementText(button)));
    if (cancelButton) {
      cancelButton.click();
      return;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }

  function sessionActionTrigger(row) {
    const direct = row?.querySelector?.('button[aria-label="聊天操作"], button[aria-label="Chat actions"]');
    if (direct instanceof HTMLElement && visibleElement(direct)) return direct;
    if (lastSessionActionTrigger instanceof HTMLElement && lastSessionActionTrigger.isConnected && visibleElement(lastSessionActionTrigger)) {
      return lastSessionActionTrigger;
    }
    const candidates = Array.from(document.querySelectorAll([
      'button[aria-label="聊天操作"]',
      'button[aria-label="Chat actions"]',
      'button[aria-label="会话操作"]',
      'button[aria-label="Thread actions"]',
      'button[aria-label="更多"]',
      'button[aria-label="More"]',
      'button[aria-label="More options"]',
      'button[aria-label="更多操作"]',
      'button[aria-label="More actions"]',
      'button[aria-label="会话选项"]',
      'button[aria-label="Conversation options"]',
      'button[aria-label="Thread options"]',
      'button[aria-haspopup="menu"]',
    ].join(","))).filter((button) => {
      if (!(button instanceof HTMLElement) || !visibleElement(button) || isExtensionUiNode(button)) return false;
      const header = button.closest?.(selectors.appHeader);
      return !!header || /聊天操作|Chat actions|会话操作|Thread actions|更多|More|选项|options/i.test(button.getAttribute("aria-label") || "");
    });
    if (candidates.length) return candidates.at(-1);
    const header = document.querySelector(selectors.appHeader);
    const iconButtons = Array.from(header?.querySelectorAll?.("button") || [])
      .filter((button) => button instanceof HTMLElement && visibleElement(button) && !isExtensionUiNode(button))
      .filter((button) => {
        const text = normalizedElementText(button);
        return text === "..." || text === "⋯" || text === "···" || button.getAttribute("aria-expanded") != null;
      });
    return iconButtons.at(-1) || null;
  }

  async function activateSessionAutoRenameMenuItem(event) {
    if (event?.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const item = event?.currentTarget;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    if (sessionCopyMenuActivationIsDuplicate(item)) return;
    closeSessionMoreMenus();

    const row = item?.__codexSessionAutoRenameRow;
    if (!(row instanceof HTMLElement) || !row.isConnected) {
      showToast("找不到要重命名的会话", null);
      return;
    }
    if (!await selectSessionRowForAction(row)) {
      showToast("会话加载超时，请稍后重试", null);
      return;
    }

    const trigger = sessionActionTrigger(row);
    if (!(trigger instanceof HTMLElement)) {
      showToast("找不到 Codex 原生重命名入口", null);
      return;
    }
    lastSessionActionTrigger = trigger;
    dispatchNativePointerClick(trigger);

    let renameItem = await waitForSessionElement(() => {
      return sessionCopyMenuScopes()
        .filter((menu) => visibleElement(menu) && looksLikeSessionActionMenu(menu))
        .flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"]')])
        .find(isNativeSessionRenameMenuItem) || null;
    }, 1200);
    if (!renameItem) {
      trigger.click();
      renameItem = await waitForSessionElement(() => {
        return [...document.querySelectorAll('[role="menuitem"]')]
          .filter(visibleElement)
          .find(isNativeSessionRenameMenuItem) || null;
      }, 1200);
    }
    if (!(renameItem instanceof HTMLElement)) {
      showToast("无法打开 Codex 原生重命名入口", null);
      return;
    }
    renameItem.click();

    const dialog = await waitForSessionElement(visibleSessionRenameDialog, 3000);
    if (!(dialog instanceof HTMLElement)) {
      showToast("无法打开 Codex 原生重命名窗口", null);
      return;
    }
    const titleInput = dialog.querySelector('input[aria-label="聊天标题"], input[aria-label="Chat title"]');
    const initialTitle = titleInput?.value || "";
    showToast("正在使用 Codex 生成会话名称…", null);

    const suggestionButton = await waitForSessionElement(() => {
      const currentDialog = visibleSessionRenameDialog();
      if (!currentDialog) return null;
      return [...currentDialog.querySelectorAll("button")]
        .filter(visibleElement)
        .find((button) => {
          const text = normalizedElementText(button);
          return button.classList.contains("text-info")
            && !!text
            && text !== initialTitle
            && !/^(取消|保存|Cancel|Save)$/i.test(text);
        }) || null;
    }, sessionAutoRenameTimeoutMs);
    if (!(suggestionButton instanceof HTMLElement)) {
      closeSessionRenameDialog(visibleSessionRenameDialog());
      showToast("Codex 未能生成新名称，请稍后重试", null);
      return;
    }

    suggestionButton.click();
    const renamedInput = await waitForSessionElement(() => {
      const input = visibleSessionRenameDialog()?.querySelector('input[aria-label="聊天标题"], input[aria-label="Chat title"]');
      return input?.value?.trim() && input.value.trim() !== initialTitle.trim() ? input : null;
    }, 1500);
    const activeDialog = visibleSessionRenameDialog();
    const saveButton = [...activeDialog?.querySelectorAll?.("button") || []]
      .find((button) => /^(保存|Save)$/i.test(normalizedElementText(button)));
    if (!renamedInput || !(saveButton instanceof HTMLElement) || saveButton.disabled) {
      closeSessionRenameDialog(activeDialog);
      showToast("Codex 未能应用新名称，请稍后重试", null);
      return;
    }
    saveButton.click();
    showToast("已自动重命名当前会话", null);
  }

  async function activateSessionCopyMenuItem(event) {
    if (event?.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    const item = event?.currentTarget;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    if (sessionCopyMenuActivationIsDuplicate(item)) return;
    const row = item?.__codexSessionCopyRow;
    if (!(row instanceof HTMLElement) || !row.isConnected) {
      showToast("找不到要复制的会话", null);
      return;
    }
    if (!await selectSessionRowForAction(row)) {
      showToast("会话加载超时，请稍后重试", null);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    const forkButtons = [...document.querySelectorAll('button[aria-label="从这里创建聊天分支"], button[aria-label="Fork from here"]')]
      .filter(visibleElement)
      .filter((button) => !isExtensionUiNode(button));
    const forkButton = forkButtons.at(-1);
    if (!forkButton) {
      showToast("当前会话没有可用的官方分支入口", null);
      return;
    }
    forkButton.click();
  }

  function createSessionCopyMenuItem(referenceItem, row) {
    const item = document.createElement("div");
    item.className = referenceItem?.className || "no-drag outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm text-default group cursor-interaction flex flex-col";
    item.classList.add(sessionCopyMenuItemClass);
    item.setAttribute("role", referenceItem?.getAttribute("role") || "menuitem");
    item.setAttribute("tabindex", referenceItem?.getAttribute("tabindex") || "-1");
    item.setAttribute("data-orientation", referenceItem?.getAttribute("data-orientation") || "vertical");
    item.setAttribute("data-codex-session-copy-menu", "true");
    item.dataset.codexSessionCopyVersion = sessionCopyMenuItemVersion;
    item.__codexSessionCopyRow = row;
    item.innerHTML = `<div class="flex w-full items-center gap-1.5"><span class="inline-flex h-5 w-5 shrink-0 items-center justify-center opacity-75 group-focus:opacity-100 group-hover:opacity-100">${sessionCopyMenuItemIcon()}</span><span class="flex-1 min-w-0 truncate">原地复制会话 - Alunixa X</span></div>`;
    item.addEventListener("pointerup", activateSessionCopyMenuItem, true);
    item.addEventListener("click", activateSessionCopyMenuItem, true);
    item.addEventListener("keydown", activateSessionCopyMenuItem, true);
    return item;
  }

  function refreshSessionCopyMenuItems(scope = document) {
    sessionCopyMenuScopes(scope).forEach((menu) => {
      if (!(menu instanceof HTMLElement) || isExtensionUiNode(menu)) return;
      if (menu.matches(`.${moreMenuClass}, .${alunixaXMenuFloatingClass}, #${alunixaXMenuId}`)) {
        menu.querySelectorAll(`.${sessionCopyMenuItemClass}`).forEach((item) => item.remove());
        return;
      }
      const row = sessionCopyMenuRow(menu);
      if (!looksLikeSessionActionMenu(menu)) return;
      const existing = menu.querySelector(`.${sessionCopyMenuItemClass}`);
      if (!row) {
        existing?.remove();
        return;
      }
      if (existing) {
        existing.__codexSessionCopyRow = row;
        return;
      }
      const referenceItem = menu.querySelector('[role="menuitem"]');
      menu.appendChild(createSessionCopyMenuItem(referenceItem, row));
    });
  }

  function scanDeferred() {
    if (alunixaXBackendSettings.enhancementsEnabled !== false && alunixaXBackendSettings.codexAppSharedTerminal === true) {
      runScanStep(installCodexSharedTerminalRuntime);
    } else {
      retireCodexSharedTerminalRuntime();
    }
    runScanStep(runPluginAutoExpand);
    runScanStep(scheduleProjectMoveProjection);
    runScanStep(refreshZedRemoteOpenControls);
    runScanStep(installUpstreamWorktreeNativeAdapter);
    installCodexQueuedFollowUpEditPatch();
    if (codexPluginMarketplacePatchEnabled()) {
      const pluginUnlockStrategy = codexPluginUnlockStrategy();
      const settings = alunixaXSettings();
      logCodexPluginUnlockStrategy(pluginUnlockStrategy);
      if ((pluginUnlockStrategy === "modern" || pluginUnlockStrategy === "unknown") && settings.pluginMarketplaceUnlock) {
        const marketplaceRequestPatchStrategy = codexPluginMarketplaceRequestPatchStrategy();
        installPluginBuildFlavorFilterPatch();
        if (marketplaceRequestPatchStrategy === "bridge") {
          installPluginMarketplaceBridgePatch();
        } else if (marketplaceRequestPatchStrategy === "client") {
          installPluginMarketplaceRequestPatch();
        } else {
          installPluginMarketplaceWindowEventPatchOnly();
          installPluginMarketplaceBridgePatch();
          installPluginMarketplaceRequestPatch();
        }
      }
    }
    if (typeof syncCodexPlusWhaleWidget === "function") runScanStep(syncCodexPlusWhaleWidget);
    refreshDreamSkin();
    refreshThreadIdBadges();
    sessionRows().forEach(tryAttachButton);
    updateDeleteButtonOffsets();
    archivedPageRows().forEach(attachArchivedPageDeleteButton);
    refreshConversationView();
    installCodexServiceTierBadge();
    if (typeof installCodexNativeFastControls === "function") void installCodexNativeFastControls();
    scheduleThreadScrollSync();
    refreshCodexModelWhitelistFromScan(window.__codexSessionDeleteLastMutations);
  }

  function runScanStep(step) {
    try {
      step();
    } catch (error) {
      window.__codexSessionDeleteScanFailures = window.__codexSessionDeleteScanFailures || [];
      window.__codexSessionDeleteScanFailures.push(String(error?.stack || error));
    }
  }

  function scan() {
    void installDictationSupportPatch();
    runScanStep(scanLightweight);
    requestAnimationFrame(() => runScanStep(scanDeferred));
  }
  // 完整上游引擎的词法宿主：不替换页面全局 API；挂件关闭时释放所有副作用。
  const alunixaXWhaleFullStoragePrefix = "alunixaX.whale.full.v1.";
  function alunixaXWhaleFullNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function alunixaXWhaleFullBuiltin(url) {
    let parsed;
    try { parsed = new URL(String(url), "https://codex-whale.invalid"); } catch { return ""; }
    const path = parsed.pathname, id = parsed.searchParams.get("id"), set = parsed.searchParams.get("set");
    const aliases = { "/dsh-whale/image.png": "DSniang1.png", "/dsh-whale/rua.gif": "rua.gif" };
    const fragments = { ya1: "Ya1.mp3", ya2: "Ya2.mp3", d1: "D1.mp3", d2: "D2.mp3", exp_orb: "minecraft-exp-orb.wav", end_a: "task-end-a.wav", taskEnd: "task-end-a.wav" };
    let file = aliases[path];
    if (path === "/dsh-whale/audio-fragment.wav") file = fragments[id];
    if (path === "/dsh-whale/bubble-img.png") file = ({ bimg_petpet: "bubble-petpet.gif", bimg_money1: "bubble-money1.gif" })[id];
    if (/^\/dsh-whale\/sound\/(press|release)\.mp3$/.test(path) && (!set || set === "duck" || set === "fx1")) file = fragments[(set === "fx1" ? "d" : "ya") + (path.includes("press") ? "1" : "2")];
    if (path === "/dsh-whale/role-image.png" && id === "default") file = "DSniang1.png";
    return file ? window.__ALUNIXA_X_WHALE_ASSETS__?.[file] || (file === "DSniang1.png" ? window.__ALUNIXA_X_WHALE_IMAGE__ : "") || "" : "";
  }

  function alunixaXWhaleFullDataResponse(source) {
    // 直接读取本地内嵌字节，避免 fetch(data:) 受到宿主 connect-src 限制。
    const match = /^data:((?:audio|image)\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(source);
    if (!match) throw new Error("不支持的本地媒体数据");
    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { "Content-Type": match[1] } });
  }

  function createCodexPlusWhaleFullRuntime() {
    const state = { disposed: false, paused: document.hidden === true, timers: new Map(), rafs: new Map(), observers: new Set(), nodes: new Set(), listeners: [], audio: new Set(), pending: new Set(), media: new Map(), objectUrls: new Set(), subscriptions: [], dispatcher: null, sessionId: "", session: null, sessionAt: 0, sessionPending: null, history: null, historyAt: 0, historyPrices: "", historyPending: null, models: [], relayProfiles: [], turn: null, completed: new Set(), seq: 0, pendingWait: null, completion: null, controls: null, serial: 0 };
    const isolated = Object.create(null);
    const wrappedMedia = new WeakSet();
    const storage = {
      getItem(key) { return localStorage.getItem(alunixaXWhaleFullStoragePrefix + key); },
      setItem(key, value) { return localStorage.setItem(alunixaXWhaleFullStoragePrefix + key, String(value)); },
      removeItem(key) { return localStorage.removeItem(alunixaXWhaleFullStoragePrefix + key); },
    };
    try { state.seq = Math.max(0, Number(storage.getItem("dshw-last-seq")) || 0); } catch {}
    state.initialSeq = state.seq;
    state.priceRevision = 0;
    state.statRevision = 0;
    const active = () => !state.disposed;
    function listen(target, name, callback, options) {
      const wrapped = typeof callback === "function" ? function (event) { if (active()) callback.call(target, event); } : { handleEvent(event) { if (active()) callback?.handleEvent?.(event); } };
      target.addEventListener(name, wrapped, options);
      state.listeners.push({ target, name, callback, wrapped, options });
    }
    function unlisten(target, name, callback, options) {
      for (let i = state.listeners.length - 1; i >= 0; i--) {
        const entry = state.listeners[i];
        if (entry.target === target && entry.name === name && entry.callback === callback) {
          target.removeEventListener(name, entry.wrapped, options ?? entry.options); state.listeners.splice(i, 1);
        }
      }
    }
    function arm(id, timer) {
      if (!active() || state.paused) return;
      timer.native = setTimeout(() => {
        if (!state.timers.has(id) || !active() || state.paused) return;
        timer.native = null;
        if (!timer.repeat) state.timers.delete(id);
        try { timer.callback(...timer.args); } finally { if (timer.repeat && state.timers.has(id)) arm(id, timer); }
      }, timer.delay);
    }
    function schedule(callback, delay, repeat, args) {
      if (!active() || typeof callback !== "function") return 0;
      const id = ++state.serial, timer = { callback, delay: Math.max(0, Number(delay) || 0), repeat, args, native: null };
      state.timers.set(id, timer); arm(id, timer); return id;
    }
    function clearTimer(id) { const timer = state.timers.get(id); if (timer?.native !== null) clearTimeout(timer?.native); state.timers.delete(id); }
    function raf(callback) {
      if (!active()) return 0;
      const id = ++state.serial, frame = { callback, native: null };
      state.rafs.set(id, frame);
      if (!state.paused) frame.native = requestAnimationFrame((time) => { state.rafs.delete(id); if (active() && !state.paused) callback(time); });
      return id;
    }
    function cancelRaf(id) { const frame = state.rafs.get(id); if (frame?.native !== null) cancelAnimationFrame(frame?.native); state.rafs.delete(id); }
    function trackedObserver(Native) {
      if (typeof Native !== "function") return undefined;
      return class {
        constructor(callback) { this.records = []; this.native = new Native((entries, observer) => { if (active() && !state.paused) callback(entries, this); }); state.observers.add(this); }
        observe(target, options) { this.records.push([target, options]); if (active() && !state.paused) this.native.observe(target, options); }
        disconnect() { this.native.disconnect(); this.records = []; }
        takeRecords() { return this.native.takeRecords?.() || []; }
      };
    }
    function trackedAudioContext(options) {
      const Native = window.AudioContext || window.webkitAudioContext;
      if (!Native || !active()) throw new Error("音频不可用");
      const audio = new Native(options); state.audio.add(audio); return audio;
    }
    trackedAudioContext.prototype = (window.AudioContext || window.webkitAudioContext)?.prototype || Object.prototype;
    function bridge(path, payload) {
      if (!active() || state.paused) return Promise.reject(new Error("挂件已暂停"));
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); state.pending.delete(cancel); error ? reject(error) : resolve(value); };
        const cancel = () => finish(new Error("挂件请求已取消"));
        const timer = setTimeout(() => finish(new Error("挂件请求超时")), 45000);
        state.pending.add(cancel);
        Promise.resolve(postJson(path, payload)).then((value) => finish(active() ? null : new Error("挂件已关闭"), value), (error) => finish(error));
      });
    }
    function context() {
      const ref = currentSessionRef() || {}, id = String(ref.session_id || ""), host = String(ref.host_id || "local");
      if (id !== state.sessionId || host !== state.sessionHost) {
        state.sessionId = id; state.session = null; state.sessionAt = 0; state.sessionPending = null; state.turn = null; state.pendingWait = null; state.lastTurnResult = null; state.lastTurnPending = null;
      }
      state.sessionHost = host; state.sessionRef = ref; state.remote = host !== "local";
      return id;
    }
    function observe(turn, baseline = false) {
      if (!turn?.id) return;
      const previous = state.turn;
      if (!baseline && previous?.id === turn.id && previous.status === "running" && turn.status === "completed" && !state.completed.has(turn.id)) {
        state.seq += 1; state.completed.add(turn.id);
        if (state.completed.size > 128) state.completed.delete(state.completed.values().next().value);
      }
      if (baseline && turn.status === "completed") state.completed.add(turn.id);
      state.turn = { id: turn.id, status: turn.status, usage: turn.usage || null };
    }
    function setStatsEnabled(value) {
      const enabled = value !== false;
      if (state.codexStatsOn === enabled) return;
      state.codexStatsOn = enabled; state.statRevision += 1;
      state.history = null; state.historyAt = 0; state.historyPending = null; state.session = null; state.sessionAt = 0; state.sessionPending = null; state.lastTurnResult = null; state.lastTurnPending = null;
    }
    async function session() {
      const id = context();
      if (!id) return null;
      if (state.codexStatsOn === false || state.remote) return { status: "ok", sessionId: id, title: state.sessionRef?.title || "", lastTurn: state.turn, total: state.nativeUsage?.total || null, today: null, rateLimits: [] };
      if (state.session && Date.now() - state.sessionAt < 5000) return state.session;
      if (state.sessionPending) return state.sessionPending;
      const baseline = !state.session && !state.turn;
      const statRevision = state.statRevision;
      const pending = bridge("/whale/session", { ...state.sessionRef, session_id: id }).then((data) => {
        if (!active() || context() !== id || statRevision !== state.statRevision || state.codexStatsOn === false || state.remote) return null;
        state.session = data; state.sessionAt = Date.now();
        if (data?.status === "ok" && !(Date.now() - (state.nativeTurnAt || 0) < 10000 && state.turn?.id === data.lastTurn?.id && state.turn.status === "completed" && data.lastTurn.status === "running")) observe(data.lastTurn, baseline);
        return data;
      }).finally(() => { if (state.sessionPending === pending) state.sessionPending = null; });
      state.sessionPending = pending; return pending;
    }
    function prices() {
      const result = [];
      for (const model of state.models) {
        const price = model.price;
        if (!price || ![price.hit, price.miss, price.out].every((value) => value !== "" && alunixaXWhaleFullNumber(value) !== null)) continue;
        const matchIds = model.matchIds?.length ? model.matchIds : [model.id];
        const currency = String(price.cur || "USD").toUpperCase(), rate = currency === "CNY" ? 1 : alunixaXWhaleFullNumber(price.rate);
        if (!(rate > 0) || !["CNY", "USD"].includes(currency)) continue;
        // 匹配交给数据层：精确匹配优先，其次最长的大小写不敏感子串。
        for (const id of matchIds) result.push({ model: id, currency: "CNY", input: Number(price.miss) * rate, cachedInput: Number(price.hit) * rate, output: Number(price.out) * rate });
      }
      return result;
    }
    function pricingFingerprint() { return JSON.stringify(state.models.map((model) => ({ id: model.id, price: model.price, matchIds: model.matchIds }))); }
    async function history(force = false) {
      if (state.codexStatsOn === false) return { status: "disabled", complete: false, codex: { ok: false, disabled: true } };
      const quote = prices(), fingerprint = JSON.stringify(quote);
      if (!force && state.history && state.historyPrices === fingerprint && Date.now() - state.historyAt < 60000) return state.history;
      if (state.historyPending) return state.historyPending;
      const revision = state.priceRevision, statRevision = state.statRevision;
      const pending = bridge("/whale/history", { period: "all", page: 1, pageSize: 500, prices: quote }).then((data) => {
        if (statRevision !== state.statRevision || state.codexStatsOn === false) return { status: "disabled", complete: false, codex: { ok: false, disabled: true } };
        if (active() && revision !== state.priceRevision) return history(true);
        if (active()) { state.history = data; state.historyAt = Date.now(); state.historyPrices = fingerprint; } return data;
      }).finally(() => { if (state.historyPending === pending) state.historyPending = null; });
      state.historyPending = pending; return pending;
    }
    const toTokens = (period) => {
      if (state.codexStatsOn === false) return "—";
      const value = state.history?.periods?.[period]?.usage?.totalTokens ?? state.history?.machineSummary?.[({ today: "todayTokens", month: "monthTokens", all: "totalTokens" })[period]];
      const number = alunixaXWhaleFullNumber(value);
      if (number === null) return "—";
      return number.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
    };
    function codexModel(model, summary) {
      const data = summary?.codex || summary?.machineSummary || {};
      const total = (period) => alunixaXWhaleFullNumber(summary?.periods?.[period]?.usage?.totalTokens);
      const limits = state.session?.rateLimits || summary?.rateLimits || [];
      const windows = limits.filter((entry) => entry.resetAt == null || Number(entry.resetAt) * 1000 > Date.now()).map((entry, index) => ({ usedPct: entry.usedPercent, windowMinutes: entry.windowMinutes || (index === 0 ? 300 : 10080), resetAt: entry.resetAt == null ? null : Number(entry.resetAt) * 1000 }));
      return { ...model, codex: { ...data, ok: summary?.status === "ok" || summary?.status === "partial" || data.ok === true, complete: summary?.complete === true, deferred: summary?.complete === false ? Math.max(1, summary?.scan?.deferred || 1) : 0, todayTokens: total("today") ?? data.todayTokens, monthTokens: total("month") ?? data.monthTokens, totalTokens: total("all") ?? data.totalTokens, sessions: summary?.scan?.sessions ?? data.sessions ?? 0, days7: data.days7 || (summary?.days || []).slice(-7).map((day) => ({ date: day.date, tokens: day.usage?.totalTokens })), windows: data.windows || { primary: windows[0] || null, secondary: windows[1] || null } }, planSupport: windows.length > 0, plan: windows.length ? { ok: true, usedPct: windows[0].usedPct, remainPct: windows[0].usedPct == null ? null : 100 - windows[0].usedPct, windows: windows.map((entry, index) => ({ id: index === 0 ? "rolling" : "weekly", key: index === 0 ? "rolling" : "weekly", label: index === 0 ? "5h" : "周", usedPct: entry.usedPct, remainPct: entry.usedPct == null ? null : 100 - entry.usedPct, resetAt: entry.resetAt })) } : model.plan };
    }
    function subscribe() {
      const dispatcher = window.__alunixaXRemoteSessionRecoveryDispatcher;
      if (state.dispatcher === dispatcher && state.onEvent) return;
      for (const unsubscribe of state.subscriptions.splice(0)) { try { unsubscribe(); } catch {} }
      state.dispatcher = dispatcher;
      const onEvent = (payload, method) => {
        if (!active() || state.paused) return;
        const data = payload?.params || payload || {}, turn = data.turn || data;
        const thread = String(data.threadId || data.thread_id || data.conversationId || "").replace(/^local:/, "");
        if (!thread || thread !== context().replace(/^local:/, "")) return;
        if (method === "thread/tokenUsage/updated") {
          state.nativeUsage = data.tokenUsage || null;
          if (state.turn && data.tokenUsage?.last) state.turn.usage = data.tokenUsage.last;
        } else if (["serverRequest/resolved", "item/tool/userInputAnswered", "item/approval/responded", "item/completed"].includes(method)) {
          const id = String(data.requestId || data.itemId || data.item?.id || data.id || "");
          if (state.pendingWait && (id === state.pendingWait.id || id === state.pendingWait.itemId)) { state.pendingWait = null; void state.controls?.pollWaitState?.(); }
        } else if (method === "turn/started" || method === "turn/completed") {
          const id = turn.id || data.turnId;
          observe({ id, status: method === "turn/started" ? "running" : ({ failed: "failed", interrupted: "aborted", aborted: "aborted" })[turn.status] || "completed", usage: turn.usage });
          state.nativeTurnAt = Date.now();
          state.pendingWait = null;
          state.sessionAt = 0;
          void state.controls?.pollLastTurn?.();
        } else {
          state.pendingWait = { id: String(payload?.id || data.requestId || data.itemId || data.id || ""), itemId: String(data.itemId || ""), kind: method.includes("requestUserInput") || method === "mcpServer/elicitation/request" ? "question" : "approval" };
          void state.controls?.pollWaitState?.();
        }
      };
      state.onEvent = onEvent;
      if (!dispatcher?.subscribe) return;
      for (const method of ["turn/started", "turn/completed", "thread/tokenUsage/updated", "item/tool/requestUserInput", "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval", "mcpServer/elicitation/request", "serverRequest/resolved", "item/tool/userInputAnswered", "item/approval/responded", "item/completed"]) {
        try { const remove = dispatcher.subscribe(method, (payload) => onEvent(payload, method)); if (typeof remove === "function") state.subscriptions.push(remove); } catch {}
      }
    }
    function nativeEnvelope(value, depth = 0) {
      if (!active() || state.paused || !value || typeof value !== "object" || depth > 4) return;
      if (typeof value.method === "string" && /^(turn\/(started|completed)|thread\/tokenUsage\/updated|item\/(tool\/requestUserInput|commandExecution\/requestApproval|fileChange\/requestApproval|permissions\/requestApproval|completed)|mcpServer\/elicitation\/request|serverRequest\/resolved)$/.test(value.method)) state.onEvent?.(value, value.method);
      if (value.id != null && (Object.hasOwn(value, "result") || Object.hasOwn(value, "error") || Object.hasOwn(value, "response")) && String(value.id) === state.pendingWait?.id) {
        state.pendingWait = null; void state.controls?.pollWaitState?.();
      }
      for (const key of ["message", "request", "payload", "data", "notification"]) if (value[key] && typeof value[key] === "object") nativeEnvelope(value[key], depth + 1);
    }
    async function lastTurn() {
      await session().catch(() => null);
      if (state.lastTurnResult?.body?.seq === state.seq) return state.lastTurnResult;
      if (state.lastTurnPending) return state.lastTurnPending;
      const seq = state.seq;
      const turn = state.turn?.status === "completed" ? state.turn : null;
      let amount = null, currency = null, usage = turn?.usage || state.session?.lastTurn?.usage || null;
      if (turn && seq > state.initialSeq && prices().length && state.codexStatsOn !== false && !state.remote) {
        const pending = (async () => {
        const details = await bridge("/whale/history", { period: "all", sessionId: context().replace(/^local:/, ""), turnId: turn.id, page: 1, pageSize: 500, prices: prices() }).catch(() => null);
        const totals = {};
        for (const record of details?.records || []) {
          if (record.turnId !== turn.id || !record.estimatedCost) continue;
          const cost = record.estimatedCost; totals[cost.currency] = (totals[cost.currency] || 0) + cost.amount;
        }
        const currencies = Object.keys(totals);
        if (currencies.length === 1) { currency = currencies[0]; amount = totals[currency]; }
        const result = { status: 200, body: { ok: true, seq, turn, amount, currency, usage, estimated: amount !== null } };
        if (active() && state.seq === seq) state.lastTurnResult = result;
        return result;
        })().finally(() => { if (state.lastTurnPending === pending) state.lastTurnPending = null; });
        state.lastTurnPending = pending; return pending;
      }
      const result = { status: 200, body: { ok: true, seq, turn, amount, currency, usage, estimated: amount !== null } };
      state.lastTurnResult = result; return result;
    }
    async function compatibilityJson(path, method, query, body) {
      subscribe();
      if (path === "/dsh-whale/size.json" && method === "GET" && state.startupConfig) return { status: 200, body: state.startupConfig };
      if (path === "/dsh-whale/last-turn.json") {
        return lastTurn();
      }
      if (path === "/dsh-whale/wait.json") {
        const data = await session().catch(() => null);
        return { status: 200, body: { ok: true, sessionName: data?.sessionName || data?.title || state.sessionRef?.title || "", pending: data?.pending || state.pendingWait || null } };
      }
      const response = await bridge("/whale/full", { path, method, query, body });
      if (path === "/dsh-whale/size.json" && method === "PUT" && response?.status === 200) {
        setStatsEnabled(body.codexStatsOn);
      }
      if (path === "/dsh-whale/api-models.json" && response?.body?.ok) {
        state.relayProfiles = response.body.relayProfiles || state.relayProfiles;
        setStatsEnabled(response.body.codexStatsOn);
        const previous = pricingFingerprint();
        state.models = response.body.models || state.models;
        if (pricingFingerprint() !== previous) { state.priceRevision += 1; state.history = null; state.historyAt = 0; state.historyPending = null; state.lastTurnResult = null; state.lastTurnPending = null; }
        if (method === "GET") {
          const statsOn = response.body.codexStatsOn !== false;
          const summary = statsOn ? await history().catch(() => null) : null;
          response.body.models = (response.body.models || []).map((model) => model.id === "codex" ? statsOn ? codexModel(model, summary) : { ...model, codex: { ok: false, disabled: true } } : model);
        }
        state.models = response.body.models || state.models;
      }
      if (path === "/dsh-whale/usage-records.json" && method === "GET") {
        state.recordsAccountBase = JSON.parse(JSON.stringify(response.body));
        const data = await history().catch(() => null);
        response.body = mergeRecords(response.body, data);
      }
      return response;
    }
    function mergeRecords(base, data) {
      if (!data?.today || !data?.days7 || !data?.all) return base;
      const merge = (account, local) => ({ ...local, ...account, modelTotal: local?.modelTotal, models: local?.models || [], estimatedCosts: local?.estimatedCosts, unpricedRecords: local?.unpricedRecords });
      const mergeDays = (account, local) => { const days = new Map((local || []).map((day) => [day.date, day])); for (const day of account || []) days.set(day.date, merge(day, days.get(day.date))); return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)); };
      return { ...base, today: merge(base?.today, data.today), days7: mergeDays(base?.days7, data.days7), all: { ...base?.all, days: mergeDays(base?.all?.days, data.all.days), events: data.all.events || [] }, complete: data.complete, historyPagination: data.pagination, historyArchive: data.archive, ok: true };
    }
    const nativeFetch = window.fetch?.bind(window) || globalThis.fetch;
    function responseOf(result) {
      if (result?.data) {
        const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
        return new Response(bytes, { status: result.status || 200, headers: { "Content-Type": result.mimeType || "application/octet-stream" } });
      }
      return new Response(JSON.stringify(result?.body ?? null), { status: result?.status || 200, headers: { "Content-Type": "application/json" } });
    }
    async function fetchCompat(value, options = {}) {
      if (!active() || state.paused) throw new Error("挂件已暂停");
      const raw = String(value), builtin = alunixaXWhaleFullBuiltin(raw);
      if (builtin) return alunixaXWhaleFullDataResponse(builtin);
      const parsed = new URL(raw, "https://codex-whale.invalid");
      if (parsed.origin !== "https://codex-whale.invalid" || !parsed.pathname.startsWith("/dsh-whale/")) {
        // 上游只有本机资源 fetch；用户显式配置的超链接通过 window.open。
        if (raw.startsWith("data:")) return alunixaXWhaleFullDataResponse(raw);
        if (raw.startsWith("blob:")) return nativeFetch(raw, options);
        throw new Error("挂件资源只允许本机桥接");
      }
      const method = String(options.method || "GET").toUpperCase();
      const query = Object.fromEntries(parsed.searchParams.entries());
      let body = {};
      if (options.body) { try { body = JSON.parse(options.body); } catch { throw new Error("无效挂件请求"); } }
      if (options.signal?.aborted) throw new Error("挂件请求已取消");
      const result = await compatibilityJson(parsed.pathname, method, query, body);
      if (!active() || options.signal?.aborted) throw new Error("挂件请求已取消");
      if (result?.builtinFragmentId) {
        const uri = alunixaXWhaleFullBuiltin("/dsh-whale/audio-fragment.wav?id=" + encodeURIComponent(result.builtinFragmentId));
        if (!uri) throw new Error("内置音频缺失");
        return nativeFetch(uri);
      }
      return responseOf(result);
    }
    async function resolveMedia(path) {
      const builtin = alunixaXWhaleFullBuiltin(path); if (builtin) return builtin;
      if (state.media.has(path)) return state.media.get(path);
      const pending = (async () => {
      const result = await fetchCompat(path);
      if (!result.ok) throw new Error("素材加载失败");
      const blob = await result.blob();
      if (!active()) throw new Error("挂件已关闭");
      const objectUrl = URL.createObjectURL(blob); state.objectUrls.add(objectUrl); state.media.set(path, objectUrl); return objectUrl;
      })().catch((error) => { if (state.media.get(path) === pending) state.media.delete(path); throw error; });
      state.media.set(path, pending); return pending;
    }
    function mediaNode(node) {
      if (wrappedMedia.has(node)) return node;
      wrappedMedia.add(node);
      let proto = node, descriptor;
      while (proto && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(proto, "src"); proto = Object.getPrototypeOf(proto); }
      let revision = 0;
      const set = (value) => { if (descriptor?.set) descriptor.set.call(node, value); else node.setAttribute("src", value); };
      try { Object.defineProperty(node, "src", { configurable: true, get() { return descriptor?.get ? descriptor.get.call(node) : node.getAttribute("src") || ""; }, set(value) {
        const rev = ++revision, raw = String(value || "");
        if (!raw.startsWith("/dsh-whale/")) { if (!raw || /^(data:image\/(png|jpeg|webp|gif|avif);|data:audio\/|blob:)/i.test(raw)) set(raw); return; }
        const builtin = alunixaXWhaleFullBuiltin(raw);
        if (builtin) { set(builtin); return; }
        void resolveMedia(raw).then((url) => { if (active() && rev === revision) set(url); }).catch(() => { if (active() && rev === revision) node.dispatchEvent?.(new Event("error")); });
      } }); } catch {}
      return node;
    }
    function mark(node) {
      if (!active()) throw new Error("挂件已关闭");
      if (!node) return node;
      node.setAttribute?.("data-alunixa-x-ext", "whale-widget");
      if (["IMG", "AUDIO", "VIDEO", "SOURCE"].includes(node.tagName)) mediaNode(node);
      return node;
    }
    const head = new Proxy(document.head, { get(target, key) {
      if (["appendChild", "insertBefore", "append", "prepend", "replaceChildren"].includes(key)) return (...args) => { if (!active()) return args[0]; for (const node of args) if (node?.nodeType || node?.tagName) state.nodes.add(node); return target[key](...args); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const doc = new Proxy(document, { get(target, key) {
      if (key === "head") return head;
      if (key === "createElement") return (...args) => mark(target.createElement(...args));
      if (key === "createElementNS") return (...args) => mark(target.createElementNS(...args));
      if (key === "addEventListener") return (name, callback, options) => listen(target, name, callback, options);
      if (key === "removeEventListener") return (name, callback, options) => unlisten(target, name, callback, options);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const win = new Proxy(window, { get(target, key) {
      if (key === "__alunixaXWhaleHost") return host;
      if (typeof key === "string" && (key.startsWith("__dsh") || key === "dshwRegisterMask")) return isolated[key];
      if (key === "document") return doc;
      if (key === "localStorage") return storage;
      if (key === "Image") return image;
      if (key === "Audio") return audio;
      if (key === "AudioContext" || key === "webkitAudioContext") return window.AudioContext || window.webkitAudioContext ? trackedAudioContext : undefined;
      if (key === "addEventListener") return (name, callback, options) => listen(target, name, callback, options);
      if (key === "removeEventListener") return (name, callback, options) => unlisten(target, name, callback, options);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    }, set(target, key, value) { if (typeof key === "string" && (key.startsWith("__dsh") || key === "dshwRegisterMask")) { isolated[key] = value; return true; } return Reflect.set(target, key, value, target); } });
    function image(width, height) { return mark(new window.Image(width, height)); }
    image.prototype = window.Image?.prototype || Object.prototype;
    function audio(url) { const node = mark(new window.Audio()); if (url) node.src = url; return node; }
    audio.prototype = window.Audio?.prototype || Object.prototype;
    const host = {
      active, state, tokens: toTokens,
      attach(node) { if (active()) state.nodes.add(node); },
      detach(node) { state.nodes.delete(node); },
      initialSound() { return state.startupConfig?.sound !== false; },
      complete(data, show) { state.completion = data; show(data.amount); },
      completionCost(amount) {
        const completion = state.completion;
        if (amount == null) return completion?.usage?.totalTokens == null ? "用量暂不可用" : Number(completion.usage.totalTokens).toLocaleString("zh-CN") + " tokens";
        return Number(amount).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) + " " + (completion?.currency || "") + "（估算）";
      },
      completionModules(modules) {
        const unknown = state.completion?.amount == null;
        return modules.map((module) => module.type === "text" ? { ...module, text: String(module.text).replace("上一轮对话消耗:", unknown ? "Codex 任务完成" : "上一轮费用估算:").replace(/^¥\s*/, "") } : module).concat(unknown ? [{ type: "text", text: "未配置单价，费用未知", size: 2, color: "#9fb0d9" }] : []);
      },
      recordsPager(body, data, render) {
        const pagination = data.historyPagination;
        if (!pagination) return;
        const area = mark(document.createElement("div")); area.className = "dshwv-usage-hint"; area.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0 10px";
        const page = pagination.page || 1, pages = Math.max(1, pagination.pages || 1);
        const label = mark(document.createElement("span")); label.textContent = `明细第 ${page} / ${pages} 页 · 共 ${pagination.total || 0} 条${data.complete === false ? " · 正在统计" : ""}`; area.appendChild(label);
        const input = mark(document.createElement("input")); input.type = "search"; input.placeholder = "搜索全部明细：日期或模型"; input.value = state.recordsSearch || ""; input.className = "dshwv-colnat"; input.style.width = "100%"; area.appendChild(input);
        const request = async (next) => {
          state.recordsRevision = (state.recordsRevision || 0) + 1;
          const revision = state.recordsRevision, priceRevision = state.priceRevision;
          const result = await bridge("/whale/history", { period: "all", page: next, pageSize: pagination.pageSize || 500, search: input.value, prices: prices() }).catch(() => null);
          if (!active() || !body.isConnected || revision !== state.recordsRevision || priceRevision !== state.priceRevision || !result) return;
          state.recordsSearch = input.value; render(mergeRecords(state.recordsAccountBase, result));
        };
        for (const [text, next, disabled] of [["上一页", page - 1, page <= 1], ["下一页", page + 1, page >= pages]]) {
          const button = mark(document.createElement("button")); button.type = "button"; button.textContent = text; button.className = "dshwv-snapbtn dshwv-snapbtn-no"; button.disabled = disabled; button.addEventListener("click", () => { void request(next); }); area.appendChild(button);
        }
        const search = mark(document.createElement("button")); search.type = "button"; search.textContent = "搜索"; search.className = "dshwv-snapbtn dshwv-snapbtn-ok"; search.addEventListener("click", () => { void request(1); }); area.appendChild(search); input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void request(1); } });
        if (data.historyArchive?.detailRetentionDays) { const note = mark(document.createElement("span")); note.textContent = `明细保留 ${data.historyArchive.detailRetentionDays} 天；更早用量保留在日汇总中。`; note.style.width = "100%"; area.appendChild(note); }
        body.appendChild(area);
      },
      fail(error) { state.initializationError = error?.name || "Error"; console.warn("[Alunixa X] 完整鲸鱼初始化失败", state.initializationError); },
      bind(controls) { state.controls = controls; subscribe(); },
      defaultBubbleItems(items) {
        const copy = JSON.parse(JSON.stringify(items));
        if (copy[0]?.modules) copy[0].modules = [
          { type: "text", text: "Codex 本机用量", size: 8, bold: true },
          { type: "today", modelId: "codex", size: 20, rgb: "indigo", tpl: "{tokens_today}" },
          { type: "today", modelId: "codex", size: 4, color: "#9fb0d9", tpl: "今日 tokens · 近7天 {tokens_week}" },
          { type: "balance", modelId: "current-provider", size: 3, tpl: "供应商余额 {balance}" },
          { type: "session", size: 3, tpl: "{session}", len: 20 },
        ];
        return copy;
      },
      profileSelect(selected) {
        const select = mark(document.createElement("select")); select.className = "dshwv-colnat";
        const profiles = state.relayProfiles.length ? state.relayProfiles : [{ id: selected || "", name: selected || "当前供应商" }];
        for (const profile of profiles) { const option = mark(document.createElement("option")); option.value = profile.id; option.textContent = profile.name || profile.id; select.appendChild(option); }
        select.value = selected || profiles[0]?.id || ""; return select;
      },
    };
    const mutation = trackedObserver(window.MutationObserver), resize = trackedObserver(window.ResizeObserver);
    const environment = [win, doc, fetchCompat, storage, (fn, ms, ...args) => schedule(fn, ms, false, args), clearTimer, (fn, ms, ...args) => schedule(fn, ms, true, args), clearTimer, raf, cancelRaf, mutation, resize, trackedAudioContext, trackedAudioContext, image, audio];
    async function initialize() {
      const configuration = await bridge("/whale/full", { path: "/dsh-whale/size.json", method: "GET", query: {}, body: {} });
      if (configuration?.status !== 200 || !configuration.body) throw new Error("完整挂件设置读取失败");
      state.startupConfig = configuration.body;
      setStatsEnabled(configuration.body.codexStatsOn);
      let legacy;
      try { legacy = JSON.parse(localStorage.getItem("alunixaX.whaleWidget.v1") || "null"); } catch {}
      if (!legacy || storage.getItem("legacy-migrated") === "1") return;
      if (configuration.body.hasSavedConfig === true) { storage.setItem("legacy-migrated", "1"); return; }
      // 只迁移用户实际保存过的旧偏好；保存失败保留旧数据并允许下次重试。
      const send = async (path, method, body) => {
        const result = await bridge("/whale/full", { path: "/dsh-whale/" + path, method, query: {}, body });
        if (result?.status !== 200 || result.body?.ok === false) throw new Error("旧挂件偏好迁移失败");
        return result.body;
      };
      if (typeof legacy.image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(legacy.image) && legacy.image.length <= 1400000) {
        const roles = await send("roles.json", "GET", {});
        let imported = (roles.roles || []).find((role) => role.name === "原挂件角色");
        if (!imported) {
          const result = await send("roles.json", "POST", { name: "原挂件角色", image: legacy.image, format: legacy.image.startsWith("data:image/gif;") ? "gif" : "png" });
          imported = (result.roles || []).find((role) => role.name === "原挂件角色");
        }
        if (imported?.id) storage.setItem("dshw-role", imported.id);
      }
      if (typeof legacy.phrase === "string" && legacy.phrase.trim()) {
        const config = await send("bubble.json", "GET", {});
        if (!config.config?.items?.length) await send("bubble.json", "POST", { v: 1, tapAdvance: false, lib: [], items: [{ kind: "custom", modules: [{ type: "text", text: legacy.phrase.slice(0, 120), size: 8 }, { type: "today", modelId: "codex", size: 12, tpl: "今日 {tokens_today} tokens" }] }] });
      }
      const limits = Object.values(legacy.thresholds || {}).find((value) => value && typeof value === "object");
      if (limits) {
        const patch = { models: { "current-provider": {} } };
        if (alunixaXWhaleFullNumber(limits.low) > 0) patch.models["current-provider"].alert = { on: true, below: Number(limits.low) };
        if (alunixaXWhaleFullNumber(limits.budget) > 0) patch.models["current-provider"].budget = { on: true, amount: Number(limits.budget) };
        await send("usage-settings.json", "PUT", patch);
      }
      const base = Math.max(122, Math.min(250, Math.min(window.innerWidth || 1024, window.innerHeight || 768) * 0.28));
      const config = { ...configuration.body, sound: legacy.sound === true, turnCostOn: legacy.completion !== false };
      if (alunixaXWhaleFullNumber(legacy.size) > 0) config.scale = Math.min(2.5, Math.max(0.6, Number(legacy.size) / (base * 0.5945)));
      if (alunixaXWhaleFullNumber(legacy.x) !== null && alunixaXWhaleFullNumber(legacy.y) !== null) {
        const fullSize = base * (config.scale || 1.5), right = Math.max(0, (window.innerWidth || 1024) - Number(legacy.x) - Number(legacy.size || 88)), bottom = Math.max(0, (window.innerHeight || 768) - Number(legacy.y) - Number(legacy.size || 88));
        storage.setItem("dshw-pos", JSON.stringify({ v: 2, hAnchor: legacy.x < (window.innerWidth || 1024) / 2 ? "left" : "right", hDist: legacy.x < (window.innerWidth || 1024) / 2 ? Math.max(0, legacy.x - fullSize * 0.4055) : right, vAnchor: legacy.y < (window.innerHeight || 768) / 2 ? "top" : "bottom", vDist: legacy.y < (window.innerHeight || 768) / 2 ? Math.max(0, legacy.y - fullSize * 0.4055) : bottom }));
      }
      if (legacy.snap === false) storage.setItem("dshw-snap", JSON.stringify({ v: 3, mode: "off" }));
      const result = await send("size.json", "PUT", config); state.startupConfig = { ...config, ...result, hasSavedConfig: true };
      storage.setItem("legacy-migrated", "1");
    }
    function pause(paused) {
      if (state.paused === paused || !active()) return;
      state.paused = paused;
      if (paused) {
        for (const timer of state.timers.values()) { if (timer.native !== null) clearTimeout(timer.native); timer.native = null; }
        for (const frame of state.rafs.values()) { if (frame.native !== null) cancelAnimationFrame(frame.native); frame.native = null; }
        for (const observer of state.observers) observer.native.disconnect();
        for (const cancel of [...state.pending]) cancel();
        for (const audio of state.audio) { try { void audio.suspend?.().catch?.(() => {}); } catch {} }
        state.turn = null; state.sessionAt = 0; state.pendingWait = null;
      } else {
        for (const [id, timer] of state.timers) arm(id, timer);
        for (const [id, frame] of state.rafs) frame.native = requestAnimationFrame((time) => { state.rafs.delete(id); if (active() && !state.paused) frame.callback(time); });
        for (const observer of state.observers) for (const [target, options] of observer.records) observer.native.observe(target, options);
        context(); subscribe(); void state.controls?.refresh?.(false);
      }
    }
    function dispose() {
      if (state.disposed) return; state.disposed = true;
      for (const id of [...state.timers.keys()]) clearTimer(id);
      for (const id of [...state.rafs.keys()]) cancelRaf(id);
      for (const observer of state.observers) observer.disconnect(); state.observers.clear();
      for (const entry of state.listeners.splice(0)) entry.target.removeEventListener(entry.name, entry.wrapped, entry.options);
      for (const unsubscribe of state.subscriptions.splice(0)) { try { unsubscribe(); } catch {} }
      for (const cancel of [...state.pending]) cancel();
      for (const context of state.audio) { try { void context.close?.().catch?.(() => {}); } catch {} } state.audio.clear();
      for (const node of state.nodes) { if (node.parentNode) node.parentNode.removeChild(node); } state.nodes.clear();
      for (const url of state.objectUrls) URL.revokeObjectURL(url); state.objectUrls.clear(); state.media.clear();
      state.controls = null;
    }
    listen(document, "visibilitychange", () => pause(document.hidden === true));
    listen(window, "message", (event) => {
      if (event.source !== window || (event.origin && event.origin !== "null" && event.origin !== window.location?.origin)) return;
      nativeEnvelope(event.data);
    }, true);
    listen(window, "codex-message-from-view", (event) => nativeEnvelope(event.detail), true);
    // 设置迁移和首次读取在异步等待中也要记录短任务，绑定原 UI 后统一由 seq 消费。
    subscribe();
    return { state, environment, host, active, pause, dispose, initialize, fetch: fetchCompat, context, session, history, observe, subscribe, nativeEnvelope, prices };
  }
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
  /**
   * 这个节点是不是 Alunixa X 自己（或拓展）的 UI。
   *
   * 内置选择器写在这里；拓展通过注册中心登记的选择器走 isCodexPlusExtensionNode，
   * 那边已把选择器合并成一个串并在 Set 变化时重建缓存，所以这里每次调用只多一次
   * closest()，不会因为拓展数量增长而线性变慢。
   */
  function isExtensionUiNode(node) {
    if (!node?.closest) return false;
    if (node.closest(`.codex-delete-toast, .codex-delete-confirm-overlay, .alunixa-x-modal-overlay, .${alunixaXPageClass}, #${alunixaXSidebarNavId}, #${alunixaXRailNavId}, #${alunixaXRailExtensionsId}, #${alunixaXRailSponsorId}, #${alunixaXRailNavId} > button, #${alunixaXRailExtensionsId} > button, #${alunixaXRailSponsorId} > button, .${codexServiceTierBadgeClass}, .${sessionShareButtonClass}, .${sessionCopyMenuItemClass}, #alunixa-x-menu`)) {
      return true;
    }
    return isCodexPlusExtensionNode(node);
  }

  function scanRelevantSelector() {
    return [
      selectors.sidebarThread,
      '[data-app-action-sidebar-section-heading="Chats"]',
      '[data-app-action-sidebar-section-heading="Projects"]',
      '[data-codex-archive-page-row="true"]',
      "[data-codex-archive-delete-all]",
      '[data-message-author-role]',
      '[data-testid="conversation-turn"]',
      '[class*="user-message"]',
      '[class*="UserMessage"]',
      codexServiceTierComposerFooterSelector,
      selectors.appHeader,
      selectors.archiveNav,
      selectors.pluginNavButton,
      'aside.app-shell-left-panel nav[role="navigation"]',
      'nav[data-app-navigation-rail]',
      ...(codexPluginMarketplacePatchEnabled() ? [selectors.disabledInstallButton] : []),
    ].join(", ");
  }

  function nodeSelfOrAncestorMatchesScanRelevance(node) {
    if (node.nodeType !== 1) return false;
    if (isExtensionUiNode(node)) return false;
    const relevantSelector = scanRelevantSelector();
    return !!node.matches?.(relevantSelector) ||
      !!node.closest?.(relevantSelector) ||
      nodeOrAncestorLooksLikeCodexUserBubble(node);
  }

  function isScanRelevantNode(node) {
    if (node.nodeType !== 1) return false;
    if (isExtensionUiNode(node)) return false;
    return nodeSelfOrAncestorMatchesScanRelevance(node) || !!node.querySelector?.(scanRelevantSelector()) || nodeLooksLikeCodexUserBubble(node);
  }

  function isChatContentMutation(mutation) {
    const target = mutation.target;
    if (!target?.closest?.('[data-message-author-role], [data-testid="conversation-turn"], main .prose')) return false;
    return !Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 && isScanRelevantNode(node)) &&
      !Array.from(mutation.removedNodes).some((node) => node.nodeType === 1 && isScanRelevantNode(node));
  }

  function shouldScheduleScan(mutations) {
    if (!mutations) return true;
    return mutations.some((mutation) => {
      if (isChatContentMutation(mutation)) return false;
      const target = mutation.target;
      if (isExtensionUiNode(target)) return false;
      const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
      const changedElements = changedNodes.filter((node) => node.nodeType === 1);
      // 我们自己插入的节点挂在 Codex 的容器里，而容器本身是 scan-relevant，
      // 于是「写入 → 观察到自己的写入 → 200ms 后再 scan → 再写入」形成自喂循环，
      // 空闲时也每秒全量扫描五次，macOS 上足以吃满一个核（issue #1960）。
      // 一次变更如果只动了我们自己的 UI，就不该再排一次 scan。
      if (changedElements.length && changedElements.every(isExtensionUiNode)) return false;
      if (target?.nodeType === 1 && nodeSelfOrAncestorMatchesScanRelevance(target)) return true;
      return changedElements.some((node) => isScanRelevantNode(node));
    });
  }

  function runScheduledScan() {
    window.__codexSessionDeleteScanPending = false;
    clearTimeout(window.__codexSessionDeleteScanTimer);
    window.__codexSessionDeleteScanTimer = null;
    scan();
  }

  function scheduleScan(mutations) {
    window.__codexSessionDeleteLastMutations = mutations;
    if (!shouldScheduleScan(mutations)) return;
    if (window.__codexSessionDeleteScanPending) return;
    window.__codexSessionDeleteScanPending = true;
    window.__codexSessionDeleteScanTimer = setTimeout(runScheduledScan, 200);
  }

  /**
   * 侧边栏入口的启动补扫。
   *
   * 注入永远早于 Codex 把左侧面板渲染出来：注入那一刻 readyState 已是 complete，
   * 但 aside.app-shell-left-panel 还不存在（实测 anyNav: 0），所以首次 scan 里的
   * installCodexPlusSidebarNavigation 必然走 `if (!navigation) return`。
   *
   * 之后全靠 MutationObserver 观察到侧边栏挂载再补一次，实测要 2.6~3.1 秒。
   * 但那把入口的出现押在了单次 DOM 变更上——那次变更若被 shouldScheduleScan
   * 过滤掉，就没有下一次触发，入口会一直缺失到用户手动操作产生新的变更为止。
   *
   * 这里加一个不依赖 DOM 事件的有界重试作为兜底：插上就停，超时就放弃，
   * 不留常驻定时器，也不影响 observer 那条正常路径。
   */
  function scheduleSidebarNavStartupRetry() {
    clearInterval(window.__alunixaXSidebarNavRetryTimer);
    let attempts = 0;
    window.__alunixaXSidebarNavRetryTimer = setInterval(() => {
      attempts += 1;
      const installed = document.getElementById(alunixaXSidebarNavId)
        || document.getElementById(alunixaXRailNavId);
      if (installed || attempts > 20) {
        clearInterval(window.__alunixaXSidebarNavRetryTimer);
        window.__alunixaXSidebarNavRetryTimer = null;
        return;
      }
      try {
        installCodexPlusNavigationEntries();
      } catch {}
    }, 300);
  }

  void loadBackendSettingsForStartup();
  scan();
  syncOfficialUsagePolicy();
  scheduleSidebarNavStartupRetry();
  window.removeEventListener("resize", window.__alunixaXResizeHandler);
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
  /**
   * 多开实例身份提示。
   *
   * 启动器会在独立 Codex 实例的 renderer 注入前设置
   * `window.__ALUNIXA_X_INSTANCE_LABEL__`（或兼容用的
   * `window.__ALUNIXA_X_INSTANCE_ID__`）。普通主实例没有这些值，因此不会
   * 渲染提示。节点带有扩展归属标记，避免被扫描调度器当成 Codex 原生节点
   * 触发自喂循环；也不占用公开的 window.alunixaX API 名称。
   */
  function installCodexPlusInstanceIdentity() {
    const raw = window.__ALUNIXA_X_INSTANCE_LABEL__ || window.__ALUNIXA_X_INSTANCE_ID__;
    const label = String(raw || "").replace(/\s+/g, " ").trim();
    if (!label) return;
    const mount = () => {
      if (!document.body) return false;
      let node = document.getElementById("alunixa-x-instance-identity");
      if (!node) {
        node = document.createElement("div");
        node.id = "alunixa-x-instance-identity";
        node.setAttribute("data-alunixa-x-ext", "instance-identity");
        node.setAttribute("role", "status");
        node.style.cssText = [
          "position:fixed",
          "top:8px",
          "left:50%",
          "transform:translateX(-50%)",
          "z-index:2147483600",
          "pointer-events:none",
          "user-select:none",
          "box-sizing:border-box",
          "max-width:min(80vw,640px)",
          "overflow:hidden",
          "text-overflow:ellipsis",
          "white-space:nowrap",
          "padding:3px 10px",
          "border:1px solid color-mix(in srgb,currentColor 22%,transparent)",
          "border-radius:999px",
          "background:color-mix(in srgb,var(--color-token-bg-primary,#202020) 88%,transparent)",
          "color:var(--color-token-text-secondary,rgba(210,210,220,.9))",
          "font:11px/16px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
          "letter-spacing:.02em",
          "opacity:.86",
        ].join(";");
        document.body.appendChild(node);
      }
      node.textContent = `Alunixa X 多开 · ${label}`;
      node.setAttribute("aria-label", `当前 Alunixa X 多开身份：${label}`);
      return true;
    };
    if (mount()) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10000);
    }
  }

  runScanStep(scheduleAlunixaXImageOverlay);
  if (window.__ALUNIXA_X_FORCE_CHINESE_LOCALE__?.enabled === true) {
    runScanStep(installAlunixaXForceChineseLocale);
  } else {
    window.__alunixaXForceChineseLocaleRuntime?.dispose?.();
    void restoreCodexPlusManagedLocale();
  }
  runScanStep(installRestoredFeatureStyles);
  runScanStep(installAlunixaXFastStartup);
  runScanStep(installCodexPerformanceProtection);
  installCodexPlusInstanceIdentity();
  runScanStep(installCodexPlusTypingEffects);
  runScanStep(syncCodexPlusWhaleWidget);
  let alunixaXResizeRafId = 0;
  window.__alunixaXResizeHandler = () => {
    cancelAnimationFrame(alunixaXResizeRafId);
    alunixaXResizeRafId = requestAnimationFrame(() => {
      sessionRows().forEach((row) => {
        const group = actionGroupFromRow(row);
        if (group) delete group.dataset.codexActionLayoutStable;
      });
      syncActionGroupsLayout();
      runScanStep(refreshConversationView);
    });
  };
  window.addEventListener("resize", window.__alunixaXResizeHandler);
  window.__codexSessionDeleteObserver?.disconnect();
  window.__codexSessionDeleteObserver = new MutationObserver(scheduleScan);
  window.__codexSessionDeleteObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    // Codex may promote a newly-created row from a temporary client ID to its
    // persisted UUID without replacing the DOM node. Re-scan those rows so the
    // action button and its delete reference are rebuilt from the canonical ID.
    attributes: true,
    attributeFilter: ["data-app-action-sidebar-thread-id", "href"],
  });
  document.removeEventListener("pointerdown", window.__codexSessionActionTriggerHandler, true);
  window.__codexSessionActionTriggerHandler = rememberSessionActionTrigger;
  document.addEventListener("pointerdown", window.__codexSessionActionTriggerHandler, true);
  document.removeEventListener("click", window.__codexSessionActionTriggerClickHandler, true);
  window.__codexSessionActionTriggerClickHandler = rememberSessionActionTrigger;
  document.addEventListener("click", window.__codexSessionActionTriggerClickHandler, true);
  // 对外接口层在此刻挂载：此时所有分片都已执行完毕，闭包里的函数全部就绪。
  // 放在 99-tail 收尾之前，确保 IIFE 结束前 window.alunixaX 已经可用——
  // 用户脚本的注入晚于本脚本，不会撞上这个时间点。
  window.alunixaX = buildCodexPlusExtensionApi();
})();

// === 粘贴修复 (AlunixaX 页面增强) ===
// 控制开关：window.__ALUNIXA_X_PASTE_FIX__ = { enabled: <bool> }
// 由 AlunixaX 在启动时根据 settings.codexAppPasteFix 注入。
// 关闭时不进入 if 体，行为与原 Codex 完全一致；开启时在 document 捕获阶段
// 拦截 paste，若 text/plain 非空则阻止默认行为并调用 execCommand('insertText')
// 插入纯文本，避免 Codex 把 Word 复制的内容识别为附件。
// SENTINEL 保证多次执行（页面刷新、脚本重注入）只装一次 handler。
if (window.__ALUNIXA_X_PASTE_FIX__ && window.__ALUNIXA_X_PASTE_FIX__.enabled === true) {
  (() => {
    const SENTINEL = '__codexPasteFixInstalled__';
    if (window[SENTINEL]) return;
    window[SENTINEL] = true;

    const TAG = '[PasteFix]';

    // 超过这个长度就不再拦截，交回 Codex 原生的「超长文本转附件」逻辑。
    // 否则整段长文本会被 insertText 直接塞进输入框，造成渲染层卡死（issue #1931）。
    const MAX_INLINE_LENGTH = 20000;

    const handler = (e) => {
      const cd = e.clipboardData;
      if (!cd) return;

      const text = cd.getData('text/plain');
      if (typeof text !== 'string' || text.length === 0) return;

      // 长文本放行：让 Codex 自己决定是否转成附件
      if (text.length > MAX_INLINE_LENGTH) {
        console.log(TAG, `text too long (${text.length} chars); letting Codex handle it`);
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (err) {
        console.warn(TAG, 'execCommand threw:', err && err.message);
      }
      if (!ok) {
        console.warn(TAG, 'execCommand failed; please paste again');
      }
    };

    document.addEventListener('paste', handler, { capture: true });
    console.log(TAG, 'paste handler installed (capture phase)');
  })();
}
