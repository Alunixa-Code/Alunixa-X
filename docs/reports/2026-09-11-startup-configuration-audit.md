# 2026-09-11 启动前配置与高级提示词审计报告

## 目标

在 Alunixa X 启动 Codex 或重新激活已有 Codex 实例之前，对所有由 Alunixa X 管理或可能影响启动的本地配置执行统一检查，并只对明确归属于 Alunixa X 的残留项做窄范围修复喵~

## 已实现路径

- `crates/alunixa-x-core/src/startup_audit.rs` 统一检查 `config.toml`、`auth.json`、`hooks.json`、保存的供应商配置片段、退役字段、线程上限、image_gen MCP、WSS/provider 状态和高级提示词喵~
- `crates/alunixa-x-core/src/launcher.rs` 在公共配置、供应商配置、提示词、MCP 和其他启动写入完成后调用审计，失败时不启动 helper 或 Codex 喵~
- `apps/alunixa-x-launcher/src/main.rs` 的已有实例重新激活路径调用相同审计，避免首次启动和重新激活使用不同校验规则喵~
- Computer Use 与托管插件市场关闭时分别清理 Alunixa X 自有配置，保留用户自建插件、市场、Provider、凭据和外部提示词喵~

## 保护边界

- 外部高级提示词文件只做读取、属性和内容安全检查，不因设置值不同而覆盖喵~
- 供应商凭据、`auth.json` 内容、任务历史、笔记、用户自建 hooks 和第三方市场不作为自动清理目标喵~
- 解析失败、文件类型异常、大小超过限制、NUL 字符、退役字段残留和开关与配置不一致都会在启动前返回错误喵~
- 诊断日志只记录计数，不写入配置正文、凭据和提示词正文喵~

## 隔离验证

- core lib：`311 passed / 0 failed / 1 ignored`，ignored 项为既有 fake JSON-RPC 子进程入口并由父测试显式执行喵~
- relay switch：`9/9` 通过喵~
- installer：`13/13` 通过喵~
- manager Windows：`24/24` 通过喵~
- `cargo fmt --all -- --check` 和 `cargo check --workspace --all-targets --locked` 通过喵~
- 不连接或重启当前 Codex、Helper、CDP，不读取或改写用户真实配置内容喵~
