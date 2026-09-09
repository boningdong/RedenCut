# Verbatim Speech Analysis Pipeline Design

## Status and purpose

This document is the approved-design candidate for subproject 1 of the [Speech Intelligence Program Design](./2026-08-27-speech-intelligence-program-design.md): the Verbatim Speech Analysis Pipeline.

It defines the canonical transcript and acoustic-alignment model, local worker boundary, project persistence, selection resolution, atomic publication, invalidation, and integration with PodCut's current project and job infrastructure.

It is a detailed design, not an implementation plan. Implementation sequencing begins only after this document is reviewed and approved.

## 1. System goal and boundary

### 1.1 Goal

Given one managed `AudioSource`, PodCut produces and atomically publishes one coherent speech-analysis result containing:

- A canonical verbatim or explicitly best-effort-verbatim transcript.
- Reliable source-time acoustic edit units.
- Anonymous speaker diarization.
- Deterministic transcript-to-speaker attribution.
- Engine, model, configuration, source-fingerprint, and analysis provenance.

The result remains editable after cache cleanup and remains stable when clips move on the output timeline.

### 1.2 Included in this subproject

- Existing whisper.cpp transcription on macOS.
- Replaceable transcription capability and provenance.
- WhisperX alignment and diarization through a job-scoped local CLI worker.
- Canonical domain normalization and validation in Electron main.
- Durable project storage in `.podcut/project.json`.
- Text-selection resolution to acoustically addressable source ranges.
- Atomic publication, cancellation, and invalidation.
- Path-free renderer projections and speaker-label editing.

### 1.3 Excluded from this subproject

- Disfluency detection and intended-transcript generation.
- Speech synthesis or voice cloning.
- A model-selection UI.
- A general plugin framework.
- Automatic migration of old `Word`, transcript, or project schemas.
- A durable `analysis/` directory separate from `project.json`.
- Claims that an acoustically addressable boundary is automatically a natural hard cut.

## 2. Architectural overview

The product operation is one pipeline even though its engines remain replaceable.

```text
Renderer request
      │ AudioSourceId + session precondition + user draft snapshot
      ▼
SpeechAnalysisCoordinator (Electron main)
      ├── ITranscriber adapter → transcript draft
      ├── job-scoped CLI worker
      │     ├── IAlignmentEngine adapter
      │     └── IDiarizationEngine adapter
      ├── SpeakerAttribution
      ├── canonical normalization and validation
      └── atomic workspace publication
                    │
                    ▼
        .podcut/project.json
        SpeechAnalysisBundle
```

The renderer never receives filesystem paths and never assembles authoritative engine provenance. The main process owns source resolution, process execution, validation, and publication.

Analysis is per `AudioSource`, not per track or clip. A renderer projection maps source-time analysis through the current clip instances when displaying it on the output timeline.

## 3. Canonical domain model

### 3.1 Identifiers and revisions

The design introduces branded IDs for transcript artifacts, transcript units, alignment artifacts, acoustic edit units, diarization artifacts, speakers, and analysis revisions.

`analysisRevisionId` is a fresh opaque ID for every successfully published full pipeline run. It is shared by every machine artifact in the same publication and prevents accidental mixing of results from different runs.

`TranscriptArtifact.revision` is a positive integer scoped to a stable `TranscriptArtifactId`. Initial publication uses revision `1`; successful reanalysis increments it. `AlignmentArtifact` records both the transcript artifact ID and the exact transcript revision it aligns.

No unit ID is promised to remain stable across reanalysis. Durable non-destructive audio edits therefore reference source ranges and timeline entities, not transcript-unit IDs.

### 3.2 Transcript units

`TranscriptUnit` is the text unit shown to and selected by the user.

```ts
type TranscriptUnit = {
  id: TranscriptUnitId
  text: string
  kind: 'speech' | 'punctuation'
}
```

`TranscriptUnit` deliberately contains no timing, track, mute, confidence, or speaker field.

- Timing belongs to `AlignmentArtifact`.
- Track and clip placement belong to the timeline projection.
- Mute, split, and clip state belong to persisted non-destructive edits.
- Speaker attribution belongs to its own artifact.
- Machine confidence belongs to the artifact that produced the evidence.

Language-aware canonicalization decides unit boundaries. The first implementation may expose Chinese speech at character granularity and English speech at word granularity, but the persisted contract does not require the aligner to locate every visible unit independently.

Punctuation is a first-class visible transcript unit so text editing and display preserve authored text. It has no acoustic interval.

### 3.3 Transcript artifact

```ts
type TranscriptArtifact = {
  id: TranscriptArtifactId
  revision: number
  analysisRevisionId: AnalysisRevisionId

  audioSourceId: AudioSourceId
  sourceFingerprint: AudioSourceFingerprint

  units: TranscriptUnit[]
  mode: 'verbatim' | 'best-effort-verbatim'
  provenance: EngineProvenance
}
```

`mode` states what the selected transcriber can actually guarantee. The initial whisper.cpp adapter records `best-effort-verbatim` unless validation establishes a stronger guarantee for the configured model and decoding mode.

The canonical transcript is an immutable machine artifact within an analysis revision. Text-driven audio editing changes the timeline projection and non-destructive edit state, not the machine transcript. A future lexical-correction design must explicitly define how corrected text creates a new transcript revision and invalidates or regenerates alignment; this subproject does not mutate units independently of their alignment.

### 3.4 Acoustic edit units

`AcousticEditUnit` replaces the earlier name `AcousticEditGroup`.

```ts
type AcousticEditUnit = {
  id: AcousticEditUnitId

  transcriptUnitIds: TranscriptUnitId[]

  audioSourceId: AudioSourceId
  sourceStart: number
  sourceEnd: number

  granularity: AlignmentGranularity
  confidence?: number
}
```

An `AcousticEditUnit` is the smallest range that the Alignment Engine can locate reliably and that text-driven editing must treat atomically.

One acoustic edit unit contains one or more consecutive transcript units. For example, if the visible units `觉` and `得` cannot be aligned independently but `觉得` can be aligned to `0.75–1.18`, both units belong to the same acoustic edit unit. PodCut must not average that interval into fabricated character timestamps.

```text
Transcript:  … 觉 │ 得 …
                  └──── AEU-2 ────┘
Source time:       0.75          1.18
```

`AlignmentGranularity` records the reliable level reported by the normalized adapter:

```ts
type AlignmentGranularity = 'character' | 'word' | 'phrase' | 'utterance'
```

An acoustic edit unit only states acoustic addressability. It does not guarantee that hard cutting at `sourceStart` or `sourceEnd` sounds natural. Actual cut-point search, zero-crossing adjustment, handles, crossfade, and boundary polishing remain the responsibility of `AudioEditPlanner`.

### 3.5 Alignment artifact

```ts
type AlignmentArtifact = {
  id: AlignmentArtifactId
  analysisRevisionId: AnalysisRevisionId

  transcriptArtifactId: TranscriptArtifactId
  transcriptRevision: number

  audioSourceId: AudioSourceId
  sourceFingerprint: AudioSourceFingerprint

  acousticEditUnits: AcousticEditUnit[]
  provenance: EngineProvenance
}
```

The artifact is replaced as a whole. Individual acoustic edit units are never patched into an alignment from a different run.

### 3.6 Diarization and speaker attribution

Diarization and speaker attribution remain separate artifacts even when WhisperX exposes both from one package.

```ts
type Speaker = {
  id: SpeakerId
  analysisRevisionId: AnalysisRevisionId
  diarizationLabel: string
  displayName: string
  displayNameOrigin: 'generated' | 'user'
}

type DiarizationTurn = {
  speakerId: SpeakerId
  audioSourceId: AudioSourceId
  sourceStart: number
  sourceEnd: number
  confidence?: number
}

type DiarizationArtifact = {
  id: DiarizationArtifactId
  analysisRevisionId: AnalysisRevisionId
  audioSourceId: AudioSourceId
  sourceFingerprint: AudioSourceFingerprint
  turns: DiarizationTurn[]
  provenance: EngineProvenance
}

type SpeakerAttribution = {
  acousticEditUnitId: AcousticEditUnitId
  speakerId?: SpeakerId
  candidateSpeakerIds?: SpeakerId[]
  confidence?: number
  ambiguous: boolean
}

type SpeakerAttributionArtifact = {
  analysisRevisionId: AnalysisRevisionId
  alignmentArtifactId: AlignmentArtifactId
  diarizationArtifactId: DiarizationArtifactId
  attributions: SpeakerAttribution[]
  provenance: AlgorithmProvenance
}
```

Speaker IDs are anonymous and local to one analysis revision. The diarization adapter's raw label, such as `SPEAKER_00`, becomes the immutable `diarizationLabel`; normalization creates the corresponding `Speaker` and rewrites turns and attributions to its `SpeakerId`. Overlap is allowed in diarization turns. Attribution uses overlap duration and deterministic tie rules, but records unsupported or ambiguous assignments instead of inventing certainty.

`displayName` is the user-facing, editable speaker name and defaults to a generated value such as `Speaker 1`. A user who knows the participant may enter a real name, but PodCut does not infer or verify real-world identity from the voice. User edits change only `displayName` and `displayNameOrigin`; they never mutate the speaker ID, raw diarization label, turns, or attribution.

The `Speaker[]` catalog is durable project state stored with the bundle. Reanalysis may produce different speaker IDs. The first version must require explicit confirmation before replacing an analysis containing user-named speakers; it does not silently transfer or discard names without a verified mapping.

### 3.7 Engine provenance

Every engine-produced artifact records at least:

```ts
type EngineProvenance = {
  engineId: string
  engineVersion: string
  modelId: string
  modelVersion?: string
  configHash: string
  artifactSchemaVersion: number
  createdAt: string
}
```

The stored configuration may contain a validated, non-secret structured summary in addition to the hash. Secrets, absolute executable paths, and temporary paths are never persisted.

Transcription, alignment, diarization, disfluency detection, and speech generation have independent provenance slots. A future settings UI can select them independently without changing the domain artifacts.

### 3.8 Atomic speech-analysis bundle

The project stores one current bundle per analyzed audio source.

```ts
type SpeechAnalysisBundle = {
  analysisRevisionId: AnalysisRevisionId
  audioSourceId: AudioSourceId
  sourceFingerprint: AudioSourceFingerprint

  transcript: TranscriptArtifact
  alignment: AlignmentArtifact
  diarization: DiarizationArtifact
  speakerAttribution: SpeakerAttributionArtifact

  speakers: Speaker[]
}
```

`ProjectFile` gains the field `speechAnalyses: SpeechAnalysisBundle[]`. Every nested machine artifact for one source is published and replaced together.

## 4. Required invariants

`ProjectFileSchema.superRefine` and domain construction enforce all of the following:

1. Each `AcousticEditUnit.transcriptUnitIds` array is non-empty.
2. The referenced transcript units exist, are `speech` units, are consecutive in transcript order, and appear in that order in the array.
3. A speech `TranscriptUnit` belongs to at most one acoustic edit unit.
4. A punctuation `TranscriptUnit` belongs to no acoustic edit unit.
5. One acoustic edit unit references exactly one `AudioSource`, matching its containing alignment artifact.
6. `sourceStart` and `sourceEnd` are finite, non-negative source times and `sourceStart < sourceEnd`.
7. Transcript, alignment, diarization, and speaker-attribution artifacts in a bundle share one `analysisRevisionId`, `audioSourceId`, and `sourceFingerprint`.
8. `AlignmentArtifact.transcriptArtifactId` and `transcriptRevision` exactly match the contained transcript artifact.
9. Every `Speaker.id` is unique within the bundle and every `Speaker.analysisRevisionId` matches the bundle.
10. Every diarization turn references a `Speaker` in the bundle.
11. Each speaker attribution references an acoustic edit unit from the contained alignment artifact; every assigned or candidate speaker ID references a `Speaker` in the bundle.
12. At most one current `SpeechAnalysisBundle` exists for an `AudioSourceId`.
13. Re-alignment replaces the entire alignment artifact as part of a full bundle publication.
14. Acoustic edit unit source ranges are not required to be globally disjoint. Overlapping speech can legitimately create overlapping ranges.

Some speech units may remain unaligned when evidence is insufficient. This is represented by their absence from every acoustic edit unit, not by fabricated timing.

## 5. Runtime indexes

On project load and after successful publication, PodCut builds:

```ts
Map<TranscriptUnitId, AcousticEditUnitId>
```

The reverse index is derived only from the validated `AlignmentArtifact`. It is not persisted and may be rebuilt at any time.

Additional renderer indexes, such as units by speaker or acoustic units by source-time order, are also disposable projections and do not become project schema.

## 6. Acoustic selection resolution

### 6.1 Responsibility

`AcousticSelectionResolver` is an independent, deterministic domain service. It translates the user's actual transcript selection into the smallest acoustically addressable ranges without deciding how audio will be cut.

```ts
type SourceRange = {
  audioSourceId: AudioSourceId
  sourceStart: number
  sourceEnd: number
}

type ResolvedAcousticSelection = {
  requestedUnitIds: TranscriptUnitId[]
  resolvedUnitIds: TranscriptUnitId[]

  acousticEditUnitIds: AcousticEditUnitId[]
  sourceRanges: SourceRange[]

  expanded: boolean
}
```

The input IDs are de-duplicated and ordered by canonical transcript order. The resolver looks up each speech unit through the runtime reverse index, expands every match to its complete acoustic edit unit, and returns acoustic edit units in source order. Overlapping or touching ranges for the same source may be normalized into one `SourceRange`; the original acoustic edit unit IDs remain available for explanation and highlighting.

`expanded` is true when any returned acoustic edit unit contains a transcript unit outside the requested selection.

### 6.2 Partial acoustic-unit selection

If the user selects only `觉` and it belongs to an acoustic edit unit containing `[觉, 得]`, the resolver returns:

```text
requestedUnitIds:       [觉]
resolvedUnitIds:        [觉, 得]
acousticEditUnitIds:    [AEU-2]
sourceRanges:           [0.75–1.18]
expanded:               true
```

The UI must preserve the requested selection, expand the effective highlight to `resolvedUnitIds`, and explicitly explain that `觉` has expanded to `觉得`. Only after user confirmation may the source ranges be passed to `AudioEditPlanner`.

A product flow may instead block partial deletion. It may never silently average or subdivide the acoustic interval.

### 6.3 Punctuation

A punctuation-only selection resolves to no acoustic edit:

```text
requestedUnitIds:       [。]
resolvedUnitIds:        []
acousticEditUnitIds:    []
sourceRanges:           []
expanded:               false
```

For `可以。`, audio ranges come only from the speech units in `可以`. Whether the period is also removed from visible text is a text-editing policy and cannot create a fake audio range.

### 6.4 Unaligned speech

The public result stays as specified above. The caller distinguishes punctuation from unaligned speech by reading `TranscriptUnit.kind`:

- Requested punctuation omitted from `resolvedUnitIds` is expected and acoustically inert.
- Requested speech omitted from `resolvedUnitIds` is unresolved evidence and blocks the audio edit with an actionable message.

The resolver does not partially execute an edit that includes unaligned speech.

### 6.5 Timeline occurrence context

The resolver operates in source coordinates and intentionally does not choose a track or clip occurrence. If the same source range appears in multiple timeline clips, the UI supplies an explicit active track/clip projection to `AudioEditPlanner`. The planner edits only that occurrence unless the user explicitly selects more.

The first version rejects a single text selection spanning incompatible source projections. This avoids applying a source range to every reuse of the same audio source.

### 6.6 Persistence

`ResolvedAcousticSelection` is transient runtime state. It is not stored in `project.json`.

After confirmation, only the resulting non-destructive mute, split, clip, and related timeline state is persisted. Transcript-unit selection IDs are not required to replay the edit.

### 6.7 UI editability projection

Text selection and audio editability are related but distinct UI states. The renderer derives a disposable state for every visible transcript unit from the validated transcript, reverse index, and acoustic edit units:

```ts
type TranscriptUnitEditability =
  | {
      state: 'editable'
      acousticEditUnitId: AcousticEditUnitId
      groupUnitIds: TranscriptUnitId[]
    }
  | {
      state: 'not-editable'
      reason: 'punctuation' | 'unaligned'
    }
```

The presentation follows the same semantics as `AcousticSelectionResolver`:

- A speech unit in a single-unit acoustic edit unit receives the normal audio-edit affordance.
- Every speech unit in a multi-unit acoustic edit unit receives a linked-group affordance. Hovering or selecting one unit previews the complete group, and an edit uses the resolver's expanded confirmation flow.
- Punctuation remains cursor-selectable as text but exposes no audio-edit affordance. A punctuation-only selection disables audio edit commands with a non-error explanation.
- Unaligned speech remains selectable but exposes a distinct unavailable state and an actionable alignment explanation; it must not look equivalent to punctuation.

Committed audio-edit styling follows the resolved operation, not the browser selection. For example, strike-through or deleted styling applies only to speech units covered by committed source ranges in the edited clip projection. Punctuation receives that styling only when an explicit text-editing policy also removes it; merely selecting adjacent punctuation or muting adjacent audio cannot mark it as edited.

Requested selection, resolved acoustic preview, unavailable state, and committed edit state are visually distinct. None of these presentation states is persisted; they are reconstructed from canonical artifacts and durable non-destructive edits.

## 7. Transcriber and engine boundaries

### 7.1 Replaceable transcriber

`ITranscriber` remains a replaceable domain boundary. Its adapter descriptor exposes a capability such as:

```ts
type VerbatimSupport = 'native' | 'best-effort' | 'unsupported'
```

This capability belongs to the transcriber descriptor, not to the workflow and not to another pipeline. The speech-analysis coordinator requests verbatim behavior, rejects `unsupported`, and records the actual mode in `TranscriptArtifact`.

The later Hybrid Disfluency Detector consumes the published canonical transcript artifact. It neither calls the speech-analysis workflow nor needs to know which workflow produced it. This preserves isolation while allowing the detector to require a transcript whose recorded mode is acceptable for the selected detector.

The initial adapter continues to use the existing local whisper.cpp installation and records `best-effort-verbatim`. A future native verbatim model can replace the adapter without changing alignment, selection, renderer, or project contracts.

### 7.2 Alignment and diarization interfaces

Alignment and diarization have separate main-process-facing interfaces even though the first worker implementation may use WhisperX for both:

```ts
interface IAlignmentEngine {
  align(input: AlignmentInput, signal: AbortSignal): Promise<AlignmentEngineResult>
}

interface IDiarizationEngine {
  diarize(input: DiarizationInput, signal: AbortSignal): Promise<DiarizationEngineResult>
}
```

Engine results are adapter DTOs, not persisted project types. Main-process normalization assigns PodCut IDs, converts units and times, validates provenance, and constructs the canonical artifacts.

The first version uses fixed default engine and model descriptors. Configuration is centralized so a future UI can select transcription, alignment, diarization, disfluency, and generation models independently.

## 8. Job-scoped local worker

### 8.1 Process boundary

Electron does not embed Python. Alignment and diarization run in an independently installed and upgraded CLI worker.

One worker process is spawned for one analysis job. It receives one combined alignment-and-diarization request, invokes the independently replaceable engine adapters within that process, emits progress and one terminal outcome through newline-delimited JSON, and exits. There is no background daemon or local port.

The main process passes the resolved source path and normalized transcript draft directly to the worker. Paths never cross IPC into the renderer.

### 8.2 JSON Lines protocol

Standard output is reserved for validated protocol messages:

```text
ready
progress: alignment
progress: diarization
result
```

Every line includes a protocol version and job ID. The terminal message is exactly one of `result` or `error`. Human-readable logs use standard error so they cannot corrupt protocol parsing.

The main process validates every message against a shared schema, rejects unknown protocol versions and duplicate terminal messages, enforces line and result size limits, and treats malformed output or premature exit as job failure.

The coordinator applies bounded overall and no-progress timeouts. A valid progress heartbeat resets only the no-progress deadline; it cannot extend the overall deadline indefinitely. Concrete timeout defaults are operational configuration, not project data.

The worker result contains normalized engine DTOs plus provenance. Raw WhisperX or pyannote JSON remains worker/cache data and is not accepted directly as a `ProjectFile` artifact.

### 8.3 Installation and availability

Worker discovery is independent of the Electron bundle. An availability check reports:

- Executable not installed.
- Unsupported protocol version.
- Required Python/model dependencies unavailable.
- Model files unavailable.
- Ready with engine/model descriptors.

The UI presents actionable installation or upgrade guidance. The first version does not select among models in the UI.

### 8.4 Cancellation and cleanup

The main coordinator owns an `AbortController`. On cancellation it:

1. Stops accepting progress for publication purposes.
2. Terminates the worker gracefully.
3. Escalates termination after a bounded grace period if necessary.
4. Waits for process exit.
5. Removes job-temporary files.
6. Marks the registered job settled.

No workspace switch, save, sender destruction, or replacement job proceeds past the existing cancellation barrier until the worker has exited and cleanup has settled.

## 9. IPC contract

The current `transcript.generate -> SessionJobResult<Transcript>` contract is replaced by a speech-analysis job contract because returning a loose transcript cannot satisfy atomic publication.

The detailed boundary is:

```ts
type SpeechAnalysisJobRequest = SessionPrecondition & {
  jobId: string
  audioSourceId: AudioSourceId
  language?: string
  draft: ProjectDraft
}

type SpeechAnalysisProgress = SessionPrecondition & {
  jobId: string
  stage:
    'transcribing' | 'aligning' | 'diarizing' | 'attributing-speakers' | 'validating' | 'publishing'
  percent?: number
}
```

Successful completion returns `SessionJobResult<RendererSession>`, not `Transcript`. The returned session is the result of the authoritative main-process commit and contains a path-free read projection of the published analysis.

Cancel requests use the same job identity tuple as current jobs: job kind, job ID, sender ID, workspace token, and workspace revision. `SessionJobRegistry` gains a `speech-analysis` kind.

Renderer code never appends `audioSourceId` or `trackId` to engine results and never merges machine artifacts into the project draft.

## 10. Project storage

### 10.1 Durable standard artifacts

The first version stores these in `.podcut/project.json`:

- `TranscriptArtifact` and `TranscriptUnit[]`.
- `AlignmentArtifact` and `AcousticEditUnit[]`.
- Diarization and speaker attribution.
- The `Speaker[]` catalog and user-modified display names.
- Engine, model, and configuration provenance.
- Source fingerprint and analysis revision.

These are project data, not cache. Cleaning `.podcut/cache` must not remove the canonical transcript, acoustic edit units, speakers, user-modified display names, or user edits.

`ProjectWorkspace.save` already writes a temporary project file and renames it atomically. The speech-analysis transaction uses this same persistence boundary.

The project schema version is bumped for this intentionally incompatible data-model change. Old version-1 transcript/project files fail schema validation with a clear unsupported-version error. No migration adapter or backwards-compatible union is added.

### 10.2 Cache and task-temporary data

The following may be stored under project cache or a job-temporary directory:

- Raw whisper.cpp segments and tokens.
- Raw WhisperX alignment JSON.
- Raw pyannote diarization JSON.
- Converted worker input audio.
- Worker intermediate files.
- Worker logs.

First-version implementations should prefer task-temporary storage unless reuse has a measured benefit. Cache entries must be keyed by source fingerprint and exact engine/model/config provenance. Temporary paths and logs are never referenced by durable artifacts.

### 10.3 Future size split

The first version does not introduce a durable `analysis/` directory. If measured long-form projects make `project.json` unacceptably large, a later design may move immutable artifact payloads into durable analysis files while keeping atomic references in the project file. That change is not pre-designed here.

## 11. Atomic preparation and publication

### 11.1 Preparation state

During a job, every output lives in memory or a job-temporary directory. The current project keeps its previous `SpeechAnalysisBundle` unchanged.

The coordinator must finish all of the following before publication is eligible:

- Canonical verbatim or best-effort-verbatim transcript.
- Complete `AlignmentArtifact` and acoustic edit units.
- Complete diarization artifact.
- Speaker attribution.
- Provenance and source fingerprint.
- Cross-artifact schema and invariant validation.

There is no persisted partial status such as “transcript ready, diarization pending.”

### 11.2 Publication transaction

Publication uses `WorkspaceController.runTransition` and a dedicated transaction operation such as `commitSpeechAnalysis`, modeled on `commitImport`.

It must not call `ProjectMutationCoordinator.begin`, because that coordinator cancels and settles jobs before save/open mutations and would cause the analysis job to cancel itself.

The current project-open path is a higher-level composition: `ProjectTransitionCoordinator` coordinates open/save/discard, uses `ProjectMutationCoordinator` for user-requested saves, and waits on `SessionSwitchBarrier` before replacing the visible workspace. A save or project switch marks the current workspace token as closing and cancels and settles its registered speech-analysis jobs before mutation or replacement proceeds.

A successful speech-analysis publication advances the current workspace revision but does not switch workspaces, so it does not use `SessionSwitchBarrier` or emit a workspace-switch notification. Renderer reconciliation installs the returned same-token, newer-revision session.

Inside the serialized transition, main:

1. Revalidates workspace token and revision.
2. Resolves the authoritative `AudioSource` from the current project.
3. Revalidates the original source fingerprint immediately before commit.
4. Verifies that the prepared bundle targets that source and fingerprint.
5. Replaces the source's complete existing bundle in a candidate project.
6. Parses the complete candidate with `ProjectFileSchema`.
7. Saves through `ProjectWorkspace.save`.
8. Advances the workspace revision and returns a new `RendererSession`.

The in-memory authoritative workspace changes only after the atomic save succeeds.

### 11.3 Concurrent renderer edits

The request includes the renderer's current `ProjectDraft` snapshot, following the existing import pattern. The renderer records its `localEditRevision` in the local job ledger when it submits the request; that renderer-only counter does not need to cross IPC. Main merges the submitted user-editable draft before preparing the candidate publication.

While analysis runs, the first version disables transcript-driven edits and speaker-label edits for the target source. Timeline and export edits may continue. On completion, renderer reconciliation preserves timeline/export edits made after submission while accepting the newly published main-owned speech-analysis projection.

Machine speech-analysis artifacts are removed from the renderer-writable `ProjectDraft`; otherwise a stale renderer snapshot could overwrite newly published provenance or alignment. They are exposed in `RendererSession` as a read-only, path-free projection. Speaker-label changes use an explicit validated mutation rather than a generic replacement of the machine bundle.

If reconciliation cannot prove that later local edits are independent, the result is not installed in renderer state and the user is asked to save/retry. It never silently drops local edits.

### 11.4 Failure and invalidation

Cancellation, worker crash, malformed worker output, timeout, source-fingerprint change, project switch, sender destruction, stale workspace revision, validation failure, or save failure publishes nothing.

The previous valid analysis bundle remains untouched. Runtime indexes continue to derive from that bundle.

Changing source content invalidates analysis by fingerprint. Moving, splitting, muting, or reordering clips does not invalidate source-time analysis. Changing transcription, alignment, diarization, attribution algorithm, model, or relevant configuration requires a new full analysis revision.

Re-alignment alone is not partially published in the first version. Even if transcription can be reused internally, publication constructs and atomically replaces a coherent full bundle.

## 12. Renderer behavior

### 12.1 Transcript presentation

Renderer stores a presentation projection of `TranscriptUnit[]`, acoustic units, speaker attribution, and disposable indexes. It does not store raw worker output.

Multiple transcript units sharing one acoustic edit unit share one playback span. Active-word behavior highlights the acoustically active unit as a group rather than pretending to know which character is active within it. Punctuation has no independent playhead interval.

### 12.2 Editing

Text selection preserves actual `TranscriptUnitId` values. Audio commands call `AcousticSelectionResolver`, preview any expansion, receive confirmation when required, then pass source ranges plus explicit target clip context to `AudioEditPlanner`.

The existing behavior that toggles `Word.muted` separately from timeline clip edits is retired. Visible muted state is derived from the committed non-destructive timeline edit and its source projection.

The existing manual operation that shifts timing fields on individual words is incompatible with the new model. Any retained timing-calibration feature must operate on or regenerate a whole validated `AlignmentArtifact`; it cannot mutate `TranscriptUnit` or create per-character pseudo-timing.

## 13. Integration assessment against current PodCut

### 13.1 Conflict matrix

| Current mechanism                                                                                  | Assessment                                                     | Required design consequence                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectFileSchema.transcript.words` combines text, time, speaker, track, source, and mute state   | Conflicts                                                      | Replace it with durable speech-analysis bundles and split responsibilities across transcript, alignment, attribution, and timeline edits.     |
| `ProjectFileSchema` version is literal `1`                                                         | Conflicts                                                      | Bump the schema version; reject old files without migration because backwards compatibility is explicitly out of scope.                       |
| `ITranscriber` returns persisted `Transcript`                                                      | Conflicts                                                      | Return a transcriber result DTO; main constructs the canonical artifact and records verbatim capability/provenance.                           |
| `transcript.generate` returns a loose `Transcript`                                                 | Conflicts                                                      | Replace with a full speech-analysis job that atomically commits and returns `RendererSession`.                                                |
| Renderer adds `audioSourceId`/`trackId`, merges words, and marks the draft dirty                   | Conflicts                                                      | Analyze by source in main; renderer receives read-only analysis projection and never authors machine artifacts.                               |
| `ProjectDraft` currently carries transcript                                                        | Conflicts                                                      | Restrict the draft to user-editable data; machine artifacts are main-owned. Use explicit mutations for user speaker names.                    |
| `SessionJobRegistry` keys jobs by sender/workspace/revision and settles them on switch/save        | Compatible with extension                                      | Add `speech-analysis`; make worker exit and temp cleanup part of settlement.                                                                  |
| `ProjectMutationCoordinator` cancels jobs before save/open                                         | Compatible for external mutations, unsafe for self-publication | Keep it for save/open cancellation, but publish analysis directly inside `WorkspaceController.runTransition`.                                 |
| `ProjectTransitionCoordinator` and `SessionSwitchBarrier` coordinate visible workspace replacement | Compatible with extension                                      | Let switch/save cancel and settle speech analysis; same-workspace analysis publication advances revision without entering the switch barrier. |
| `WorkspaceController.runTransition` serializes and checks session preconditions                    | Compatible                                                     | Add `commitSpeechAnalysis` and recheck fingerprint inside the transition.                                                                     |
| `ProjectWorkspace.save` performs temporary-write plus rename                                       | Compatible                                                     | Reuse it as the atomic durable publication boundary.                                                                                          |
| Import reconciliation preserves renderer edits made during a main-owned job                        | Partially reusable                                             | Generalize its edit ledger for analysis; lock target-source transcript operations and preserve independent timeline/export edits.             |
| Word selection and `wordOutputTime` assume one timestamp per visible word                          | Conflicts                                                      | Resolve through acoustic edit units and clip projection; group-highlight shared spans and treat punctuation as timeless.                      |
| Timeline edits persist clips but separately toggle `Word.muted`                                    | Conflicts                                                      | Persist only non-destructive timeline edits and derive transcript presentation from them.                                                     |
| Analysis is currently generated for a chosen track and renderer attaches `trackId`                 | Conflicts                                                      | Make analysis source-scoped; pass explicit clip occurrence separately when applying an edit.                                                  |
| Cache cleanup is separate from project save                                                        | Compatible                                                     | Keep only raw/intermediate engine output in cache; canonical artifacts stay in `project.json`.                                                |

### 13.2 No hidden compatibility layer

The incompatible rows are intentional model corrections, not adapter opportunities. The implementation plan must remove obsolete transcript ownership paths rather than maintain parallel `Word` and `TranscriptUnit` systems.

## 14. Reanalysis behavior

Reanalysis is a new full pipeline job for one source.

- The old bundle remains visible and usable until commit.
- A successful job creates a new `analysisRevisionId`, increments transcript revision, and atomically replaces the old bundle.
- Source-range timeline edits remain valid because they do not depend on transcript-unit IDs.
- Transient selections and runtime indexes are discarded and rebuilt.
- User-modified speaker display names require explicit reset confirmation unless a future verified speaker-mapping design is added.
- A source-fingerprint mismatch rejects publication rather than marking the new bundle current.

The first version does not preserve hand-edited transcript text because transcript correction is not yet a defined artifact workflow. The UI must describe reanalysis as replacement of machine analysis before starting it.

## 15. Testing and acceptance criteria

### 15.1 Domain tests

- Schema rejects empty, unordered, non-contiguous, punctuation-containing, duplicate-membership, cross-source, or invalid-time acoustic edit units.
- Schema accepts overlapping source ranges across distinct acoustic edit units.
- Schema rejects duplicate speakers, cross-revision speakers, and diarization or attribution references to unknown speaker IDs.
- Reverse indexes rebuild deterministically from persisted artifacts.
- Selection resolution expands partial acoustic units, ignores punctuation acoustically, blocks unaligned speech, and normalizes overlapping ranges.
- Selection of a repeated source projection edits only the explicitly selected clip occurrence.

### 15.2 Engine and worker tests

- whisper.cpp result normalization creates deterministic transcript units for Chinese and English fixtures.
- Worker protocol rejects malformed JSON, wrong versions, oversized messages, duplicate terminals, and premature exit.
- Cancellation waits for child exit and temporary cleanup.
- Alignment never invents per-character times from phrase-level evidence.
- Diarization overlap produces explicit ambiguous attribution where appropriate.

### 15.3 Transaction tests

- No artifact is published when any pipeline step fails.
- Existing analysis survives cancellation, crash, fingerprint change, stale revision, project switch, or failed save.
- Successful publication changes every nested artifact to the same analysis revision in one project-file rename.
- Save/open waits for the analysis job to settle and cannot race worker cleanup.
- Local timeline edits made during analysis survive renderer reconciliation.
- Renderer cannot forge paths, fingerprints, engine provenance, or acoustic units through `ProjectDraft`.

### 15.4 Product acceptance

- Representative Chinese and English podcast fixtures produce a stable visible transcript and source-time acoustic edit units.
- Selecting part of a multi-unit acoustic span visibly expands or is blocked; it is never silently split.
- Punctuation-only selection cannot issue an audio edit.
- Anonymous speakers are distinguishable and user labels persist across cache cleanup.
- Clearing cache preserves canonical transcript, alignment, speaker data, and prior non-destructive edits.
- Changing clip positions does not require reanalysis.
- A different transcriber adapter can be selected in tests without changing downstream domain contracts.

## 16. Deferred decisions

The following require separate future designs and do not block this subproject:

- User correction of canonical transcript text and alignment invalidation.
- Cross-reanalysis speaker identity mapping.
- Durable analysis payload files outside `project.json`.
- Model-selection UI and downloadable model lifecycle.
- Cache-compatible reuse across engine or model versions.
- Partial pipeline publication or alignment-only replacement.
- Natural-boundary scoring and advanced audio repair inside `AudioEditPlanner`.
- Hybrid Disfluency Detection and speech generation.

## 17. Implementation-plan gate

No production code is changed by this design. After review approval, a separate implementation plan will decompose the work into schema/domain migration, main-process worker integration, IPC and transaction publication, renderer projection and selection resolution, UI behavior, and verification fixtures.
