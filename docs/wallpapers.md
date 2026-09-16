# 动态壁纸与对话配置修复

本功能从 Alunixa X v1.0.21 起提供，沿用普通图片覆盖层，不替换 DreamSkin 皮肤包喵~

## 使用方法

1. 打开 **皮肤管理 → 动态壁纸**，原“设置”页也提供相同控件喵~
2. 点击 **上传壁纸媒体** 选择图片或视频，或者点击 **选择项目目录** 选择一个包含 `project.json` 的 Wallpaper Engine 壁纸目录喵~
3. 设置透明度、适配方式、静音和暂停状态，点击 **保存设置** 喵~
4. 下次通过 v1.0.21 或更新版本的 Alunixa X 启动 Codex 时生效，保存不会热注入、替换或重启正在运行的窗口喵~
5. **重置背景** 仅重置壁纸相关设置，不重置供应商、对话或 DreamSkin 喵~

上传的媒体按原始字节复制到应用状态目录的 `wallpapers` 子目录，默认是 `$HOME/.codex-session-delete/wallpapers`；不会转码、压平动画或修改原文件，最大 2 GiB 喵~

## 支持范围

| 类型 | 行为 |
| --- | --- |
| PNG、JPEG、BMP、静态 WebP | 静态图片，保持原文件喵~ |
| GIF、APNG、动画 WebP | 保留动画帧，PNG 只有文件本身是 APNG 时才会动喵~ |
| MP4、M4V、WebM、MOV、OGV | 本地流式播放，支持循环、静音和暂停；能否解码取决于实际编码与内置浏览器，优先 MP4/H.264 或 WebM 喵~ |
| Wallpaper Engine Video | 使用 `project.json` 指向的视频，按视频壁纸播放喵~ |
| Wallpaper Engine Web | 在无同源权限的 iframe 沙箱中运行，允许项目内脚本、样式、媒体和本地 JSON/着色器请求喵~ |
| Wallpaper Engine Scene | Windows 下由已安装的 Wallpaper Engine 原生渲染独立窗口，再捕获该窗口的视频；支持 `scene.json` 位于 `scene.pkg` 内的 Workshop 目录喵~ |
| Wallpaper Engine Application | 不执行应用型壁纸喵~ |

请选择**单个壁纸目录**，不是整个 Steam、`workshop/content/431960` 或 Wallpaper Engine 安装目录；例如目录内有 `project.json`、`scene.pkg`、`preview.jpg` 的 Workshop 项目喵~

### 原生 Scene

- 需要 Windows 和已安装、可用的 Wallpaper Engine，可从所选 Steam 库自动查找 `wallpaper64.exe` / `wallpaper32.exe`，也可手动指定喵~
- 使用唯一窗口名调用 `openWallpaper -playInWindow`，仅精确匹配并捕获该窗口，不捕获桌面或其他应用喵~
- 不切换桌面壁纸、不发送全局停止命令；退出时只对自有窗口名调用 `closeWallpaper -location` 喵~
- 捕获上限为 1280×720、24 FPS；暂停按钮暂停 Codex 内的显示，不表示 Wallpaper Engine 底层渲染已停机喵~
- 原生场景的音频由 Wallpaper Engine 播放，静音设置通过该独立窗口的属性控制；捕获流自身不包含系统音频喵~
- 捕获接口或渲染窗口不可用时给出明确错误，不把 `preview.jpg` 当成场景播放成功喵~
- 本轮有目录解析与脚本生命周期回归；未启动实际 Wallpaper Engine 渲染窗口，也未对当前运行的 Codex 做原生捕获验收喵~

### Web 项目

Web 项目只能从所选目录的只读资源路由加载文件，不能访问外部网络、Helper 其他接口、父页面 DOM、弹窗或启动程序；绝对路径、目录逃逸和越界链接被拒绝喵~

依赖 Wallpaper Engine 专有宿主接口、远程服务、应用启动、网络音频或其他被隔离能力的 Web 项目可能无法完整运行，不宣称兼容所有 Workshop 壁纸喵~

## `features.guardianv2` 报错

新任务的 `Error submitting message` 和旧任务的 `ChatGPT can't load config.toml` 都可能来自同一项 `FeatureToml` 类型错误，不需要删除对话记录喵~

- 在动态壁纸面板点击 **修复对话配置**，或者在新版 Alunixa X 保存设置、切换供应商或正常启动时触发兼容检查喵~
- 仅修正无效的 `guardianv2` 标量、未知或类型不符的结构化字段、嵌套字段和 profile 内对应项，保留合法的布尔开关、配置值、其他功能及注释喵~
- 修复前在对应 Codex home 的 `alunixa-x-config-repair-backups` 目录保存原始 TOML，备份失败则不覆盖配置；不会用默认配置覆盖整个文件喵~
- 保存供应商配置时也执行同样的定向校验，避免旧片段把错误再次写回喵~
- 修复后重新打开报错的任务；本轮开发测试只使用临时 `CODEX_HOME`，没有更改用户当前真实配置喵~
- 若 TOML 本身存在其他语法错误、错误位于项目级配置或其他来源，此修复不会伪装成已修好，需要按报错文件定位喵~

## 开发验证

```powershell
npm --prefix apps/alunixa-x-manager test
npm --prefix apps/alunixa-x-manager run check
npm --prefix apps/alunixa-x-manager run vite:build
cargo build -p alunixa-x-core --example wallpaper_fixture --locked -j 2
python tools/verify-wallpaper-ui.py --codex "绝对路径\codex.exe"
cargo test --workspace --locked --no-fail-fast -j 2 -- --test-threads=1
```

浏览器验证使用真实 Chromium 和 Rust 临时媒体服务，管理器 Tauri 命令由内存 fixture 提供；可选 `--codex` 使用已安装 CLI 在临时 home 验证修复前失败、修复后解析成功，不登录账户或发送模型请求喵~
