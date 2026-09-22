# Track Loudness Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship non-destructive speech loudness leveling, post-effect track gain and A2 track controls.
**Architecture:** Resolve replacement contributions first, then process the complete track using one shared FFmpeg filter chain. Playback uses disk-backed prepared PCM; export uses the same chain; settings persist independently from derived caches.
**Tech Stack:** Electron, React, Zustand, Zod, TypeScript, managed FFmpeg, Vitest.
**Spec:** docs/superpowers/specs/2026-09-21-track-loudness-effects.md

## Global Constraints
- User explicitly waived human document review and requested execution.
- 48 kHz, non-destructive media, session-scoped typed IPC, no paths accepted from renderer.
- A2 controls: 26 px row height, six columns, first row Sync/Mute/Solo/Volume spanning 1/1/1/3, second Effects/Gain spanning 3/3.
- gainDb optional in source Track type, effective default 0, range -24..24.
- Normalize defaults -16 LUFS, -1.5 dBTP, LRA 7; speech leveling precedes loudness normalization.

## Review Focus
- Same-track alternating speakers need reduced loudness differences, not merely integrated gain: Task 2 audio integration.
- A replacement edit during pending preparation must invalidate old audio: Task 2 lifecycle tests.
- Reload and undo must preserve applied effects and gain: Tasks 1 and 3.
- Long files and partial IPC reads must remain bounded: Task 2.
- Disabled/linked tracks must not double-process stems: Tasks 1 and 2.

## Task 1: Project settings, shared contract and edit history
Files: src/shared/TrackEffects.ts (new), ProjectTypes.ts, audio/AudioRenderPlan.ts, audio/AudioRenderPlanBuilder.ts, renderer/src/stores/TimelineStore.ts; adjacent tests.
Consumes existing source routing and Track snapshots.
Produces getNormalizeEffect(track), trackGain(track), NORMALIZE_DEFAULTS, normalizationFilter(params); optional TrackRenderPlan.gainDb and .normalize.
- [x] Write failing tests for v2/v3 migration to v4, v4 normalize/gain roundtrip and range rejection.
- [x] Implement Zod normalize variant alongside legacy effect variants; reject new settings in old version declarations.
- [x] Implement shared defaults and filter parameters, post-effect gain conversion `10 ** ((track.gainDb ?? 0) / 20)`.
- [x] Add TimelineStore.setTrackGain(trackId, gainDb), setTrackVolume(trackId, volume), toggleTrackNormalize(trackId), each recording one snapshot only when value changes and rejecting linked children.
- [x] Test enabling/disabling/re-enabling without duplicate effects and undo/redo, including gain=0 and invalid values.
- [x] Pass targeted tests and commit owned files.

## Task 2: Real normalization in playback and export
Files: new main/audio/effects preparation/read service, shared typed IPC, preload adapter, main IPC registration, renderer audio prepared-provider adapter; WorkletAudioPlayer.ts, PlaybackStructure.ts, FfmpegPlanCompiler.ts; focused tests.
Consumes shared getNormalizeEffect/normalizationFilter and TrackRenderPlan fields.
Produces audible normalized playback with random seeking and equivalent normalized export, safe cancellation/disposal.
- [x] Write failing tests proving compiler processes mixed replacement contributions before Normalize, Gain and Volume.
- [x] Add shared normalizationFilter invocation to compiler, then gainDb conversion before Volume.
- [x] Prepare complete composite to f32le at 48 kHz via managed FFmpeg, with content cache identity and bounded read validation.
- [x] Add validated active-session IPC prepare/read lifecycle; do not trust renderer filesystem paths.
- [x] Worklet queue preparation awaits normalized PCM, uses generation guards, keeps raw behavior without effects and live gain/volume updates without expensive rebuild.
- [x] Test seek, stale completion, missing source, process failure, linked-child settings ignored, bounded reads and dispose cleanup.
- [x] Use managed FFmpeg on alternating quiet/loud synthetic speech-like fixture to measure level-gap reduction and source hash stability.
- [x] Run relevant audio/IPC tests, record numeric results and commit owned files.

## Task 3: A2 UI and interactions
Files: TrackHeader.tsx, new TrackLevelControl.tsx and TrackEffectsMenu.tsx, scoped CSS, shared i18n resources, existing Icon.tsx as needed; adjacent component tests.
Consumes track.gainDb/effects and Task 1 store actions.
- [x] Write component tests for Effects icon, highlighted active button, checkmark persistence and toggle-off.
- [x] Implement approved two-row grid and transparent A2 value controls, click-triggered upward popovers, 26px equal heights and visible focus.
- [x] Commit gain/volume changes once per drag/keyboard gesture; preserve source controls/read-only child semantics.
- [x] Preserve remove/expand safely off the track-name button row using accessible context actions.
- [x] Test native pointer/keyboard state, Escape/outside dismissal, localization and undo callback behavior.
- [x] Pass component tests and commit owned files.

## Task 4: Integration and acceptance
- [x] Run formatter and full npm run check, investigate introduced failures, do not remove unrelated runtime references to satisfy Knip.
- [x] Read agent-testing scenario index, Docker harness and keyboard contract; attempt baseline plus changed-behavior acceptance only in owned Docker run.
- [x] If unavailable, write evidence-backed BLOCKED report with missing capability; do not substitute host Electron.
- [x] Independent review of final diff, fix findings, re-run affected checks.
- [x] Update architecture standards and roadmap to reflect actual implementation and limitations, keep historical docs here.
- [x] Commit and hand off branch/worktree with checks and remaining acceptance risks; do not merge or push without request.

## Completion evidence
Full check:186 files/1444 tests passed, format/lint/knip/typecheck/build passed.
Docker run0d670276-aad7-49fc-9eb8-c63ed6cbde4c covered UI,Save As,restart,reopen,source replacement and export; complete acceptance remains BLOCKED for unavailable subjective listening and unobserved asynchronous failure/loading UI.
Review findings for mono/stereo topology and save/session lifecycle were fixed and reviewed again with no remaining blockers.
