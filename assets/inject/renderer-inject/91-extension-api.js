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
