# Redact Preview Workflow

## User Goal

Review an edit by playing across redacted audio, compare Preview on and off, and preserve audible material from other tracks.
Run alongside the [editing workflow](editing-workflow.md) through the [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md).
Shared import, playback and save/reopen observations may satisfy both scenarios when each checkpoint links the evidence.
Use a new isolated Docker project and prepared `mandarin-short-female.wav`; a second prepared import provides an overlapping track where required.

## Preparation

Create a clearly visible interior redacted interval through supported editing controls, with retained audio before and after it.
Use actual transcript selection when validating transcript redaction; otherwise split a clip and redact the intended interior portion with the documented waveform selection controls.
Record the chosen interval from visible ruler/clip geometry and identify the redacted track.
Do not confuse track-level Mute, a removed clip's empty gap, or naturally silent source material with a redacted clip interval.
Choose an interval long enough that before/inside/after observations distinguish a jump from ordinary elapsed playback.
For each playback checkpoint, capture ordered visible times, Play/Pause state, Preview state and elapsed observation timing from retained tool evidence.
Sparse observations that could equally represent ordinary playback are insufficient evidence of a skip.
Do not infer active playback behavior from moving the paused playhead or from a successful button click alone.

## Mandatory Checkpoints

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `redact-setup` | An interior interval is visibly redacted while both adjacent portions remain available; the selected edit affects the intended track. | Before/after waveform and, when used, inline transcript strike; approximate interval and selection context. |
| `preview-crossing` | With Preview on, playback started before the redacted interval advances to its start and jumps to the interval's end, then continues into retained audio. | Ordered playing-time observations bracketing the jump, redacted bounds and Preview-on state; elapsed timing sufficient to distinguish the jump. |
| `preview-off` | With Preview off, playback traverses the same redacted interval in ordinary timeline time without the Preview jump and continues afterward. | Playing time observed inside the interval and afterward, Preview-off state, comparison with the same bounds. |
| `preview-start-inside` | With Preview on and a paused playhead inside the redacted interval, Play seeks to its end and begins advancing through retained audio. | Paused inside position, first playing observation at/after the end and a later advancing observation. |
| `preview-track-mute` | Track-level Mute alone does not cause Preview to jump across otherwise unredacted timeline material. | Track Mute state, absence of clip redaction in the tested interval, ordinary playing-time progression through it. |
| `preview-gap` | A visible empty timeline gap between retained portions does not become a redaction skip merely because Preview is on. | Gap geometry and playing time observed inside and after the gap with Preview on. |
| `preview-overlap` | A second unmuted track containing retained audio over the first track's redacted interval prevents a global skip that would omit that retained material. | Both tracks' overlapping geometry and mute/redaction state, Preview on, playing time inside the overlap and afterward. |
| `preview-stop` | Pause stops playback after a Preview transition, and two separated observations remain stable; restarting playback resumes predictably from the visible position. | Ordered pause, stable pause and resume time/control observations. |
| `preview-persist` | Save, fully restart and reopen the project; redacted and retained intervals remain visible. Enable Preview explicitly if needed and confirm the redaction crossing behavior again. | Saved/reopened project name and waveform, both generations, repeated playing-time jump evidence. |

For overlap setup, position the retained second-track audio to cover the entire candidate skip interval, rather than relying on an ambiguous partial overlap.
If source silence is additionally used as a variation, disclose how the silent interval was established; waveform appearance alone is not proof of silence.
No checkpoint passes solely because the playhead reached a later time.
Unavailable mandatory evidence remains BLOCKED.

## Change-Focused Exploration

Choose one or two relevant variations after mandatory coverage, such as adjacent redacted portions, pause/resume near the project end, or rapid Play–Pause–Play input after a redaction transition.
Keep retries, selection workarounds and timing uncertainty explicit.

## Scope

This scenario verifies actual UI playback progression and controls, not listening or sample-level sound correctness.
The retained second-track region establishes the timeline's reason not to skip; audible output must be verified separately with supported audio capture if the task requires a sound-content claim.
The current Docker MCP does not expose recorder controls, so required listening/capture claims remain BLOCKED rather than inferred from these observations.
Do not manipulate private stores, serialized projects or playback callbacks to manufacture a passing state.
