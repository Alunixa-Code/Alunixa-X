# Project Memory

## 1. Project Overview
- Alunixa X 为 Windows/macOS Codex 桌面增强管理器与启动器，当前实际根目录 `D:\Cursor\AlunixaX` 喵~

## 2. Goals and Requirements
- 中文回复，不用 WSL；保护运行中 Codex/Helper/CDP，不自动重启或热注入；用隔离 fixture 验证喵~
- 显式设置应保存并应用，不能以配置保护为由吞掉用户编辑；不覆盖无关配置或泄露凭据喵~
- 每个重要阶段建立 Git 检查点，YHYQ.md 追加操作记录，XJ.md 同步项目状态喵~
- 推送产品必须由 GitHub Actions 三平台构建、发布六项 GitHub Release 安装资产并核对哈希喵~

## 3. Current Status
- 2026-09-14 协议保真修复已完成本地源码与完整验收，版本号仍为 1.0.17，未推送、未发布、未替换已运行实例；历史正式发行状态见下文喵~
- v1.0.17 已正式发布，产品提交 `7478e7f08f5bb13bf4ed860448e710354678aa83`，tag 对象 `264fb290f27282d028f68635c6d69f05c09bfd4b`；后续本地提交仅记录验收喵~
- 2026-09-13 工作树原先干净，新增窗口保存问题调查前检查点 `a50b13a` 喵~
- 环境提供的 `D:\Cursor\CodexPP` 已不存在，不在该目录执行或重建旧仓库喵~

## 4. Repository Structure
- `crates/alunixa-x-core` 配置、启动、桥接、协议、供应商核心；`crates/alunixa-x-data` 会话和存储喵~
- `apps/alunixa-x-manager` React 前端和 `src-tauri` Rust 管理器；`apps/alunixa-x-launcher` 启动器喵~
- `assets/inject` 原生界面注入；`tools` 验证脚本；`docs/releases` 发行说明；`.github/workflows` CI 喵~

## 5. Architecture
- `protocol_proxy.rs` 处理协议路由、转换和 SSE 状态机，新增子模块 `protocol_proxy/fidelity.rs` 处理能力校验及自包含原生回放，`launcher.rs` 负责 HTTP 错误/SSE 交付与超时喵~
- 前端表单通过 Tauri commands 调用 core SettingsStore/relay_switch/relay_config；启动器最后执行 startup_audit 门禁喵~
- 设置快照与真实 CODEX_HOME/config.toml 分开，供应商切换含回填、保存、原子写入及回滚逻辑喵~

## 6. Technologies and Dependencies
- Rust edition 2024 workspace；Tauri 2、React 19、TypeScript 5、Vite 6、Node 22 CI 喵~
- Cargo.lock 和管理器 package-lock.json 固定依赖，不因修复升级无关依赖喵~

## 7. Configuration and Environment
- Codex 使用 CODEX_HOME 或默认用户 `.codex`；管理器历史状态位于 `.codex-session-delete`，路径以 core paths/codex_home 为准喵~
- 密码、API key、token、auth.json 正文均不保存到项目记忆或公开日志喵~

## 8. Development Commands
- 根目录：`cargo test --workspace --locked --no-fail-fast -- --test-threads=1`，`cargo check --workspace --all-targets --locked`，`cargo fmt --all -- --check` 喵~
- 前端：`npm --prefix apps/alunixa-x-manager test`、`npm --prefix apps/alunixa-x-manager run check`、`npm --prefix apps/alunixa-x-manager run vite:build` 喵~
- `node tools/i18n-verify.mjs`、`node tools/check-local-branding.mjs`、`git diff --check` 喵~

## 9. Testing and Verification
- 2026-09-14 最终冻结源码：`cargo test --workspace --locked --no-fail-fast -j 2 -- --test-threads=1` 退出 0，39 套件 1090 passed / 0 failed / 1 ignored；含 protocol_fidelity 31/31、protocol_proxy 71/71，共 102 项协议回归通过喵~
- 本轮前端 98/98、TypeScript、cargo check workspace/all-targets/locked、fmt、diff、品牌和 i18n 854/854 + 80/80 全通过；ignored 为原有父测试显式使用的 JSON-RPC 子进程入口，未新增忽略项喵~
- 2026-09-14 第一阶段协议验证：新增保真 13/13、既有协议 70/70 通过；旧测试中“丢弃/降级/过早结束/依赖进程缓存”的断言已改为保真或明确拒绝契约喵~
- v1.0.17 本地完整 workspace 38 套件 1058 passed/0 failed/1 ignored（core 319），cargo check all-targets、formatter、diff、版本/品牌检查通过喵~
- 前端 98/98、TypeScript、i18n 854/854 + 80/80、Vite 构建通过；headless 生产 UI 的启动模型选择、窗口编辑、预览、Tauri 提交参数验证 PASS（后端为内存 fixture），服务器及浏览器已关闭喵~
- v1.0.16 正式前端 93/93；Windows 权威 Rust 38 套件 1052 passed/0 failed/1 ignored，ignored 为父测试显式使用的子进程入口喵~
- `tools/verify-native-queued-followup.mjs <app.asar>` 在隔离内存 fixture 验证原生队列编辑错误，不操作真实运行实例喵~

## 10. Deployment and Operations
- 唯一远端 `Alunixa-Code/Alunixa-X`，正式工作流 `release-assets.yml` 喵~
- v1.0.17 唯一 Actions `34744977463` 全部 success，Windows job 103691133361、macOS x64 103691133375、arm64 103691133353、发布 103693272939 成功；禁止重复派发或移动标签喵~
- Release ID `387828405`，发布于 `2026-09-13T07:39:16Z`，非草稿/非预发布；六项安装资产与说明哈希、匿名 latest 均 PASS，完整资产名称/字节数/SHA-256 在 YHYQ.md 喵~
- 正式 Windows 前端 98/98，Rust 38 套件 1058 passed/0 failed/1 ignored，已从完成的 CI 日志核验喵~
- v1.0.16 Actions `34697355458` success；Release ID `387590363`，时间 `2026-09-12T14:06:17Z`，六资产与发行说明 SHA-256 已核验喵~
- Windows exe/zip、macOS x64 dmg/zip、macOS arm64 dmg/zip；跳过重复 push 构建后仅派发一次正式工作流喵~

## 11. Important Files
- `docs/protocol-fidelity.md` 记录保真边界和协议契约；`tests/protocol_fidelity.rs` 为新增独立回归，不依赖真实模型账户喵~
- `settings.rs` 设置合并与保存；`relay_config.rs` TOML 和上下文/模型窗口；`relay_switch.rs` 供应商切换回填喵~
- `App.tsx` 供应商表单；`commands.rs` 保存与切换入口；`startup_audit.rs` 启动检查；`codex_instructions.rs` 高级提示词保护与恢复喵~
- `YHYQ.md` 保留完整历史和发行证据；本文件首次创建于 2026-09-13，前序历史未删除喵~

## 12. APIs, Interfaces, and Data Formats
- 原生回放使用 reasoning.encrypted_content 中版本化 `alunixa-x-replay-v1:` Base64 JSON，携带 wire/native/items 并核对所覆盖历史；不等同于加密，不作为对话正文或诊断日志输出喵~
- 不支持输入返回 400/unsupported_protocol_conversion，上游无效响应返回结构化 502；SSE 终态互斥、有序号、截断工具不发执行完成，已停止生成但缺终止帧时 5 秒截止且不重放喵~
- 设置 JSON camelCase；Codex 配置 TOML；`model_context_window`、`model_auto_compact_token_limit` 为上下文/压缩相关项喵~
- `codexAppFastMode` 控制 `[features] fast_mode=true`，独立于原有 Fast 服务档位 UI 按钮喵~
- 运行中队列补丁只对本地成功删除的旧 ID 转为新增，不重放结果不明的网络请求喵~

## 13. Completed Work
- 2026-09-14：完成思考/工具输出分型、签名原生回放、SSE/UTF-8/JSON/usage/终态、工具身份/参数完整性、不确定 POST 禁止重放、能力门禁、JSON-to-SSE 和 102 项协议回归，工作区 1090 项通过喵~
- 实验性上下文移除和真实配置清理 v1.0.14，启动审计 v1.0.15，Fast/能力同步/高级提示词增强/队列编辑修复 v1.0.16 喵~
- v1.0.17 上下文保存/预览、清空/禁用清理、K/M 小数单位、显式启动模型选择及回读校验完成，本地和三平台正式 CI 通过，六资产正式发行已验收喵~

## 14. Pending Work
- 本轮源码修复和本地验收已完成；真实模型/供应商逐一实测、正式版本发布和用户安装均未执行，不能把当前运行实例说成已应用补丁喵~

## 15. Known Bugs and Limitations
- 跨协议不能等价表达的服务端工具、私有字段、状态引用、phase/channel、旧 Completions 工具/思考等明确拒绝；不通过静默删除字段实现“兼容”，具体矩阵见 docs/protocol-fidelity.md 喵~
- 没有可用原生回放依据的签名历史、跨协议/被编辑的回放内容，以及尚不能可靠拼装的 reasoning_details 流会明确失败；未宣称覆盖所有真实模型或私有扩展喵~
- 已确认：非启动模型的窗口写入 model-catalogs，根配置只跟随启动模型；真实 astra 1050000/1000000 已保存，当前启动模型 terra 为 272000/271000 喵~
- 以上预览/残留/单位问题已在正式 v1.0.17 修复并验证，当前真实配置未改动，尚未替用户安装新版喵~
- 禁止在根目录直接 npm test（没有 package.json）；必须 --prefix 或正确工作目录喵~
- 旧运行中队列记录没有补丁捕获的删除证据时不盲目重放喵~

## 16. Design Decisions
- 协议保真优先于表面成功：保留原始参数和结构化类型，只在能力能够表达时转换；未知结果不重放，不根据普通正文启发式删除“调试内容”喵~
- 原生签名随历史自包含携带，避免全局缓存被清空、重启失效或跨会话撞 ID；严格校验后才恢复，不猜测缺失内容喵~
- 自有配置精确同步，第三方/用户文件保留；明确编辑与后台回填须区别处理喵~
- 新旧仓库不可混用，旧路径无效时使用已确认的当前项目根目录喵~

## 17. Failed Approaches
- 2026-09-14：同一 target 在前一 cargo test 仍执行 exe 时启动重编译，会触发 Windows LNK1104/os error 32；Cargo 的编译锁不覆盖测试进程执行期，后续完整测试/编译必须严格串行喵~
- 2026-09-14：新增两种“不重放”fixture 曾复用同一 RequestRoundRobin 聚合 ID，第二种场景正常轮换到第二节点而被误报为重试；已为 HTTP 500/断连使用独立聚合 ID，不改变产品逻辑或弱化断言喵~
- 历史出现根目录 npm ENOENT、多 Cargo 测试过滤参数错误、重复静态断言未同步；已修正命令和测试，不重复喵~
- gh run view --log 在整轮运行未完成时可能拒绝，等待同一运行完成后取日志，不重复派发喵~

## 18. Rollback and Recovery
- 本轮修改前 `a9a50ac`；核心阶段 `dad0288`、`c452fa8`，最终产品修复 `1881887`，fixture 隔离修正 `a11f41e`；当前正式稳定发行 v1.0.17，针对性 revert 即可回滚本地未发布改动喵~
- 修改前 `a50b13a`；产品稳定基线 tag v1.0.16；必要时使用针对性 revert，不 reset --hard，不覆盖其他修改喵~
- 本轮不修改用户真实配置；历史清理备份保留于对应配置目录 alunixa-x-retirement-backups 喵~

## 19. Current Task
- **最终状态（2026-09-14）**：源码修复与验收完成，严格串行最终 workspace 退出 0、1090/0/1，协议 31+71 全通过；前端、类型/编译/格式/品牌/i18n 检查全通过喵~
- XJ.md、YHYQ.md、CHANGELOG Unreleased 和协议说明已同步；未发布、未安装、未重启用户 Codex，以下为已结束的阶段历史而非当前待办喵~
- 首轮全量非成功：新增不重放 fixture 共享轮换 ID 导致一项失败及同进程锁中毒；并发重编译占用测试 exe 导致 storage_adapter 未执行，后轮 LNK1104 失败，均不作为最终验证结果喵~
- 已定位并修复 fixture 身份隔离问题；两轮旧 cargo test 均已退出，接下来只串行跑一次最终 workspace，不再并发写测试可执行文件喵~
- 收尾审计增加上游非 assistant 角色拒绝、失败流保留半截工具参数且不发可执行 done、HTTP ID 协商仅允许 400/422 且响应含输出时禁止重试；最新保真用例共 31 项，需用最终源码重新验收喵~
- 第一轮 workspace 已进入并行 Windows 链接阶段，进程正常推进；其编译期间补了上述最后边界，不能把第一轮结果直接当最终源码全量验收喵~
- 最新进度：第二阶段保真 26/26、既有协议 70/70 通过，随后新增 Gemini 原始函数 ID、缺失 response_id、ID 协商输出后不重放及 HTTP 结果不明不切换回归；完整 workspace 正在运行，前端 98/98 已通过喵~
- HTTP 已区分不支持输入的 400 和上游错误的 502；支持上游 JSON 对流请求的 SSE 交付；生成已停止后仍不结束的流有独立 5 秒截止时间，不被心跳续期喵~
- 本轮仅本地修复，CHANGELOG 使用 Unreleased，没有修改版本或已发行标签；尚未作真实供应商/运行窗口验收喵~
- 13 项原始失败已全部修复并通过，原有协议专项 70/70 通过；额外修复缓存 token 口径、流式 refusal 类型和函数名分片，正在接入 HTTP 可区分错误与追加原生流回放/异常边界测试喵~
- 首批隔离回归 `protocol_fidelity` 在旧实现上 13/13 失败，逐项证实尾部 usage 丢失、EOF/JSON/UTF-8 静默成功、工具身份提前生成、incomplete 错发 completed、跨会话 Gemini ID 冲突及签名丢失喵~
- 已开始修复：新增 `protocol_proxy/fidelity.rs` 请求能力门禁和自包含原生回放项；不支持项明确失败，Anthropic/Gemini 原始内容和签名通过 opaque reasoning 回放项保存，不再依赖全局 Gemini 签名缓存喵~
- 流式状态机正在补充严格解码/帧解析、单终态、序号、尾部用量、思考/正文分段及工具完整性校验；当前编译/专项回归进行中，尚未宣称通过喵~
- 官方 OpenAI、Anthropic、Google SDK 类型文件通过 HTTPS 200 核验；web 工具未返回正文，实际核对的是官方仓库类型定义，不依据空搜索结果作判断喵~
- 2026-09-14 当前任务：审计 `crates/alunixa-x-core/src/protocol_proxy.rs` 的 Responses/Chat/Completions/Anthropic/Gemini 转换和代理重试链路，保持原生 Responses 透传喵~
- 修改前检查点 `a9a50ac`，开始时 main 工作树干净；已完整读取本文件并读取 YHYQ.md 最新历史，不触碰运行实例和真实配置喵~
- 原则：支持的语义和原始数据应完整保留，不支持的有损转换明确失败，不能伪装成功、把工具结果降为用户消息或重放结果不明的请求喵~
- 下列 2026-09-13 上下文保存任务为已完成历史，保留作为前序证据喵~
- 用户：供应商设置上下文窗口后保存，配置文件没变仍为手动 config，怀疑配置保护逻辑错误喵~
- 已定位分歧；旧前端五项失败，Rust 两项失败（清空窗口残留、单位解析失败）已复现；正常显式保存覆盖手动旧窗口和非启动模型目录更新原先通过喵~
- 前端已改用选中 custom model 生成预览，公共配置合并后再应用显式窗口；支持带注释表头避免误改嵌套配置；启动模型现在可显式选择喵~
- Rust relay_switch 13/13；前端 98/98、TypeScript、i18n 854/854 + 80/80、完整 workspace 和三平台 CI 全部通过喵~
- CHANGELOG 与 docs/releases/v1.0.17.md 已补齐修复内容、行为区别及不影响真实运行实例的边界，发行包含该说明喵~
- tools/verify-context-save-ui.py 验证 headless 生产 UI + 内存 Tauri fixture 的启动选择、编辑窗口、预览和提交请求 PASS，不访问真实后端喵~
- 第一次 UI smoke 点卡片标题不会打开详情，定位到明确“编辑”按钮后修正测试选择器；非产品失败，隔离服务器已自动退出；本地完整 Rust 已完成编译并正在运行套件喵~
- 更正：with_server.py 在 Windows shell=True 只结束外层 shell，遗留本轮两个 Python HTTP server，第二轮 ERR_EMPTY_RESPONSE；改用脚本进程内 ThreadingHTTPServer 随 finally 清理，回收精确匹配本轮 18742 fixture 的进程，不动其他服务喵~
- 最终状态：Actions 34744977463 completed/success，Release 387828405 六资产正式发布及哈希核验完成，产品需求交付完成喵~

## 20. Next Steps
- 当前源码工作无需继续修补或重复测试；如用户要求交付安装版，再核查远端版本、升级至未占用版本并执行唯一正式 GitHub Actions/Release 流程，不能覆盖已有标签喵~
- 不需要重建/重复发布 1.0.17；需要根配置采用 astra 窗口时，安装新版后在“启动模型”显式选择 gpt-6-astra，再保存其窗口/阈值喵~
- 保持当前 Codex 不重启，不擅自更改真实配置；后续任务从本文件和 YHYQ.md 最新验收记录继续喵~

## 21. Change Log
- 2026-09-14 验收：本地协议保真修复完成，最终 39 套件 1090 passed / 0 failed / 1 ignored，协议 102/102、前端 98/98 及编译/类型/格式/品牌/i18n 全通过；未改真实配置或运行实例喵~
- 2026-09-14：启动协议保真修复，创建修改前检查点 a9a50ac；联网核对官方 Responses、Claude streaming 和 Gemini thought signature 契约，不存储凭据或真实对话喵~
- 2026-09-13：未发现 XJ.md，依据完整项目日志和 Git 元数据补建；现有历史和所有配置保持不变喵~
- 2026-09-13：完成上下文保存/预览一致性修复、初步失败→通过回归、版本 1.0.17 与发行说明，等待最终全套验证和正式 CI 喵~
- 2026-09-13：本地完整回归、生产 UI smoke、三平台 Actions、六资产 Release 与哈希/匿名 latest 全部验收完成喵~
- 2026-09-13 收尾：已删除本轮 7 份临时验证日志；真实配置与运行实例保持不变，保留可复用测试脚本/依赖缓存；验收日志已提交喵~
