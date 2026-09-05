# 实验性上下文与纯 API 本地兼容验证

## 范围

- 管理器 Agent 能力 → 对话与输入 → 实验性上下文，默认关闭、自动保存，重启后应用喵~
- 官方参数为 `features.context_management.experimental_mode`，纯 API 兼容使用原生 `features.token_budget` 加本地 MCP，不伪造 ChatGPT 登录或订阅喵~
- 官方源码核对固定在 `openai/codex` 提交 `ddf04ad26789d040f9ef6a96736f76602e35a6cc`：`core/src/session/token_budget.rs`、`core/src/compact_token_budget.rs`、`ext/history-notes/src/extension.rs` 和 `backend.rs` 喵~
- 官方资料：`https://learn.chatgpt.com/docs/config-file/config-reference`，核对日期为 2026-09-05 喵~

## 真实 CLI 与假 API 隔离验证

- 测试使用**单独下载**的官方 Codex CLI `rust-v0.153.4`，没有启动或连接用户当前安装的 Codex、CDP、Helper 或管理器喵~
- Windows x64 官方 ZIP SHA-256：`c016b0e6968b78586919c720d2685a03712f6d5f11bcd9d6f92c91eb8c41ba16`，独立 EXE SHA-256：`444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b` 喵~
- 使用独立 `HOME` / `CODEX_HOME` / SQLite 目录、无 `auth.json`、仅假 API Key、仅随机 loopback HTTP 模型服务，关闭 shell 工具，测试有 90 秒整体期限喵~
- 验证脚本为 `tools/test-context-api-compat.mjs`，要求 CLI 放在显式 fixture 目录下的 `isolated-codex.exe`，防止误用已安装 CLI 喵~
- 成功流程共 **7 个本地 Responses 请求**：发现延迟 MCP → 写入任务笔记 → 原生 `new_context` → 重新发现工具 → 读取持久笔记 → 检索旧用户消息 → 完成喵~
- 断言检查实际 `function_call_output`，不是只检查工具参数；确认新窗口中旧笔记调用结果被清除，然后通过真实本地 SQLite 读回同一笔记；历史检索读回切换前的真实 fixture rollout 消息喵~
- 测试结束确认不存在 `auth.json`，CLI 成功退出，输出 `ISOLATED_CONTEXT_COMPAT_PASS` 喵~

## 回归中发现并修复的问题

1. SettingsStore 局部更新白名单遗漏新开关，导致局部关闭请求被忽略，已补齐喵~
2. 当前 Codex 固定延迟发现 MCP 工具，测试不能假设第一请求就带全部工具，现使用官方 `tool_search_call` 协议喵~
3. 命名空间工具需使用独立 `namespace` 字段，不是把 namespace 拼进 `name`，假 API 已修正并收紧结果断言喵~
4. 未配置审批时，never 策略会拒绝 MCP 笔记写入；只对本功能两项本地工具设置 `approval_mode = "approve"`，不改变全局审批或其他工具权限，并设置 `required = true` 防止初始化失败后继续运行窗口管理喵~

## 行为与验证边界

- 这是本地兼容实现，不是解锁官方云端 history/notes API，不增加模型上下文容量喵~
- 本地笔记按 thread UUID 分开，模型需使用当前 `CODEX_THREAD_ID`，不应猜测其他会话 ID；查询历史只返回用户/助手文本，不含原始 reasoning、工具 payload 或图片附件喵~
- 默认剩余 16384 token 时提醒保存笔记，阈值后预留 2048 token 收尾，但不突破模型硬上限；已有自定义 token-budget 提示和数值保持不变喵~
- notes 写入上限 24 KiB；单个 MCP 请求上限 128 KiB；历史单文件最多扫描 64 MiB，目录访问最多 50000 项，结果条数最多 30，返回文本有界喵~
- 关闭时恢复托管字段原值，保留开启后的手动修改，不删除 SQLite 笔记；不存在原配置且默认关闭时不创建空配置喵~
- 真实 CLI 的**模型响应由确定性假 API 产生**，此验证证明工具与窗口管理执行链路，不等同于每家第三方模型都会正确主动保存笔记，也不是用户真实账户或真实服务的端到端验收喵~
