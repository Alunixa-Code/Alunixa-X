# 2026-09-12 启动前配置、Agent 能力与高级提示词审计报告

## 目标

在 Alunixa X 启动 Codex 或重新激活已有 Codex 实例之前，对所有由 Alunixa X 管理或可能影响启动的本地配置执行统一检查，并只对明确归属于 Alunixa X 的残留项做窄范围修复；同时确保 Agent 能力开关、Codex `features` 配置和高级提示词引用保持一致喵~

## 已实现路径

- `crates/alunixa-x-core/src/startup_audit.rs` 统一检查 `config.toml`、`auth.json`、`hooks.json`、保存的供应商配置片段、退役字段、线程上限、image_gen MCP、WSS/provider 状态和高级提示词喵~
- `crates/alunixa-x-core/src/launcher.rs` 在公共配置、供应商配置、提示词、MCP 和其他启动写入完成后调用审计，失败时不启动 helper 或 Codex 喵~
- `apps/alunixa-x-launcher/src/main.rs` 的已有实例重新激活路径调用相同审计，避免首次启动和重新激活使用不同校验规则喵~
- Computer Use 与托管插件市场关闭时分别清理 Alunixa X 自有配置，保留用户自建插件、市场、Provider、凭据和外部提示词喵~
- 管理器 Agent 能力中的 Fast 模式开关由 `codexAppFastMode` 持久化，并由统一同步函数维护 `features.fast_mode = true`；关闭时不改动同一表中的其他 feature 喵~
- 供应商切换、纯 API/聚合/中转直接写入及官方登录迁移成功后重新同步 Agent 能力配置，避免完整 provider 配置重写覆盖 Fast 或线程上限喵~

## 保护边界

- 外部高级提示词文件只做读取、属性和内容安全检查，不因设置值不同而覆盖喵~
- 供应商凭据、`auth.json` 内容、任务历史、笔记、用户自建 hooks 和第三方市场不作为自动清理目标喵~
- 解析失败、文件类型异常、大小超过限制、NUL 字符、退役字段残留和开关与配置不一致都会在启动前返回错误喵~
- 诊断日志只记录计数，不写入配置正文、凭据和提示词正文喵~
- `features` 必须是 TOML table，Fast 开关与 `features.fast_mode` 必须一致；高级提示词引用必须是字符串，目标文件必须存在、为普通文件、非空、合法 UTF-8、未超限且不含 NUL 字符喵~

## 隔离验证

- core lib：`317 passed / 0 failed / 1 ignored`，ignored 项为既有 fake JSON-RPC 子进程入口并由父测试显式执行喵~
- relay switch：`9/9` 通过喵~
- installer：`13/13` 通过喵~
- manager Windows：`24/24` 通过喵~
- manager 前端全量：`93/93` 通过；Fast 模式、启动审计、高级提示词内容校验、供应商写入保留和队列编辑专项均通过喵~
- official remote：`8/8` 通过，覆盖官方登录迁移与退出登录后的 Agent 能力同步喵~
- `cargo fmt --all -- --check` 和 `cargo check --workspace --all-targets --locked` 通过喵~
- 不连接或重启当前 Codex、Helper、CDP，不读取或改写用户真实配置内容喵~
