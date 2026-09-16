<p align="center">
  <img src="assets/brand/alunixa-x-icon.png" alt="Alunixa X" width="148">
</p>

<h1 align="center">Alunixa X</h1>

<p align="center"><strong>AI Agent Control System</strong></p>

<p align="center">Connect models, providers, tools, automation, integrations, and the Codex desktop runtime on one control rail.</p>

<p align="center">
  <a href="README.md">中文</a> · English · <a href="README_RU.md">Русский</a>
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

## What is Alunixa X

Alunixa X is a cross-platform control system for desktop AI agents. The current release focuses on OpenAI Codex / ChatGPT Desktop and adds a unified external launcher, CDP bridge, local helper, protocol proxy, and management interface without replacing the official renderer or patching `app.asar`.

<p align="center">
  <img src="docs/images/alunixa-x-dashboard.png" alt="Alunixa X Agent Rail dashboard" width="1000">
</p>

```text
Provider → Model → Context → MCP / Skills / Plugins → Codex → Desktop runtime
```

## Highlights

| Surface | Capabilities |
| --- | --- |
| Agent Rail | Continuous provider, model, tool, Codex, and runtime status on the overview screen |
| Provider network | Official, mixed API, pure API, aggregate rotation, per-model routing, Provider Doctor |
| Model catalog | Per-model context windows, auto-compaction token limits, reasoning levels, image handling |
| Full endpoint proxy | `/v1/**` HTTP, SSE, binary, multipart, large bodies, and Realtime WebSocket |
| Image tool | Standalone `image_gen` MCP, multiple API/Key/Model profiles, drag-to-set default, generation, edits, masks, and local outputs |
| Agent capabilities | Shared terminal, session operations, export, project move, Stepwise, memory, Goals, and scripts |
| Connections | Remote Control, personal WeChat, Zed Remote, and existing-session recovery |
| Extensions | MCP, Skills, Plugins, script marketplace, and DreamSkin themes |
| Operations | Startup injection, fail-closed validation, Watcher, diagnostics, updates, and installers |

### Live wallpapers (use v1.0.22 or later)

**Themes → Live Wallpaper** accepts videos, GIF/APNG animations, and still images with preview, opacity, fit, mute, and pause controls. Version 1.0.22 fixes host-CSP playback failures using disk-backed File/Blob media without relaxing CSP or reloading Codex. Wallpaper Engine Video projects use the video player; Scene and Web projects use an owned native engine window on Windows. See [wallpaper documentation and compatibility limits](docs/wallpapers.md).

The panel also provides a narrow, backed-up repair for malformed `features.guardianv2` configuration. Saved wallpapers apply on the next launch through Alunixa X v1.0.22 or later; the current Codex process is not restarted or patched.

## Install

Download a platform build from [GitHub Releases](https://github.com/Alunixa-Code/Alunixa-X/releases/latest):

- Windows: `Alunixa-X-*-windows-x64-setup.exe`
- macOS Intel: `Alunixa-X-*-macos-x64.dmg`
- macOS Apple Silicon: `Alunixa-X-*-macos-arm64.dmg`

ZIP packages are also published for each architecture. Keep the launcher, manager, and image-generation MCP companion together when deploying them manually. The DMG contains both applications; drag them into Applications. No Linux installer is currently published.

Install a working Codex desktop application separately; Alunixa X does not bundle it. Windows uses WebView2. Wallpaper Engine is optional and must be installed separately for native Scene/Web projects on Windows.

The installer creates two entries:

- **Alunixa X** opens the main control system.
- **Alunixa X Launch** starts Codex Desktop with the saved provider and agent configuration.

Windows also creates **AX - Alunixa X** and **AX Launch - Alunixa X** Start menu entries; macOS bundles are named **Alunixa X (AX)** and **Alunixa X Launch (AX)**, so installed apps can be found by searching `AX`, while legacy bundle names remain supported 喵~

## Interface languages

Starting with v1.0.23, choose **简体中文 / English / Русский** directly from the selector at the top right. Navigation, settings, wallpaper controls, image models, dialogs, recognized backend messages, tray labels, and dates use the selected language.

The choice persists in the manager WebView's local storage. Changing it requires confirmation and reloads the manager, so save edits first. Cancelling keeps the current language; unavailable storage does not trigger a destructive reload. Existing Chinese and English preferences remain valid, with Chinese as the first-run fallback.

**This localizes the Alunixa X manager, not the official Codex interface.** It neither changes `config.toml` nor changes the independent “Force Chinese UI” option. User names, model IDs, raw upstream diagnostics, scripts, and third-party community content are not machine-translated. A complete [Russian guide](README_RU.md) is available.

## First-run walkthrough

1. Open **Alunixa X** and inspect the overview, rather than launching the official Codex shortcut first.
2. Check the detected Codex path. For a portable build or multiple installations, select the executable/application directory and save it for later launches.
3. Choose official login, mixed API, or pure API. For API providers, supply the actual base URL, key, model IDs, and correct upstream protocol.
4. Fetch or enter the model list, choose the startup model explicitly, then configure per-model context, auto-compaction, and reasoning if needed.
5. Save and check both master switches: enhancements and provider configuration are separate. A disabled provider switch stores edits without applying them to Codex.
6. Use the model test or **Provider Doctor** to check configuration, `/v1/models`, and a real request before starting a conversation.
7. Launch using **Alunixa X Launch** or the overview launch button. Settings marked as next-launch changes do not rewrite an already running Codex window.

Provider switching can write the active Codex configuration. Enabling features that first require the local protocol proxy shows a separate restart confirmation. Changing the manager language does not restart Codex.

## Providers and protocol routing

| Mode | Purpose | Behavior |
| --- | --- | --- |
| Official login | Use a ChatGPT account | Retains official authentication without adding a pure API key |
| Official mixed API | Keep account integration and use a configured API | Combines the existing official login path with the chosen API provider |
| Pure API | Use a third-party or self-hosted service | Writes managed `config.toml` / `auth.json` and provider/model settings |

Providers can be edited, reordered, tested, imported from cc-switch, and previewed before switching. Environment diagnostics check overriding variables, Codex `.env`, and Clash Verge Rev TUN state. Removing variables requires confirmation and does not remove `CODEX_HOME`.

- **Per-model routing** matches model IDs exactly and uses the target provider's URL and key. Targets must support Responses API and cannot point back to themselves or to an aggregate provider.
- **Aggregate providers** reference existing providers instead of duplicating credentials. Choose per-request rotation, per-conversation affinity, weighted rotation, or failover based on member capabilities.
- **The local proxy** handles Responses, Chat Completions, legacy Completions, Anthropic, and Gemini. Same-protocol forwarding supports relevant HTTP/SSE, binary, multipart, and Realtime WebSocket paths.
- **Cross-protocol conversion is not universally lossless.** Unsupported tools, private fields, signed history, and incomplete streams produce explicit errors instead of silent data loss. Requests with an unknown outcome are not blindly replayed.

See the [protocol fidelity matrix](docs/protocol-fidelity.md) for replay contracts and conversion limits.

## Models, context, and image input

The **startup model** supplies the root context window and compaction threshold in `config.toml`. Editing another model updates its catalog entry without silently changing the startup model. Compaction thresholds must be positive integers no larger than the context window; disabling the option removes the managed threshold.

Set reasoning limits per provider/model according to actual upstream support. For image input, preserve images, remove them for text-only models, or analyze them through a separately configured VLM. VLM mode needs its own base URL, key, and model.

Usage charts are calculated from local task rollouts. They are not a provider invoice or a complete record of all cloud tasks.

### Default image model

Open **Image models** in the sidebar, add an OpenAI Images-compatible **API URL, API Key, and Model**, then drag the handles to reorder profiles; the first row is marked **Default** and ordering saves automatically 喵~

- Generation and editing both use the selected profile without switching the conversation provider; an existing key is preserved when its edit field is left blank 喵~
- Keep enhancements enabled and launch Codex through Alunixa X to load the MCP initially; an already loaded, updated MCP reads subsequent changes on every call without restarting 喵~
- Omit `model` and `profile_id` to use the first profile; removing all profiles restores the previous provider/model fallback, with no automatic retry or failover between image profiles 喵~
- Keys are excluded from model lists, general settings responses, and diagnostics; concurrent edits are rejected rather than silently overwriting another window's configuration 喵~

## Wallpaper compatibility and practical setup

| Media/project | Windows | macOS | Requirements |
| --- | --- | --- | --- |
| PNG/JPEG/BMP/static WebP | Yes | Yes | Kept as still images |
| GIF/APNG/animated WebP | Yes | Yes | The source must contain animation frames |
| MP4/M4V/WebM/MOV/OGV | Yes | Yes | Up to 2 GiB; decoding depends on codec; prefer H.264 MP4 or WebM |
| Wallpaper Engine Video | Yes | Yes | Video referenced by one project's `project.json` |
| Wallpaper Engine Scene/Web | Yes | No | Installed Wallpaper Engine and native window capture |
| Wallpaper Engine Application | Not executed | Not executed | Arbitrary wallpaper executables are not launched |

Open **Skin manager → Live wallpapers**, import a file or choose **one folder containing `project.json`**, set opacity/fit/mute/pause, save, and launch Codex through the updated launcher. Do not select the entire Steam Workshop library. Static PNG does not become animated automatically.

Uploaded files are copied without conversion to the application state's `wallpapers/` directory. Engine projects stay referenced by path: moving or deleting the original project requires selecting it again. Native Scene/Web capture is limited to 1280×720 at 24 FPS. Pausing the Codex display does not guarantee the engine has stopped rendering.

Version 1.0.22's disk-backed File/Blob and engine-path fixes are retained. The manager does not change the desktop wallpaper, relax Codex CSP, or treat `preview.jpg` as successful scene playback.

## Feature guide

| Area | What it does | Prerequisites or limits |
| --- | --- | --- |
| Overview | Provider/model/tool/runtime status and local usage | Runtime information appears after launch |
| Sessions | Browse, export Markdown, delete, move, repair provider ownership | Confirm destructive operations; occupied files may be skipped |
| Image cleanup | Externalize superseded Base64 image copies with restoration | Active recovery context and rollback sessions stay protected |
| Tools & plugins | Independent MCP, Skills, and Plugins merged across providers | External tools need their own dependencies and credentials |
| Agent capabilities | Shared terminal, paste/scroll fixes, session menus, Fast, Goals | Some switches require a subsequent Codex launch |
| Stepwise and memory | Separate-API suggestions; embeddings or local BM25 retrieval | Stepwise and embeddings require their own configured services |
| Image models | Dedicated `image_gen` API profiles and ordered default | OpenAI Images-compatible service; initial MCP loading required |
| Mobile remote control | Official account, pairing codes, device revocation | Depends on official service/account/client availability |
| WeChat | Contact-specific Codex tasks and execution progress | QR sign-in, CLI, working directory, contact/access settings |
| Zed Remote | SSH projects and remote file opening | Working SSH environment and Zed Remote |
| Skin manager | Local/community/ZIP DreamSkin themes and live wallpapers | Themes and ordinary wallpaper overlays are separate |
| Maintenance/About | Entrypoints, Watcher, updates, logs, diagnostics | Installation actions need the relevant OS permissions |

## Updating, backup, and recovery

Check **About** or GitHub Releases for a platform-specific package. An update downloads and starts the installer; it does not mean a running Codex process has loaded new functionality.

Export the complete configuration before migration or major changes. **Full backups include API keys, login data, and user scripts**, even though ordinary UI responses are redacted. Restore through the configuration-import or feature-specific recovery flow. To roll back application code, use an earlier platform package and a retained backup; deleting task databases is not a wallpaper or UI fix.

Official releases are built from one immutable tag in GitHub Actions for Windows x64 and macOS x64/arm64, producing six installer/archive assets. Release notes document changes, source revision, workflow run, and SHA-256 digests.

## Troubleshooting

- **Russian does not change Codex itself:** the selector only changes the manager; the native Codex language option remains independent.
- **Saved provider changes do not apply:** check the provider master switch, active provider, saved state, launcher entrypoint, and environment overrides.
- **Video previews but the background is blank:** use v1.0.22 or later, enable wallpaper, set nonzero opacity, save, and relaunch through Alunixa X. A manager preview is not proof of host playback.
- **Wallpaper Engine scene is missing:** select a single project, check Windows/engine requirements and executable path; a thumbnail is not a running scene.
- **`FeatureToml` / `features.guardianv2` prevents new or old tasks:** use **Repair task configuration**, then reopen the affected task. The targeted repair backs up the original TOML and is not a general parser or project-config repair.
- **Wrong image model:** the first profile is the default unless `model` or `profile_id` is explicitly supplied. Load the MCP through the launcher initially.
- **Reporting a bug:** include versions, OS/architecture, exact steps, expected/actual behavior, and redacted diagnostics. For wallpapers include type/codec/project kind, not credentials or private conversation content.

## Migrating from Codex+++

The legacy `Alunixa-Code/CodexPlusPlusPlus` repository is archived, and its final bridge release is `v1.2.67`. Existing users can migrate from **Codex++ Manager → About → Migrate to Alunixa X**, or download an `Alunixa-X-1.0.6-*` migration installer directly from the [final Codex+++ v1.2.67 release](https://github.com/Alunixa-Code/CodexPlusPlusPlus/releases/tag/v1.2.67).

Codex+++ and Alunixa X continue sharing `~/.codex-session-delete/settings.json`, so provider, model, and enhancement settings do not need to be copied manually. Migration does not forcibly uninstall the legacy app; verify Alunixa X first, then uninstall Codex+++ when ready.

## Privacy

Configuration, credentials, session indexes, and diagnostics are local by default. Future recommendations, anonymous usage metrics, and online catalogs will ship with visible controls and documentation. They are not intended to collect prompts, conversations, file contents, API keys, or terminal output.

| Data | Default location |
| --- | --- |
| Codex configuration and login | `~/.codex/config.toml`, `~/.codex/auth.json` |
| Manager state and profiles | `~/.codex-session-delete/settings.json` |
| Imported wallpaper media | `~/.codex-session-delete/wallpapers/` |
| Generated images | `$CODEX_HOME/generated_images/` |
| Guardian repair backups | `<Codex home>/alunixa-x-config-repair-backups/` |
| Provider-sync backups | `<Codex home>/backups_state/provider-sync/` |
| Manager language | WebView local storage, separate from provider settings |

`CODEX_HOME` redirects Codex-related paths, not the manager's own state directory. “Local” does not mean every feature is offline: model calls use configured upstream services, updates/catalogs use the network, and WeChat, Remote Control, and engine-hosted Web projects use their respective services.

## Development

Rust edition 2024, Tauri 2, React 19, TypeScript 5, and Vite 6 are used; release CI uses Node.js 22. Install Rust stable and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) (MSVC/WebView2 on Windows, Xcode Command Line Tools on macOS). NSIS builds Windows installers; macOS packages are built on macOS. Keep dependency lockfiles intact.

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

Run the Tauri development manager with `npm --prefix apps/alunixa-x-manager run dev`. Vite alone provides only the frontend, not the native command boundary.

Core code lives in `crates/alunixa-x-core`, session storage in `crates/alunixa-x-data`, the manager in `apps/alunixa-x-manager`, launcher/MCP in `apps/alunixa-x-launcher`, injection assets in `assets/inject`, and packaging in `scripts/installer`.

Translation keys use Chinese source strings in `src/i18n-en.ts` and `src/i18n-ru.ts`. Every new `t()/tf()` call must be represented in both catalogs. The verifier scans all production TS/TSX and checks exact key coverage, placeholders, and backend regex parity.

With Python Playwright/Chromium installed and the frontend built, `python tools/verify-russian-ui.py` checks production pages, cancel/confirm language switching, persistence, tray command payloads, dark/light themes, and narrow layouts using an in-memory Tauri fixture. It never operates a real Codex process or account. Actual wallpaper playback has separate Electron/Wallpaper Engine tests documented in the wallpaper guide.

## Project

- Repository: https://github.com/Alunixa-Code/Alunixa-X
- Issues: https://github.com/Alunixa-Code/Alunixa-X/issues
- Discussions: https://github.com/Alunixa-Code/Alunixa-X/discussions

<p align="center">
  <img src="assets/images/sponsor-alipay.jpg" alt="Alipay donation QR code" width="210">
  <img src="assets/images/sponsor-wechat.jpg" alt="WeChat donation QR code" width="210">
</p>

## License and compatibility

Alunixa X is distributed under the [GNU Affero General Public License v3.0](LICENSE), SPDX `AGPL-3.0-only`. It contains code evolved from CodexPlusPlus and its contributor history; the original copyright and license notices remain in effect. New Alunixa X work is maintained by Alunixa-Code.

Alunixa X is an independent third-party project. It is not affiliated with OpenAI and does not grant rights to OpenAI, ChatGPT, Codex, or other third-party trademarks or assets.
