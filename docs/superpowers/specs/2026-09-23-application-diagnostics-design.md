# Application Diagnostics and Error Reporting Design

Date: 2026-09-23
Status: Architecture and behavior approved in conversation; implementation has not started.

## Goal and boundaries

Give installed RedenCut users a concise explanation of an operation failure and a useful next action, while retaining enough local diagnostic context for a user-initiated report and developer investigation.
Provide an application-level diagnostic foundation, with speech analysis as the first fully integrated domain.
Main owns logging, classification at process boundaries, filesystem access and report export; preload carries narrow serializable contracts; renderer owns localized presentation.
No automatic upload, audio capture, transcript capture, project-file attachment, or blanket collection of operating-system logs is included.
Normal operation continues if logging fails.

## Product behavior

- A user-facing failure says which operation did not complete, the broad cause only when confirmed, and a next action.
- Expected cancellation and ordinary validation feedback do not appear as reportable system failures.
- A completed speech task with uncertain timing is a review warning, not a failed task.
- Each reportable failure has a diagnostic ID shown beside an Export Diagnostic Report action.
- Single-task and batch-task failures use the same classification and diagnostic record. Each batch failure has its own ID; the batch summary can export all failures from that run.
- The user may export a recent report after dismissing the failure through a Help entry.
- Export opens a preview of the exact sanitized data and then a native save dialog. The app never sends the file.
- Cancelling the save dialog is an ordinary cancellation. A failed save preserves the original diagnostic ID and offers another destination.

## Error propagation

1. The component that knows the cause emits a stable namespaced diagnostic code and a bounded set of safe facts. It retains the original exception as an in-process cause; it does not turn an exception message into a public string.
2. Wrappers add stage and operation context while preserving the original code and cause. Intermediate catches do not record the same failure repeatedly.
3. A terminal operation boundary classifies and records one failure event, assigns a diagnostic ID, and maps it to a public reason. Batch failure collection calls the same service as ordinary IPC failures.
4. IPC sends only the public reason, diagnostic ID, and fixed safe transport status. Preload copies allowlisted scalar fields; renderer retains the reason rather than translated text, so language changes retranslate it.
5. Renderer selects the relevant presentation surface and actions. A failure in a speech batch appears on its source row, a save failure in the save flow, and a playback failure near playback. There is no universal modal for all failures.

Existing `IpcResult<T>` remains the transport envelope. The existing `IpcError.message` may remain as a fixed compatibility field during migration, but presentation never uses raw messages. The existing `failureKind` is migrated to domain-specific reasons where useful; it is not an open-ended way to expose process details.

### Type boundaries

`DiagnosticCode` is a namespaced domain code such as `speech/alignment-window-too-long`, `project/save-permission-denied`, or `audio/decode-failed`. The generic logging service never interprets a domain code. Domain classifiers own the many-to-one mapping from diagnostic codes to public reasons.

An internal `AppFailure` contains `code`, `stage`, `operationId`, optional `cause`, and typed safe facts. It is main-process data and never crosses IPC. `PublicFailure` contains `reason` and optional `diagnosticId`, with no arbitrary text or arbitrary parameter dictionary. `AppLogEvent` contains schema version, timestamp, level, event code, operation ID, optional diagnostic ID, and allowlisted facts. The report schema is versioned independently of the log schema.

An `operationId` correlates milestones for one action. Existing speech `jobId` is retained as the speech operation ID; a batch child also has a distinct source-and-phase operation identity. A `diagnosticId` names one reportable failure. Neither ID encodes user data or a filesystem path.

### Worker boundary

The speech worker emits typed, stable errors in its existing versioned JSONL response. Known validation errors distinguish segment-text mismatch, timing invalidity, search-window overflow, and model unavailability. Inference failure and process exit have separate codes. The TypeScript worker client preserves the code in a typed error; stdout/stderr text stays in diagnostics and never enters a public response. Unknown worker exceptions retain a generic code and exception type. Classification never parses third-party English messages.

## Logs and reporting

The main process initializes an application-owned JSONL log under Electron's `app.getPath('logs')` after harness path isolation. The writer records low-volume `info` milestones, `warn` recoveries or degradations, and `error` failures; high-frequency frames, waveform samples, and audio buffers are excluded. `debug` is disabled by default and may be enabled temporarily in a later iteration. A starting bound is 4 MiB per file, five files, and fourteen days, whichever removes data sooner. Logging failures fall back to console diagnostics without breaking the user operation or recursively logging themselves.

Facts are defined per event, not accepted as arbitrary objects. Routine and exported logs omit audio, transcript text, project contents, authentication material, and raw absolute paths. Captured exceptions are normalized to error class, stable code, and safe module location; messages and stacks are not blindly serialized. An explicit schema prevents later domains from adding private fields by accident.

Export selects the requested diagnostic ID's operation milestones, failure event, and a bounded app/runtime environment summary. Batch export selects the failures from that batch. It flushes pending events first, then constructs a single readable, versioned JSON report. The preview displays the exact report data and states the excluded content. It remains usable when some rotated history is unavailable, but labels the report partial. A recent-report Help entry uses retained report metadata; it does not imply that old rotated events still exist. Export never includes entire historical logs by default.

Startup failures before the writer is ready retain console fallback. A process crash can prevent a final event from being written; crash reporting is a separate future capability and must not be presented as covered by this design.

## User-facing message rules

Each message answers: what did not finish, roughly why if confirmed, and what the user can do now. Use familiar words and no engine names, Python exception text, internal stage names, or development setup commands in installed-app copy. Do not promise preservation of existing work unless guaranteed. Do not lead with Retry for a deterministic condition that will recur with unchanged input. Display a quiet second line with the diagnostic ID and Export Diagnostic Report action when a reportable event exists.

| Confirmed condition | Chinese message direction | Primary action |
| --- | --- | --- |
| Required model unavailable or load rejected | 声音对齐模型无法使用。请到设置中验证模型，然后重试。 | Open Settings |
| Recognition text and time segments cannot be reconciled | 初步文字识别已完成，但识别出的文字和时间片段无法对应，暂时不能把文字准确定位到音频。请重新识别；若再次出现，请导出诊断报告。 | Rerun recognition |
| Recognition segment exceeds the bounded alignment window | 录音中有一段识别结果过长，当前无法完成对齐。请导出诊断报告。 | Export report |
| Speech worker exits unexpectedly | 语音处理意外中断。请重试；若再次发生，请导出诊断报告。 | Retry |
| Unknown alignment failure | 语音对齐未完成。请导出诊断报告，帮助我们定位原因。 | Export report |
| Speech result fails schema validation | 语音分析结果无效。请导出诊断报告。 | Export report |
| Some text lacks reliable timing but task succeeds | 部分文字的时间位置无法确认，请检查这些位置。 | Review affected text |
| Report save fails | 诊断报告未能保存。请选择其他位置重试。 | Choose another location |

The segment-reconciliation message describes the transition from preliminary recognition to acoustic placement. It does not claim the audio is corrupt or that the user caused the problem; this condition can also arise from a mismatch between recognition segments and canonical transcript units. Keep an equivalent English translation. Unsupported languages and preflight resource absence retain their existing dedicated reasons rather than being recast as alignment failures. Use a broad message only when the exact cause is unknown.

## User flow

1. A failed operation remains visible at its owning surface. Show its concise message, a relevant primary action, and a diagnostic ID with Export Diagnostic Report.
2. For a batch, each source row retains its own reason and ID; a batch-wide export gathers the failures for that run. Successful sources remain successful.
3. Export preview shows app version, OS and architecture, stages, error categories, event time range and count, and the exact sanitized JSON content. It states that audio, transcript text, project files and tokens are excluded.
4. Save Report opens a native save dialog with a diagnostic-ID filename. Cancel closes cleanly. Success offers Show in Finder and Copy Diagnostic ID; the user sends the file through an existing support channel.
5. Help offers export of the most recent retained failure after a transient message has been dismissed. If the relevant history rotated away, the preview says the report is partial.

## File responsibilities

| Area | Files and responsibility |
| --- | --- |
| Shared | Add `src/shared/diagnostics.types.ts` for versioned safe events and report contracts; extend `publicMessages.ts`, `ipc.types.ts`, and `speechWorker.types.ts` with allowlisted reasons, IDs and worker codes. |
| Main diagnostics | Add `src/main/diagnostics/DiagnosticLog.ts` for bounded writing and rotation, `DiagnosticReport.ts` for sanitization and export, `DiagnosticFailure.ts` for terminal recording and public mapping, and `src/main/ipc/diagnostics.ipc.ts` for preview/save. |
| Main domains | Keep domain classification beside the domain, beginning with speech; adapt `SpeechAnalysisError.ts`, `SpeechWorkerClient.ts`, `speechAnalysis.ipc.ts`, `speechBatch.ipc.ts`, and `ipcResult.ts`. Other domains migrate incrementally without changing the generic logger. |
| Python worker | Add typed alignment validation failures around `alignment_segments.py` and model loading, then expose stable worker codes through `__main__.py`. |
| Preload | Extend `src/preload/index.ts` and `invokeSafe.ts` to carry only allowlisted report fields and diagnostics API. |
| Renderer | Extend `i18n/messages.ts`, English and Chinese resources, `App.tsx`, and `SpeechBatchProgress.tsx`; add a focused report preview component and a Help entry. |
| Standards | Update `docs/architecture-standards.md` and `docs/speech-models-and-dependencies.md` when implementation changes their current diagnostic-sink description. |

The main logger uses Node/Electron primitives and needs no new file-logging dependency. Report export is a JSON file to keep preview and review straightforward.

## Verification criteria

- Known worker failures retain their code across Python, TypeScript, IPC, preload and renderer; raw worker text never crosses to presentation.
- Single and batch paths record each reportable failure once and expose the correct diagnostic ID.
- Cancellation and partial alignment success do not appear as reportable task failures.
- Error messages and actions reflect only confirmed facts in both languages; changing language retranslates retained failures.
- Tests exercise segment mismatch, timing invalidity, long segment, model failure, process exit, malformed result and unknown error.
- Export contains the expected operation context, respects size and retention bounds, and excludes sensitive text, paths and credentials, including when nested in exception causes.
- Logger failure, report-preview failure, save cancellation, and report-save failure leave the original operation state intact.
- Installed-app UI acceptance covers a single failure, multiple batch failures, report preview and save, and recent-report access after dismissal.
