# Track gain performance repair

## Scope and diagnosis

The user reported lag while dragging the left track-volume slider in the crossfade branch, especially with a one-hour recording that already had a transcript; playback itself was normal.
The approved repair preserves immediate gain, persisted volume, and content editing behavior.

Each volume update replaced the tracks array, unnecessarily rebuilding render plans in both playback layers, resolving crossfade geometry, rerendering App, and projecting/rendering the transcript.
The existing waveform canvas already memoized its drawing inputs; there was no evidence that volume changes decoded the complete source audio.
A synthetic diagnostic with 1,000 redactions measured a median 32.296 ms for two plans, time-map comparison, and one UI resolver alone; this excludes React and is not a measurement of the user's project.

## Repair

- Keep full track state as the persistence and live playback source of truth.
- Separate `TrackContent` (all track fields except volume) for transcript and workspace presentation; stable content subscriptions prevent gain-only rerenders, without exposing stale volume values to consumers.
- Forward full tracks through a lifecycle-managed App subscription, independently of App rendering.
- Compare immutable clip-array identity plus track identity/mute/solo before rebuilding playback structure; mode changes still force rebuilding.
- Reuse crossfade resolutions for gain-only changes; content edits invalidate them.
- Keep project schema, slider behavior, source media, and real-time gain routing unchanged.

## Regression evidence

New tests first failed on the old paths: 100 unnecessary adapter builds, one unnecessary worklet build, one overlay re-resolution, and repeated App/transcript commits on gain changes.
Tests now require zero content rerenders for both three and 6,000 transcript units (the latter spanning one hour), while mute still invalidates content and every gain update still reaches playback.
Playback tests assert correct GainNode values before first play, during play, and after seeking, with no queue rebuild during a live gain change.
`npm run format` and `npm run check` passed: 171 test files, 1,306 tests, lint, Knip, typecheck, and production build.
An independent review found no remaining Important/Critical or Minor issues; its targeted 108 tests passed.

## UI acceptance

[Final Docker MCP acceptance report](../../../.harness-runs/container/866604a2-eb70-4840-add0-a3daecc589b6/agent-testing-report.md): PASS.
The final run exercised a real one-hour import alongside the existing saved transcript fixture, pointer/keyboard gain changes, live playback, mute/solo, narrow layout and full restart persistence (30% for the short project and 67% for the hour track).
Long-transcript load was independently covered by the 6,000-unit React regression, not falsely represented as a generated transcript of the hour-long tone.

Docker `editing-playback` and `transcript-fixture` E2Es passed all 4 tests in 47.87 seconds, including real recorded audio, text redaction, save and reopen.
Evidence runs: `932daa00-ff6f-4240-8712-309160dd3e20`, `d475957e-8f6e-44cc-9cc4-0b16678b6430`, `354b5cd8-4807-4abc-ac6f-0d5ac2987b37`, and `79d2d9d3-e8b0-4e3f-bb16-e6c44aaaf2a0` under `.harness-runs/container/`.
All owned acceptance/test containers exited; evidence and task-owned saved test projects are retained.
Native macOS frame rate and the user's actual one-hour project are not available to this isolated Linux test environment.
