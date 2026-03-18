# PodCut — Project Roadmap

## What's Working (Stable)

### Core Editing
- Non-destructive clip model: `split`, `mute`, `unmute`, full undo stack
- Waveform display via WaveSurfer v7 (peaks-only, no media element)
  - Muted region overlays (red) seed correctly after reopen via `ws.on('ready', ...)`
  - Split markers rendered as absolutely-positioned React divs (reliable 2px lines)
- Drag-to-select region, keyboard shortcuts (Space, S, M, U, Delete, ←/→, Shift+←/→, Cmd+S, Cmd+Z)

### Playback
- **SimpleAudioPlayer** — `<audio>` element + gain nodes per clip, always available as fallback
- **WebCodecsPlayer** — AudioDecoder + AudioWorklet, frame-accurate; used when codec is supported
  - AudioContext created at the file's native sample rate (no pitch shift)
  - Pre-buffer decode loop runs while paused → zero latency on play
  - Clock sync via worklet `'started'` event so playhead doesn't jump during pre-buffer gap
  - Muted clips produce silence in the worklet FIFO (cursor advances at real speed, no audio)
  - Preview mode skip handled by WaveformView's `onTimeUpdate` callback (same as SimpleAudioPlayer)
  - Large WAV files: streaming header reads + RIFF chunk-size fallback for `totalBytes`
  - Large MP3 ID3 tags (>256 KB): second-chunk fetch after tag end, `buildUniformIndex` fallback

### Transcript
- Local Whisper.cpp transcription via `ITranscriber` / `WhisperTranscriber`
- Word-level muting (delete words → mutes corresponding audio region + strikethrough)
- Timestamp calibration (shift timestamps, sync to playhead)
- Show/hide muted words toggle
- Spacebar in transcript panel plays/pauses audio

### Project I/O
- Save/load `.podcut` project files (versioned JSON)
- Backward-compatible with legacy flat `edits[]` format (auto-migrated on load)
- FFprobe metadata (duration, sample rate, channels, codec, bitrate)
- Peak cache (`.peaks.json`) regenerated if missing

---

## Known Issues (Not Yet Fixed)

| Issue | Root Cause | Fix Approach |
|-------|-----------|--------------|
| Preview-mode glitch (brief silence at muted-region skip) | `seekTo()` flushes worklet queue and restarts decode loop; ~100–200ms gap before new audio arrives | Lookahead: pre-buffer audio *after* the next muted region before reaching it, so the skip lands on warm data |

---

## Features Remaining

### P1 — Export Pipeline (most critical)
The editor produces no output without this. All the pieces are ready:
- `ExportSettings` type exists (`targetLUFS`, `truePeakDbTP`, `format`, `sampleRate`)
- `buildProject()` in App.tsx already serializes the full edit timeline
- FFmpeg is resolved in `src/main/audio/binaries.ts`

**What to build:**
1. IPC handler `project:export(project, outputPath)` in main process
2. FFmpeg filter graph from clip timeline: `concat` segments, `volume=0` for muted clips
3. Loudness normalization pass: `ffmpeg -af loudnorm=I=-16:TP=-1.5:LRA=11`
4. Export settings UI (output path, format, LUFS target)
5. Progress reporting back to renderer via IPC events

### P2 — Redo
`Cmd+Shift+Z` is listed in CLAUDE.md keyboard shortcuts but only undo is implemented in `timeline.store`. `undoStack` exists; needs a parallel `redoStack` that is populated on undo and cleared on any new mutation.

### P3 — Gain Adjustments & Crossfades
`Adjustment` schema (`gain`, `crossfade`) exists in `project.types.ts` but is never applied. These are primarily export-time concerns — the FFmpeg filter graph would apply per-clip gain and crossfade filters. Preview playback of gain changes is a nice-to-have but not required for v1 export.

### P4 — Multi-Track Mixing
The data model fully supports multiple tracks and source files. The player only follows `primarySourceId`. Needed for:
- Background music + voice
- Adding sound effects

**Player changes needed:** per-source decode loops, mix step in the worklet (or separate `GainNode` per source in the Web Audio graph).

### P5 — Plugin System
Architecture is present (`editSource: 'plugin'`, `pluginData` in `project.types.ts`). No loading mechanism exists. Defer until the core feature set is stable.

### P6 — Diarization / Speaker Labels
`Word.speaker` field exists, never populated. Needs either Whisper diarization model support or a separate pipeline (e.g., pyannote.audio via IPC).

---

## Testing Plan

No test infrastructure exists today. Proposed setup: **Vitest** (integrates naturally with electron-vite).

### Tier 1 — Write alongside Export (high value, low friction)
These are pure state/logic with no browser or Electron dependencies:
- `timeline.store`: split, mute, unmute, undo, clip ordering edge cases
- `transcript.store`: word muting, timestamp shifting
- Project serialization roundtrip: `buildProject()` → save → `loadFromProject()`, including legacy `edits[]` migration
- Export filter graph builder: given a known clip timeline, assert the correct FFmpeg arguments

### Tier 2 — After player stabilizes
- `WebCodecsPlayer` + `SimpleAudioPlayer` conformance to `IAudioPlayer` interface
  (requires mocking `AudioContext`, `AudioDecoder`, `AudioWorkletNode`)

### Tier 3 — After export ships
- Playwright E2E against the actual Electron window for the critical path:
  open file → edit → export → verify output file exists and has correct duration

---

## Architecture Notes & Decisions

### Player selection
`WebCodecsPlayer` is preferred; `SimpleAudioPlayer` is the fallback. App.tsx tries WebCodecsPlayer first and catches any error (unsupported codec, worklet failure) to fall back.

### `primarySourceId` / `sourceId`
`sourceId` is a stable key in the `sources` Map. Today `App.tsx` sets it to `filePath`. `primarySourceId` is the first registered source — `buildSegments()` only processes clips from it. Multi-source support requires iterating all sources and merging segments per-source.

### Worklet FIFO alignment
The worklet is a pure FIFO — it has no timestamp awareness. Muted segments must produce silence chunks (not be skipped) to keep the queue time-aligned with the hardware clock.

### AudioContext sample rate
Always created at the file's native sample rate (`new AudioContext({ sampleRate })`). Mismatch = pitch shift because the worklet does no resampling.

### Worklet processor lifetime
`process()` always returns `true` to keep the processor alive for replays. Returning `false` permanently terminates the processor on the audio thread — dangerous for short files that get fully pre-buffered while paused.

### Preview mode skip
Handled entirely in `WaveformView.onTimeUpdate`: if `previewMode && playhead is inside a muted clip → seekTo(clipEnd)`. Neither player implements preview logic internally. This keeps the IAudioPlayer interface clean and consistent.

### IPC boundary
All Node.js / OS access goes through `src/main/`. Renderer only calls `window.electronAPI` (typed, from preload). Never use `ipcRenderer` directly in renderer. IPC contract lives in `src/shared/ipc.types.ts`.
