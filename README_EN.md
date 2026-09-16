<p align="center">
  <img src="assets/brand/alunixa-x-icon.png" alt="Alunixa X" width="148">
</p>

<h1 align="center">Alunixa X</h1>

<p align="center"><strong>AI Agent Control System</strong></p>

<p align="center">Connect models, providers, tools, automation, integrations, and the Codex desktop runtime on one control rail.</p>

<p align="center">
  <a href="README.md">中文</a> · English
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

### Live wallpapers (v1.0.20+)

**Themes → Live Wallpaper** accepts videos, GIF/APNG animations, and still images with preview, opacity, fit, mute, and pause controls. You can also select one Wallpaper Engine project folder containing `project.json`: Video, isolated Web, and native Scene on Windows with Wallpaper Engine installed. See [wallpaper documentation and compatibility limits](docs/wallpapers.md).

The panel also provides a narrow, backed-up repair for malformed `features.guardianv2` configuration. Saved wallpapers apply on the next launch through Alunixa X v1.0.20 or later; the current Codex process is not restarted or patched.

## Install

Download a platform build from [GitHub Releases](https://github.com/Alunixa-Code/Alunixa-X/releases/latest):

- Windows: `Alunixa-X-*-windows-x64-setup.exe`
- macOS Intel: `Alunixa-X-*-macos-x64.dmg`
- macOS Apple Silicon: `Alunixa-X-*-macos-arm64.dmg`

The installer creates two entries:

- **Alunixa X** opens the main control system.
- **Alunixa X Launch** starts Codex Desktop with the saved provider and agent configuration.

Windows also creates **AX - Alunixa X** and **AX Launch - Alunixa X** Start menu entries; macOS bundles are named **Alunixa X (AX)** and **Alunixa X Launch (AX)**, so installed apps can be found by searching `AX`, while legacy bundle names remain supported 喵~

### Default image model

Open **Image models** in the sidebar, add an OpenAI Images-compatible **API URL, API Key, and Model**, then drag the handles to reorder profiles; the first row is marked **Default** and ordering saves automatically 喵~

- Generation and editing both use the selected profile without switching the conversation provider; an existing key is preserved when its edit field is left blank 喵~
- Keep enhancements enabled and launch Codex through Alunixa X to load the MCP initially; an already loaded, updated MCP reads subsequent changes on every call without restarting 喵~
- Omit `model` and `profile_id` to use the first profile; removing all profiles restores the previous provider/model fallback, with no automatic retry or failover between image profiles 喵~
- Keys are excluded from model lists, general settings responses, and diagnostics; concurrent edits are rejected rather than silently overwriting another window's configuration 喵~

## Migrating from Codex+++

The legacy `Alunixa-Code/CodexPlusPlusPlus` repository is archived, and its final bridge release is `v1.2.67`. Existing users can migrate from **Codex++ Manager → About → Migrate to Alunixa X**, or download an `Alunixa-X-1.0.6-*` migration installer directly from the [final Codex+++ v1.2.67 release](https://github.com/Alunixa-Code/CodexPlusPlusPlus/releases/tag/v1.2.67).

Codex+++ and Alunixa X continue sharing `~/.codex-session-delete/settings.json`, so provider, model, and enhancement settings do not need to be copied manually. Migration does not forcibly uninstall the legacy app; verify Alunixa X first, then uninstall Codex+++ when ready.

## Privacy

Configuration, credentials, session indexes, and diagnostics are local by default. Future recommendations, anonymous usage metrics, and online catalogs will ship with visible controls and documentation. They are not intended to collect prompts, conversations, file contents, API keys, or terminal output.

## Development

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
