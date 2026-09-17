# Transcript tasks and presentation

## Contract

The transcript toolbar owns one AI processing dialog with all-track or single-track scope.
Text (transcription plus alignment) and speaker recognition are independent selections, with one submission running text before speakers.
Completed steps show a green status; rerun only rearms selection and never deletes existing results immediately.
Target tags identify actual affected tracks, including other occurrences of a shared source.
Speaker-only work requires aligned text; a batch missing this prerequisite is rejected before engines run.

## Data and execution

`shared/SpeechTaskPlanner.ts` defines per-step `skip | missing | replace` and the pure source-level plan used by preview and main process.
The optional IPC `tasks` field preserves legacy `mode` callers while the new UI always sends explicit tasks.
Main resolves project-owned sources and artifacts independently, checks only required model capabilities, then publishes each successful phase.
Re-running text invalidates prior speaker attribution; selecting both steps rebuilds it in sequence.
Re-running speakers preserves transcript/alignment identity and acoustic editing data.
Cancellation or phase failure does not pre-delete an old artifact; a successfully published text phase remains available if subsequent speaker processing fails.
Existing speaker-name reset confirmation and background commit guards remain authoritative.
No project format migration or duplicated transcript data is introduced.

## Presentation and files

`SpeechTaskPopover`, `SpeechTaskCard` and `SpeechTaskPresentation` contain dialog state and target summaries; execution remains in App and the main coordinators.
`TranscriptDisplaySwitch` controls renderer-only `displayMode` (`continuous | speakers`), defaulting to speakers.
`ContinuousTranscript` renders the same occurrences in chronological reading groups with no speaker filtering or grouping.
Overlapping tracks keep their own phrase order instead of interleaving individual characters; pauses and sentence punctuation form reading boundaries.
Switching display clears native and editor selections, preserving audio edits and diarization results.
`CanonicalTranscriptPanel` keeps its existing occurrence selection, seek, redact, history and timing rules in both displays.
The dialog traps focus and handles Escape; its keyboard events do not reach timeline shortcuts.
Onboarding, model inventory and download UI are outside this change.

## Verification

Unit tests cover task planning, phase sequencing, missing prerequisites, partial failure, rerun and selection targets.
App tests retain asynchronous availability cancellation and speaker-name confirmation coverage.
Docker MCP acceptance and existing edit/playback/persistence E2Es provide UI regression evidence; model-dependent checks must be reported separately when models are unavailable.
