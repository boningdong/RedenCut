# Application Diagnostics and Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Give installed RedenCut users actionable failure messages and a private, user-exported diagnostic report while retaining bounded normal-operation context.

**Architecture:** Main owns a structured local event log, terminal failure classification and report snapshots. Domains emit stable codes; IPC exposes only public reasons and report IDs; renderer translates and presents actions in the owning workflow. Speech analysis is the first complete domain integration.

**Tech Stack:** Electron 40, TypeScript, React, Vitest, Python unittest, Node filesystem APIs, existing IPC and localization contracts.

**Spec:** docs/superpowers/specs/2026-09-23-application-diagnostics-design.md

## Global Constraints

- No automatic upload, audio capture, transcript capture, project-file attachment, or blanket collection of operating-system logs.
- Main owns logging, filesystem access, classification at process boundaries and report export; preload is a narrow adapter; renderer does not access filesystem APIs.
- Routine logging uses low-volume info, warn and error milestones; no high-frequency audio, waveform or frame events.
- Start with 4 MiB per log file, five files and fourteen days of retention, whichever removes data sooner.
- Facts are allowlisted per event. Never serialize audio, transcript text, project contents, credentials or raw absolute paths into logs or reports.
- A logging failure cannot fail the user operation or recursively log itself.
- Every reportable failure has one diagnostic ID; cancellation and ordinary validation feedback do not become reportable failures.
- Single-task and batch failures use the same classification service; each batch failure has its own ID.
- The user previews the exact sanitized JSON report before a native save dialog; the app never sends it.
- Known deterministic errors do not lead with Retry; only confirmed causes receive specific user guidance.
- Keep English and Simplified Chinese equivalent and retain semantic reasons for retranslation after a locale change.
- Follow AGENTS.md and docs/coding-standards.md: run npm run format and npm run check before completion, and run agent-testing baseline and changed-behavior Docker MCP scenarios for the final user-visible feature.

## Review Focus

- Two batch sources fail with the same underlying worker error: each gets a distinct ID and a combined report includes both, without duplicate error events. Exercise in Task 4.
- A worker returns an error JSONL message and exits nonzero: preserve its stable code instead of replacing it with a generic process-exit code. Exercise in Task 3.
- A private path or transcript leaks through a nested Error cause or stderr: neither log nor exported JSON contains it. Exercise in Tasks 1 and 5.
- The log rotates between preview and save: the saved report is byte-for-byte the previewed snapshot, and a missing old incident is labeled partial. Exercise in Task 5.
- The UI locale changes after a failure: the retained reason retranslates, and the same diagnostic ID remains available for export. Exercise in Task 6.

---

### Task 1: Bounded application event log

**Files:**
- Create: src/shared/diagnostics.types.ts
- Create: src/main/diagnostics/DiagnosticLog.ts
- Create: src/main/diagnostics/DiagnosticLog.test.ts
- Modify: src/main/index.ts

**Interfaces:**
- Produces: AppLogEventSchema and AppLogEvent with schemaVersion, time, level, event, operationId, diagnosticId and a discriminated safe-facts union.
- Produces: DiagnosticLog.create(directory, options?) and async write(event), flush(), readRecent(), dispose().
- The writer owns a serialized queue, 4 MiB x five files and fourteen-day pruning. It falls back to console on write failure, with a guard against recursive fallback.

- [ ] **Step 1: Write the failing test.** Use a temporary directory and inject a tiny byte limit. Assert an info milestone and one error survive readRecent in order; forced rotation respects the file count; old dated files are pruned; a filesystem write rejection calls fallback once and the original write resolves. Pass a forbidden nested field and assert AppLogEventSchema rejects it.

~~~ts
const log = await DiagnosticLog.create(directory, { maxBytes: 160, maxFiles: 2, maxAgeDays: 14, fallback })
const milestone: AppLogEvent = { schemaVersion: 1, time: now, level: 'info', event: 'speech/alignment-started', operationId: 'job-1', facts: { segmentCount: 2 } }
await log.write(milestone)
await log.flush()
expect((await log.readRecent()).map((event) => event.event)).toContain('speech/alignment-started')
expect(AppLogEventSchema.safeParse({ ...milestone, facts: { transcript: 'private words' } }).success).toBe(false)
~~~

- [ ] **Step 2: Run the targeted test and confirm it fails:** npm test -- src/main/diagnostics/DiagnosticLog.test.ts
- [ ] **Step 3: Implement the shared schema and writer.** Use explicit event variants/fact schemas, newline-delimited JSON, atomic file rollover, bounded reads and a one-way console fallback. Initialize only after configureHarnessStartup in index.ts, using app.getPath('logs'). Keep debug disabled and avoid a new logging dependency.
- [ ] **Step 4: Run the targeted test and confirm it passes:** npm test -- src/main/diagnostics/DiagnosticLog.test.ts
- [ ] **Step 5: Commit only this task's files.**

~~~bash
git add src/shared/diagnostics.types.ts src/main/diagnostics/DiagnosticLog.ts src/main/diagnostics/DiagnosticLog.test.ts src/main/index.ts
git commit -m "feat: add bounded application diagnostic log"
~~~

### Task 2: One terminal failure boundary and public transport

**Files:**
- Create: src/main/diagnostics/DiagnosticFailure.ts
- Create: src/main/diagnostics/DiagnosticFailure.test.ts
- Modify: src/shared/publicMessages.ts
- Modify: src/shared/ipc.types.ts
- Modify: src/main/ipc/ipcResult.ts
- Modify: src/main/ipc/ipcResult.test.ts
- Modify: src/preload/invokeSafe.ts
- Modify: src/preload/invokeSafe.test.ts
- Modify: src/renderer/src/i18n/messages.ts
- Modify: src/renderer/src/i18n/messages.test.ts

**Interfaces:**
- Produces: AppFailure with namespaced DiagnosticCode, stage, operationId, cause and typed safe facts; PublicFailure with reason and optional diagnosticId.
- Produces: recordTerminalFailure(error, context, log) returning PublicFailure. The caller supplies a domain classifier; unknown errors map to operation-failed. It generates a new UUID only for reportable operational failures and writes exactly one error event.
- Extends IpcError with optional diagnosticId. Existing message remains fixed compatibility text and is never rendered.
- Extends toIpcResult with optional failure context without changing existing callers; batch paths call the same recordTerminalFailure directly.

- [ ] **Step 1: Write failing tests.** Test known domain failure, unknown error, cancellation, invalid-request, and repeated wrapping. Assert the known and unknown operational failures get IDs and one log event each; cancellation and ordinary validation do not. Assert preload copies only an allowed UUID diagnosticId, and renderer preserves it while rejecting arbitrary message/path fields.

~~~ts
const result = await recordTerminalFailure(new Error('/private/media.wav'), context, log)
expect(result).toMatchObject({ reason: 'operation-failed', diagnosticId: expect.any(String) })
expect(log.write).toHaveBeenCalledTimes(1)
expect(normalizePublicError({ reason: 'operation-failed', diagnosticId: result.diagnosticId, privatePath: '/private' })).toEqual(result)
~~~

- [ ] **Step 2: Run the focused tests and confirm failure:** npm test -- src/main/diagnostics/DiagnosticFailure.test.ts src/main/ipc/ipcResult.test.ts src/preload/invokeSafe.test.ts src/renderer/src/i18n/messages.test.ts
- [ ] **Step 3: Implement the terminal boundary and allowlisted transport.** Preserve cause chains in main; never serialize cause/message/stack into PublicFailure. Keep public reasons semantically stable and translate at render time. Replace direct console-only terminal diagnostics as each domain is migrated, without swallowing unexpected errors.
- [ ] **Step 4: Run the focused tests and confirm pass:** use the Step 2 command.
- [ ] **Step 5: Commit this task's files.**

~~~bash
git add src/main/diagnostics/DiagnosticFailure.ts src/main/diagnostics/DiagnosticFailure.test.ts src/shared/publicMessages.ts src/shared/ipc.types.ts src/main/ipc/ipcResult.ts src/main/ipc/ipcResult.test.ts src/preload/invokeSafe.ts src/preload/invokeSafe.test.ts src/renderer/src/i18n/messages.ts src/renderer/src/i18n/messages.test.ts
git commit -m "feat: correlate terminal failures with safe public IDs"
~~~

### Task 3: Typed speech worker failures

**Files:**
- Create: speech-worker/src/redencut_speech_worker/failures.py
- Modify: speech-worker/src/redencut_speech_worker/alignment_segments.py
- Modify: speech-worker/src/redencut_speech_worker/alignment.py
- Modify: speech-worker/src/redencut_speech_worker/__main__.py
- Modify: speech-worker/tests/test_alignment.py
- Modify: speech-worker/tests/test_alignment_recovery.py
- Modify: speech-worker/tests/test_protocol.py
- Modify: src/shared/speechWorker.types.ts
- Modify: src/shared/speechWorker.types.test.ts
- Modify: src/main/speech/SpeechWorkerClient.ts
- Modify: src/main/speech/SpeechWorkerClient.test.ts

**Interfaces:**
- Produces worker codes: alignment-segment-mismatch, alignment-timing-invalid, alignment-window-too-long, alignment-model-unavailable, alignment-inference-failed, invalid-request and worker-failed.
- Python AlignmentFailure carries code and safe numeric details only. Worker JSONL error adds optional details with a strict schema. TypeScript SpeechWorkerFailure retains code and details, with raw text as an in-process cause only.

- [ ] **Step 1: Write failing Python tests.** Exercise the split-word case (canonical hello versus hel + lo), overlapping/out-of-order timings, a 31-second segment and missing model snapshot. Assert exact codes and safe details, and assert error JSONL omits transcript text and audio paths.

~~~python
with self.assertRaises(AlignmentFailure) as caught:
    partition_units([{"id": "u", "text": "hello", "kind": "speech"}], ["hel", "lo"])
self.assertEqual("alignment-segment-mismatch", caught.exception.code)
~~~

- [ ] **Step 2: Write failing TypeScript tests.** Assert the client retains a valid error JSONL code even when the worker exits with code 2; a crash without error JSONL becomes process-exit; a malformed JSONL response remains protocol. Update the fixture to emit a typed code.
- [ ] **Step 3: Run Python and TypeScript tests to confirm failure.**

~~~bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=speech-worker/src python3 -B -m unittest discover -s speech-worker/tests
npm test -- src/shared/speechWorker.types.test.ts src/main/speech/SpeechWorkerClient.test.ts
~~~
- [ ] **Step 4: Implement typed errors at known source checks and preserve their code through worker/client protocol.** In the client, remember a valid terminal worker error and decide it before generic nonzero-exit handling; keep existing process cleanup and 32 MiB bounds. Unknown exceptions receive worker-failed and a safe exception class only.
- [ ] **Step 5: Run the Step 3 tests and confirm pass.**
- [ ] **Step 6: Commit this task's files.**

~~~bash
git add speech-worker/src/redencut_speech_worker/failures.py speech-worker/src/redencut_speech_worker/alignment_segments.py speech-worker/src/redencut_speech_worker/alignment.py speech-worker/src/redencut_speech_worker/__main__.py speech-worker/tests/test_alignment.py speech-worker/tests/test_alignment_recovery.py speech-worker/tests/test_protocol.py src/shared/speechWorker.types.ts src/shared/speechWorker.types.test.ts src/main/speech/SpeechWorkerClient.ts src/main/speech/SpeechWorkerClient.test.ts
git commit -m "feat: preserve typed speech worker failure causes"
~~~

### Task 4: Speech classification, progress and batch parity

**Files:**
- Create: src/main/speech/classifySpeechFailure.ts
- Create: src/main/speech/classifySpeechFailure.test.ts
- Modify: src/main/speech/SpeechAnalysisError.ts
- Modify: src/main/speech/SpeechAnalysisCoordinator.ts
- Modify: src/main/speech/SpeechAnalysisCoordinator.test.ts
- Modify: src/main/ipc/speechAnalysis.ipc.ts
- Modify: src/main/ipc/speechAnalysis.ipc.test.ts
- Modify: src/main/ipc/speechBatch.ipc.ts
- Modify: src/main/ipc/speechBatch.ipc.test.ts
- Modify: src/shared/speechBatch.types.ts

**Interfaces:**
- Consumes: recordTerminalFailure and typed SpeechWorkerFailure.
- Produces: classifySpeechFailure(error, stage) mapping worker codes to public reasons and diagnostic codes; one operation ID per speech job and per batch source/phase.
- Public reasons include speech-alignment-input, speech-alignment-window, speech-alignment-model, speech-worker-exit, speech-aligning and speech-validating. A successful partial alignment remains a warning.

- [ ] **Step 1: Write failing classifier tests.** Assert model-unavailable maps to settings guidance; segment mismatch and invalid timing map to speech-alignment-input; window-too-long maps to speech-alignment-window; nonzero worker crash maps to speech-worker-exit; unknown inference maps to speech-aligning.
- [ ] **Step 2: Write failing integration tests.** Single and two-source batch failures each record once and retain per-source IDs. Explicit cancellation records no error. Parsing malformed worker result emits validating before schema parse and maps to speech-validating. A partial alignment result remains successful and reports review state.

~~~ts
expect(summary.failures.map((item) => item.error.diagnosticId)).toEqual([
  expect.any(String),
  expect.any(String),
])
expect(summary.failures[0].error.diagnosticId).not.toBe(summary.failures[1].error.diagnosticId)
expect(log.write.mock.calls.filter(([event]) => event.level === 'error')).toHaveLength(2)
~~~

- [ ] **Step 3: Run the focused speech tests and confirm failure:** npm test -- src/main/speech/classifySpeechFailure.test.ts src/main/speech/SpeechAnalysisCoordinator.test.ts src/main/ipc/speechAnalysis.ipc.test.ts src/main/ipc/speechBatch.ipc.test.ts
- [ ] **Step 4: Implement classification and boundary reuse.** Replace stage-only guessing with code-first classification, retain stage for unknown errors, and emit validating before result parse. Log bounded started/completed milestones for audio preparation, transcription and alignment. Batch failure collector uses recordTerminalFailure rather than its independent map.
- [ ] **Step 5: Run the Step 3 tests and confirm pass.**
- [ ] **Step 6: Commit this task's files.**

~~~bash
git add src/main/speech/classifySpeechFailure.ts src/main/speech/classifySpeechFailure.test.ts src/main/speech/SpeechAnalysisError.ts src/main/speech/SpeechAnalysisCoordinator.ts src/main/speech/SpeechAnalysisCoordinator.test.ts src/main/ipc/speechAnalysis.ipc.ts src/main/ipc/speechAnalysis.ipc.test.ts src/main/ipc/speechBatch.ipc.ts src/main/ipc/speechBatch.ipc.test.ts src/shared/speechBatch.types.ts
git commit -m "feat: classify speech failures consistently across jobs"
~~~

### Task 5: Preview and export an exact private report

**Files:**
- Create: src/main/diagnostics/DiagnosticReport.ts
- Create: src/main/diagnostics/DiagnosticReport.test.ts
- Create: src/main/ipc/diagnostics.ipc.ts
- Create: src/main/ipc/diagnostics.ipc.test.ts
- Modify: src/shared/diagnostics.types.ts
- Modify: src/shared/ipc.types.ts
- Modify: src/preload/index.ts
- Modify: src/main/index.ts

**Interfaces:**
- Produces: previewReport({ diagnosticIds }) returning previewId, JSON content, event count, partial flag and environment summary.
- Produces: saveReport({ previewId }) returning saved or cancelled; main owns snapshot bytes and native dialog path. Produces showSavedReport({ previewId }) and recentFailure() for Help.
- Report format version 1 includes only matching operation milestones, selected failure events, bounded app/runtime details and an explicit partial flag. Limit preview to 2 MiB and 1,000 events; trimming sets partial.

- [ ] **Step 1: Write failing service tests.** Seed info/warn/error events for two jobs plus unrelated events. Assert selected report contains only matching jobs, strips nested path/transcript/token values, and preview content is stable after log rotation. Missing retained events and truncation set partial. A recent-failure index returns the newest retained diagnostic ID.

~~~ts
const preview = await reports.previewReport({ diagnosticIds: ['id-a', 'id-b'] })
await rotateLogFiles()
await reports.saveReport({ previewId: preview.previewId })
expect(await readFile(chosenSavePath, 'utf8')).toBe(preview.content)
expect(preview.content).not.toContain('/private/')
~~~

- [ ] **Step 2: Write failing IPC tests.** Mock native dialog and shell. Assert save cancellation returns cancelled, denied destination yields a safe report-save failure without deleting the snapshot, Show in Finder uses only a main-owned path, and renderer never supplies a path or report body.
- [ ] **Step 3: Run focused tests and confirm failure:** npm test -- src/main/diagnostics/DiagnosticReport.test.ts src/main/ipc/diagnostics.ipc.test.ts
- [ ] **Step 4: Implement immutable preview snapshots with a ten-minute TTL, bounded event selection, a schema-validated JSON report, native save and shell reveal.** Store report bytes in main between preview and save. Flush log before preview. Export failure logs through the nonrecursive fallback; it never changes the original diagnostic ID.
- [ ] **Step 5: Run the Step 3 tests and confirm pass.**
- [ ] **Step 6: Commit this task's files.**

~~~bash
git add src/main/diagnostics/DiagnosticReport.ts src/main/diagnostics/DiagnosticReport.test.ts src/main/ipc/diagnostics.ipc.ts src/main/ipc/diagnostics.ipc.test.ts src/shared/diagnostics.types.ts src/shared/ipc.types.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: export reviewed diagnostic report snapshots"
~~~

### Task 6: Localized failure presentation and Help access

**Files:**
- Create: src/renderer/src/components/diagnostics/DiagnosticReportDialog.tsx
- Create: src/renderer/src/components/diagnostics/DiagnosticReportDialog.test.tsx
- Modify: src/renderer/src/App.tsx
- Modify: src/renderer/src/App.test.tsx
- Modify: src/renderer/src/components/Transcript/SpeechBatchProgress.tsx
- Modify: src/renderer/src/components/Transcript/SpeechBatchProgress.test.tsx
- Modify: src/renderer/src/i18n/messages.ts
- Modify: src/renderer/src/i18n/messages.test.ts
- Modify: src/shared/i18n/locales/zh-CN.ts
- Modify: src/shared/i18n/locales/en.ts
- Modify: src/main/ProjectMenu.ts
- Create: src/main/ProjectMenu.test.ts
- Modify: src/preload/index.ts
- Modify: src/shared/ipc.types.ts

**Interfaces:**
- Consumes: PublicFailure and diagnostics preview/save/show/recent APIs.
- Produces: one reusable failure-action presentation for single and batch results, retaining diagnosticId across locale switches. Native Help menu sends a typed open-recent-report event through preload to App.

- [ ] **Step 1: Write failing UI tests.** Assert segment mismatch shows the approved explanatory Chinese copy; model failure offers Settings; long-window failure leads with Export Report, not Retry; batch sources show independent IDs; switching locale changes text without changing ID; dismissed errors remain accessible via Help recent report.
- [ ] **Step 2: Write failing dialog tests.** Assert preview presents the exact sanitized JSON and excluded-content notice, Save opens the native path flow, cancel is quiet, save failure offers another destination, and success offers Show in Finder and Copy ID.
- [ ] **Step 3: Run the focused UI tests and confirm failure:** npm test -- src/renderer/src/components/diagnostics/DiagnosticReportDialog.test.tsx src/renderer/src/components/Transcript/SpeechBatchProgress.test.tsx src/renderer/src/i18n/messages.test.ts src/renderer/src/App.test.tsx src/main/ProjectMenu.test.ts
- [ ] **Step 4: Implement localized presentation and typed Help event.** Reuse current SettingsDialog opening state; keep batch failures on their source rows. Approved segment message: “初步文字识别已完成，但识别出的文字和时间片段无法对应，暂时不能把文字准确定位到音频。请重新识别；若再次出现，请导出诊断报告。” Add equivalent English copy and avoid developer setup commands in installed-app messages.
- [ ] **Step 5: Run the Step 3 tests and confirm pass.**
- [ ] **Step 6: Commit this task's files.**

~~~bash
git add src/renderer/src/components/diagnostics/DiagnosticReportDialog.tsx src/renderer/src/components/diagnostics/DiagnosticReportDialog.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/components/Transcript/SpeechBatchProgress.tsx src/renderer/src/components/Transcript/SpeechBatchProgress.test.tsx src/renderer/src/i18n/messages.ts src/renderer/src/i18n/messages.test.ts src/shared/i18n/locales/zh-CN.ts src/shared/i18n/locales/en.ts src/main/ProjectMenu.ts src/main/ProjectMenu.test.ts src/preload/index.ts src/shared/ipc.types.ts
git commit -m "feat: explain failures and expose reviewed reports in app"
~~~

### Task 7: Standards, full verification and installed-app acceptance

**Files:**
- Modify: docs/architecture-standards.md
- Modify: docs/speech-models-and-dependencies.md
- Create: e2e/scenarios/diagnostic-report-workflow.md
- Modify: e2e/scenarios/README.md

**Interfaces:**
- Consumes the completed product behavior from Tasks 1-6.
- Produces updated authoritative architecture/dependency guidance and an evidence-backed UI acceptance report.

- [ ] **Step 1: Update standards.** Replace the statement that underlying diagnostics stay only in the main-process log with the actual bounded log/report contract, and document ownership, retention, privacy and IPC boundaries. Keep historical spec and plan under docs/superpowers.
- [ ] **Step 2: Run Python worker suite:** PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=speech-worker/src python3 -B -m unittest discover -s speech-worker/tests
- [ ] **Step 3: Run required formatter and full gate:** run npm run format, then npm run check. Inspect failures and rerun only after fixing concrete causes.
- [ ] **Step 4: Author the diagnostic-report workflow scenario following e2e/scenarios/README.md, then use .agents/skills/agent-testing/SKILL.md.** Run the editing and UI-consistency baseline plus changed behavior: one alignment error, two-source batch with one success and one failure, locale switch, report preview/save/cancel, and Help recent-report access. Inspect screenshots and exported JSON; record any environment block honestly.
- [ ] **Step 5: Review the complete diff against the spec.** Verify no unknown fields or raw exception text cross IPC, no existing user state is modified by logging/export, and untracked Python caches are excluded.
- [ ] **Step 6: Commit documentation and the acceptance scenario.**

~~~bash
git add docs/architecture-standards.md docs/speech-models-and-dependencies.md e2e/scenarios/diagnostic-report-workflow.md e2e/scenarios/README.md
git commit -m "docs: document diagnostic ownership and report workflow"
~~~

## Execution order and stopping points

Tasks 1-2 establish application-level contracts and storage. Tasks 3-4 attach speech-specific causes without leaking worker text. Task 5 makes reports usable independently of the current UI. Task 6 adds user flows. Task 7 is the required whole-change gate. Review each task's diff and test evidence before proceeding; if a task exposes a contract mismatch, revise the plan before implementing the next dependent task.
