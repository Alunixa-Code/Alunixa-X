## 1.0.8 - 2026-08-25

- 修复个人微信已经扫码登录、但收到首条消息后无法启动 Codex app-server 的问题；典型错误会先显示裸命令 `codex`，自动发现后又显示 Windows Store 受管目录中的 `...\WindowsApps\OpenAI.Codex_*\app\resources\codex.exe` 喵~
- 根因是微信连接只尝试设置中保存的单一 CLI 路径或裸 `codex`；自动发现又只返回 WindowsApps 包内文件，一旦该受管路径因进程令牌、Codex 更新后目录变化或 CreateProcess 访问限制失败，就没有任何可用回退喵~
- Windows 现在优先发现 Codex Desktop 写入 `%LOCALAPPDATA%\OpenAI\Codex\bin\<content-id>\codex.exe` 的同版本用户态 CLI 缓存；该目录保留 `codex-code-mode-host.exe` 等配套 sidecar，避免把单个二进制盲目复制到不完整目录喵~
- 用户显式选择的普通自定义 CLI 仍保持最高优先级；只有配置指向 WindowsApps 时才把用户态缓存前置，随后仍保留已配置包内路径、自动发现桌面包、PATH 与裸命令回退，不改变 macOS 或自定义 CLI 的既有选择语义喵~
- app-server 启动会去重并逐个尝试候选；创建进程、stdin/stdout 管道或 initialize 任一阶段失败都会清理该子进程并尝试下一候选，不再让一次 WindowsApps 启动失败直接终止整条微信连接喵~
- “查找桌面版 Codex CLI”现在同样优先填写用户态缓存，再回退包内 CLI 与 PATH；已保存旧 WindowsApps 路径的用户无需先手工清空设置，运行时也会自动采用缓存候选喵~
- 错误状态现在包含每个候选的来源、失败阶段、底层 Windows `os error` 编号和有界错误文本；诊断日志新增脱敏的 `connect.weixin_app_server_spawned` 与 `connect.weixin_app_server_candidate_failed` 事件，不记录微信 Token、联系人、消息正文、提示词或终端输出喵~
- 新增 WindowsApps 识别、缓存时间排序、自定义 CLI 优先级、候选去重和真实子进程回退回归；隔离 fake JSON-RPC CLI 精确验证首个可执行文件不存在时会自动切换第二候选并完成 initialize，全程不执行当前 Codex、Helper、CDP 或真实微信消息喵~

## 1.0.7 - 2026-08-25

- 修复新版 Codex Desktop 不再允许自定义 Provider 在 `requires_openai_auth = false` 时继承 `auth.json` 鉴权的问题喵~
- Alunixa X 启动前会读取已检测到的 Codex Desktop 版本；从 `26.814.0` 起，如果当前活动 Provider 是自定义 Provider 且配置明确写入 `requires_openai_auth = false`，会原子改为 `true` 后再启动 Codex喵~
- 官方 `openai`、`ollama`、`lmstudio` 等保留 Provider 不会被改写；旧版 Codex、未知版本、缺少版本信息和没有活动自定义 Provider 时也保持原配置喵~
- 只修改当前活动 Provider 的 `requires_openai_auth`，保留 Base URL、API Key、模型、上下文窗口、MCP、Skills、Plugins 和其他配置喵~
- 新增版本门槛、活动自定义 Provider、旧版 Codex、未知版本和官方 Provider 隔离回归，避免对旧版或官方登录流程产生副作用喵~
- 该兼容修复对应手动修复方式：新版 Codex 的 `~/.codex/config.toml` 或 `%USERPROFILE%\\.codex\\config.toml` 中，将活动自定义 Provider 的 `requires_openai_auth = false` 改为 `true`喵~

## 1.0.6 - 2026-08-22

- 修复 `v1.0.5` 只协商 HTTP 200 SSE 内 `invalid_id_prefix`、但第三方上游改为以 HTTP 非成功 JSON `invalid_request_error` 返回同一 ID 兼容信息时直接把错误回传给 Codex的问题喵~
- 非成功 Responses HTTP body 现在同样读取严格的 `Invalid 'input[n].id'` 加 `Expected an ID that begins with` 协商结构，不再依赖错误文本必须包含 literal `invalid_id_prefix`喵~
- 覆盖本次真实 `custom_tool_call.id=fc_04066...` 被上游要求 `ctc_` 的情况：仅把被点名 call 改为 `ctc_04066...`，保留同 `call_id` 的 `ctco_` output、其他 `fc_` item、类型、output 和顺序喵~
- HTTP 直接错误协商与原有 HTTP 200 SSE 协商共用同一前缀白名单、完整 ID 存在性检查、精确单项改写和最多一次重试边界；新增 HTTP JSON `fc_ -> ctc_` 回归并保留 SSE `ctco_ -> fc_` 回归喵~

## 1.0.5 - 2026-08-22

- 修复 `v1.0.4` 仍可能在 `Reconnecting 5/5` 后返回同一 `invalid_id_prefix` 的问题：真实供应商会先发送 `response.created` 与 `response.in_progress`，随后才进行 typed input 校验；旧判定在 created 后过早透传，导致晚到的 `response.failed` 无法再协商喵~
- Responses 协商现在把 `response.created`、`response.queued`、`response.in_progress` 视为生命周期前导事件，继续缓冲到实际输出事件、成功终态、失败终态或 64 KiB 上限；真实 HTTP chunked 回归覆盖 `vendor metadata → created → in_progress → failed`喵~
- 上游点名一个完整 ID 时只修正该 ID，不再把请求内所有同来源 `ctco_` 一起改成 `fc_`；同一请求中其他合法 custom-tool 输出、`call_id`、output、类型、消息和顺序保持不变喵~
- 单次协商重试后的前导流会再次检查 `invalid_id_prefix`；若上游仍拒绝，记录明确的 `retry_still_invalid_id_prefix`，不再把失败重试误记为成功喵~
- 修复 Image Gen 已返回有效 PNG Base64 result、但 item status 仍为 `generating` 时页面只显示工具卡片而不展示图片的问题；Responses SSE 兼容过滤器会把已带 result 的 malformed image generation item/event 修正为 `completed`喵~
- Image Gen 状态修正兼容 LF、CRLF、任意网络分块和最高 64 MiB 单事件；同时统一顶层 image generation event header、JSON type/status，并保留 Base64 result 原值，普通 Responses SSE、无 result 的生成中事件和 `[DONE]` 不变喵~
- 启动时迁移删除已知旧产品 MCP server `codex-plus-imagegen`，避免它与 `alunixa-x-imagegen` 同时注册、生成重复工具和残留 companion 进程；所有用户自建 MCP server 继续保留喵~
- 新增晚到 SSE 失败 `5/5`、Image Gen SSE `3/3`、精确 ID 修复和 legacy MCP 迁移回归，并继续使用隔离 SSE/JSON、临时 HTTP server 与临时 config 验证，不操作当前 Codex/Helper/CDP喵~

## 1.0.4 - 2026-08-22

- 修复 `v1.0.3` 的 SSE 前导事件盲区：真实 9527 错误在 `codex.rate_limits` 和 `codex.response.metadata` 两个厂商事件之后，第三个 `response.failed` 事件才包含 `invalid_id_prefix`，旧版只读取首个事件会过早透传而错过协商喵~
- 开启“Responses ID 自动协商”后，Alunixa X 现在会继续缓冲允许的厂商前导事件，直到看到完整 `response.*` 生命周期事件、完整失败事件、明确前缀错误或达到 64 KiB 上限再决定；关闭开关时仍完全原样透传喵~
- 正常流在首个 `response.created`、`response.in_progress` 或其他标准 Responses 事件完成后立即释放已缓冲内容，不等待整次生成结束，保持正常流式体验喵~
- 失败流会把厂商元数据和完整 `response.failed` 一起保留给协商解析，因此能读取真实错误要求的 `ctco_ -> fc_`，只改 ID 并自动重试一次喵~
- SSE 判定兼容 LF、CRLF 和网络分块，不完整事件块不会被提前当作可决定结果；64 KiB 硬上限防止异常供应商无限堆积前导数据喵~
- 使用用户真实历史形态复现：`custom_tool_call.id=fc_...`、`custom_tool_call_output.id=ctco_...` 时，9527 依次返回 `codex.rate_limits`、`codex.response.metadata`、`response.failed`，第三事件明确要求输出 ID 以 `fc` 开头喵~
- 新增 chunked HTTP 隔离服务器与三项纯判定回归，launcher 协商专项 `4/4` 通过；继续保留 `v1.0.3` 的默认关闭开关、零错误零改写、expected-prefix 白名单和单次重试边界喵~
## 1.0.3 - 2026-08-22

- 修复 `v1.0.2` 后仍可能出现的 `stream disconnected before completion`：当前 Codex 合法产生 `custom_tool_call_output + ctco_`，但部分第三方 Responses 实现会在 HTTP 200 SSE 流内错误要求 `fc_`，导致工具输出回传后的下一轮请求中断喵~
- Agent 能力页新增默认关闭的“Responses ID 自动协商”开关；关闭时 Responses 请求与 SSE 完全原样透传，不缓冲、不改写、不重试，避免影响原生支持 custom tools 的供应商喵~
- 开启协商后仍先发送完全原始请求；只有上游在 HTTP 200 SSE 内明确返回 `invalid_id_prefix`、被拒绝的完整 ID 和 expected prefix 时，Alunixa X 才读取上游给出的兼容答案，只改写同一 ID 家族并自动重试一次喵~
- 自适应协商仅允许 `fc_`、`ctc_`、`ctco_` 三种已知工具 ID 家族，且必须确认上游点名的完整 ID 确实存在于当前 `input`；无关错误、正常成功流和没有 expected prefix 的响应不会触发请求改写喵~
- 针对 `ctco_ -> fc_` 的真实上游要求，会保留 item 类型、UUID 后缀、`call_id`、output、消息、数组顺序和其他 ID 家族，仅替换 ID 前缀；重试最多一次，避免重复创建请求或无限循环喵~
- 删除 `v1.0.2` 的发送前主动前缀规范化，因此未报错请求不再被提前修改；开关保存后即时用于后续请求，无需重启正在运行的 Codex喵~
- 真实 9527 `gpt-5.6-sol` 最小请求验证确认：`custom_tool_call_output + ctco_` 返回 `response.failed`，保持类型不变、仅改 ID 为 `fc_` 后返回 `response.completed`；把错误文字作为用户消息反馈无法绕过模型前参数校验喵~
- 新增脱敏诊断事件，区分首次流内前缀错误、自适应重试成功、重试失败与异常响应；不记录请求正文、工具输出或凭据喵~
- 新增本次真实错误 ID `ctco_01a02899-0ede-7f42-b692-ba57cffb9823`、正常请求零改写、设置默认关闭与即时持久化回归；协议代理 `69/69`、设置 `42/42`、前端 `43/43`、TypeScript、i18n `851/851 + 80/80`、品牌保护和 workspace all-targets check 全部通过喵~
## 1.0.2 - 2026-08-22

- 修复工具执行后的下一轮 Responses 请求可能因 typed item ID 前缀不匹配而中断的问题，典型错误为 `Invalid input[n].id: ctco_... Expected an ID that begins with fc` 喵~
- Responses 直连发送前按 item `type` 结构化校验工具历史 ID：`function_call/function_call_output` 使用 `fc_`，`custom_tool_call` 使用 `ctc_`，`custom_tool_call_output` 使用 `ctco_` 喵~
- 仅修正来自已知工具 ID 家族且前缀与类型不一致的条目，保留原 UUID 后缀、`call_id`、工具输出、arguments、普通消息、图片和其他 typed item，避免广泛删除 ID 或改变上下文语义喵~
- 修复覆盖普通 Responses、单模型路由、自定义模型 Responses 和 `/responses/compact`；Chat Completions、Completions、Anthropic 与 Gemini 转换路径保持原行为喵~
- 新增脱敏诊断事件，只记录供应商和修正条目数量，不记录请求正文、工具输出或凭据喵~
- 新增精确 `ctco_01a0257d-d256-7d93-b048-b22fba274c2d` 回归，并完成协议代理 `68/68` 全集验证喵~
## 1.0.1 - 2026-08-21

- 修复 `1179×820` 等实际管理器窗口下首页下半区越界：系统检查与最近运行改为单列自适应，长安装路径、日志路径、启动消息、时间、Debug 与 Helper 信息会在卡片内部安全换行，不再相互覆盖或伸出窗口喵~
- Token 环形图不再用百分比作为中心数值，改为直接显示实际使用量，例如 `0.77M` Token 已用和 `162M` 缓存命中；环形弧线仍用于表达相对进度，模型使用频率百分比继续保留喵~
- Token 构成的输入、输出和缓存统一使用 M 单位，小于 1M 时显示小数，例如 `0.52M`，避免同一区域混用 M、K 和百分比喵~
- 提高首页全局基础字号、导航、标题、状态说明、长路径、图例、环形图标签和 Token 构成字号，并扩大环形图与统计卡片，改善高分屏和紧凑窗口可读性喵~
- 修复系统检查状态徽章被挤成竖排的问题，`已找到`、`已安装` 等状态保持横向显示喵~
- 新增精确 `1179×820` Playwright 回归，覆盖全部首页板块边界、长文本内部溢出、根字号、M 数值和模型频率百分比；验证 document/screen 无水平溢出、所有目标板块位于内容区内、页面异常为零喵~
## 1.0.0 - 2026-08-21

- Codex++ 独立产品分支正式更名为 **Alunixa X**，仓库、应用标题、安装包、进程、Bundle ID、协议、更新源、文档和注入界面统一迁移到 `Alunixa-Code/Alunixa-X` 喵~
- 管理器重做为 Alunixa X 深海控制面：新增 Agent Rail 运行轨道、链路就绪度、模型/工具/运行时总览、独立品牌导航和响应式桌面布局喵~
- 首页新增 Usage Intelligence 使用统计：从最近 100 个本地会话 rollout 聚合 Token 上下文占用率、缓存命中率、输入/输出/缓存构成、累计 Token、调用回合和模型使用频率，并用环形饼图与进度条展示喵~
- 使用统计只读取本地 token_count 与 turn_context 记录，不上传提示词、对话正文、文件内容、API Key 或终端输出；同一回合的增量 token_count 只保留最后一次，避免重复累计喵~
- 新增 Alunixa X `AX` 轨道图标、横向字标和社交预览图，Windows ICO、Tauri PNG、macOS DMG 图标和 launcher 资源统一使用新视觉喵~
- 主应用入口统一为 `Alunixa X`，后台接管入口为 `Alunixa X Launch`；二进制统一为 `alunixa-x`、`alunixa-x-manager` 和 `alunixa-x-imagegen-mcp` 喵~
- 新仓库继续保留 CodexPlusPlus 及其他第三方代码的 AGPL、版权和兼容性说明，不把第三方商标或上游历史改写为 Alunixa X 所有喵~
## 1.2.66 - 2026-08-20

- 新增 OpenAI 兼容全端点透明代理：除现有 Responses、Chat Completions 与模型目录特殊处理外，`/v1/**`、`/v1/v1/**`、`/codex/v1/**` 及常见无版本别名现在支持 GET、POST、PUT、PATCH、DELETE、HEAD 和 OPTIONS，不再由 helper 白名单返回“未知后端路径”喵~
- 图片生成与编辑、音频合成/转写/翻译、Files、Uploads、Batches、Embeddings、Moderations、Fine-tuning、Vector Stores、Videos、Evals、Containers、Assistants、Threads 等 HTTP API 均通过同一通用通道转发；新增或未显式枚举的官方 `/v1/**` 路径也自动兼容喵~
- 通用代理完整保留路径参数与查询字符串，并把 `/v1/v1`、`/codex/v1` 归一化为供应商真实 API 根；自定义根路径、末尾 `#` 跳过版本前缀和已填写具体 endpoint 的 Base URL 继续按原有规则工作喵~
- 请求会替换为当前活动供应商认证，保留 `Content-Type`、`Accept`、`OpenAI-Organization`、`OpenAI-Project`、`OpenAI-Beta`、`Idempotency-Key`、Range 与其他安全端到端头；原 Authorization、Cookie、Host 和 hop-by-hop 头不会泄漏给上游喵~
- 响应按真实状态码流式返回二进制、JSON、SSE 与下载内容，并保留 `Content-Disposition`、`Location`、`ETag`、`Cache-Control`、`Retry-After`、`OpenAI-*`、请求 ID、Range 与内容编码头，不再把图片、语音或文件响应强制改写为 JSON喵~
- 新增 Realtime WebSocket 透明代理：`/v1/realtime` 等升级请求会保留查询参数、`OpenAI-Beta` 与上游选择的子协议，替换供应商认证，并双向转发 Text、Binary、Ping、Pong 与 Close 帧喵~
- 通用非幂等请求和 Realtime 连接不执行自动重试或聚合故障转移，避免图片、上传、批处理、微调或视频任务被重复创建、重复计费；上游失败会返回明确的 Codex++ 代理错误喵~
- HTTP 请求读取器改为 64 MiB 内存加临时文件的混合 body：Content-Length 与 chunked 请求都增量写入，单请求最大支持 8 GiB，满足大型图片编辑、Files 与 Uploads，同时避免全部请求体常驻内存喵~
- 新增独立控制台 companion `codex-plus-imagegen-mcp` 并在启动前写入专用 `codex-plus-imagegen` server 配置；Codex 的 `$imagegen` Skill 现在可以发现真实图片工具，不再只看到 Skill 却提示没有可调用的 `image_gen` 工具，且不再受 Windows GUI launcher 标准管道不可用影响喵~
- `image_gen` 支持新图生成和本地多图编辑，提供 mask、模型、尺寸、质量、背景、输出格式、压缩、输入保真与多变体参数；请求分别进入活动供应商的 `/v1/images/generations` 和 `/v1/images/edits`喵~
- 生成结果支持 `b64_json`、Base64 image 与 HTTPS URL 三种上游形态，统一保存到 `CODEX_HOME/generated_images`，同时以 MCP image content 返回 Codex，便于页面直接预览并继续复制到项目目录喵~
- MCP 配置仅在 Codex 增强和供应商管理同时启用时安装，关闭后只删除 Codex++ 自己的 server 表；用户已有 MCP、Skills、Plugins、供应商品牌、更新源与 GitHub 发布流程均保持不变喵~
- Responses 直连继续完全保真转发 `tools: [{"type":"image_generation"}]` 以及 `response.image_generation_call.*` SSE 事件；Chat/Completions 等非托管协议继续使用本地 MCP `image_gen`，不把服务端托管生图伪装成普通函数后宣称成功喵~
- 新增全端点、URL 归一化、multipart/二进制、认证和头过滤、响应下载头、SSE、生图事件、Realtime WebSocket、大 body 落盘、MCP schema、启动入口及配置隔离回归测试喵~

## 1.2.65 - 2026-08-20

- 选择性同步 BigPizzaV3 `v1.2.42` 至 `v1.2.50` 中适用于当前分支的功能与修复，没有合并上游分支，也没有改动 `Alunixa-Code/CodexPlusPlusPlus` 品牌、更新源、仓库入口、赞助内容或发行工作流喵~
- 完整同步上游 `v1.2.50` 正式发行的会话自动命名和微信内置 CLI 发现：会话操作菜单复用 Codex 原生标题建议与保存流程，微信连接可自动定位桌面包内 Codex CLI 喵~
- 新增个人微信连接：支持官方 HTTPS 扫码登录、长轮询收发文本与语音转写、联系人白名单、消息去重和每联系人独立 Codex 会话；工作目录可直接输入或搜索，已有会话可快速选择喵~
- 微信连接默认只读沙箱，不回显连接 Token，并拒绝非微信官方域名、HTTP、端口、认证信息、查询和重定向式服务地址，避免凭据发送到任意第三方喵~
- Dream Skin 接入安全社区市场：支持搜索、排序、在线预览、安装、更新、本地主题库、ZIP 导入和 `dreamskin://` 一键换肤；Windows 与 macOS 均注册协议入口喵~
- Dream Skin 下载固定为 `https://api.dreamskin.cc` 且禁用重定向；新增压缩包大小、文件数量、解压大小、SHA-256、平台、版本、manifest、主题身份、图片内容和 Safe CSS 校验喵~
- Dream Skin 运行时适配当前 Windows/macOS 主内容区域，并支持按真实比例在 composer 旁显示 companion；主题停用或恢复默认时会清理临时节点、class 和属性喵~
- 修复新版 Codex 顶栏和资源拆包变化：Codex++ 菜单兼容当前 `ApplicationMenuTopBar`，renderer 资源发现覆盖 `app-initial-*`、`app-main-*` 与旧分包，不再依赖固定构建哈希或压缩导出名喵~
- 增强脚本只注入精确 Codex/ChatGPT 主 renderer，阻止嵌入式浏览器、Quick Chat 或标题偶然包含 Codex 的网页抢占注入目标；新增样式模板变量执行回归，防止残留样式引用中断整个脚本喵~
- CDP bridge 改为并发处理 binding 请求并使用分代接管；重注入继续携带完整 data bridge 上下文，长耗时 Stepwise、导出等请求不再阻塞后端状态，失败重装也不会提前废弃可用旧连接喵~
- 修复会话删除撤销后的侧栏刷新、临时 `client-new-thread:` ID 误操作、Provider Sync 子代理混入、陈旧修复锁、`local_thread_catalog` 缺记录及移动端 Remote Control provider 恢复问题喵~
- Provider Sync 现在扫描所有受支持的 session/reference 数据库，补齐本地目录并归一化 provider；明确标记的 subagent、memory consolidation、spawn child 与 agent job 不会出现在根会话列表或被错误修复喵~
- Remote Control 恢复记录 profile、目标 provider 与配置 generation，仅在桌面写入进程退出且配置仍匹配时更新 rollout/SQLite；损坏状态文件隔离，配置变化时延期而不误写喵~
- 修复 macOS 重启 Codex++ 误停止 Codex CLI：只终止命令行含当前 CDP 端口的 Codex/ChatGPT 桌面主进程，明确排除 Helper 与 CLI；重启链路重新建立 CDP、helper、bridge 和增强注入喵~
- 修复 Windows 已有 Codex CDP 的 launcher recovery：无法从进程枚举识别桌面进程时继续验证当前调试端口，避免误关 helper 与 bridge；Windows 保留端口冲突继续回退到可用临时端口喵~
- 新增供应商内单模型路由：按精确模型名转发到指定 Responses 供应商，可选改写目标模型；完整正向和反向引用校验阻止自引用、缺失目标、协议错误、聚合目标与本地代理循环喵~
- 单模型路由保留 `/responses/compact` 及版本前缀，首次在活动供应商启用时明确确认并通过既有重启入口应用；稳定行 key 修复输入焦点丢失，供应商详情和全页面吸顶操作栏保持紧凑可用喵~
- 修复自定义 Responses 模式下 Web Search、Lite override、Fast service tier 和 VLM 描述块作用域；Responses 使用 `input_text`，其他协议继续使用 `text`，关闭 Stepwise 时不再注入或运行其观察器喵~
- 修复 cc-switch 模型目录接管和 Codex 26.707+ app-server model patch；外部标准 Responses 目录会保留搜索能力并禁用不兼容 Lite，cc-switch 指针由当前供应商目录安全替换喵~
- 自动压缩继续使用精确 Token 阈值，并修复多模型供应商顶层摘要与当前选中模型不一致：启动、供应商应用和页面模型选择回写会原子同步 `model`、`model_context_window` 与 `model_auto_compact_token_limit` 喵~
- 自定义模型页直接显示实际启动模型、该模型上下文窗口和该模型压缩 Token 阈值；例如上下文 `1000000`、阈值 `990000` 会在 config 与模型目录原样写入 `990000`，不再受其他模型的 `298000` 配置影响喵~
- 修复 provider 字段混入 common config：`openai_base_url`、`chatgpt_base_url`、模型目录、provider 表及 API Key/Token 类根字段只保留在供应商 profile，不再进入公共配置或跨供应商泄漏喵~
- 同步供应商 URL 导入安全、用户脚本真实运行状态、插件远端搜索与本地 fallback 隔离、长确认弹窗滚动、`CODEX_SQLITE_HOME` 统一解析、多数据库删除撤销和 ChatGPT-Desktop watcher 兼容喵~
- 保留 `v1.2.64` 的启动前权威注入与失败关闭设计，不恢复与当前 Electron handler 不兼容的供应商动态热重载；保存结果会明确提示下次通过 Codex++ 启动器应用喵~
- 没有同步上游网站、赞助、品牌、更新地址、发行元数据、整分支 UI 重构及正式 `v1.2.50` 标签之后的权限行为改动，避免改变用户仓库归属或现有服务权限模型喵~

## 1.2.64 - 2026-08-05

- 撤销 `v1.2.63` 的供应商运行时动态重载事务：管理器保存设置、保存活动供应商、切换供应商和恢复官方配置时不再调用 Electron Host RPC、`batch-write-config-value`、CDP Runtime.evaluate、app-server 配置热重载或 React Query 缓存刷新，避免当前 Electron 主进程缺少 handler 时反复出现“已保存但动态注入失败”喵~
- 管理器提示统一改为“下次通过 Codex++ 启动器启动时应用”；磁盘事务仍会原子保存设置、供应商文件和回滚备份，但不会再宣称已经修改运行中的 Codex，也不会在打开的页面里链式调用旧 renderer runtime 喵~
- 启动器成为供应商应用的唯一权威入口：启动前读取 `settings.json`，Provider Sync 完成后必须重新读取最新设置，对所有启用的活动供应商执行归一化校验，并在创建 Codex 进程前完整写入 `config.toml`、`auth.json`、模型目录和首选模型；不再只为自定义多模型供应商执行启动同步喵~
- 供应商归一化失败现在会直接阻止管理器保存、cc-switch 导入和供应商切换，错误明确返回到界面；无效 Base URL、缺失 Key、无效上下文窗口、空 Token 阈值或阈值超过上下文窗口不会再只写日志后保存一份无法启动的配置喵~
- renderer 注入新增 `window.__codexPlusStartupModelInjection` 启动握手：启动时从 helper 读取后端设置与模型目录，校验活动供应商应有模型均存在，安装 dispatcher、app-server、Response JSON、消息和 Statsig/React 模型适配层，并返回实际端口、模型集合、默认模型和解锁适配状态喵~
- Rust 启动器会等待并解析启动握手，核对真实 debug/helper 端口、活动供应商完整模型集合、默认模型和模型解锁适配层；注入桥未建立、Promise 超时、脚本异常、目录缺模型、默认模型不一致或解锁适配未安装时，均写入 `failed`、关闭 helper 并终止刚启动的 Codex，绝不再进入 `running_degraded` 或显示解锁成功喵~
- 第二次点击启动器并重新激活已有 Codex 时也不再写 `running_degraded`；会等待同一启动握手验证，失败时明确返回错误且不把未验证的窗口标记为可用，同时不会终止用户原本已经运行的实例喵~
- 自动压缩设置全面改为 Token 阈值：普通供应商和自定义供应商模型都直接输入正整数 Token 数，`1000000` 上下文窗口配 `990000` 阈值时会在 `config.toml` 与模型目录中原样写入 `990000`，不再把用户输入解释为百分比或在运行时换算喵~
- 关闭自动压缩会清空设置值并主动从 `config.toml` 删除旧 `model_auto_compact_token_limit`；开启时要求上下文窗口有效、阈值大于零且不得超过窗口，自定义多模型供应商逐模型执行相同校验喵~
- 旧 `autoCompactPercent` 仅保留为反序列化兼容字段且不再序列化；升级旧设置时，只有尚无 Token 阈值的记录才按旧百分比迁移一次，例如 `200000 + 80%` 迁移为 `160000`，已有 Token 值永远优先且不会被百分比覆盖喵~
- 回归覆盖供应商管理器不再动态应用、启动前普通/自定义供应商应用、Provider Sync 后二次读取、注入和验证失败关闭、`1000000 -> 990000` config/catalog 原值、关闭删除残留键与旧百分比一次迁移喵~

## 1.2.63 - 2026-08-04

- 修复 `v1.2.62` 仅保证磁盘配置一致、但运行中的新版 Codex 仍继续使用旧供应商、旧模型目录和旧界面选择的问题；管理器保存设置与切换供应商现在合并为“磁盘事务 + 运行时事务”，不会再要求反复保存或重启碰运气喵~
- 移除管理器热重载对固定调试端口 `9229` 的依赖，改从 launcher 的 `latest-status.json` 读取当前实例真实 debug/helper 端口；同时接受有完整端口的 `running` 与 `running_degraded` 状态，避免动态端口启动后请求发往错误实例喵~
- 兼容新版 Codex 删除 `vscode-api-*` 独立资源并把 State API 合并进 `app-initial-*` 的拆包变化；运行时按函数结构发现 Host RPC，再通过 `batch-write-config-value` / `config/batchWrite` 和 `reloadUserConfig: true` 重新加载用户配置，不依赖资源哈希或压缩导出名喵~
- 配置重载后会把当前版本 renderer runtime 重新注入已打开页面，并强制调用新版原生 `list-models-for-host`、`set-default-model-config-for-host` 与 `clear-prewarmed-threads-for-host`，同步模型目录、默认模型和预热任务，不再只修改 `settings.json`、`config.toml` 与 `auth.json` 喵~
- 动态模型 runtime 升级到 v3；dispatcher、app-server、Response JSON、Statsig 与消息补丁支持升级重绑定，旧页面重新注入后不再继续调用旧闭包，也不会让旧供应商模型劫持新任务或下一轮请求喵~
- 新增 Codex++ 托管模型集合跟踪：当前供应商模型按管理器顺序置顶，只删除 Codex++ 先前注入、且不属于新供应商或官方原生目录的旧模型；官方模型始终保留，React 状态、Statsig 白名单、default/selected/model 字段和请求模型同步更新喵~
- 显式切换供应商或默认模型时，管理器的新选择优先于磁盘上旧的运行时模型快照；有效的用户当前模型仍保留，无效或属于上一供应商的选择会改为新默认模型，并回写最新 `lastUsedModel` 喵~
- 供应商总开关从关闭切到开启时会立即执行活动供应商的完整切换与动态注入；关闭或切回官方模式时后端返回明确空托管目录并立即对运行中的 Codex 执行清理，不再从已存档 profile 或残留 live 配置重新构造旧模型喵~
- 修正新版 `batch-write-config-value` 已改为直接参数、而旧版 `vscode-api-*` 仍使用 `{ params }` 包装的协议差异；两代 Host RPC 现在分别发送正确载荷，避免新版接口调用未抛错却没有真正 reload 配置喵~
- 动态事务会主动广播并失效新版 React Query 的 `models/list` 五分钟缓存，再补丁 React fiber 状态；因此已打开的模型菜单不再继续显示旧供应商，用户无需等待缓存自然过期或重启窗口喵~
- 管理器会验证真实端口、完整模型集合、模型数量、选中模型、未经过 Codex++ 响应补丁的原生 `model/list` 真实返回、查询缓存失效和默认模型接口的 `ok` / `okOverridden` 状态；任一关键步骤失败都明确提示“磁盘已保存但运行时未应用”，不再把“请求没抛异常”或“读到自己补出的模型”当作成功，活动供应商保存也不再重复弹出两个成功提示喵~
- 新增真实端口发现、旧/新 State API、CDP 返回解析、原生模型调用、旧托管模型清理、官方模型保留、首选模型置顶、有效/无效选择、总开关、普通保存动态应用、async mutex 边界与显式默认模型优先回归测试喵~

## 1.2.62 - 2026-08-04

- 修复管理器保存设置后重启 Codex 偶发恢复默认、模型选择消失或需要重复保存/重启的问题；根因是设置解析错误被静默降级为完整默认值、固定临时文件并发冲突、运行时模型回写与管理器完整快照竞态，以及旧异步响应覆盖新表单四条链路叠加喵~
- SettingsStore 现在使用跨进程共享/独占文件锁保护读取、完整保存、局部更新和模型选择回写；原子写入改用每次唯一的临时文件名，管理器与 Codex helper 同时写 settings.json 时不再争用同一个 settings.json.tmp 喵~
- settings.json JSON 损坏、读取失败或结构不正确时会返回明确错误并停止写入，不再构造 BackendSettings 默认值继续覆盖磁盘；第三方导入、cc-switch 导入、Provider 同步记录和图片设置重置等读改写路径也统一采用失败即停止或原子 mutate 喵~
- 管理器完整保存会保留磁盘上最新且仍存在于模型列表中的运行时模型选择，同时同步 lastUsedModel、model 和自定义模型默认项；编辑模型列表时如果已选模型被删除，则仍按新列表正常回退，不会恢复无效模型喵~
- 管理器所有 save_settings 请求统一进入串行队列，只有最新且成功的响应可以更新界面；设置加载或供应商切换失败时不会再用失败 payload 覆盖表单，而是保留当前草稿并重新读取已回滚的持久化设置喵~
- 供应商切换事务增加 settings.json 与 live config.toml/auth.json 双回滚；切换后的重新读取、配置写入或后续步骤任一失败时同时恢复管理器状态与 Codex live 文件，避免下次启动继续使用半套配置喵~
- 活动供应商在“供应商配置总开关”关闭时保存会显示明确阻断提示：配置只会存档，重启 Codex 也不会应用；避免总开关关闭时仍显示纯成功提示，让用户误以为模型配置已进入 live 文件喵~
- 新增损坏 JSON 拒绝默认化、16 路并发 mutation 无丢失、运行时模型选择保留、保存队列最新成功响应、供应商 live 双回滚和总开关提示回归测试喵~

## 1.2.61 - 2026-08-03

- 修复新版 Codex 将终端工具从 `Bash` 更名为 `shell_command` 后共享终端 Hook 静默失效的问题；Windows 现在同时安装并处理两个 matcher，并兼容 `conversation_id`、`thread_id`、`session_id`、`cwd` 和 `workdir` 字段，命令会重新进入 Codex 右上角官方终端的同一 ConPTY 会话喵~
- 共享终端继续保持未打开面板时的官方无感后台执行；模型输出、错误和退出码先回传后再释放会话，避免“立即释放”让模型永远等不到完成回执，用户可随时打开右上角终端输入密码、`yes/no`、回车或 `Ctrl+C` 喵~
- “Codex增强”新增 AI 终端释放时间滑块，范围为 `0` 到 `5` 分钟，默认 `2`；`0` 表示命令结果回传后立即关闭，`1` 至 `5` 表示最后一次输入/输出后的空闲保留时间，修改会立即保存并在运行时动态重新调度喵~
- 修复发送后编辑消息显示 `Failed to edit message`：新版注入器不再强制 `paginated` 历史模式，而是让 `thread/start`、`thread/resume` 及预热链路使用官方可回滚的 `legacy` 模式，恢复会话仍保留同一 thread 上下文喵~
- 保留并覆盖新版 `app-initial-*` 与旧分包的 dispatcher、app-server 请求和无项目会话补丁，避免历史模式修复回退“无项目会话准备失败”的兼容处理喵~
- 新增跨平台 Hook 安装断言、共享终端 `0/1/5/9/invalid` 换算断言、滑块 UI 源码契约和 legacy 编辑请求契约测试喵~

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
