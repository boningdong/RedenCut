# Track controls and playback repairs

Follow-up to the [track loudness design](../specs/2026-09-21-track-loudness-effects.md).

## Changes

Vol/Gain keep the approved A2 1×3 cells, with centered content, inset track-colored indicators, visible track removal and fx Effects icon.
Waveforms are vertically centered; a separate synchronized horizontal scrollbar stays below the vertically scrolling track list.
Dragging volume or gain now previews immediately in the audio player, committing one history entry on release and restoring authoritative settings on cancellation.
Prepared audio failures retain whitelisted public error reasons so a missing managed runtime produces actionable guidance instead of a generic error.
The development worktree lacked its managed runtime; an ignored .runtime symlink now points to the already provisioned runtime in the main checkout.

## Verification

Full npm check passed: 1,452 tests across 187 files, formatting, lint, Knip, TypeScript and production build.
A new real-output Docker E2E verifies held-pointer zero volume, committed silence, −12 dB gain with and without Normalize, and four normalized tracks playing together.
Measured gain changes: −12.00 dB without Normalize and −12.14 dB with Normalize.
Manual Docker acceptance covers layout, colors, delete/undo, fixed scrolling, edit/history, transport, save/restart, long names, both languages and themes, and narrow windows.

Evidence: `.harness-runs/container/3798dabf-724b-49a5-a88d-26e1e8b8cb45/agent-testing-report.md`.
Recorded audio: `.harness-runs/container/65d8178d-e054-4a9f-8406-26b17c504e82/`.
Both owned runs were cleaned up; native macOS hardware playback was not exercised.
