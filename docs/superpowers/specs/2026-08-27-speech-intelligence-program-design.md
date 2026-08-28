# Speech Intelligence Program Design

## Status and purpose

This document is the program-level design for PodCut's speech-intelligence work.

It records the product goals, subsystem boundaries, shared design principles, delivery order, and initial technology choices across three related subprojects.

It is not an implementation plan. Each subproject receives a separate detailed design and implementation plan immediately before work begins, so later implementation discoveries do not turn this document into a progress log.

The three subprojects are:

1. Verbatim Speech Analysis Pipeline.
2. Hybrid Disfluency Detection.
3. Assisted Speech Generation and Replacement.

The first two subprojects are the current product priority. Speech generation remains a future capability until accurate timing, speaker attribution, and reviewable disfluency annotations are stable.

## Program goals

- Produce an editable verbatim transcript whose text, acoustic timing, audio source, track, and anonymous local speaker attribution remain coherent.
- Detect fillers, repetitions, false starts, and related disfluencies on demand without replacing or mutating the canonical transcript.
- Represent all machine analysis as reviewable, non-destructive project data with provenance and confidence evidence.
- Keep transcription, alignment, diarization, disfluency detection, and future speech generation replaceable behind domain-specific interfaces.
- Preserve source-audio coordinates so analysis survives clip movement, timeline insertions, and other non-destructive edits.
- Prepare for future insertion or replacement of generated speech without coupling today's editing model to a particular synthesis engine.

## Program boundaries

### Included

- Verbatim speech-to-text.
- Forced alignment of transcript units to source audio.
- Anonymous speaker diarization and transcript attribution.
- On-demand hybrid disfluency detection.
- Review, acceptance, rejection, and threshold filtering of detected intervals.
- Future consent-based voice cloning, insertion, and replacement.
- Local model adapters and replaceable engine contracts.

### Excluded

- Identifying a speaker's real-world identity from their voice.
- Automatically deleting every detected disfluency without review.
- Treating heterogeneous model scores as calibrated probabilities before evaluation.
- Requiring one vendor or model family across all speech capabilities.
- Single-word or phoneme-level generative speech inpainting in the first generation release.
- A general public plugin system as part of either initial speech-analysis subproject.

## System organization

The program contains two current pipelines and one future pipeline.

```text
Verbatim Speech Analysis Pipeline
├── Verbatim Transcriber
├── Alignment Engine
├── Diarization Engine
└── Speaker Attribution
          ↓
Canonical Verbatim Transcript

Hybrid Disfluency Detector (on demand)
├── Intended Transcript Provider
├── Verbatim–Intended Differ
├── Rule and Algorithm Detectors
└── Internal Candidate Merge
          ↓
Disfluency Intervals

Assisted Speech Generation Pipeline (future)
├── Authorized Voice Profile
├── Speech Synthesis Engine
├── Duration and Acoustic Matching
└── Non-destructive Clip Insertion or Replacement
```

Each high-level pipeline is one product operation. Its internal engines remain independently replaceable and testable.

A general `PipelineStep<Input, Output>` framework is intentionally deferred. PodCut first defines domain interfaces whose names and contracts express the actual capability required.

## Shared data principles

### Canonical transcript

The main transcript is the user's editable, verbatim representation of the source speech.

Its lexical content comes from the configured verbatim transcriber. Its precise acoustic boundaries come from alignment. Its anonymous speaker attribution comes from diarization reconciliation.

Running disfluency detection does not replace the canonical transcript, regenerate its word IDs, or overwrite user edits.

Every transcript artifact records the engine, model, mode, configuration identity, source fingerprint, and analysis revision that produced it.

### Source-time analysis

Alignment spans, diarization turns, and disfluency intervals use `AudioSourceId` plus source-relative start and end times.

Renderer projections convert those coordinates to output-timeline positions through the current clips. Moving or splitting a clip therefore does not invalidate source analysis.

Analysis tied to changed source content is invalidated through the existing source fingerprint rather than through timeline edits.

### Derived artifacts and review state

Model outputs are derived artifacts. User decisions are durable project state.

Raw detector evidence, merged suggestions, and user review state remain distinguishable so changing a threshold or merge algorithm does not erase prior evidence or silently undo a user decision.

### Provenance and caching

Every derived artifact includes enough provenance to decide whether it can be reused:

- Audio source identity and fingerprint.
- Engine and model identity.
- Engine configuration hash.
- Artifact schema version.
- Creation time and analysis revision.

Cache reuse is exact by default. A later subproject may define compatible reuse across model versions only when that behavior is explicitly tested.

## Subproject 1 — Verbatim Speech Analysis Pipeline

### Goal

Create one reliable product operation that produces a time-accurate, speaker-aware verbatim transcript.

### Logical flow

```text
Source audio
  → verbatim transcription
  → forced alignment
  → anonymous speaker diarization
  → deterministic speaker attribution
  → canonical transcript publication
```

### Initial technology direction

- Keep whisper.cpp as the initial local transcription baseline, while making verbatim intent explicit in the transcription contract and recorded provenance.
- Evaluate WhisperX as the initial alignment adapter.
- Evaluate WhisperX with its diarization backend as the initial diarization adapter.
- Keep alignment and diarization as separate interfaces even when one package supplies both implementations.
- Keep alternative alignment models and diarization engines such as pyannote Community-1 or NeMo Sortformer replaceable behind those interfaces.

### Speaker semantics

This subproject distinguishes speakers within analyzed audio. It does not identify who a speaker is.

Speaker IDs are anonymous and local to an analysis result, such as `SPEAKER_00` and `SPEAKER_01`.

Speaker attribution uses aligned transcript spans and diarization turns. Ambiguous overlap is represented explicitly rather than forcing an unsupported assignment.

User-edited labels remain separate from raw model identities and are not silently overwritten by reanalysis.

### Detailed-design questions

The subproject-specific design must resolve:

- The exact verbatim guarantee and capability reporting of `ITranscriber`.
- The unit used for canonical text editing versus acoustic alignment in Chinese.
- Python/model-process isolation from Electron main.
- Progress, cancellation, timeout, availability, and partial-failure behavior.
- Artifact persistence versus regenerable cache storage.
- Publication as one atomic project mutation.
- Reanalysis behavior when user transcript edits already exist.
- Diarization overlap and ambiguity representation.

### Exit criteria

- Representative Chinese and English podcast fixtures produce stable source-time transcript boundaries.
- Speaker turns are assigned without requiring real-world identity.
- Re-running an unchanged analysis is cacheable and does not alter user edits.
- Engine failures are actionable and cannot partially publish a canonical transcript.
- Engine adapters can be replaced without changing renderer components.

## Subproject 2 — Hybrid Disfluency Detection

### Goal

Detect reviewable disfluency intervals on demand while keeping the canonical transcript unchanged.

### Public contract

The product-level detector accepts source audio plus the canonical verbatim transcript and returns source-time disfluency intervals.

It does not return a replacement transcript.

### Internal detection branches

The default hybrid detector combines two branches:

1. A model-difference branch obtains an intended transcript, aligns it with the canonical verbatim text, and extracts candidate omissions or transformations.
2. A rule and algorithm branch detects lexical fillers, repetitions, false starts, prolongations, vocal events, and future acoustic patterns.

An internal deterministic merge removes duplicate or substantially overlapping candidates and retains evidence from every contributing branch.

The merge is not a public engine interface in the first version. It may become one only if independently installed detector plugins later require a stable candidate-combination contract.

### Interval semantics

Each detected interval contains at least:

- Audio source identity.
- Source-relative start and end.
- Disfluency category.
- Display text when applicable.
- Optional local speaker identity.
- Aggregate ranking score.
- Per-detector evidence and provenance.

Scores initially rank suggestions; they are not presented as literal correctness probabilities without calibration on representative PodCut data.

User thresholds control visibility and bulk selection. They do not destroy lower-scored detector output.

### Initial technology direction

- Evaluate CrisperWhisper verbatim/intended difference as the first model-based research adapter.
- Keep CrisperWhisper outside the distributable core unless its model and output license permits the intended use.
- Ship the core detector contract and commercially compatible rule-based detection independently of any restricted model.
- Keep the intended transcript provider replaceable so a differently licensed model can be substituted later.
- Begin transcript difference with normalized, order-preserving token alignment and replace the algorithm behind the differ if representative data exposes systematic errors.

### Detailed-design questions

The subproject-specific design must resolve:

- Candidate taxonomy and merge rules.
- Chinese and English text normalization boundaries.
- Mapping model differences back to aligned source spans.
- Storage of raw results, merged suggestions, and review decisions.
- Threshold behavior and confidence presentation.
- Reanalysis after transcript edits or engine changes.
- Optional model installation and license disclosure.

### Exit criteria

- Detection runs only when requested.
- The canonical transcript and existing edits remain unchanged.
- Suggestions are source-time intervals independent of transcript token identity.
- Duplicate evidence becomes one reviewable suggestion without losing provenance.
- Users can accept, reject, filter, and selectively apply suggestions.
- Precision, recall, and boundary quality are measured on representative podcast fixtures.

## Subproject 3 — Assisted Speech Generation and Replacement

### Goal

Allow an authorized user to generate speech in a selected speaker's voice and insert or replace content non-destructively.

### Intended interactions

- Insert at a text position: generate a new clip and shift later output content.
- Replace selected speech: generate a new clip, remove or mute the selected source range, and shift later output content according to the generated duration.
- Keep transcript and audio movement synchronized through the existing source and output-time mapping.

### Initial technology direction

- Evaluate CosyVoice as the primary Chinese voice-cloning baseline.
- Retain GPT-SoVITS and OpenVoice as alternatives.
- Treat direct speech inpainting systems as later research rather than a first implementation dependency.
- Generate a durable or regenerable managed audio source, then reuse the normal Clip and Track model instead of adding a second playback path.

### Required safeguards and quality stages

- Require explicit authorization for each enrolled voice profile.
- Keep voice references and embeddings locally controlled and deletable.
- Match generated duration when replacing selected speech.
- Match loudness, spectral character, room tone, and edit-boundary transitions before publication.
- Make generation previewable and reversible.
- Record synthesis engine and model provenance.

### Start condition

This subproject begins only after source-time alignment, speaker attribution, and non-destructive annotation behavior are stable enough to support reliable selection and replacement.

## Cross-subproject architecture

### Process ownership

Electron main owns model processes, filesystem paths, source resolution, cancellation, and publication into the active workspace.

The renderer owns user interaction, progress presentation, review state, and path-free projections onto the transcript and timeline.

Shared modules own serializable pipeline contracts, artifacts, options, progress events, and errors.

Model-specific Python environments or helper services are implementation adapters. They do not receive project mutation authority and do not become the persisted domain model.

### Non-destructive publication

Analysis and synthesis jobs prepare results outside the project mutation boundary.

Before publication, main revalidates the workspace token, project revision, source identity, and source fingerprint. Publication then occurs as one validated project mutation.

Cancellation, model failure, project switching, or stale inputs publish nothing.

### Extension strategy

Replaceable first-party interfaces are not automatically public plugin contracts.

The future plugin-system project may expose selected speech-engine capabilities after the built-in adapters demonstrate that the contracts are sufficient and the security boundary is understood.

## Delivery sequence

```text
Program design
  ↓
Subproject 1 detailed design and plan
  ↓
Verbatim Speech Analysis implementation and evaluation
  ↓
Subproject 2 detailed design and plan
  ↓
Hybrid Disfluency Detection implementation and evaluation
  ↓
Subproject 3 detailed design and plan when prerequisites are stable
  ↓
Assisted Speech Generation implementation and evaluation
```

Each subproject follows the same lifecycle:

1. Confirm scope and success criteria.
2. Write and review a focused design.
3. Write a task-level implementation plan.
4. Implement in reviewable increments.
5. Verify automated checks and representative manual audio behavior.
6. Update the roadmap and durable architecture documentation when delivered behavior changes them.

## Program-level evaluation

Representative fixtures must include:

- Mandarin and English speech.
- Single- and multi-speaker podcasts.
- Speaker overlap, short turns, silence, and background noise.
- Fillers, repetitions, false starts, and semantically meaningful uses of common filler-like phrases.
- Timeline edits that move, split, mute, or duplicate source ranges.

Subproject plans define exact metrics. At program level, PodCut tracks:

- Transcript correctness and verbatim retention.
- Alignment boundary error.
- Diarization and speaker-attribution error.
- Disfluency precision, recall, and interval quality.
- Analysis latency, memory, cancellation, and cache reuse.
- Future generated-speech intelligibility, speaker similarity, duration error, and audible seam quality.

## Known risks

- Whisper-family models may omit disfluencies even when configured for verbatim output.
- Chinese display units do not necessarily correspond to acoustically safe edit boundaries.
- Intended transcripts may normalize or rewrite content beyond disfluency removal.
- Diarization quality degrades with overlapping speech, noise, short turns, and similar voices.
- Model code, weights, training data, and generated outputs may have different licenses.
- Local GPU, Apple Silicon, CPU, and Windows support may require different adapters.
- Generated voice quality can match timbre while still producing an audible edit because prosody and room acoustics do not match.

These risks are addressed through replaceable adapters, explicit provenance, representative evaluation, non-destructive review, and separately approved subproject designs.
