# Managed AudioSource and PCM Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Tasks 1–13 are the completed historical baseline through commit `20f4a15`; their unchecked boxes preserve the original delivery record and must not be re-executed. Current remediation begins at Task 14 and proceeds sequentially through Task 22.

**Goal:** Replace path-identified sources and compressed renderer decoding with portable managed project bundles, regenerable PCM/waveform caches, and bounded AudioWorklet playback.

**Architecture:** Main owns a temporary or saved `.redencut` workspace, import transactions, FFmpeg, cache validation, source resolution, and protected resource routes. Renderer receives source/cache descriptors, reads bounded PCM and waveform ranges through `redencut://cache`, shares stateless providers by `AudioSourceId`, and feeds one bounded AudioWorklet queue per track.

**MP3 regression anchor:** The replacement must make the old failure mode unreachable: `WebCodecsPlayer` split MP3 input into arbitrary 32,768-byte decoder chunks and extrapolated seeks beyond its first-256-KiB index sample, leading to decoder closure, roughly one-second playback, and broken late seeks. The real-FFmpeg cache test and PCM-only player retirement task jointly guard this requirement.

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
- Filesystem paths and source fingerprints never cross renderer IPC; the complete persisted `ProjectFile` remains main-owned.
- Every renderer mutation carries an opaque workspace token and expected controller-wide monotonic revision.
- Initialize, open, Save, Save As, and import commit transitions are serialized by one main-process mutex.
- One Electron application instance owns one active project session per window.
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

**Interfaces:** Parse generator `redencut-cache-v1`; validate, describe, publish, locate, and remove source-specific caches.

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

**Interfaces:** Register handlers with injected services; serve only `redencut://cache/<id>/pcm` and `/waveform/<level>`; expose initialize/open/save/import/cancel APIs.

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
- [ ] Run `rg "WebCodecsPlayer|FrameIndex|EncodedAudioChunk|sourceFileId|SourceFile|generatePeaks|peaks\\.json" src docs ROADMAP.md` and resolve every result.
- [ ] Run `npm run format`, `npm run check`, `npm run profile:waveform`, and `git diff --check`.
- [ ] Manually exercise copy/reference import, late MP3 playback and seeking, cancellation, package reopen, Save/Save As, shared-source concurrent tracks, transcription, export, and waveform pan/zoom; record anything not verifiable in the environment.
- [ ] Commit with `refactor: retire compressed audio playback`.

### Task 14: Path-free renderer session contracts

**Files:** Create `src/shared/session.types.ts`, `src/shared/session.types.test.ts`, `src/main/project/sessionProjection.ts`, and `src/main/project/sessionProjection.test.ts`; modify `src/shared/project.types.ts`, `src/shared/import.types.ts`, `src/shared/ipc.types.ts`, `src/renderer/src/stores/timeline.store.ts`, and `src/renderer/src/stores/timeline.store.test.ts`.

**Interfaces:** Produce the final path-free DTO and mutation envelope without changing `ProjectFileSchema` or `project.json`:

```ts
export type WorkspaceToken = string & { readonly __brand: 'WorkspaceToken' }

export interface SessionPrecondition {
  workspaceToken: WorkspaceToken
  revision: number
}

export interface RendererAudioSource {
  id: AudioSourceId
  displayName: string
  metadata: AudioMetadata
  cache: AudioSourceCacheDescriptor
}

export interface ProjectDraft {
  tracks: Track[]
  transcript?: Transcript
  export: ProjectFile['export']
}

export interface RendererSession extends SessionPrecondition {
  workspace: WorkspaceDescriptor
  sources: RendererAudioSource[]
  draft: ProjectDraft
}

export interface ProjectMutationRequest extends SessionPrecondition {
  draft: ProjectDraft
}
```

- [ ] Add failing contract tests that serialize a Reference-mode `ProjectFile` through `toRendererSession` and assert the JSON contains no `location`, `path`, `fingerprint`, SHA-256, `createdAt`, `pluginData`, or package-relative path while retaining source ID, display name, audio metadata, cache descriptor, tracks, transcript, export settings, token, and revision.
- [ ] Run `npx vitest run src/shared/session.types.test.ts src/main/project/sessionProjection.test.ts` and confirm failure because the session DTO and projection do not exist.
- [ ] Implement `toRendererSession(workspace, token, revision, descriptors)` and `mergeProjectDraft(authoritative, draft)`; the merge may change only `tracks`, `transcript`, and `export`, and must finish with `ProjectFileSchema.parse` so unknown source IDs and invalid clips are rejected.
- [ ] Add a mutation test proving a forged renderer object cannot replace an authoritative reference path or fingerprint, plus a test proving non-renderer fields survive a valid draft merge.
- [ ] Add failing timeline-store tests that put entries in both history stacks and both selected IDs, call `initFromAudioSource` and `loadFromProject`, and expect `undoStack`, `redoStack`, `selectedTrackId`, and `selectedClipId` all to reset; implement the complete reset.
- [ ] Migrate timeline renderer source typing from persisted `AudioSource` to `RendererAudioSource` without adding compatibility aliases.
- [ ] Run the focused tests and `npm run typecheck`.
- [ ] Commit with `feat: define path-free renderer sessions`.

### Task 15: Serialized workspace authority and revisions

**Execution note:** Tasks 15 and 16 are one compile-atomic integration unit because the controller's `RendererSession` and `ProjectMutationRequest` signatures cannot typecheck until their direct IPC, preload, and renderer consumers migrate. Implement and review both tasks together without a temporary `ProjectFile` overload or compatibility shim.

**Files:** Create `src/main/project/AsyncMutex.ts`, `src/main/project/AsyncMutex.test.ts`; modify `src/main/project/WorkspaceController.ts`, `src/main/project/WorkspaceController.test.ts`, `src/main/project/ProjectWorkspace.ts`, and `src/main/project/ProjectWorkspace.test.ts`.

**Interfaces:** `WorkspaceController` owns one `AsyncMutex`, one active `ProjectWorkspace`, one opaque token, and a controller-wide monotonic revision. Produce:

```ts
initialize(temporaryParent: string): Promise<RendererSession>
describe(): Promise<RendererSession>
save(request: ProjectMutationRequest): Promise<RendererSession>
saveAs(destination: string, request: ProjectMutationRequest): Promise<RendererSession>
prepareOpen(root: string): Promise<PreparedWorkspace>
commitPreparedOpen(candidate: PreparedWorkspace, expected: SessionPrecondition): Promise<RendererSession>
assertCurrent(expected: SessionPrecondition): void
```

Public workspace transitions acquire the controller mutex. Compound operations use one controller-owned transaction capability that exposes locked Save, Save As, candidate preparation, import commit, and workspace switch primitives without recursively acquiring the mutex. Long import copying/cache preparation runs as a registered session job outside this mutex and acquires it only for the single precondition-rechecked publish/commit boundary.

- [ ] Add a failing mutex test with two deferred operations and assert the second body does not enter until the first exits, including rejection release.
- [ ] Add controller tests for initialization token/revision, normal Save retaining token and incrementing revision, Save As rotating token and incrementing revision, stale token rejection, stale revision rejection, and failures leaving token/revision unchanged.
- [ ] Add deterministic interleaving tests that pause descriptor validation and project writes, overlap Save/Open/Save As/import-commit entry, and prove an operation always writes to its captured workspace rather than whichever workspace later becomes current.
- [ ] Add a compound-transition test proving dirty Open holds the same mutex across Save, candidate preparation, and switch while a concurrent public Save remains queued; prove the implementation never deadlocks by recursively acquiring its own mutex.
- [ ] Refactor `ProjectWorkspace.saveAs` to return a prepared saved `ProjectWorkspace` instead of mutating the old object. Add `close()` whose only deletion behavior is removing that exact workspace when it is temporary; closing a saved workspace is a no-op.
- [ ] Add tests proving the active workspace switches only after candidate validation, an old temporary root is deleted only after a successful switch, a failed switch preserves it, and an old saved `.redencut` root is never deleted.
- [ ] Implement exact precondition validation and revision advancement inside the mutex; capture the active workspace once per operation and never re-read `this.workspace` after an `await`.
- [ ] Run `npx vitest run src/main/project/AsyncMutex.test.ts src/main/project/ProjectWorkspace.test.ts src/main/project/WorkspaceController.test.ts` and `npm run typecheck`.
- [ ] Commit with `fix: serialize workspace transitions`.

### Task 16: Path-free IPC and renderer session state

**Files:** Create `src/main/project/SessionJobRegistry.ts`, `src/main/project/SessionJobRegistry.test.ts`, and IPC error-mapping helpers/tests; modify every `src/main/ipc/*.ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.types.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/stores/editor.store.ts`, and focused tests.

**Interfaces:** Initialize, describe, Save, Save As, Open, import, transcription, and export carry `SessionPrecondition` and path-free DTOs only. This task establishes the boundary and registry but does not yet enable transactional project switching.

- [ ] Add failing conformance tests proving no preload argument, result, progress event, or serialized error contains `ProjectFile`, source location/fingerprint, package path, selected project path, export destination, or nested raw filesystem error text.
- [ ] Replace every raw `ProjectFile` preload argument/result with `RendererSession`, `ProjectDraft`, `RendererAudioSource`, `AudioSourceId`, and job envelopes. Main merges drafts into its authoritative project and validates before use.
- [ ] Add registry tests proving closing sessions reject new jobs, cancel is idempotent, settlement awaits every registered promise, sender destruction cancels sender-owned jobs, and jobs from another token are untouched.
- [ ] Refactor renderer session loading to use a load epoch. A stale async provider setup must destroy itself and cannot overwrite a newer token/revision.
- [ ] Track a local renderer edit revision. Save captures it and clears dirty only if unchanged when the acknowledged main revision returns; button and keyboard failures use the same visible path-free error path.
- [ ] Keep Open temporarily routed through the revisioned controller entry point; Task 21 replaces it with the fully transactional dirty-open coordinator after all job types have real cancellation contracts.
- [ ] Run IPC/preload contract, App/session, store, provider, registry, and `npm run typecheck` tests.
- [ ] Commit with `feat: enforce path-free revisioned sessions`.

### Task 17: Atomic import cancellation and bounded FFmpeg diagnostics

**Files:** Modify `src/main/audio/import/ImportCoordinator.ts`, `src/main/audio/import/ImportCoordinator.test.ts`, `src/main/audio/import/FfmpegAudioSourceCacheBuilder.ts`, `src/main/audio/import/FfmpegAudioSourceCacheBuilder.test.ts`, `src/main/ipc/audio.ipc.ts`, `src/shared/import.types.ts`, `src/preload/index.ts`, and renderer import tests.

**Interfaces:** Import requests/results/progress carry job ID, token, and revision. Cancellation returns `cancelled`, `commit-won`, or `not-found`, and job state is `preparing`, `committing`, `committed`, `cancelled`, or `failed`.

- [ ] Add deterministic tests that pause immediately before the commit boundary. Cancellation while preparing awaits child/staging cleanup and prevents publication; cancellation after committing begins returns `commit-won` and preserves one consistent result.
- [ ] Prove copy/FFmpeg/cache preparation does not hold the workspace mutex: Open can validate and cancel a preparing import, while publication acquires the mutex exactly once and revalidates token/revision.
- [ ] Add stale-session and sender-destruction tests proving no old artifact, progress, or result enters a successor session; bind selection tokens to sender plus token/revision.
- [ ] Replace rollback-after-save with one explicit commit boundary. `cancelImport` must await settlement before returning `cancelled`.
- [ ] Add fake-child tests for more than 4 KiB stderr, failure/abort, delayed `close`, single kill, reap-before-cleanup, and closed streams; retain only a 4 KiB diagnostic tail.
- [ ] Register import jobs with `SessionJobRegistry`. Renderer merges the returned source/track/cache into its current draft if local edits advanced during preparation instead of replacing the draft snapshot.
- [ ] Run import, builder, registry, session, renderer orchestration tests and `npm run typecheck`.
- [ ] Commit with `fix: make import cancellation atomic`.

### Task 18: Acknowledged AudioWorklet prefill

**Files:** Modify `src/renderer/src/audio/AudioPlayerWorklet.ts`, `src/renderer/src/audio/AudioPlayerWorklet.test.ts`, `src/renderer/src/audio/WorkletAudioPlayer.ts`, and `src/renderer/src/audio/WorkletAudioPlayer.test.ts`.

**Interfaces:** Host queue state tracks `sentFrames` separately from `acknowledgedFrames`; generation-scoped depth messages acknowledge accepted frames. `play` is posted only after every active queue acknowledges `min(TARGET_FRAMES, plannedFrames)`.

- [ ] Add a failing test whose fake port withholds depth acknowledgements; `player.play()` stays pending and no queue receives `play`.
- [ ] Add two-track, short-plan, stale-generation, destroy, seek, and rebuild tests proving only all-current-queue acknowledgement releases prefill and no late `play` occurs.
- [ ] Implement separate sent/acknowledged accounting and generation-scoped waiters without changing the two-second target, three-second hard maximum, refill threshold, or provider contracts.
- [ ] Run sustained-playback and seek-stress tests requiring zero deterministic underruns, then `npm run typecheck`.
- [ ] Commit with `fix: await acknowledged pcm prefill`.

### Task 19: Session-scoped transcription jobs

**Files:** Create `src/main/transcriber/TranscriptionCoordinator.ts` and its test; modify `src/main/transcriber/whisper.ts`, `src/main/ipc/transcript.ipc.ts`, shared/preload contracts, `src/renderer/src/App.tsx`, and transcript/App tests.

**Interfaces:** Add `TranscriptionJobId`; generate/cancel/progress/results carry job ID plus session precondition. `whisperTranscriber.transcribe` accepts an `AbortSignal`.

- [ ] Add coordinator tests for progress/result tags, explicit cancel, sender destruction, session closing, process abort/reap, and cleanup settlement.
- [ ] Add renderer tests where A resolves after B loads and same-session jobs resolve in reverse order; stale events cannot change words, draft, dirty state, visibility, or status.
- [ ] Thread abort through Whisper's process and temporary-directory lifecycle, then register jobs with `SessionJobRegistry`.
- [ ] Run transcriber, coordinator, registry, IPC, renderer tests and `npm run typecheck`.
- [ ] Commit with `fix: isolate transcription by workspace session`.

### Task 20: Cancellable atomic export jobs

**Files:** Create `src/main/audio/export/ExportCoordinator.ts` and its test; modify `src/main/ipc/render.ipc.ts`, `src/main/audio/renderer.ts`, its test, shared/preload contracts, `src/renderer/src/components/Export/ExportModal.tsx`, and add `ExportModal.test.tsx`.

**Interfaces:** Add `ExportJobId`, session-scoped progress, `render.startExport`, and `render.cancelExport`; allow one job per sender.

- [ ] Add tests for dialog cancellation, scoped progress, duplicate sender jobs, stale sessions, visible Cancel, sender destruction, session closing, spawn/nonzero failure, and success.
- [ ] Every failure/cancel path kills once, awaits `close`, removes only its sibling temporary output, and preserves pre-existing destination bytes.
- [ ] Render to a unique sibling temporary name, revalidate token/revision after code `0`, and atomically replace the destination with backup/restore semantics; never give FFmpeg the final destination.
- [ ] Make Cancel await main acknowledgement, filter progress by job/session, bound diagnostics/progress parsing, and register the job with `SessionJobRegistry`.
- [ ] Run export coordinator, render argument, registry, IPC, modal tests and `npm run typecheck`.
- [ ] Commit with `fix: make exports cancellable transactions`.

### Task 21: Transactional switching and single-instance forwarding

**Files:** Create `ProjectTransitionCoordinator.ts`, `SessionSwitchBarrier.ts`, `PendingProjectOpenRegistry.ts`, `src/main/applicationLifecycle.ts`, and focused tests; modify project IPC, preload, `src/main/index.ts`, renderer session orchestration, and error handling.

**Interfaces:** `OpenProjectRequest` is `SessionPrecondition & ({ isDirty: false } | { isDirty: true; draft: ProjectDraft })`. `OpenProjectResult` is either `{ outcome: 'switched'; session }` or `{ outcome: 'stayed'; session; reason }`. Switch messages use a sender/session-bound opaque `transitionId`. Pending external paths use a sender-bound, expiring, one-use opaque `requestId` plus display name.

- [ ] Add failing coordinator tests for dirty Cancel/Discard/Save, temporary Save As cancellation, Save failure, picker cancellation, candidate failure, job settlement failure, acknowledgement failure, success ordering, and temporary/saved cleanup.
- [ ] Before a successful dirty Save, failure preserves the exact old session. After Save succeeds, it becomes the rollback point: any later failure returns that authoritative saved session as `outcome: 'stayed'`, including its advanced revision and possible Save As token/root.
- [ ] Implement: validate precondition; prompt; optionally save; select and validate candidate; mark current token closing; cancel/settle all registered jobs; request and await playback-stop acknowledgement; atomically switch/new token/revision; close the prior workspace only after success.
- [ ] Add five-second barrier timeout, sender-destruction, wrong/duplicate ID, and shutdown tests. Outside shutdown, failure reopens the rollback-point session, releases the mutex, keeps the visible project, and returns a path-free stayed result; settled jobs remain settled.
- [ ] On `project:will-switch`, renderer invalidates epochs, stops/destroys playback, and acknowledges only after settlement; it does not clear the visible project before the returned result is applied.
- [ ] Add single-instance tests for lock win/loss, immediate secondary quit, second-instance `.redencut`, macOS `open-file`, ignored arguments, early queueing, minimized restore, and focus. Call `requestSingleInstanceLock()` before readiness; a loser initializes no workspace/protocol/IPC.
- [ ] Prove pending-open paths never enter renderer payloads, IDs are sender-bound/one-use/expiring, and both Open Project and forwarded opens use the same coordinator.
- [ ] Run transition, barrier, registry, lifecycle, IPC, renderer, and `npm run typecheck` tests.
- [ ] Commit with `feat: switch revisioned sessions transactionally`.

### Task 22: Review hygiene and complete regression verification

**Files:** Modify `src/main/protocol/fileRangeResponse.test.ts`, `src/main/protocol/cacheProtocol.integration.test.ts`, `src/main/protocol/cacheProtocolSecurity.test.ts`, `src/main/project/ProjectWorkspace.ts`, affected renderer error handling, and the SDD verification report.

- [ ] Add cleanup to file-range test fixtures and verify their exact temporary roots are absent after the suite.
- [ ] Encode integration PCM fixture bytes explicitly with `DataView.setFloat32(..., true)`.
- [ ] Make the CSP parser reject duplicate directive names and assert exactly one `connect-src` with `"'self'"` and `redencut:`; retain no `bypassCSP`.
- [ ] Route Save and Save As button rejections through the same visible error handler as keyboard Save.
- [ ] Add an injectable cleanup-warning sink and tests for failed post-switch removal of old temporary roots or destination backups; the successful workspace switch remains committed and the exact leftover path is recorded for retry rather than silently ignored.
- [ ] Run `npm run format`, `npm run check`, `npm run profile:waveform`, and `git diff --check`.
- [ ] Repeat the complete long-MP3 Reference workflow: import; renderer exact `206` observations; waveforms at beginning, around 2,400 seconds, and near 4,800 seconds; 15 seconds playback from zero; 10 seconds after seeks near 60, 2,400, and 4,800 seconds; Save As; close/relaunch/open; and 10 seconds late playback.
- [ ] Exercise dirty-open Save, Don't Save, Cancel, failed Save, invalid candidate, active import cancellation, active transcription cancellation, active export cancellation, and second-instance project forwarding. Confirm the old project remains active on every canceled/failed transition and no saved `.redencut` package is deleted.
- [ ] Confirm unchanged invariants: `connect-src 'self' redencut:`, no `bypassCSP`, no `net.fetch(file://...)`, exact bounded `206` responses, 32 MiB cap, unchanged PCM/cache layout, no active WebCodecs symbols, and no temporary diagnostic workspace left behind.
- [ ] Request one final whole-branch review and address its complete Critical/Important list in the single allowed final fix wave.
- [ ] Commit with `test: verify revisioned managed audio lifecycle`.

## Final acceptance

- No full PCM read or full waveform-pyramid renderer transfer.
- Persisted `ProjectFile` remains unchanged and main-owned; renderer sessions and drafts contain no paths or fingerprints.
- Every renderer mutation is token/revision checked and workspace mutations are serialized.
- Dirty project switching settles jobs and preserves the old session on Cancel, Save failure, or candidate failure.
- One Electron instance forwards project-open requests to the existing focused window through an opaque pending-open ID.
- Two-second target and three-second hard queue maximum per track.
- Playback begins only after every current-generation track queue acknowledges its prefill.
- No stale seek, import, or waveform publication.
- No stale session load, save dirty clearing, transcription result, export result, or progress publication.
- Zero deterministic playback underruns.
- Import cancellation has one explicit commit boundary and FFmpeg children are bounded, killed, and reaped.
- Export cancellation preserves existing destinations and leaves no partial final output.
- Late frames from the MP3 regression fixture are readable without WebCodecs.
- Copied packages work after the external original is removed.
- Reference failures preserve the active project and report the missing source.
- Formatting, lint, dead-code analysis, typecheck, unit/integration tests, performance checks, and production build pass.
