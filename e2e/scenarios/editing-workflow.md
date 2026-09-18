# Editing Workflow

## User Goal

Make a short edit, inspect and revise it, then save it for later work.
Use [mandarin-short-female.wav](../fixtures/audio/mandarin-short-female.wav) in a new isolated Docker project.
Execute through the [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md).

## Mandatory Checkpoints

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `import` | Audio imports; a track, waveform and useful audio information are visible. | Imported-state screenshot and observed metadata. |
| `edit` | Split inside the audio and move one portion to create a visible gap; identify the selected portion and inspect both pieces. | Before/after screenshots, chosen approximate positions, and selection feedback. |
| `revise` | Undo the move, observe the gap disappear, then redo and observe it return. | Screenshots of both states. |
| `transport` | Play advances visible time; pause stops it; seeking while paused changes the displayed position without starting playback; resume advances from that position with the appropriate controls. | Ordered time/control observations, including two separated observations while paused and after resume. |
| `persist` | Save, fully restart the application, reopen the saved project; the edited layout and waveform remain visibly consistent. | Saved-state and reopened screenshots, project name, and both generations. |
| `changed-behavior` | The feature or fix under review meets its approved user-visible requirements. | Enumerate each added check with expected/actual behavior and evidence; for a baseline-only trial, use `EXCLUDED` with "No product change under review". |

Choose useful split/seek positions and input methods based on the current UI; record them rather than prescribing fixed coordinates here.
Observe selection clarity, button feedback and usability throughout.
Do not replace restart with reload, compare two screenshots of the same state, or infer pause stability from a single snapshot.

## Ruler Range and Transcript Highlight Checks

For range-selection changes, exercise these additional checkpoints with the imported audio and a disposable saved transcript fixture from [saved project setup](../fixtures/projects/README.md).

| ID | Expected observable outcome |
| --- | --- |
| `ruler-select` | Select a track, then drag directly on the ruler in both directions; release retains a full-height time reference across the ruler and all tracks, with the owning track emphasized in its own color. A simple ruler click still seeks and preserves the clip selection needed for Split. |
| `ruler-cross-clip` | Split and move a clip to create a gap, select a range spanning both pieces, then Delete or Redact. Only intersecting audio gains overlays; clip positions and the gap remain. One Undo restores both pieces. |
| `ruler-scope` | With two tracks, the range highlights all tracks as a time reference, while editing affects only the current track; switching tracks clears the old range. |
| `ruler-cancel` | Escape clears the range without an edit; zoomed/scrolled selections remain aligned with the ruler. |
| `text-highlight` | Selecting multiple timed transcript characters shows the matching waveform range, and clearing text selection removes it. Existing transcript Delete and Undo still work. |

Capture before/after screenshots and actual actions; use the same restart/save evidence as the baseline when applicable.

## Change-Focused Exploration

After mandatory coverage, try one or two relevant variations, chosen before execution.
Examples include changing zoom before selecting a clip, using a shortcut instead of a button, or inspecting a menu and dismissing it.
Report discoveries and recovery attempts separately; exploration does not replace missing checkpoints.

## Scope

This baseline checks visible playback controls and time, not actual sound, precise source offsets or sample-level timing.
Audio output is covered separately by existing container E2Es; AI listening is not available through the current MCP catalog.
If a changed feature requires audio-content or transcription verification, that requirement remains BLOCKED until its capability is available.
Do not silently replace it with the baseline's UI-only check.
