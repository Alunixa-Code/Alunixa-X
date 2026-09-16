<p align="center">
  <img src="assets/brand/alunixa-x-icon.png" alt="Alunixa X" width="148">
</p>

<h1 align="center">Alunixa X</h1>

<p align="center"><strong>AI Agent Control System</strong></p>

<p align="center">把模型、供应商、工具、自动化、连接与 Codex 桌面运行时接入同一条控制轨道。</p>

<p align="center">
  中文 · <a href="README_EN.md">English</a> · <a href="README_RU.md">Русский</a>
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

<p align="center">
  <img src="docs/images/alunixa-x-dashboard.png" alt="Alunixa X Agent Rail 控制台" width="1000">
</p>

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
| 图片工具 | 独立 `image_gen` MCP，多组 API/Key/Model、拖拽设置默认模型，支持生成、编辑、多图、mask 与本地保存 |
| Agent 能力 | 共享终端、会话操作、导出、项目移动、Stepwise、记忆、Goals 与用户脚本 |
| 连接中心 | Remote Control、个人微信连接、Zed Remote 与已有会话恢复 |
| 扩展系统 | MCP、Skills、Plugins、脚本市场和 DreamSkin 主题市场 |
| 运行维护 | 启动注入、失败关闭、Watcher、环境诊断、日志、更新与跨平台安装包 |

## 阅读导航

- [下载与安装](#下载与安装)：平台、安装包和首次启动。
- [界面语言](#界面语言)：简体中文、英语和俄语。
- [从零完成首次配置](#从零完成首次配置)：应用路径、账号、供应商与模型。
- [供应商与协议](#供应商与协议)：模式差异、聚合策略、代理边界。
- [模型与上下文](#模型与上下文)：启动模型、窗口、自动压缩、思考与视觉。
- [配置默认生图模型](#配置默认生图模型)：独立图片 API 与 MCP。
- [动态壁纸](docs/wallpapers.md)：图片、视频、Wallpaper Engine 与配置修复。
- [功能分区详解](#功能分区详解)、[常见问题](#常见问题)、[数据与隐私](#数据与隐私)、[开发](#开发)。

## 下载与安装

从 [GitHub Releases](https://github.com/Alunixa-Code/Alunixa-X/releases/latest) 下载对应平台的正式包：

- Windows：`Alunixa-X-*-windows-x64-setup.exe`
- macOS Intel：`Alunixa-X-*-macos-x64.dmg`
- macOS Apple Silicon：`Alunixa-X-*-macos-arm64.dmg`

| 平台 | 推荐安装包 | 便携/手动分发包 |
| --- | --- | --- |
| Windows x64 | `windows-x64-setup.exe` | `windows-x64.zip` |
| macOS Intel | `macos-x64.dmg` | `macos-x64.zip` |
| macOS Apple Silicon | `macos-arm64.dmg` | `macos-arm64.zip` |

Windows 使用安装向导；macOS 打开 DMG，将两个应用拖入“应用程序”。ZIP 用于手动部署，解压后保留 launcher、manager、imagegen MCP 三个二进制之间的同级关系，不能只复制其中一个。当前正式发布不提供 Linux 安装包。

Alunixa X 不包含 Codex 本体或 Wallpaper Engine。使用前先安装可运行的 Codex 桌面应用；原生 Scene/Web 壁纸另需 Windows 版 Wallpaper Engine。Windows 管理器基于 WebView2，开发构建还需要 Rust/MSVC 和前端工具链。

安装后会出现两个入口：

- **Alunixa X**：打开主控制台，用于配置、诊断、更新和管理全部能力。
- **Alunixa X Launch**：按照已保存配置启动并接管 Codex Desktop。

首次使用建议先打开 **Alunixa X**，确认 Codex 应用路径、供应商和模型，然后点击概览页的“启动 Agent 轨道”。

安装新版后，Windows 开始菜单还会创建 **AX - Alunixa X** 与 **AX Launch - Alunixa X** 搜索入口；macOS 的应用文件名和显示名为 **Alunixa X (AX)** 与 **Alunixa X Launch (AX)**，安装到“应用程序”后可用 `AX` 搜索，旧名称仍兼容喵~

## 界面语言

v1.0.23 增加俄语。右上角的语言下拉框可以直接选择 **简体中文 / English / Русский**，无需反复点击轮换。

- 翻译范围包括管理器导航、配置页面、动态壁纸、生图模型、提示框、现有可识别的后端消息、托盘“显示窗口/退出”和本地化日期。
- 选择保存在管理器 WebView 的本地存储中，重新打开仍然有效；首次启动和无效旧值继续默认中文。
- 切换前会确认，因为管理器页面需要重新加载，未保存的编辑会丢失；取消则保持原语言，存储失败不会强行刷新。
- **这不是 Codex 原生界面的俄语语言包**，不会改 `config.toml` 或“强制中文界面”设置；API 错误原文、用户模型名称、脚本内容和第三方社区内容不作机器翻译。
- [Русское руководство / 完整俄语介绍](README_RU.md) 与 [English guide](README_EN.md) 均包含安装、操作、功能边界和排错说明。

## 从零完成首次配置

1. **打开管理器**：运行 Alunixa X，而不是先打开官方 Codex 快捷方式；在概览中检查应用、启动入口和运行状态。
2. **确认 Codex 路径**：自动检测成功可直接使用；便携版、解压版或多份安装可在设置中选择 `Codex.exe`、`Codex.app` 或应用目录并保存，后续启动复用该路径。
3. **选择接入方式**：官方账号用户使用官方登录；自备 API 用户添加供应商，填写 Base URL、API Key 和服务端真实支持的模型名称，选对上游协议。
4. **配置模型**：拉取或手工填写模型列表，明确选择启动模型；如需自定义上下文窗口、自动压缩和思考等级，在对应模型中设置。
5. **检查总开关并保存**：开启需要的增强功能；需要接管供应商时还要开启供应商配置总开关。开关关闭时只保存配置，不写入 Codex 当前配置。
6. **验证供应商**：先用“测试此模型”或 Provider Doctor 检查配置、模型列表和真实请求，再进入实际对话。
7. **启动 Codex**：点击“启动 Agent 轨道”或使用 Alunixa X Launch。下次启动型配置需要在保存后重新通过此入口启动；不要把“保存成功”理解为已改写当前窗口。

切换供应商可能触发真实配置写入；首次启用需要本地协议代理的功能会显示专门的重启确认。单纯切换管理器语言不会重启 Codex。

## 供应商与协议

### 三种接入模式

| 模式 | 适合谁 | 配置行为 |
| --- | --- | --- |
| 官方登录 | 使用官方 ChatGPT 账号 | 保持官方认证，不额外写入纯 API Key |
| 官方混合 API | 保留官方登录，同时使用自备 API | 保留账号链路，将 API 请求接入所选供应商，需正确填写其地址和 Key |
| 纯 API | 使用第三方或自托管模型服务 | 写入受管 `config.toml` / `auth.json`，通过供应商与模型目录控制请求 |

供应商配置可新增、编辑、拖拽排序、测试、导入 cc-switch，并生成切换前预览。环境检测会检查可能覆盖受管配置的变量、Codex `.env` 和 Clash Verge Rev TUN 状态；删除变量须由用户确认，`CODEX_HOME` 不属于自动清理对象。

### 路由、聚合与协议保真

- **单模型路由**：精确匹配模型名称，使用目标供应商的地址与 Key；目标须为 Responses API，不指向自身或另一个聚合供应商。
- **聚合供应商**：引用已有 API 供应商，不复制其密钥；支持按请求轮转、按对话固定、权重分配和故障转移。策略与成员能力需要配套选择。
- **本地协议代理**：接入 Responses、Chat Completions、旧 Completions、Anthropic 和 Gemini；相同协议的端点转发支持 HTTP/SSE、二进制、multipart 与 Realtime WebSocket 等路径。
- **不是任意协议的无损万能转换器**：对不能等价表示的工具、签名历史、私有字段或不完整流明确报错，不通过删除内容冒充成功，也不重放结果不明的请求。

完整支持矩阵、回放格式与错误边界见 [协议保真说明](docs/protocol-fidelity.md)。

## 模型与上下文

- **启动模型**是根 `config.toml` 中上下文窗口和自动压缩阈值的来源。调整另一模型的窗口只更新模型目录，不会悄悄切换启动模型。
- **上下文窗口**可按模型设置；自动压缩阈值必须是正整数且不大于窗口，关闭自动压缩时不写入受管阈值。
- **思考等级**可按供应商、按模型设定上限；它依赖真实上游能力，不会凭空赋予模型不支持的推理档位。
- **图片输入**可保持原图、剔除图片或先由独立 VLM 解析；启用 VLM 时须同时配置其 API、Key 和模型。
- **统计**读取本机任务 rollout 中的 Token 与模型调用记录，不等同于服务商账单，也不是所有云端任务的完整统计。

### 配置默认生图模型

打开左侧 **生图模型**，添加兼容 OpenAI Images 的 **API 地址、API Key、Model**；可保存多组，拖动手柄上下排列，最上方带 **默认** 标记的配置就是 MCP 默认模型，排序自动保存喵~

- API 地址可填基础地址或 `/images/generations`、`/images/edits` 完整地址，生成和编辑请求使用所选配置的同一 API/Key/Model，不改变对话供应商喵~
- 编辑已有配置时 Key 留空保留原值，列表不显示 Key；多个窗口发生修改冲突时要求刷新，不覆盖其他窗口的新配置喵~
- 首次使用保持增强功能开启，并通过 Alunixa X 启动 Codex 加载 MCP；已经加载的新版 MCP 每次调用重新读取配置，后续保存或排序无需重启喵~
- MCP 不显式传 `model` / `profile_id` 时使用首项；清空全部生图配置后恢复原对话供应商及原默认生图模型，不自动重试或轮换到其他生图配置喵~

### 动态壁纸（请使用 v1.0.24 或更新版本）

**皮肤管理 → 动态壁纸** 支持上传视频、GIF、APNG 和图片，提供预览、透明度、适配、静音与暂停；v1.0.24 修复正式启动器遗漏壁纸接口导致的 `Unknown bridge path`，不再由测试程序单独接线；大图/视频使用磁盘后备 File/Blob，Scene / Web 在 Windows 上使用 Wallpaper Engine 离屏渲染，不应弹出额外可见窗口或抢焦点喵~

面板的 **修复对话配置** 可定向备份并修复 `features.guardianv2` 类型错误；保存后下次通过 v1.0.24 或更新版本的 Alunixa X 启动时应用壁纸，不打断当前 Codex，完整使用说明与兼容边界见 [动态壁纸说明](docs/wallpapers.md) 喵~

只想用原来的图片背景，直接上传 PNG/JPEG 等图片即可，不依赖也不会启动 Wallpaper Engine；不必启用视频或场景喵~

| 壁纸类型 | Windows | macOS | 条件与边界 |
| --- | --- | --- | --- |
| PNG/JPEG/BMP/静态 WebP | 支持 | 支持 | 保持原图，不把普通 PNG 自动变成动画 |
| GIF/APNG/动画 WebP | 支持 | 支持 | 文件本身包含动画帧 |
| MP4/M4V/WebM/MOV/OGV | 支持 | 支持 | 最大 2 GiB，实际取决于视频编码，优先 H.264 MP4 或 WebM |
| Wallpaper Engine Video | 支持 | 支持 | 读取单项目 `project.json` 所指视频 |
| Wallpaper Engine Scene / Web | 支持 | 不支持 | 需安装 WE，原生独立窗口渲染和捕获 |
| Wallpaper Engine Application | 不执行 | 不执行 | 不是任意可执行壁纸启动器 |

选择 **单个含 `project.json` 的壁纸目录**，不是整个 Steam Workshop 库。Scene 支持资源打包在 `scene.pkg` 的项目，原生捕获上限为 1280×720、24 FPS；暂停只暂停 Codex 画面，不保证引擎停止渲染。上传文件保留原始字节，WE 项目按路径引用，移动或删除原项目后需重新选择。

## 功能分区详解

| 页面/能力 | 用途 | 使用前提 |
| --- | --- | --- |
| 概览 | 查看供应商→模型→工具→Codex→运行时链路及用量 | 统计来自本地数据，运行状态在启动后更新 |
| 会话管理 | 查看、导出 Markdown、删除、项目迁移、历史归属修复 | 破坏性操作先确认并按功能创建备份；占用文件可能跳过 |
| 图片空间清理 | 外置已被后续压缩点覆盖的旧 Base64 图片，可恢复 | 不处理当前有效恢复上下文；运行中只检查允许范围 |
| 工具与插件 | 独立管理 MCP、Skills、Plugins，供应商切换时合并 | 外部工具仍需其自身依赖和凭据 |
| Agent 能力 | 共享终端、粘贴修复、滚动位置、会话菜单、Fast、Goals | 不同开关可能要求下次启动，具体看界面说明 |
| Stepwise / 记忆 | 独立 API 生成后续建议；本地记忆检索 | Stepwise 需配置 API；记忆支持 embedding 或 BM25 回退 |
| 生图模型 | 为 `image_gen` MCP 配置独立图片服务和默认顺序 | API 必须兼容 OpenAI Images；首次需启动加载 MCP |
| 手机远控 | 账号登录、官方远控状态、配对码、设备撤销 | 依赖官方账号、服务和客户端的可用能力 |
| 微信连接 | 联系人映射独立 Codex 任务，接收执行进度 | 需扫码登录、配置 CLI/工作目录与访问范围 |
| Zed 远程项目 | 管理 SSH 项目和 `ssh://` 打开方式 | 需可用 Zed Remote 与已有 SSH 环境 |
| 皮肤管理 | DreamSkin 本地/社区/ZIP 主题与独立动态壁纸 | 主题包与普通壁纸不是同一套功能 |
| 安装维护/关于 | 快捷方式、Watcher、更新、日志和诊断 | 安装动作需对应系统权限 |

## 更新、备份与回退

1. 在“关于”检查 GitHub Releases，或手动下载对应平台正式包。更新功能下载并启动安装器，不代表当前 Codex 已加载新功能。
2. 大版本迁移、换机或大量改配置前导出完整配置。**完整备份包含 API Key、登录数据和脚本**；普通界面脱敏不等于备份也脱敏。
3. 需要恢复时使用“导入完整配置”或对应功能的恢复入口，先确认当前任务与应用文件没有被占用。
4. 需要回退程序时从历史 Release 获取对应平台安装包，保留配置备份；不要删除任务数据库来解决界面或壁纸问题。

正式发行由同一不可变标签经 GitHub Actions 构建 Windows x64、macOS x64/arm64，发布六项安装/ZIP 资产。Release 正文列出变更、源码提交、运行来源与 SHA-256；历史标签不用于覆盖新修复。

## 常见问题

**俄语在哪里？为什么 Codex 内还是原来的语言？**

管理器右上角选择 `Русский`。俄语覆盖 Alunixa X 管理器，不替换 Codex 官方语言包；“强制中文界面”仍是独立开关。

**保存供应商后重启仍未生效？**

确认供应商配置总开关开启、当前供应商正确、保存成功，并从 Alunixa X Launch 启动。检查环境变量或 `.env` 是否覆盖了 `config.toml`。

**视频预览能播，Codex 背景却没有？**

使用 v1.0.24 或更新版本，确认启用壁纸且透明度不是零，保存后重新经 Alunixa X 启动；检查“关于”的诊断。v1.0.22/v1.0.23 的 `Unknown bridge path` 是正式启动器漏接接口，不是目录选错；管理器预览不是宿主显示成功的证明。

**Wallpaper Engine 目录选了却没有场景？**

选单个含 `project.json` 的目录；Scene/Web 只支持 Windows，确认 WE 程序路径。Video 与原生 Scene/Web 路径不同，`preview.jpg` 不算场景播放成功。

**新任务发送报 `FeatureToml`，旧任务不能恢复？**

若错误明确指向 `features.guardianv2`，使用“修复对话配置”，修复前保留原 TOML 备份，之后重新打开任务。它不修复所有 TOML 语法错误、项目级配置或其他来源。

**生图模型改了但没切换？**

默认是列表首项；显式 `profile_id` 或 `model` 会影响选择。确认首次已通过 Alunixa X 加载 MCP；后续排序和保存不需要重新加载已经运行的新版 MCP。

**怎么提交可用的错误报告？**

附上 Alunixa X/Codex 版本、系统架构、操作步骤、预期/实际行为与脱敏诊断。壁纸问题补充文件类型/编码或项目类型，不提交密钥、完整 `auth.json` 或私有任务内容。

## 从 Codex+++ 迁移

旧 `Alunixa-Code/CodexPlusPlusPlus` 仓库已经归档，最终桥接版本为 `v1.2.67`。现有用户可以在“Codex++ 管理工具 → 关于 → 迁移到 Alunixa X”中自主下载安装 Alunixa X，也可以从 [Codex+++ v1.2.67 最终 Release](https://github.com/Alunixa-Code/CodexPlusPlusPlus/releases/tag/v1.2.67) 直接下载 `Alunixa-X-1.0.6-*` 迁移包。

Codex+++ 与 Alunixa X 继续复用 `~/.codex-session-delete/settings.json`，供应商、模型和增强设置无需手工复制。迁移不会强制卸载旧程序，建议先验证 Alunixa X 正常，再自行卸载 Codex+++。

## 数据与隐私

Alunixa X 默认在本机处理配置、密钥、会话索引和运行日志：

- Codex 配置：`~/.codex/config.toml`
- Codex 登录状态：`~/.codex/auth.json`
- Alunixa X 状态：`~/.codex-session-delete/`
- 生成图片：`$CODEX_HOME/generated_images/`
- Provider 同步备份：`~/.codex/backups_state/provider-sync/`

设置了 `CODEX_HOME` 时，Codex 配置与生成图片使用所选 home；Alunixa X 管理器状态仍使用自己的应用状态目录。上传壁纸位于该状态目录的 `wallpapers/`；guardian 修复备份位于所用 Codex home 的 `alunixa-x-config-repair-backups/`。界面语言单独保存在 WebView 本地存储，不写入供应商配置。

本地处理不代表所有功能离线：模型请求会发往用户配置的上游，更新与在线目录会联网，微信、远控和 WE Web 项目也使用其各自网络环境。

API Key 不应写入 Issue、截图或公开日志。推荐内容、匿名使用统计和 Alunixa 在线目录将在具备清晰开关与隐私说明后接入，不以采集提示词、聊天内容、文件内容或终端输出为前提。

## 开发

技术栈为 Rust edition 2024、Tauri 2、React 19、TypeScript 5 和 Vite 6；正式 CI 使用 Node.js 22。使用仓库锁文件，不必为增加翻译升级第三方依赖。

开发前安装 Node.js/npm、Rust stable，以及 [Tauri 平台前置依赖](https://v2.tauri.app/start/prerequisites/)：Windows 使用 MSVC 构建工具/WebView2，macOS 使用 Xcode Command Line Tools。正式 Windows 打包用 NSIS，macOS 打包在对应平台完成，不使用 WSL。

```powershell
npm --prefix apps/alunixa-x-manager ci
npm --prefix apps/alunixa-x-manager test
npm --prefix apps/alunixa-x-manager run check
npm --prefix apps/alunixa-x-manager run vite:build
node tools/i18n-verify.mjs
node tools/check-local-branding.mjs
cargo fmt --all -- --check
cargo test --workspace --locked --no-fail-fast -- --test-threads=1
cargo check --workspace --all-targets --locked
cargo build --release --locked
```

运行开发管理器：`npm --prefix apps/alunixa-x-manager run dev`。`vite:dev` 只启动前端，真实管理器命令需要 Tauri，浏览器 smoke 则必须提供隔离的 Tauri fixture。

翻译维护入口为 `src/i18n.ts`、`src/i18n-en.ts` 和 `src/i18n-ru.ts`，均位于管理器目录；新增 `t()/tf()` 文案须同时补齐两份词典。`node tools/i18n-verify.mjs` 会检查全部生产 TS/TSX 调用、陈旧/缺失键、参数占位符与后端正则对齐。

已构建前端并准备 Python Playwright/Chromium 后，可运行 `python tools/verify-russian-ui.py` 验证生产页面、持久化切换、深浅主题和长文案布局。它使用内存 Tauri fixture，不修改真实配置或正在运行的 Codex；壁纸的实际 Electron/WE 播放测试另见专项文档。

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
