# Managed Audio Source and PCM Cache Design

## Status and delivery order

This design follows the waveform-performance project specified in [`2026-08-14-waveform-performance-design.md`](2026-08-14-waveform-performance-design.md).

It introduces a consistent project bundle, durable audio-source identity, project-owned or externally referenced original media, regenerable PCM and waveform caches, and cache-backed playback.

It does not introduce Audacity-style physical PCM blocks or SQLite.

## System definition

### Goals

- Make copied projects portable by retaining the original encoded or lossless media inside the project bundle.
- Improve seek, playback, and future real-time effect performance through direct random access to decoded PCM.
- Keep memory usage bounded independently of source duration.
- Preserve clean ownership and dependency boundaries so the physical PCM representation can change later.
- Keep the initial import UI small and defer richer project and queue UX.

### Boundaries

The main process owns project-package lifecycle, filesystem access, import transactions, FFmpeg, cache generation, validation, and resource serving.

The renderer owns interaction, progress presentation, timeline orchestration, waveform canvas presentation, and buffered playback control.

The AudioWorklet owns real-time consumption of already prepared sample chunks.

Shared modules own serializable domain schemas and IPC contracts.

```text
Renderer UI
    → shared domain and IPC contracts
    ← main-process workspace, import, cache, and protocol adapters

WorkletAudioPlayer
    → AudioSampleProvider
    → AudioWorklet bounded queue
    → effects graph and device output
```

Dependencies point toward domain contracts, and no renderer component receives arbitrary filesystem authority.

### Inputs

- An audio file selected or dropped by the user.
- An import mode of `copy` or `reference`.
- A temporary or saved project workspace.
- New projects created with the first published managed-package schema.

### Outputs

- A durable `AudioSource` referenced by clips through `audioSourceId`.
- A complete source cache containing continuous Float32 PCM and waveform summary levels.
- A track that becomes editable only after import publication succeeds.
- A portable project when every source uses `copy` mode.

## Delivery decisions

### Why waveform work comes first

The current one-hour slowdown is dominated by duration-proportional SVG nodes and redundant waveform rendering.

Changing source storage would not remove that renderer bottleneck.

The canvas/provider waveform design therefore ships first and later receives a binary cache provider without another UI rewrite.

### Why one PCM file comes before physical blocks

A regular file already supports bounded random byte-range reads, so selective access does not require physical block files.

PodCut's non-destructive clips can reference source-time ranges without rewriting PCM.

A single continuous file provides simple byte arithmetic, sequential import writes, efficient operating-system caching, and fewer cleanup and indexing responsibilities.

Logical read chunks remain small even though the physical cache is one file.

### Why SQLite is deferred

Audacity stores immutable decoded sample blocks and multiscale summaries in the `.aup3` SQLite database, and its sequences refer to those block IDs.

That design supports Audacity's mature editing, recovery, reference counting, and garbage-collection requirements.

PodCut does not yet need blob transactions, block reference counting, block garbage collection, or database migrations.

The sample-provider abstraction preserves a future path to block-backed storage without imposing those costs now.

## Project workspace

### Package layout

```text
Episode.podcut/
├── project.json
├── media/
│   └── <audio-source-id>/
│       └── <original-name>.<ext>
└── cache/
    └── <audio-source-id>/
        ├── manifest.json
        ├── audio.f32le
        └── waveform/
            ├── level-256.minmax-f32le
            ├── level-4096.minmax-f32le
            └── level-65536.minmax-f32le
```

`project.json` and `media/` are durable.

Everything under `cache/` is regenerable and may be deleted without losing edits or copied source audio.

### Temporary workspace

At application launch, the main process creates an active temporary bundle under an application-specific directory within the system temporary root.

Every project operation therefore has a package root even before the user chooses a permanent destination.

Temporary project state is explicitly unsaved and may be recycled after the application exits.

The initial implementation delegates temporary-directory recycling to the operating system and does not recursively delete a shared temporary root.

### Save behavior

For a temporary workspace, both Save and Save As invoke the same permanent-destination workflow.

Saving directly to the temporary location is forbidden.

The workflow is:

1. Copy the temporary package to a staging directory beside the requested destination.
2. Validate `project.json` and required durable media, retain only valid completed caches, and omit invalid or incomplete caches from the destination.
3. Publish the staging directory as the destination package.
4. Switch the active workspace root to the saved package.
5. Remove the temporary package only after the switch succeeds.

Failure leaves the temporary project usable.

For a saved workspace, Save atomically replaces `project.json`, while Save As uses the same copy, validate, publish, and switch transaction to create another package.

### Future welcome page

A future welcome page will require New Project or Open Project before entering the editor.

That change removes temporary-workspace creation from the startup path without changing import, cache, playback, or project APIs.

## Domain model

### Audio source identity

`AudioSource` represents one logical imported or referenced audio asset rather than a cache file or decoder instance.

```ts
type AudioSourceId = string & { readonly __brand: 'AudioSourceId' }

type AudioSource = {
  id: AudioSourceId
  displayName: string
  location: AudioSourceLocation
  fingerprint: AudioSourceFingerprint
  metadata: AudioMetadata
}

type AudioSourceFingerprint = {
  byteLength: number
  modifiedTimeMs: number
  sha256: string
}

type AudioSourceLocation =
  | {
      mode: 'copy'
      path: ProjectRelativePath
    }
  | {
      mode: 'reference'
      path: AbsolutePath
    }
```

`AudioSourceId` is a stable UUID assigned when the source enters the project.

It is not a filename, path, content hash, or array index.

Multiple clips may reference one `AudioSource`, and one project may contain multiple audio sources.

### Clip reference

The managed-package clip schema uses `audioSourceId` instead of the unpublished `sourceFileId` terminology.

```ts
type Clip = {
  id: string
  trackId: string
  audioSourceId: AudioSourceId
  sourceStart: number
  sourceEnd: number
  outputStart: number
  gain: number
  muted: boolean
  effects: Effect[]
}
```

Changing a source from `reference` to `copy` does not alter its ID or any clip.

Transcript words associated with a source use the same `audioSourceId` terminology.

### Project-relative paths

All paths to package-owned files are persisted relative to the project root.

```ts
type ProjectRelativePath = string & {
  readonly __brand: 'ProjectRelativePath'
}
```

A valid project-relative path is normalized, is not absolute, contains no parent traversal, and resolves inside the active bundle root.

Only `reference` mode may persist an external absolute path.

The renderer never resolves project-relative paths.

### Project processing sample rate

The project stores one processing sample rate that is distinct from export settings and original-source metadata.

```ts
type ProjectAudioSettings = {
  processingSampleRate: number
}
```

New projects use a 48 kHz processing sample rate by default.

Every source cache is resampled to that rate during import so every provider feeds frames for the same AudioContext rate.

Changing the project processing sample rate is a future explicit operation that invalidates and rebuilds all source caches.

### Project schema versioning

The managed package is PodCut's first published project format, so `ProjectFileSchema` uses version `1` and replaces the current unpublished JSON-file schema.

The relevant root fields are:

```ts
type ProjectFile = {
  version: 1
  createdAt: string
  audioSettings: ProjectAudioSettings
  audioSources: AudioSource[]
  tracks: Track[]
  // Transcript, edits, adjustments, markers, export, and plugin data remain.
}
```

The unpublished single-file project shape is rejected rather than migrated, and the implementation contains no compatibility adapter or dual-schema branch.

## Cache model

### Manifest

```ts
type AudioSourceCacheManifest = {
  version: 1
  audioSourceId: AudioSourceId
  sourceSha256: string
  generatorVersion: string
  pcm: {
    file: ProjectRelativePath
    sampleFormat: 'f32le'
    layout: 'interleaved'
    sampleRate: number
    channels: number
    frameCount: number
    byteLength: number
  }
  waveform: {
    representation: 'min-max-f32le'
    levels: Array<{
      file: ProjectRelativePath
      samplesPerBucket: number
      bucketCount: number
    }>
  }
}
```

Manifest file paths are relative to the project bundle root and are validated with the same containment rules as other project paths.

The manifest is written last, so a published manifest means all referenced cache artifacts are complete.

The store rejects unsupported manifest or generator versions and regenerates the cache from the original source.

### PCM representation

The first representation is interleaved little-endian Float32 at the project's processing sample rate and the source channel count.

For this representation:

```text
bytes per frame = channels × 4
byte offset = frame index × bytes per frame
```

A read asks for a frame range and never allocates the full file.

At 48 kHz stereo, two seconds of Float32 PCM is approximately 768 KiB.

### Waveform representation

The cache stores minimum and maximum Float32 pairs at 256, 4,096, and 65,536 samples per bucket.

Each bucket is exactly eight bytes: one little-endian Float32 minimum followed by one little-endian Float32 maximum, aggregated across every channel sample in the bucket.

The cache builder creates PCM and all waveform levels during one FFmpeg decode pass.

The renderer chooses the coarsest level that still provides approximately one or more buckets per device pixel and requests only the visible bucket range.

RMS storage is deferred because the current UI does not display it.

### Cache ownership

`AudioSourceCacheBuilder` produces a staged cache.

`AudioSourceCacheStore` validates, publishes, locates, and removes caches.

`ImportCoordinator` determines when those operations occur but does not know FFmpeg arguments or filesystem publication details.

## Playback abstraction

### Sample provider

Playback depends on frame access rather than a PCM filename.

The provider contract and sample-chunk types live beside `IAudioPlayer` in `src/shared/player.types.ts`, while concrete provider implementations remain in the renderer.

```ts
interface AudioSampleProvider {
  readonly audioSourceId: AudioSourceId
  readonly format: AudioSampleFormat
  readonly sampleRate: number
  readonly channels: number
  readonly frameCount: number

  readFrames(
    startFrame: number,
    frameCount: number,
    signal: AbortSignal,
  ): Promise<AudioSampleChunk>
}

type AudioSampleFormat = 'f32-planar'

type AudioSampleChunk = {
  startFrame: number
  frameCount: number
  channels: Float32Array[]
}
```

`ContinuousPcmSampleProvider` implements the interface with range requests against `audio.f32le` and converts interleaved samples into transferable planar channel arrays.

A future `BlockedPcmSampleProvider` may implement the same interface without changing clips, effects, UI, or player policy.

### Player

`WorkletAudioPlayer` replaces `WebCodecsPlayer` rather than evolving or retaining its compressed decoding path.

`WebCodecsPlayer`, `FrameIndex`, arbitrary compressed-byte chunking, extrapolated compressed seek offsets, and the `SimpleAudioPlayer` media-element fallback are deleted after PCM-path parity tests pass.

```ts
interface IAudioPlayer {
  registerAudioSource(
    id: AudioSourceId,
    samples: AudioSampleProvider,
  ): Promise<void>

  removeAudioSource(id: AudioSourceId): void
  // Existing transport, track, event, and lifecycle methods remain.
}
```

Seeking performs these steps:

1. Convert output time through the active clip to source time.
2. Cancel obsolete provider reads.
3. Flush the corresponding AudioWorklet queue.
4. Read a small frame range at the calculated byte offset.
5. Transfer planar channel arrays to the AudioWorklet.
6. Continue reading until the bounded high-water mark is reached.

Providers are shared by `AudioSourceId`, but each track owns its own AudioWorklet queue so the same source can play concurrently on different tracks.

The initial target is two seconds queued per active track, with a hard maximum of three seconds per track during refill and seeking.

Queue depth comes from AudioWorklet acknowledgements rather than wall-clock estimates, and every seek or structural timeline change increments a generation token so stale reads cannot enqueue audio.

The player records underruns, and the reference sustained-playback and seek-stress run permits none.

### Effects

Future real-time effects consume the same bounded sample chunks and their explicitly required look-behind or look-ahead.

The PCM cache removes repeated compressed decoding but does not prescribe a particular effects graph.

Effects remain outside the first managed-audio implementation unless required to validate the sample-provider boundary.

## Waveform integration

`BinaryWaveformDataProvider` implements the waveform interface established by the earlier canvas project.

The custom protocol serves bounded binary ranges as `podcut://cache/<audioSourceId>/pcm` and `podcut://cache/<audioSourceId>/waveform/<samplesPerBucket>`.

The main process resolves those identifiers against the active workspace and a validated manifest; no route accepts a renderer-provided filesystem path.

The renderer does not receive the full waveform pyramid through IPC.

The temporary `PeakDataProvider` is removed after the binary provider reaches feature parity.

## Import transaction

### State machine

```text
selected
→ validating
→ copying or referencing
→ building cache
→ publishing
→ ready
```

The project model and timeline do not observe a new `AudioSource` until publication succeeds.

### Copy mode

Copy mode streams the original into `media/<audio-source-id>/`, computes its durable fingerprint, builds the source cache from the project-owned copy, and publishes both before updating `project.json`.

The original external file is never modified.

### Reference mode

Reference mode retains the external absolute path, fingerprints the external source, and builds the project-owned cache from it.

The project remains explicitly non-portable because cache deletion or invalidation requires the external source.

The UI can later offer conversion from reference to copy while retaining `AudioSourceId`.

### Failure and cancellation

Import writes only into source-specific staging directories.

Failure or cancellation terminates copying and FFmpeg, closes resources, removes staging data, reports one actionable result, and leaves the project model unchanged.

Cancellation must never publish a completed cache after acknowledgement.

Low-disk failures identify the required operation and preserve the active project.

### Initial UI

The initial UI is one small import-progress component showing filename, current stage, percentage, and Cancel.

It consumes typed progress events and contains no FFmpeg, path, cache, or cleanup logic.

The editor remains stable during import, and the new track appears only after readiness.

Initial scope supports one active import.

The import prompt exposes both modes, defaults to `copy`, and presents `reference` as the secondary choice.

Import queues, parallel imports, recovery UI, and a welcome page are deferred.

## Dependency direction

High-level policies depend on ports and domain types, while volatile mechanisms implement those ports.

```text
ProjectWorkspace
→ ProjectPathResolver
→ filesystem adapter
```

```text
ImportCoordinator
→ AudioSourceCacheBuilder + AudioSourceCacheStore
← FFmpeg builder + filesystem store
```

```text
WorkletAudioPlayer
→ AudioSampleProvider
← ContinuousPcmSampleProvider
```

```text
CanvasWaveform
→ WaveformDataProvider
← BinaryWaveformDataProvider
```

Pure byte arithmetic, schema transformations, and small drawing functions remain direct functions rather than receiving one-use interfaces.

## Initial code organization

```text
src/
├── shared/
│   ├── project.types.ts
│   ├── player.types.ts
│   ├── ipc.types.ts
│   └── import.types.ts
├── main/
│   ├── project/
│   │   ├── ProjectWorkspace.ts
│   │   ├── ProjectWorkspace.test.ts
│   │   ├── ProjectPathResolver.ts
│   │   └── ProjectPathResolver.test.ts
│   ├── audio/
│   │   ├── import/
│   │   │   ├── ImportCoordinator.ts
│   │   │   ├── ImportCoordinator.test.ts
│   │   │   └── FfmpegAudioSourceCacheBuilder.ts
│   │   └── cache/
│   │       ├── AudioSourceCacheStore.ts
│   │       ├── cacheManifest.ts
│   │       └── cacheManifest.test.ts
│   └── ipc/
│       ├── project.ipc.ts
│       └── audio.ipc.ts
└── renderer/src/
    ├── audio/
    │   ├── samples/
    │   │   ├── ContinuousPcmSampleProvider.ts
    │   │   └── ContinuousPcmSampleProvider.test.ts
    │   ├── WorkletAudioPlayer.ts
    │   ├── AudioPlayerWorklet.ts
    │   └── playbackPlan.ts
    └── components/Waveform/
        ├── WaveformDataProvider.ts
        └── BinaryWaveformDataProvider.ts
```

`src/main/audio/importer.ts`, `src/main/audio/peaks.ts`, `PeakDataProvider`, `SimpleAudioPlayer`, `FrameIndex`, and `WebCodecsPlayer` are removed only after their replacements reach parity.

The exact file list may shrink when an item lacks an independent responsibility, but it must not grow without an identified ownership boundary.

## TDD and verification

Implementation follows test-driven development, beginning each behavior with a failing focused test.

Hard CI requirements include:

- Project-relative path normalization, absolute-path rejection, traversal rejection, and bundle containment.
- Rejection of the unpublished single-file schema and acceptance of the managed-package version-1 schema.
- Multiple clips sharing one `AudioSourceId`, PCM cache, waveform cache, and provider state.
- Temporary Save and Save As both using permanent-destination publication.
- Copy, validate, publish, switch, and cleanup ordering.
- Failed saves preserving the active temporary workspace.
- Import success, failure rollback, and cancellation rollback.
- Manifest parsing, version rejection, source-fingerprint invalidation, and regeneration.
- PCM frame-to-byte calculations and bounded range reads.
- Two-second queue target and three-second hard maximum per active track.
- An MP3 larger than the old 256 KiB index window decoding through FFmpeg into PCM and reading non-silent late-file frames without WebCodecs.
- No full PCM-file read and no full waveform-pyramid renderer transfer.
- Pyramid correctness and visible-range selection.
- Stale seek and viewport request cancellation.
- Controlled slow-import progress gaps no greater than 250 ms using deterministic clocks or event-controlled test doubles.
- Cancellation acknowledgement within 100 ms, cleanup within 500 ms, and no later publication using deterministic clocks or event-controlled test doubles.
- Low-disk and missing-reference errors preserving existing project state.

## Performance fixture

The reference workload is a one-hour, 48 kHz stereo source represented by ten clips, with one visible track and a 1,920-pixel viewport on local solid-state storage.

The dedicated performance runner uses a named hardware and software configuration, fixed audio bytes, fixed warm and cold states, fixed interaction traces, repetitions, percentile rules, stored baselines, and raw metric artifacts.

Targets and recorded metrics are:

- Cached warm-app first meaningful waveform commit at or below 500 ms p95.
- Waveform draw callback at or below 8 ms p95.
- No more than 1% missed 60 Hz frames during the defined pan and zoom trace.
- Random seek while already playing to the first correctly positioned AudioWorklet output at or below 150 ms p95.
- Zero underruns during the reference sustained-playback and seek-stress run.
- Retained renderer heap growth from a 10-minute to one-hour source no greater than 15% or 25 MiB, whichever allowance is larger, after stabilized garbage collection.
- Process-tree RSS, repeated seek/open/import soak behavior, file-handle counts, and monotonic-growth indicators.
- Concurrent import, playback, and waveform-navigation frame misses, long tasks, and input-to-paint latency.
- Maximum waveform payload, requested bucket count, PCM read size, and queued PCM duration.
- Decode, waveform construction, and cache-finalization times reported separately as real-time factors with baseline regression alerts.
- Cache disk footprint and low-disk behavior.

Absolute latency and memory targets run on the stable performance runner rather than ordinary CI.

Architectural boundedness, correctness, cache sharing, and cleanup remain hard CI gates.

## Deferred work

- Audacity-style physical PCM blocks or SQLite storage.
- Destructive PCM editing and block reference counting.
- Import queues and parallel imports.
- Rich import recovery and cache-management UI.
- Automatic packaging of reference-mode sources.
- Welcome-page project selection.
- Real-time effect implementations.
- Cache eviction policy beyond explicit regeneration and safe cleanup.

## Completion criteria

The managed-audio project is complete when every active project has a workspace root, copied projects are portable, imports publish atomically, playback and waveform access are range-bounded, the fragile compressed WebCodecs path is unreachable and removed, approved CI and performance checks pass, and no cache file is required to preserve durable edits.
