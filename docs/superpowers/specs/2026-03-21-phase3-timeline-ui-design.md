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
- Mute toggle (click-only, no keyboard shortcut — avoids conflict with S = Split)
- Solo toggle (click-only, no keyboard shortcut — avoids conflict with S = Split)
- Volume knob or slider
- Color swatch (matches waveform color)
- Remove button (×)

Dispatches to `timeline.store`: `updateTrack`, `removeTrack`.

**Keyboard conflict note:** The existing S shortcut means "Split at playhead" globally.
Mute and Solo are click-only affordances in the track header — no keyboard shortcut assigned.

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

### Add Track — Peak Generation for New Sources

A "+ Add Track" row at the bottom opens a file browser dialog. Selecting a file:
1. Calls `timeline.store.addSourceFile(filePath, duration)` (new method — see §5)
2. Calls `timeline.store.addTrack(name, sourceFileId)`
3. Generates peaks for the new source file via `window.electronAPI.audio.generatePeaks(filePath)`
4. Registers the new source in the active `IAudioPlayer`

Peak generation for secondary tracks is handled with **per-track loading state** stored
in a local `Map<trackId, 'loading' | PeakData>` inside the multi-track waveform component
(not in the global `loadingState` which controls the full-page skeleton). While peaks are
loading for a secondary track, that track's lane shows a small inline progress indicator.
Once peaks arrive, the WaveSurfer instance for that track initialises.

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

`time` passed to `splitAt` is an **output-timeline position** (the playhead). Once clips
have been moved, `outputStart !== sourceStart`, so three things need fixing:

**1. The clip search** must use output coordinates, not source coordinates:
```typescript
// Before (breaks after moveClip):
const clip = track.clips.find(c => time > c.sourceStart && time < c.sourceEnd)

// After (correct):
const clip = track.clips.find(c =>
  time > c.outputStart && time < c.outputStart + (c.sourceEnd - c.sourceStart)
)
```

**2. The left clip** — `sourceEnd` must map `time` back to source coordinates:
```typescript
const left: Clip = {
  ...targetClip,
  id: nextId('clip'),
  sourceEnd: targetClip.sourceStart + (time - targetClip.outputStart),
  // outputStart unchanged
}
```

**3. The right clip** — `sourceStart` and `outputStart` both need updating:
```typescript
const right: Clip = {
  ...targetClip,
  id: nextId('clip'),
  sourceStart: targetClip.sourceStart + (time - targetClip.outputStart),
  outputStart: time,
}
```

This fix is applied in the same PR as clip drag (ROADMAP step 3.4).

---

## 4. Per-Track Transcripts

### Data Model

`Word` gets a new field:
```typescript
// src/shared/project.types.ts
WordSchema = z.object({
  ...existing fields,
  sourceFileId: z.string().optional(),  // undefined → primary source file (backward compat)
})
```

The field is named `sourceFileId` (not `trackId`) because it stores the `SourceFile.id`
of the audio file the word came from. One source file maps to one track in Phase 3, so
filtering by `sourceFileId` is equivalent to filtering by track.

Existing project files load without error. When loading a project, any word with
`sourceFileId === undefined` is backfilled to `sourceFiles[0].id` in `handleOpenProject`
before being written to `transcript.store`.

`transcript.store` gains:
```typescript
activeTrackFilter: string | null   // null = all tracks merged; non-null = a sourceFileId
setActiveTrackFilter: (sourceFileId: string | null) => void
```

`visibleWords` derivation (already exists in `TranscriptPanel`) changes from:
```typescript
const visibleWords = showMutedWords ? words : words.filter(w => !w.muted)
```
to:
```typescript
const visibleWords = words
  .filter(w => !activeTrackFilter || w.sourceFileId === activeTrackFilter)
  .filter(w => showMutedWords || !w.muted)
```

### Merged View Word Opacity

When `activeTrackFilter = null`, all tracks' words are shown interleaved sorted by
`word.start`. Words whose `sourceFileId` is not `sourceFiles[0].id` are dimmed to `opacity: 0.6`.

Words that are both muted **and** from a non-primary track use `opacity: 0.45`
(the existing muted opacity takes precedence — it is the stronger visual signal).

### TranscriptPanel Header

A second row is added below the existing "Transcript / Sync to playhead / Hide deleted" row:

```
[ All ] [ ● Voice ] [ ● Music  + generate ] [ ● SFX + generate ]   [ ⚡ All tracks ]
```

- **All pill**: sets `activeTrackFilter = null`
- **Track pill**: sets `activeTrackFilter = track.clips[0].sourceFileId` (the sourceFileId for that track)
- **+ generate** (on pills with no transcript): triggers `handleGenerateTranscript(trackId)`
- **⚡ All tracks**: loops through all tracks sequentially, generating transcripts for any
  that don't have one yet

### Delete-to-Mute Fix

`handleDeleteFromSelection` currently hardcodes `sourceFiles[0]?.id`. Since `muteRange`
takes a `sourceFileId`, and `Word.sourceFileId` stores exactly that value, this is a
direct substitution:

```typescript
// Before (wrong for multi-track):
const sfId = sourceFiles[0]?.id
if (sfId) muteRange(sfId, start, end, wordIds)

// After (correct):
const sfId = selected[0]?.sourceFileId ?? sourceFiles[0]?.id
if (sfId) muteRange(sfId, start, end, wordIds)
```

All other `TranscriptPanel` behavior is unchanged: `contentEditable`, click-to-seek,
active word highlight, auto-scroll, timestamp calibration.

### Generate Transcript (multi-track)

`handleGenerateTranscript` in `App.tsx` is extended to accept an optional `trackId`.
The parameter is a **track id** (not a source file id); the function resolves the
source file via a two-step lookup. `words` is read from the store directly (not from
the closed-over React state) to avoid a stale closure:

```typescript
const handleGenerateTranscript = useCallback(async (trackId?: string) => {
  const { tracks, sourceFiles } = useTimelineStore.getState()

  // Two-step: track id → sourceFileId → SourceFile
  let sf: SourceFile | undefined
  if (trackId) {
    const track = tracks.find(t => t.id === trackId)
    const sourceFileId = track?.clips[0]?.sourceFileId
    sf = sourceFiles.find(s => s.id === sourceFileId)
  } else {
    sf = sourceFiles[0]
  }
  if (!sf) return

  // ... existing generate flow (setIsGenerating, setGeneratingStatus, try/catch) ...
  const transcript = await window.electronAPI.transcript.generate(sf.filePath)
  const taggedWords = transcript.words.map(w => ({ ...w, sourceFileId: sf!.id }))

  // Read current words from store (not from closed-over state) to avoid stale closure
  const currentWords = useTranscriptStore.getState().words
  setWords(mergeTrackWords(currentWords, taggedWords, sf.id))
  setIsDirty(true)   // mark project dirty — must remain explicit here
}, [setWords, setIsGenerating, setGeneratingStatus, setIsDirty, handleError])
```

### `mergeTrackWords` utility

A pure function — lives in `src/renderer/src/utils/transcript.ts`, not in the store.
**Precondition:** all existing words must have been backfilled with a `sourceFileId` before
this is called (done in `handleOpenProject` for loaded projects, and guaranteed for
newly generated words). Words with `sourceFileId === undefined` are treated as belonging to
the primary source file and are **not** removed by this function.

```typescript
export function mergeTrackWords(
  existing: Word[],
  incoming: Word[],
  sourceFileId: string,
): Word[] {
  return [
    ...existing.filter(w => w.sourceFileId !== sourceFileId),
    ...incoming,
  ].sort((a, b) => a.start - b.start)
}
```

---

## 5. New Store Methods

### `timeline.store.addSourceFile`

```typescript
addSourceFile(filePath: string, duration: number): string
// If a SourceFile with this filePath already exists, returns its existing id
// without creating a duplicate (idempotent — safe to call twice with the same path).
// Otherwise creates { id: filePath, filePath, duration }, pushes to sourceFiles[],
// and returns the new id.
// NOTE: id is set to filePath — this matches the convention in initFromFile and is
// what makes the idempotency guard above work correctly. Do not use a random id here.
// Not pushed to undoStack — source file registration is not undoable.
// Removing a track (removeTrack) does not remove its SourceFile, since
// another track might reference the same file.
```

This resolves the gap tracked in DEVLOG.md § Phase 3.

---

## 6. Export Pipeline

### `RenderProgress` type

Defined in `src/shared/ipc.types.ts` alongside the `render` namespace:

```typescript
export interface RenderProgress {
  /** 0–1 */
  percent: number
  /** Seconds of output rendered so far */
  currentSeconds: number
  /** Total output duration in seconds */
  totalSeconds: number
}
```

### IPC Handler

New `src/main/ipc/render.ipc.ts` registers `ipcMain.handle('project:export', handler)`.
Added to `IElectronAPI` in `ipc.types.ts`:

```typescript
render: {
  export(project: ProjectFile, outputPath: string): Promise<void>
}
```

`onProgress` follows the existing push-subscription pattern in the `on` namespace
(alongside `peaksProgress`, `transcriptProgress`):

```typescript
on: {
  // ... existing subscriptions ...
  renderProgress(callback: (p: RenderProgress) => void): () => void
}
```

### FFmpeg Filter Graph

`src/main/audio/renderer.ts` builds a filter graph from the clip timeline.

**Gap behavior:** Muted clips are **excluded** from the output — their time is removed,
not replaced with silence. The output is a contiguous audio stream. This matches the
preview mode behavior (muted regions are skipped, not silenced).

Filter graph construction:

1. For each track, collect **non-muted** clips sorted by `outputStart`. Skip tracks
   with zero non-muted clips entirely — they contribute nothing to the output.
   Let `T` = number of active tracks after this filter.
2. Per clip: `[SRC:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[segI]`
   where `SRC` = FFmpeg input index for the clip's source file, `S = clip.sourceStart`,
   `E = clip.sourceEnd`, `I` = running global clip index (0 … totalClips−1).
   `clip.gain` is **not** applied in Phase 3 — per-clip gain is deferred to Phase 4.
3. Per active track (index `T_i`): `[segA][segB]...concat=n=K:v=0:a=1[trackT_i]`
   where `K` = number of non-muted clips in this track.
4. Mix all active tracks: `[track0][track1]...amix=inputs=T:normalize=0[out]`
   reusing `T` from step 1.

Loudness normalization (`loudnorm`) is deferred to Phase 4.

### Export Settings UI

Format selector (MP3 / WAV / AAC), output path picker, LUFS target input (shown
but normalization not applied until Phase 4). Appears as a modal triggered by an
"Export" button in the transport bar.

### Progress Reporting

Parse FFmpeg `stderr` for `time=HH:MM:SS.ss`. Emit `render:progress` IPC events
containing `RenderProgress`. Renderer shows a progress bar in the export modal
advancing to 100%.

---

## 7. File Changelist

| File | Change |
|------|--------|
| `src/shared/project.types.ts` | Add `sourceFileId?: string` to `WordSchema` |
| `src/shared/ipc.types.ts` | Add `render` namespace; add `renderProgress` to `on` namespace; add `RenderProgress` type |
| `src/renderer/src/stores/transcript.store.ts` | Add `activeTrackFilter`, `setActiveTrackFilter` |
| `src/renderer/src/stores/timeline.store.ts` | Add `addSourceFile`; fix `splitAt` output-coordinate search and source-coordinate mapping |
| `src/renderer/src/utils/transcript.ts` | New file: `mergeTrackWords` pure utility |
| `src/renderer/src/components/Transcript/TranscriptPanel.tsx` | Track filter pills header row; fix delete-to-mute routing; `onGenerate` prop becomes `(trackId?: string) => void` |
| `src/renderer/src/components/Waveform/WaveformView.tsx` | Multi-track layout: one WaveSurfer per track, shared playhead |
| `src/renderer/src/components/Waveform/TrackHeader.tsx` | New component: name, mute, solo, volume, color, remove |
| `src/renderer/src/App.tsx` | Multi-track `handleGenerateTranscript`; handle new source file load; backfill `word.sourceFileId` in `handleOpenProject` for legacy projects |
| `src/main/audio/renderer.ts` | New file: FFmpeg filter graph builder |
| `src/main/ipc/render.ipc.ts` | New file: export IPC handler + progress events |
| `src/preload/index.ts` | Expose `render.export` and wire `on.renderProgress` subscription |

---

## 8. Out of Scope for Phase 3

- Loudness normalization (Phase 4)
- Per-clip gain / crossfade (Phase 4)
- Inspector panel (Phase 4)
- Lanes / multi-take comping (deferred indefinitely)
- Plugin system (Phase 6)
