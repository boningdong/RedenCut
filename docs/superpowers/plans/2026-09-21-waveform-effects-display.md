# Effect-aware waveform display implementation plan

> Use superpowers:subagent-driven-development for independent backend/drawing tasks; integrate and verify in this worktree.

**Goal:** Readable initial 85% waveform fit, stable display scale, real effect output and live Gain feedback, with replacement content using full available height.
**Architecture:** Original peak metadata establishes a stable per-track view scale. Prepared audio provides bounded multilevel waveform reads in timeline coordinates before manual Gain/Volume. Canvas applies Gain and display scale separately. Replacement provenance remains visible alongside actual composite output.
**Tech stack:** Electron IPC, existing FFmpeg render plan, React canvas, Zustand, Vitest and Docker MCP.
**Spec:** User-approved discussion in this task, including independent track scaling and replacement lane coverage.

## Constraints and review focus

- Original audio is immutable; display fit does not change sound. Volume remains playback-only.
- Scale must not follow visible viewport, Gain/effect changes, trim or pan. Silence must not amplify numerical noise indefinitely.
- Prepared reads must be bounded and session scoped; switching effects or projects cannot attach stale results or cancel playback.
- Gain preview redraws without expensive preparation or new undo entries.
- Processed master waveform follows actual source overrides, sums and effects; never sum min/max buckets as if exact audio.
- Labels and source provenance must remain legible at ordinary/master/compact child heights, including six replacement sources.

## Task 1: Processed waveform data

- [x] Add prepared waveform request/result types and preload/IPC route, validating session/handle/frame/bucket bounds.
- [x] Build multilevel min/max and global peak from actual prepared interleaved PCM with bounded streaming IO.
- [x] Permit non-normalized composite preparation for baseline/replace display; preserve pre Gain/Volume semantics.
- [x] Test signal extrema, partial ranges, invalid bounds, silence and processing isolation; run real FFmpeg integration.

## Task 2: Drawing geometry and stable source metadata

- [x] Add `getPeak(): Promise<number>` to source provider as an optional capability, using whole-source coarse cache rather than viewport peaks.
- [x] Add explicit waveform display scale/Gain props and use available clip geometry, reserving label space.
- [x] Draw fit at 0.85 / sourcePeak and clamp screen overflow with a visual-only marker; preserve silence and finite values.
- [x] Make replacement source rows use available area; remove fixed 29/45 px and compact four-plus placeholder treatment.
- [x] Test global fit, resize, Gain multiplier and 1/3/6 source geometry.

## Task 3: Renderer processing and view state

- [x] Add processed timeline provider and session-owned hook that keeps old data while updating, rejects stale completions, and reports failures.
- [x] Compute stable original track peak across its sources once; retain per-track scale until explicit Fit/Reset or project change.
- [x] Add Fit waveform / Reset waveform zoom to track context menu, with localized text.
- [x] Expose transient Gain audition to drawing and clear it on cancel/unmount; avoid model/history changes.
- [x] Wire ordinary, linked and master/replacement displays to correct source/processed data, with labels for updates/failures.
- [x] Test session switch, effects toggles, Gain-only no rebuild, viewport-independent scaling and cancellation.

## Task 4: Acceptance and review

- [x] Full formatting, lint, Knip, TypeScript, tests and build.
- [x] Fresh Docker baseline and real audio regression.
- [x] UI acceptance: quiet initial audio ~85%, Gain visibly changes with locked scale, Normalize shape changes, fit/reset, raw/processed replacement areas, 1/3/6 sources, dark/light and narrow, undo/save/reopen.
- [x] Review branch, fix actionable findings, retain run report and commit.

## Execution rulings

User already approved design and explicitly requested immediate implementation, so no additional plan approval gate.
Current preceding work was committed and clean at 8234694 before this feature.
