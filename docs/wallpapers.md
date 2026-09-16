# 动态壁纸与对话配置修复

本功能从 Alunixa X v1.0.21 起提供；v1.0.22/v1.0.23 仍遗漏正式启动器的壁纸接口，可能报 `Unknown bridge path`，场景还会弹出独立窗口，因此请使用 v1.0.24 或更新版本，沿用普通图片覆盖层，不替换 DreamSkin 皮肤包喵~

## 使用方法

1. 打开 **皮肤管理 → 动态壁纸**，原“设置”页也提供相同控件喵~
2. 点击 **上传壁纸媒体** 选择图片或视频，或者点击 **选择项目目录** 选择一个包含 `project.json` 的 Wallpaper Engine 壁纸目录喵~
3. 设置透明度、适配方式、静音和暂停状态，点击 **保存设置** 喵~
4. 下次通过 v1.0.24 或更新版本的 Alunixa X 启动 Codex 时生效，保存不会热注入、替换或重启正在运行的窗口喵~
5. **重置背景** 仅重置壁纸相关设置，不重置供应商、对话或 DreamSkin 喵~

上传的媒体按原始字节复制到应用状态目录的 `wallpapers` 子目录，默认是 `$HOME/.codex-session-delete/wallpapers`；不会转码、压平动画或修改原文件，最大 2 GiB 喵~

## 支持范围

| 类型 | 行为 |
| --- | --- |
| PNG、JPEG、BMP、静态 WebP | 静态图片，保持原文件喵~ |
| GIF、APNG、动画 WebP | 保留动画帧，PNG 只有文件本身是 APNG 时才会动喵~ |
| MP4、M4V、WebM、MOV、OGV | 本地流式播放，支持循环、静音和暂停；能否解码取决于实际编码与内置浏览器，优先 MP4/H.264 或 WebM 喵~ |
| Wallpaper Engine Video | 使用 `project.json` 指向的视频，按视频壁纸播放喵~ |
| Wallpaper Engine Web | Windows 下由已安装的 Wallpaper Engine 自有独立窗口渲染，再捕获其画面，不在 Codex 内运行项目脚本喵~ |
| Wallpaper Engine Scene | Windows 下由已安装的 Wallpaper Engine 原生渲染独立窗口，再捕获该窗口的视频；支持 `scene.json` 位于 `scene.pkg` 内的 Workshop 目录喵~ |
| Wallpaper Engine Application | 不执行应用型壁纸喵~ |

请选择**单个壁纸目录**，不是整个 Steam、`workshop/content/431960` 或 Wallpaper Engine 安装目录；例如目录内有 `project.json`、`scene.pkg`、`preview.jpg` 的 Workshop 项目喵~

### 原生 Scene / Web

- 需要 Windows 和已安装、可用的 Wallpaper Engine，可从所选 Steam 库自动查找 `wallpaper64.exe` / `wallpaper32.exe`，也可手动指定喵~
- 使用唯一窗口名调用 `openWallpaper -playInWindow`，通过官方坐标参数从一开始就把窗口放在全部显示器范围之外，移除其任务栏项、不激活、不最小化；仅精确捕获该渲染窗口，不捕获桌面或其他应用喵~
- 不切换桌面壁纸、不发送全局停止命令；退出时只对自有窗口名调用 `closeWallpaper -location` 喵~
- 捕获上限为 1280×720、24 FPS；暂停按钮暂停 Codex 内的显示，不表示 Wallpaper Engine 底层渲染已停机喵~
- 原生场景的音频由 Wallpaper Engine 播放，静音设置通过该独立窗口的属性控制；捕获流自身不包含系统音频喵~
- 捕获接口或渲染窗口不可用时给出明确错误，不把 `preview.jpg` 当成场景播放成功喵~
- 开发验收使用独立 Electron 和自有命名 WE 窗口，不对用户当前运行的 Codex 热注入；同时检查实际画面/动画、窗口离屏坐标、无任务栏项、不抢焦点和捕获清理，不把目录解析或 sourceId 存在当成播放成功喵~

### Web 项目

v1.0.22 将 Web 项目交给 Wallpaper Engine 自身渲染，避免 Codex 的页面安全策略阻止脚本与本地资源，也保留引擎的 Web 宿主接口；项目网络和宿主能力由 Wallpaper Engine 管理，Codex 只接收自有窗口的视频，不给项目注入 Codex 桥接或访问任务内容的能力喵~

Scene 和 Web 原生项目仅支持 Windows 且需要 Wallpaper Engine；macOS 可使用图片、动图和 Video 项目，不宣称支持所有 Workshop 壁纸喵~

### 实际显示链路

- 大图和视频通过仅允许当前选中媒体的桥接，交给 Chromium 的磁盘后备 `File`，再创建 `blob:` 地址播放，支持原生按需读取和跳转，不把完整视频编码进配置或内存消息喵~
- Scene / Web 状态也走既有桥接，不再由 Codex 页面请求被 CSP 禁止的 localhost HTTP 接口；不放开 CSP、不关闭 webSecurity，也不靠刷新用户窗口修复喵~
- 正式数据启动器、核心启动器及 Electron 验证程序使用同一个 renderer bridge 安装入口，避免只在测试里接通接口、实际启动器却返回 `Unknown bridge path` 喵~
- 切换或关闭壁纸时撤销 Blob 地址、释放捕获轨道并移除临时文件 input；页面正常重新加载后由已启用的 Page agent 恢复注入喵~

### 只需要稳定图片背景

直接上传 PNG/JPEG/BMP/静态 WebP，不选择 Wallpaper Engine 项目；普通图片不会启动 Wallpaper Engine，也不需要场景捕获接口，透明度和原来的适配方式仍可使用喵~

如果使用 ZIP 升级，请完整替换同一版本的启动器、管理器及配套程序，再在方便时退出旧 Codex 并通过新版 Alunixa X 启动；仅打开新版管理器不会让旧启动器或旧 Codex 自动加载新代码，不需要删除任务或重置所有配置喵~

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

`tools/verify-wallpaper-electron.cjs` 是实际宿主门禁：用独立 Electron 可执行文件运行，传入 `--fixture <wallpaper_fixture绝对路径> --output <临时输出目录>`；Windows 额外传入 `--scene <project.json绝对路径> --engine <wallpaper64.exe绝对路径>` 验证真实原生项目，测试会定向回收自身窗口，不控制桌面壁纸喵~
