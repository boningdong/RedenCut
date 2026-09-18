# RedenCut Key Mappings

[`useKeyboardShortcuts.ts`](../src/renderer/src/hooks/useKeyboardShortcuts.ts) implements this keyboard interaction contract.
Update the implementation and this document together whenever a mapping or its contextual behavior changes.

## Editor Shortcuts

| Key | Action | Context and behavior |
| --- | --- | --- |
| Space | Play or pause | Requires an active player. In preview mode, playback skips redacted sections. |
| S | Split at playhead | Requires an active player and exactly one selected clip; the playhead must be strictly inside that clip's output range. |
| M | Mute clips or redact selection | Applies the inverse of the primary clip’s mute state to all selected clips in one edit. Otherwise redacts a waveform range on the selected track. In canonical transcript text, creates overlays in the exact occurrence, asking for confirmation when acoustic boundaries expand the selection. |
| U | Unmute clips | Unmutes all selected clips in one edit, or muted clips overlapping the waveform selection on its owning track; overlays are unchanged. |
| Delete or Backspace | Remove selected object or redact selection | Removes a selected overlay to restore its audio; a selected clip is removed instead. With a range or transcript selection, creates clip-owned overlays. |
| Escape | Cancel drag or clear selection | Cancels an active overlay move or resize without an edit; otherwise clears waveform and timeline selection. |
| Left Arrow | Nudge backward | Seeks one second backward, clamped to zero. |
| Right Arrow | Nudge forward | Seeks one second forward, clamped to the player duration. |
| Shift+Left Arrow | Nudge backward farther | Seeks five seconds backward, clamped to zero. |
| Shift+Right Arrow | Nudge forward farther | Seeks five seconds forward, clamped to the player duration. |
| Command+S or Control+S | Save project | Calls the save callback supplied by the application. |
| Command+Z or Control+Z | Undo | Undoes the last timeline or saved person/association edit in chronological order. |
| Command+Shift+Z or Control+Shift+Z | Redo | Redoes the last undone timeline or person/association edit. |

## Clip Clipboard and Selection

With focus in Audio, Command/Control+C copies selected clips, X cuts them, V pastes at the playhead on the selected track, and D duplicates after the selection.
The clip actions menu exposes the same commands.
Clipboard contents are local to the project and reset on project replacement; text inputs and transcript copy/paste retain their native behavior.
Copies share source audio but receive independent clip and redaction identities.
Shift-click toggles clips in the selection; dragging from blank lane space marquee-selects clips, with Shift adding to the selection.
Moving a selection preserves its time spacing and relative track positions; deleting clips leaves gaps.

Drag a clip onto another lane to preview the exact placement in a bordered frame; release commits one undoable edit, and Escape cancels.
The Snap button toggles clip-edge alignment; the Insert button places the selection at a seam and shifts following clips on affected destination tracks only.
An invalid destination does not commit.
Drag clip edges to trim or reveal source audio without changing the source file or deleting hidden redactions.
Focused trim handles use Left/Right for 10 ms adjustments and Shift+Left/Right for 100 ms adjustments.

## Audio Toolbar

Timeline zoom reaches up to 1,000 pixels per second independently of recording duration; exceptionally long timelines lower this ceiling to keep their full extent within browser layout limits.
Zoom keeps the pointer time anchored for wheel gestures and the viewport center anchored for toolbar buttons.
At close zoom, the ruler shows fractional-second labels and intermediate ticks, rendering only the visible range.

Drag directly on the time ruler to select an output-time range, even without an active track; a click without dragging still seeks.
Hovering the ruler shows a subdued purple dashed guide through every track.
The selected time range remains highlighted across the ruler and all tracks after release, with its owning track emphasized in its track color; Delete/Backspace or Redact applies clip-owned overlays to every intersecting clip on that track in one undoable edit, ignoring gaps and preserving clip positions.
Starting a ruler selection clears clip, overlay and transcript selection; Escape cancels an active drag or clears the selection.
The time range is independent of its optional target track: switching tracks updates the emphasis, and removing or deactivating the target retains the time range without track emphasis.
Click a track header to assign the existing range to that track; without a target, Redact/Delete are disabled and edit shortcuts do nothing.
Replacing the project clears the range.
Transcript selections show the same full-height time reference and emphasize their resolved acoustic range on the matching track; their occurrence-aware edit and boundary-confirmation rules remain unchanged.
Clicking a waveform clip selects its whole output-time range.
The audio toolbar exposes the same context-dependent split, mute/redact and delete actions as the corresponding keyboard shortcuts.
Canonical transcript selections use their own occurrence-aware editing and acoustic-boundary confirmation; audio toolbar edit actions are unavailable while that text selection is active.

Clip Mute, Track Mute and Solo control audibility only; muted speech dims and leaves simultaneous-speech presentation without a redaction strike-through.
The Preview edits toggle skips redacted sections during playback.
Export always removes those same intervals by default, even when Preview is off; retained overlapping audio, ordinary track mute, and natural gaps follow the same timeline rules.
`clip.redactions` stores independent source-relative overlays; `clip.muted` and `track.muted` are ordinary mute controls.
Click an overlay to select it, then Delete to restore its coverage; hold Option/Alt to select or drag the underlying clip through an overlay.
Drag the overlay body to move its range without changing duration, or either edge to preview its bounds, release to commit one undoable edit, or Escape to cancel.
Completing a pointer edge resize clears overlay selection and handle focus; clicking the overlay body still selects it for removal.
Focused overlay handles use Left/Right for 10 ms adjustments and Shift+Left/Right for 100 ms adjustments.
Overlays fill the clip height; hover highlights the overlay independently from its parent clip.
Overlapping overlays keep separate identities; the count button selects the next overlapping object and raises it above its peers.
Option/Alt bypass is decided when the pointer gesture starts; pressing or releasing it during a drag does not change the target.
Moving a trimmed overlay translates its full stored range, preserving hidden metadata while constraining its visible portion to the clip.

## Native Menu Routing

Main uses `before-input-event` to bypass Electron's default menu accelerators only for Command/Control+S and Command/Control+Z (including Shift+Z).
It leaves DOM key events intact; real text inputs keep native editing, while the transcript/editor renderer prevents the default action when handling project commands.
Other chords, composition events, and key releases restore normal menu shortcut handling.

## Focus Rules

- Do not intercept shortcuts while focus is in an `input` or `textarea`.
- While the language selector is focused, native keys (letters, arrows, Space, and Escape) stay within the selector; Command/Control project shortcuts retain their editor meanings.
- Preserve unmodified Space activation for native buttons, selects, and disclosure summaries; these controls must not toggle playback instead of their own action.
- Save, Undo, and Redo remain project commands while focus is in the read-only transcript surface; they prevent native DOM editing history.
- Other unmodified keys in content-editable elements remain local to that surface. Canonical transcript M, Delete, and Backspace share occurrence-aware editing and expansion confirmation; S does not split a stale waveform clip from transcript focus.
- Ignore shortcuts while an input-method composition is in progress.
- While canonical text selection is active, document-level S, M, U, Delete, and Backspace must not reinterpret it as a waveform range after focus moves to another control.
- Clicking or dragging the waveform explicitly transfers keyboard focus to Audio and clears native/canonical text selection; S and M then operate on the selected waveform clip/range.
- Space remains available for play or pause while focus is in the transcript's content-editable surface.
- After handling Command or Control shortcuts, ignore other editor mappings while that modifier remains pressed.

## Workspace Layout Controls

- Tab reaches drag handles, the divider, and reset/retry controls in their visible order.
- Enter or Space activates a focused layout button without toggling audio playback.
- With the divider focused, Up and Down move the divider by five percentage points within the available panel limits.
- With the divider focused, Home minimizes the Transcript region and End maximizes it within the available panel limits.
- Escape cancels an active panel drag or divider resize without clearing the audio selection.
- Reorder panels by dragging the six-dot handle onto an upper or lower drop target; clicking the handle does not reorder panels.
- Command/Control shortcuts retain their editor meanings when focus is on a layout control and no pointer layout interaction is active.

## Speaker Labels

Click a speaker label to show or hide that speaker's transcript; this does not mute their audio.
The pencil button opens one anchored editor with basic information and person associations.
Edits are a draft until Save; Escape, Cancel, or a click outside discards the draft.
Inside an association editor, double-click a member name (or Enter/F2 while focused) to edit it inline.
Drag a person tag onto another to create an association named after the receiving tag; association tags filter all their members together.
Manage people presents associations as parent nodes and their people as children.
People with unavailable or outdated diarization bindings are read-only and cannot be associated.
Keyboard input inside the editor stays local, including native text undo; saved edits participate in project Undo/Redo.

## Settings and Onboarding Dialogs

While a settings or onboarding dialog is open, keyboard input stays within the dialog and does not trigger background editor shortcuts.
Escape closes settings or explicitly skips onboarding; dialog closure leaves active resource downloads running.
