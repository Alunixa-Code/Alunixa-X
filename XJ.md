# Project Memory

## 1. Project Overview
- Alunixa X 为 Windows/macOS Codex 桌面增强管理器与启动器，当前实际根目录 `D:\Cursor\AlunixaX` 喵~

## 2. Goals and Requirements
- 2026-09-14 新需求：左侧“生图模型”栏目，配置多组 API/Key/Model、拖拽上下排列，首项为 MCP 默认模型并标记“默认”；Windows 开始菜单与 macOS 应用搜索须可输入 AX 找到喵~
- 中文回复，不用 WSL；保护运行中 Codex/Helper/CDP，不自动重启或热注入；用隔离 fixture 验证喵~
- 显式设置应保存并应用，不能以配置保护为由吞掉用户编辑；不覆盖无关配置或泄露凭据喵~
- 每个重要阶段建立 Git 检查点，YHYQ.md 追加操作记录，XJ.md 同步项目状态喵~
- 推送产品必须由 GitHub Actions 三平台构建、发布六项 GitHub Release 安装资产并核对哈希喵~

## 3. Current Status
- 当前开发生图模型配置与 AX 搜索入口，基于 v1.0.18；恢复后已提交上轮遗留补充修复和 UI 验证脚本，检查点 `bf3ddde`，无残留本项目 Cargo/测试进程，本轮尚未发布喵~
- 2026-09-14 v1.0.18 已正式发布并完成验收，产品提交 `44c41ea99125d4f1064ee7e636755f8ff0141fad`，annotated tag 对象 `dc9758baf645be15f62874ce502732b3e882db36`；唯一 Actions `34814836183` completed/success，六安装资产及哈希/匿名 latest 全通过，未替换已运行实例喵~
- 上一正式发行 v1.0.17 的产品提交为 `7478e7f08f5bb13bf4ed860448e710354678aa83`，tag 对象 `264fb290f27282d028f68635c6d69f05c09bfd4b`；历史标签和资产保持不变喵~
- v1.0.18 协议产品源码已推送；当前本地新增提交 `a7eed7b` / `bf3ddde` 包含生图模型、AX 入口及补充测试，尚待最终验收及新版本发行喵~
- 2026-09-13 工作树原先干净，新增窗口保存问题调查前检查点 `a50b13a` 喵~
- 环境提供的 `D:\Cursor\CodexPP` 已不存在，不在该目录执行或重建旧仓库喵~

## 4. Repository Structure
- `crates/alunixa-x-core` 配置、启动、桥接、协议、供应商核心；`crates/alunixa-x-data` 会话和存储喵~
- `apps/alunixa-x-manager` React 前端和 `src-tauri` Rust 管理器；`apps/alunixa-x-launcher` 启动器喵~
- `assets/inject` 原生界面注入；`tools` 验证脚本；`docs/releases` 发行说明；`.github/workflows` CI 喵~

## 5. Architecture
- 生图配置已存入既有 SettingsStore 的 imageModels 有序数组，独立 Tauri 命令做脱敏读取、带版本校验的定向保存；复用全量备份，不让普通设置的旧快照覆盖新生图配置喵~
- MCP 每次调用重新读取 imageModels，默认首项，显式 model/profile_id 可选其他已配置项；没有配置时保留原 Helper 图片端点回退，不把 Key 写入 MCP schema/env 或下载图片请求喵~
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
- v1.0.18 正式 CI 日志已独立核验：Windows 39 套件 1090 passed / 0 failed / 1 ignored，macOS x64/arm64 各 39 套件 1066 passed / 0 failed / 1 ignored，前端均 98/98；平台差异来自条件编译测试，唯一 ignored 仍为既有父测试调用的子进程入口喵~
- v1.0.18 版本升级后复验：Cargo locked metadata 四包、前端及 Tauri 版本一致；协议 31/31 + 71/71、前端 98/98、TypeScript、i18n 854/854 + 80/80、Vite、fmt、品牌及新增行凭据扫描全部 PASS 喵~
- 2026-09-14 最终冻结源码：`cargo test --workspace --locked --no-fail-fast -j 2 -- --test-threads=1` 退出 0，39 套件 1090 passed / 0 failed / 1 ignored；含 protocol_fidelity 31/31、protocol_proxy 71/71，共 102 项协议回归通过喵~
- 本轮前端 98/98、TypeScript、cargo check workspace/all-targets/locked、fmt、diff、品牌和 i18n 854/854 + 80/80 全通过；ignored 为原有父测试显式使用的 JSON-RPC 子进程入口，未新增忽略项喵~
- 2026-09-14 第一阶段协议验证：新增保真 13/13、既有协议 70/70 通过；旧测试中“丢弃/降级/过早结束/依赖进程缓存”的断言已改为保真或明确拒绝契约喵~
- v1.0.17 本地完整 workspace 38 套件 1058 passed/0 failed/1 ignored（core 319），cargo check all-targets、formatter、diff、版本/品牌检查通过喵~
- 前端 98/98、TypeScript、i18n 854/854 + 80/80、Vite 构建通过；headless 生产 UI 的启动模型选择、窗口编辑、预览、Tauri 提交参数验证 PASS（后端为内存 fixture），服务器及浏览器已关闭喵~
- v1.0.16 正式前端 93/93；Windows 权威 Rust 38 套件 1052 passed/0 failed/1 ignored，ignored 为父测试显式使用的子进程入口喵~
- `tools/verify-native-queued-followup.mjs <app.asar>` 在隔离内存 fixture 验证原生队列编辑错误，不操作真实运行实例喵~

## 10. Deployment and Operations
- v1.0.18 唯一正式 Actions `34814836183` 全部 success，Windows job `103883290529`、macOS arm64 `103883290531`、x64 `103883290600`、发布 `103887682566`；没有重复派发、复用旧二进制或移动标签喵~
- v1.0.18 Release ID `388200755`，发布于 `2026-09-14T07:07:07Z`（新加坡 2026-09-14 15:07:07），非草稿/非预发布；版本说明正文、产品提交、Actions、六项 uploaded 资产的 SHA-256 与匿名 latest 全部核验 PASS，完整哈希表在 YHYQ.md 喵~
- 唯一产品发布远端为 `origin` → `Alunixa-Code/Alunixa-X`，正式工作流 `release-assets.yml`；另有指向已不存在旧目录的 `legacy-codexpp` 本地 remote，本轮不使用、不移除喵~
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
- 2026-09-14：v1.0.18 产品修复已 push，三平台正式全量回归/构建成功，六安装资产发布、说明正文/哈希/来源/公开 latest 已验收；未安装或重启用户 Codex 喵~
- 2026-09-14：完成思考/工具输出分型、签名原生回放、SSE/UTF-8/JSON/usage/终态、工具身份/参数完整性、不确定 POST 禁止重放、能力门禁、JSON-to-SSE 和 102 项协议回归，工作区 1090 项通过喵~
- 实验性上下文移除和真实配置清理 v1.0.14，启动审计 v1.0.15，Fast/能力同步/高级提示词增强/队列编辑修复 v1.0.16 喵~
- v1.0.17 上下文保存/预览、清空/禁用清理、K/M 小数单位、显式启动模型选择及回读校验完成，本地和三平台正式 CI 通过，六资产正式发行已验收喵~

## 14. Pending Work
- 当前待办：审核既有实现、完成最新源码全量及 UI 验收、补齐发行说明，随后 push / Actions 三平台构建 / 新版本 Release 验收喵~
- 用户要求的修复、push、Actions 构建与 Release 发布已完成；真实模型逐一实测和用户安装不在本轮已完成项中，不把当前旧进程描述为已加载新版喵~
- 本轮六份 `.tmp/v1.0.18-*.log` 清理被环境策略拒绝，已停止删除尝试并保留原文件；不声称清理完成，不改用其他工具绕过，后续需要环境允许或用户自行处理喵~

## 15. Known Bugs and Limitations
- 2026-09-14 push 时 GitHub 提示既有 Dependabot 12 项（6 high/5 moderate/1 low），本轮未分析或修复该依赖清单，锁文件没有升级第三方依赖，不把协议修复描述为依赖安全清零喵~
- 跨协议不能等价表达的服务端工具、私有字段、状态引用、phase/channel、旧 Completions 工具/思考等明确拒绝；不通过静默删除字段实现“兼容”，具体矩阵见 docs/protocol-fidelity.md 喵~
- 没有可用原生回放依据的签名历史、跨协议/被编辑的回放内容，以及尚不能可靠拼装的 reasoning_details 流会明确失败；未宣称覆盖所有真实模型或私有扩展喵~
- 已确认：非启动模型的窗口写入 model-catalogs，根配置只跟随启动模型；真实 astra 1050000/1000000 已保存，当前启动模型 terra 为 272000/271000 喵~
- 以上预览/残留/单位问题已在正式 v1.0.17 修复并验证，当前真实配置未改动，尚未替用户安装新版喵~
- 禁止在根目录直接 npm test（没有 package.json）；必须 --prefix 或正确工作目录喵~
- 旧运行中队列记录没有补丁捕获的删除证据时不盲目重放喵~

## 16. Design Decisions
- 新页面沿用现有紫色主题、Inter/JetBrains Mono 与卡片样式，以真实顺序编号、拖拽手柄和首项“默认”徽标表达优先级，不另造一套界面或新增依赖喵~
- Windows 保留原品牌快捷方式并增加 AX 开始菜单别名；macOS 实际 bundle 文件名与显示名增加 (AX)，运行路径识别同时支持旧名称，不改变 bundle ID 或盲目删除旧安装喵~
- 协议保真优先于表面成功：保留原始参数和结构化类型，只在能力能够表达时转换；未知结果不重放，不根据普通正文启发式删除“调试内容”喵~
- 原生签名随历史自包含携带，避免全局缓存被清空、重启失效或跨会话撞 ID；严格校验后才恢复，不猜测缺失内容喵~
- 自有配置精确同步，第三方/用户文件保留；明确编辑与后台回填须区别处理喵~
- 新旧仓库不可混用，旧路径无效时使用已确认的当前项目根目录喵~

## 17. Failed Approaches
- 2026-09-14 发行收尾：使用已核验工作区范围的 PowerShell Remove-Item 清理本轮六份日志被执行环境拒绝，命令整体未运行；只读复查确认六文件仍在，不重试或换工具绕过喵~
- 2026-09-14：同一 target 在前一 cargo test 仍执行 exe 时启动重编译，会触发 Windows LNK1104/os error 32；Cargo 的编译锁不覆盖测试进程执行期，后续完整测试/编译必须严格串行喵~
- 2026-09-14：新增两种“不重放”fixture 曾复用同一 RequestRoundRobin 聚合 ID，第二种场景正常轮换到第二节点而被误报为重试；已为 HTTP 500/断连使用独立聚合 ID，不改变产品逻辑或弱化断言喵~
- 历史出现根目录 npm ENOENT、多 Cargo 测试过滤参数错误、重复静态断言未同步；已修正命令和测试，不重复喵~
- gh run view --log 在整轮运行未完成时可能拒绝，等待同一运行完成后取日志，不重复派发喵~

## 18. Rollback and Recovery
- 生图模型/AX 功能修改前检查点 `b448544`，功能基线 v1.0.18；不动真实配置、正在运行的 Codex 或系统安装入口，使用隔离 fixture 验证喵~
- 本轮修改前 `a9a50ac`；核心阶段 `dad0288`、`c452fa8`，最终产品修复 `1881887`，fixture 隔离修正 `a11f41e`；协议修复已随 v1.0.18 发布，上一稳定基线 v1.0.17，必要时针对性 revert 并发布新版本，不改动已有标签或覆盖其他修改喵~
- v1.0.18 发布准备前检查点 `9133669`，本轮只升级项目自身版本和更新发行文档，不升级第三方依赖或移动历史标签喵~
- 修改前 `a50b13a`；产品稳定基线 tag v1.0.16；必要时使用针对性 revert，不 reset --hard，不覆盖其他修改喵~
- 本轮不修改用户真实配置；历史清理备份保留于对应配置目录 alunixa-x-retirement-backups 喵~

## 19. Current Task
### 进行中：生图模型配置与 AX 搜索
- 2026-09-14 接续：完整读取本文件与近期 YHYQ.md，已将遗留修改及 UI 脚本提交为 bf3ddde；已有截图但无可接续的测试进程，下一步执行最终 UI smoke 和 Rust 回归，不重复第一阶段实现喵~
- 首批 Rust 已通过：生图配置 11/11、安装契约 16/16、MCP 6/6；真实本机随机端口验证默认项改动后生成/编辑请求的 URL/Key/Model 和图片下载无授权头，未访问真实供应商喵~
- 补齐独立生图启用不依赖对话供应商开关（仍遵守增强总开关），首次启动/已加载 MCP 的提示明确；macOS 双安装时优先启动已解析的同级 AX 应用，避免旧 bundle ID 缓存误启旧版，待最终回归喵~
- 首轮前端 103/103、TypeScript、i18n 893/893 + 81/81、品牌检查全通过；已新增后端 11 项配置/并发/备份回归、3 项 AX 安装契约、MCP 真实 HTTP fixture，下一步串行执行 Rust 与 headless UI 验证喵~
- 已同步 NSIS、macOS 打包及三套发布/恢复工作流中的 AX 新 bundle 路径，不减少原有测试/六资产门禁；首轮 TypeScript 发现控件没有 destructive variant，已改为既有 outline 样式并通过类型检查喵~
- 已实现 imageModels 设置结构、脱敏快照/Key 留空保留/并发版本校验、定向保存与旧 settings 快照保护；MCP 的生成/编辑请求均接入首项默认和显式配置选择，每次调用重新加载，不重试或泄露 Key 到下载请求喵~
- 已新增独立 ImageModelsScreen：增删改、密码框、拖拽/键盘/上下移、首项默认标记、自动保存排序、失败不提交新顺序、导航丢弃编辑确认；AX Windows 入口和 macOS 新旧名兼容已开始接入，尚未完成编译和验证喵~
- 用户提出两项需求，中间两次主动中断均未造成源码变更；已读取完整 XJ.md 与近期 YHYQ.md，确认 main 干净并建立检查点 b448544 喵~
- 已审阅 imagegen_mcp、SettingsStore、Tauri、导航/现有 dnd-kit、Windows/macOS 安装与发布脚本；接下来先接通配置到 MCP 的端到端链路，再测试系统安装名称和兼容路径喵~
- 官方文档 web 查询未返回正文，不据此宣称已获得官方索引行为证明；以实际文件名 AX 和安装契约验证搜索入口，不假称当前未安装机器已经实测喵~

### 当前最终状态
- **v1.0.18 已正式交付**：Actions 34814836183 completed/success，Release 388200755 六资产、说明正文、全部哈希、标签/提交来源与匿名 latest 已核验；三平台测试/构建通过喵~
- 验收日志已写入本文件和 YHYQ.md，后续本地提交只记录验收；运行实例及真实 config/auth 未动，本轮未下载或安装正式安装包喵~
- 六份本轮临时日志删除被环境拒绝，已只读确认保留；发行页已提交 Codex 右侧预览，工具返回 queued，不能说已实际显示喵~

### 历史阶段记录（以下进行中/未发布措辞不代表当前状态）
- 已推送并启动构建阶段：唯一 run `34814836183`；推送产品提交和 tag 解引用均为 `44c41ea99125d4f1064ee7e636755f8ff0141fad` 喵~
- **发布前门禁完成**：准备提交并推送协议保真/类型隔离/原生回放/SSE 完整性/防不确定重放及 102 项协议回归，版本自身升级至 1.0.18，不含依赖升级；主分支和标签将使用同一产品提交喵~
- **当前发布任务（2026-09-14）**：已实查 GitHub，最近正式发行 v1.0.17，远端 main 为 7478e7f，v1.0.18 标签未占用、最近五轮正式 Actions 均已完成；接续已有修复准备 v1.0.18 喵~
- 已将 workspace/Cargo.lock、manager package/package-lock、Tauri 一致升级至 1.0.18，Unreleased 转正式版本条目并新增 `docs/releases/v1.0.18.md`，以下“未发布”修复记录为上一阶段历史喵~
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
- 完成本轮功能和隔离验收，更新本文件、YHYQ.md 与发行说明并提交；结合用户本任务的 push/构建/发布要求准备新版本，不重复发布 v1.0.18，不移动旧标签喵~
- 不再构建或重复发布 v1.0.18；用户可从正式 Release 下载并在合适时机重新经 Alunixa X 启动，以加载本地协议修复，当前任务不自动安装/重启喵~
- 如后续遇到特定供应商兼容错误，依据协议错误及不含密钥/真实对话的最小 fixture 补充回归，不能为通过请求而恢复静默丢弃或不确定重放喵~
- 六份本轮临时日志处于环境拒绝删除状态，保留记录，不重复清理尝试；依赖告警另作专项评估，不混入已冻结的 v1.0.18 喵~
- 不需要重建/重复发布 1.0.17；需要根配置采用 astra 窗口时，安装新版后在“启动模型”显式选择 gpt-6-astra，再保存其窗口/阈值喵~
- 保持当前 Codex 不重启，不擅自更改真实配置；后续任务从本文件和 YHYQ.md 最新验收记录继续喵~

## 21. Change Log
- 2026-09-14 接续检查点 bf3ddde：保存独立 MCP 启用、macOS 同级 AX 应用优先启动和隔离 UI 脚本；开始最终验收与发行收尾喵~
- 2026-09-14 新任务：生图模型 MCP 默认配置/拖拽排序与 Windows/macOS AX 搜索入口，检查点 b448544；启动实现，未触碰真实配置和运行实例喵~
- 2026-09-14 发行验收：唯一 Actions 34814836183 成功，Release 388200755 六资产于 07:07:07Z 发布，Windows 1090/0/1、两种 macOS 各 1066/0/1、前端各 98/98；说明/哈希/来源/匿名 latest 均 PASS 喵~
- 2026-09-14 收尾：本轮临时日志删除被环境拒绝，六文件保留；右侧发行预览 queued，真实配置与进程不变，最终验收记录已更新喵~
- 2026-09-14 推送：main 与 annotated v1.0.18 已原子推送，44c41ea 为产品提交，正式 Actions 34814836183 已派发；完整三平台构建与发行仍在进行喵~
- 2026-09-14 发布门禁：版本准备提交 8bf82c4 后，协议 102/102、前端 98/98、类型/i18n/生产构建/版本/品牌/格式/凭据扫描均通过，远端 main 未变且 v1.0.18 仍未占用喵~
- 2026-09-14 发布准备：用户要求 push/构建/发布；读取记忆并核对 GitHub，建立检查点 9133669，准备未占用的 v1.0.18 和详细协议保真发行说明，尚未推送喵~
- 2026-09-14 验收：本地协议保真修复完成，最终 39 套件 1090 passed / 0 failed / 1 ignored，协议 102/102、前端 98/98 及编译/类型/格式/品牌/i18n 全通过；未改真实配置或运行实例喵~
- 2026-09-14：启动协议保真修复，创建修改前检查点 a9a50ac；联网核对官方 Responses、Claude streaming 和 Gemini thought signature 契约，不存储凭据或真实对话喵~
- 2026-09-13：未发现 XJ.md，依据完整项目日志和 Git 元数据补建；现有历史和所有配置保持不变喵~
- 2026-09-13：完成上下文保存/预览一致性修复、初步失败→通过回归、版本 1.0.17 与发行说明，等待最终全套验证和正式 CI 喵~
- 2026-09-13：本地完整回归、生产 UI smoke、三平台 Actions、六资产 Release 与哈希/匿名 latest 全部验收完成喵~
- 2026-09-13 收尾：已删除本轮 7 份临时验证日志；真实配置与运行实例保持不变，保留可复用测试脚本/依赖缓存；验收日志已提交喵~
