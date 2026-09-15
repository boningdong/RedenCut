# Speech Batch Implementation Plan

**Goal:** Generate every selected source and allow imports during analysis without losing either result.
**Architecture:** Main-owned serial phase batches, source-scoped optimistic commit guards, delta imports, independent renderer job state.
**Tech Stack:** TypeScript, Electron, Zustand, Python.
**Spec:** ../specs/2026-09-15-speech-batch-design.md

## Constraints

Preserve current reliability/alignment changes. No model downloads, host Electron, instruction edits or full-length inference. Work in current approved feature checkout. User approved implementation; routine design decisions are recorded here and do not require another gate.

## Tasks

- [x] 1. Background commit safety. Own project/BackgroundCommitPolicy.ts, WorkspaceController, audio/import/ImportCoordinator, audio.ipc and matching tests. Red tests: import then speech and speech then import preserve both changes; reject changed sources/newer same-source analyses; do not merge old drafts over live project. Implement source guards and import deltas under the existing mutex. Expose typed guard capture, background PCM resolution and background analysis commit methods for batch integration. Preserve strict foreground/session-switch checks.
- [x] 2. Independent speech stages. Own shared worker/artifact schemas, Python protocol/entry point, SpeechAnalysisCoordinator and matching tests. Add explicit pending diarization artifacts and separate alignment/diarization requests while retaining existing combined compatibility. Expose transcribeAndAlign(input, signal, onProgress) and identifySpeakers(input, artifact, signal, onProgress). Speaker enrichment must preserve transcript/alignment IDs. Red/green schema and Python protocol/phase tests; verify old artifacts still load.
- [x] 3. Main batch. Add shared batch contract, pure source planner, serial batch coordinator and tests. Cases: duplicate source across tracks, empty first track, reusable completed/pending results, text-first order, per-source errors and cancellation. Adapt speech IPC/preload to snapshot settings/source inputs and publish per-source sessions plus job progress. Keep active ownership independent of project revision and reject replaced sources at commit.
- [x] 4. Renderer. Add speechBatch store and progress view; replace first-track/first-clip entry with explicit scope; preserve batch state during imports. Reconcile monotonic project results with current local timeline; preserve pending imports across speech completion. Test both completion orders, late progress/results, cancellation, all/track scope and live edits. Localize batch summary and pending speakers in English/Chinese.
- [x] 5. Integrate/review. Independently review concurrency and stage boundaries, fix observed failures, run npm run format, npm run check and Python unittest suite. Run short native two-phase pipeline using existing models and fresh Docker baseline/feature checks, retaining honest blocked classifications. Record final architecture in the design document and update the verification report without modifying instruction files.

## Verification commands

```sh
npx vitest run src/main/project src/main/audio/import src/main/ipc/audio.ipc.test.ts
npx vitest run src/main/speech src/shared/speechWorker.types.test.ts src/shared/speechArtifact.schema.test.ts
speech-worker/.venv/bin/python -m unittest discover -s speech-worker/tests
npx vitest run src/renderer/src/App.test.tsx src/renderer/src/stores src/renderer/src/components/Transcript
npm run format
npm run check
```

## Execution record

Initial state: codex/speech-process-reliability, previous item verified with 882 TypeScript and 41 Python tests. Previous implementation remains uncommitted and must be preserved. Parallel ownership separates background persistence, worker stages, and root-owned batch/UI integration.

Final integration checks passed: `npm run format`, `npm run check` (129 files, 922 tests, lint, dead-code analysis, typecheck and production build) and 43 Python unittest cases.
Native inference on the first 30 seconds of the user audio completed in 26.4 seconds, publishing pending text before speaker enrichment and preserving transcript/alignment identities.
Fresh Docker acceptance and final independent review are recorded separately in the verification report.
Implementation refinements and the final file structure are recorded in the design document; instruction and standards files were not modified.

Fresh Docker run `81870ecb-d8f9-45a9-8412-054c3dfa3a91` passed all five editing baseline checkpoints, import-after-edit undo/redo retention, all-track scope menu and resource guidance.
Inference-dependent UI progress, cancellation, concurrent import and post-analysis regeneration remain BLOCKED because Docker speech runtimes/models were not provisioned.
The report is `.harness-runs/container/81870ecb-d8f9-45a9-8412-054c3dfa3a91/agent-testing-report.md`; the owned application/container were stopped and removed.
Final independent read-only batch review found no concrete issues.
