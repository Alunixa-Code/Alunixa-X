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
      .alunixa-x-ad-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
        gap: 12px;
      }
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
      .alunixa-x-discovery .alunixa-x-ad-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 32px; }
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
        .alunixa-x-discovery .alunixa-x-ad-list { grid-template-columns: minmax(0, 1fr); }
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
    return { pluginMarketplaceUnlock: true, modelWhitelistUnlock: true, sessionDelete: true, markdownExport: true, sessionShare: true, pasteFix: false, typingEffect: "off", threadIdBadge: false, conversationView: false, whaleWidget: false, conversationViewMaxWidth: conversationViewDefaultWidth, threadScrollRestore: true, nativeMenuPlacement: true, serviceTierControls: false, petRealMouseLook: false, stepwise: false, answerOutline: false, dreamSkinEnabled: false, dreamSkinPaused: false, dreamSkinThemeConfig: window.__ALUNIXA_X_DREAM_SKIN_THEME__ || {}, dreamSkinImagePath: "" };
  }

  const alunixaXBackendSettingMap = {
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
