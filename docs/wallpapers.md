# 图片、动图与视频背景

请使用 **Alunixa X v1.0.24 或更新版本**；v1.0.22/v1.0.23 正式启动器漏接媒体接口，可能报 `Unknown bridge path`，而原生场景会创建额外 Wallpaper Engine 窗口喵~

按用户“稳定优先，必要时回退图片背景”的要求，**原生 Wallpaper Engine Scene/Web 启动和捕获已移除**；没有引擎窗口、进程启动、场景脚本执行或桌面捕获，俄语界面和其他增强功能不回退喵~

## 使用方法

1. 打开 **皮肤管理 → 动态壁纸**，原“设置”页也提供相同控件喵~
2. 点击 **上传壁纸媒体**，选择图片、动图或本地视频，不再提供项目目录或引擎程序选择器喵~
3. 打开启用开关，设置透明度和适配方式；视频可设置静音、暂停或继续，预览始终静音喵~
4. 点击 **保存设置**，在方便时退出旧 Codex，再通过新版 Alunixa X 启动；保存本身不热替换、不重启正在使用的任务喵~
5. **重置背景** 仅重置背景设置，不重置供应商、任务或 DreamSkin 喵~

只需要原来的静态图片，直接上传 PNG/JPEG/BMP/静态 WebP，不必配置任何引擎，也无需启用视频喵~

## 支持范围

| 类型 | 行为 |
| --- | --- |
| PNG、JPEG、BMP、静态 WebP | 保持原图，使用原有透明覆盖层和适配方式喵~ |
| GIF、APNG、动画 WebP | 保留原始动画，普通 PNG 不会自动变成动态图片喵~ |
| MP4、M4V、WebM、MOV、OGV | 原生媒体播放器循环、静音、暂停；实际取决于编码，优先 H.264 MP4 或 WebM 喵~ |
| 旧 Wallpaper Engine Video 配置 | 仅兼容读取其已有视频路径，不启动引擎；新设置直接选择视频文件喵~ |
| 旧 Wallpaper Engine Scene/Web 配置 | 只读取项目内的预览图片，标注“静态预览”，不运行场景或网页脚本喵~ |
| Wallpaper Engine Application | 不执行喵~ |

上传媒体按原始字节复制到 `$HOME/.codex-session-delete/wallpapers`，最大 2 GiB，不转码、不压平 GIF/APNG、不修改源文件喵~

## 旧场景设置如何处理

- 保留用户原有项目路径，不篡改 `project.json`、归档或桌面设置喵~
- 有有效 `preview` 图片时使用它；未指定时查找项目内常规 `preview.jpg/png/jpeg/webp`，界面明确显示“旧场景只显示预览图片，不运行场景”喵~
- 没有预览图、预览路径越界或指向脚本/非图片时不加载，提示上传图片或视频，不启动 Wallpaper Engine“补救”喵~
- 旧的引擎程序路径仅为兼容保存而保留，已不参与启动、校验或播放，用户不必手动删除这个字段喵~
- 已在旧版运行的 Codex/引擎进程不会被本次开发擅自关闭；安装完整新版并重新通过 Alunixa X 启动后，新的启动路径不再创建引擎窗口喵~

## 实际显示与验证

- 正式数据启动器、核心启动器和实播 fixture 共用同一个 renderer bridge 安装入口，修复“测试有接口、正式程序却 Unknown bridge path”的根因喵~
- 小图片保留原 data URI 路径，大图/视频使用仅限选中媒体的磁盘后备 File/Blob，不读取任意路径、不嵌入整段视频、不放开 Codex CSP 喵~
- 关闭或切换壁纸时释放 Blob、视频源和临时 input；正常页面导航后恢复注入，不把“创建了节点”当作实际显示成功喵~
- 原生场景离屏实验虽然不再可见，但实际 Web 画面为黑，因此已撤下，不发布该实验；静态预览是明确降级，不是动态场景成功的替代证据喵~

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

`tools/verify-wallpaper-electron.cjs` 使用独立 Electron 和正式启动器相同的媒体桥接，传入 `--fixture <wallpaper_fixture绝对路径> --output <临时输出目录>`；验证图片解码、动画帧、视频跳转/循环及旧项目的明确预览降级，不启动 Wallpaper Engine 喵~

`--self-test-failure` 专门验证失败时返回非零退出码；验收同时要求退出码为 0 且出现 `ELECTRON_WALLPAPER_PASS`，不能只看构建成功或退出码喵~
