# Transcript Processing and Presentation

## Contract

The transcript toolbar owns one Generate dialog with all-track or single-track scope.
Text (transcription plus alignment) and speaker recognition are independent selections, with one submission running text before speakers.
Completed steps show a green status; rerun only rearms selection and never deletes existing results immediately.
Target tags identify actual affected tracks, including other occurrences of a shared source.
Speaker-only work requires aligned text; a batch missing this prerequisite is rejected before engines run.

## Data and execution

[`SpeechTaskPlanner.ts`](../src/shared/SpeechTaskPlanner.ts) defines per-step `skip | missing | replace` and the pure source-level plan used by preview and main process.
The [speech-analysis IPC contract](../src/shared/ipc.types.ts) accepts explicit `tasks` and retains optional `mode` compatibility; the Generate dialog sends explicit tasks.
Main resolves project-owned sources and artifacts independently, checks only required model capabilities, then publishes each successful phase.
Re-running text invalidates prior speaker attribution; selecting both steps rebuilds it in sequence.
Re-running speakers preserves transcript/alignment identity and acoustic editing data.
Cancellation or phase failure does not pre-delete an old artifact; a successfully published text phase remains available if subsequent speaker processing fails.
Existing speaker-name reset confirmation and background commit guards remain authoritative.
Task selection is transient; it does not require a separate persisted project representation or duplicated transcript data.

## Presentation and files

`SpeechTaskPopover`, `SpeechTaskCard` and `SpeechTaskPresentation` contain dialog state and target summaries; execution remains in App and the main coordinators.
`TranscriptDisplaySwitch` offers Continuous text and By speaker; renderer-only `displayMode` is `continuous | speakers`, defaulting to speakers.
`ContinuousTranscript` renders the same occurrences in chronological reading groups with no speaker filtering or grouping.
Overlapping tracks keep their own phrase order instead of interleaving individual characters; pauses and sentence punctuation form reading boundaries.
Switching display clears native and editor selections, preserving audio edits and diarization results.
`CanonicalTranscriptPanel` keeps its existing occurrence selection, seek, redact, history and timing rules in both displays.
The dialog traps focus and handles Escape; its keyboard events do not reach timeline shortcuts.
Model inventory and preparation belong to the [speech resource contract](speech-models-and-dependencies.md); analysis consumes installed resources without downloading models.

## Verification Scope

Unit tests cover task planning, phase sequencing, missing prerequisites, partial failure, rerun and selection targets.
App tests retain asynchronous availability cancellation and speaker-name confirmation coverage.
Docker MCP acceptance and existing edit/playback/persistence E2Es provide UI regression evidence; model-dependent checks must be reported separately when models are unavailable.
