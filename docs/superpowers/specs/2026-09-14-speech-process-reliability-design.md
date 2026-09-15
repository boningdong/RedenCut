# Speech process reliability

Status: approved and implemented; short full-pipeline calibration passed, full-length run stopped at the user’s request after demonstrating sustained progress beyond the former worker timeout. Final verification is recorded in the task report.
Scope: roadmap item 1 only, before source queues, checkpoints and project people.

## Goal and boundaries

Make speech subprocess execution reliable for complete podcast recordings, without terminating healthy inference merely because a fixed wall clock or progress interval expired.
Keep existing source-based analysis, ITranscriber, SpeechAnalysisCoordinator and worker protocol boundaries.
Do not implement multi-source scheduling, stage persistence, speaker identity editing, streaming audio decoding or transcript virtualization in this change.
Follow the existing [architecture](../../architecture-standards.md), [coding](../../coding-standards.md) and [file organization](../../file-organization-standards.md) standards.

## Accepted behavior

Use common subprocess lifecycle management with stage-specific policies.
When processing exceeds an estimated duration, continue running and show an overrun message plus cancellation.
Estimate duration using audio length and measured stage performance; estimates are advisory, never inference kill deadlines.
Only emit percentages derived from measured completed work.
Process liveness, computation progress and estimated completion are separate signals.
A quiet long-running computation is not sufficient evidence of a hang.

## Components

### ManagedProcess

Create src/main/processes/ManagedProcess.ts with colocated lifecycle tests and controlled child fixtures.
It owns spawn error handling, consumption of both output streams, bounded diagnostic tails, cancellation, termination escalation, listener and timer cleanup, and single settlement.
Callers choose whether stdout is discarded or streamed into their parser; output is never left in an unread pipe.
Do not accumulate full output internally.
Drain stderr continuously and retain at most 16 KiB for diagnostics.
An abort requested before spawn must not create a child.
After spawn, cancellation or explicit caller failure sends SIGTERM, then SIGKILL after a two-second grace period if still running.
Settlement must handle competing close, error, abort and timer events exactly once; forced termination must not wait indefinitely on inherited output pipes.
The manager reports exit code/signal and bounded diagnostics without interpreting Whisper progress or worker JSONL.
Parser failures trigger managed cleanup rather than leaving inference running.

### Stage adapters

prepareSpeechAudio.ts keeps ffmpeg conversion and temporary file cleanup while adopting managed execution.
transcriber/whisper.ts adopts managed execution for leading-silence detection and transcription, consumes stdout, and parses stderr progress across chunk boundaries, including multiple records per chunk.
SpeechWorkerClient.ts retains protocol validation, job identity, line-size bounds and result validation while delegating lifecycle handling.
Python **main**.py and diarization.py forward supported pyannote hook events as structured progress while reserving stdout for JSONL.
Hooks without meaningful completed/total report activity or substage, not an invented percentage.
Do not add an independent heartbeat that is treated as proof of inference progress.

### SpeechStagePolicy

Create src/main/speech/SpeechStagePolicy.ts and colocated tests.
Policy inputs include stage, audio duration, model/configuration and applicable measured execution profile.
Policy output includes an optional estimated duration and explicit bounded-operation deadlines where justified.
Remove the unconditional preparation five-minute, transcription twenty-minute, worker thirty-minute and worker five-minute silence termination rules for healthy computation.
Startup/protocol readiness deadlines must be scoped to the actual bounded handshake, never implicitly include model loading or inference.
Do not replace existing arbitrary deadlines with new arbitrary numbers; calibrate a readiness limit separately or leave it undefined until justified by measurements.
Invalid protocol, child failure, explicit worker error and user cancellation remain terminal conditions.
Elapsed time beyond an estimate and prolonged lack of measured progress are nonterminal observations.

## Progress and UI

Extend the existing shared speech progress contract with optional stage start time and estimated duration in milliseconds.
Main owns stage transitions and estimation; existing job/workspace identities still reject stale events.
Renderer computes elapsed display time without regenerating transcript content on every timer tick.
Show current stage, real percent when available, elapsed time, and an advisory overrun state when an estimate is exceeded.
Without a calibrated estimate, show stage and elapsed time only.
Do not imply an exact remaining-time promise or overall percentage.
Keep error reasons structured and localize English and Simplified Chinese at presentation.
Stage-specific errors distinguish startup, process exit, protocol failure and cancellation; raw diagnostics stay in the diagnostic sink.
No persisted project schema change is required.

## Calibration experiment

Use the supplied 3877.424-second recording with the actual app-managed models and runtime.
Measure representative five-minute and fifteen-minute excerpts plus the complete recording with speaker recognition enabled.
Record source duration, model/configuration, device, cold/warm condition, stage duration, real progress gaps and peak memory where supported.
Repeat shorter samples to separate startup overhead from processing cost; retain logs and explicitly identify any stage that cannot complete.
Fit the simplest useful per-stage relationship: fixed overhead plus audio duration times measured processing factor, with a conservative uncertainty allowance based on observed variation.
Check whether longer diarization runs invalidate a linear estimate; use a validated duration range and do not extrapolate certainty beyond it.
An uncalibrated device/model profile receives no confident estimate; failure to obtain representative data must not block cancellation or reintroduce hard inference timeouts.
Calibration outputs are verification artifacts, not personal audio committed to the repository.
The experiment does not establish support for arbitrary duration or solve whole-file memory growth.

## Verification

Use controlled child processes to verify large stdout/stderr output, bounded diagnostics, pre-spawn cancellation, ignored SIGTERM, spawn failure, parser failure, early close and competing cancel/result events.
Verify progress parsing across arbitrary stream boundaries.
Use an injectable clock for policy tests: exceeding an estimate keeps inference alive and emits advisory state; invalid protocol and explicit bounded handshake failures still clean up.
Verify stale events cannot affect another analysis and progress percentage remains optional.
Test the actual Python hook adapter with events containing and lacking totals, preserving JSONL-only stdout.
Run focused tests, npm run format, npm run check and relevant Python tests.
For the implementation, run the required Docker MCP UI baseline and changed-behavior acceptance via the repository agent-testing skill; report limitations of models or runtime availability explicitly.
Run the full supplied recording through the app pipeline with diarization and record results; previously successful alignment-only validation is insufficient.

## Delivery and relationship to later work

This change produces common subprocess management, stage policies, adapter integration, progress presentation and calibration evidence.
It does not promise saved partial results: checkpoints and stage retries are the next separately reviewed design.
Existing uncommitted alignment and progress changes must be preserved and kept distinct in review.
No active architecture standard should describe the proposed implementation as shipped before it is implemented and verified.
