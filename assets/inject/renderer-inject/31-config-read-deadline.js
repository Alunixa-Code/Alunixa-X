  // 原生准备会话时会读取本地配置；该 fetch 没有默认超时，丢失响应会同时
  // 挂住恢复和发送队列。只约束这一个只读接口，不接管原生恢复/提交生命周期。
  function installCodexConfigReadDeadline() {
    if (window.__alunixaXConfigReadDeadline) return;
    const pending = new Map();
    const deadlineMs = 15_000;
    const runtime = { pending, deadlineMs };

    const clear = (requestId) => {
      const timer = pending.get(requestId);
      if (timer === undefined) return;
      pending.delete(requestId);
      window.clearTimeout(timer);
    };
    const outgoing = (event) => {
      if (event?.__codexForwardedViaBridge !== true) return;
      const message = event?.detail;
      if (message?.type === "cancel-fetch") {
        clear(message.requestId);
        return;
      }
      if (message?.type !== "fetch" || message.method !== "POST"
          || message.url !== "vscode://codex/mcp-codex-config"
          || typeof message.requestId !== "string" || !message.requestId
          || pending.has(message.requestId)) return;
      const requestId = message.requestId;
      const timer = window.setTimeout(() => {
        if (pending.get(requestId) !== timer) return;
        pending.delete(requestId);
        // 取消宿主读取，同时让原生 fetch 自己清理 pending、reject 等待者。
        // 不吞掉配置错误，也不自动重发任何用户消息。
        try {
          const cancel = { type: "cancel-fetch", requestId };
          const bridge = window.electronBridge;
          if (typeof bridge?.sendMessageFromView === "function") {
            Promise.resolve(bridge.sendMessageFromView(cancel)).catch(() => {});
          } else {
            window.dispatchEvent(new CustomEvent("codex-message-from-view", { detail: cancel }));
          }
        } catch {
          // 宿主取消失败时仍需释放 renderer 的等待；迟到响应由原生按 ID 忽略。
        }
        window.dispatchEvent(new MessageEvent("message", {
          source: window,
          origin: window.location.origin,
          data: {
            type: "fetch-response",
            requestId,
            responseType: "error",
            status: 408,
            error: "Timed out reading Codex configuration. Please try again.",
          },
        }));
        sendCodexPlusDiagnostic("config_read_deadline_exceeded", { deadlineMs });
      }, deadlineMs);
      pending.set(requestId, timer);
    };
    const incoming = (event) => {
      if (event?.source != null && event.source !== window) return;
      const origin = String(event?.origin || "");
      if (origin && origin !== "null" && origin !== window.location.origin) return;
      if (event?.data?.type === "fetch-response") clear(event.data.requestId);
    };
    window.addEventListener("codex-message-from-view", outgoing, true);
    window.addEventListener("message", incoming, true);
    window.__alunixaXConfigReadDeadline = runtime;
  }
