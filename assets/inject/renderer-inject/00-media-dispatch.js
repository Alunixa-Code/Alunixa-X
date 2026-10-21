  function installAlunixaXImageOverlay() {
    const config = window.__ALUNIXA_X_IMAGE_OVERLAY__ || {};
    const signature = JSON.stringify(config);
    const previous = window.__alunixaXWallpaperRuntime;
    if (previous?.signature === signature && (previous.loading || previous.element?.isConnected)) return;
    previous?.cleanup?.();
    window.__alunixaXImageOverlayCleanup?.();
    if (!config.enabled || config.kind === "video") {
      installAlunixaXMediaOverlay();
      return;
    }
    let stopped = false;
    let blobUrl = "";
    const runtime = {
      signature,
      loading: true,
      get element() { return document.getElementById(alunixaXImageOverlayId); },
      cleanup() {
        if (stopped) return;
        stopped = true;
        runtime.loading = false;
        window.__alunixaXImageOverlayCleanup?.();
        window.removeEventListener("pagehide", runtime.cleanup);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        if (window.__alunixaXWallpaperRuntime === runtime) delete window.__alunixaXWallpaperRuntime;
      },
    };
    window.__alunixaXWallpaperRuntime = runtime;
    window.addEventListener("pagehide", runtime.cleanup, { once: true });
    const load = async () => {
      if (config.dataUrl) return config.dataUrl;
      const result = await window.__codexSessionDeleteBridge?.("/wallpaper/media", {});
      if (result?.status !== "ok" || !String(result.sourceUrl || "").startsWith("blob:"))
        throw new Error(result?.message || "壁纸文件无法读取，请重新选择");
      if (stopped) { URL.revokeObjectURL(result.sourceUrl); return ""; }
      blobUrl = result.sourceUrl;
      return blobUrl;
    };
    void load().then(async source => {
      if (stopped) return;
      const original = window.__ALUNIXA_X_IMAGE_OVERLAY__;
      window.__ALUNIXA_X_IMAGE_OVERLAY__ = { ...config, dataUrl: source };
      try {
        installAlunixaXCompositedImageOverlay();
      } finally {
        window.__ALUNIXA_X_IMAGE_OVERLAY__ = original;
      }
      const ready = await window.__alunixaXImageOverlayReady;
      if (stopped) return;
      runtime.loading = false;
      if (!ready) throw new Error("壁纸图片无法加载，请重新选择有效的图片");
      sendAlunixaXDiagnostic("wallpaper_ready", { kind: "image" });
    }).catch(error => {
      if (stopped) return;
      runtime.cleanup();
      sendAlunixaXDiagnostic("wallpaper_failed", { kind: "image", message: error?.message || "壁纸文件读取失败" });
    });
  }
