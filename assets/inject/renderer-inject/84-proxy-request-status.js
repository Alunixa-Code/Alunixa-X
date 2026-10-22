  /**
   * 输入框上方的「请求避震」状态条：直接显示当前代理请求走到了哪一步。
   *
   * 状态由代理侧 `/proxy-status` 路由提供（POST），阶段包括：
   *   requesting（正在请求）、waiting（等待上游返回）、
   *   retrying（正在重试 ×N）、generating（正在生成，可带输出 token 估算）。
   *
   * 节点挂在输入卡片之前、同一父容器内（输入框上方），空闲时 display:none，
   * 不占位；带 data-alunixa-x-ext 让扫描调度器排除自喂循环。
   */
  registerCodexPlusExtensionSelector('[data-alunixa-x-ext="builtin-proxy-request-status"]');
  window.__alunixaXProxyRequestStatusRuntime?.dispose?.();

  const alunixaXProxyStatusId = "alunixa-x-proxy-request-status";
  const alunixaXProxyStatusStyleId = "alunixa-x-proxy-request-status-style";
  const alunixaXProxyStatusPollMs = 1200;
  const alunixaXProxyStatusTickMs = 500;

  const alunixaXProxyStatusState = {
    disposed: false,
    pollTimer: 0,
    tickTimer: 0,
    node: null,
    requests: [],
    nowMs: Date.now(),
    inFlight: false,
    failures: 0,
  };

  function alunixaXProxyStatusVisibleElement(element) {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function alunixaXProxyStatusComposerCard() {
    const cards = [...document.querySelectorAll("[data-composer-surface-variant]")];
    let fallback = null;
    for (const card of cards) {
      if (!alunixaXProxyStatusVisibleElement(card) || card.closest("[data-alunixa-x-ext]")) continue;
      fallback = card;
      if (card.querySelector('.ProseMirror[contenteditable="true"], textarea:not(:disabled):not([readonly]), [role="textbox"][contenteditable="true"]')) {
        return card;
      }
    }
    return fallback;
  }

  /** 当前输入框所属会话 id，用于只显示本会话的请求。 */
  function alunixaXProxyStatusThreadId(card) {
    const composerRoot = card?.closest("[data-codex-composer-root]");
    const placement = composerRoot?.getAttribute("data-composer-placement");
    // 首页/新会话的输入框也是 composer，但没有会话归属；必须返回空让状态条隐藏，
    // 不能退化成“显示所有运行中的请求”，否则别的会话的请求会串到这里。
    if (placement && placement !== "thread") return "";
    const fromComposer = composerRoot
      ?.querySelector("[data-above-composer-conversation-id]")
      ?.getAttribute("data-above-composer-conversation-id");
    const inThread = composerRoot?.getAttribute("data-composer-placement") === "thread";
    const fromSidebar = inThread
      ? document
        .querySelector('[data-app-action-sidebar-thread-selected="true"][data-app-action-sidebar-thread-id]')
        ?.getAttribute("data-app-action-sidebar-thread-id")
      : null;
    return String(fromComposer || fromSidebar || "").replace(/^local:/, "").trim();
  }

  function alunixaXProxyStatusNormalizeThreadId(value) {
    return String(value || "").replace(/^local:/, "").trim();
  }

  function alunixaXProxyStatusText() {
    const language = (document.documentElement?.lang || navigator.language || "").toLowerCase();
    const zh = language.startsWith("zh");
    return zh
      ? {
          requesting: "正在请求",
          waiting: "等待上游返回",
          retrying: (count) => `正在重试 ×${count}`,
          generating: "正在生成",
          fallback: "请求进行中",
          lastError: "上次",
          aria: "请求避震状态",
        }
      : {
          requesting: "Requesting",
          waiting: "Waiting for upstream",
          retrying: (count) => `Retrying ×${count}`,
          generating: "Generating",
          fallback: "Request in progress",
          lastError: "Last",
          aria: "Request shock absorption status",
        };
  }

  function alunixaXProxyStatusInstallStyle() {
    if (document.getElementById(alunixaXProxyStatusStyleId)) return;
    const style = document.createElement("style");
    style.id = alunixaXProxyStatusStyleId;
    style.dataset.alunixaXExt = "builtin-proxy-request-status";
    style.textContent = `
      #${alunixaXProxyStatusId}{display:flex;align-items:center;justify-content:flex-end;gap:8px;box-sizing:border-box;width:100%;margin:0 0 6px;padding:0 12px;font-size:12px;line-height:17px;color:var(--color-token-text-secondary,rgba(205,205,215,.95));color:color-mix(in srgb,var(--color-token-text-primary,#dfdfdf) 82%,transparent);user-select:none;cursor:default}
      #${alunixaXProxyStatusId}[data-hidden="true"]{display:none}
      #${alunixaXProxyStatusId} .alunixa-x-proxy-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:#f59e0b;box-shadow:0 0 0 0 rgba(245,158,11,.35);animation:alunixa-x-proxy-pulse 1.4s ease-out infinite}
      #${alunixaXProxyStatusId}[data-phase="retrying"] .alunixa-x-proxy-dot{background:#f97316}
      #${alunixaXProxyStatusId}[data-phase="generating"] .alunixa-x-proxy-dot{background:#22c55e}
      #${alunixaXProxyStatusId}[data-phase="waiting"] .alunixa-x-proxy-dot{background:#60a5fa}
      #${alunixaXProxyStatusId} .alunixa-x-proxy-phase{font-weight:500;white-space:nowrap}
      #${alunixaXProxyStatusId} .alunixa-x-proxy-meta{opacity:.65;white-space:nowrap;font-variant-numeric:tabular-nums}
      #${alunixaXProxyStatusId} .alunixa-x-proxy-error{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f87171;opacity:.85}
      @keyframes alunixa-x-proxy-pulse{0%{box-shadow:0 0 0 0 rgba(245,158,11,.35)}70%{box-shadow:0 0 0 5px rgba(245,158,11,0)}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}
    `;
    document.head?.appendChild(style);
  }

  function alunixaXProxyStatusEnsureNode(card) {
    // 挂在 composer root 之前，而不是输入卡片之前：切会话时卡片会被 React
    // 放进只包住输入框的 relative 容器里，插在卡片前会跑到输入框内部。
    const anchor = card?.closest("[data-codex-composer-root]") || card;
    if (!anchor?.parentElement) return null;
    let node = alunixaXProxyStatusState.node;
    if (!node) {
      node = document.createElement("div");
      node.id = alunixaXProxyStatusId;
      node.setAttribute("data-alunixa-x-ext", "builtin-proxy-request-status");
      node.setAttribute("role", "status");
      alunixaXProxyStatusState.node = node;
    }
    if (!node.isConnected || node.nextElementSibling !== anchor) {
      anchor.insertAdjacentElement("beforebegin", node);
    }
    return node;
  }

  function alunixaXProxyStatusHide() {
    const node = alunixaXProxyStatusState.node;
    if (node) node.dataset.hidden = "true";
  }

  function alunixaXProxyStatusFormatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
  }

  function alunixaXProxyStatusRender() {
    const card = alunixaXProxyStatusComposerCard();
    const threadId = card ? alunixaXProxyStatusThreadId(card) : "";
    // 首页/新会话没有当前会话 id：不能把“没有会话”当成“不过滤”，
    // 否则会把别的会话里正在运行的请求显示到首页（串会话）。
    if (!card || !threadId) {
      alunixaXProxyStatusHide();
      return;
    }
    const visibleRequests = alunixaXProxyStatusState.requests.filter(
      (item) => alunixaXProxyStatusNormalizeThreadId(item?.threadId) === threadId,
    );
    const request = visibleRequests[0];
    if (!request) {
      alunixaXProxyStatusHide();
      return;
    }
    const node = alunixaXProxyStatusEnsureNode(card);
    if (!node) return;
    const text = alunixaXProxyStatusText();
    const phase = String(request.phase || "");
    const retries = Number(request.autoRetries) || 0;
    const attempts = Number(request.attempts) || 0;
    let label = text.fallback;
    if (phase === "requesting") label = text.requesting;
    else if (phase === "waiting") label = text.waiting;
    else if (phase === "retrying") label = text.retrying(Math.max(1, retries));
    else if (phase === "generating") label = text.generating;
    else if (retries > 0) label = text.retrying(retries);

    const attemptDetails = Array.isArray(request.attemptDetails) ? request.attemptDetails : [];
    const lastAttempt = attemptDetails.length ? attemptDetails[attemptDetails.length - 1] : null;
    const lastErrorCode = String(lastAttempt?.code || "").trim();
    const lastErrorMessage = String(lastAttempt?.message || "").trim();
    const lastError = lastErrorCode || lastErrorMessage.slice(0, 80);

    const meta = [];
    if (request.model) meta.push(String(request.model));
    const startedAtMs = Number(request.startedAtMs) || 0;
    if (startedAtMs > 0) meta.push(alunixaXProxyStatusFormatDuration(alunixaXProxyStatusState.nowMs - startedAtMs));
    const estimated = Number(request.estimatedOutputTokens) || 0;
    if (phase === "generating" && estimated > 0) meta.push(`~${estimated > 999 ? `${(estimated / 1000).toFixed(1)}k` : estimated} tok`);
    else if (attempts > 1) meta.push(`第 ${attempts} 次`);
    if (visibleRequests.length > 1) meta.push(`+${visibleRequests.length - 1}`);

    node.dataset.hidden = "false";
    node.dataset.phase = phase || "requesting";
    node.setAttribute("aria-label", text.aria);
    node.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "alunixa-x-proxy-dot";
    const phaseNode = document.createElement("span");
    phaseNode.className = "alunixa-x-proxy-phase";
    phaseNode.textContent = label;
    node.append(dot, phaseNode);
    if (meta.length) {
      const metaNode = document.createElement("span");
      metaNode.className = "alunixa-x-proxy-meta";
      metaNode.textContent = meta.join(" · ");
      node.appendChild(metaNode);
    }
    if (lastError) {
      const errorNode = document.createElement("span");
      errorNode.className = "alunixa-x-proxy-error";
      errorNode.textContent = `${text.lastError} ${lastError}`;
      errorNode.title = lastErrorMessage || lastErrorCode;
      node.appendChild(errorNode);
    }
  }

  async function alunixaXProxyStatusPostWithTimeout() {
    // 桥接挂死时 __codexSessionDeleteBridge 的 Promise 可能永远不 settle。
    // 不设超时会让 inFlight 永久为 true，状态条从此不再刷新（只能重启恢复）。
    let timer = 0;
    try {
      return await Promise.race([
        postJson("/proxy-status", {}),
        new Promise((resolve) => {
          timer = window.setTimeout(
            () => resolve({ status: "failed", message: "桥接请求超时", timeout: true }),
            2500,
          );
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function alunixaXProxyStatusRefresh() {
    if (alunixaXProxyStatusState.disposed || alunixaXProxyStatusState.inFlight) return;
    if (document.hidden) return;
    alunixaXProxyStatusState.inFlight = true;
    try {
      const result = await alunixaXProxyStatusPostWithTimeout();
      if (result?.status === "ok" && Array.isArray(result.requests)) {
        alunixaXProxyStatusState.requests = result.requests;
        alunixaXProxyStatusState.failures = 0;
      } else if (result?.timeout) {
        // 让看门狗把桥接判定为失效并重注入；桥恢复后下一轮轮询自动接上。
        recordCodexPlusBridgeFailure();
        throw new Error("proxy-status bridge timeout");
      }
    } catch {
      alunixaXProxyStatusState.failures += 1;
    } finally {
      alunixaXProxyStatusState.inFlight = false;
    }
    if (!alunixaXProxyStatusState.disposed) alunixaXProxyStatusRender();
  }

  alunixaXProxyStatusInstallStyle();
  alunixaXProxyStatusRender();
  alunixaXProxyStatusState.pollTimer = window.setInterval(
    () => void alunixaXProxyStatusRefresh(),
    alunixaXProxyStatusPollMs,
  );
  alunixaXProxyStatusState.tickTimer = window.setInterval(() => {
    alunixaXProxyStatusState.nowMs = Date.now();
    alunixaXProxyStatusRender();
  }, alunixaXProxyStatusTickMs);
  void alunixaXProxyStatusRefresh();

  window.__alunixaXProxyRequestStatusRuntime = {
    refresh: alunixaXProxyStatusRefresh,
    dispose() {
      alunixaXProxyStatusState.disposed = true;
      window.clearInterval(alunixaXProxyStatusState.pollTimer);
      window.clearInterval(alunixaXProxyStatusState.tickTimer);
      alunixaXProxyStatusState.node?.remove();
      alunixaXProxyStatusState.node = null;
      document.getElementById(alunixaXProxyStatusStyleId)?.remove();
    },
  };
