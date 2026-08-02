## 1.2.60 - 2026-08-02

- “Codex增强”新增默认关闭的“AI 共享终端”开关：启用后，模型通过官方 `PreToolUse` Hook 发起的终端命令不再进入不可见的独立 shell，而是进入 Codex 右上角终端按钮所管理的同一个官方 ConPTY session。
- 终端面板未打开时继续使用官方 `runHeadlessAction` 在后台执行，页面布局、焦点和普通任务界面保持不变；用户随时打开右上角终端即可查看当前命令和实时输出，并通过官方 `write` 通道输入密码、`yes/no`、回车或 `Ctrl+C`。
- 新增实例级共享终端 broker 与阻塞代理协议，覆盖提交、租约领取、启动确认、心跳、完成回执和断线恢复；命令的 stdout、错误信息与真实退出码会原样返回给模型，诊断日志不记录命令正文、密码或终端输出。
- 页面按 `create`、`attach`、`write`、`runHeadlessAction`、snapshot 与 conversation-session 方法集合结构化发现官方终端管理器，不依赖 Codex 新版或旧版的资源哈希、独立分包、`Aht` 等压缩导出名。
- 输出捕获透明观察官方 `handleHostEvent` 的完整 `data` / `init-log` 流，避免 16 KB snapshot 环形缓冲截断；同时保留 snapshot 订阅用于活动检测、页面重注入和 bridge 重连后的同 session 接管，不抢占官方 xterm UI 的唯一 `register` listener。
- 同一页面一次只领取并运行一条 AI 共享终端命令，并在异步模块加载前同步占用执行槽，保证用户打开右上角终端时看到的就是当前等待人工介入的命令，不会被后续并发命令切换 active session。
- 命令结束后保留对应 AI 终端两分钟，用户输入或后续终端输出都会刷新空闲时间；到期只关闭该 thread 下对应的 AI session，不影响用户创建的其他终端，避免长期运行后终端标签堆积。
- 共享终端 runtime 升级到 v2，并加入显式销毁旧轮询、心跳、计时器和订阅的生命周期；升级时不关闭正在运行的官方 ConPTY，broker 租约到期后可由新 runtime 按原 session ID 恢复。
- 新增 broker、真实 helper HTTP 阻塞回归、Hook 路由、代理参数、官方终端结构发现、ANSI 清理、snapshot 增量、PowerShell 编码包装、串行领取、runtime 升级与两分钟保留合约测试。

## 1.2.59 - 2026-08-02

- 修复 Codex `26.727.6591.0` 中持续出现“无项目会话准备失败”的问题：新版已删除 `projectless-thread-*` 独立资源并将上下文工厂合并到 `app-initial-*`，注入器现在同时兼容旧分包和新版单体模块。
- 无项目上下文工厂改为依据 `projectless-thread-cwd`、`projectlessOutputDirectory` 和 `workspaceRoots` 运行时契约发现，不再依赖构建哈希或压缩导出名；预热和正式 `thread/start` 都能生成有效 cwd、输出目录和 workspace root。
- 修复项目移动完成后侧栏会话列表可能不刷新的问题：移除对旧 `app-server-manager-signals-C1h8B-R-.js` 与压缩导出 `rn` 的硬编码，改由结构化发现的 dispatcher 发送 `refresh-recent-conversations-for-host`。
- 插件市场客户端补丁对新版已移除的 `app-server-manager-signals-*` 采用可选加载和兼容降级，避免资源拆包变化反复产生异常；现有 bridge 请求/响应扩展继续生效。
- 全面审计新版 Codex 的 `4675` 个 `app-initial-*` 运行时导出，确认设置读写、Host RPC、dispatcher 与无项目上下文工厂均已迁入单体模块；对闭包内不可可靠替换的 app-server 请求函数不做伪补丁，模型解锁继续由 dispatcher、Statsig、React 状态和响应 JSON 多层链路保障。
- 新增旧分包/新版单体无项目工厂、项目移动刷新去哈希和可选资源加载回归保护；在真实 Codex 页面验证上下文生成、注入重复执行、dispatcher、思考等级同步和模型兼容状态。

## 1.2.58 - 2026-08-01

- Codex增强新增“禁用 WSS”选项；启用后自动生成 `openai_http` provider，使用 `wire_api = "responses"` 与 `supports_websockets = false`，强制 HTTP-only 请求并保留现有供应商配置。
- 启动器仅在配置文件存在时应用策略，避免首次启动或未配置供应商时失败；新增设置、配置写入、前端和启动器回归测试。
# 更新日志

## 1.2.57 - 2026-07-31

- 修复 Codex 右上角即使后端正常仍持续显示红色“未连接”的问题：页面恢复每 3 秒轮询 CDP bridge，不再从受 CSP/CORS 限制的页面直接访问本地 helper 或建立 WebSocket。
- CDP bridge 会在 Rust 进程内探测自身启动的 helper，并校验状态、版本、transport 与 launcher PID；旧 helper、端口残留或进程归属不一致不会错误显示绿色。
- ChatGPT“退出登录”按钮现在位于待登录条件之外并始终显示；存在陈旧浏览器或设备码登录任务时，会先取消任务再退出并清理本地登录态。
- 新增真实 helper 生命周期、3 秒轮询/CSP 边界和退出按钮永久可见回归测试；完整 Rust workspace、前端测试、TypeScript、Vite 生产构建及真实 Codex 页面验证均通过。

## 1.2.56 - 2026-07-31

- 修复新版 Codex `app-initial-*` 单体模块下模型元数据、设置、Host RPC 与 dispatcher 识别失效的问题，原生 Effort 控件继续显示 Light、Medium、High、Extra High、Max、Ultra，并确保 Max/Ultra 真实请求不被降级。
- 新任务统一使用 Codex 官方 `paginated` 历史模式，子代理不再复制父任务完整 rollout 前缀；续聊保持原有历史模式，避免破坏既有任务恢复。
- 新增安全、可逆的 rollout 图片空间清理：仅外置已被更新压缩检查点覆盖的旧 Base64 图片，使用 SHA-256 唯一 blob、原子替换、备份和逐字节恢复；最新恢复上下文和含回滚记录的会话保持不变。
- 修复右上角后端状态红绿误判：bridge 与 helper 必须同时在线且版本、进程 ID、transport 一致才显示绿色，旧 helper、错进程占端口或单链路残留都会显示明确错误。
- 修复 `OpenAI.CodexBeta` 的 `ChatGPT (Beta).exe` 进程识别，并让重启持续重新枚举和终止整棵进程树；未完全退出或 helper 端口仍占用时取消新实例启动并返回剩余 PID。
- 修复供应商详情保存失败仍关闭页面、活动供应商分步写入造成部分成功的问题；保存现在返回明确结果，活动供应商使用带备份回滚的原子切换事务，失败时保留草稿。
- 退出登录按钮现在始终显示；即使 app-server 未识别账号或 `auth.json` 只有 `auth_mode: chatgpt`，仍可清理本地登录态并保留纯 API Key 配置。
- 思考等级页面保存后显示专用成功或失败提示，不再只能看到不明确的通用设置反馈。
- 上游 HTTP 请求按 User-Agent 复用有界连接池；Responses、Chat Completions 与自定义模型仅对连接建立错误执行一次短延迟重试，降低大请求间歇性 502，同时避免对超时或已响应请求盲目重放。
- 代理诊断覆盖 Responses、Chat Completions、自定义模型、Models 与 Audio，请求失败日志只记录脱敏 scheme/host/port、错误分类与底层首因，不写入 API Key、URL 路径、查询参数或凭据。

## 1.2.55 - 2026-07-28

- 新增独立“思考等级”页面，汇总全部普通与自定义供应商模型；每个模型都可单独设置最高思考等级，默认 Extra High，并支持 Light、Medium、High、Extra High、Max、Ultra 六档。
- 逐模型上限会注入 Codex 原生模型元数据，Claude 等非 GPT 模型同样生效；继续使用 Codex 原生 Effort 滑块、选项和动效，实际请求可保留到 Ultra。
- 普通供应商与自定义供应商模型列表新增方形长按拖拽手柄，排序结果持久化；Codex 启动时优先恢复上次真实使用且仍有效的模型，否则使用当前供应商排序第一项。
- 恢复 ChatGPT 账号退出登录入口；退出时清理 ChatGPT 登录态，官方混合供应商保留现有 API Key 并切回纯 API 模式。
- 增强启动注入状态：启动早期即写入 `starting`，已有实例重连也会持久化运行状态，管理器检测到 Codex 进程时提供等待注入概览兜底，并兼容 `OpenAI.ChatGPT-Desktop` Windows 包。
- Codex增强新增 Instructions 提示词开关与编辑器，启用后维护 `~/.codex/TSC_ZYL_PJ/do_special.md` 和 `model_instructions_file`；供应商切换、导入、重置与其他配置写入都会保留该设置。
- 同步上游 `v1.2.37` 至 `v1.2.42` 中与当前功能相关的修复：`CODEX_SQLITE_HOME` 统一控制 session、thread reference 和 logs 数据库，并在覆盖目录无效时回退常规 Codex Home。
- 修复同一会话存在于多个数据库时撤销只能恢复一处的问题；组合恢复会先完成数据库白名单、冲突和事务预演检查，拒绝非候选数据库与非法备份文件路径。
- 修复长确认弹窗正文遮挡底部按钮的问题，正文现在独立滚动且操作栏保持可见；保持默认紫色主题，不同步无关的伴侣皮肤与上传资源。

## 1.2.54 - 2026-07-21

- 为支持的 GPT-5.6 模型补全 Codex 原生 Effort 档位：Sol 与 Terra 现在显示 Light、Medium、High、Extra High、Max 和 Ultra，Luna 按模型元数据显示到 Max。
- 继续使用 Codex 原生 Effort 滑块、选项和切换动效，不注入重复控件；修复元数据未命中时界面只能到 Extra High 的问题。
- 增强模型名识别，支持供应商路径前缀、大小写差异、上下文窗口后缀以及日期/版本后缀，同时避免相似模型名误匹配。
- OpenAI 兼容 Responses 请求会原样保留 `reasoning.effort = "ultra"`，转换到 Chat Completions 时发送 `reasoning_effort = "ultra"`。
- 对最高档命名不同的协议增加明确兼容：DeepSeek Ultra 映射到 `max`，OpenRouter Ultra 映射到 `xhigh`，避免请求静默丢失推理档位。
- 修复 Windows GitHub Actions 中诊断日志测试的并行竞态，继续保证 `/backend/status` 轮询不会产生 `bridge.request` 日志。

## 1.2.53 - 2026-07-20

- “添加供应商（可自定义）”新增供应商级 Codex 目标开关，与普通供应商一致地维护 `[features] goals = true`。
- Codex增强页新增 AI 调用终端选择，Windows 可在 Windows PowerShell 与 PowerShell 7 `pwsh` 之间切换；AI 命令通过官方 `PreToolUse` Hook 和 `-EncodedCommand` 安全包装，所选终端不可用时自动回退。
- 新增本地 Codex 记忆检索：默认使用支持中英文的 BM25 关键词匹配，在每次用户提示前只附加最相关且受长度限制的记忆片段。
- 新增“记忆嵌入模型”开关及 `Base URL`、`Key`、`Model` 配置；开启后调用 OpenAI 兼容 `/embeddings` 接口并缓存文档向量，配置缺失、超时或响应异常时自动回退 BM25，不阻断正常对话。
- 记忆读取会跳过隐藏目录、符号链接、超限和非 UTF-8 文件，并限制扫描深度、文件大小、总读取量、片段数、向量维度和附加上下文长度。
- Codex++ 只合并和更新自己生成的 Hook，保留用户已有 Hook；通过 app-server `hooks/list` 与 `config/batchWrite` 精确信任当前哈希，不使用全局信任绕过。
- 设置保存、完整配置导入、设置重置和启动器启动都会自动修复 Hook 路径与信任状态；供应商切换重写 `config.toml` 时会保留 `[hooks.state]`。
- 纯文本模型新增每模型图片处理模式，可选择原样发送、剥离图片或调用独立 VLM 分析；VLM 路径包含缓存、并发限制、上下文预算和失败保护。
- 补全 GPT-5.6 系列模型元数据、上下文目录和推理档位，并增强 Fast 服务档位在新版 Codex 模块中的兼容。
- 本地协议代理新增 `/audio/transcriptions`，支持 multipart、Content-Length 和 chunked 请求体原样转发。
- 修复选择 Codex++ 自身安装目录时被误识别为官方 Codex Desktop 路径的问题。
- 供应商同步和切换会备份并恢复白名单内的 Codex App 安全状态，同时为没有项目的主窗口补充启动兜底。
- 中英文 README、项目主页、问题反馈、自动更新 API、最新版本下载页和软件内全部仓库入口迁移到 `Alunixa-Code/CodexPlusPlusPlus`，并增加 CI 回归保护。
- 同步补充音频请求读取、状态同步、路径识别和模型兼容测试，并统一 Rust 格式。

## 1.2.51 - 2026-07-19

- 手机远控页新增 OpenAI 官方设备码登录，可在手机或其他设备打开官方验证页并输入一次性代码，不依赖本机浏览器 OAuth 回调。
- 设备码登录复用现有登录备份、取消、失败回滚和纯 API 到官方混合模式迁移，完成后仍由 Codex app-server 保存与刷新 ChatGPT 登录态。
- 管理器同时保留浏览器登录入口；设备码入口不会自动打开本机浏览器，支持复制一次性代码、可选打开验证页和取消授权。
- 设备验证地址只接受 `auth.openai.com` 或 `chatgpt.com` 的 HTTPS 地址，并校验 app-server 返回类型，拒绝非官方验证页面。
- 不支持粘贴、保存或转换 ChatGPT 网页 Cookie、Session Token 或 Cloudflare 凭据；一次性代码和验证网址不会写入诊断日志或持久化设置。
- 优化手机远控页窄屏标题与设备码区域布局，避免账号连接说明、按钮和面板标题在小窗口中挤压或裁切。

## 1.2.50 - 2026-07-19

- 新增独立“手机远控”页面，可查看 ChatGPT 账号、套餐、官方 Remote Control 状态、主机标识、配对码和已连接设备。
- 新增 ChatGPT 官网登录流程：先在 `chatgpt.com` 完成普通登录，再通过 ChatGPT 品牌的 OpenAI 官方 OAuth 和本机环回回调把账号安全连接到 Codex++。
- 电脑端使用纯 API 供应商时，登录成功后会自动迁移为官方混合模式；ChatGPT 登录态保留在 `auth.json`，自定义 API Key 保留在 provider 的 `experimental_bearer_token`。
- 登录发起前会备份 `config.toml`、`auth.json` 和供应商设置，登录失败、取消或迁移异常时自动回滚，避免覆盖现有 API 配置。
- 新增官方手机远控启用、关闭、短时手动配对码、配对状态轮询、设备列表和设备撤销能力。
- app-server 使用长期存活的 stdio JSON-RPC 会话，并优先定位 Codex 桌面应用释放到本机的可执行 CLI，兼容 Windows 与 macOS 安装布局。
- 不读取浏览器 Cookie，不支持粘贴或转换 ChatGPT 网页 Session Token；app-server 错误中的 URL 查询参数、token 关键词和超长凭据片段会在显示或记录前脱敏。

## 1.2.49 - 2026-07-19

- Codex增强页新增“关闭 Codex 自动更新”开关，只控制官方 Codex 桌面应用，不影响 Codex++ 自身的 GitHub Release 更新。
- 开启后使用官方 `CODEX_SPARKLE_ENABLED=false` 启动门禁，在 Codex 主进程初始化更新器前同时阻止 macOS Sparkle 与 Windows Store/MSIX 更新器，从而关闭自动下载和安装更新。
- Windows 打包版会同步当前用户环境并广播变更，Windows 便携版和直接启动进程会显式注入变量，macOS 会同步当前图形会话环境；重启 Codex 后完整生效。
- 设置保存、页面桥接更新、完整配置导入、设置重置和每次 Codex 启动都会重新应用策略，旧配置默认继续允许 Codex 更新。

## 1.2.48 - 2026-07-17

- 修复 macOS 新版 Codex++ 通过 Chat Completions 中转时，协议代理会静默丢弃新版具名工具、`input_schema` 和命名空间子工具的问题。
- 终端、文件读写等工具现在会完整转换并映射回 Responses 协议，避免模型错误地认为当前任务没有终端或文件读写能力。
- 代理诊断日志新增脱敏工具形态摘要，方便定位后续 Codex 客户端工具声明升级带来的兼容问题。

## 1.2.47 - 2026-07-17

- 修复通过便携版 Codex 入口启动后，自定义多模型供应商没有出现在 Codex 模型列表中的问题。
- 修复 macOS 供应商配置切换按钮不可点击的问题，并让激活配置的操作按钮在触控板与窄窗口下保持可用。
- 修复 Windows 重复点击当前“使用中”配置时，live 文件回填会把自定义模型和供应商配置清空为默认值的问题。
- 自定义多模型与聚合供应商不再从本地代理门面配置反向覆盖结构化配置，重复应用当前供应商只重写 live 文件。
- 项目主页、应用更新检查和发布下载地址完成阶段性迁移；当前统一地址见 `1.2.53`。

## 1.2.46 - 2026-07-15

- Codex 右上角 Codex++ 设置新增 Sub agent 数量输入框，可填写 3 到 50，并写入 `[agents].max_threads`。
- Sub agent 配置优先调用 Codex 官方配置接口实时热重载；当前版本不支持热重载时显示明确的“重启 Codex”按钮并由独立 worker 完成重启。
- 完整配置导入导出新增 `.env` 与 `model-catalogs/*.json`，继续覆盖供应商、自定义模型、上下文窗口、协议、增强设置、认证和用户脚本。
- 同步上游 v1.2.37 的幽灵任务索引清理加固、会话分页、长页面滚动恢复和新版 Codex locale 设置接口。
- 修复上游会话分页测试的旧调用与并行环境变量污染，恢复完整 workspace 稳定测试。
- 中英文 README 移除商业赞助商区块，统一使用项目维护者的支付宝与微信赞赏码，并增加合并冲突保护和 CI 品牌校验，防止以后同步上游时被静默覆盖。

## 1.2.41 - 2026-07-14

- 修复启动自定义模型供应商时反复覆盖 `auth.json`、导致 Codex 每次都要求登录或重新输入 API Key 的问题。
- API 与自定义模型供应商统一写入完整 `auth_mode = apikey` 认证结构，启动同步只更新发生变化的 `config.toml`。
- 同步上游管理器视觉体系与滑轨开关，同时保留现有多协议、自定义模型、配置导入导出和供应商延迟检测功能。
- 同步 Windows 便携版入口识别、重复启动窗口唤醒、macOS AppTranslocation Launch Services 启动与 V2 WebP 桌宠兼容修复。

## 1.2.40 - 2026-07-14

- 修复升级后活动自定义多模型供应商未在 Codex 启动前重新应用，导致旧的全局 250K 上下文限制持续生效的问题。
- 自定义多模型供应商保存时会永久移除顶层上下文与自动压缩覆盖，各模型继续使用独立 catalog 配置。
- 运行时模型注入现在携带各模型自己的上下文窗口与自动压缩元数据。

## 1.2.39 - 2026-07-14

- 修复自定义多模型供应商的上下文窗口被默认模型顶层配置覆盖的问题。
- 切换模型后，Codex 现在会使用该模型在目录中的独立上下文窗口和自动压缩阈值。
- 例如 `gpt-5.6-sol` 配置为 `353000` 且压缩比例为 80% 时，实际窗口为 `353000`，压缩阈值为 `282400`。

## 1.2.38 - 2026-07-14

- 修复自定义供应商配置多个模型时，Codex 模型菜单只显示 `gpt-*` 模型的问题。
- `customModels` 模式现在会把默认模型和全部自定义模型传给 Codex++ 模型白名单，支持 Claude、Gemini、Grok、DeepSeek、GLM 等模型正常显示。
- 注入层设置兜底同步识别 `customModels`，避免模型目录接口暂时不可用时再次丢失非 GPT 模型。

## 1.2.22 - 2026-06-28

- 修复启动 Codex 时会自动应用当前供应商配置的问题；现在只有手动点击“使用/切换供应商”才会切换供应商配置。
- 保留已开启的自动会话同步、插件市场配置修复、Computer Use guard 和历史模型名清理启动流程。

## 1.2.21 - 2026-06-28

- Codex 增强新增「插件列表全量展示」开关，进入插件页后自动连续展开「更多」入口。
- 自动展开支持「查看 ... 以及另外 N 个」和英文「View/Show ... and N more」按钮文案，减少插件市场分批展示时的重复点击。
- 自动展开默认开启，可在 Codex 增强页独立关闭；关闭后会停止后续自动展开任务。

## 1.2.20 - 2026-06-27

- 模型列表改为逐行控件：每行同时编辑模型名和上下文窗口，减少模型与窗口配置错位。
- 新增本地会话多选、全选、清空选择与批量删除；批量删除会逐项统计成功和失败。
- 修复供应商详情切换时模型行数据可能沿用上一供应商的问题。
- 修复从上游获取模型时未使用当前编辑中供应商配置的问题。
- 修复批量删除确认框中的会话预览换行显示。
- 修复 Windows 缺少 `sh` 时上游 worktree 远端脚本语法测试失败的问题。
- 更新聚合供应商设置 roundtrip 测试，使其匹配保存时的规范化行为。

## 1.2.18 - 2026-06-25

- 模型列表改为左右双输入框：左侧填模型名，右侧填上下文窗口（如 `1M`、`200K` 或 `1000000`），右侧留空则使用 Codex 默认长度。
- 存储层新增 `model_windows` JSON map，与 `model_list` 彻底分离；Codex 客户端只使用无后缀模型名，避免模型选择器出现带后缀的历史项。
- 旧版 `deepseek-v4-flash[1M]` 格式在 settings 加载/保存时自动迁移到新格式。
- 启动时自动清理历史 session 数据库与 Local Storage 中残留的带后缀模型名。
- 修复 model 为空时从 `model_list` 首条无后缀 slug 回退写入 `config.toml` 的问题。
- 修复本 profile 生成的 `model_catalog_json` 在配置未变更时不会重新生成的问题。

## 1.2.4 - 2026-06-08

- 新增 Zed 远程项目记录能力，支持维护 Codex++ 可识别的远程项目最近列表，并为远程工作区打开提供更稳定的回退策略。
- 修复供应商同步在存在多条 `session_meta` 记录时只处理部分会话元数据的问题。
- 修复 Windows 单实例启动保护，在默认端口被异常占用时改用更稳健的锁与端口回退逻辑，降低无法启动的概率。
- 限制 Codex 快速服务档位只对支持的模型生效，避免不兼容模型收到无效配置。
- 修复 macOS DMG 打包和 bundle 结构，恢复 launcher / manager 二进制重命名逻辑。
- 补充混合登录中继模式文档说明。
- 版本号更新到 `1.2.4`，同步 Rust workspace、Tauri、前端 package 和后端展示版本。

## 1.1.8 - 2026-05-26

- 新增上游分支 worktree 支持，可从上游仓库/分支创建和选择独立工作区。
- 新增上游分支列表获取、默认值处理、远端解析和 worktree 创建相关接口与测试。
- 优化供应商同步逻辑，保留 rollout 文件 mtime，减少同步后不必要的会话状态变化。
- 新增独立的「工具与插件」页面，用于统一管理 Codex++ / Codex 的 MCP、skills、plugins，不再绑定到单个供应商。
- 切换供应商时会合并当前启用的工具与插件配置，同时避免把供应商专属配置误写入通用配置。
- 工具与插件列表改为从当前 Codex 配置实时读取启用状态，支持直接开关和删除条目。
- 调整通用配置提取逻辑，改为手动提取，减少自动覆盖和配置污染。
- 修复供应商切换隔离问题，避免 `model_catalog_json`、旧 `model_provider`、历史 provider 表和旧 `auth.json` 被带到新供应商。
- 修复纯 API 模式下 `auth.json` 没有写入 API Key 的问题，并固定供应商 provider 名称为 `CodexPlusPlus`。
- 优化模型目录写入方式，支持与原始模型目录合并，并在预览中显示真实路径。
- 供应商配置页新增模型插入方式、模型列表、上下文大小、压缩上下文大小、目标功能等配置项。
- 官方模式下隐藏仅混入 API Key 场景使用的模型列表和模型插入方式。
- 将 Base URL、API Key、上游协议移动到模型列表之前，测试模型和上下文选项收进「更多选项」。
- 修复 `model_reasoning_effort`、`plan_mode_reasoning_effort` 重复写入导致 TOML 解析失败的问题。
- 修复重复插件表、空配置体、布尔值解析等导致配置文件解析失败的问题。
- 优化供应商详情页布局，保持顶部返回和提示区域固定，增大默认窗口尺寸并减少顶部缝隙。
- 移除脚本安装时的 checksum 阻断，避免市场脚本校验不一致导致安装失败。
- 清理关于页和状态页中不需要展示的登录、当前供应商、配置文件路径等信息。
- 调整提示信息居中显示，避免遮挡重启按钮。
- 更新讨论群二维码、README 说明和 macOS DMG 打包脚本。
