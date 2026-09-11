# Default Redact export

## Required behavior

Export removes Redact intervals by default and contracts output time using exactly the same eligible-track and overlap rules as Preview.
The Preview toggle only controls interactive playback; disabling it must not retain redacted time in an export.
Retained content on an eligible overlapping track prevents a global cut in that interval.
Ordinary track Mute and natural timeline gaps do not contract output duration.
Preserve source media and the editable project timeline.

## Implementation

Move the pure Redact range calculation to `src/shared/redactionTimeline.ts` so renderer playback and main-process export share one rule.
Map retained clip starts into the contracted output timeline, preserving clip gain, track volume, and mute/solo routing.
Render at sample-based delays and preserve non-redacted silent tails; report export progress against the contracted duration.
Explain default Redact removal in the export modal without adding a second independent mode switch.
Add bounded, run-owned prepared export destinations to the Docker harness and extend the existing Redact acceptance scenario.

## Verification

Use actual FFmpeg renders with recognizable sample segments to assert duration and retained sample positions, including partial overlaps, gaps, ordinary track mute, and redacted tails.
Use real UI exports with Preview disabled, inspect the resulting WAV duration/content, and retain evidence in the Docker run.
Run the baseline editing scenario, affected export checkpoints, standard code checks, harness suite, and relevant real E2Es before completion.

## Export padding regression

A real three-clip fractional-boundary gap test exposed `amix` emitting `NOPTS` after its first short input ended.
An unbounded `apad` followed by timestamp-based trimming then continued output instead of stopping at the desired duration.
Use finite sample-count padding and trimming, then reconstruct timestamps from sample position; this preserves the exact timeline duration even when incoming mix timestamps are absent.
The real-output regression bounds both output file size and process lifetime to prevent runaway test artifacts.
Independent null-output diagnostics confirmed correct mixed sample counts and identified the missing timestamps.

## Verification record

`npm run check` passed 647 tests across 95 files, formatting, lint, dead-code analysis, typecheck and production build.
A fresh Docker snapshot passed all 25 harness tests and all six real-audio E2Es across five files sequentially.
The export E2E produced original 13.5s, redacted 8.504563s with Preview both off/on, track-muted 13.5s, natural-gap 15.499708s and retained-overlap 13.5s WAVs.
Decoded retained prefix/suffix correlation was 1.0 against the original export, and the gap and muted output checks confirmed silence without timeline contraction.
E2E artifacts: `.harness-runs/container/d0d7ce6c-a9a6-49f8-a1b1-5760d3e431af/`.
Renderer bundles are `index-D3020ctG.js` / `index-B6M0_yg9.css`; the host main bundle SHA-256 is `016390eaae0a4cace07288f5b32ab2b11f648821c85d14f445e13e299db815ea`.
Earlier parallel Docker startup failures and the now-fixed time-trim export failure were retained as diagnostic evidence; final tests use the bounded sample-count implementation.

Final adaptive Docker acceptance passed the editing baseline and all five export checkpoints, including save/reopen and complete owned-run cleanup.
Report and six actual WAV outputs: `.harness-runs/container/2e5524fb-2f25-4547-93f2-e6f421f11a4b/agent-testing-report.md`.
The actual container main-bundle hash matched the host hash above.
This adaptive run verifies WAV outputs; other encoders and native macOS UI were not separately exercised.
