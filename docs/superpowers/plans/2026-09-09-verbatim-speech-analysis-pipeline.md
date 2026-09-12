# Verbatim Speech Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace RedenCut's word-timestamp transcript path with an atomically published, source-scoped verbatim speech bundle containing canonical transcript units, acoustic edit units, diarization, speaker attribution, and integrity-checked durable storage.

**Architecture:** Electron main owns the complete analysis pipeline and durable artifacts. The existing native whisper.cpp adapter produces best-effort-verbatim text; a job-scoped Python JSON Lines worker runs WhisperX forced alignment and pyannote anonymous speaker diarization; main normalizes and validates all outputs, writes one immutable `.redencut/speech/<audioSourceId>/revision-<analysisRevisionId>.json`, and atomically swaps its compact reference into `project.json`. The renderer receives only a path-free read projection and resolves text selections through `AcousticSelectionResolver` before creating ordinary non-destructive timeline edits.

**Tech Stack:** Electron 40, TypeScript 5.9, React 19, Zustand, Zod 4, Vitest, Node child processes, Python with a committed lockfile, PyTorch, WhisperX, pyannote.audio, whisper.cpp, Docker/OrbStack Linux ARM64, Playwright MCP harness.

**Spec:** [`docs/superpowers/specs/2026-08-30-verbatim-speech-analysis-pipeline-design.md`](../specs/2026-08-30-verbatim-speech-analysis-pipeline-design.md)

## Global Constraints

- Work in an isolated RedenCut Git worktree; do not implement directly on `main`.
- Do not add backward compatibility for version-1 projects or preserve `Word`/`Transcript` as a parallel domain model.
- Use test-driven development for each behavior change: add the focused failing test, observe the expected failure, implement the minimum behavior, then rerun the focused test.
- Keep model downloads, Hugging Face credentials, and generated caches out of Git. Never print or persist token contents.
- Normal application startup and fast tests must never install packages or download models.
- Treat the speech artifact as durable project data, not cache. Cache cleanup must never traverse `.redencut/speech`.
- Do not fabricate per-character or per-token times when the aligner only supports a larger acoustic unit.
- Every successful publication returns a same-workspace, newer-revision `RendererSession`; every failure or cancellation leaves the previous speech reference untouched.
- Commit after each task only when its focused verification passes. Run the full repository gate at the final task.

---

## Task 1: Prove and lock the speech runtime on Linux ARM64

**Files:**

- Create: `speech-worker/pyproject.toml`
- Create: `speech-worker/uv.lock`
- Create: `speech-worker/src/redencut_speech_worker/__init__.py`
- Create: `speech-worker/src/redencut_speech_worker/preflight.py`
- Create: `speech-worker/tests/test_preflight.py`
- Create: `speech-worker/models.json`
- Create: `harness/container/Dockerfile.speech`
- Create: `harness/container/run-speech.sh`
- Create: `harness/tests/speech-container.smoke.mjs`
- Modify: `package.json`
- Modify: `docs/speech-models-and-dependencies.md`

- [ ] Add a failing preflight test that requires a machine-readable descriptor containing protocol version, Python/PyTorch/WhisperX/pyannote versions, architecture, backend, and manifest status, while rejecting missing or partial model caches without attempting a download.
- [ ] Add a minimal independently runnable Python package, lock its complete dependency graph, and implement `python -m redencut_speech_worker.preflight --json` with distinct exit codes for runtime incompatibility, missing models, wrong revisions, gated access, and unsupported backend.
- [ ] Add `models.json` entries for the first supported transcription smoke model, Chinese and English alignment models, and `pyannote/speaker-diarization-community-1`. Each entry must contain capability, repository ID, immutable revision, expected files, license/access note, and supported execution profiles. Record the actual resolved revisions, never `main`.
- [ ] Add a separate `redencut-harness-speech` image extending the standard harness runtime with pinned Python and the locked worker environment. Keep the standard image unchanged.
- [ ] Add a username-agnostic launcher that resolves `HF_TOKEN_PATH`, then `HF_HOME/token`, then the Hugging Face default; mounts the resolved token file read-only at `/run/secrets/hf_token` only for explicit provisioning; and mounts a named model-cache volume separately.
- [ ] Implement explicit `provision` and `preflight` container commands. Provision into a staging directory, verify manifest revisions and expected files, then atomically write a cache-ready marker. Cached preflight and smoke runs must work without a token mount.
- [ ] Add `npm run speech:docker:build`, `speech:docker:provision`, and `speech:docker:preflight` scripts and document disk, CPU, credential, and native-Linux-CUDA boundaries.
- [ ] Build the image, provision the pinned models once, then run preflight a second time without forwarding the token.
- [ ] Commit: `build: add locked speech worker runtime`

**Verification:**

```sh
python -m unittest discover -s speech-worker/tests
npm run speech:docker:build
npm run speech:docker:provision
npm run speech:docker:preflight
node --test harness/tests/speech-container.smoke.mjs
git diff --check
```

**Checkpoint:** If locked WhisperX/pyannote/PyTorch packages cannot install or load on Linux ARM64 CPU, stop product integration and document the exact incompatibility. Do not silently substitute fake engines for the real-model lane.

## Task 2: Introduce the canonical speech domain and project schema version 2

**Files:**

- Create: `src/shared/speech.types.ts`
- Create: `src/shared/speechArtifact.schema.ts`
- Create: `src/shared/speechArtifact.schema.test.ts`
- Modify: `src/shared/project.types.ts`
- Modify: `src/shared/project.types.test.ts`
- Modify: `src/shared/session.types.ts`
- Modify: `src/shared/session.types.test.ts`
- Modify: test project fixtures under `src/**/*.test.ts`, `harness/**/*.test.ts`, and `e2e/**/*.ts`

- [ ] Add failing schema tests for every invariant in design section 4: non-empty and contiguous memberships, ordered speech-only units, unique membership, source/revision/fingerprint agreement, finite valid ranges, complete speaker references, valid attribution references, matching summaries, and permitted overlapping acoustic ranges.
- [ ] Define branded IDs, `TranscriptUnit`, `TranscriptArtifact`, `AcousticEditUnit`, `AlignmentArtifact`, `Speaker`, `DiarizationArtifact`, `SpeakerAttributionArtifact`, `SpeechArtifact`, `SpeechArtifactRef`, and `SpeakerLabelOverride` with strict Zod schemas.
- [ ] Add pure `validateSpeechArtifactReference(ref, artifact)` cross-file validation for digest-independent metadata and summary checks.
- [ ] Change `ProjectFileSchema` to literal version `2`, remove `transcript`, add `speechArtifacts` and `speakerLabelOverrides`, and validate uniqueness, known sources, normalized `speech/<source-id>/revision-<analysis-revision-id>.json` paths, SHA-256 shape, and override targets at project-schema level.
- [ ] Remove transcript from `ProjectDraft`. Add a path-free `RendererSpeechAnalysis` read projection to `RendererSession`, containing canonical units, acoustic units, speakers, attribution, overrides, and provenance but no artifact path or digest.
- [ ] Update all test fixtures to version 2 and remove old transcript payloads; do not add a v1 union or migration adapter.
- [ ] Commit: `feat: define canonical speech artifact schema`

**Verification:**

```sh
npx vitest run src/shared/speechArtifact.schema.test.ts src/shared/project.types.test.ts src/shared/session.types.test.ts
npm run typecheck
git diff --check
```

## Task 3: Add canonical transcript normalization and a replaceable transcriber contract

**Files:**

- Create: `src/main/speech/CanonicalTranscriptBuilder.ts`
- Create: `src/main/speech/CanonicalTranscriptBuilder.test.ts`
- Modify: `src/shared/transcriber.types.ts`
- Modify: `src/main/transcriber/whisper.ts`
- Modify: `src/main/transcriber/whisper.test.ts`
- Modify: `src/main/transcriber/TranscriptionCoordinator.ts`
- Modify: `src/main/transcriber/TranscriptionCoordinator.test.ts`

- [ ] Add failing tests showing that Chinese speech becomes selectable character units, Latin text becomes word units, punctuation remains visible but acoustically inert, whitespace does not become a unit, and output order is deterministic.
- [ ] Replace `ITranscriber.transcribe(): Transcript` with a `TranscriptionResult` DTO containing ordered verbatim text evidence, detected language, `verbatimCapability: 'verbatim' | 'best-effort-verbatim'`, and engine/model/config provenance.
- [ ] Adapt whisper.cpp JSON parsing to the DTO and explicitly report `best-effort-verbatim`; retain engine timestamps only as raw evidence for diagnostics and do not publish them as canonical alignment.
- [ ] Implement `CanonicalTranscriptBuilder` to assign fresh unit/artifact IDs, build punctuation-aware units, and create the immutable transcript artifact for the pipeline analysis revision.
- [ ] Adapt the standalone transcription coordinator and its tests to the new DTO so this task commits green. Task 8 deletes it only after the complete speech coordinator and IPC replacement pass.
- [ ] Commit: `refactor: separate transcriber output from speech artifacts`

**Verification:**

```sh
npx vitest run src/main/speech/CanonicalTranscriptBuilder.test.ts src/main/transcriber/whisper.test.ts
npm run typecheck
git diff --check
```

## Task 4: Implement canonical speech artifact storage and integrity checks

**Files:**

- Create: `src/main/speech/SpeechArtifactStore.ts`
- Create: `src/main/speech/SpeechArtifactStore.test.ts`
- Modify: `src/main/project/ProjectWorkspace.ts`
- Modify: `src/main/project/ProjectWorkspace.test.ts`
- Modify: `src/main/project/sessionProjection.ts`
- Modify: `src/main/project/sessionProjection.test.ts`

- [ ] Add failing tests for deterministic UTF-8 serialization, byte length and SHA-256 calculation, readable derived paths, path confinement, immutable final-file collision, staged-write cleanup, missing/corrupt/mismatched artifacts on open, and renderer projections that omit paths and digests.
- [ ] Implement one stable serializer and `SpeechArtifactStore` methods to prepare, stage, reread, verify, atomically rename, load, and project artifacts.
- [ ] Extend `ProjectWorkspace.open` to load and validate every referenced artifact after parsing `project.json`. Fail with an actionable integrity error instead of treating speech data as cache.
- [ ] Extend `ProjectWorkspace.saveAs` candidate preparation to verify every staged speech reference before destination publication. Preserve recursively copied `speech/` data and keep existing cache/media pruning scoped away from it.
- [ ] Build runtime transcript-unit-to-acoustic-unit indexes only from validated artifacts; do not persist them.
- [ ] Project all current speech artifacts into `RendererSession.speechAnalyses` while retaining main-only reference metadata in `ProjectFile`.
- [ ] Commit: `feat: persist integrity checked speech artifacts`

**Verification:**

```sh
npx vitest run src/main/speech/SpeechArtifactStore.test.ts src/main/project/ProjectWorkspace.test.ts src/main/project/sessionProjection.test.ts
npm run typecheck
git diff --check
```

## Task 5: Define and harden the JSON Lines worker protocol

**Files:**

- Create: `src/shared/speechWorker.types.ts`
- Create: `src/shared/speechWorker.types.test.ts`
- Create: `src/main/speech/SpeechWorkerClient.ts`
- Create: `src/main/speech/SpeechWorkerClient.test.ts`
- Create: `src/main/speech/__fixtures__/worker-fixture.mjs`
- Create: `speech-worker/src/redencut_speech_worker/protocol.py`
- Create: `speech-worker/src/redencut_speech_worker/__main__.py`
- Create: `speech-worker/tests/test_protocol.py`

- [ ] Add failing TypeScript and Python contract tests for versioned `ready`, stage progress, one terminal `result` or `error`, job-ID correlation, standard-error-only logs, malformed lines, unknown versions, duplicate terminal messages, premature exit, maximum line/result sizes, overall timeout, and no-progress timeout.
- [ ] Define matching strict request and response schemas. A request carries job ID, audio path, canonical transcript units, language, model-manifest selections, and non-secret engine configuration; a result carries normalized alignment and diarization DTOs plus provenance.
- [ ] Implement the job-scoped Python entry point: read exactly one request from stdin, emit JSON Lines to stdout, route logs to stderr, and exit after one terminal message.
- [ ] Implement `SpeechWorkerClient` with spawned-process ownership, incremental line parsing, bounded buffers, progress heartbeats, graceful termination, forced termination after a bounded grace period, exit settlement, and temporary-directory cleanup.
- [ ] Verify cancellation waits for process exit and cleanup before the client promise settles.
- [ ] Commit: `feat: add job scoped speech worker protocol`

**Verification:**

```sh
npx vitest run src/shared/speechWorker.types.test.ts src/main/speech/SpeechWorkerClient.test.ts
python -m unittest discover -s speech-worker/tests
npm run typecheck
git diff --check
```

## Task 6: Implement real WhisperX alignment normalization

**Files:**

- Create: `speech-worker/src/redencut_speech_worker/alignment.py`
- Create: `speech-worker/tests/test_alignment.py`
- Create: `speech-worker/tests/fixtures/alignment/zh.json`
- Create: `speech-worker/tests/fixtures/alignment/en.json`
- Modify: `speech-worker/src/redencut_speech_worker/__main__.py`
- Modify: `speech-worker/models.json`

- [ ] Capture small, license-compatible normalized fixture outputs from the pinned Chinese and English alignment models; do not commit model weights or raw user media.
- [ ] Add failing tests for exact unit-order mapping, grouped `AcousticEditUnit` output when individual transcript units cannot be located, explicit unaligned speech, punctuation exclusion, confidence propagation, finite source bounds, and no average-splitting fallback.
- [ ] Implement a WhisperX alignment adapter that consumes the canonical transcript text, selects only manifest-pinned language models, records the resolved repository/revision/config provenance, and emits normalized acoustic-unit DTOs.
- [ ] Run real alignment in the speech container against the short Mandarin fixture and confirm at least one non-empty, valid acoustic unit without asserting production quality.
- [ ] Commit: `feat: normalize whisperx acoustic alignment`

**Verification:**

```sh
python -m unittest speech-worker.tests.test_alignment
npm run speech:docker:preflight
sh harness/container/run-speech.sh python -m unittest speech-worker.tests.test_alignment
git diff --check
```

## Task 7: Implement pyannote diarization and deterministic speaker attribution

**Files:**

- Create: `speech-worker/src/redencut_speech_worker/diarization.py`
- Create: `speech-worker/tests/test_diarization.py`
- Create: `speech-worker/tests/fixtures/diarization/overlap.json`
- Create: `src/main/speech/SpeakerAttribution.ts`
- Create: `src/main/speech/SpeakerAttribution.test.ts`
- Modify: `speech-worker/src/redencut_speech_worker/__main__.py`

- [ ] Add failing worker tests for anonymous stable-within-result speaker labels, overlapping turns, confidence when available, finite valid ranges, and provenance for `speaker-diarization-community-1`.
- [ ] Implement the pyannote adapter using the token only during explicit provisioning; normal analysis loads the verified local snapshot offline and never writes credentials to result or logs.
- [ ] Add failing TypeScript tests for overlap-duration attribution, deterministic ties, unsupported units, ambiguous overlapping speech, candidate speaker IDs, and immutable generated display names.
- [ ] Implement speaker catalog normalization and `SpeakerAttribution` without attempting real-world identity recognition.
- [ ] Run real diarization in the speech container against the short mixed conversation fixture and validate at least two anonymous speakers and schema-valid turns; record runtime and peak memory as smoke evidence only.
- [ ] Commit: `feat: add anonymous speaker diarization`

**Verification:**

```sh
python -m unittest speech-worker.tests.test_diarization
npx vitest run src/main/speech/SpeakerAttribution.test.ts
sh harness/container/run-speech.sh python -m redencut_speech_worker.preflight --json
git diff --check
```

## Task 8: Orchestrate, cancel, and atomically publish complete analysis jobs

**Files:**

- Create: `src/main/speech/SpeechAnalysisCoordinator.ts`
- Create: `src/main/speech/SpeechAnalysisCoordinator.test.ts`
- Modify: `src/main/project/WorkspaceController.ts`
- Modify: `src/main/project/WorkspaceController.test.ts`
- Modify: `src/main/project/SessionJobRegistry.ts`
- Modify: `src/main/project/SessionJobRegistry.test.ts`
- Replace: `src/main/ipc/transcript.ipc.ts` with `src/main/ipc/speechAnalysis.ipc.ts`
- Replace: `src/main/ipc/transcript.ipc.test.ts` with `src/main/ipc/speechAnalysis.ipc.test.ts`
- Modify: `src/main/index.ts`

- [ ] Add failing coordinator tests for ordered transcription/alignment/diarization/attribution/validation/publication stages, prior-job replacement, source revalidation, stale revision, worker failure, timeout, cancellation, sender destruction, project switch, and preserving the prior artifact in every non-success case.
- [ ] Add `speech-analysis` to `SessionJobRegistry` and ensure cancellation settlement includes worker exit and temporary cleanup.
- [ ] Add `WorkspaceTransaction.commitSpeechAnalysis(preparedArtifact, submittedDraft, reanalysisConfirmation)` that rechecks token/revision/fingerprint, publishes content first, validates the candidate reference, atomically saves `project.json`, advances the same workspace revision, and returns the committed session.
- [ ] Ensure the analysis coordinator publishes directly through `WorkspaceController.runTransition` and never calls `ProjectMutationCoordinator.begin`, preventing self-cancellation.
- [ ] Replace transcript IPC with strict `speechAnalysis:checkAvailability`, `speechAnalysis:start`, and `speechAnalysis:cancel` handlers. The start request includes the current editable draft and returns `SessionJobResult<RendererSession>`.
- [ ] Emit structured stages `transcribing`, `aligning`, `diarizing`, `attributing-speakers`, `validating`, and `publishing` with optional bounded percentages.
- [ ] Require explicit reanalysis confirmation when current speaker-label overrides would be invalidated; on confirmed success, remove only overrides bound to the replaced artifact.
- [ ] Remove the obsolete standalone `TranscriptionCoordinator` and transcript IPC registrations.
- [ ] Commit: `feat: publish complete speech analysis atomically`

**Verification:**

```sh
npx vitest run src/main/speech/SpeechAnalysisCoordinator.test.ts src/main/project/WorkspaceController.test.ts src/main/project/SessionJobRegistry.test.ts src/main/ipc/speechAnalysis.ipc.test.ts
npm run typecheck
git diff --check
```

## Task 9: Replace the renderer transcript ownership and reconcile committed sessions

**Files:**

- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/stores/transcript.store.ts`
- Modify: `src/renderer/src/stores/transcript.store.test.ts`
- Modify: `src/renderer/src/utils/transcript.ts`
- Modify: `src/renderer/src/utils/transcript.test.ts`
- Modify: `src/renderer/src/components/Transcript/TranscriptPanel.tsx`
- Modify: `src/renderer/src/components/Transcript/TranscriptPanel.persistence.test.tsx`
- Delete: `src/renderer/src/utils/wordOutputTime.ts`
- Delete: obsolete word-timestamp tests after equivalent projection coverage exists

- [ ] Add failing store and reconciliation tests showing that renderer state comes from `RendererSession.speechAnalyses`, paths/digests are absent, source-scoped analyses project through explicit clip occurrences, and post-submission timeline/export edits survive a same-token revision advance.
- [ ] Replace `Word[]`, `selectedWordIds`, per-word timestamp shifting, and renderer-authored transcript merging with read-only transcript/acoustic/speaker projections and `selectedTranscriptUnitIds`.
- [ ] Change generation flow to submit a draft snapshot, accept the authoritative returned session, preserve independent local edits through the existing edit ledger pattern, and never call `markEdited` merely because analysis completed.
- [ ] Derive playhead highlighting from an acoustic edit unit projected through the active clip; highlight every transcript unit in the active acoustic unit together. Punctuation has no independent playhead time.
- [ ] Remove `Sync to playhead`; a future calibration flow must replace or regenerate a full alignment artifact.
- [ ] Show generated speaker labels and effective user overrides without exposing diarization engine labels as identity claims.
- [ ] Commit: `refactor: render canonical source scoped transcripts`

**Verification:**

```sh
npx vitest run src/renderer/src/stores/transcript.store.test.ts src/renderer/src/utils/transcript.test.ts src/renderer/src/components/Transcript/TranscriptPanel.persistence.test.tsx
npm run typecheck
git diff --check
```

## Task 10: Resolve acoustic selections and make editability visible in the UI

**Files:**

- Create: `src/renderer/src/domain/AcousticSelectionResolver.ts`
- Create: `src/renderer/src/domain/AcousticSelectionResolver.test.ts`
- Create: `src/renderer/src/domain/AudioEditPlanner.ts`
- Create: `src/renderer/src/domain/AudioEditPlanner.test.ts`
- Create: `src/renderer/src/components/Transcript/AcousticSelectionNotice.tsx`
- Create: `src/renderer/src/components/Transcript/AcousticSelectionNotice.test.tsx`
- Modify: `src/renderer/src/components/Transcript/TranscriptPanel.tsx`
- Modify: `src/renderer/src/stores/timeline.store.ts`
- Modify: `src/renderer/src/stores/timeline.store.test.ts`
- Modify: `src/renderer/src/utils/wordClipState.ts`

- [ ] Add failing resolver tests for exact selection, partial-unit expansion, duplicate/out-of-order input IDs, punctuation-only selection, mixed speech and punctuation, unaligned speech blocking, overlapping ranges, and incompatible clip occurrences.
- [ ] Implement `AcousticSelectionResolver` as a pure domain service returning requested units, resolved units, acoustic-unit IDs, source ranges, and `expanded` without making timeline changes.
- [ ] Implement a minimal `AudioEditPlanner` that accepts confirmed source ranges plus one explicit clip occurrence and delegates source-boundary split/mute operations to timeline state. Keep natural-boundary search and crossfade tuning behind this planner for later refinement.
- [ ] Render acoustically editable speech, punctuation, and unaligned speech with logically distinct UI states. The caret may select punctuation, but punctuation-only selection disables the audio edit command and never appears struck through as if audio were removed.
- [ ] For partial acoustic-unit selection, retain the requested native selection, add an effective-range highlight, explain the expansion using visible text, and require confirmation before calling the planner.
- [ ] Replace direct `Word.muted` toggles with timeline-derived muted presentation and persist only clip/split/mute edits. Verify undo/redo derives transcript state consistently.
- [ ] Commit: `feat: resolve transcript edits to acoustic units`

**Verification:**

```sh
npx vitest run src/renderer/src/domain/AcousticSelectionResolver.test.ts src/renderer/src/domain/AudioEditPlanner.test.ts src/renderer/src/components/Transcript/AcousticSelectionNotice.test.tsx src/renderer/src/stores/timeline.store.test.ts
npm run typecheck
git diff --check
```

## Task 11: Add explicit speaker-label mutations

**Files:**

- Create: `src/shared/speakerLabel.types.ts`
- Create: `src/main/ipc/speakerLabel.ipc.ts`
- Create: `src/main/ipc/speakerLabel.ipc.test.ts`
- Modify: `src/shared/ipc.types.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/components/Transcript/TranscriptPanel.tsx`
- Create: `src/renderer/src/components/Transcript/SpeakerLabelEditor.test.tsx`

- [ ] Add failing tests for renaming only a speaker in the current source/revision/digest binding, rejecting stale or unknown speakers, preserving immutable machine labels, atomically saving project metadata, and returning a newer committed renderer session.
- [ ] Add one strict speaker-label mutation IPC rather than placing machine analysis or labels back into the generic renderer draft.
- [ ] Add inline speaker display-name editing that shows the override while retaining anonymous machine identity underneath. Disable it during analysis for the target source.
- [ ] Verify reanalysis confirmation names the overrides that will be reset and cancellation preserves them.
- [ ] Commit: `feat: persist user speaker labels separately`

**Verification:**

```sh
npx vitest run src/main/ipc/speakerLabel.ipc.test.ts src/renderer/src/components/Transcript/SpeakerLabelEditor.test.tsx
npm run typecheck
git diff --check
```

## Task 12: Prove end-to-end behavior in deterministic, real-model, and native lanes

**Files:**

- Create: `e2e/speech-analysis.e2e.ts`
- Create: `e2e/scenarios/speech-analysis-workflow.md`
- Create: `harness/tests/speech-real-model.integration.ts`
- Modify: `e2e/README.md`
- Modify: `harness/container/README.md`
- Modify: `docs/speech-models-and-dependencies.md`
- Modify: `docs/superpowers/specs/2026-08-30-verbatim-speech-analysis-pipeline-design.md` only if implementation evidence exposes a genuine design correction

- [ ] Add a deterministic end-to-end adapter lane covering generation, visible transcript, shared acoustic-unit highlighting, punctuation editability, partial-selection confirmation, mute/undo/redo, save, reopen, speaker override, cancellation, and prior-artifact preservation.
- [ ] Add an opt-in real-model speech-container lane using the short conversation fixture. Assert protocol, schema, atomic persistence, reopen, UI projection, and anonymous multi-speaker output; do not assert exact wording, exact boundaries, or production quality.
- [ ] Run the native macOS product-default lane on the 81-second conversation fixture. Record transcript mode, detected language, acoustic-unit coverage, speaker-count observation, elapsed time, peak memory where measurable, provenance, and any qualitative limitations.
- [ ] Use the agent-testing harness baseline to inspect the final UI and retained screenshot evidence. Verify punctuation-only selection cannot invoke audio editing and partial units visibly require confirmation.
- [ ] Update operational documentation with exact build, provision, cached run, native install, cache cleanup, troubleshooting, and license/access commands discovered during implementation.
- [ ] Run full static, unit, build, harness, and E2E gates; inspect the final diff for secrets, model files, cache artifacts, obsolete `Word` ownership, and accidental v1 compatibility.
- [ ] Request code review, address findings with focused tests, and commit: `test: verify speech analysis pipeline end to end`

**Verification:**

```sh
npm run check
npm run test:harness:all
npm run test:e2e
npm run speech:docker:preflight
sh harness/container/run-speech.sh npm run test:e2e -- speech-analysis.e2e.ts
git diff --check
git status --short
```

The native macOS quality/performance run is recorded separately from Docker CPU smoke. CUDA remains an optional native Linux plus NVIDIA acceptance profile and is not claimed by this plan.

## Self-review checklist

- [ ] Every design invariant and conflict-matrix row is covered by a task and a named test.
- [ ] No task leaves `Word` and `TranscriptUnit` as co-authoritative models.
- [ ] No renderer-writable payload contains machine speech artifacts.
- [ ] No artifact path, digest, absolute executable path, temporary path, or secret crosses into the renderer projection unless the contract explicitly requires it.
- [ ] Project open, save-as, publication, cancellation, source mutation, and project switching each have failure-path tests.
- [ ] `artifactSha256` remains in `project.json` for integrity while the readable artifact path is derived from stable source and analysis-revision IDs.
- [ ] Model setup is username agnostic and gated access remains developer-specific.
- [ ] Docker real-model smoke and native macOS quality/performance claims remain clearly separated.
- [ ] The plan contains no `TODO`, `TBD`, placeholder model branch, ellipsis implementation, or unspecified test command.
