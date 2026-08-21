<p align="center">
  <img src="assets/brand/alunixa-x-icon.png" alt="Alunixa X" width="148">
</p>

<h1 align="center">Alunixa X</h1>

<p align="center"><strong>AI Agent Control System</strong></p>

<p align="center">把模型、供应商、工具、自动化、连接与 Codex 桌面运行时接入同一条控制轨道。</p>

<p align="center">
  中文 · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/github/v/release/Alunixa-Code/Alunixa-X">
  <img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Alunixa-Code/Alunixa-X/pr-build.yml?branch=main">
  <img alt="License" src="https://img.shields.io/github/license/Alunixa-Code/Alunixa-X">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-2024-111827">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-43DCFF">
</p>

<p align="center">
  <img src="assets/brand/alunixa-x-social.png" alt="Alunixa X — AI Agent Control System" width="860">
</p>

## Alunixa X 是什么

Alunixa X 是面向桌面 AI Agent 的跨平台控制系统。当前版本重点连接 OpenAI Codex / ChatGPT Desktop，在不替换官方应用原始渲染器和 `app.asar` 的前提下，通过外部启动器、CDP、本地 helper 与协议代理提供统一管理能力。

它不是简单的模型切换器，也不是一套只会改配置文件的皮肤。Alunixa X 把下面这些链路放进同一个桌面界面：

```text
供应商 → 模型 → 上下文 → MCP / Skills / Plugins → Codex → 桌面运行时
```

## 核心能力

| 控制面 | 能力 |
| --- | --- |
| Agent Rail | 在概览页连续展示供应商、模型、工具、Codex 与本地运行时状态 |
| 供应商网络 | 官方登录、混合 API、纯 API、聚合轮转、单模型路由、Provider Doctor |
| 模型目录 | 每模型上下文窗口、自动压缩 Token 阈值、思考等级、图片处理方式 |
| 全端点代理 | `/v1/**` HTTP、SSE、二进制、multipart、大文件和 Realtime WebSocket |
| 图片工具 | 独立 `image_gen` MCP，支持生成、编辑、多图、mask 与本地结果保存 |
| Agent 能力 | 共享终端、会话操作、导出、项目移动、Stepwise、记忆、Goals 与用户脚本 |
| 连接中心 | Remote Control、个人微信连接、Zed Remote 与已有会话恢复 |
| 扩展系统 | MCP、Skills、Plugins、脚本市场和 DreamSkin 主题市场 |
| 运行维护 | 启动注入、失败关闭、Watcher、环境诊断、日志、更新与跨平台安装包 |

## 下载与安装

从 [GitHub Releases](https://github.com/Alunixa-Code/Alunixa-X/releases/latest) 下载对应平台的正式包：

- Windows：`Alunixa-X-*-windows-x64-setup.exe`
- macOS Intel：`Alunixa-X-*-macos-x64.dmg`
- macOS Apple Silicon：`Alunixa-X-*-macos-arm64.dmg`

安装后会出现两个入口：

- **Alunixa X**：打开主控制台，用于配置、诊断、更新和管理全部能力。
- **Alunixa X Launch**：按照已保存配置启动并接管 Codex Desktop。

首次使用建议先打开 **Alunixa X**，确认 Codex 应用路径、供应商和模型，然后点击概览页的“启动 Agent 轨道”。

## 数据与隐私

Alunixa X 默认在本机处理配置、密钥、会话索引和运行日志：

- Codex 配置：`~/.codex/config.toml`
- Codex 登录状态：`~/.codex/auth.json`
- Alunixa X 状态：`~/.codex-session-delete/`
- 生成图片：`$CODEX_HOME/generated_images/`
- Provider 同步备份：`~/.codex/backups_state/provider-sync/`

API Key 不应写入 Issue、截图或公开日志。推荐内容、匿名使用统计和 Alunixa 在线目录将在具备清晰开关与隐私说明后接入，不以采集提示词、聊天内容、文件内容或终端输出为前提。

## 开发

```powershell
cd apps/alunixa-x-manager
npm ci
npm test
npm run check
npm run vite:build

cd ../..
cargo fmt --all -- --check
cargo test --workspace -- --test-threads=1
cargo build --release
```

主要目录如下：

```text
apps/
  alunixa-x-launcher/       后台启动与 image_gen companion
  alunixa-x-manager/        Tauri / React 主控制台
crates/
  alunixa-x-core/           启动、注入、代理、安装与配置核心
  alunixa-x-data/           会话、导出与 Provider Sync
assets/
  brand/                    Alunixa X 品牌资产
  inject/                   Codex renderer 增强脚本
scripts/installer/          Windows NSIS 与 macOS DMG 打包
```

## 项目与反馈

- 项目主页：https://github.com/Alunixa-Code/Alunixa-X
- 问题反馈：https://github.com/Alunixa-Code/Alunixa-X/issues
- 讨论区：https://github.com/Alunixa-Code/Alunixa-X/discussions

如果 Alunixa X 帮到了你，可以支持项目持续维护：

<p align="center">
  <img src="assets/images/sponsor-alipay.jpg" alt="支付宝赞赏码" width="210">
  <img src="assets/images/sponsor-wechat.jpg" alt="微信赞赏码" width="210">
</p>

## 开源与兼容性

Alunixa X 以 [GNU Affero General Public License v3.0](LICENSE) 发布，SPDX 标识为 `AGPL-3.0-only`。本项目包含从 CodexPlusPlus 及其贡献历史演进而来的代码，相关原始版权与许可证声明继续保留；Alunixa X 新增与修改部分由 Alunixa-Code 维护。

Alunixa X 是独立第三方项目，不隶属于 OpenAI，也不授予 OpenAI、ChatGPT、Codex 或其他第三方商标和资源的权利。Codex Desktop 更新可能改变页面、CDP 或本地数据契约，届时相关集成功能需要跟随适配。
