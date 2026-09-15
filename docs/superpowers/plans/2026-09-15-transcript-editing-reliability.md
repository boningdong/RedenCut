# Transcript editing reliability implementation plan

Goal: Fix unsupported transcript timing, fragile reading paragraphs, fragmented continuous redaction, and engineering-heavy progress presentation.
Architecture: Keep raw transcript, validate acoustic editing evidence before publishing usable bounds, project source identities onto timeline, and separate reading continuity from exact edit targets.
User approved the design and implementation in conversation; continue on codex/speech-process-reliability from checkpoint 5f262ac.
No edits to real user projects, model downloads, host Electron, or instruction files.

- [x] Alignment reliability: red tests for digital silence even with positive confidence, zero evidence, quiet genuine audio, offsets and artifact compatibility; implement worker alignment_quality and versioned alignment validation; propagate shared schema and coordinator; run Python and focused TypeScript tests.
- [x] Reading continuity: red tests for the 2ms dangling 楚 at overlap edge, silent intermediate clips after redaction, real speaker/source/gap boundaries; update transcriptDialogue and pass track topology without changing true overlap intervals.
- [x] Continuous selection: red tests for selected consecutive text with acoustic gaps, safe sibling clips, duplicate source appearances, intervening unselected words and stale clip targets; resolve one contiguous source range only within one validated continuous occurrence; commit all affected clips atomically and undo once.
- [x] Presentation: compact phase/progress status with details and cancellation, source-scoped unassigned filter, distinct all-hidden state, localized uncertainty copy; focused component tests.
- [x] Integrate and verify: run formatting, full npm check, Python tests, read-only replay of Demo2, independent review and fresh Docker baseline/targeted UI acceptance. Preserve explicit model-dependent blockers and native short-sample evidence.

Primary files: worker alignment_quality.py/alignment.py; shared speech and worker schemas; SpeechAnalysisCoordinator; renderer transcriptReliability.ts, transcriptProjection.ts, transcriptSelection.ts, transcriptDialogue.ts, timeline.store.ts, canonical transcript panel, speaker filters and progress components.
Tests stay beside implementations. Real project data is diagnostic input only and is not checked into fixtures.


## Verification outcome

Final full check passed: 949 TypeScript tests in 130 files, lint, Knip, types and production build; 51 Python tests passed.
True native first-30-second inference completed in 27.9 seconds using existing offline models, preserving validation metadata and transcript/alignment identities across speaker enrichment.
Read-only Demo2 validation and domain replay reproduced the reported input and verified the complete 清楚 rows without extending the true overlap interval.
The first Docker run exposed legacy untimed interleaving fragmentation; a regression test and timed-turn boundary fix resolved it, followed by a new full check and a fresh Docker run.
Fresh run `978e84c3-09d3-460b-a611-989b51460009` passed baseline import/edit/undo/redo/playback/save/reopen and legacy reading, no-seek/no-redaction, unassigned filtering and all-hidden checkpoints.
Live generation status and newly validated transcript editing UI remain BLOCKED due to unprovisioned Docker speech resources; automated and native tests are separate evidence.
Both owned runs were stopped; no original user project, instruction file or model installation was modified.
New alignment validation is a conservative contradiction check, not a general hallucination detector; legacy results require re-analysis to regain timing authority.
Report: `/Users/boning/Workspaces/Podcut/output/transcript-reliability/verification.md`.
