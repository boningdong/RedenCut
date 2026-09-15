# Speech Process Reliability Implementation Plan

> For agentic workers: execute task by task with test-first changes and independent review.

Goal: reliable cancellable subprocesses and honest long-audio progress.
Architecture: shared lifecycle manager; stage adapters retain their protocols; advisory estimates never kill inference.
Tech stack: TypeScript/Node, React/Zustand, Python/pyannote.
Spec: ../specs/2026-09-14-speech-process-reliability-design.md

## Constraints

Preserve existing alignment changes and input audio. No model downloads or authentication. No project schema change. No queue/checkpoint/person features in this item. Unknown calibration profiles get elapsed time without invented estimates.

## Tasks

- [x] 1. Add ManagedProcess and real controlled-child tests: flood both pipes, cancel before spawn, ignore SIGTERM, malformed parser, inherited output handles, exit/cancel races. API accepts spawn factory, signal, stream callbacks; returns completion and fail(error), captures bounded diagnostics.
- [x] 2. Replace duplicated lifetime management in conversion, silence detection, Whisper and worker. Drain unused output; stream-parse Whisper progress across arbitrary boundaries. Remove hard inference wall/silence timers; preserve explicit protocol/size failure checks. Run relevant transcriber, preparation and worker tests.
- [x] 3. Add Python diarization hook adapter and tests for valid/absent totals. Forward activity without fabricated percentages; test JSONL purity.
- [x] 4. Add stage policy/progress timing and a localized isolated UI status component. Fake-clock tests verify estimate overruns remain advisory, unknown estimates stay absent, stage starts reset only on transitions, and progress is optional.
- [x] 5. Run short repeated and full source calibration via actual transcriber/coordinator/worker with diarization. Record durations, activity gaps, peak memory and model/device context. Add estimate coefficients only if evidence supports their applicability; document failures honestly. Completed two 300-second runs and one 900-second run. The user reprioritized validation to these successful short pipelines; the full run was intentionally stopped after 75m40s with continuing diarization activity. Keep the estimate range at 300–900 seconds; full completion and long-range calibration remain unverified.
- [x] 6. Review integration, run npm run format, npm run check and Python tests; use Docker MCP baseline/changed-behavior acceptance, retain report, clean owned runs. Update spec status and verification report. Final result: 882 TypeScript tests and 41 Python tests passed. Fresh Docker run 98f5dc1c-d3cb-4159-aa83-29fb7f6bafb2 passed all five editing baseline checks and zoom/language variations; speech inference/progress/cancellation UI remains BLOCKED by unavailable Docker runtimes/models. Owned run cleaned up; full report retained.

## Test commands

Run each focused test before and after its implementation:

```sh
npx vitest run src/main/processes/ManagedProcess.test.ts
npx vitest run src/main/speech
speech-worker/.venv/bin/python -m pytest speech-worker/tests
npm run format
npm run check
```

Use separate file ownership for Python hook and UI work while the main worker implements process lifecycle. Review all returned diffs before global checks. No implementation commits until verification and review; preserve existing unrelated untracked files.
