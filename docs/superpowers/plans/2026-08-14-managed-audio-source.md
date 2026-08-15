# Managed AudioSource and PCM Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace path-identified sources and compressed renderer decoding with portable managed project bundles, regenerable PCM/waveform caches, and bounded AudioWorklet playback.

**Architecture:** Main owns a temporary or saved `.podcut` workspace, import transactions, FFmpeg, cache validation, source resolution, and protected resource routes. Renderer receives source/cache descriptors, reads bounded PCM and waveform ranges through `podcut://cache`, shares stateless providers by `AudioSourceId`, and feeds one bounded AudioWorklet queue per track.

**Tech Stack:** Electron 40, React 19, TypeScript 5.9, Zod 4, Zustand 5, Vitest 4, FFmpeg/FFprobe.

## Global Constraints

- The managed package is the first published project format and uses schema version `1`; the unpublished JSON shape is rejected rather than migrated.
- New projects process audio at exactly 48 kHz.
- Copy mode is the default and reference mode remains explicitly selectable.
- One import may be active at a time.
- PCM is interleaved little-endian Float32; provider output is planar Float32.
- Waveform levels use 256, 4,096, and 65,536 samples per eight-byte min/max bucket aggregated across channels.
- PCM providers are shared by source, while playback queues are isolated by track.
- Queue target is two seconds and the hard maximum is three seconds per active track.
- AudioWorklet is required; no compressed or media-element playback fallback remains.
- Filesystem paths never cross renderer IPC except the persisted absolute path inside a reference-mode `AudioSource`.
- Follow strict red-green-refactor TDD and commit each independently testable task.

---

### Task 1: Managed project, import, cache, and player contracts

**Files:** Modify `src/shared/project.types.ts`, `src/shared/project.types.test.ts`, `src/shared/player.types.ts`, `src/shared/ipc.types.ts`; create `src/shared/import.types.ts`.

**Interfaces:** Produce `AudioSourceId`, `ProjectRelativePath`, `AudioSource`, version-1 `ProjectFile`, `AudioSourceCacheDescriptor`, `AudioSampleProvider`, import state/progress/result types, and path-free IPC contracts.

- [ ] Add failing schema tests for a valid managed project, rejection of the unpublished shape, UUID source identity, unsafe package paths, and two clips sharing one source.
- [ ] Run `npm test -- src/shared/project.types.test.ts` and confirm failures are caused by the missing managed schema.
- [ ] Implement the Zod schemas and derived TypeScript types, rename clip/word relationships to `audioSourceId`, and remove legacy fields.
- [ ] Add the cache, provider, workspace, import, and IPC types with the exact signatures in the design.
- [ ] Run the focused tests and `npm run typecheck`; use the compiler errors as the inventory for later implementation without adding compatibility aliases.
- [ ] Commit with `feat: define managed audio project contracts`.

### Task 2: Safe package paths

**Files:** Create `src/main/project/ProjectPathResolver.ts` and `src/main/project/ProjectPathResolver.test.ts`.

**Interfaces:** `ProjectPathResolver.resolve(relativePath)` returns a contained OS path; `toRelative(absolutePath)` returns a normalized branded path.

- [ ] Add failing tests for valid media/cache paths; POSIX and Windows absolute paths; backslashes; empty, dot, and parent segments; symlink escape; and safe non-existing descendants.
- [ ] Run the focused test and confirm unsafe values are currently accepted because the resolver is absent.
- [ ] Implement lexical normalization plus realpath containment against the nearest existing ancestor.
- [ ] Run the focused tests and node-side typecheck.
- [ ] Commit with `feat: constrain project package paths`.

### Task 3: Cache manifest and store

**Files:** Create `src/main/audio/cache/cacheManifest.ts`, `cacheManifest.test.ts`, `AudioSourceCacheStore.ts`, and `AudioSourceCacheStore.test.ts`.

**Interfaces:** Parse generator `podcut-cache-v1`; validate, describe, publish, locate, and remove source-specific caches.

- [ ] Add failing tests for supported manifests, wrong versions/generators/source hashes, unsafe paths, missing artifacts, wrong PCM size, wrong waveform size, and manifest-last publication.
- [ ] Implement manifest schemas and exact size arithmetic (`frames × channels × 4`, `buckets × 8`).
- [ ] Implement staged-cache publication and cache-miss behavior without exposing paths in descriptors.
- [ ] Run focused tests and `npm run typecheck`.
- [ ] Commit with `feat: validate and publish audio caches`.

### Task 4: Single-pass FFmpeg cache builder

**Files:** Create `src/main/audio/import/PcmWaveformAccumulator.ts`, its test, `FfmpegAudioSourceCacheBuilder.ts`, and its test.

**Interfaces:** `build(request, signal, onProgress)` streams one FFmpeg decode into staged PCM and all waveform levels.

- [ ] Add failing accumulator tests with deliberately split byte/channel frames, literal min/max expectations, 16:1 level aggregation, and partial final buckets.
- [ ] Implement the bounded streaming accumulator and rerun the focused tests.
- [ ] Add failing builder tests for backpressure, 250 ms progress heartbeat, abort/kill/cleanup, `ENOSPC`, and manifest-last completion using event-controlled fakes.
- [ ] Implement the FFmpeg process adapter and staged writers, preserving stream backpressure.
- [ ] Add a real-FFmpeg regression test that creates an MP3 larger than 256 KiB, builds its cache, and verifies non-silent PCM near the end.
- [ ] Run all cache/import tests and `npm run typecheck`.
- [ ] Commit with `feat: build pcm and waveform caches`.

### Task 5: Workspace lifecycle and atomic save

**Files:** Create `src/main/project/ProjectWorkspace.ts`, `ProjectWorkspace.test.ts`, and focused filesystem/publication helpers as required by ownership boundaries.

**Interfaces:** Initialize/open/save/saveAs the active workspace and return `{ project, workspace, sources }` without resource paths.

- [ ] Add failing tests for temporary initialization, saved-project opening, temporary Save routing through Save As, atomic saved Save, sibling staging, validation, destination backup/rollback, switch-before-cleanup, cancellation, and failure preserving the old root.
- [ ] Implement the temporary bundle and atomic `project.json` writer.
- [ ] Implement Save As copy/validate/publish/switch/cleanup with injected destination selection.
- [ ] Implement open validation and cache-regeneration hooks without switching on failure.
- [ ] Run project tests and `npm run typecheck`.
- [ ] Commit with `feat: manage project package workspaces`.

### Task 6: Atomic import coordination

**Files:** Create `src/main/audio/import/ImportCoordinator.ts`, `ImportCoordinator.test.ts`, and source fingerprint/copy helpers.

**Interfaces:** Consume a single-use selection, mode, project snapshot, and import ID; return the updated project and descriptor only after publication.

- [ ] Add failing state-machine tests covering copy, reference, UUID identity, fingerprinting, source/track/clip insertion, atomic project update, rollback, missing references, low disk, and rejection of a concurrent import.
- [ ] Add deterministic cancellation tests for acknowledgement within 100 ms, cleanup within 500 ms, and prevention of late publication.
- [ ] Implement streaming copy/hash, reference validation/hash, preflight disk estimation, cache build, dual artifact publication, and rollback.
- [ ] Run import tests and `npm run typecheck`.
- [ ] Commit with `feat: publish managed audio imports`.

### Task 7: Explicit services, protected protocol, IPC, and preload

**Files:** Refactor `src/main/index.ts`, `src/main/ipc/*.ipc.ts`, `src/preload/index.ts`; create protocol/service tests.

**Interfaces:** Register handlers with injected services; serve only `podcut://cache/<id>/pcm` and `/waveform/<level>`; expose initialize/open/save/import/cancel APIs.

- [ ] Add failing tests for single-use sender-scoped selection tokens, exact preload conformance, protected routes, invalid IDs/levels, range forwarding, bounded responses, and preservation of the active workspace on open failure.
- [ ] Replace side-effect imports with explicit handler registration after `app.whenReady()` and before renderer loading.
- [ ] Replace arbitrary-path protocol resolution with active-workspace manifest lookup.
- [ ] Update preload and shared IPC together, including typed import progress subscriptions.
- [ ] Run IPC/protocol tests, `npm run typecheck`, and `npm run build`.
- [ ] Commit with `feat: expose managed audio services`.

### Task 8: Bounded PCM and binary waveform providers

**Files:** Create `src/renderer/src/audio/samples/ContinuousPcmSampleProvider.ts` and tests; create `components/Waveform/BinaryWaveformDataProvider.ts` and tests.

**Interfaces:** Providers derive protected URLs from source IDs and descriptors and perform abortable bounded range fetches.

- [ ] Add failing PCM tests for exact range math, EOF clamping, little-endian deinterleaving, short reads, abort, malformed/full-response rejection, and concurrent stateless reads.
- [ ] Implement the PCM provider and rerun focused tests.
- [ ] Add failing waveform tests for level choice, visible bucket bounds, eight-byte decoding, pixel aggregation, shared providers, and stale request cancellation.
- [ ] Implement the binary provider and rerun the waveform suite.
- [ ] Run renderer typecheck and commit with `feat: read bounded audio cache ranges`.

### Task 9: Frame-domain playback plan and worklet queue

**Files:** Replace `src/renderer/src/audio/buildSegments.ts` with `playbackPlan.ts`; update tests; replace `AudioPlayerWorklet.ts` and add worklet-host tests.

**Interfaces:** Plan source-frame and silence segments per track; worklet messages carry generation, channels, gain, and frame counts.

- [ ] Add failing playback-plan tests for exact source/output mapping, clip boundaries, silence gaps, mute/solo, volume/gain, source switches, and one source concurrently on two tracks.
- [ ] Implement the pure frame planner and rerun its tests.
- [ ] Evaluate the real worklet module under a mocked AudioWorklet host and add failing tests for queueing, channel mapping, gain, refill requests, three-second rejection, generation flush, started, underrun, and lifetime.
- [ ] Implement the acknowledged worklet queue and rerun focused tests.
- [ ] Commit with `feat: schedule bounded pcm playback`.

### Task 10: PCM-only WorkletAudioPlayer

**Files:** Create `src/renderer/src/audio/WorkletAudioPlayer.ts` and tests; update `src/shared/player.types.ts` only if tests reveal a contract gap.

**Interfaces:** Register/remove source providers, manage one queue per track, retain existing transport/events, add actionable error subscription and diagnostics.

- [ ] Add failing tests using real player behavior with fake browser boundaries for sample-rate validation, per-track nodes, synchronized prefill/start, queue limits, acknowledgements, warm pause, seek cancellation/generation, structural versus volume updates, shared sources, events, diagnostics, and destroy.
- [ ] Implement minimal playback lifecycle behavior in red-green slices rather than one monolithic change.
- [ ] Add deterministic sustained-playback and seek-stress tests requiring zero underruns and no stale chunks.
- [ ] Run all audio tests and `npm run typecheck`.
- [ ] Commit with `feat: play managed pcm through audio worklets`.

### Task 11: Renderer orchestration and UI integration

**Files:** Refactor `src/renderer/src/App.tsx`, timeline/editor stores and tests, `WaveformView.tsx` and tests; create focused project/import and player-lifecycle hooks/components.

**Interfaces:** Renderer state stores `audioSources`, cache descriptors, and workspace status; import UI defaults to copy and exposes reference.

- [ ] Add failing UI/store tests for temporary startup, canceled selection, progress/cancel, publication-only track appearance, failure preservation, atomic package open, Save versus Save As, provider reuse, and per-clip waveform source selection.
- [ ] Migrate timeline, transcript, word-time, mute/split/move, snapshot, and display code from `sourceFileId` to `audioSourceId`.
- [ ] Integrate PCM and waveform provider registries and `WorkletAudioPlayer`.
- [ ] Extract root orchestration from `App.tsx` only along the project/import/player responsibility boundaries.
- [ ] Run renderer and store tests plus `npm run typecheck`.
- [ ] Commit with `feat: integrate managed audio workflow`.

### Task 12: Managed transcription and export

**Files:** Refactor transcript/render IPC, `src/main/audio/renderer.ts`, its tests, and `ExportModal.tsx`.

**Interfaces:** Main resolves originals by `AudioSourceId`; export destination comes from a main-process save dialog.

- [ ] Add failing tests for copied/reference source resolution, portable copied export after original removal, missing references, stable FFmpeg input mapping, destination cancellation, and absence of renderer-provided output paths.
- [ ] Implement main-owned original resolution for transcription and export.
- [ ] Replace the prompt/path field in ExportModal with main-owned destination selection.
- [ ] Run render/transcript tests, UI tests, and `npm run typecheck`.
- [ ] Commit with `feat: route media operations through audio sources`.

### Task 13: Retire legacy implementations and verify

**Files:** Delete `WebCodecsPlayer.ts`, `FrameIndex.ts`, `SimpleAudioPlayer.ts`, legacy peaks/provider files; update architecture standards, roadmap, performance runner, and affected tests.

- [ ] Remove the legacy implementations only after all replacement tests pass.
- [ ] Replace obsolete architecture rules and performance instrumentation with managed-cache/player metrics.
- [ ] Run `rg "WebCodecsPlayer|FrameIndex|EncodedAudioChunk|sourceFileId|SourceFile|generatePeaks|peaks\\.json" src dev-docs ROADMAP.md` and resolve every result.
- [ ] Run `npm run format`, `npm run check`, `npm run profile:waveform`, and `git diff --check`.
- [ ] Manually exercise copy/reference import, late MP3 playback and seeking, cancellation, package reopen, Save/Save As, shared-source concurrent tracks, transcription, export, and waveform pan/zoom; record anything not verifiable in the environment.
- [ ] Commit with `refactor: retire compressed audio playback`.

## Final acceptance

- No full PCM read or full waveform-pyramid renderer transfer.
- Two-second target and three-second hard queue maximum per track.
- No stale seek, import, or waveform publication.
- Zero deterministic playback underruns.
- Late frames from the MP3 regression fixture are readable without WebCodecs.
- Copied packages work after the external original is removed.
- Reference failures preserve the active project and report the missing source.
- Formatting, lint, dead-code analysis, typecheck, unit/integration tests, performance checks, and production build pass.
