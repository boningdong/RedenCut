# PodCut — Roadmap

Each step is scoped to be code-reviewable in a single PR. Steps within a phase
can overlap, but don't start a new phase until the previous phase's core steps
are complete.

---

## Phase 0 — Foundation ✅

**Step 0.1 — electron-vite scaffold** ✅

Set up the project with `electron-vite`, giving HMR in the renderer, proper
main/preload/renderer separation, and TypeScript out of the box.

PR scope: `npm run dev` launches the app. Three separate tsconfigs compile
without errors.

**Step 0.2 — TypeScript path aliases** ✅

`@main`, `@renderer`, `@shared` path aliases wired in both `tsconfig.json` and
`electron.vite.config.ts`.

PR scope: A test import in `App.tsx` from `@shared/project.types` resolves.

**Step 0.3 — Shared types** ✅

`project.types.ts` (Zod schemas + derived TypeScript types for `ProjectFile`,
`Clip`, `Track`, `Word`, `Edit`, `Adjustment`), `ipc.types.ts`,
`transcriber.types.ts`, `player.types.ts`, `constants.ts`.

PR scope: Types compile. A sample fixture JSON parses through the Zod schema
without errors.

**Step 0.4 — IPC bridge** ✅

Preload `contextBridge` exposes `window.electronAPI` typed against `IElectronAPI`.
`satisfies IElectronAPI` compile-time check in preload.

PR scope: `window.electronAPI` is accessible in the renderer and TypeScript
autocompletes all methods.

**Step 0.5 — Binary resolution** ✅

`src/main/audio/binaries.ts` resolves FFmpeg/FFprobe paths with Homebrew paths
taking priority over `ffmpeg-static` (x64-only, fails on Apple Silicon).
Actionable error thrown if binaries are missing.

PR scope: Opening an audio file on Apple Silicon does not crash. Error message
is human-readable when FFmpeg is absent.

**Step 0.6 — Test infrastructure** ✅

Vitest configured with `@shared`/`@renderer` path aliases. 77 unit tests across
`timeline.store` and `transcript.store`.

PR scope: `npm test` passes. `timeline.store` split/mute/unmute/undo/redo edge
cases covered. `transcript.store` word muting and timestamp shifting covered.

---

## Phase 1 — Core Playback & Editing ✅

**Step 1.1 — FFprobe audio metadata** ✅

`src/main/audio/importer.ts` extracts duration, sample rate, channels, codec,
and bitrate via FFprobe. Wired to `dialog.showOpenDialog` via `audio.ipc.ts`.

PR scope: User opens an MP3/WAV; console logs correct metadata.

**Step 1.2 — Peak generation + WaveSurfer** ✅

`src/main/audio/peaks.ts` generates peak data via FFmpeg raw PCM output, cached
as `{basename}.peaks.json`. `WaveformView.tsx` renders the waveform using peaks
(no raw audio decode in renderer), with muted region overlays (red) and split
markers (absolutely-positioned React divs).

PR scope: Waveform renders without OOM. Peaks file appears on disk. Muted
regions and split markers are visible and accurate after reopen.

**Step 1.3 — Zustand stores** ✅

Four stores: `timeline.store` (tracks, clips, undo/redo), `playback.store`
(playing, currentTime, duration), `transcript.store` (words, muting, timestamp
calibration), `editor.store` (selection, zoom, UI flags).

PR scope: Store actions fire correctly. Undo/redo works across split, mute, and
unmute. All 77 tests pass.

**Step 1.4 — WebCodecsPlayer (frame-accurate)** ✅

`AudioDecoder` + `AudioWorklet` pipeline. One decode loop + `GainNode` per
source file, all sharing a single `AudioContext` hardware clock. Pre-buffer
decode runs while paused so play is zero-latency. Muted clips produce silence
in the worklet FIFO (cursor advances at real speed). Handles large WAV files
(streaming header reads + RIFF chunk-size fallback) and large MP3 ID3 tags
(>256 KB second-chunk fetch).

PR scope: Play/pause/seek works frame-accurately for WAV and MP3. Muted clips
are silent (not skipped). No pitch shift.

**Step 1.5 — SimpleAudioPlayer (fallback)** ✅

`<audio>` element per source with `GainNode`. Automatically selected when
`WebCodecsPlayer` fails (unsupported codec, worklet registration failure).

PR scope: Fallback activates on an unsupported format. Playback behaves
identically to `WebCodecsPlayer` from the user's perspective.

**Step 1.6 — Multi-source mixing** ✅

Each source file gets its own decode loop, `GainNode`, `AudioDecoder`, and
`AbortController`. `play`/`pause`/`seekTo` broadcast to all registered sources
simultaneously. `buildSegments()` extracted as a pure, fully-tested function.

PR scope: Two source files play in sync. Seeking repositions both sources
correctly. 14 `buildSegments` tests pass.

**Step 1.7 — Core editing: split, mute, unmute** ✅

`splitAt`, `muteRange`, `unmuteClip` in `timeline.store`. Non-destructive —
source audio is never modified. Region drag-to-select on the waveform.

PR scope: User drags a region; mute turns it red. Split adds a marker. Unmute
removes the overlay. Waveform reflects store state after every mutation.

**Step 1.8 — Undo / Redo** ✅

`undoStack` + `redoStack` in `timeline.store`. Every new mutation clears the
redo stack. `Cmd+Z` / `Cmd+Shift+Z` wired in `useKeyboardShortcuts`.

PR scope: 10 undo steps work correctly. Redo re-applies in order. New mutation
after undo clears redo future. Transcript word mute state reverses correctly.

**Step 1.9 — Keyboard shortcuts** ✅

Space (play/pause), S (split), M (mute), U (unmute), Delete/Backspace (mute +
strikethrough), Cmd+Z/Cmd+Shift+Z (undo/redo), Cmd+S (save), Escape (clear
selection), ←/→ (nudge 1 s), Shift+←/→ (nudge 5 s).

PR scope: All shortcuts documented in `CLAUDE.md` fire their actions.

**Step 1.10 — Project save / load** ✅

`project.ipc.ts` handles open/save/save-as. `.podcut` JSON format (versioned).
Legacy flat `edits[]` format auto-migrated on load. `podcut://` custom protocol
serves audio to the renderer (Chromium blocks `file://`).

PR scope: Open a project, make an edit, save, reopen — edit is present. Legacy
project file loads without error.

---

## Phase 2 — Transcript Integration ✅

**Step 2.1 — Whisper.cpp transcription** ✅

`src/main/transcriber/whisper.ts` implements `ITranscriber`. Leading silence
detected before transcription to improve word timestamp accuracy. Progress
streamed to renderer via `transcript.ipc.ts`.

PR scope: Trigger transcription from the UI; progress bar advances; transcript
arrives with word-level timestamps.

**Step 2.2 — Word-level muting** ✅

Selecting and deleting text in the transcript mutes the corresponding audio
region and adds strikethrough styling. Muting/unmuting in the waveform reflects
in the transcript and vice versa.

PR scope: Select 3 words, press Delete — words strikethrough, waveform region
turns red, playback skips the section.

**Step 2.3 — Transcript panel** ✅

`TranscriptPanel.tsx` renders each `Word` as a `<span>`. Active word highlighted
during playback via binary search on `word.start`/`word.end`. Auto-scroll keeps
active word visible. Click-to-seek repositions playhead.

PR scope: Play audio; active word highlights; transcript auto-scrolls. Clicking
a word seeks the audio without auto-playing.

**Step 2.4 — Timestamp calibration** ✅

Shift all word timestamps by a fixed offset (align to playhead). Clamps to 0.
`shiftTimestamps` covered in `transcript.store` tests.

PR scope: Apply shift; words reposition on waveform and in transcript.

**Step 2.5 — Show / hide muted words toggle** ✅

Toggle between strikethrough display and hiding muted words entirely.

PR scope: Toggle hides muted words; toggle again restores them.

**Step 2.6 — Preview mode** ✅

Handled in `WaveformView.onTimeUpdate`: if preview mode is on and the playhead
enters a muted clip, `seekTo(clipEnd)` is called. Neither player implements
preview logic internally, keeping `IAudioPlayer` clean.

PR scope: Enable preview mode; muted regions are silently skipped. Disable
preview mode; audio plays through muted regions.

---

## Phase 3 — Timeline UI & Export

**Step 3.1 — Fix `splitAt` outputStart for moved clips**

`right.outputStart = time` in `timeline.store` is only correct when
`outputStart === sourceStart`. Once clips are moved this silently produces wrong
positions. Fix: `right.outputStart = clip.outputStart + (time - clip.sourceStart)`.
See DEVLOG.md § Phase 3.

PR scope: Unit test: split a clip that has been moved → right clip's
`outputStart` is correct. All 77 existing tests still pass.

**Step 3.2 — `addSourceFile` in `timeline.store`**

`addTrack(name, sourceFileId)` accepts a `sourceFileId` but never registers a
new entry in `sourceFiles[]`. Add `addSourceFile(filePath, duration): string`
that pushes a new `SourceFile` and returns its id. See DEVLOG.md § Phase 3.

PR scope: Call `addSourceFile`, then `addTrack(name, id)` — `sourceFiles` array
has two entries. `loadFromProject` round-trip preserves both.

**Step 3.3 — Multi-track waveform display**

Render one WaveSurfer instance per track, stacked vertically. Each track shows
its own peaks, muted regions, and split markers. Tracks share a single playhead
that is kept in sync.

PR scope: Open a two-track project. Both waveforms render with correct peaks.
Clicking either waveform seeks both tracks simultaneously.

**Step 3.4 — Clip drag-to-reposition**

Pointer drag on a clip block calls `moveClip(clipId, newOutputStart)`.
Show a ghost/preview during drag. Snap to clip boundaries at ±5 px.

PR scope: Drag a clip left or right. It lands at the correct `outputStart`.
Clips after it reflow without overlapping. Undo restores original position.

**Step 3.5 — Track header controls**

Per-track sidebar: editable name, mute toggle, solo toggle, volume knob, color
swatch, remove button. Dispatches to `updateTrack` / `removeTrack`.

PR scope: Mute a track — its waveform dims and audio is silent. Solo a track —
all other tracks go silent. Remove a track — it disappears from both UI and
store. Changes persist after save/reopen.

**Step 3.6 — Add track via file drop / browse**

Drag an audio file onto the timeline or click "Add Track". Calls `addSourceFile`
+ `addTrack`, triggers peak generation, registers the source in the player.

PR scope: Drop a second audio file. A new track appears with its waveform. Both
tracks play in sync. Project saves and reloads with two tracks intact.

**Step 3.7 — `Word.trackId` + `transcript.store` track filter**

Add `trackId: string` to the `Word` Zod schema (with a sensible default for
backward compatibility with existing project files). Add `activeTrackFilter:
string | null` to `transcript.store` (null = all tracks merged). Update
`visibleWords` derivation to filter by trackId when a filter is active.
Update `handleDeleteFromSelection` in `TranscriptPanel` to route
`muteRange` through `word.trackId` instead of the hardcoded `sourceFiles[0]`.

PR scope: Open a legacy project — words load with `trackId` defaulting to the
primary track. `activeTrackFilter` set to a trackId → only that track's words
are visible. Delete-to-mute on a filtered word mutes the correct track.

**Step 3.8 — Per-track transcript generation + "Transcribe all"**

Extend `handleGenerateTranscript` in `App.tsx` to accept an optional `trackId`.
When provided, it generates for that track's source file and tags the resulting
words with that `trackId`. Add a "⚡ All tracks" button that loops through
every track sequentially.

PR scope: Two-track project. Generate transcript for Track 2 only — Track 1
words unaffected. "Transcribe all" generates for both tracks; merged view shows
words from both interleaved by `startTime`.

**Step 3.9 — Track filter pills in `TranscriptPanel` header**

Add a second header row with pill buttons: "All" + one pill per track (track
color dot + name). Selecting a pill sets `activeTrackFilter`. Tracks without a
transcript show a small "+ generate" affordance on their pill.

PR scope: Click Voice pill — only voice words visible. Click Music pill — only
music words visible. Click All — all words merged. Generating from a pill's
"+ generate" produces words for that track only.

**Step 3.11 — IPC handler for export**

Register `ipcMain.handle('project:export')` in a new `render.ipc.ts`. Accept
`{ project: ProjectFile, outputPath: string }`. Wire `window.electronAPI.render.export`
in the preload and add the channel to `ipc.types.ts`.

PR scope: Handler reachable from renderer. Calling it with a valid project does
not throw.

**Step 3.12 — FFmpeg filter graph from clip timeline**

In `src/main/audio/renderer.ts`, read the ordered clip list from all tracks,
build an FFmpeg filter graph using `atrim` + `asetpts` per active (non-muted)
segment per track, mix tracks with `amix`, then `concat` segments.

PR scope: Export a file with two muted regions. Output duration equals
(total − muted) ± 0.1 s. No audio from muted regions audible in output.

**Step 3.13 — Export settings UI**

Format selector (MP3 / WAV / AAC), output path picker, LUFS target input,
true peak ceiling input. Defaults: MP3, −16 LUFS, −1.5 dBTP.

PR scope: User selects WAV, picks output path, clicks Export — correct file
type appears at the chosen location.

**Step 3.14 — Progress reporting**

Parse FFmpeg `stderr` for `time=HH:MM:SS.ss` lines. Emit
`render:progress { percent, elapsed, total }` per line via IPC. Renderer shows
a progress bar that advances smoothly to 100 %.

PR scope: Export a 10-minute file. Progress bar advances. Completion event
fires. An export error surfaces a human-readable message (not a raw FFmpeg log).

---

## Phase 4 — Audio Polish

**Step 4.1 — Loudness normalization**

Two-pass `loudnorm`: first pass measures `input_i`, `input_tp`, `input_lra`,
`input_thresh`; second pass applies linear normalization targeting
`project.export.targetLUFS` (default −16 LUFS) and `truePeakDbTP` (default
−1.5 dBTP).

PR scope: Export an untreated recording. Measure output with
`ffmpeg -af ebur128`. Integrated loudness within ±0.5 LUFS of target.

**Step 4.2 — Per-clip gain in export**

Apply `volume=` filter per segment in the FFmpeg filter graph when a clip has a
non-zero `gain` value. `Clip.gain` field already exists in `project.types.ts`.

PR scope: Set 2× gain on one clip, export. That clip's RMS is measurably louder
than the rest.

**Step 4.3 — Crossfade at clip boundaries (export)**

At each cut boundary, overlap the outgoing and incoming segments by the
configured crossfade duration (default 30 ms) using
`acrossfade=d=0.03:c1=exp:c2=exp`.

PR scope: Export a clip with a muted section removed. Play through the cut —
no audible click at the transition.

**Step 4.4 — Gain + crossfade preview in WebCodecsPlayer**

Apply `GainNode.gain.setValueAtTime()` per clip during playback. Ramp gain at
boundaries to approximate the export crossfade. This is a preview
approximation, not sample-identical to the FFmpeg output.

PR scope: Scrub through a gain-adjusted region — volume changes match export
expectation. Transition through a cut has no audible click.

**Step 4.5 — Inspector panel**

Context-sensitive panel that appears when a clip is selected. Shows: clip label
(editable), gain slider (−18 dB to +18 dB), crossfade duration (0–200 ms),
clip start/end times (read-only). Dispatches mutations to `timeline.store`.

PR scope: Select a clip; Inspector appears. Change gain; value persists in
store. Deselect; Inspector collapses. Values survive save/reopen.

---

## Phase 5 — Intelligence

**Step 5.1 — Filler word detection**

Pure function `detectFillers(words: Word[]): Edit[]` matching a configurable
regex (`um`, `uh`, `like`, `you know`, etc.). Result previewed as suggested
(dimmed) regions before the user confirms.

PR scope: Run detection on a transcript. Filler words highlighted. User can
accept all, reject all, or toggle individual suggestions before applying.

**Step 5.2 — Speaker diarization pipeline**

Populate `Word.speaker` by running a diarization model after transcription.
`Word.speaker` field already exists in the schema; this step fills it.

PR scope: Transcribe a two-speaker file. Each word has a `speaker` value.
Transcript panel renders speaker labels as colored badges.

**Step 5.3 — Per-speaker labeling UI**

Editable speaker name labels in the transcript panel. Clicking a speaker badge
allows renaming. `project.transcript.speakers` map updated accordingly.

PR scope: Rename "Speaker A" to "Host". All words tagged to that speaker
reflect the new label. Label persists after save/reopen.

---

## Phase 6 — Plugin System

**Step 6.1 — `RenderPipeline` staged refactor**

Extract export logic into named `PipelineStage` classes (`EditStage`,
`GainStage`, `CrossfadeStage`, `NormalizeStage`). `RenderPipeline` executes
them sequentially. Existing export behavior is identical — refactor only.

PR scope: Export produces byte-identical output. Unit tests for each stage with
a short test clip.

**Step 6.2 — `PluginHost` + manifest loading**

`src/main/plugins/host.ts` discovers plugins from `~/.podcut/plugins/`,
validates `plugin.json` manifests against a Zod schema, and `require()`s each
plugin's entry point. `plugins.ipc.ts` exposes `getContributions()`.

PR scope: A minimal plugin (`plugin.json` + empty `index.js`) loads without
error. `getContributions()` returns its manifest data.

**Step 6.3 — `IPluginContext` + project/storage API**

`context-factory.ts` produces a scoped `IPluginContext` per plugin: sandboxed
project read/write, plugin-scoped storage under `app.getPath('userData')`.
Plugins cannot call `ipcMain` directly or spawn arbitrary processes.

PR scope: A test plugin calls `ctx.project.addEdits([...])` on activation —
edit appears in the store. `ctx.storage.set('k', 'v')` persists to disk.

**Step 6.4 — Command palette**

`Cmd+K` opens a `cmdk`-based palette. Core commands (Open File, Export, Undo,
Redo) registered at startup. Plugin-contributed commands from
`getContributions()` added dynamically.

PR scope: `Cmd+K` opens palette. All core commands execute correctly. A test
plugin's command appears and runs.

**Step 6.5 — First-party filler-detector plugin**

Move filler word detection (Step 5.1) from core into
`plugins/filler-detector/`. Contributes: one command, one panel, one
`editDetector` hook. Uses only the public `IPluginContext` API.

PR scope: Remove filler detection from core. Install the plugin. All existing
filler detection tests pass via the plugin path.

---

## Known Issues

| Issue | Root Cause | Fix Approach |
|-------|-----------|--------------|
| Preview-mode brief silence at muted-region skip | `seekTo()` flushes worklet queue; ~100–200 ms gap before new audio arrives | Lookahead: pre-buffer audio after the next muted region before reaching it |

---

## Architecture Notes

**Player selection** — `WebCodecsPlayer` is preferred; `SimpleAudioPlayer` is
the fallback. `App.tsx` tries `WebCodecsPlayer` first and catches any error to
fall back.

**Worklet FIFO alignment** — The worklet is a pure FIFO with no timestamp
awareness. Muted segments must produce silence (not gaps) to keep the queue
time-aligned with the hardware clock.

**AudioContext sample rate** — Always created at the file's native sample rate
(`new AudioContext({ sampleRate })`). Mismatch causes pitch shift because the
worklet does no resampling.

**Worklet processor lifetime** — `process()` always returns `true`. Returning
`false` permanently terminates the processor — dangerous for short files that
get fully pre-buffered while paused.

**Preview mode skip** — Handled entirely in `WaveformView.onTimeUpdate`.
Neither player implements preview logic internally, keeping `IAudioPlayer`
clean and consistent.

**IPC boundary** — All Node.js / OS access goes through `src/main/`. Renderer
only calls `window.electronAPI`. Never use `ipcRenderer` directly in the
renderer. Contract lives in `src/shared/ipc.types.ts`.

**`primarySourceId` / `sourceId`** — `sourceId` is a stable key in the
`sources` Map, set to `filePath` in `App.tsx`. `primarySourceId` is the first
registered source. Multi-source playback iterates all registered sources and
merges segments per-source.
