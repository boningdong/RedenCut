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

Zooming out stops when the full current timeline plus a fixed trailing margin fits in the viewport.
The margin is one third of the longest imported source duration: one hour of audio gets 20 minutes of blank time, initially 25% of the viewport.
Moving clips changes the timeline extent but does not enlarge this margin; reopening a project derives the same margin from its source metadata.
Reaching this overview returns the visible start to zero; additional trailing scroll space remains available for pointer-anchored zoom and dragging clips beyond the visible blank area.
The horizontal scrollbar stays at the bottom of the audio viewport while tracks scroll vertically; dragging it and horizontal trackpad gestures pan the same timeline.
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
Preview Mode is enabled by default; its toggle renders the edited output, removing eligible redacted sections and overlapping their enabled crossfade regions.
The waveform, clip positions, transcript seeks and editing shortcuts retain editing-time coordinates; the transport counter and total duration show the current playback mode’s output time.
Export uses the same edited render plan regardless of Preview; retained overlapping audio, ordinary track mute, and natural gaps follow the same eligibility rules.
An enabled crossfade with equal 30 ms adjacent source regions shortens output by an additional 30 ms while keeping clip positions unchanged.
`clip.redactions` stores independent source-relative overlays; `clip.muted` and `track.muted` are ordinary mute controls.
Click an overlay to select it, then Delete to restore its coverage; hold Option/Alt to select or drag the underlying clip through an overlay.
Drag the overlay body to move its range without changing duration, or either edge to preview its bounds, release to commit one undoable edit, or Escape to cancel.
Completing a pointer edge resize clears overlay selection and handle focus; clicking the overlay body still selects it for removal.
Focused overlay handles use Left/Right for 10 ms adjustments and Shift+Left/Right for 100 ms adjustments.
Overlays fill the clip height; hover highlights the overlay independently from its parent clip.
Overlapping overlays keep separate identities; the count button selects the next overlapping object and raises it above its peers.
Option/Alt bypass is decided when the pointer gesture starts; pressing or releasing it during a drag does not change the target.
Moving a trimmed overlay translates its full stored range, preserving hidden metadata while constraining its visible portion to the clip.

New redactions start with a 30 ms equal-power crossfade; existing redactions without settings keep their previous behavior.
Right-click an overlay, or use Shift+F10/the context-menu key while it is focused, then choose Edit crossfade to open its floating editor.
The Edit crossfade entry leads to an editor containing enable, duration and curve controls; disabling preserves the chosen settings.
Remove redact restores that overlay’s audio coverage as one undoable edit.
The editor appears above the visible overlay when space permits, flips below or clamps inside the viewport, and closes when the anchor leaves view.
Idle and ordinarily selected overlays hide crossfade envelopes and handles; only crossfade editing exposes those controls.
Drag either crossfade handle to change both adjacent region widths together; release commits one undoable edit, and Escape cancels the active gesture.
Escape without an active gesture, Done, or an outside click returns to ordinary overlay selection.
Keyboard input inside the floating editor stays local, so Space, arrows and Delete cannot trigger background audio edits.


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
- Reorder content panels by dragging the six-dot handle into the vertically central area of the other content panel; the full destination panel highlights. Playback docks at the opposite top or bottom edge of the workspace.
- Panel drags activate after 16 pixels of movement. Targets span the full workspace width without horizontal dead zones. Original positions, destination top/bottom edges and space outside the workspace are cancellation zones; entering a valid target responds immediately without a dwell delay. Release commits the move with a short easing animation; reduced-motion preferences disable that animation. Clicking or briefly nudging a handle does not reorder panels.
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

## Mix Source Replacement

The monochrome hierarchy button at the start of the track control grid selects independent recordings to lock to that Mix.
Its connected branch lines represent the master and indented children; active background indicates an established link.
Linked child tracks are compact and read-only; their stored redactions and track controls are ignored while supplying replacement source audio.
Use the existing ruler range and target Mix, then Replace audio to open the anchored floating selector.
Choose one or more children and Apply, or restore original Mix audio; closing or Escape discards the draft.
Replacement is not Redact and never shortens time by itself; master Redact and crossfade continue to apply to the effective sound.
Time edits originate on Mix and synchronize child material; child redactions survive unlink, which returns affected replacement ranges to Mix after a warning.
The Mute and Solo header icons preserve their existing semantics and shortcuts; no new single-letter replacement shortcut is introduced.

Linked masters show an explicit Mix role, member count and expandable child hierarchy. Right-click a track header or press Shift+F10 while it is focused for Delete Track and collapse/expand commands; unlinking remains a separate management action. The visible × beside the track name also removes the track through the same removal flow, without activating it.
At most six independent tracks can be linked. Linked master rows are taller (108 px versus ordinary 92 px; linked children remain 44 px), with centered waveforms: intervals using up to three sources use parallel stacked waveforms; intervals using four through six sources use one theme-accent illustrative waveform.
Replacement labels show at most three names when they fit, otherwise source-color dots and a participant count; clicking the replacement selects its visible interval.
The floating selector provides numeric start/end bounds and reports mixed settings without preselecting their union; applying explicitly chosen sources replaces the whole selected interval.
Applied-replacement edge handles adjust its audio coverage; Left/Right changes an edge by 10 ms, Shift by 100 ms, and Escape cancels a drag.
The persistent replacement entry reveals the selected Mix range before opening its floating editor.

Selecting a linked Mix interval does not open its source editor. Ordinary range selections have no resize grips; selecting an applied replacement reveals grips that resize that replacement while preserving its sources (one undo per drag). Use Edit replacement or the context menu to open its editor. Narrow intervals use an icon shortcut. The source editor stays outside the master lane, preferring the space above it; displayed bounds use two decimal places without rounding unchanged audio boundaries.
## Context Menus

Right-click selected transcript text for Redact selection or Copy text; redaction keeps the existing occurrence and acoustic-boundary confirmation rules.
Right-click redacted speech to remove its owning overlay; overlapping overlays are listed by their visible timeline intervals so the user can choose one explicitly.
Removing an overlay restores its entire coverage, which can extend beyond the clicked word; it does not change ordinary clip mute.

Right-click a clip for Split at playhead, Mute/Unmute, Copy, Cut, Duplicate, Paste at playhead and Delete.
A timeline range also exposes Redact selected range on an intersecting clip in its target track; it applies to the range across that track’s intersecting clips, preserving gaps.
Right-clicking an already selected clip retains multi-selection; other clips become the selection.
Right-clicking a blank lane offers Paste at playhead without discarding the existing selection; choosing Paste targets that lane.
Opening a context menu never seeks the playhead.
Split requires one selected clip and a playhead strictly inside its bounds.

Context menus omit shortcut labels.
Arrow keys move between enabled commands, Home/End select the first/last enabled command, Enter or Space activates it, and Escape dismisses and restores focus.
Menus close on outside pointer interaction, viewport scrolling or resizing; keyboard input inside them cannot trigger background editor commands.

## Track Levels and Effects

The track header uses a six-column grid with 26 px control rows: Sync, Mute, Solo and a three-column Volume control above three-column Effects and Gain controls.
Volume and Gain use transparent A2 surfaces, setting indicators and hover/focus feedback.
Click a level region to open its anchored editor; a completed slider gesture commits one undo item, while Escape or an outside click discards an uncommitted slider gesture. Gain also accepts a numeric dB entry: Enter or blur commits a valid value once, invalid or out-of-range input reverts, and Escape cancels the numeric draft.
Gain is a post-effect adjustment in dB; Volume retains the output percentage control.
Effects shows an icon and dropdown arrow; any enabled effect highlights the trigger and Normalize exposes a persistent checked menu item.
Normalize balances speech levels on the composed track, including replacement audio; disabling it preserves settings and source recordings.
Playback preparation announces its pending state in the transport; processing errors surface through the existing player error path.

Volume and Gain sliders audition their current value during a drag without saving each movement.
Release commits one undoable edit; Escape, pointer cancellation, or closing an unfinished slider edit restores the saved track levels.
