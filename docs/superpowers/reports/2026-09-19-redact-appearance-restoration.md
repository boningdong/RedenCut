# Redact appearance restoration

Restored the exact non-crossfade CSS values from main commit `0c28be9`: 4px radius, 1px border `#a997bf`, alternating 5px bands `#2b233be0` / `#40324ee0`, and the original hover/selection/focus colors.
Only enabled crossfades mount the dedicated square frame and fading rail layer; extensions reuse the same broad stripe pattern.
Ordinary redaction hover grips are restored, while crossfade idle controls remain hidden as requested.

Regression test first failed because disabled redactions still mounted crossfade rails; it now passes across enable and disable transitions.
`npm run format` and `npm run check` passed: 171 files / 1,307 tests, formatting, ESLint, Knip, typecheck and production build.
Fresh Docker transcript-fixture E2Es passed 2/2, covering redact editing, resizing, history and persistence.

[Docker UI acceptance and screenshots](../../../.harness-runs/container/3a38dff7-be5e-4214-9b49-50aedebdc335/agent-testing-report.md) records enabled/disabled/reenabled visual comparisons in dark/light themes, baseline reuse, tool recovery, and narrow-window/native coverage limits.
