# PodCut — Technical Architecture Roadmap

*Principal Engineering Design Document — March 2026*
*Stack: Electron · React · TypeScript · Web Audio API · FFmpeg · whisper.cpp (N-API)*

---

## Answers Baked Into This Design

| Question | Your Answer | Architectural Impact |
|---|---|---|
| Platform | macOS first, Windows later | Cross-platform from day one; flag Windows divergences |
| File scale | 30 min – 2 hrs, up to 1 GB | Peak pre-caching required; never fully decode audio |
| STT | Local whisper.cpp via N-API | Native addon build toolchain; no API keys |
| Dockable UI | Fixed layout now, dockable later | Isolate layout config; use `react-mosaic` later |
| Project format | JSON, keep migration path open | `ProjectStore` abstraction wraps all I/O |
| Audio processing | Cut/mute/gain/crossfade/normalise | FFmpeg is sufficient; no custom DSP |
| N-API comfort | Willing to learn | Full N-API scaffold included |

---

## 1. Core Architecture Principle: Strict Process Boundary

Electron runs two distinct JavaScript environments and you must internalize this immediately.

```
┌─────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS  (Node.js — full OS access)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ AudioEngine  │  │ ProjectStore │  │ TranscriptionService │  │
│  │ (FFmpeg,     │  │ (JSON/future │  │ (whisper.cpp N-API   │  │
│  │  peaks gen)  │  │  SQLite)     │  │  addon)              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         └─────────────────┴──────────────────────┘             │
│                           │ IPC Bridge (contextBridge)          │
└───────────────────────────┼─────────────────────────────────────┘
                            │  Typed IPC channels (ipcMain/ipcRenderer)
┌───────────────────────────┼─────────────────────────────────────┐
│  RENDERER PROCESS  (Chromium — sandboxed, no Node access)       │
│                           │                                     │
│  ┌──────────────┐  ┌──────┴───────┐  ┌──────────────────────┐  │
│  │ WaveformView │  │ Zustand      │  │ TranscriptEditor     │  │
│  │ (wavesurfer  │  │ (project,    │  │ (React, word spans,  │  │
│  │  v7, Canvas) │  │  playback,   │  │  bidirectional sync) │  │
│  └──────────────┘  │  ui stores)  │  └──────────────────────┘  │
│                    └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

**The rule:** The renderer process knows nothing about the filesystem, FFmpeg, or whisper. It sends typed IPC messages and receives typed responses. This is also what makes the UI completely replaceable — swap React for anything else without touching the engine.

---

## 2. System Decomposition

### 2.1 Main Process Modules

**`AudioEngine`** — orchestrates all audio file work:
- `Importer`: Opens file dialog, reads metadata (duration, sample rate, channels) via FFprobe
- `PeakGenerator`: Generates waveform peak data from audio using FFmpeg's `astats` filter and stores as `episode.peaks.json`
- `Renderer`: Reads project EDL, builds FFmpeg filter graph, executes export, emits progress events

**`ProjectStore`** — all project persistence:
- `readProject(path)` / `writeProject(project, path)`: The only I/O surface. The JSON-vs-SQLite migration is contained entirely here.
- `applyMigrations(raw)`: Versioned migration runner, so v1 project files always load correctly in v2.

**`TranscriptionService`** — wraps the whisper.cpp N-API addon:
- `transcribe(audioPath, modelPath, options)`: Streams progress events back via `ipcMain.emit`
- `listModels()`: Scans the `resources/models/` directory for available `.bin` files
- `cancelTranscription()`: Sends abort signal to the native thread

**`IPCBridge`** — registration layer:
- `audio.ipc.ts`, `project.ipc.ts`, `transcription.ipc.ts`: Each file registers a set of `ipcMain.handle` calls and is the only place `ipcMain` is touched. Never call `ipcMain` from inside `AudioEngine` directly.

### 2.2 Renderer Modules

**Zustand Stores** — three separate stores, never one mega-store:
- `project.store`: The in-memory representation of the `ProjectFile` (source, transcript, edits, adjustments). Mutations here are what get saved to disk.
- `playback.store`: Playback state (playing, currentTime, duration). Derived from Web Audio API events, not from project.
- `ui.store`: Ephemeral UI state — selected region, inspector open/closed, zoom level. Never persisted.

**`WaveformView`** — wraps wavesurfer.js v7:
- Loads peaks from the main process (never decodes raw audio)
- Renders `Regions` for each `Edit` in the project store
- Emits `onSeek`, `onRegionClick`, `onRegionResized` events upward via callbacks

**`TranscriptEditor`** — the text editing surface:
- Renders each `Word` as a `<span data-word-id>` element
- Handles click-drag selection → floating toolbar → dispatches `addEdit` to project store
- Subscribes to `playback.currentTime` and highlights the active word via binary search

**`TransportBar`** — play/pause/seek, time display, zoom, export button.

**`Inspector`** — context-sensitive right panel. Shows edit properties (crossfade duration, gain) when a region is selected.

---

## 3. Project File Format & Migration Strategy

### 3.1 Start with JSON

The project file is a plain JSON document. It references the audio file by relative path and stores all edit decisions as metadata. The source audio is never modified.

```jsonc
// episode-042.podcut.json
{
  "version": 1,
  "createdAt": "2026-03-07T12:00:00Z",
  "source": {
    "file": "episode-042.wav",    // relative path — always same directory
    "sha256": "a1b2c3...",        // integrity check on load
    "sampleRate": 48000,
    "channels": 1,
    "durationSeconds": 3612.5
  },
  "transcript": {
    "engine": "whisper.cpp",
    "model": "large-v3",
    "words": [
      { "id": "w0001", "text": "Hello", "start": 0.52, "end": 0.89, "speaker": "A" }
    ],
    "speakers": { "A": { "label": "Host" } }
  },
  "edits": [
    { "id": "e001", "type": "mute", "start": 5.2, "end": 8.4, "label": "removed tangent" }
  ],
  "adjustments": [
    { "id": "a001", "type": "gain", "start": 120.0, "end": 180.0, "valueDb": -3.0 }
  ],
  "markers": [],
  "export": { "targetLUFS": -16, "truePeakDbTP": -1.5, "format": "mp3" }
}
```

### 3.2 The Migration Path to SQLite (when you need it)

The entire abstraction lives in `ProjectStore`. Everything else in the codebase calls `store.read()` and `store.write()` — they have no idea what's underneath.

```typescript
// src/main/project/store.ts
export interface IProjectStore {
  read(filePath: string): Promise<ProjectFile>;
  write(project: ProjectFile, filePath: string): Promise<void>;
}

// Phase 1–3: JSON implementation
export class JsonProjectStore implements IProjectStore {
  async read(filePath: string) { /* fs.readFile + JSON.parse + migrate */ }
  async write(project, filePath) { /* JSON.stringify + fs.writeFile */ }
}

// Future: SQLite implementation — zero changes to callers
export class SqliteProjectStore implements IProjectStore { ... }
```

**The migration happens in `applyMigrations()`:**

```typescript
function applyMigrations(raw: unknown): ProjectFile {
  let data = raw as any;
  if (data.version === 1) {
    data = migrateV1toV2(data);
  }
  return validateSchema(data); // Zod or ajv schema check
}
```

This means any v1 file will always open in a v2 app. This is the same approach Reaper, VS Code, and Figma all use. Implement it from day one even though you'll only have one version.

---

## 4. Directory Structure

```
podcut/
├── src/
│   ├── main/                          # Node.js main process
│   │   ├── index.ts                   # Window creation, app lifecycle
│   │   ├── ipc/                       # IPC handler registration only
│   │   │   ├── audio.ipc.ts
│   │   │   ├── project.ipc.ts
│   │   │   └── transcription.ipc.ts
│   │   ├── audio/                     # Audio engine
│   │   │   ├── importer.ts            # FFprobe metadata extraction
│   │   │   ├── peaks.ts               # Peak data generation
│   │   │   └── renderer.ts            # FFmpeg export pipeline
│   │   ├── transcription/
│   │   │   └── whisper-service.ts     # Wraps the N-API addon
│   │   └── project/
│   │       ├── store.ts               # IProjectStore interface + JsonProjectStore
│   │       ├── migrations.ts          # v1 → v2 → ... migration functions
│   │       └── schema.ts              # Zod schema + type exports
│   │
│   ├── renderer/                      # Chromium renderer process
│   │   ├── index.tsx                  # React entry point
│   │   ├── App.tsx                    # Root layout
│   │   ├── components/
│   │   │   ├── Waveform/
│   │   │   │   ├── WaveformView.tsx   # wavesurfer.js wrapper
│   │   │   │   └── useWaveform.ts     # Hook: lifecycle, regions, peaks
│   │   │   ├── Transport/
│   │   │   │   └── TransportBar.tsx   # Play/pause/seek/export
│   │   │   ├── Transcript/
│   │   │   │   ├── TranscriptEditor.tsx
│   │   │   │   ├── WordSpan.tsx
│   │   │   │   └── useWordHighlight.ts
│   │   │   └── Inspector/
│   │   │       └── Inspector.tsx      # Edit properties panel
│   │   ├── stores/
│   │   │   ├── project.store.ts       # Zustand: ProjectFile + edit mutations
│   │   │   ├── playback.store.ts      # Zustand: playback state
│   │   │   └── ui.store.ts            # Zustand: ephemeral UI state
│   │   ├── hooks/
│   │   │   └── useIpc.ts              # Typed IPC client hooks
│   │   └── ipc/
│   │       └── client.ts              # window.electronAPI typed wrappers
│   │
│   └── shared/                        # Types visible to both processes
│       ├── project.types.ts           # ProjectFile, Word, Edit, Adjustment
│       └── ipc.types.ts               # Request/response shapes for all channels
│
├── native/                            # C++ N-API addon
│   └── whisper-addon/
│       ├── binding.gyp                # node-gyp build config
│       └── src/
│           └── whisper_addon.cc       # N-API wrapper around whisper.cpp
│
├── resources/
│   └── models/                        # whisper.cpp model files (.bin)
│       └── .gitkeep                   # Don't commit 1.5GB models to git
│
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.json                      # Paths alias: @main, @renderer, @shared
└── package.json
```

---

## 5. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Desktop shell | **Electron 34.x** (pin it) | Bundles Chromium → consistent Web Audio API everywhere. Electron 35+ has macOS lag bugs. |
| Frontend | **React 18 + TypeScript** | Your stated requirement. |
| Build system | **electron-vite** | Vite for renderer HMR, proper main/preload splitting, TypeScript out of the box. Replaces the manual Webpack/CRA setup most tutorials show. |
| State | **Zustand + zundo** | Zustand: tiny, no boilerplate. Zundo: adds undo/redo as middleware, no custom stack logic. |
| Waveform | **wavesurfer.js v7** | Regions, Timeline, Minimap, Hover plugins. Load from pre-generated peaks — don't let it decode raw audio. |
| Styling | **Tailwind CSS** | Rapid iteration. Use `clsx`/`cva` for variant-based component styling. |
| Audio playback | **Web Audio API** | Precise scheduling, GainNodes for non-destructive volume, playback that skips muted regions via `AudioBufferSourceNode` sequencing. |
| Audio render/export | **FFmpeg** (bundled via `ffmpeg-static`) | Handles all edit operations: `atrim`, `concat`, `loudnorm`. No custom DSP needed. |
| Transcription | **whisper.cpp** via **node-addon-api** (N-API) | Full offline operation. N-API is ABI-stable — the addon works across Node/Electron version bumps without recompiling. |
| IPC type safety | **Typed channels in `shared/ipc.types.ts`** | Define request/response types once, use in both `ipcMain.handle` and `ipcRenderer.invoke`. No stringly-typed channels. |
| Schema validation | **Zod** | Validate project files on load, generate TypeScript types from schemas. |
| Packaging | **electron-builder** | macOS `.dmg` + Windows `.exe` NSIS installer. Code signing config for both platforms. |
| Dockable UI (Phase 4+) | **react-mosaic** | Golden Layout alternative, React-native, maintained. Already using React so no impedance mismatch. |

---

## 6. The IPC Contract (Lesson in Electron Architecture)

This is the most important Electron concept to internalize. The renderer cannot call Node APIs directly — it must ask the main process via IPC. The contextBridge is the secure handshake.

```typescript
// src/shared/ipc.types.ts — the contract shared by both processes
export interface IElectronAPI {
  audio: {
    openFile(): Promise<{ filePath: string; metadata: AudioMetadata }>;
    generatePeaks(filePath: string): Promise<PeakData>;
  };
  project: {
    open(filePath: string): Promise<ProjectFile>;
    save(project: ProjectFile, filePath: string): Promise<void>;
    saveAs(project: ProjectFile): Promise<string>;   // returns chosen path
  };
  transcription: {
    start(audioPath: string, modelPath: string): Promise<void>;
    cancel(): Promise<void>;
    onProgress(cb: (progress: TranscriptionProgress) => void): () => void;
  };
  render: {
    export(project: ProjectFile, outputPath: string): Promise<void>;
    onProgress(cb: (progress: RenderProgress) => void): () => void;
  };
}

// src/main/preload.ts — contextBridge implementation
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  audio: {
    openFile: () => ipcRenderer.invoke('audio:open-file'),
    generatePeaks: (filePath) => ipcRenderer.invoke('audio:generate-peaks', filePath),
  },
  // ... etc
} satisfies IElectronAPI);
```

The `satisfies IElectronAPI` gives you a compile-time check that your bridge matches the contract. This is an Electron pattern most tutorials skip and then regret.

---

## 7. Risk Analysis — Top 5 Technical Gotchas

### Risk 1: Never decode full audio in the renderer (Memory OOM)

**Problem:** `wavesurfer.js` default behavior calls `AudioContext.decodeAudioData()` on the full audio blob. A 1-hour 48kHz stereo WAV = 1.65 GB WAV file → 3.3 GB of `Float32Array` in browser memory. The renderer will crash with an out-of-memory error on any machine under 32 GB RAM.

**Solution:** Always use wavesurfer's `peaks` option:
```typescript
wavesurfer.create({
  container: '#waveform',
  peaks: peakData.data,       // pre-generated Float32Array[][]
  duration: metadata.duration, // tell it the duration without decoding
  // Do NOT pass url/blob until you want the MediaElement backend
  media: audioElement,         // use HTMLMediaElement for actual playback
  backend: 'MediaElement',     // don't use WebAudio backend for the source
});
```
Generate peaks in the main process using FFmpeg's `astats` filter + a custom sampler, or use the `audiowaveform` binary (BBC's open-source tool). Cache as `episode.peaks.json` alongside the project file.

### Risk 2: IPC serialization bottleneck with large data

**Problem:** Sending a large `Float32Array` of peak data from main to renderer via `ipcRenderer.invoke` serializes it to JSON, which is slow and memory-wasteful.

**Solution:** Use `SharedArrayBuffer` for large binary transfers:
```typescript
// In main process IPC handler:
const sab = new SharedArrayBuffer(peakData.byteLength);
const view = new Float32Array(sab);
view.set(peakData);
return { sharedBuffer: sab, length: view.length };

// In renderer:
const peaks = new Float32Array(response.sharedBuffer);
```
Note: `SharedArrayBuffer` requires `Cross-Origin-Opener-Policy` headers, which Electron configures automatically when you set `webPreferences.sandbox: true`.

### Risk 3: whisper.cpp N-API build toolchain is fragile

**Problem:** The N-API addon must be compiled for each target platform. macOS needs Xcode CLT + clang with Metal support. Windows needs Visual Studio Build Tools + MSVC. CI on GitHub Actions must build for both. Developers who `git clone` and `npm install` will get build failures if their toolchain is missing.

**Solution:**
- Use `prebuildify` to pre-compile the addon for each platform/arch and commit the binaries
- Fall back to a spawned child process if the native addon is missing (graceful degradation)
- Document setup in a `SETUP.md` with the exact `xcode-select --install` and VS Build Tools URL
- For the learning phase: start with `nodejs-whisper` (a pre-built npm wrapper) and replace it with your own N-API addon in Phase 3.4 once you understand the IPC patterns

### Risk 4: Non-destructive playback is harder than it looks

**Problem:** You want playback to silently skip muted regions. `audio.currentTime = x` is not sufficient — you need a scheduler that continuously monitors position and re-queues audio segments ahead of time. If you naively seek past muted regions, you get audible glitches.

**Solution:** Implement a lookahead scheduler using `AudioBufferSourceNode`:
```
Playhead at t=5.2, next muted region is [8.4 → 12.0]:
 1. Schedule source node: play [5.2 → 8.4]
 2. At t = 8.35 (50ms before end), schedule source node: play [12.0 → next_boundary]
 3. Update UI currentTime by reading AudioContext.currentTime
```
For Phase 1 (simple preview), use `HTMLMediaElement` with manual `currentTime` skipping — it's less precise but trivial to implement. Upgrade to the `AudioBufferSourceNode` scheduler in Phase 2.5.

### Risk 5: Windows FFmpeg binary path differences

**Problem:** `ffmpeg-static` returns a platform-specific path. On macOS it's something like `node_modules/ffmpeg-static/ffmpeg`. On Windows it's `node_modules\ffmpeg-static\ffmpeg.exe`. Also, paths with spaces (e.g., `C:\Users\Boning Zhang\Audio`) break naive FFmpeg argument construction.

**Solution:**
```typescript
import ffmpegPath from 'ffmpeg-static';
import { quote } from 'shell-quote'; // or use execa for argument arrays

// Always use execa with argument arrays, never string concatenation:
import { execa } from 'execa';

await execa(ffmpegPath!, [
  '-i', audioFilePath,    // execa handles quoting per-platform
  '-af', 'astats=metadata=1:reset=1',
  outputPath,
]);
```
Establish this pattern in Phase 0 and it will never bite you on Windows.

---

## 8. Step-by-Step Implementation Plan

Each step is scoped to be code-reviewable in a single PR. Steps within the same Phase can overlap, but don't start Phase 2 steps until Phase 1 steps 1.1–1.4 are complete.

---

### Phase 0: Skeleton Hardening (3–4 days)

**Step 0.1 — Migrate to `electron-vite`**

Your existing skeleton is likely using a manual webpack or CRA setup. Replace it with `electron-vite`, which gives you:
- HMR in the renderer with proper Electron security (no `nodeIntegration: true`)
- Separate TypeScript configs for main, preload, and renderer
- Vite dev server with proxy for renderer

```bash
# Start fresh (or migrate):
npm create @quick-start/electron@latest podcut -- --template react-ts
# This gives you: src/main/index.ts, src/preload/index.ts, src/renderer/src/App.tsx
```

PR scope: Replace existing skeleton with `electron-vite` scaffold. Confirm `npm run dev` launches the app.

**Step 0.2 — TypeScript path aliases**

Add `@main`, `@renderer`, `@shared` path aliases to `tsconfig.json` and `electron.vite.config.ts`:

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@main/*": ["src/main/*"],
      "@renderer/*": ["src/renderer/*"]
    }
  }
}
```

PR scope: All three path aliases work. A test import in App.tsx from `@shared/project.types` resolves.

**Step 0.3 — `shared/project.types.ts` + Zod schema**

Define the `ProjectFile` TypeScript type and Zod schema. This is the single source of truth for the data model.

```typescript
// src/shared/project.types.ts
import { z } from 'zod';

export const WordSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  speaker: z.string().optional(),
});
export type Word = z.infer<typeof WordSchema>;

export const EditSchema = z.object({
  id: z.string(),
  type: z.enum(['mute']),
  start: z.number(),
  end: z.number(),
  label: z.string().optional(),
});
export type Edit = z.infer<typeof EditSchema>;

export const ProjectFileSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  source: z.object({
    file: z.string(),
    sha256: z.string().optional(),
    sampleRate: z.number(),
    channels: z.number(),
    durationSeconds: z.number(),
  }),
  transcript: z.object({ words: z.array(WordSchema), speakers: z.record(z.object({ label: z.string() })) }).optional(),
  edits: z.array(EditSchema),
  adjustments: z.array(z.any()),
  markers: z.array(z.any()),
  export: z.object({ targetLUFS: z.number(), truePeakDbTP: z.number(), format: z.string() }),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
```

PR scope: Types compile, Zod parses a sample fixture JSON file correctly.

**Step 0.4 — `shared/ipc.types.ts` + preload bridge**

Define the full `IElectronAPI` interface (even for Phase 2 and 3 methods — stub them out). Implement the preload bridge with `satisfies IElectronAPI` type check.

PR scope: `window.electronAPI` is accessible in the renderer and TypeScript autocompletes all methods.

**Step 0.5 — ESLint + Prettier + import-sort**

Configure ESLint with `@typescript-eslint` and a rule to prevent direct `ipcRenderer` imports outside `preload.ts`. Configure Prettier. Add `husky` + `lint-staged` pre-commit hook.

PR scope: `npm run lint` passes. A deliberate `ipcRenderer` import in `App.tsx` is flagged.

---

### Phase 1: Core Engine (2 weeks)

**Step 1.1 — FFprobe audio metadata**

In `src/main/audio/importer.ts`, implement `probeAudio(filePath)` using `ffprobe` (bundled via `ffprobe-static`):

```typescript
import ffprobePath from 'ffprobe-static';
import { execa } from 'execa';

export interface AudioMetadata {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
  bitrateKbps: number;
}

export async function probeAudio(filePath: string): Promise<AudioMetadata> {
  const { stdout } = await execa(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const audio = data.streams.find((s: any) => s.codec_type === 'audio');
  return {
    durationSeconds: parseFloat(audio.duration),
    sampleRate: parseInt(audio.sample_rate),
    channels: audio.channels,
    codec: audio.codec_name,
    bitrateKbps: Math.round(parseInt(audio.bit_rate) / 1000),
  };
}
```

Register in `audio.ipc.ts`. Wire to a file open dialog using `dialog.showOpenDialog`. The renderer calls `window.electronAPI.audio.openFile()` and gets back `{ filePath, metadata }`.

PR scope: User clicks "Open File", picks an MP3/WAV, and the console logs correct metadata.

**Step 1.2 — Peak generation**

In `src/main/audio/peaks.ts`, implement `generatePeaks(filePath, samplesPerPixel)`. Use FFmpeg to read samples and downsample to a waveform overview:

```typescript
export interface PeakData {
  data: number[][];   // [channel0_peaks[], channel1_peaks[]] — min/max pairs
  length: number;
  bits: number;       // 8 for normalized 0–255, 16 for ±32768
}

export async function generatePeaks(
  filePath: string,
  samplesPerPixel: number = 256
): Promise<PeakData> {
  // Convert audio to raw PCM f32le, then downsample
  const { stdout } = await execa(ffmpegPath!, [
    '-i', filePath,
    '-f', 'f32le',         // raw 32-bit float PCM
    '-ac', '1',            // mix to mono for peaks
    '-ar', '44100',        // normalise sample rate
    'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 200 * 1024 * 1024 });

  const samples = new Float32Array(stdout.buffer);
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += samplesPerPixel) {
    const chunk = samples.slice(i, i + samplesPerPixel);
    peaks.push(Math.max(...chunk));   // min/max per chunk for accurate waveform
  }
  return { data: [peaks], length: peaks.length, bits: 8 };
}
```

Cache the result as `{audioBasename}.peaks.json` in the same directory. Check for cache before regenerating.

PR scope: Peaks file is created on disk. Log the first 10 values and confirm they're in [0,1].

**Step 1.3 — wavesurfer.js integration**

In `src/renderer/components/Waveform/WaveformView.tsx`, create a React wrapper around wavesurfer.js v7:

```tsx
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.js';

export function WaveformView({ filePath, peaks, duration, regions, onSeek }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !peaks) return;

    wsRef.current = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4F46E5',
      progressColor: '#818CF8',
      peaks: peaks.data,
      duration,
      plugins: [
        RegionsPlugin.create(),
        TimelinePlugin.create({ container: '#waveform-timeline' }),
        MinimapPlugin.create({ container: '#waveform-minimap', height: 24 }),
      ],
    });

    wsRef.current.on('seek', (progress) => onSeek(progress * duration));

    return () => wsRef.current?.destroy();
  }, [filePath, peaks]);

  // Sync regions from project store
  useEffect(() => {
    const plugin = wsRef.current?.getActivePlugins()[0] as RegionsPlugin;
    plugin?.clearRegions();
    regions.forEach(edit => plugin?.addRegion({ start: edit.start, end: edit.end, color: 'rgba(239,68,68,0.2)', drag: false, resize: false }));
  }, [regions]);

  return (
    <div>
      <div id="waveform-minimap" />
      <div ref={containerRef} id="waveform" />
      <div id="waveform-timeline" />
    </div>
  );
}
```

PR scope: Waveform renders correctly for a test audio file. Minimap and timeline visible. No raw audio decode in renderer.

**Step 1.4 — Audio playback via HTMLMediaElement**

Set up a `<audio>` element in the renderer for playback. Bind transport controls (play/pause/seek) to it. Connect it to wavesurfer's `media` option so the waveform cursor tracks playback.

Don't implement muted-region skipping yet — just straight playback. This is intentionally simple and replaced in Phase 2.

PR scope: User can open a file, see the waveform, and play/pause/seek. Waveform cursor tracks position.

**Step 1.5 — Zustand stores setup**

Set up all three stores with their initial shapes and key actions. For `project.store`, add `loadProject(file)`, `addEdit(edit)`, `removeEdit(id)`, `updateEdit(id, patch)`. Wire to `zundo` for undo/redo.

```typescript
// src/renderer/stores/project.store.ts
import { create } from 'zustand';
import { temporal } from 'zundo';

interface ProjectState {
  project: ProjectFile | null;
  filePath: string | null;
  isDirty: boolean;
  loadProject: (project: ProjectFile, filePath: string) => void;
  addEdit: (edit: Edit) => void;
  removeEdit: (id: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set) => ({
      project: null,
      filePath: null,
      isDirty: false,
      loadProject: (project, filePath) => set({ project, filePath, isDirty: false }),
      addEdit: (edit) => set((s) => ({
        project: s.project ? { ...s.project, edits: [...s.project.edits, edit] } : null,
        isDirty: true,
      })),
      // ...
    }),
    { limit: 100 }  // keep 100 undo steps
  )
);
```

PR scope: Actions fire, store updates correctly. Undo/redo works via `useProjectStore.temporal.getState().undo()`.

---

### Phase 2: Basic Editing (2.5 weeks)

**Step 2.1 — `ProjectStore` (main process persistence)**

Implement `JsonProjectStore` with `read()` and `write()`. Register IPC handlers. Wire `Cmd+S` in the renderer to call `window.electronAPI.project.save()`.

PR scope: Open a project JSON, make an edit, save it. Inspect the JSON file on disk — edit is present.

**Step 2.2 — Mute via waveform region selection**

Add `resize: true` and `drag: true` to wavesurfer Regions. On region mouseup, dispatch `addEdit` to the project store with the region's start/end time.

PR scope: User drags a region on the waveform. A mute edit appears in the store. Region turns red.

**Step 2.3 — Non-destructive playback (muted region skipping)**

Replace the simple HTMLMediaElement playback with a scheduler that skips muted regions. On play, compute the sequence of active (non-muted) segments from `project.edits`. Schedule `HTMLMediaElement` seeks ahead of each muted region using `ontimeupdate`:

```typescript
function computeActiveSegments(durationSeconds: number, edits: Edit[]): Segment[] {
  // Sort edits, fill gaps with active segments
  const mutes = [...edits].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const mute of mutes) {
    if (cursor < mute.start) segments.push({ start: cursor, end: mute.start, active: true });
    cursor = mute.end;
  }
  if (cursor < durationSeconds) segments.push({ start: cursor, end: durationSeconds, active: true });
  return segments;
}
```

PR scope: Play the audio. Muted regions are silently skipped. The waveform cursor jumps correctly.

**Step 2.4 — Crossfade on mute boundaries**

Apply a 30ms equal-power crossfade at each edit boundary using Web Audio API `GainNode.linearRampToValueAtTime()`. Make the crossfade duration configurable in the Inspector.

PR scope: Play through a muted region. No audible click at the transition.

**Step 2.5 — Per-region gain adjustment**

Add a `type: 'gain'` adjustment to the `adjustments` array. In the playback engine, apply a `GainNode` for any active segment that has a gain adjustment overlapping it. Show a dB slider in the Inspector when a region is selected.

PR scope: Adjust gain on a segment. Audible difference during playback.

**Step 2.6 — FFmpeg export pipeline**

In `src/main/audio/renderer.ts`, implement the full export. Compute active segments from the project, build an FFmpeg filter graph with `atrim`/`concat`/`loudnorm`:

```typescript
// Pseudocode — each step below is a separate function
async function renderProject(project: ProjectFile, outputPath: string) {
  const segments = computeActiveSegments(project);
  const filterParts: string[] = [];

  segments.forEach((seg, i) => {
    const gainDb = findGainForSegment(project.adjustments, seg) ?? 0;
    const gainLinear = Math.pow(10, gainDb / 20);
    filterParts.push(
      `[0:a]atrim=start=${seg.start}:end=${seg.end},` +
      `asetpts=PTS-STARTPTS,` +
      `volume=${gainLinear}[seg${i}]`
    );
  });

  // Concatenate
  const inputs = segments.map((_, i) => `[seg${i}]`).join('');
  filterParts.push(`${inputs}concat=n=${segments.length}:v=0:a=1[merged]`);

  // Step 1: measure loudness
  const stats = await measureLoudness(project.source.file, filterParts);

  // Step 2: normalize (dual-pass loudnorm)
  filterParts.push(
    `[merged]loudnorm=I=${project.export.targetLUFS}:TP=${project.export.truePeakDbTP}:LRA=11:` +
    `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:` +
    `measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:` +
    `offset=${stats.target_offset}:linear=true[out]`
  );

  await execa(ffmpegPath!, [
    '-i', project.source.file,
    '-filter_complex', filterParts.join(';'),
    '-map', '[out]',
    '-ar', String(project.export.sampleRate ?? 48000),
    '-c:a', 'libmp3lame', '-q:a', '2',
    outputPath,
  ]);
}
```

Emit progress via `ipcMain.emit` by parsing FFmpeg's `stderr` output for `time=` timestamps.

PR scope: Export produces a valid MP3. Open it in any player. Muted regions absent. Loudness within 1 LUFS of -16.

---

### Phase 3: Text-Audio Integration (3 weeks)

**Step 3.1 — N-API addon scaffold** *(This is the learning milestone)*

Set up the `native/whisper-addon/` directory:

```bash
# Install build toolchain
npm install node-addon-api node-gyp --save-dev

# binding.gyp — tells node-gyp how to build your C++ code
```

```json
// binding.gyp
{
  "targets": [{
    "target_name": "whisper_addon",
    "sources": ["src/whisper_addon.cc"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "../../vendor/whisper.cpp"          // whisper.cpp as a git submodule
    ],
    "dependencies": ["../../vendor/whisper.cpp/whisper.gyp:whisper"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "xcode_settings": {
      "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
      "OTHER_CFLAGS": ["-std=c++17"]
    }
  }]
}
```

Minimal addon to validate the build:
```cpp
// src/whisper_addon.cc
#include <napi.h>

Napi::String GetVersion(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "whisper-addon v0.1");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getVersion", Napi::Function::New(env, GetVersion));
  return exports;
}

NODE_API_MODULE(whisper_addon, Init)
```

Build: `npm run build:native` → `node-gyp build`.

PR scope: `require('./build/Release/whisper_addon').getVersion()` returns the string in `electron` context.

**Step 3.2 — Async whisper transcription in N-API**

Wrap `whisper_full()` in an Napi `AsyncWorker` so it runs off the main thread. Emit progress via a `ThreadSafeFunction` (the N-API mechanism for calling JS from a worker thread):

```cpp
class WhisperWorker : public Napi::AsyncWorker {
  // Constructor takes: audioData, modelPath, a TSFN for progress, a Promise resolver
  // Execute() runs on worker thread: calls whisper_full() with a progress callback
  // OnOK() resolves the Promise with the transcript JSON
  // Progress callback calls the TSFN to fire a JS event in the main thread
};
```

This is the hardest N-API concept. Take time with the [node-addon-api AsyncWorker + TSFN documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/async_worker.md).

PR scope: Call `transcribe('episode.wav', 'ggml-base.bin')` from Node. Observe progress logs every ~10 seconds. Receive a full transcript JSON at completion.

**Step 3.3 — Transcription IPC handler + progress streaming**

Register `ipcMain.handle('transcription:start')` and use `event.sender.send('transcription:progress', progress)` inside the N-API progress callback. On the renderer side, implement `onProgress` as a listener cleanup hook:

```typescript
// renderer/ipc/client.ts
onProgress: (cb) => {
  const handler = (_event: IpcRendererEvent, progress: TranscriptionProgress) => cb(progress);
  ipcRenderer.on('transcription:progress', handler);
  return () => ipcRenderer.off('transcription:progress', handler); // cleanup
}
```

PR scope: Trigger transcription from the UI. A progress bar shows accurate percentage. Transcript object arrives.

**Step 3.4 — `TranscriptEditor` component**

Render the transcript as a list of `WordSpan` components. Each span carries `data-word-id`. Subscribe to `playback.currentTime` and find the active word via binary search on `word.start` / `word.end`:

```typescript
function findActiveWord(words: Word[], currentTime: number): string | null {
  let lo = 0, hi = words.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (words[mid].end < currentTime) lo = mid + 1;
    else if (words[mid].start > currentTime) hi = mid - 1;
    else return words[mid].id;
  }
  return null;
}
```

Scrolling: auto-scroll the transcript panel to keep the active word visible (`element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`).

PR scope: Play audio. Active word highlights in yellow, transcript auto-scrolls. Clicking a word seeks the audio.

**Step 3.5 — Text selection → mute**

Listen to `mouseup` on the transcript container. Walk the selected `Range` to collect all `data-word-id` values. Compute `start = words[firstId].start`, `end = words[lastId].end`. Show a floating toolbar with a "Mute" button. On confirm, dispatch `addEdit` to the project store.

PR scope: Select 3 words with click-drag. Floating toolbar appears. Click "Mute". Words strikethrough, waveform region appears in red, playback skips the section.

**Step 3.6 — Filler word detection**

```typescript
// src/renderer/utils/filler-detect.ts
const FILLERS = /^(um|uh|uhm|hmm|like|you\s+know|so|actually|basically|i\s+mean|right)$/i;

export function detectFillers(words: Word[]): Edit[] {
  return words
    .filter(w => FILLERS.test(w.text.trim()))
    .map(w => ({
      id: `filler_${w.id}`,
      type: 'mute' as const,
      start: w.start,
      end: w.end,
      label: w.text.toLowerCase(),
    }));
}
```

Show a summary badge ("12 filler words found") with a "Review & Mute All" button that opens a list of each instance. User can deselect before batch-applying.

PR scope: Run filler detection. Review list shows correct instances. "Mute All" applies all edits. Individual deselection works.

---

### Phase 4: Dockable UI (future)

When you're ready, add `react-mosaic`:

```bash
npm install react-mosaic-component
```

Replace the hardcoded flex layout with a `Mosaic` component. Each panel (`WaveformView`, `TranscriptEditor`, `Inspector`) becomes a `MosaicWindow`. The layout is persisted in `ui.store` and saved to `localStorage` or a user preferences file.

Because panels are already isolated React components with no coupling to each other's internals — only to the shared Zustand stores — this is a UI-only change. The audio engine is untouched.

---

## 9. Electron Learning Milestones

As you build, you'll encounter these Electron concepts in sequence. Each phase introduces one new concept:

| Phase | Key Electron/Node Concept | Where You'll Learn It |
|---|---|---|
| 0 | Process model, contextBridge security | Step 0.4 — preload bridge |
| 0 | `ipcMain.handle` / `ipcRenderer.invoke` (request/response) | Step 0.4 |
| 1 | Child processes (`execa`), FFmpeg integration | Step 1.1 |
| 1 | `dialog.showOpenDialog` — native OS dialogs | Step 1.1 |
| 2 | `ipcMain.emit` / `event.sender.send` (push events) | Step 2.6 — export progress |
| 3 | N-API, `node-addon-api`, `AsyncWorker` | Step 3.1–3.2 |
| 3 | `ThreadSafeFunction` — calling JS from a C++ worker | Step 3.2 |
| 4 | `app.getPath('userData')` — user preferences storage | Step 4 — layout persistence |

---

## 10. Project Format: Decision Advice

You asked for a brainstorm on JSON vs SQLite. Here's the honest assessment:

**Stick with JSON through all three phases.** The `ProjectStore` abstraction means the migration to SQLite, if you ever need it, is a two-day refactor that touches exactly one file. The only scenarios where JSON becomes painful are:

1. Transcript size: a 2-hour episode at 150 WPM = ~18,000 words. At ~80 bytes per word object = 1.4 MB JSON. Perfectly fine. Parse time < 50ms.
2. Querying: if you need to do complex queries (e.g., "find all edits made in the last 24 hours"), JSON requires loading the full file. SQLite handles this trivially. You won't need this in v1.
3. Concurrent writes: if two processes need to write simultaneously. Electron single-user app — irrelevant.

The correct answer: **JSON now, SQLite later if you need it, abstract it from day one.** You've already made the right call.

---

## Summary Timeline

| Phase | Deliverable | Est. Hours |
|---|---|---|
| 0 — Setup | Project scaffold, types, IPC contract | ~8 |
| 1 — Core Engine | File import, peaks, waveform render, playback | ~20 |
| 2 — Basic Editing | Mute/gain, non-destructive playback, FFmpeg export | ~25 |
| 3 — Text Integration | whisper.cpp N-API, transcript editor, text-to-mute | ~30 |
| 4 — Dockable UI | react-mosaic integration | ~10 |
| **Total** | | **~93 hours** |

At 2–3 hours per day: Phases 0–2 (a fully functional audio editor) take **~7–8 weeks**. The full build is **~12–14 weeks**.

The most important thing to build first is the `shared/ipc.types.ts` contract and the `ProjectStore` abstraction. Get those right and every subsequent PR is adding features, not fixing architecture.
