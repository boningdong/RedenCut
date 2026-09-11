# Redact preview and speech audio fixes

## Approved behavior

Name text/clip removal Redact, while keeping ordinary track Mute distinct.
Preview skips redacted intervals during playback and when starting inside one, but does not skip ordinary track mute, natural gaps, or retained content on another active track.
Keep paused seeking available for inspecting redacted material.
Make these behaviors a durable AI acceptance scenario.
Generate the first track's transcript, import an M4A second track, and generate its transcript without losing the first analysis.
Surface actionable speech-stage failures instead of the generic operation error.

## Root causes and implementation

The waveform panel now mounts before a player exists, so its one-time preview subscription could remain unattached.
Own redaction preview subscriptions alongside each player's lifecycle and share playback entry behavior between button and keyboard controls.
Compute skip intervals from current clips, excluding retained content and respecting track mute/solo state.
Keep the existing persisted `Clip.muted` marker for redactions; do not change the project schema.
Use `Track.muted` only for ordinary mix muting, and do not strike through its transcript as a redaction.

The speech pipeline passed original M4A files into a Whisper CLI that did not support the format.
Normalize validated imported Float32 PCM into a temporary 16 kHz mono WAV shared by speech recognition and alignment/diarization.
Preserve original source fingerprints and identities, clean temporary audio on success/failure/cancellation, and expose fixed stage-specific public messages without leaking internal paths or engine stderr.

## Verification

Run the standard code checks and Docker harness/E2E suites on the final source.
The overlap E2E now permanently uses a WAV first track and M4A second track.
Run the editing baseline, `redact-preview-workflow`, and the reported two-track transcription sequence through Docker MCP.
Retain actual playback timing evidence; sparse observations that could be ordinary playback cannot prove a redaction jump.

## Initial verification record

`npm run check` passed 633 tests across 94 files, formatting, lint, dead-code analysis, typechecking, and production build.
The Docker harness suite passed 25 tests across 12 files and all five real-audio E2Es passed, including WAV-first/M4A-second transcript generation.
The verified product bundles are `index-DxR9nqUb.js` and `index-B6M0_yg9.css`.
Initial-source manual acceptance evidence belongs to `.harness-runs/container/732bc5f5-150b-4a22-aaa2-bd1fe4e39c29/agent-testing-report.md`.
Actual Preview crossing moved from 2.06 to 8.08 seconds within approximately 1.106 seconds of wall time across the 3–8 second redaction.
Preview off, starting inside redaction, ordinary track mute, natural gaps, and retained overlap were also observed through the real UI.
The actual WAV-first/M4A-second generation sequence succeeded without losing Track 1's transcript.

The initial manual run failed `preview-stop`: pausing after a redaction jump and resuming could stall or jump to the end.
The failure report is retained, and player clock/remaining-buffer handling requires correction and fresh acceptance before completion.

## Playback follow-up

Clear the previous playback clock before resume callbacks and asynchronous preparation.
Compute prefill against the remaining acknowledged audio rather than the original queue plan, so a consumed tail can resume.
Invalidate superseded playback intents and correlate processor-start acknowledgements with the active start request.
A targeted Docker run on `index-B1Y0IIRW.js` confirmed normal progression after pausing at 9.18 seconds and in the final second; final acceptance must use the subsequent request-correlation build.

Targeted playback report: `.harness-runs/container/5c601fbb-92f2-4928-b0ff-f682daa7fc18/agent-testing-report.md`.

## Verification before delayed-acknowledgement fix

The `index-B_sStXSB.js` / `index-B6M0_yg9.css` build passed `npm run check`: 637 tests across 94 files, formatting, lint, dead-code analysis, typecheck, and production build.
The Docker harness passed 25 tests across 12 files; all five real-audio E2Es across four files passed, including WAV-first/M4A-second analysis and recorded playback/pause/seek/resume.
Independent review confirmed stale asynchronous playback starts and stale processor acknowledgements are rejected; no unresolved concrete review finding remained.
The corresponding failed UI acceptance belongs to `.harness-runs/container/7c4643e9-c9fe-4b0a-81a8-710f494bbaa4/agent-testing-report.md`.

That UI run reproduced an intermittent resume stall despite the automatic checks passing.
A refill can appear to reach the target before the processor acknowledges it, while concurrent consumption leaves actual depth below target but above the low-water refill threshold.
Paused prefill must actively top up after these delayed acknowledgements rather than wait indefinitely for a processor refill request.

## Final verification

The delayed-acknowledgement fix adds active prefill at waiter creation, depth acknowledgements, and completion of an active fill; read failures reject the waiter rather than leaving playback pending.
Its regression reproduces a queue stuck at 95,000 frames between the low-water refill threshold and the 96,000-frame start target, including a failing-read variant.
The final `index-CDR6i052.js` / `index-B6M0_yg9.css` build passed `npm run check` with 639 tests across 94 files, plus 25 Docker harness tests and five real-audio E2Es.
Final UI evidence belongs to `.harness-runs/container/41ab3139-84d8-4911-babc-c36f1aca7bfa/agent-testing-report.md`.
Three consecutive pause/resume operations without seeking advanced normally, including the final sub-two-second tail; the report records remaining scenario coverage and cleanup.

All mandatory editing/redact UI checkpoints passed on the final build, including real WAV-first/M4A-second generation with Track 1 preserved.
Save/reopen retained the redacted interval; reopened playback crossed from 2.06 to 8.06 seconds and resumed normally after pausing at 9.17 seconds.
The report discloses recovery from a stale test-button reference: persistence was rechecked with a newly saved minimal project in the same unchanged build, rather than crediting an unsaved restart.
The user's original failing M4A was not supplied; format regression used a real prepared AAC/M4A fixture, not an analysis of that exact file.
