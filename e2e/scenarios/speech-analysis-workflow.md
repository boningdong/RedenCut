# Speech Analysis Workflow

## User Goal

Generate a verbatim transcript for a short conversation, understand which text can safely drive audio edits, make one confirmed text-driven edit, label an anonymous speaker, then save and reopen the project.

Use a new isolated harness project and a repository conversation fixture. Execute through the agent-testing skill.

## Mandatory Checkpoints

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `speech-import` | Conversation audio imports and the transcript pane offers analysis. | Imported-state screenshot and visible source/track. |
| `speech-generate` | One analysis job shows ordered stages and ends with visible canonical transcript text plus anonymous speakers. | Progress observations and completed transcript screenshot. |
| `speech-editability` | Aligned speech, punctuation, and any unaligned speech have distinct visible states; punctuation-only or unaligned selection cannot create an audio edit. | Selection/status screenshots and observed disabled or explanatory feedback. |
| `speech-expansion` | Selecting part of a multi-unit acoustic boundary shows the requested and expanded text and requires confirmation before editing. | Expansion notice before confirmation and timeline/transcript state after confirmation. |
| `speech-speaker-label` | A user can replace a generated speaker display name without changing the anonymous machine identity. | Before/after visible label and machine-label affordance. |
| `speech-persist` | Save, fully restart, and reopen; transcript units, edit boundaries, speaker attribution, and the custom display name remain visible. | Saved and reopened screenshots from distinct generations. |

## Change-Focused Exploration

Try punctuation mixed with editable speech and cancel one expansion before confirming another. Record whether transcript highlighting and waveform selection remain logically consistent.

## Scope

Visible text and boundary behavior are required. The harness cannot judge transcription correctness by listening; model-quality assessment and macOS performance are separate acceptance lanes. A real-model worker smoke is required independently of deterministic UI fixtures.
