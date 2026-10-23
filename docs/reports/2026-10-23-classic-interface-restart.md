# Classic interface and Codex restart — 2026-10-23

## Scope

Restore the v1.0.42 manager styling without reverting newer functionality, and repair explicit Codex restart. Injection and tray-exit behavior are deliberately unchanged following the user's scope clarification.

## Changes

- Restore bundled Inter typography, classic management surfaces and responsive model cards. Keep additional per-model protocol and reasoning fields visible instead of removing them.
- Use the owned launch session's actual debugging port, falling back to persisted launch identity and finally the form preference.
- Check desktop-process existence independently of CDP. A missing debugger no longer implies that the desktop application is absent.
- On Windows, scope restart to the verified executable and a unique main process identified by its arguments. Keep other instrumented/isolated instances and CLI processes out of the target set.
- Retain native process handles through termination and exit verification. Normalize short/long Windows image paths consistently. Report ambiguous identities, permission failures and exit timeouts rather than silently activating the old window.
- Preserve provider synchronization guards, stop-before-cleanup ordering and failure handling. An ordinary restart does not rewrite live provider or authentication files.

## Verification

- Windows local workspace: **104 result blocks, 3,032 passed, 0 failed, 24 ignored**. The additional ignored entry is a subprocess-only test entry explicitly executed by its parent lifecycle test.
- Frontend: **954 tests, 953 passed, 0 failed, 1 pre-existing skip**.
- The native lifecycle test starts owned process fixtures, stops/restarts the selected fixture twice without a CDP endpoint and confirms that a separate fixture remains alive. Pure selection tests cover other debugger ports, isolated profiles and ambiguous targets.
- All 11 manager restart tests pass, including actual-versus-preferred ports, failed cleanup, single-flight behavior and preserving live provider files.
- Production Chromium verifies classic typography and model fields at 1440/1180/960 pixels without overlap, plus Skills, sessions and enhancement pages. The overview workspace region is pixel-identical to the v1.0.42 reference rendered with the same fixture.
- Advanced-provider creation/save/reopen, independent protocols/keys/context/compaction, restored enhancement inventory, two consecutive settings saves, real CAS conflict preservation, MCP and Chinese/English/Russian flows pass.
- Manager and web-preview builds, TypeScript, locale parity, renderer assembly consistency, branding and 22 installer/site cases pass. The current web preview loads local classic fonts, switches all three languages and makes no external requests.
- Third-party Cargo/npm lock entries are unchanged. Private local memory and diagnostic artifacts are not included in the product tree.

The user's active Codex was not installed over, restarted or hot-injected during verification. Accounts, provider credentials, conversations, selected media and system networking were not reset or modified. Native Windows/macOS release workflows run the final platform regressions before publishing installers.
