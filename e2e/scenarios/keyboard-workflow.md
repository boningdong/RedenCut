# Keyboard Editing Workflow

## User Goal

Make and revise an audio edit using keyboard shortcuts, save it for later work, and keep shortcuts predictable when focus moves among the timeline, transcript, typing fields and workspace controls.
Use a new isolated Docker project with prepared `mandarin-short-female.wav` and execute through the [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md).
Run alongside the [editing workflow](editing-workflow.md); shared import, playback and persistence observations may satisfy both scenarios when the report links the evidence for each checkpoint.
Use the [keyboard contract](../../docs/key-mappings.md) for exact mappings and selection semantics.

## Preparation

Use a speech-enabled harness for the transcript focus checkpoint and generate the transcript through the visible UI.
Record the tested modifier explicitly: Control in the Linux harness, Command on a supported macOS acceptance surface.
Do not infer native macOS shortcut behavior from Linux results.
Choose useful split, selection and seek positions from the current ruler and waveform geometry.
A waveform clip click selects its whole output-time range; do not assume an independent range-drag gesture exists.
For the no-selected-clip range branches, use an observable supported interaction that leaves a waveform selection while deselecting the clip; if this cannot be established, report that branch as BLOCKED.
Before each shortcut, establish and observe its focus and selection context; a successful toolbar click is not evidence that the corresponding shortcut works.
Prepare the save dialog reply before the shortcut that opens it.

## Mandatory Checkpoints

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `keyboard-split` | Select a clip and place the paused playhead strictly inside it; S splits at that position into two visible portions without starting playback. | Before/after screenshots, selected portion, approximate position and unchanged playback state. |
| `keyboard-undo-redo` | After a visible timeline edit, Command/Control+Z reverses that edit and Command/Control+Shift+Z restores it. Each key chord performs one operation. | Ordered edit, undone and redone screenshots; actual key chords and focus context. |
| `keyboard-mute-unmute` | With the waveform selection required by the contract, M mutes the intended audio and gives visible muted feedback. Select a muted clip and use U to unmute it. Also check the range-selection U branch when no clip is selected. | Selection evidence and before/muted/restored screenshots, including which clip or range was affected. |
| `keyboard-delete` | Delete on a selected clip removes that clip; Undo restores it. With no selected clip and an applicable waveform range, Delete performs the contract's range action without accidentally deleting an unrelated whole clip. | Selected-clip and range evidence, resulting waveform/selection feedback, restoration evidence. |
| `keyboard-transport-seek` | Space from an editor context starts playback and advances time, then pauses with two separated stable-time observations. Left/Right and Shift+Left/Right seek by the documented increments while paused, clamp at the endpoints, and do not start playback. Space resumes from the new position. | Ordered time/control snapshots, actual key chords, starting positions and focus context. |
| `keyboard-save-persist` | Command/Control+S saves through the prepared project dialog; the visible project name and saved status update. Fully restart and reopen the saved project; the intended edit remains visible. | Save shortcut, saved-state screenshot, prepared project name, restart generation and reopened-state screenshot. |
| `keyboard-layout-focus` | Tab reaches a layout move control; Enter or Space activates it while playback stays paused and focus remains usable. With a divider focused, Up/Down and Home/End resize within the documented bounds. Command/Control undo, redo and save retain their editor meanings on a layout control outside an active pointer interaction. | Focused-control snapshots, panel order/geometry before and after, stable playback state, modifier shortcut results. |
| `keyboard-native-control-focus` | Unmodified Space on a focused native button or disclosure activates that control, without an additional global playback toggle. Playback's own focused Play/Pause button changes state only once. | Focus snapshot, resulting control state, ordered playback time/state observations. |
| `keyboard-typing-focus` | In a real rename input or other available typing field, typing S, M, U and Space edits the field; Delete and undo/redo retain native text-editing behavior without changing the audio timeline. Command/Control+S does not invoke project save while typing if the contract excludes it. Cancel or restore the disposable label afterward. | Input focus/value before and after, unchanged waveform/time, observed save behavior and restored label. |
| `keyboard-transcript-focus` | In the read-only transcript selection surface, Space controls playback without inserting text, and Command/Control+Z, Command/Control+Shift+Z and Command/Control+S retain their editor meanings. Ordinary typing must not alter transcript text. Explicit waveform interaction transfers editing focus and clears transcript selection so S can split the selected waveform clip. | Native selection/focus evidence, before/after transcript and waveform, actual modifier results and successful split after focus transfer. |
| `keyboard-transcript-scope` | M on selected canonical transcript text uses the same occurrence-aware edit resolution as Delete/Backspace. Where the source occurs more than once, only the selected occurrence is muted. A selection requiring acoustic-boundary expansion presents the requested/expanded text and requires confirmation; cancellation leaves audio unchanged. | Selected text and occurrence evidence, unaffected duplicate occurrence, expansion notice, cancel state and confirmed muted result. |

A checkpoint is not passed by pressing a key without observing the resulting state.
If a required focus surface or prepared dialog cannot be reached through the current harness, record the affected checkpoint as BLOCKED with the missing capability.
For typing fields that do not exist in the product, record the available representative input used rather than inventing a test-only surface.

## Change-Focused Exploration

After mandatory coverage, choose one or two variations relevant to the change.
Examples include Escape clearing a waveform selection, Backspace as the documented Delete alternative, a shortcut after a panel reorder, or canceling an active pointer layout operation without losing audio selection.
Keep platform modifier differences and recovery from stale focus visible in the report.

## Scope

This scenario checks user-visible shortcut routing, selection scope, playback controls and persistence, not audible output or sample-level accuracy.
Use real transcript generation for focus/selection behavior; transcription quality and speaker accuracy remain separate acceptance work.
The Docker MCP cannot certify the native macOS menu system or OS-reserved shortcuts.
Do not substitute toolbar actions, private stores or synthetic keyboard handlers for the required key presses.
