# Contributing to Alunixa X

Thanks for helping improve Alunixa X.

## Setup

```powershell
git clone https://github.com/Alunixa-Code/Alunixa-X.git
cd Alunixa-X

cd apps/alunixa-x-manager
npm ci
npm test
npm run check
npm run vite:build

cd ../..
cargo fmt --all -- --check
cargo test --workspace -- --test-threads=1
```

## Project structure

```text
apps/alunixa-x-launcher     Launcher and image-generation companion
apps/alunixa-x-manager      Tauri / React desktop control system
crates/alunixa-x-core       Core launch, proxy, injection, and install logic
crates/alunixa-x-data       Session and provider data workflows
assets/brand                Product icon and brand assets
assets/inject               Codex renderer integrations
```

## Pull requests

1. Create a focused branch.
2. Preserve unrelated behavior and compatibility contracts.
3. Add or update tests for user-visible changes.
4. Run frontend, Rust, branding, and formatting checks.
5. Explain the behavior change, compatibility impact, and verification in the PR.

Never include real API keys, login data, prompts, session contents, or private file paths in commits or issues.

## License

Contributions are licensed under [AGPL-3.0-only](LICENSE). Existing third-party copyright and attribution notices must be preserved.
