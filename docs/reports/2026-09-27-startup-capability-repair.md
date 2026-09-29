# 启动与能力配置排查

## v1.0.29 白屏与闪退补充证据

- **AX 闪退根因已确认**：v1.0.28 已成功加载 renderer 注入、模型目录、dispatcher 和壁纸后，`wait_for_native_ui` 在 20 秒内未找到原生 composer，返回验证错误；启动流程此前已把 `keep_launched_on_error` 设为 `false`，错误清理随后对打包激活取得的 `ChatGPT.exe` 主 PID 调用 `TerminateProcess`。日志中的 `renderer.startup_model_injection_ready`、`renderer.service_tier_dispatcher_patch_installed`、`launcher.native_ui_unconfirmed` 与最终 failed 状态按顺序对应，窗口退出是 AX 主动清理，不是未证实的随机崩溃。
- **官方直接启动的白屏原因仍未确认**：用户稳定复现为直接启动也白屏，手动结束其子 `codex.exe` 后出现原生错误页，点击 `Try again` 恢复。只读进程时间证据显示主 `ChatGPT.exe` 先启动，当前工作的 app-server `codex.exe` 是用户重试后才生成；这证明后台生命周期可恢复，但不能据此断定首次 app-server 为什么卡住。
原生恢复契约已核实：对当前安装 `app.asar` 的 preload、主进程 fetch handler、连接注册表和 restart 实现做只读核对。恢复不再依赖增强注入成功或动态导入的 dispatcher，而是通过 `electronBridge.sendMessageFromView` 查询 `vscode://codex/app-server-connection-state`。该端点直接解构 JSON body，必须传 `{hostId: "local"}`，不能包装成 `{params: ...}`；嵌套错误会误查未定义主机并返回 disconnected，已通过失败→修复通过的协议回归纠正。符合恢复条件时发送与原生 Try again 相同的 `codex-app-server-restart`，使用 `hostId: "local"`、`intent: "restart"`、`errorMessage: null`，不直接调用 OS 终止进程接口。

2026-09-28 最终源码生命周期取代早期说明：正式启动入口 `LauncherHooks` 已补齐 `wait_for_native_ui` 委托，避免 trait 默认空实现绕过恢复。启用增强时，不论注入是否成功，都进入有界原生健康确认：先等 UI 最多 10 秒，再以最多 8 秒外层等待查询实际连接，仅对 connecting/disconnected 或 connection-failed/restart-required 尝试一次本地恢复，随后再等 UI 最多 25 秒。connected、restarting、登录/升级/未知错误不重启；renderer 异常本身不作为禁止查询后台的依据。并发检查不会重复派发；IPC 返回 requested/completed 不是界面成功证据，只有真实原生 DOM 满足健康条件才成功。关闭增强时保留不自动恢复的边界，启动消息明确说明原生界面未验证，不再宣称 launcher ready。

Codex 创建成功后的注入、验证、watchdog、原生 UI 和状态持久化失败均保留窗口及 LaunchHandle，以 running_degraded 描述未完成阶段，不再转入终止桌面的清理路径；Helper 可能承载协议代理，必须一起保留。多个降级阶段累计记录，诊断仅保存固定阶段、白名单枚举及布尔值。启动前配置审计或真正创建进程失败仍返回错误。状态文件无法写入时不能承诺磁盘状态已刷新，只能保留句柄并报告固定诊断。Windows PID 等待失败改为继续进程/CDP存活确认；LaunchHandle 的等待错误会重试，不能把等待API失败当成自然退出而提前关闭Helper。
- **界面判定**：composer、主页、设置、登录、导航和侧栏壳层可证明原生 UI 存在；spinner、`aria-busy`、AX 自身 DOM、隐藏元素和带 `Try again` / `Retry` / 中俄重试文案的错误页不会冒充成功。
- **边界**：没有重启当前已经恢复的真实任务，也没有在活动会话上热触发 app-server restart；因此新二进制的真实直接启动/AX 启动对照仍需安装后现场验证。源码回归和实际包契约不等同于该现场复测。

## 2026-09-28 本轮隔离验证与剩余门禁

最终源码的 `cargo test -p alunixa-x-core --locked -j 2` 明确退出 0：含 doc-tests 共 30 个结果块，合计 1027 passed、0 failed、1 ignored。其中核心单元 363 passed/1 ignored、launcher 集成 86 passed；新增正式入口委托、等待截止保留最后观测、挂起探针超时、Helper 等待错误保活均通过。生产 launcher 包另跑 6 项测试通过，`cargo check -p alunixa-x-launcher --locked -j 2` 和本轮四个 Rust 文件的定向 rustfmt 检查通过。此处是 Linux 隔离环境结果，不是 Windows cfg 分支执行或完整 workspace/三平台门禁；没有新增忽略项。

前端 139 项测试、TypeScript、英俄字典和占位符检查通过：普通键各 916/916、模板各 80/80、俄语后端 106/106、后端正则英俄各 80/80。使用原 package-lock 在临时目录执行 npm ci 后，生产 Vite 构建通过；未修改用户现有 node_modules 或锁文件。最新构建的完整 `verify-agent-health-ui.py` 在隔离 Chromium 通过，覆盖原生加载/AX覆盖层/隐藏DOM/重复或翻译 aria-label 的重试错误页，以及 Fast/Goals 磁盘默认、即时保存未提交编辑、失败回滚、外部配置变化、代理入口门控和窄窗。这些 UI 测试使用模拟后端，不写真实配置、注册表或运行实例。

仍未完成的是 Windows 新二进制直接启动与 AX 启动对照、真实白屏恢复及首个后台卡住原因、模型请求和正式安装包/三平台发行。本轮没有安装、发布或重启真实 Codex，没有对活动窗口热注入恢复消息，没有删除 auth、会话或重置用户配置。仅可将本轮称为源码修复与隔离回归完成，不能称现场故障已全部解决。

本轮未创建 Git 提交：现有 `.git/index.lock` 阻塞正常暂存，未擅自删除该锁或修改当前索引/分支。已在独立临时索引核验基于 `6a7b223` 的定向补丁，只含本轮 11 个源码、测试及报告文件，排除行尾噪声、XJ/YHYQ、配置、凭据和临时输出；补丁保存于本地 `.tmp/startup-recovery-2026-09-28.patch`。恢复正常仓库写入后应先检查并发操作，再提交这 11 个路径。回退应优先使用提交后的定向 revert；当前未提交补丁只能在确认后续改动无冲突并通过反向应用检查后定向撤销，不使用 reset --hard，不覆盖凭据。

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
- **工具停用被启动撤销**：新增隔离回归证实工具同步删除 `enabled=false` 的 MCP/插件项；角色插件启动注册遇到缺项会重新补 `true`。现在保留显式 `false`，将旧 MCP `disabled=true` 定向转换为 `enabled=false`，并验证两次启动注册仍关闭。内联插件表中的关闭和自定义字段也保留，错误类型不再被覆盖为默认开启。
- **旧 Hook 信任覆盖当前状态**：新增回归证实旧供应商快照里的 `trusted_hash` / `enabled` 会压过当前文件，已撤销的条目也会复活。供应商切换现在以当前 `hooks.state` 为整体权威状态（包括不存在），不复用快照中的旧信任；原始配置编辑不经过这个保护，因此可明确撤销信任。
- **缺省状态复活**：全局 Fast/Goals/线程数已经删除时，旧供应商快照仍可把它们带回来。现在区分首次导入与已有配置切换，已有配置中的缺省状态也保留；其他功能键不因该修复被删除。
- **明确编辑丢失**：同一页先修改 Fast/Goals，再点击另一个即时保存开关时，原生编辑意图原先没有随保存传递。现在即时保存携带未提交的能力编辑；新增 Goals 控件与 Fast 一样读取实际磁盘/CLI 默认并校验支持性。

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
- 本轮完整回归首先复现上述四个配置缺陷，修复后核心单元 `370 passed / 0 failed / 1 ignored`、一致性 `9/9`；定向 relay 测试发现一项仍要求删除停用项的旧断言，已改为检查显式关闭和其他条目保留，最终全量结果另行追加。
- 管理器新增 Goals、跨即时保存意图、失败回滚与不支持状态的 Chromium 测试通过；前端 `135/135`、TypeScript、Vite、中英俄字典检查通过（后续诊断翻译改动仍需最终复验）。
- **v1.0.28 最终本地门禁（2026-09-27）**：完整 Rust workspace 明确退出 `0`，42 套件合计 `1181 passed / 0 failed / 1 ignored`；唯一忽略仍是既有 app-server 子进程测试入口，没有新增忽略。随后串行的 `cargo check --workspace --all-targets --locked -j 2` 退出 `0`。前端 `135/135`、TypeScript、Vite、格式、品牌、差异检查全部通过；最终英俄普通键各 `915/915`、模板各 `80/80`、俄语后端消息 `106/106`、英俄后端正则各 `80/80`，覆盖前述后续诊断翻译改动。该结果取代上面阶段性的“待复验”，不是桌面现场或三平台发行验收。
- 额外隔离当前 CLI 实测：`mcp list --json` 返回 `enabled=false` 的测试 MCP，且未执行工具。旧 Skills TOML 和 `skills.config` 都能通过解析；**解析成功不是技能生效证明**，旧 Skills 存储模型迁移仍在完整上游同步待办中，不把它列为已修复能力。
- **尚未完成**：真实失效代理的写入/恢复实操、当前用户 Codex 的完整直接启动与 AX 启动对照、白屏首次错误的现场复现、实际模型请求、每个 UI 适配器的逐项端到端验收、macOS 现场、完整上游同步。v1.0.28 正式发行须另经最终标签的 GitHub Actions 构建、发布和资产核验；本地通过不代表发行已完成，不能把 mock/AST/CI 当作这些现场结果。
- 不重启当前 Codex，不修改真实 auth/config，不删除会话；旧版本程序和已发布标签保持不变。
- 配置失败恢复使用所用 home 下 `alunixa-x-config-transactions/<id>/manifest.json` 与对应 `.bak`；恢复前核对当前修订，不能整目录覆盖新认证。代理恢复仅通过同包上下文操作并核对身份及修订。
- 源码回退以本分支检查点/定向 revert 为单位，不使用 `reset --hard`，不将本机 `XJ.md`、`YHYQ.md` 加入 Git。

## 上游同步范围

已抓取并固定 `upstream/v1.2.48` 至 `upstream/v1.3.0`；目标产品提交 `be6a45852f9992a688f33be933f444ee098fc67a`。
本地包/路径已改名，普通 merge-base 回到 Python 时代，不能直接整树覆盖；需按映射后的三方差异迁移，广告排除，保留本地协议保真、壁纸、俄语及上下文修复。
未完成逐项验证前不得宣称“全部同步完成”。

已定向迁移路径发现/CDP、TOML 语义合并、受管模型目录切换、协议代理启动校验、基础控件和 asInvoker；不使用机械整树覆盖来丢弃本地协议保真、媒体与俄语。原始映射共有 164 路径，其中 52 个三方冲突、7 个排除项；该映射是审查清单，**不是 164 路径已经迁入的证明**。
## 2026-09-29 Codex 26.924 补充证据

- 上游 issue 2323/2332 给出了真实 DOM A/B：DreamSkin 的裸 `[data-app-shell-main-content-top-fade]` 分支命中整条内容容器，`display:none !important` 使对话流和 composer 同时变成 `0×0`；仓库 Windows/macOS 两份 CSS 确实包含该规则，已移除裸属性分支并锁定新哈希喵~
- 上游 issue 2322 确认 Codex 26.924 调整 renderer 分块后，旧 `setting-storage-`/`vscode-api-`/`app-initial-` 发现可能失效；但 issue 维护者同时明确 dispatcher 补丁失败不是无限转圈根因的已证实因果。Alunixa X 已优先查找当前 `app-shared-`，并新增仅针对已加载应用分块的有界 fallback 喵~
- issue 2322 中“卸载并清空状态后恢复”只证明持久化状态相关，尚不能确定具体写入者或字段；本修复不全量清空状态，继续按用户要求在每次 AX 启动前事务性重写所选 config/auth，并在应用包上下文覆盖代理开关喵~
- 本轮未把直接启动 Codex 自身的首次 app-server 卡住声明为已确认修复；AX 的既有策略仍是一次原生 restart、有限等待、失败后保留窗口和 Try again，而不是结束 ChatGPT.exe 喵~
