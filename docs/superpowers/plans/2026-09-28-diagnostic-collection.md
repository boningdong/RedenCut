# Diagnostic Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox syntax for tracking.

**Goal:** Persist useful main/helper messages alongside important events and let users collect, inspect, and save one diagnostic ZIP through Help or Settings.

**Architecture:** AppLogger accepts scoped, sanitized messages into an independently bounded asynchronous writer. Helper adapters collect diagnostic text without intercepting protocol/media outputs. DiagnosticReport snapshots retained event/message logs; DiagnosticBundle saves that immutable payload, and one renderer panel serves both entry points.

**Tech Stack:** Electron, TypeScript, Zod, Node asynchronous file/stream APIs, Python standard logging/warnings, React, Vitest, unittest, and yazl for streaming ZIP creation.

**Spec:** [Approved design](../specs/2026-09-28-diagnostic-collection-design.md).

## Global Constraints

- Work in `/Users/boning/Workspaces/Podcut/.worktrees/diagnostic-collection` on `diagnostic-collection`; do not change the primary checkout or unrelated maintenance worktree.
- Explicit AppLogger usage in main business code; do not globally override console methods.
- Default info/warn/error collection; no renderer console capture, automatic upload, debug settings, audio/transcript capture, arbitrary project/environment dumps, or crash dumps.
- Initial writer defaults: 16 KiB serialized record, 512 KiB total queue including 128 KiB warn/error reserve, flush at 500 ms or 64 KiB, five approximately 4 MiB files, fourteen-day retention, two-second shutdown flush timeout.
- Independent event/message retention budgets; stable identifiers are named constants; persisted contracts use strict Zod schemas with inferred types.
- Helper stdout retains its existing task/media meaning; always drain output independently of the file queue.
- Main owns file paths and snapshots; renderer/preload use owner-validated opaque IDs and manifests.
- At most two ten-minute snapshots; failures and cancellations are recoverable; saved bundles are not application-cleaned temporary files.
- README uses natural titles and action/symptom duplicate search; no required feature vocabulary or diagnostic ID search.
- User-facing English/Chinese text follows existing translation contracts; update architecture standards, not instruction files.
- No product implementation before review of this plan; the requested execution is interpreted as current-session native execution unless the user chooses another method.

## Review Focus

- A helper emits an endless line or fragmented multibyte characters: memory stays bounded and subsequent valid messages survive (Task 2).
- A full priority queue and broken disk coincide: tasks continue, accounting never falsely claims complete zero loss, and logging failures do not recurse (Task 1).
- The app starts with no recorded failure: both collection entry points work and an empty valid bundle can be saved (Tasks 3–4).
- A window closes or preview expires during saving: ownership stays enforced, in-flight snapshot files are leased until completion, and cleanup never removes a user file (Task 3).
- Sources rotate while collection starts: exported payload is fixed, UTF-8/JSONL records are valid, and no log is silently omitted (Tasks 1 and 3).

## File responsibility map

| Area | Create | Modify |
| --- | --- | --- |
| Contracts | `src/shared/AppLogMessageTypes.ts`, `DiagnosticBundleTypes.ts` | `diagnostics.types.ts`, `ipc.types.ts` |
| Message logging | `src/main/logging/AppLogger.ts`, `LogSanitizer.ts`, `RotatingLogWriter.ts`, their tests | Main business console call sites, `index.ts` |
| Helper capture | `src/main/processes/HelperLogCollector.ts`, its tests; Python `logging_setup.py`, `test_logging.py` | `ManagedProcess.ts`, speech/audio helper launchers, runtime/resource probes, worker `__main__.py` |
| Export | `src/main/diagnostics/DiagnosticBundle.ts`, tests | `DiagnosticLog.ts`, `DiagnosticReport.ts`, diagnostic IPC, preload |
| UI | `DiagnosticCollectionPanel.tsx`, `settings/DiagnosticsSettings.tsx`, tests | DiagnosticReportDialog, SettingsDialog, App, ProjectMenu, both locales |
| Reporting | `.github/ISSUE_TEMPLATE/bug_report.yml` | README, architecture standards |
| Acceptance | Evidence report under owned harness run | Existing diagnostic scenario only after explicit scenario-edit confirmation |

## Task 1: Scoped application logging and bounded storage

**Interfaces:**
- `AppLogger.withContext(context: AppLogContext): AppLogger`; `info/warn/error(message: string, error?: unknown): void`.
- Application-owned `appLogger` starts with a bounded pre-initialization queue; `initialize(directory: string): Promise<void>` and `dispose(): Promise<void>` own the writer lifecycle.
- `AppLogContext` contains source, optional component, raw operation identity, helper instance, and stream; AppLogger hashes raw operation identity exactly once using event-log correlation rules.
- `RotatingLogWriter.enqueue(record: AppLogMessage): void`, `flush(): Promise<void>`, `snapshot(destination: string): Promise<LogSnapshotSummary>`, `dispose(): Promise<void>`.
- `LogSnapshotSummary` reports relative file inventory, coverage, and losses; its typed definition lives beside the writer and is consumed by Task 3.

- [ ] Write `AppLogger.test.ts` asserting scoped simultaneous operation IDs match their event hashes, exceptions/cause chains are bounded, and calling error does not invoke object getters or throw into business code.
- [ ] Write `LogSanitizer.test.ts` asserting configured credential values, authorization patterns, and home/private paths are absent from persisted output while useful error classes/package-relative stack text remain.
- [ ] Write `RotatingLogWriter.test.ts` with real temporary directories and controllable slow/failing append: ordering, no per-message directory scan, 512 KiB queue cap, priority reserve, high-severity saturation, recovered durable loss markers, rotation, fourteen-day expiration, and snapshot exclusion of later records.
- [ ] Run `npx vitest run src/main/logging` and confirm missing production functionality causes failures.
- [ ] Implement strict `AppLogMessage` plus typed loss markers in `AppLogMessageTypes.ts`; bound the complete serialized record to 16 KiB, including JSON escaping and stack.
- [ ] Implement sanitizer without arbitrary object inspection; preserve original output only in the existing console fallback, never duplicate it to unredacted files.
- [ ] Implement writer with one serial async drain, finite batches/retries, bounded loss accounting, and snapshot barrier sharing the file-rotation lock; accepted enqueue calls do not await that barrier.
- [ ] Implement AppLogger and its startup buffer, configure logger-owned fallback, migrate main console call sites to scoped explicit logger calls, and integrate initialization/shutdown after harness isolation.
- [ ] Run new tests and affected main IPC/lifecycle tests; verify no unexpected main business console sites remain.
- [ ] Review diff and commit the independently testable logging change.

## Task 2: Helper messages, warnings, and exception stacks

**Interfaces:**
- `new HelperLogCollector(logger: AppLogger, format: 'python' | 'text')`; `write(chunk: Buffer | string): void`; `finish(): void`.
- ManagedProcess options gain optional helper log context; collectors receive stderr alongside existing handlers and finish once on settlement, without logging stdout automatically.
- Python `configure_logging()` installs stderr JSON formatting and standard warning capture; stderr schema validates `PythonLogMessage` defined in the application-log contract.

- [ ] Write collector tests asserting segmented UTF-8 and lines reassemble, huge lines truncate without retaining unlimited bytes, later valid lines survive, malformed envelopes fall back safely, and carriage-return progress retains useful diagnostic lines.
- [ ] Extend real child-process tests: a noisy helper completes with a saturated logger; stdout protocol/audio bytes do not appear in message files; distinct concurrent helpers retain their own context; final stderr is captured on exit/cancellation.
- [ ] Write Python unittest assertions: info/warnings/error traceback go to stderr, debug is absent, and stdout remains exclusively valid worker protocol output.
- [ ] Run `npx vitest run src/main/processes src/main/speech/SpeechWorkerClient.test.ts` and `PYTHONPATH=speech-worker/src python3 -m unittest discover -s speech-worker/tests -p test_logging.py`; confirm new behavior fails before implementation.
- [ ] Implement Collector and ManagedProcess integration; structured Python levels are honored, unknown text defaults to info plus stream metadata, and helper start/exit summaries omit full command arguments.
- [ ] Implement Python logging initialization, warning capture, and caught worker exception logging before the existing safe protocol error response.
- [ ] Integrate SpeechWorkerClient and Whisper operation-scoped capture; forward correlation from speech orchestration without global mutable operation state.
- [ ] Integrate prepareSpeechAudio, import FFmpeg/FFprobe, prepared effects, export, DevelopmentEnvironmentChecker, and validateModelLoad; audit every runtime spawn/execFile for explicit collection policy.
- [ ] Adjust tool verbosity to retain warnings and useful diagnostics without enabling verbose frame/sample output; preserve UI progress parsing and existing process cleanup.
- [ ] Run helper, speech, audio, runtime, resource, and Python protocol tests; commit the capture change.

## Task 3: Immutable diagnostics snapshot and streaming ZIP

**Interfaces:**
- `DiagnosticReport.previewReport(request: DiagnosticCollectionRequest, ownerId: number): Promise<DiagnosticReportPreview>`.
- `saveReport(previewId: string, destination: string, ownerId: number): Promise<void>`, `savedPath`, `snapshotPath`, `releaseReport`, `releaseOwner`, and `dispose` validate preview ownership and lifetime.
- DiagnosticCollectionRequest is `{ kind: 'recent' } | { kind: 'failure'; diagnosticIds: string[] }`.
- DiagnosticBundle writes a snapshot root and manifest to destination using yazl streams, temp output beside destination, and atomic rename on success; failed saves preserve existing destinations.

- [ ] Replace operation-only report tests with recent/no-ID history, failure correlation plus unrelated message inclusion, rotation/append during collection, missing selected IDs, corrupt records, and byte-identical snapshot payload after later writes.
- [ ] Write ZIP tests that extract with an independent reader and assert manifest/environment, valid event/message schemas, filenames, privacy filtering, file byte counts, and cutoff exclusion; test destination failure preserves an existing file.
- [ ] Write owner/lifetime tests for concurrent preparations (two slots reserved before async work), ten-minute expiry, owner destruction, cancellation/retry, cleanup with active save/inspection leases, and incomplete loss metadata.
- [ ] Run report/bundle tests and confirm new expectations fail against JSON-only export.
- [ ] Add yazl as an explicit production dependency and its TypeScript declarations as development dependency, pin lockfile, verify MIT license and async streaming API; use an explicit independent ZIP reader for tests rather than undeclared transitive packages.
- [ ] Define strict bundle manifest/request schemas; retain existing persisted AppLogEvent compatibility and remove obsolete JSON report APIs after callers migrate.
- [ ] Extend DiagnosticLog with a streaming sanitized snapshot serialized against its write/rotation queue; do not hold all retained events in renderer or an unbounded array.
- [ ] Implement DiagnosticReport two-slot reservation, owner leases, finite lifetime, coordinated source cutoff/flush, cleanup, per-file coverage and loss warnings, and manifest-relative inventory.
- [ ] Implement DiagnosticBundle streaming compression and atomic save with secure temporary-file permissions and error propagation.
- [ ] Update Diagnostics IPC/preload/shared API for prepare, inspect, save, reveal, and release; IPC validates sender ownership and fixed request schema, uses localized ZIP dialogs, and maps failures to safe public reasons.
- [ ] Run report/bundle/IPC/preload tests; commit backend export.

## Task 4: Shared Diagnostics UI through Help, Settings, and failure actions

**Interfaces:**
- `DiagnosticCollectionPanel({ request }: { request: DiagnosticCollectionRequest })` owns prepare/retry, manifest summary, inspect/save, cancellation, success/reveal, and preview release.
- DiagnosticReportDialog hosts this panel; DiagnosticsSettings presents the collect action and the same panel inline.
- Existing failure callers supply a failure request; native Help always supplies recent without first querying recentFailure.

- [ ] Write renderer tests for no-ID preparation, files/size/warnings, preparation retry, native save cancellation, save retry, reveal, inspect, cleanup during delayed preparation, expiration, and language changes without recollection.
- [ ] Extend Settings and ProjectMenu tests for Diagnostics navigation and Collect diagnostics action; update App tests to prove Help no longer silently ignores users with no failure.
- [ ] Run relevant renderer/menu tests and confirm new flows fail before implementation.
- [ ] Implement shared panel with existing dialog/button/layout primitives, finite busy states, semantic labels, keyboard access, and sanitized public error messages.
- [ ] Add Settings Diagnostics tab and inline collect panel; integrate Help modal and existing single/batch failure buttons without nesting Settings modals.
- [ ] Add English/Chinese copy that accurately describes retained scope and free-text privacy limits; preserve jobs/playback/project state when opening collection.
- [ ] Run UI/menu/App tests; commit UI change.

## Task 5: Reporting guidance, verification, and review

- [ ] Add README reporting steps: search open and closed issues by action/symptom/error code, collect via either entry, inspect/save ZIP, open GitHub Bug report, attach and wait for upload, submit; logs and screenshots are optional.
- [ ] Add simple GitHub YAML form with how encountered, actual/expected behavior, app/OS versions, and optional attachment field; no feature taxonomy/title prefix.
- [ ] Update current architecture standards to reflect message capture, pre-persistence sanitization limitations, asynchronous bounds, full retained snapshot, and ZIP export.
- [ ] Propose extending existing diagnostic-report workflow for no-ID Help/Settings collection, inspect/save/cancel/retry; wait for scenario-edit confirmation but continue targeted acceptance independently.
- [ ] Run `npm run format`, inspect formatting separately from semantics, then `npm run check`; run the full Python unittest suite and identify any unavailable inference dependencies separately.
- [ ] Stress a real noisy helper with slow writes; assert bounded queue and successful completion, report memory/elapsed overhead with logging enabled/disabled and sustained write-loss accounting.
- [ ] Build the Docker base image explicitly after dependency manifests change, recreate a task-owned container from this checkout, and run Docker MCP editing baseline, applicable UI consistency checks, and diagnostic changed-behavior checks.
- [ ] Inspect screenshots plus semantic states and saved extracted bundle contents; record actual observations and blocked checks in the owned run's evidence report; stop owned run.
- [ ] Perform fresh whole-branch code review, concentrating on memory limits, renderer ownership, source/snapshot races, privacy, saved-file preservation, and helper protocol integrity; rerun checks only for changes or unresolved failures.
- [ ] Commit reviewed changes and hand off outcome, verification evidence, and remaining limits without merging or publishing unless requested.

## Plan review

Every approved spec section maps to a task: contracts/privacy/storage to Task 1, helper protocols to Task 2, snapshot/save/ownership to Task 3, product entry points to Task 4, and README/forms/acceptance to Task 5.
The review-focus conditions are pinned to explicit tests above.
The exact helper-capture inventory and main console migration must be checked against the current source rather than assumed from an older snapshot.
Written plan review is the remaining prerequisite before production edits.
