# Phase 3 — Timeline UI & Export: Design Spec

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Multi-track waveform UI, clip drag-to-reposition, per-track transcripts, export pipeline.

---

## 1. Context

Phases 0–2 delivered a fully working single-track editor with WaveSurfer waveform, clip-based
editing (split/mute/unmute/undo/redo), WebCodecs frame-accurate playback, multi-source audio
mixing, and Whisper transcript editing. The data model and store logic already support multiple
tracks and source files. Phase 3 builds the UI layer on top of that foundation and adds the
export pipeline.

**Explicitly out of scope:** Lanes (sub-rows within a track for multi-take comping). The
`Clip` schema can accommodate lanes later by adding `laneIndex: number` (additive, no migration).

---

## 2. Multi-Track Waveform UI

### Layout

Tracks stack vertically as horizontal lanes beneath a shared timeline ruler:

```
┌─ Timeline ruler ──────────────────────────────────────────────────┐
├─ Track header ─┬─ Clip lane ───────────────────────────────────────┤
│ Voice          │ [clip 1]  [clip 2]         [clip 3]               │
├────────────────┼───────────────────────────────────────────────────┤
│ Music          │ [────────────── clip ──────────────────]           │
├────────────────┼───────────────────────────────────────────────────┤
│ SFX            │         [clip]           [clip]                    │
├────────────────┴───────────────────────────────────────────────────┤
│ + Add Track                                                        │
└────────────────────────────────────────────────────────────────────┘
```

All tracks are the same height. No variable-height or collapsible tracks.

### Track Header (left column, fixed width ~90px)

Each track header contains:
- Editable track name
- Mute toggle (M)
- Solo toggle (S)
- Volume knob or slider
- Color swatch (matches waveform color)
- Remove button (×)

Dispatches to `timeline.store`: `updateTrack`, `removeTrack`.

### Clip Lane (right area)

Each clip is rendered as a positioned `<div>` block containing a waveform thumbnail.
The block's `left` and `width` are derived from `clip.outputStart` and
`clip.sourceEnd − clip.sourceStart`, mapped to pixels via the current zoom level.

Muted clips are rendered in red (consistent with current single-track behavior).
Split markers remain as absolutely-positioned 2px lines.

### Shared Playhead

A single vertical line spans all track lanes. Position driven by `playback.store.currentTime`.
Clicking anywhere on any track lane seeks the playhead.

### One WaveSurfer per Track

Each track gets its own WaveSurfer instance rendered inside its clip lane. Peaks are
loaded from the per-source `peaks.json` cache. WaveSurfer instances share the same
`onSeek` callback so seeking one seeks all.

### Add Track

A "+ Add Track" row at the bottom opens a file browser dialog. Selecting a file:
1. Calls `timeline.store.addSourceFile(filePath, duration)` (new method — see §5)
2. Calls `timeline.store.addTrack(name, sourceFileId)`
3. Triggers peak generation for the new source file
4. Registers the new source in the active `IAudioPlayer`

---

## 3. Clip Drag-to-Reposition

### Interaction

Pointer down on a clip block begins a drag. During drag:
- A ghost copy of the clip renders at the new position
- The original clip dims in place
- Snapping: if the dragged clip's leading or trailing edge is within 5px of another
  clip's edge, it snaps

On pointer up: `timeline.store.moveClip(clipId, newOutputStart)` is called.
`reflowOutputStarts` in the store pushes subsequent clips forward to prevent overlap.

Drag can optionally change tracks: if the pointer crosses into a different track's
lane, `newTrackId` is passed to `moveClip`.

Undo restores the original position and track (the store snapshots before every
`moveClip` call).

### splitAt Bug Fix (inline with drag implementation)

The current `splitAt` implementation sets `right.outputStart = time`, which is only
correct when `outputStart === sourceStart`. Once clips can be moved, this breaks.

**Fix:**
```typescript
// Before (wrong):
right.outputStart = time

// After (correct):
right.outputStart = targetClip.outputStart + (time - targetClip.sourceStart)
```

This fix is applied in the same PR as clip drag (step 3.4 in ROADMAP.md).

---

## 4. Per-Track Transcripts

### Data Model

`Word` gets a new field:
```typescript
// src/shared/project.types.ts
WordSchema = z.object({
  ...existing fields,
  trackId: z.string().optional(),  // undefined → primary track (backward compat)
})
```

Existing project files load without error. `trackId` defaults to `sourceFiles[0].id`
when undefined (applied on load in `handleOpenProject`).

`transcript.store` gains:
```typescript
activeTrackFilter: string | null   // null = all tracks merged
setActiveTrackFilter: (id: string | null) => void
```

`visibleWords` derivation (already exists in the component) changes from:
```typescript
const visibleWords = showMutedWords ? words : words.filter(w => !w.muted)
```
to:
```typescript
const visibleWords = words
  .filter(w => !activeTrackFilter || w.trackId === activeTrackFilter)
  .filter(w => showMutedWords || !w.muted)
```

### TranscriptPanel Header

A second row is added below the existing "Transcript / Sync to playhead / Hide deleted" row:

```
[ All ] [ ● Voice ] [ ● Music  + generate ] [ ● SFX + generate ]   [ ⚡ All tracks ]
```

- **All pill**: sets `activeTrackFilter = null`
- **Track pill**: sets `activeTrackFilter = track.id`
- **+ generate** (on pills with no transcript): triggers `handleGenerateTranscript(trackId)`
- **⚡ All tracks**: loops through all tracks sequentially, generating transcripts for any
  that don't have one yet

### Merged View

When `activeTrackFilter = null`, all tracks' words are shown interleaved sorted by
`startTime`. Words from the non-primary track are subtly dimmed (opacity 0.7) to
provide a visual distinction without cluttering the text.

### Delete-to-Mute Fix

`handleDeleteFromSelection` currently hardcodes `sourceFiles[0]?.id`:

```typescript
// Before (wrong for multi-track):
const sfId = sourceFiles[0]?.id
if (sfId) muteRange(sfId, start, end, wordIds)

// After (correct):
const sfId = selected[0]?.trackId ?? sourceFiles[0]?.id
if (sfId) muteRange(sfId, start, end, wordIds)
```

All other `TranscriptPanel` behavior is unchanged: `contentEditable`, click-to-seek,
active word highlight, auto-scroll, timestamp calibration.

### Generate Transcript (multi-track)

`handleGenerateTranscript` in `App.tsx` is extended to accept an optional `trackId`:

```typescript
const handleGenerateTranscript = useCallback(async (trackId?: string) => {
  const sf = trackId
    ? useTimelineStore.getState().sourceFiles.find(s => s.id === trackId)
    : sourceFiles[0]
  if (!sf) return
  // ... existing generate flow, but tag returned words with sf.id as trackId
  const transcript = await window.electronAPI.transcript.generate(sf.filePath)
  const taggedWords = transcript.words.map(w => ({ ...w, trackId: sf.id }))
  // merge into existing words[], replacing any previous words for this trackId
  setWords(mergeTrackWords(words, taggedWords, sf.id))
}, [...])
```

`mergeTrackWords(existing, incoming, trackId)` — pure function: removes existing words
with `trackId`, appends `incoming`, sorts by `startTime`.

---

## 5. New Store Methods

### `timeline.store.addSourceFile`

```typescript
addSourceFile(filePath: string, duration: number): string
// Creates a SourceFile, pushes to sourceFiles[], returns its id.
```

Required before `addTrack(name, sourceFileId)` can register a second audio file.
This is the gap identified in DEVLOG.md. Inline fix during step 3.6.

---

## 6. Export Pipeline

### IPC Handler

New `render.ipc.ts` registers `ipcMain.handle('project:export', handler)`.
Added to `IElectronAPI` in `ipc.types.ts`:

```typescript
render: {
  export(project: ProjectFile, outputPath: string): Promise<void>
  onProgress(cb: (p: RenderProgress) => void): () => void
}
```

### FFmpeg Filter Graph

`src/main/audio/renderer.ts` builds a filter graph from the clip timeline:

1. For each track, collect non-muted clips sorted by `outputStart`
2. Per clip: `[N:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[segN]`
3. Per track: `[seg0][seg1]...concat=n=X:v=0:a=1[trackN]`
4. Mix tracks: `[track0][track1]...amix=inputs=N:normalize=0[out]`

Loudness normalization (`loudnorm`) is deferred to Phase 4.

### Export Settings UI

Format selector (MP3 / WAV / AAC), output path picker, LUFS target input (shown
but normalization not applied until Phase 4). Appears as a modal or bottom sheet
triggered by an "Export" button in the transport bar.

### Progress Reporting

Parse FFmpeg `stderr` for `time=HH:MM:SS.ss`. Emit `render:progress` IPC events.
Renderer shows a progress bar in the export modal advancing to 100%.

---

## 7. File Changelist

| File | Change |
|------|--------|
| `src/shared/project.types.ts` | Add `trackId?: string` to `WordSchema` |
| `src/shared/ipc.types.ts` | Add `render` namespace |
| `src/renderer/src/stores/transcript.store.ts` | Add `activeTrackFilter`, `setActiveTrackFilter`, `mergeTrackWords` |
| `src/renderer/src/stores/timeline.store.ts` | Add `addSourceFile`; fix `splitAt` outputStart |
| `src/renderer/src/components/Transcript/TranscriptPanel.tsx` | Track filter pills header row; fix delete-to-mute routing |
| `src/renderer/src/components/Waveform/WaveformView.tsx` | Multi-track layout: one WaveSurfer per track, shared playhead |
| `src/renderer/src/components/Waveform/TrackHeader.tsx` | New component: name, mute, solo, volume, color, remove |
| `src/renderer/src/App.tsx` | Multi-track `handleGenerateTranscript`; handle new source file load |
| `src/main/audio/renderer.ts` | New file: FFmpeg filter graph + loudness stub |
| `src/main/ipc/render.ipc.ts` | New file: export IPC handler |
| `src/preload/index.ts` | Expose `render` namespace |

---

## 8. Out of Scope for Phase 3

- Loudness normalization (Phase 4)
- Per-clip gain / crossfade (Phase 4)
- Inspector panel (Phase 4)
- Lanes / multi-take comping (deferred indefinitely)
- Plugin system (Phase 6)
