# Crossfade duration and audio proof

User-approved request: raise the maximum from 100 ms to 1 s and establish that crossfade changes actual audio.
The old 100 ms value was a schema/UI product limit, not a DSP constraint.
A shared MAX_CROSSFADE_DURATION_MS constant now governs schema, numeric input, pointer gestures, keyboard End/arrows and accessibility bounds.
Default remains 30 ms equal-power; requested duration is still constrained by retained source length, neighboring transitions and protected overlapping tracks.
Preview edits enables contracted crossfade playback; ordinary timeline playback does not audition it. Export always uses the edited plan.

## Verification

- Observed red/green regressions for schema acceptance and UI input/keyboard/pointer boundaries.
- New one-second tests validate exact 5 s minus 1 s redact minus 1 s overlap = 3 s, and a 250 ms short-content cap.
- Actual managed FFmpeg and TrackBlockRenderer outputs independently match full PCM math for linear and equal-power one-second joins, including 4096-frame block boundaries, within 1e-5; tests also require a measurable difference from the hard cut.
- npm run format and npm run check passed: format, lint, Knip, typecheck, 171 files / 1311 tests, production build.
- Fresh Docker editing-playback E2Es passed 2/2.
- Real UI WAV exports differ by exactly 48000 frames; the entire enabled export matches independent equal-power math within 0.50014 PCM16 LSB.
- UI accepted 1000, rejected 1001, and preserved enabled 1000 ms after save/restart/reopen. Normal/narrow screenshots inspected.

[Evidence-backed acceptance report](../../../.harness-runs/container/c56ac39f-6a25-4f96-b5cd-c90d61f932fd/agent-testing-report.md).

Export proof is numerical; no claim is made that subjective listening or native macOS hardware has been verified.
A longer speech crossfade audibly overlaps more content and is an available setting, not a change to the default.
