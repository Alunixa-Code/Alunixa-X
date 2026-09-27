# 启动与能力配置排查

## 证据边界

| 问题 | 已有证据 | 尚未确认 |
| --- | --- | --- |
| 应用隔离代理 | 用户 ProcMon 记录表明打包进程读取的注册表视图启用了无监听的本机代理；包上下文关闭后请求恢复 | 初始写入者；不能归因于 AX |
| 白屏/转圈 | 用户现场关闭代理且 PAC 为空仍白屏；当前安装包 26.924.2738.0、后台 0.158.0-alpha.2.1 已只读确认 | 白屏首次初始化错误；菜单注入成功不等于界面就绪 |
| 配置不一致 | 旧 save_settings 先写 settings 后写多个配置且无事务；部分前端乐观开关失败后未恢复；fast_mode 删除不等于关闭 | 每个注入适配器对新版 bundle 的实际支持程度 |
| 概览误报 | helperReady 只取 latest_launch.helper_port；其他计数仅取模型名、开关和安装版本 | 模型请求未测试，禁止显示为成功 |

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

## 配置层与覆盖

AX settings 是期望值，不是 Codex 的有效配置；Codex 还可能读取 CODEX_HOME、全局 config、项目 .codex/config.toml、profile、启动 -c 参数、环境变量、受管策略、插件/MCP 和进程内快照。
读取全局文件不能声称已确定任意项目或现有任务的有效值；原生 app-server 未提供成功读取时保留未知，并列出检测到的覆盖来源。

## 上游同步范围

已抓取并固定 `upstream/v1.2.48` 至 `upstream/v1.3.0`；目标产品提交 `be6a45852f9992a688f33be933f444ee098fc67a`。
本地包/路径已改名，普通 merge-base 回到 Python 时代，不能直接整树覆盖；需按映射后的三方差异迁移，广告排除，保留本地协议保真、壁纸、俄语及上下文修复。
未完成逐项验证前不得宣称“全部同步完成”。
