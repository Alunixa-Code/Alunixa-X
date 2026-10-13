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
