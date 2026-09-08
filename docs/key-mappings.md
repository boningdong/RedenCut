# PodCut Key Mappings

[`useKeyboardShortcuts.ts`](../src/renderer/src/hooks/useKeyboardShortcuts.ts) implements this keyboard interaction contract.
Update the implementation and this document together whenever a mapping or its contextual behavior changes.

## Editor Shortcuts

| Key | Action | Context and behavior |
| --- | --- | --- |
| Space | Play or pause | Requires an active player. In preview mode, starting playback while the playhead is inside a muted clip first seeks to that clip's output end. |
| S | Split at playhead | Requires an active player and a selected clip; the playhead must be strictly inside that clip's output range. |
| M | Mute selection | Requires a waveform drag selection and a primary source file. Associates selected transcript word IDs with the mute, then clears the selection. |
| U | Unmute | Unmutes the selected clip when one is selected; otherwise unmutes every muted clip overlapping the waveform drag selection and clears that selection. |
| Delete or Backspace | Remove selected clip or mute selection | Removes the selected clip when one is selected. Otherwise, a waveform drag selection mutes overlapping unmuted audio, associates selected transcript word IDs, and clears the selection. |
| Escape | Clear selection | Clears the waveform selection and selected clip. |
| Left Arrow | Nudge backward | Seeks one second backward, clamped to zero. |
| Right Arrow | Nudge forward | Seeks one second forward, clamped to the player duration. |
| Shift+Left Arrow | Nudge backward farther | Seeks five seconds backward, clamped to zero. |
| Shift+Right Arrow | Nudge forward farther | Seeks five seconds forward, clamped to the player duration. |
| Command+S or Control+S | Save project | Calls the save callback supplied by the application. |
| Command+Z or Control+Z | Undo | Undoes the last timeline operation. |
| Command+Shift+Z or Control+Shift+Z | Redo | Redoes the last undone timeline operation. |

## Focus Rules

- Do not intercept shortcuts while focus is in an `input` or `textarea`.
- In content-editable elements, do not intercept editor shortcuts other than Space.
- Space remains available for play or pause while focus is in the transcript's content-editable surface.
- After handling Command or Control shortcuts, ignore other editor mappings while that modifier remains pressed.
