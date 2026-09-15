# Speech batches and concurrent import

Status: approved in conversation; implementation authorized without further approval gates.

## Contract

Generate for a track selects all source IDs referenced by that track; generate all selects sources across every track including after empty tracks. Deduplicate by AudioSourceId in track/clip traversal order. Capture the source list and settings at admission; subsequent imports do not join the active batch. Analyze complete source audio, never clipped mixes. Reuse valid source analyses and finish pending diarization; explicit regeneration must not silently overwrite manual speaker labels.

Main owns the batch. Run all required transcription/alignment jobs serially, committing each usable text result, then run speaker recognition serially. Per-source errors allow unrelated sources to continue; unavailable shared resources prevent admission. Cancellation stops current and pending work while retaining published artifacts. Opening another project cancels its old jobs. No persistent queue recovery or project-person editing in this item.

Background identity is session plus job and source execution identity, independent of ordinary project revisions. Source fingerprint and expected analysis revision/artifact must match at commit. Never weaken strict optimistic concurrency for unrelated foreground mutations. Stage commits keep transcript/alignment identities stable when adding speakers.

Import and inference preparation may overlap. Their project writes are serialized using the existing workspace transaction mutex. Import commits a source/track addition against the latest project; speech commits only analysis metadata. Neither may replace the other's newer data or overwrite timeline edits with an old draft. UI snapshots are applied monotonically within the same workspace and local timeline edits are reconciled; import does not clear speech batch state. Project switch remains a full reset. Save As keeps its current cancellation boundary because workspace roots can change.

## Structure

Add shared speechBatch.types.ts; main speech/SpeechBatchPlanner.ts and SpeechBatchCoordinator.ts; project/BackgroundCommitPolicy.ts; renderer stores/speechBatch.store.ts and components/Transcript/SpeechBatchProgress.tsx. Evolve existing worker/coordinator/protocol/schema for phase requests and explicit pending diarization. Preserve ManagedProcess, model algorithms, artifact storage, transcript projection and project state ownership. Keep tests beside implementations. Avoid a generic scheduling framework.

## Validation

Test source deduplication across clips/tracks, empty first track, fixed admission snapshot, valid artifact reuse, all text before any diarization, per-source failure, cancellation retaining text, source replacement and stale analysis rejection. Exercise both import-first and speech-first completion, live edits, late UI events and project switch. Run Python suite and TypeScript focused/global checks, fresh Docker acceptance, and short native inference only. Do not rerun the full hour-long recording. Report unavailable UI inference resources as blocked.

## Implemented refinements

The batch IPC composition lives in `src/main/ipc/speechBatch.ipc.ts`, keeping planning and serial scheduling independent of Electron.
Speech artifact filenames include the artifact hash so pending text and completed speaker enrichment remain immutable, even with the same analysis revision.
Source guards also capture manual speaker overrides; a rename made during inference prevents stale replacement.
Ordinary Save preserves import and speech-analysis jobs, while settling legacy transcription/export jobs under their existing cancellation contract.
Save As and project switching retain cancellation boundaries.
Renderer import reconciliation rebases imported tracks into existing undo/redo snapshots, preserving both imported media and earlier edit history.
Cancellation checks precede the final workspace snapshot, and queued background commits are abortable to avoid blocking project switching.

The new file structure is:

```text
src/
  shared/speechBatch.types.ts
  main/
    ipc/speechBatch.ipc.ts
    project/BackgroundCommitPolicy.ts
    speech/
      SpeechBatchPlanner.ts
      SpeechBatchCoordinator.ts
  renderer/src/
    stores/speechBatch.store.ts
    components/Transcript/SpeechBatchProgress.tsx
```

Matching tests live beside implementations.
Existing process management, audio import, workspace persistence, speech coordinator, Python worker and renderer integration files were extended at their current boundaries.
