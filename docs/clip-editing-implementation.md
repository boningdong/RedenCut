# Clip Editing Implementation

## Editing system

Clip edits preserve source audio and commit timeline metadata through the existing Zustand store.
There are no new classes, IPC methods, or project-schema migrations.

```text
Waveform pointer gestures / Audio keyboard actions
              ↓
TimelinePlacement + TimelineEdits (pure calculations)
              ↓
timeline.store.commitTracks (one guarded undo entry)
              ↓
Existing playback, transcript, save and export consumers
```

## Modules

| Module | Responsibility |
| --- | --- |
| `domain/TimelinePlacement.ts` | Group placement, track offsets, collision resolution, edge snapping and seam insertion. |
| `domain/TimelineEdits.ts` | Nondestructive edge trimming within source and neighbor bounds. |
| `components/Waveform/UseClipInteraction.ts` | Pointer threshold, transient previews, lane hit testing, marquee, cancellation and edge scrolling. |
| `components/Waveform/ClipView.tsx` | Clip presentation and label-strip trim handles, separate from redaction handles. |
| `components/Waveform/ClipDragPreview.tsx` | Exact destination geometry, target-lane highlight and insertion previews. |
| `stores/TimelineClipboardStore.ts` | Same-project clipboard, invalidated by project generation. |
| `actions/ClipClipboardActions.ts` | Copy/cut/paste/duplicate with new occurrence identities and shared audio sources. |

Paths in the table are relative to `src/renderer/src/`.
`WaveformView` assembles these modules and keeps the timeline scale stable across edits; reopening or replacing sources establishes a new fit basis.

## State and history

`selectedClipIds` represents the selection; `selectedClipId` remains the primary clip for existing consumers.
Clip and overlay selections are mutually exclusive.
A completed gesture commits against its original track snapshot; a stale preview cannot overwrite a newer edit.
Canceled and unchanged gestures add no history entry.
Moving a group preserves its relative timing and track offsets; invalid destinations are rejected.
Trimming changes the visible source interval while preserving hidden redaction metadata.

## User behavior

Shift-click and marquee select multiple clips; move, delete, mute and unmute act on the group.
Copy/cut/paste/duplicate shortcuts apply only in Audio focus and preserve native text editing.
Paste starts at the playhead subject to collision resolution; duplicate inserts after the selected span.
Insert mode chooses a safe seam and shifts later clips on affected destination tracks.
The default-on magnet toggle controls normal drag snapping; insertion still needs a valid seam.
Deleting leaves gaps.
Ripple delete and joining clips remain deferred.
