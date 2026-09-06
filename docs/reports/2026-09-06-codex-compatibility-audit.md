# Alunixa X · 2026-09-06 Codex 兼容修复

唯一发行仓库为 `Alunixa-Code/Alunixa-X`，基线为 v1.0.10，目标为 v1.0.11；旧 Codex+++ v1.2.68 的发布不能代替新仓库交付喵~

## 整合原则与基准

- 对旧兼容差异进行品牌映射后的三方比较，只移植适用于新仓库的产品实现与回归，不导入旧桥接更新器、固定迁移版本、迁移 UI 或镜像资产喵~
- 保留新仓库的用量统计模块、CLI 同版本缓存回退、微信实时进度与脱敏、纯 API 本地上下文及原生窗口验证喵~
- 安装资源基准为只读 `OpenAI.Codex 26.901.5280.0`，工具 `tools/audit-codex-bundle.mjs` 只读取 ASAR/TypeScript AST，不执行安装资源或连接运行实例喵~
- Guardian 形状依据官方 `openai/codex` 固定提交 `008bbd5884122dc95aaece19ecfe0fc6a59dcf36` 的 `codex-rs/features/src/lib.rs` 和 `feature_configs.rs`，布尔与结构化表仍受支持，不能以旧错误报告无条件删除整个 feature 喵~

## 覆盖矩阵

| 领域 | 修复与保护 | 验证 |
| --- | --- | --- |
| 高级提示词 | 最后阶段启动检测、恢复文件/引用、last-good、自定义正文及外部路径保留、关闭不删除 | 临时 CODEX_HOME 行为测试、设置局部更新/重载、启动顺序契约 |
| 资源与注入 | 冷却限次、合并读取、单 timer、失败 Promise 恢复、避免自身 DOM 循环 | Node 执行型测试、CDP 源码契约、只读 ASAR |
| 模型与 Provider | model/list、原生 tiers、纯 API 恢复 | Node 行为、模型与配置测试 |
| 插件 | 非保留市场名、manifest/config/禁用项迁移、结构谓词识别 | 临时目录、Windows/UNC/macOS 路径、Node 回归 |
| 会话数据 | JSONL/目录表备份、删除、撤销、多库失败恢复、远端隔离 | 临时 SQLite/JSONL 及并发同步点测试 |
| 微信 | 目标事件关联、早到通知、失败状态、公开实时进度 | 隔离 fake 子进程/HTTP sink、状态机和缓冲区上限 |
| Guardian/Dream Skin | 合法结构保留、旧 scalar 修复、等价路径与失效备份 | 临时配置单元/集成回归 |
| 原有本地上下文 | 不回退、不移除工具或纯 API 配置 | Windows 正式 Actions 独立官方 CLI 端到端 |
| 发行 | 仓库目标保护、六资产、三平台测试、版本说明、hash | GitHub Actions 和 Release API |

详细测试计数、实际 Actions ID、产品提交及资产校验在 YHYQ.md 和正式 Release 记录，不能以旧仓库的成功构建充当本版本验收喵~
