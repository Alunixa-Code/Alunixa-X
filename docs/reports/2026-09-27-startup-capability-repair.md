# 启动与能力配置排查

## 证据边界

| 问题 | 已有证据 | 尚未确认 |
| --- | --- | --- |
| 应用隔离代理 | 用户 ProcMon 记录表明打包进程读取的注册表视图启用了无监听的本机代理；包上下文关闭后请求恢复 | 初始写入者；不能归因于 AX |
| 白屏/转圈 | 用户现场关闭代理且 PAC 为空仍白屏；当前安装包 26.924.2738.0、后台 0.158.0-alpha.2.1 已只读确认 | 白屏首次初始化错误；菜单注入成功不等于界面就绪 |
| 配置不一致 | 旧 save_settings 先写 settings 后写多个配置且无事务；部分前端乐观开关失败后未恢复；fast_mode 删除不等于关闭 | 每个注入适配器对新版 bundle 的实际支持程度 |
| 概览误报 | helperReady 只取 latest_launch.helper_port；其他计数仅取模型名、开关和安装版本 | 模型请求未测试，禁止显示为成功 |

### 已进一步复现的实现问题

- **原生模块拆分**：当前安装包的 `app-shared-*` 导出设置读写、Host RPC、dispatcher、终端等服务；旧代码只搜索 `app-initial-*` 等旧分块，并依赖短导出名。只读 ASAR + AST 契约验证能够找到新导出，生产解析器已经按函数/对象结构解析，并保留旧布局回退。这证实了适配缺陷，**不证明它是白屏的唯一原因**。
- **启动伪就绪**：旧快速启动补丁会改写 Statsig 初始化状态/成功结果，不能据此判断原生初始化成功。现在只限制遥测请求时间，不伪造初始化成功。
- **隐式覆盖**：启动、供应商切换和登录后共用的能力同步，原先无条件写回 AX 保存的 Fast、Goals、线程数和 WSS 期望，可能撤销外部修改。已移除这些隐式写入；明确保存仍使用修订校验和事务写入，启动只检查现存值的类型，缺省项留给运行时。
- **默认开启不等于已关闭**：隔离的当前 CLI 证实 Fast、Goals 默认 `true`，显式 `false` 可在后续新进程中保持关闭。单纯删除键或比较 AX 内存里的旧 `false` 都不足以关闭。Fast 控件现在读取磁盘/CLI 默认，明确操作附带字段意图，即使与 AX 旧值相同也写入。
- **profile 新格式**：该 CLI 拒绝根级 `profile`/`profiles`，支持 `--profile name` + `$CODEX_HOME/name.config.toml`。此外，`features list` 本身拒绝 `--profile`，不能用于验证该层；实际验证改用 `mcp list --json` 读取禁用的测试 MCP，不执行工具。上轮草稿的检测方法已经撤回。
- **开发草稿回归**：新增 profile 测试发现 `toml::Value` 对不存在键进行索引赋值会 panic，已改用 table `insert`；这不是对已发布 1.0.27 故障根因的归因。

## 实施边界

- 不删除用户会话、auth.json，不全量重置应用，不改已验证 API/模型。
- 写入前备份；合并目标配置，原子替换，回读校验；冲突或失败返回错误。
- 隔离代理必须进入实际包上下文；禁用状态的残留地址不是故障。
- 仅已启用、无 PAC、全部端点为本机且连续探测均明确拒绝连接时允许自动关闭 ProxyEnable；保留地址、例外列表和合法代理。
- 运行时、磁盘配置和管理器期望分别显示；无法读取、适配或验证时显示未知。
- XJ.md、YHYQ.md 始终仅本地，不纳入提交或发行。

## Agent 能力映射（实现审查基线）

| 设置/功能 | 配置来源 | 依赖/验证方式 | 生效边界 |
| --- | --- | --- | --- |
| enhancementsEnabled / launchMode | AX settings.json | 启动器和 renderer bridge | 重启 |
| Computer Use Guard | config.toml、bundled 插件、notify | Windows、官方插件、适配器 | 重启；不能保证插件安装成功 |
| 插件市场解锁 / 全量展示 | AX设置、renderer适配 | patch模式、原生插件页接口 | 重启；适配失败必须未知 |
| 模型白名单 / Fast按钮 | AX设置、模型目录、原生控件 | 对应运行时适配和模型元数据 | 重启/运行时检查 |
| Fast模式 | config.toml [features].fast_mode | CLI特性表，显式true/false | 保存后待重启 |
| 删除 / 导出 / 移动 / 短ID | AX设置、renderer、helper会话服务 | 原生侧栏结构、数据库权限 | 重启；进程存活不代表可用 |
| 粘贴修复 / 宽度 / 滚动位置 | AX设置、renderer | 当前DOM/编辑器适配 | 重启 |
| 高级提示词 | config.toml model_instructions_file、独立正文 | 文件存在、配置层覆盖 | 保存后待重启 |
| Stepwise / 直接发送 | AX设置、helper、浮层 | 独立API/模型配置、原生输入框 | 重启 |
| 记忆嵌入 | AX设置、hooks.json、嵌入接口 | hook信任、API配置；失败BM25回退 | 后续请求/重启hook注册 |
| AI终端 / 共享终端 / 保留时间 | AX设置、hooks.json、终端broker | Windows、所选shell、hook信任 | 重启/后续命令 |
| 桌宠真实鼠标 | AX设置、V2 overlay适配 | Windows V2桌宠 | 新请求；V1不支持 |
| 强制中文 / 快速启动 | AX设置、启动参数、Statsig适配 | 当前bundle适配 | 重启 |
| 自动更新禁用 | desktop配置及进程参数 | 实际桌面更新器 | 重启 |
| 禁用WSS | 当前model_provider.supports_websockets | provider解析及更高优先级配置 | 保存后待重启 |
| 性能保护 | AX设置、CDP/扫描策略、工作区 | 实际启动路径 | 重启 |
| 原生菜单位置 / 汉化 | AX设置、CDP/main inspector | 当前菜单适配 | 重启 |
| Zed Remote / 项目记录 | AX设置、外部Zed、AX registry | Zed安装、SSH项目 | 后续调用 |
| 同步Zed settings | 仅AX设置，没有实现写入 | 未实现 | 不得作为已生效能力 |
| Upstream worktree | AX设置、renderer/helper/git | Git仓库、原生入口适配 | 后续调用 |
| Responses ID协商 | AX设置、HTTP代理 | 必须走AX协议代理 | 后续请求 |
| Goals | config.toml features.goals | 当前CLI特性支持 | 保存后待重启 |
| 应用隔离代理恢复（新增） | 实际包上下文 Internet Settings | 动态包身份、只测本机端口、备份回读 | 启动前自动；手动修复后提示重启 |

### 逐项设置清单

下面的默认值是 **AX 自身设置的默认值**，不是 Codex 的默认值或当前运行中的状态。除专门验证的 CLI 配置外，原生适配器没有端到端运行证据时一律为“运行时未验证”，不能仅凭设置为 `true` 声称可用。所有 `settings.json` 均指 AX 自己的设置存储，不是 Codex 配置。

| 配置键 | AX 默认 | 实际存储/依赖 | 生效与处理 |
| --- | --- | --- | --- |
| `enhancementsEnabled` | true | settings、启动器、renderer | 下次启动；不是联网/模型健康状态 |
| `computerUseGuardEnabled` | false | config、官方 bundled 插件、notify | Windows；需要插件与权限，重启核对 |
| `codexAppPackagedProxyRepair` | true | settings；包上下文注册表 | 启动前仅定向关闭失效本机代理；Windows 外不支持 |
| `codexAppPluginMarketplaceUnlock` | true | settings、原生插件页、patch 模式 | 重启；缺适配器不宣称成功 |
| `codexAppPluginAutoExpand` | true | settings、插件页 DOM | 重启；不代表插件已安装 |
| `codexAppModelWhitelistUnlock` | true | settings、模型目录、模型列表适配 | 重启；需要真实供应商模型 |
| `codexAppServiceTierControls` | false | settings、设置服务、dispatcher、模型元数据 | 重启；已适配 shared 分块，仍需模型支持 |
| `codexAppFastMode` | false | `features.fast_mode` | 当前 CLI 默认 true；显式关闭写 false；保存待重启 |
| `codexAppSessionDelete` | true | settings、侧栏、helper、会话存储权限 | 重启；实际删除仍需按原流程确认/备份 |
| `codexAppMarkdownExport` | true | settings、侧栏、helper、导出目录 | 重启；目录权限错误不能算成功 |
| `codexAppPasteFix` | false | settings、原生编辑器 | 重启；取决于输入框适配 |
| `codexAppProjectMove` | true | settings、Host RPC、会话存储 | 重启；已适配 RPC 发现，不等于已实测迁移 |
| `codexAppThreadIdBadge` | false | settings、侧栏 DOM | 重启 |
| `codexAppConversationView` | false | settings、renderer 样式 | 重启 |
| `codexAppThreadScrollRestore` | true | settings、会话 DOM/导航 | 重启；适配未验证时保留未知 |
| `codexAppInstructionsEnabled` | false | `model_instructions_file`、独立正文 | 保存待重启；外部引用/profile 覆盖须单独处理 |
| `codexAppStepwiseEnabled` | false | settings、独立 API/模型/凭据、浮层 | 重启；缺依赖明确显示 |
| `codexAppStepwiseDirectSend` | false | settings、Stepwise、原生输入框 | 依赖 Stepwise；不把保存当成已发送 |
| `codexAppMemoryEmbeddingEnabled` | false | settings、hooks、嵌入 API/模型 | 后续请求；需要 hook 信任，失败 BM25 回退 |
| `codexAppAiShell` | pwsh | settings、Windows shell、hook/终端 broker | Windows，重启；所选 shell 不存在时按既有回退策略 |
| `codexAppSharedTerminal` | false | settings、hooks、原生终端管理器 | Windows，重启；已适配新终端导出 |
| `codexAppSharedTerminalRetentionMinutes` | 2 | settings、终端 broker | 0–5 分钟；配置值不等于终端当前存活状态 |
| `codexAppPetRealMouseLook` | false | settings、Windows V2 桌宠组件 | V1/非 Windows 不支持；组件未验证不显示生效 |
| `codexAppForceChineseLocale` | true | settings、启动语言/renderer | 重启；与管理器中英俄切换独立 |
| `codexAppFastStartup` | false | settings、遥测 fetch 限时 | 重启；不再伪造 Statsig Ready |
| `codexAppDisableAutoUpdate` | false | settings、desktop 更新器配置/参数 | 重启；不等同于所有分发渠道都停止更新 |
| `codexAppDisableWss` | false | 当前 provider 的 `supports_websockets`、恢复记录 | 明确保存才写；支持可逆恢复，不改 provider 身份；未知/覆盖不可当作生效 |
| `codexAppPerformanceProtection` | true | settings、启动/扫描/CDP 策略 | 重启；需要工作区与当前适配 |
| `codexAppNativeMenuPlacement` | true | settings、主进程 inspector/menu | 重启；菜单出现不等于原生界面就绪 |
| `codexAppNativeMenuLocalization` | true | settings、原生菜单适配 | 重启；未知菜单项不强行翻译 |
| `codexAppZedRemoteOpen` | true | settings、Zed、SSH 项目入口 | 后续调用；需要实际安装和连接条件 |
| `zedRemoteProjectRegistryEnabled` | true | settings、AX 项目登记 | 后续调用；不验证 SSH 网络 |
| `zedRemoteSyncToZedSettings` | false | 只有存储字段，缺少写入实现 | **不支持/未实现，禁止当作已生效** |
| `zedRemoteOpenStrategy` | addToFocusedWorkspace | settings、Zed 入口 | 后续调用；依赖 Zed |
| `codexAppUpstreamWorktreeCreate` | true | settings、Git、renderer/helper | 后续调用；需要仓库与入口适配 |
| `codexAppResponsesIdNegotiation` | false | settings、AX 协议代理 | 后续请求；不走 AX 代理时缺少依赖 |
| `codexGoalsEnabled` | false | `features.goals` | 当前 CLI 默认 true；显式关闭写 false；保存待重启 |
| `codexAppSubAgentMaxThreads` | 见 Settings 默认常量 | `agents.max_threads` | 明确保存后待重启；启动不再重置用户线程数；profile 优先时拒绝伪成功 |

## 配置层与覆盖

AX settings 是期望值，不是 Codex 的有效配置；Codex 还可能读取 CODEX_HOME、全局 config、项目 .codex/config.toml、profile、启动 -c 参数、环境变量、受管策略、插件/MCP 和进程内快照。
读取全局文件不能声称已确定任意项目或现有任务的有效值；原生 app-server 未提供成功读取时保留未知，并列出检测到的覆盖来源。

官方当前层级从高到低为：CLI flags / `--config` → 可信项目 `.codex/config.toml`（更近目录优先）→ 所选独立 profile → 用户 config → 工作区云端默认 → 系统 config → 内置默认；`requirements.toml` 强制策略另行约束，不是普通覆盖层。管理器只能报告实际查到的作用域，不能把自己的工作目录当作每个任务的工作目录。

- `CODEX_HOME` 决定文件位置，诊断保留实际配置路径；变量值和密钥不进入公开报告。
- profile 文件的创建、修改、删除纳入修订号，不能在外部修改后继续使用旧快照保存。
- 原始配置编辑、工具页同步、供应商切换共用配置锁/事务；保存队列使用上次成功返回的修订号。
- 写前备份包含关联文件和后续新建的受管模型目录；写后回读，失败只撤回仍由本次事务拥有的内容，不覆盖外部刷新后的 auth。
- 发生外部变化后反复点“重新检测”不能绕过失效快照保护；必须重新读取配置。无法解析时禁用盲目修改，原生未知开关使用混合态，不用 `false` 冒充检测结果。

## 文件与行为

| 文件/模块 | 修改 |
| --- | --- |
| `packaged_proxy.rs`、`packaged_proxy_windows.rs`、`assets/proxy-package.ps1` | 动态包身份、真实注册表视图指纹、PID、启用状态、本机端点；同上下文备份/定向关闭/回读/恢复；旧 launcher ABI 保护 |
| `app_paths.rs`、`launcher.rs`、启动器 `main.rs` | 更新后重查注册包；重复启动仅激活；注入整体截止时间；启动前包代理检查；移除原生能力的隐式旧值回写 |
| `runtime_health.rs`、`bridge.rs` | 真实 helper/CDP/原生 DOM 检查；有限初始化等待；首次 renderer 异常记录固定类型、资源文件名和位置，不记录正文/查询参数 |
| `renderer-inject.js` | 新 shared 分块服务发现；可重复安装/可恢复的 fetch 包装，不伪造初始化成功 |
| `config_transaction.rs`、`settings.rs` | 跨进程锁、修订、唯一临时文件、备份、原子写入、回读及拥有权回滚 |
| `agent_capabilities.rs`、`startup_audit.rs` | 38 项清单、真实 CLI 默认、profile 层/支持性检查；显式写入意图；缺省值与运行状态分离 |
| `relay_config.rs`、`relay_switch.rs`、管理器 `commands.rs` | 显式保存与后台同步分离；TOML 合并、WSS 恢复、auth 保留、冲突/失败可见 |
| 管理器 `App.tsx`、`AgentHealthPanel.tsx` | 代理恢复入口、视图对照、实际开关/未知态、失败回滚、外部变化刷新、真实运行状态代替 5/5 |
| `windows-app-manifest.xml`、基础 UI 控件、字体/样式 | 定向同步上游 asInvoker 和基础控件更新，保留 AX 品牌及俄语 |

## 验证边界与回退

- 自动化覆盖代理关闭残留、全本机拒绝连接、监听正常、PAC/外部/未知保护、备份失败、恢复冲突，以及旧 helper 禁止误启动。
- 隔离 CLI 使用临时 `CODEX_HOME`，不使用真实凭据：Fast/Goals 的 true/false、新进程回读、独立 profile 加载、旧 profile 拒绝、无效 guardianv2 拒绝均已通过。
- 当前安装 ASAR 只读契约测试通过；不导入原生服务、不执行原生构造器、不热注入用户窗口。
- Chromium 验证生产管理器、失败保存回滚、默认开启的明确关闭、外部变化、代理修复入口限制和窄窗；原生 DOM 判定另测空白/转圈、只有 AX 菜单、隐藏编辑器和真实可见编辑器。
- **尚未完成**：真实失效代理的写入/恢复实操、当前用户 Codex 的完整直接启动与 AX 启动对照、白屏首次错误的现场复现、实际模型请求、每个 UI 适配器的逐项端到端验收、macOS 现场、完整上游同步和正式发行。不能把 mock/AST/CI 当作这些现场结果。
- 不重启当前 Codex，不修改真实 auth/config，不删除会话；旧版本程序和已发布标签保持不变。
- 配置失败恢复使用所用 home 下 `alunixa-x-config-transactions/<id>/manifest.json` 与对应 `.bak`；恢复前核对当前修订，不能整目录覆盖新认证。代理恢复仅通过同包上下文操作并核对身份及修订。
- 源码回退以本分支检查点/定向 revert 为单位，不使用 `reset --hard`，不将本机 `XJ.md`、`YHYQ.md` 加入 Git。

## 上游同步范围

已抓取并固定 `upstream/v1.2.48` 至 `upstream/v1.3.0`；目标产品提交 `be6a45852f9992a688f33be933f444ee098fc67a`。
本地包/路径已改名，普通 merge-base 回到 Python 时代，不能直接整树覆盖；需按映射后的三方差异迁移，广告排除，保留本地协议保真、壁纸、俄语及上下文修复。
未完成逐项验证前不得宣称“全部同步完成”。

已定向迁移路径发现/CDP、TOML 语义合并、受管模型目录切换、协议代理启动校验、基础控件和 asInvoker；不使用机械整树覆盖来丢弃本地协议保真、媒体与俄语。原始映射共有 164 路径，其中 52 个三方冲突、7 个排除项；该映射是审查清单，**不是 164 路径已经迁入的证明**。
