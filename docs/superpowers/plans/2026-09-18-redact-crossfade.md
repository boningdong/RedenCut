# Redact Crossfade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver automatic non-destructive Redact crossfades with accurate preview/export and the approved B UI.
**Architecture:** A pure shared plan resolves eligible seams, source spans, gain envelopes and timeline mappings. Playback mixes bounded PCM blocks; export compiles the same contributions. UI shows resolved ranges and owns no independent acoustic calculations.
**Tech Stack:** TypeScript, Zod, Zustand, React, Web Audio Worklet, FFmpeg, Vitest, Docker UI harness.
**Spec:** ../specs/2026-09-18-redact-crossfade-design.md

## Global Constraints

- 48 kHz processing, integer frames, half-open ranges.
- New Redact defaults: enabled, 30 ms, equal-power; old missing fields remain disabled.
- Crossfade duration is finite, 1–100 ms; both sides always have equal effective widths.
- Keep original audio, clip positions and Redact boundaries unchanged.
- B design: square central frame, continuous 1px rails and outward-fading fine hatch wings.
- Single context-menu entry; enable control inside portal floating editor with viewport collision handling.
- Modified TS/JS modules use PascalCase; isolate mechanical renames from semantics.
- Per-track buffering retains the existing two-second target and three-second hard cap.
- No source/control operations from worklet; no entire-file PCM buffers.

## Review Focus

- Seek into a fade and block boundaries must not restart envelope phase.
- Other tracks and adjacent transitions must not silently lose retained content.
- Old project fields and independent copies must survive save/undo/redo.
- Floating editor must remain reachable at all viewport edges and not trigger background shortcuts.
- Preview duration and sample content must match FFmpeg export without double gain.

## Task 1: Mechanical names and baseline

**Files:** Rename ProjectTypes, PlayerTypes, RedactionTimeline, TimelineStore, PlaybackActions, PlaybackPlan and main audio Renderer, including corresponding tests and imports.
**Interfaces:** Same exports and behavior as baseline; only module paths change.
- [ ] Establish dependencies from existing installed lockfile-compatible node_modules and run baseline Vitest.
- [ ] Rename with Path.rename and update import strings ending in original module paths across src, harness, e2e and configuration; update direct documented references.
- [ ] Run `npm run typecheck` and `npm test`; expected no added failures.
- [ ] Commit mechanical changes separately.

## Task 2: Persisted settings and shared audio plan

**Files:** shared/ProjectTypes.ts, audio/CrossfadeTypes.ts, AudioRenderPlan.ts, AudioRenderPlanBuilder.ts, RedactionTransitionResolver.ts, TimelineTimeMap.ts, GainEnvelope.ts and colocated tests.
**Interfaces:** `buildAudioRenderPlan(tracks: Track[], mode: 'timeline' | 'edited'): AudioRenderPlan`; `resolveRedactionTransitions(tracks: Track[]): CrossfadeResolution[]`; `timelineToOutputFrame(map, frame)` and `outputToTimelineFrame(map, frame)`; `gainAtFrame(envelope, frame): number`.
- [ ] Write tests first for settings validation, two-second fixture with .24s deletion and .03s fade (83040 frames), exact equal wings, legacy disabled, overlap policy and protected other-track content.
- [ ] Run focused Vitest; expect missing exports/behavior failures before implementation.
- [ ] Implement typed contributions as defined by spec, adding frame-based time-map segments and a resolution index with owner identities and left/right timeline starts for UI.
- [ ] Use deterministic seam ordering and constrain neighboring wings; never consume removed samples.
- [ ] Assert envelope chunk/seek phase and all endpoint mappings. Run focused tests to green.
- [ ] Commit shared data and plan.

## Task 3: Playback and timeline adaptation

**Files:** TrackBlockRenderer.ts, PlaybackTimelineAdapter.ts, WorkletAudioPlayer.ts, AudioPlayerWorklet.ts, PlayerTypes.ts, PlaybackActions.ts, App.tsx and tests.
**Interfaces:** `renderTrackBlock(trackPlan, outputStartFrame, frameCount, providers, signal): Promise<Float32Array[]>`; adapted IAudioPlayer preserves timeline-facing UI methods while raw player uses output time; explicit mode selected through adapter.
- [ ] Write tests for two contributions at the seam, clipped reads, stereo, gain once, empty/muted blocks and cancellation.
- [ ] Watch tests fail, then implement bounded block reads and gain-envelope accumulation with indexed contributions.
- [ ] Replace sequential raw-clip plan with shared contributions; queue pre-composed PCM with unity gain or remove the old gain field consistently.
- [ ] Replace callback seek-redaction with adapter mode changes, preserving timeline location across mode changes; expose output duration separately where needed.
- [ ] Test playback start, resume, seek, stale-generation cancellation and buffering plus editor/transcript regressions.
- [ ] Commit verified playback integration.

## Task 4: Export from shared plan

**Files:** main/audio/Renderer.ts, export/FfmpegPlanCompiler.ts, export/ExportCoordinator.ts, corresponding tests.
**Interfaces:** Consumes `AudioRenderPlan`; returns FFmpeg filter graph preserving gain, channels and exact output duration.
- [ ] Write tests for fade expressions and 83040-frame output plus mute/solo, natural gaps and legacy plans.
- [ ] Fail first, compile resample-before-frame-trim, explicit envelope formula, adelay frame placement, normalize=0 mix, final frame trim.
- [ ] Update progress to plan duration, retaining existing format/runtime boundaries.
- [ ] Render representative synthetic PCM through the managed FFmpeg binary and compare float output with block renderer at <=1e-5 sample error.
- [ ] Commit export and parity tests.

## Task 5: Editing model and B floating UI

**Files:** TimelineStore.ts, ClipClipboardActions.ts, ClipRedactionOverlay.tsx, RedactionCrossfadeOverlay.tsx, RedactionContextMenu.tsx, CrossfadePopover.tsx, UseAnchoredPopover.ts, CSS, localization and tests.
**Interfaces:** model CrossfadeSettings; resolved source/timeline wing ranges from shared resolver; `updateRedactionCrossfade(clipId, redactionId, settings)` atomic undo action; selection redaction branch mode flag.
- [ ] Test new-Redact defaults, independent copying, settings history and malformed updates before implementation.
- [ ] Implement default creation for all Redact paths, preserve settings in split/copy, and add atomic settings action.
- [ ] Add component tests proving idle/selected hide fade controls, one right-click entry opens portal, disabled can reopen, equal-width drag and cancellation work.
- [ ] Implement square frame with unified rails and gradient hatch wings using theme tokens; derive actual ranges from resolver.
- [ ] Floating editor prioritizes above with 8px gap/margin, flips below, clamps horizontally, repositions on scroll/resize, closes on missing anchor.
- [ ] Test focus restore, escape priority and local input shortcuts; no fixed audio footer editor.
- [ ] Commit UI/model integration.

## Task 6: Full verification, acceptance and review

**Files:** Updated architecture/key documentation and docs/superpowers/reports/2026-09-18-redact-crossfade-verification.md.
- [ ] Run `npm run format` and `npm run check`; fix all introduced failures, report pre-existing issues accurately.
- [ ] Read Docker harness scenarios, discover available Docker MCP connection and verify it targets this checkout with fresh copied source.
- [ ] Execute baseline plus crossfade creation, settings, edges, undo/reopen and edited export checks; preserve evidence or explicit BLOCKED reasons.
- [ ] Run fresh independent branch review; address consequential findings with regression tests and rerun appropriate checks.
- [ ] Record measured results, limitations, source revision and final clean status; do not merge into main without instruction.
