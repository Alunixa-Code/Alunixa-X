# 2026-09-06 · 中文与 Ultra 提示只读审计

## 范围

- 产品仓库为 `Alunixa-Code/Alunixa-X`，本轮以 v1.0.11 为基线；旧仓库与旧标签不变喵~
- 只读安装版本为 `OpenAI.Codex 26.901.5280.0`，读取 ASAR 索引及 JavaScript 文本，不执行安装资源，不连接当前桌面或 CDP 喵~
- 官方网页检索没有返回可核验正文，直接抓取返回 HTTP 403，因此下列结论来自本机安装资源与隔离测试，而不是无法访问的在线文档喵~

## 中文根因

- `app-initial-ffce11d82782.js` 中语言 Provider 通过 Layer hook 调用 `client.getLayer("72216192")`，读取 `enable_i18n` 与 `locale_source`，显式 `localeOverride` 优先于系统/IDE 语言喵~
- 原增强只包装 `getDynamicConfig`，没有处理当前 `getLayer`；即使 `localeOverride` 为 `zh-CN` 且 HTML 的 `lang` 已变为中文，消息包仍可能因语言开关为 false 而未装载喵~
- React 编译器缓存了 Layer 对象，仅在客户端挂载后替换其方法不能保证已有 Provider 重读结果；修复在必要时使用有持久标记的单次刷新，不清除该标记形成循环喵~
- 原逻辑仅等待五秒、设置失败静默退出、关闭时不还原 navigator/语言方法，也补齐为有界发现/重试、清理旧请求、可恢复配置和方法还原喵~
- 资源名只作为本轮证据，不写入产品中的加载条件喵~

## Ultra 与权限范围

- `app-primary-e4da4cd4dd45.js` 的模型选择路径，仅当当前模式为原生 full-access、目标为 Ultra、当前还不是 Ultra 时，打开 Ultra 专用确认喵~
- 专用确认有继续完全访问与切换受限模式两个不同动作，普通完全访问启用另有自己的确认，不是同一个提示的重复渲染喵~
- 本轮没有修改该原生选择函数、权限 Profile、审批策略、sandbox 或任何确认按钮；没有新增自动授权、自动点击或通用弹窗拦截喵~

## 本地回归

- 十三项新增回归只使用模拟 Statsig、内存存储、可控定时器与假桥接，没有用户配置或真实账号参与喵~
- 前端完整 66 项通过、TypeScript 与 Vite 构建通过，i18n 字典 plain 853/853、template 80/80 匹配喵~
- 完整 Rust 与平台安装验证由本版本正式 GitHub Actions 作为发行门禁，最终运行和资产结果记录在项目 `YHYQ.md` 喵~
