# PodCut Key Mappings

[`useKeyboardShortcuts.ts`](../src/renderer/src/hooks/useKeyboardShortcuts.ts) implements this keyboard interaction contract.
Update the implementation and this document together whenever a mapping or its contextual behavior changes.

## Editor Shortcuts

| Key | Action | Context and behavior |
| --- | --- | --- |
| Space | Play or pause | Requires an active player. In preview mode, playback skips redacted sections. |
| S | Split at playhead | Requires an active player and a selected clip; the playhead must be strictly inside that clip's output range. |
| M | Redact selection | For a waveform selection, redacts its range on the selected track and clears it. In canonical transcript text, resolves the exact clip occurrence and asks for confirmation when acoustic boundaries expand the text selection. |
| U | Restore redaction | Restores the selected redacted clip when one is selected; otherwise restores every redacted clip overlapping the waveform selection and clears that selection. |
| Delete or Backspace | Remove selected clip or redact selection | Removes the selected clip when one is selected. Otherwise, a waveform selection redacts overlapping unredacted audio, associates selected transcript word IDs, and clears the selection. |
| Escape | Clear selection | Clears the waveform selection and selected clip. |
| Left Arrow | Nudge backward | Seeks one second backward, clamped to zero. |
| Right Arrow | Nudge forward | Seeks one second forward, clamped to the player duration. |
| Shift+Left Arrow | Nudge backward farther | Seeks five seconds backward, clamped to zero. |
| Shift+Right Arrow | Nudge forward farther | Seeks five seconds forward, clamped to the player duration. |
| Command+S or Control+S | Save project | Calls the save callback supplied by the application. |
| Command+Z or Control+Z | Undo | Undoes the last timeline operation. |
| Command+Shift+Z or Control+Shift+Z | Redo | Redoes the last undone timeline operation. |

## Audio Toolbar

Clicking a waveform clip selects its whole output-time range.
The audio toolbar exposes the same split, redact-selection and delete-selection actions as the corresponding keyboard shortcuts.
Canonical transcript selections use their own occurrence-aware editing and acoustic-boundary confirmation; audio toolbar edit actions are unavailable while that text selection is active.

Track Mute and Solo control audibility only; they do not redact transcript text.
The Preview edits toggle skips redacted sections during playback.
Export always removes those same intervals by default, even when Preview is off; retained overlapping audio, ordinary track mute, and natural gaps follow the same timeline rules.
For compatibility, project files retain `clip.muted` as the redaction marker; `track.muted` remains the ordinary track mute control.

## Native Menu Routing

Main uses `before-input-event` to bypass Electron's default menu accelerators only for Command/Control+S and Command/Control+Z (including Shift+Z).
It leaves DOM key events intact; real text inputs keep native editing, while the transcript/editor renderer prevents the default action when handling project commands.
Other chords, composition events, and key releases restore normal menu shortcut handling.

## Focus Rules

- Do not intercept shortcuts while focus is in an `input` or `textarea`.
- Preserve unmodified Space activation for native buttons, selects, and disclosure summaries; these controls must not toggle playback instead of their own action.
- Save, Undo, and Redo remain project commands while focus is in the read-only transcript surface; they prevent native DOM editing history.
- Other unmodified keys in content-editable elements remain local to that surface. Canonical transcript M, Delete, and Backspace share occurrence-aware editing and expansion confirmation; S does not split a stale waveform clip from transcript focus.
- Ignore shortcuts while an input-method composition is in progress.
- While canonical text selection is active, document-level S, M, U, Delete, and Backspace must not reinterpret it as a waveform range after focus moves to another control.
- Clicking or dragging the waveform explicitly transfers keyboard focus to Audio and clears native/canonical text selection; S and M then operate on the selected waveform clip/range.
- Space remains available for play or pause while focus is in the transcript's content-editable surface.
- After handling Command or Control shortcuts, ignore other editor mappings while that modifier remains pressed.

## Workspace Layout Controls

- Tab reaches panel move buttons, drag handles, the divider, and reset/retry controls in their visible order.
- Enter or Space activates a focused layout button without toggling audio playback.
- With the divider focused, Up and Down move the divider by five percentage points within the available panel limits.
- With the divider focused, Home minimizes the Transcript region and End maximizes it within the available panel limits.
- Escape cancels an active panel drag or divider resize without clearing the audio selection.
- Panel move buttons provide keyboard equivalents for swapping Transcript/Audio and placing Transport above or below them.
- Command/Control shortcuts retain their editor meanings when focus is on a layout control and no pointer layout interaction is active.
