# Alunixa X: Upstream v1.5.0 to v1.10.0 Integration

## Scope

Fixed source: `BigPizzaV3/CodexPlusPlus`, v1.5.0 `23ed5515e69431794cbef363a886d974abcc6179` through v1.10.0 `85f9117fe108719c6e4807ec60025a25042345f9`. The scope contains **343 commits, 486 changed paths and 816 final-tree files**. The audit also records the deleted upstream path, for 817 accounted paths. It uses complete Git trees/diffs, not the truncated GitHub compare file list.

The earlier AX integration at `e53549ca8c2b2b1edf4199084460af0919f2ded4` is a merge base, not the start of the requested audit. Its unchanged-but-divergent files were rechecked, and missing upstream regression coverage was brought forward. Later upstream main commits are outside this release.

[Machine-readable per-file decisions, source blobs and normalized hashes](upstream-sync-2026-10-21.json) identify implementation merges, existing equivalents, AX compatibility, brand replacements, website adaptation and exclusions. This is a functional integration, not a byte-identical upstream checkout.

## Integration Decisions

| Area | Integrated and Preserved |
| --- | --- |
| Providers | Named keys/current-key switching, local configuration snapshots, provider diagnostics, protected paged edits and model/context import rules. AX keeps advanced creation, five per-model protocols, explicit windows/compaction/reasoning and independent image-generation profiles. |
| Aggregate | Fixed model/member routing, default official-member sign-in, provider grouping/default markers, model-prefix normalization, bounded native preparation and managed-session connection recovery. |
| Protocol | Plaintext agent payloads, original patch text, strict terminal/compaction validation and bounded rejected-exec negotiation. AX retains independent CC Switch-derived Anthropic conversion, valid text options, adaptive thinking, cache accounting, signatures, attachment checks and strict tool/history identity. |
| Settings | Upstream validation and unknown-field preservation run inside AX revision/CAS, cross-process lock and multi-file rollback boundaries. Official sign-in restoration cannot mutate auth before a failing settings CAS. |
| Sessions | Cached index/paged details, streaming backups, recovery journals, catalog eligibility and progress. AX index ownership, partial-error reporting, complete undo groups, all-backup preflight, tombstones and concurrent-change protection remain active. |
| Agents and MCP | Opt-in external harness collaboration, independent CLI/auth/model routes, task state, MCP refresh/cache-owner diagnostics and Skills repository/install/disable/restore workflows. No CLI is installed or authenticated automatically. |
| Runtime | Per-model usage status, bounded DOM/native initialization, opt-in native Fast, Claude/MSIX detection and dictation, isolated workers and real updater stages. Existing Fast controls, shared terminal, remote/project/worktree and other previously restored enhancements are not silently removed. |
| Media | Upstream image compositor and AX full media dispatcher coexist. Fix early initialization with no document root, dispose observers/listeners/Blob URLs, and retain image/GIF/APNG/MP4/WebM playback, controls and reload behavior. |
| Themes | DreamSkin 1.5.20 renderer/CSS and theme/runtime fixes; promotional theme fields are omitted, while AX themes and backup/restore safeguards remain. |
| Site | Port selectable real screenshots, stable preview geometry and scroll preservation to the existing AX site, with language switching, mobile layout and no-JavaScript fallback. Keep AX release links/brand rather than importing the upstream custom domain or marketing-animation stack. |
| Packaging | Preserve AX identity, Windows x64 plus macOS x64/arm64 installers, verified DMG detach/rollback, full Actions gates and six installers plus `latest.json`. |

## Exclusions and Contract Differences

- Advertising fetches, sponsor catalogs, commercial recommendations and new promotional media are excluded. Existing compatibility stubs remain disabled; no product workflow depends on an ad request.
- Upstream owner logos, logo prompts and presentation artwork are replaced by AX-owned assets and verified AX screenshots. Historical maintainer reports/plans/release notes are not runtime features; AX maintains its own release and technical records.
- Upstream tests that require removing already-restored AX features are replaced by positive functionality, explicit-disable and lifecycle regressions. Tests that permit dropping unmatched tools, inventing arguments or silently weakening fidelity do not replace AX's strict rejection tests.
- Uncreated explicit `CODEX_HOME` remains valid for isolated first launch. Falling back to the real user home would break AX's isolation contract; root/ancestor/traversal deletion guards and their upstream boundary tests remain covered.
- Native sharing library APIs are retained without automatic upload or invocation of an upstream-hosted service. Existing local export workflows remain local.
- The upstream macOS universal-DMG assumption is adapted to the existing AX two-architecture release contract rather than replacing verified installers with an untested packaging layout.

## Verification

Production-manager Chromium workflows cover advanced creation, five protocols, two model windows/compaction limits, default/reordering/save/reopen, the restored enhancement inventory, named keys, collaboration default-off, Skills repositories, MCP and Chinese/English/Russian narrow layouts. Website Chromium covers desktop/tablet/mobile screenshots, stable scrolling, decoded images, Chinese/English, no promotion requests and no-JavaScript fallback.

Media validation uses an isolated Electron host and the actual Rust File/Blob bridge with the complete production renderer, host-equivalent CSP, real rendered pixels, animation changes, video frames, playback controls, large-image reload and cleanup. Image compositor validation checks 64 actual pixel combinations. The negative-control run must exit nonzero; successful decoded metadata alone is not treated as successful painting.

Final Rust/Node/type/build/locale/installer results and the release commit are recorded in the published Actions provenance. Failure-stage logs are not represented as passing final results.

## Operational Boundary

This integration does not install/restart/hot-inject the user's running Codex, reset accounts/providers, delete sessions or modify system proxy settings. Browser and Rust checks use temporary homes and fixtures. Real third-party provider accounts, every external CLI installation, audio hardware and all official app versions are not comprehensively exercised by isolated tests.

After installing v1.0.46, fully exit the old Codex/Helper and launch through AX to load the new service and renderer. Do not delete `.codex` or restore an old complete snapshot over newer user data. Source changes can be recovered from the local stage commits or the prior release without moving existing release tags.
