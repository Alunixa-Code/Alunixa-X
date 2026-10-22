# Alunixa X v1.0.47: Settings Save Repair and v1.10.1 Integration

## Fixed Scope

Source: `BigPizzaV3/CodexPlusPlus`, v1.10.0 `85f9117fe108719c6e4807ec60025a25042345f9` through v1.10.1 `c541516cfd43f0389aafc8a812c26b5b4061b29f`. Complete Git data contains **122 commits, 151 changed paths and 864 final-tree files**. Later upstream main changes are excluded.

The [machine-readable audit](upstream-sync-2026-10-22.json) records every final-tree path, changed-range membership, upstream blob, mapped hash, local hash, decision and verification category. AX application identity and existing functionality take precedence over upstream branding or retirement of restored features.

## Save Failure

The manager has two intentionally different revisions:

- `SettingsPayload.revision`: the multi-file transaction snapshot covering settings, live config/auth, named profiles and model catalogs.
- `BackendSettings.revision`: the settings-file revision used by the settings store.

The shared `call("save_settings")` wrapper incorrectly replaced the caller's transaction revision with the file revision. This rejected ordinary saves before any write, even without a concurrent modification. Existing save-queue tests replaced `call` with a stub and therefore missed the real wrapper.

The wrapper now preserves an explicit transaction revision and otherwise uses the confirmed transaction snapshot. The queue advances the file revision from the previous successful save as well. Import previews return the proper transaction revision. Real conflicts do not silently retry or advance unconfirmed revisions, and they retain drafts/native edits rather than restoring defaults.

New tests execute the real wrapper together with the real queue, using distinct values for both revisions. Additional Rust tests run actual manager load/save commands in temporary homes, verify two consecutive saves and preserve the existing stale-snapshot rejection test. A production Chromium fixture checks the same transport contract, retained providers, live locale changes and conflict-preserved drafts.

## Integrated Changes

| Area | Behavior |
| --- | --- |
| Request logs | Running/completed requests, conversation filtering/titles, attempts/root causes, real first-output time, usage/cache and bounded local storage. |
| Overload handling | Streaming/legacy/buffered modes, commit delay, bounded exponential backoff and pre-commit capacity handling. No retry of already committed output. |
| Bridge and status | Failed bridge recovery/reinjection, CSP-safe status route, per-session status ownership, stable usage/cache accounting. |
| Protocol | Original patch inputs, strict Responses history options, per-model reasoning/Lite controls, official-member image requests and tool namespace/pairing fixes. Independent native Anthropic, five AX protocols and fidelity validation remain. |
| Providers | Independent process-local provider proxies, configured CA reads, catalog rebuilding/path handling and request diagnostics. No system proxy/environment/certificate edits are performed. |
| Sessions | List-first project/session UI, search/paging, scoped bulk selection, project selection and archive actions without deleting rollout files. |
| Tools | Skills groups/batch enable/disable, MCP startup-path verification and bounded external-agent execution. |
| Configuration | Export/import drafts, settings-path migration, native startup/minimize choices and Windows/macOS dictation/platform fixes. |
| Locale and preview | Chinese/English/Russian live switching with drafts intact; current manager source builds the memory-only public preview. Upstream generated hashes are not copied. |

## Deliberate AX Differences

- Advertising, sponsor downloads, commercial recommendations and upstream logos are not introduced. AX icons, installer identities and restored pages/controls remain.
- Corrupt/non-UTF-8 live configuration is not treated as empty or silently replaced. AX preserves original bytes and rejects the write rather than risk losing MCP, sandbox or unknown fields.
- Managed plugin disable writes explicit `enabled=false`; deleting the key could cause default reactivation.
- Exact duplicate tool results can be coalesced; conflicting duplicate content still fails explicitly. A reused call ID is allowed only after the earlier call has a result, preserving turn-local pairing. Unanswered/orphaned calls remain errors.
- Settings migration pointers stay in AX's state directory, and isolated workers cannot borrow or modify the main instance pointer. No migration is performed on the user's real files during validation.
- AX's full media runtime, independent image profiles, advanced per-model protocols/context/compaction, all restored enhancements, Russian and strict native Anthropic lifecycle remain intact.
- No WSL commands are executed. Cross-platform behavior is verified natively through Windows and macOS Actions.

## Verification and Release

Final local v1.0.47 workspace: **104 result blocks, 3,027 passed, 0 failed, 23 environment-dependent ignored cases**. Node: **951 tests, 950 passed, 0 failed, 1 pre-existing skip**. TypeScript, Vite, locale parity, generated fragments, branding and 22 site/installer cases passed. Production save/advanced-provider/restored-enhancement/manager/collaboration workflows and the separate demo preview passed in Chromium. Image compositing passed 64 pixel cases; the new Rust fixture and complete renderer passed all Electron media cases plus a nonzero intentional-failure control.

Production Chromium checks cover real revision handling, advanced model creation/save/reopen, five protocols/adaptive/context, restored enhancement inventory, named keys, Skills, MCP and three locales/narrow windows. The public preview is validated separately using only demo IPC.

Node/TypeScript/Vite/i18n, Rust workspace, installer/branding/generated-fragment checks and complete media/pixel tests form local gates. Official three-platform Actions re-run full regressions, build the release, validate packages and publish six installers plus `latest.json`; release provenance and asset SHA-256 values identify the exact final commit.

No running user Codex is installed, restarted or hot-injected; account credentials, sessions and system networking are not changed. Install the new release and fully exit old Codex/Helper before launching through AX to load the repaired service/scripts.
