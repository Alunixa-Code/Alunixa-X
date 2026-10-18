# Fast controls for API-key sessions

## Behavior

The composer can appear before the Alunixa settings page is opened. Previously,
service-tier state was only loaded when that page was opened, leaving the composer
badge disabled at `…`. Backend settings initialization now starts that read, and
changes to the service-tier feature or master enhancement setting refresh it.
Concurrent reads share one operation; disabling the feature invalidates an older
read so it cannot overwrite state after re-enabling.

For Codex `26.1007.30912`, API-key sessions can also use the existing native Fast
checkbox and model-label lightning icon. The renderer adapter supplies service-tier
props only to the inspected native model-picker component. Selection writes the
existing Alunixa thread/draft override, which its request handling already uses.

## Compatibility boundaries

- The native adapter requires the service-tier feature, a ready local backend and
  service-tier state, API-key authentication, and a supported selected model.
- It reads native configuration requirements. An explicit `fast_mode = false` or a
  failed requirements read prevents native adaptation.
- It preserves existing native service-tier options. Other authentication methods,
  remote hosts, and unknown Codex versions retain their existing behavior.
- The Alunixa badge is hidden only while an adapted native control is mounted for
  the current conversation. It remains the fallback when adaptation is unavailable.
- Client replacement, disconnection, feature changes, and reinjection invalidate
  stale asynchronous work and callbacks.
- The adapter does not alter authentication, subscription access, or the native
  tier setter. Native Fast presentation does not establish that a relay honors
  `service_tier: "priority"`, changes latency, or applies any particular price.

The version check is intentional: adding support for another Codex release requires
checking its native component exports and props first. An unsupported release must
continue to work through the Alunixa fallback.

## Verification

Automated VM tests cover initialization, concurrent reads, settings transitions,
selected-model support, native component identity, preserved JSX props/children,
rollback, native requirements, client changes, stale responses, and reinjection.

Manual verification on Codex `26.1007.30912` used live renderer reinjection: the
genuine native checkbox switched Fast → Standard → Fast, with the native lightning
icon following the selection. This exercised the original local fix; subsequent
lifecycle hardening is covered by the automated regressions. A packaged cold start
and an actual relay inference request were not part of that verification.

To check a packaged build, enable service-tier controls before launching Codex and
verify that the composer leaves its loading state without opening Alunixa settings.
For a supported local API-key model, switch the native checkbox in both directions,
then disable enhancements and confirm the original picker remains usable. On an
unsupported Codex version, verify that the Alunixa fallback still allows selection.
