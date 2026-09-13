# Project Memory

## 1. Project Overview
- Alunixa X 为 Windows/macOS Codex 桌面增强管理器与启动器，当前实际根目录 `D:\Cursor\AlunixaX` 喵~

## 2. Goals and Requirements
- 中文回复，不用 WSL；保护运行中 Codex/Helper/CDP，不自动重启或热注入；用隔离 fixture 验证喵~
- 显式设置应保存并应用，不能以配置保护为由吞掉用户编辑；不覆盖无关配置或泄露凭据喵~
- 每个重要阶段建立 Git 检查点，YHYQ.md 追加操作记录，XJ.md 同步项目状态喵~
- 推送产品必须由 GitHub Actions 三平台构建、发布六项 GitHub Release 安装资产并核对哈希喵~

## 3. Current Status
- 本地 main，版本 1.0.16；已发布产品提交 `cfedbe0f35e1581c95bc39b3b98161843e879c13`，其后本地提交为验收日志喵~
- 2026-09-13 工作树原先干净，新增窗口保存问题调查前检查点 `a50b13a` 喵~
- 环境提供的 `D:\Cursor\CodexPP` 已不存在，不在该目录执行或重建旧仓库喵~

## 4. Repository Structure
- `crates/alunixa-x-core` 配置、启动、桥接、协议、供应商核心；`crates/alunixa-x-data` 会话和存储喵~
- `apps/alunixa-x-manager` React 前端和 `src-tauri` Rust 管理器；`apps/alunixa-x-launcher` 启动器喵~
- `assets/inject` 原生界面注入；`tools` 验证脚本；`docs/releases` 发行说明；`.github/workflows` CI 喵~

## 5. Architecture
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
- v1.0.16 正式前端 93/93；Windows 权威 Rust 38 套件 1052 passed/0 failed/1 ignored，ignored 为父测试显式使用的子进程入口喵~
- `tools/verify-native-queued-followup.mjs <app.asar>` 在隔离内存 fixture 验证原生队列编辑错误，不操作真实运行实例喵~

## 10. Deployment and Operations
- 唯一远端 `Alunixa-Code/Alunixa-X`，正式工作流 `release-assets.yml` 喵~
- v1.0.16 Actions `34697355458` success；Release ID `387590363`，时间 `2026-09-12T14:06:17Z`，六资产与发行说明 SHA-256 已核验喵~
- Windows exe/zip、macOS x64 dmg/zip、macOS arm64 dmg/zip；跳过重复 push 构建后仅派发一次正式工作流喵~

## 11. Important Files
- `settings.rs` 设置合并与保存；`relay_config.rs` TOML 和上下文/模型窗口；`relay_switch.rs` 供应商切换回填喵~
- `App.tsx` 供应商表单；`commands.rs` 保存与切换入口；`startup_audit.rs` 启动检查；`codex_instructions.rs` 高级提示词保护与恢复喵~
- `YHYQ.md` 保留完整历史和发行证据；本文件首次创建于 2026-09-13，前序历史未删除喵~

## 12. APIs, Interfaces, and Data Formats
- 设置 JSON camelCase；Codex 配置 TOML；`model_context_window`、`model_auto_compact_token_limit` 为上下文/压缩相关项喵~
- `codexAppFastMode` 控制 `[features] fast_mode=true`，独立于原有 Fast 服务档位 UI 按钮喵~
- 运行中队列补丁只对本地成功删除的旧 ID 转为新增，不重放结果不明的网络请求喵~

## 13. Completed Work
- 实验性上下文移除和真实配置清理 v1.0.14，启动审计 v1.0.15，Fast/能力同步/高级提示词增强/队列编辑修复 v1.0.16 喵~

## 14. Pending Work
- 查清用户设置窗口并保存但 config 保留手动旧值的原因，隔离复现、最小修复、回归、按要求构建发行喵~

## 15. Known Bugs and Limitations
- 当前用户报告上下文窗口保存不更新 config，根因尚未确认；不把保存成功视为运行中任务已更新喵~
- 禁止在根目录直接 npm test（没有 package.json）；必须 --prefix 或正确工作目录喵~
- 旧运行中队列记录没有补丁捕获的删除证据时不盲目重放喵~

## 16. Design Decisions
- 自有配置精确同步，第三方/用户文件保留；明确编辑与后台回填须区别处理喵~
- 新旧仓库不可混用，旧路径无效时使用已确认的当前项目根目录喵~

## 17. Failed Approaches
- 历史出现根目录 npm ENOENT、多 Cargo 测试过滤参数错误、重复静态断言未同步；已修正命令和测试，不重复喵~
- gh run view --log 在整轮运行未完成时可能拒绝，等待同一运行完成后取日志，不重复派发喵~

## 18. Rollback and Recovery
- 修改前 `a50b13a`；产品稳定基线 tag v1.0.16；必要时使用针对性 revert，不 reset --hard，不覆盖其他修改喵~
- 本轮不修改用户真实配置；历史清理备份保留于对应配置目录 alunixa-x-retirement-backups 喵~

## 19. Current Task
- 用户：供应商设置上下文窗口后保存，配置文件没变仍为手动 config，怀疑配置保护逻辑错误喵~
- 正在恢复项目状态和定位表单→保存→回填→写入优先级，未对该问题修改产品代码喵~

## 20. Next Steps
- 定位 context window/modelWindows 相关 UI 保存和 core 回填逻辑，读取真实配置时只输出必要窗口字段喵~
- 写失败回归后修复显式编辑优先级，更新本文件与 YHYQ.md，再跑定向及完整 CI 喵~

## 21. Change Log
- 2026-09-13：未发现 XJ.md，依据完整项目日志和 Git 元数据补建；现有历史和所有配置保持不变喵~
