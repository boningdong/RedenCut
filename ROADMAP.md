# RedenCut Roadmap

This roadmap records delivered product capabilities, the current milestone, and intended future work.
Repository rules live in [`AGENTS.md`](AGENTS.md) and its linked standards rather than being repeated here.

Status legend: ✅ complete, 🚧 in progress, ⏳ planned.

## Current Product Baseline

| Area | Status | Delivered capability |
| --- | --- | --- |
| Foundation | ✅ | Electron main, preload, shared, and renderer layers; typed IPC; project schemas; binary resolution; automated quality gate. |
| Import and waveform | ✅ | Managed copy/reference import, portable project bundles, regenerable PCM and binary waveform caches, protected bounded-range access, selections, muted overlays, and split markers. |
| Playback | ✅ | PCM-only `WorkletAudioPlayer`, shared source providers, bounded per-track queues, multi-source playback, seeking, mute/solo handling, diagnostics, and preview-mode skipping. |
| Core editing | ✅ | Split, mute, unmute, clip removal, clip movement, selection, undo, redo, and atomic managed-package save/load. |
| Transcript | ✅ | Local whisper.cpp generation, word-level timestamps, per-track visibility and generation, click-to-seek, active-word highlighting, text-driven muting, timestamp calibration, and muted-word display control. |
| Multi-track timeline | 🚧 | Stacked tracks, track headers, browse-based track addition, track removal, clip repositioning, and synchronized playback are implemented; file-drop import and remaining polish are pending. |
| Export | 🚧 | Main-owned destination selection, MP3/WAV/FLAC/AAC encoding, output placement, clip/track gain, mute/solo routing, multi-track mixing, and progress events are implemented; track speech loudness leveling is implemented; configurable final-master loudness and richer error presentation remain incomplete. |

## Current Milestone — Complete Timeline and Export

### Timeline and Track UX

- [x] Register multiple managed audio sources and persist stable source identities.
- [x] Render stacked track lanes with shared playback position.
- [x] Move clips across tracks with exact placement previews, multi-selection, optional snapping, overlap resolution, and seam insertion.
- [x] Trim and restore clip edges non-destructively; cut, copy, paste, duplicate, and batch mute/delete clips with atomic undo.
- [x] Edit track names and expose mute, solo, volume, and removal controls.
- [x] Add tracks through the native audio-file browser.
- [ ] Accept supported audio through file drop with the same validation and loading path as browse-based import.
- [x] Route waveform M and selection-based Delete through the selected track.
- [ ] Add focused shortcut tests for modifier, focus, selection, and track-routing behavior.
- [ ] Complete interaction and accessibility polish for track controls and clip movement.

### Transcript

- [x] Associate words with managed audio sources and tracks.
- [x] Generate transcripts for one track or all tracks without replacing unrelated words.
- [x] Toggle multiple transcript tracks through `visibleTrackIds` and merge visible words by output time.
- [x] Route text-driven muting using each selected word's track and source association.

### Export

- [x] Validate project snapshots in the main process before rendering.
- [x] Build an FFmpeg filter graph from unmuted clips and mix multiple tracks.
- [x] Export MP3, WAV, and AAC and report progress to the renderer.
- [x] Use a main-owned native save dialog without exposing destination paths to the renderer.
- [x] Preserve output-timeline gaps and clip placement.
- [x] Apply clip gain and track mute, solo, and volume state consistently during export.
- [ ] Surface concise, actionable export errors instead of raw FFmpeg stderr excerpts.
- [ ] Add focused export coverage for gaps, moved clips, track controls, multiple sources, and failure reporting.

## Phase 4 — Audio Polish ⏳

### Loudness Normalization

- [x] Non-destructive track speech leveling and loudness normalization, including synchronized replacement sources, shared by prepared playback and export.
- [ ] Add optional final-master two-pass loudness normalization independent of per-track processing.
- Make loudness and true-peak settings editable in the export UI.
- Verify rendered loudness against the requested target with representative fixtures.

### Gain and Crossfades

- [x] Apply clip gain, post-effect track gain, and track volume during playback and export.
- Add configurable crossfades at edit boundaries to prevent audible clicks.
- [x] Share transition rendering semantics and effect ordering between playback and export.

### Inspector

- Add a context-sensitive inspector for clip labels, gain, crossfade duration, and timing.
- Persist inspector changes through the existing project model and undo history.

## Phase 5 — Editing Intelligence ⏳

The program-level design for transcript alignment, anonymous speaker attribution, disfluency detection, and future speech generation is documented in [`docs/superpowers/specs/2026-08-27-speech-intelligence-program-design.md`](docs/superpowers/specs/2026-08-27-speech-intelligence-program-design.md).

### Verbatim Speech Analysis

- Add a replaceable speech-analysis pipeline that composes verbatim transcription, forced alignment, anonymous speaker diarization, and speaker attribution.
- Keep every analysis artifact tied to stable audio-source identity and source-relative time.
- Preserve user edits and publish complete analysis results atomically.

### Filler Detection

- Run hybrid disfluency detection only when requested and return independent source-time intervals without replacing the canonical transcript.
- Combine intended-versus-verbatim differences with configurable rule and algorithm detectors while retaining per-detector evidence.
- Let users accept, reject, or selectively apply suggestions before creating edits.

### Speaker Workflow

- Distinguish anonymous local speakers without attempting real-world voice identification.
- Support persistent, editable speaker labels and transcript badges.

### Transition Review

- Detect potentially abrupt edit boundaries and present them for review.
- Keep all suggested corrections non-destructive and user-controlled.

## Phase 6 — Plugin System ⏳

- Create a separately approved plugin-system design before adding extension points.
- Define a validated manifest and a narrow, versioned plugin contract.
- Isolate plugin project data and storage from core application state.
- Add controlled contribution points for commands, panels, transcription engines, edit detectors, and export processing.
- Build a first-party plugin to validate that the public contract is sufficient without privileged internal access.

## Phase 7 — Assisted Speech Generation ⏳

- Let an authorized user generate speech in a selected speaker's voice through a replaceable synthesis engine.
- Insert generated speech at a text position or replace a selected source interval using normal managed audio sources and clips.
- Match duration, loudness, room character, and edit boundaries before publishing a reversible timeline edit.
- Keep restricted model adapters outside the distributable core when their licenses require separate installation or authorization.

## Engineering Follow-up — After Clip Redaction Overlay

- [ ] Standardize existing project-owned TypeScript/JavaScript module filenames to PascalCase following [file organization standards](docs/file-organization-standards.md), including corresponding test basenames.
- [ ] Update imports, dynamic loading/worklet references, build and test configuration, tooling references and documentation links; explicitly verify case-only renames on case-sensitive Linux as well as macOS.
- [ ] Keep this as a mechanical refactor after overlay implementation and acceptance; verify formatting, lint, types, tests, build and relevant Docker harness flows without changing product behavior.

## Known Issue

| Issue | Current behavior | Intended direction |
| --- | --- | --- |
| Preview-mode transition gap | Seeking past a muted region can briefly drain the worklet queue before new audio arrives. | Add lookahead buffering across the next preview skip without moving preview logic into the player abstraction. |

## Authoritative References

| Topic | Source |
| --- | --- |
| Repository instructions | [`AGENTS.md`](AGENTS.md) |
| Architecture rules | [`docs/architecture-standards.md`](docs/architecture-standards.md) |
| Coding and verification rules | [`docs/coding-standards.md`](docs/coding-standards.md) |
| Keyboard interaction contract | [`docs/key-mappings.md`](docs/key-mappings.md) |
| Persisted project model | [`src/shared/project.types.ts`](src/shared/project.types.ts) |
| IPC contract | [`src/shared/ipc.types.ts`](src/shared/ipc.types.ts) |
| Playback contract | [`src/shared/player.types.ts`](src/shared/player.types.ts) |
| Transcription contract | [`src/shared/transcriber.types.ts`](src/shared/transcriber.types.ts) |
