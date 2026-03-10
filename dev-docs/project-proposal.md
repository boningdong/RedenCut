# PodCut — A Modular Podcast Audio Editor

*Technical Proposal v3 — March 2026*
*Incorporating research and brainstorming on architecture, modularity, project formats, and platform considerations*

---

## 1. Philosophy: Why Build This

Most audio editing tools suffer from the same disease: they start as simple editors and gradually accrete features until they become bloated, monolithic, and hostile to customization. Audacity has a 20-year-old codebase that's notoriously hard to extend. Reaper is powerful but feels like driving a semi-truck to the grocery store. Descript nails the text-based editing concept but locks you into a $24/month SaaS with no escape hatch.

The gap isn't "another audio editor." The gap is a **modular, composable podcast editing pipeline** where each piece does one thing well, can be used independently, and the whole system stays small enough to understand.

### Design Principles

1. **Modular over monolithic.** Each stage of the pipeline (transcribe, edit, render) is a separable component, not a tightly coupled subsystem buried inside a UI.
2. **Data model first.** The project file format is the product. The UI is just one way to interact with it.
3. **Non-destructive always.** The source audio is never modified. All edits are metadata. Muted sections remain in place, preserving original timestamps.
4. **Build only what you reach for.** Start with the minimum viable pipeline. Add waveform fine-editing only after using the text-based editor for real episodes and discovering what's actually missing.

---

## 2. Architecture: The Three-Stage Pipeline

Instead of one monolithic app, the system is three composable stages:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Stage 1    │     │  Stage 2    │     │  Stage 3    │
│  TRANSCRIBE │────▶│  EDIT       │────▶│  RENDER     │
│             │     │             │     │             │
│  Audio ──▶  │     │  Transcript │     │  EDL.json   │
│  Transcript │     │  + UI ──▶   │     │  + Audio ──▶│
│  + EDL      │     │  EDL.json   │     │  Final MP3  │
└─────────────┘     └─────────────┘     └─────────────┘
   CLI / API           Electron UI         CLI / API
```

**Stage 1 — Transcribe** (CLI or API call): Takes audio, produces a word-timestamped transcript with speaker diarization. Can run headless.

**Stage 2 — Edit** (Electron UI): The interactive text-based editor. User reads the transcript, selects/mutes words, adjusts boundaries. Outputs an EDL (Edit Decision List) — the project file.

**Stage 3 — Render** (CLI): Takes the source audio + EDL, builds an FFmpeg filter graph, applies mutes/crossfades/gain/normalization, produces the final audio file. Can run headless.

Each stage is independently useful. You could use Stage 1 + Stage 3 with a hand-edited JSON file and skip the UI entirely. Or you could swap Stage 1 for a different transcription tool and still use the editor.

### Why This Matters

- **Scriptable.** You can batch-process episodes: `transcribe episode.wav | edit | render -o final.mp3`
- **Debuggable.** If the output sounds wrong, inspect the EDL JSON — it's human-readable.
- **Replaceable parts.** Swap AssemblyAI for Whisper.cpp for Deepgram without touching the editor.
- **Incrementally buildable.** Stage 1 + Stage 3 is a working tool in 2-3 weeks. Stage 2 (the full UI) comes after.

---

## 3. The Project File Format (EDL)

This is the most important design decision. Studying how professional tools handle their project files reveals a clear pattern:

### Lessons from Existing Tools

**Reaper (.RPP):** Plain-text markup, human-readable, editable with any text editor. Contains no audio — only references to external WAV files by path. Community-built parsers exist in Python and JavaScript because the format is simple. Peaks (waveform images) are cached separately and regenerated on demand.

**Adobe Audition (.SESX):** XML-based, contains no audio data — only pathnames to audio files plus effect settings and track arrangement. Explicitly designed to be opened in text editors and stored in version control systems like Git or Perforce.

**Audacity (.AUP3):** Migrated from XML+data-folder (which constantly broke when users moved files) to a single SQLite database containing everything. More robust but opaque — you can't inspect or script against it without SQLite tools.

### Our Design Choice: JSON, Metadata-Only (Reaper/Audition School)

The project file is a small JSON document. It contains no audio data — only references and edit decisions. It's human-readable, diffable with `git diff`, and scriptable with `jq` or any programming language.

```jsonc
{
  "version": 1,
  "createdAt": "2026-03-07T12:00:00Z",
  "source": {
    "file": "episode-042.wav",       // relative path — always in same directory
    "sha256": "a1b2c3...",           // integrity check
    "sampleRate": 48000,
    "channels": 1,
    "duration": 5432.5               // seconds
  },

  "transcript": {
    "engine": "assemblyai",
    "model": "universal-2",
    "words": [
      { "id": "w0001", "text": "Hello", "start": 0.520, "end": 0.890,
        "confidence": 0.97, "speaker": "A" },
      { "id": "w0002", "text": "and", "start": 0.900, "end": 1.020,
        "confidence": 0.95, "speaker": "A" }
      // ... thousands of words
    ],
    "speakers": {
      "A": { "label": "Host" },
      "B": { "label": "Guest" }
    }
  },

  "edits": [
    {
      "id": "e001",
      "type": "mute",
      "start": 5.200,                // seconds in original timeline
      "end": 8.400,
      "source": "text",              // "text" | "manual" | "filler_detect"
      "label": "removed tangent"
    },
    {
      "id": "e002",
      "type": "mute",
      "start": 42.100,
      "end": 42.800,
      "source": "filler_detect",
      "label": "um"
    }
  ],

  "adjustments": [
    {
      "id": "a001",
      "type": "gain",
      "start": 120.0,
      "end": 180.0,
      "value": -3.0                  // dB
    },
    {
      "id": "a002",
      "type": "crossfade",
      "at": 5.200,                   // applied at edit boundary
      "durationMs": 50
    }
  ],

  "markers": [
    {
      "id": "m001",
      "time": 15.300,
      "type": "jump_cut",
      "severity": "high",
      "resolved": false
    }
  ],

  "export": {
    "targetLUFS": -16,
    "truePeakDBTP": -1.5,
    "format": "mp3",
    "quality": "vbr2",
    "sampleRate": 48000
  }
}
```

### Project Directory Structure

Following the Reaper convention — everything in one folder, relative paths:

```
episode-042/
├── episode-042.wav              # Original audio (never modified)
├── episode-042.podcut.json      # Edit decisions (the project file)
├── episode-042.peaks.json       # Cached waveform peaks (regenerable)
└── exports/
    └── episode-042-final.mp3    # Rendered output
```

This folder is self-contained and portable. Zip it, move it, `git init` it — everything just works.

---

## 4. Stage 1: Transcription

### Recommended: AssemblyAI Universal-2

For podcast editing, you need word-level timestamps AND speaker diarization in a single call. Based on current research:

- **OpenAI Whisper API** ($0.006/min) supports word-level timestamps, but only via the legacy `whisper-1` model — the newer GPT-4o Transcribe models do not. No built-in diarization.
- **AssemblyAI** ($0.006/min) provides word timestamps + speaker diarization (up to 50 speakers) in one call. Their 2025 models achieved 10% improvement in diarization error rate and 30% better performance in noisy environments.
- **Deepgram Nova-2** ($0.0043/min) is cheapest but slightly lower accuracy on noisy audio.
- **Local whisper.cpp** (free, Metal-accelerated on Apple Silicon) has no diarization. Can pair with WhisperX for diarization via pyannote.

**Cost for a 2-hour episode with AssemblyAI:** ~$0.72.

### Implementation

```typescript
// stage1-transcribe.ts — can run as CLI or be called from UI

import { AssemblyAI } from 'assemblyai';

interface TranscribeOptions {
  audioPath: string;
  apiKey: string;
  speakerLabels?: boolean;
}

async function transcribe(opts: TranscribeOptions): Promise<ProjectFile> {
  const client = new AssemblyAI({ apiKey: opts.apiKey });

  const transcript = await client.transcripts.transcribe({
    audio: opts.audioPath,
    speaker_labels: opts.speakerLabels ?? true,
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      file: path.basename(opts.audioPath),
      sampleRate: 48000, // detect from file
      duration: transcript.audio_duration,
    },
    transcript: {
      engine: 'assemblyai',
      model: 'universal-2',
      words: transcript.words!.map((w, i) => ({
        id: `w${String(i).padStart(4, '0')}`,
        text: w.text,
        start: w.start / 1000,  // ms → seconds
        end: w.end / 1000,
        confidence: w.confidence,
        speaker: w.speaker,
      })),
      speakers: buildSpeakerMap(transcript.utterances),
    },
    edits: [],
    adjustments: [],
    markers: [],
    export: { targetLUFS: -16, truePeakDBTP: -1.5, format: 'mp3',
              quality: 'vbr2', sampleRate: 48000 },
  };
}
```

### Offline Fallback: whisper.cpp

```bash
# Local transcription with Metal acceleration on Apple Silicon
whisper-cpp --model large-v3 --output-json --print-timestamps episode.wav
```

The CLI tool can accept either `--engine assemblyai` or `--engine whisper-local` and produce the same project file format regardless.

---

## 5. Stage 2: The Editor (Electron + React)

### Why Electron (Not Tauri, Not Native)

**Electron wins for this use case** despite its size overhead:

- **Consistent Web Audio API.** Electron bundles Chromium, guaranteeing identical audio behavior everywhere. Tauri uses the OS native WebView — on macOS that's WebKit, which has documented quirks with Web Audio GainNodes and Canvas rendering.
- **wavesurfer.js compatibility.** The primary waveform library is tested against Chromium. Its Envelope plugin (fade-in/fade-out control) uses MediaElementSourceNode, which behaves differently across WebKit vs Chromium.
- **GPU acceleration out of the box.** On macOS, Chromium's rendering goes through Metal for Canvas 2D and WebGL. On Apple Silicon, waveform Canvas rendering is GPU-accelerated automatically.
- **Audio processing is CPU-bound anyway.** Web Audio API, AudioContext, GainNodes — these always run on CPU regardless of framework. On M-series chips, this is more than sufficient.

**Electron version caveat:** Pin to Electron 34.x. There are open issues with Electron 35+ causing system-wide lag on macOS 26. Monitor the Electron issue tracker before upgrading.

**HarmonyOS is not supported** by Electron and won't be. HarmonyOS NEXT requires native ArkTS/ArkUI development — it's an entirely separate platform with its own compiler and runtime. If HarmonyOS support becomes necessary, it would require a separate native codebase.

### UI Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Transport: ◀ ▶ ⏸ ⏮ ⏭  │ 00:15:32 / 01:23:45 │ 🔊━━━ │ Zoom │
├─────────────────────────────────┬────────────────────────────────┤
│                                 │                                │
│  Minimap (wavesurfer Minimap)   │   Transcript Panel             │
│  ▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇██      │                                │
│  ──────────────────────────     │   [Host] 00:00:05              │
│  Waveform (wavesurfer v7)       │   Hello and welcome to the     │
│  ▁▃▅▇█▇▅▃▁▃▅▇█▇▅▃▁▃▅▇████    │   podcast today we are going   │
│  ═══════════════════════════    │   to ██████████████ talk about  │
│  ░░░░░░░░██████░░░░░░░░░░░     │   something really interesting │
│  (muted) (active) (muted)      │                                │
│  ▲     ▲       ▲  markers      │   [Guest] 00:00:12             │
│  ──────────────────────────     │   Yeah absolutely I think      │
│  Timeline: |0:00|0:05|0:10|    │   this ██████ topic is great   │
│                                 │                                │
├─────────────────────────────────┤   ▼ Filler words: 12 found    │
│  Inspector (context-dependent)  │   [Mute All Fillers]           │
│  Selected: muted region e003    │                                │
│  Start: 00:05.20  End: 00:08.40│                                │
│  Crossfade: [30]ms              │                                │
│  [Unmute] [Extend Left +100ms] │                                │
└─────────────────────────────────┴────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Shell | Electron 34.x | Desktop framework, Chromium for consistent rendering |
| Frontend | React 18 + TypeScript | UI components |
| State | Zustand + zundo | State management + undo/redo middleware |
| Styling | Tailwind CSS | Rapid styling |
| Waveform | wavesurfer.js v7 | Waveform display with Regions, Timeline, Minimap, Hover plugins |
| Audio playback | Web Audio API | Non-destructive playback with dynamic region skipping |
| Build | Vite + electron-builder | Dev server + macOS .dmg packaging |

### Key Interaction: Text Selection → Mute

The transcript panel renders each word as an interactive `<span>`. Click-drag to select a range of words → floating toolbar appears → "Mute" creates an edit entry in the project file and visually dims the corresponding waveform region.

```tsx
function WordSpan({ word, isPlaying, isMuted }: Props) {
  return (
    <span
      data-word-id={word.id}
      className={cn(
        'cursor-pointer select-none px-[1px] rounded-sm',
        isMuted && 'line-through opacity-40 bg-red-100',
        isPlaying && 'bg-yellow-200 font-semibold',
      )}
    >
      {word.text}
    </span>
  );
}
```

### Bidirectional Sync

- **Playback cursor** highlights the current word (karaoke-style) via binary search on timestamps
- **Click a word** → waveform seeks to that timestamp
- **Select text range** → waveform region highlights
- **Drag a waveform region boundary** → mute edit adjusts (clip extension)

### Clip Extension

In our non-destructive model, "clip extension" is simply **dragging the edge of a muted region to shrink it.** The adjacent active audio "grows back" because the source file was never touched. wavesurfer.js Regions plugin supports this natively with `resize: true`.

### Crossfade

At each edit boundary (active → muted transition), a short equal-power crossfade smooths the transition. Default: 30ms. Configurable per edit point. During playback, applied via Web Audio GainNode ramps. During export, rendered via FFmpeg.

### Large File Handling

wavesurfer.js decodes audio entirely in the browser, which can fail for 1-2 hour podcasts. Solution: pre-generate waveform peaks using BBC's `audiowaveform` tool (or equivalent), then load peaks data instead of decoding the full file. The peaks are cached in the project directory as `episode.peaks.json` and regenerated if deleted (same pattern as Reaper's `.reapeak` files).

---

## 6. Stage 3: Render / Export

### FFmpeg Pipeline

The renderer reads the project file, identifies all active (non-muted) regions, applies gain adjustments and crossfades, concatenates, and normalizes.

```typescript
// stage3-render.ts — CLI tool

async function render(projectPath: string, outputPath: string) {
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
  const activeRegions = computeActiveRegions(project);

  // Build FFmpeg filter graph
  const filters: string[] = [];

  activeRegions.forEach((region, i) => {
    const gain = findGainForRegion(project.adjustments, region);
    const linearGain = Math.pow(10, gain / 20);
    filters.push(
      `[0:a]atrim=start=${region.start}:end=${region.end},` +
      `asetpts=PTS-STARTPTS,volume=${linearGain}[seg${i}]`
    );
  });

  // Concatenate
  const inputs = activeRegions.map((_, i) => `[seg${i}]`).join('');
  filters.push(`${inputs}concat=n=${activeRegions.length}:v=0:a=1[merged]`);

  // Dual-pass loudnorm: measure first, then normalize
  // Pass 1: measure
  const stats = await measureLoudness(project.source.file, filters);

  // Pass 2: normalize to -16 LUFS (podcast standard)
  filters.push(
    `[merged]loudnorm=I=${project.export.targetLUFS}:` +
    `TP=${project.export.truePeakDBTP}:LRA=11:` +
    `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:` +
    `measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:` +
    `offset=${stats.target_offset}:linear=true[out]`
  );

  await execFFmpeg([
    '-i', path.join(projectDir, project.source.file),
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    '-ar', String(project.export.sampleRate),
    ...formatFlags(project.export),  // e.g., -c:a libmp3lame -q:a 2
    outputPath,
  ]);
}
```

### Normalization Target

**-16 LUFS** integrated loudness with **-1.5 dBTP** true peak ceiling. This is the AES streaming recommendation used by Apple Podcasts and Spotify. FFmpeg's `loudnorm` filter handles this via a dual-pass approach: first pass measures, second pass normalizes (linearly when possible, dynamically when needed). The filter internally resamples to 192kHz — always specify `-ar 48000` to resample back down.

The `ffmpeg-normalize` Python package (v1.36.0) now includes a built-in `podcast` preset targeting this standard, which could serve as an alternative wrapper.

---

## 7. Optional: AI-Assisted Editing (Phase 4)

### Filler Word Detection

Pattern-match the transcript for common fillers and offer batch-mute:

```typescript
const FILLERS = /^(um|uh|uhm|hmm|like|you know|so|actually|basically|i mean|right)$/i;

function detectFillers(words: Word[]): Edit[] {
  return words
    .filter(w => FILLERS.test(w.text.trim()))
    .map(w => ({
      id: generateId(),
      type: 'mute',
      start: w.start,
      end: w.end,
      source: 'filler_detect',
      label: w.text.toLowerCase(),
    }));
}
```

### Jump Cut Detection with Meyda.js

At each edit boundary, analyze 100ms of audio on each side using Meyda.js (a JavaScript audio feature extraction library that works with Web Audio API or plain arrays). Compare RMS (loudness), spectral centroid (brightness), and spectral flux (rate of spectral change). Large discontinuities → flag as jump cut → suggest crossfade.

```typescript
import Meyda from 'meyda';

function scoreEditPoint(buffer: Float32Array, sampleRate: number,
                        editTime: number): JumpCutScore {
  const windowSize = Math.floor(0.1 * sampleRate); // 100ms
  const editSample = Math.floor(editTime * sampleRate);

  const before = buffer.slice(editSample - windowSize, editSample);
  const after = buffer.slice(editSample, editSample + windowSize);

  const fBefore = Meyda.extract(['rms', 'spectralCentroid', 'spectralFlux'], before);
  const fAfter = Meyda.extract(['rms', 'spectralCentroid', 'spectralFlux'], after);

  const rmsJump = Math.abs(fBefore.rms - fAfter.rms) /
                  Math.max(fBefore.rms, fAfter.rms, 0.001);

  return {
    time: editTime,
    severity: rmsJump > 0.5 ? 'high' : rmsJump > 0.2 ? 'medium' : 'low',
    suggestion: rmsJump > 0.3 ? 'crossfade' : 'ok',
    suggestedFadeMs: rmsJump > 0.5 ? 80 : 30,
  };
}
```

This is a **Phase 4 feature** — not needed in v1. Build it after using the text editor for real episodes and seeing how often you manually fix jump cuts.

---

## 8. Development Plan

### The Minimum Viable Pipeline (Phases 1-2)

Get a working tool as fast as possible. Everything else is iterative.

#### Phase 1: Transcribe + Render CLI (2-3 weeks, ~20 hours)

| Task | Hours |
|---|---|
| Define and validate the JSON project file schema | 2 |
| AssemblyAI transcription wrapper (+ Whisper fallback) | 4 |
| CLI: `podcut transcribe episode.wav -o episode.podcut.json` | 2 |
| FFmpeg render pipeline: read EDL, build filter graph, export | 6 |
| Dual-pass loudnorm normalization (-16 LUFS) | 2 |
| CLI: `podcut render episode.podcut.json -o final.mp3` | 2 |
| Basic filler word detection (writes edits to project file) | 2 |
| **Subtotal** | **~20** |

**After Phase 1, you have a working pipeline.** Transcribe → hand-edit JSON (or use filler detection) → render. Ugly, but functional. Use it for a real episode to validate the workflow.

#### Phase 2: Text-Based Editor UI (3-4 weeks, ~35 hours)

| Task | Hours |
|---|---|
| Electron + Vite + React scaffold | 2 |
| Load project file, display transcript with speaker labels | 4 |
| Word-level text selection → mute (click-drag, floating toolbar) | 6 |
| wavesurfer.js integration (waveform + Regions + Timeline + Minimap) | 5 |
| Bidirectional sync (transcript ↔ waveform playback position) | 4 |
| Muted region visualization (dimmed waveform overlay) | 3 |
| Transport controls (play/pause/seek, keyboard shortcuts) | 3 |
| Non-destructive playback engine (skip muted regions, auto-crossfade) | 6 |
| Undo/redo (Zustand + zundo) | 2 |
| **Subtotal** | **~35** |

**After Phase 2, you have the core product.** Text-based editing with waveform visualization, non-destructive playback, and normalized export.

### The Refinement Phases (Build Only What You Reach For)

#### Phase 3: Fine Editing (2-3 weeks, ~25 hours)

| Task | Hours |
|---|---|
| Draggable region boundaries (clip extension) | 5 |
| Crossfade UI (visual fade curves, per-edit-point duration control) | 5 |
| Per-region volume adjustment (dB slider in inspector) | 3 |
| Pre-decoded peaks for long files (bbc/audiowaveform integration) | 3 |
| Snap region edges to word boundaries | 2 |
| Keyboard shortcuts (J/K/L shuttle, [ ] nudge, space play) | 2 |
| Project save/load, recent projects, auto-save | 3 |
| Export progress UI (FFmpeg stderr parsing) | 2 |
| **Subtotal** | **~25** |

#### Phase 4: AI-Assisted Editing (1-2 weeks, ~15 hours)

| Task | Hours |
|---|---|
| Meyda.js integration for audio feature extraction at edit boundaries | 4 |
| Jump-cut scoring and severity classification | 3 |
| Marker system (visual timeline markers, click to navigate) | 3 |
| Auto-fix: batch apply crossfades to detected jump cuts | 3 |
| Batch filler-word mute UI (preview and confirm) | 2 |
| **Subtotal** | **~15** |

#### Phase 5: Polish & Package (1 week, ~10 hours)

| Task | Hours |
|---|---|
| Dark mode, responsive panel sizing | 3 |
| Error handling, loading states, edge cases | 3 |
| electron-builder packaging for macOS .dmg | 2 |
| README, usage documentation | 2 |
| **Subtotal** | **~10** |

### Summary

| Phase | What You Get | Hours | Cumulative |
|---|---|---|---|
| **1. CLI Pipeline** | Working transcribe → edit → render | ~20 | 20 |
| **2. Text Editor UI** | The core product | ~35 | 55 |
| **3. Fine Editing** | Clip extension, crossfade, volume | ~25 | 80 |
| **4. AI Assists** | Jump-cut detection, filler detection | ~15 | 95 |
| **5. Polish** | Dark mode, packaging, docs | ~10 | 105 |

At 2-3 hours/day, Phase 1+2 takes **~5-6 weeks** and gives you a usable tool. The full build is **~8-10 weeks**.

---

## 9. Key Technical Decisions & Tradeoffs

### Project Format: JSON vs SQLite

We chose JSON (Reaper/Audition approach) over SQLite (Audacity approach):

| | JSON (our choice) | SQLite (Audacity) |
|---|---|---|
| Human-readable | Yes — open in any text editor | No — binary format |
| Version-controllable | Yes — `git diff` shows edit changes | No |
| Scriptable | `jq`, Python, Node — trivial | Requires sqlite3 bindings |
| Self-contained | No — audio is a separate file | Yes — everything in one file |
| Risk of broken references | Yes (if audio file moves) | None |
| File size | Tiny (~100KB for a long episode) | Large (contains all audio) |

Mitigation for broken references: always use relative paths, always keep project file and audio in the same directory.

### Electron vs Tauri vs Native Swift

| | Electron | Tauri | Native Swift |
|---|---|---|---|
| Installer size | ~100MB | ~5MB | ~10MB |
| Memory | ~200MB | ~40MB | ~30MB |
| Web Audio consistency | Chromium (excellent) | WebKit (quirky) | N/A (AVAudioEngine) |
| Canvas/waveform rendering | GPU via Metal on macOS | GPU via WebKit | Manual (Core Graphics) |
| Development speed | Fastest (JS ecosystem) | Medium (Rust backend) | Slowest (build everything) |
| HarmonyOS | No | No | No |

Electron wins on development speed and Web Audio reliability. The size/memory overhead is irrelevant for a personal tool.

### Transcription: API vs Local

Start with AssemblyAI API. Add local whisper.cpp as an offline option later. The project file records which engine was used, so transcripts from different engines are interchangeable.

### What We Deliberately Don't Build in v1

- **Multi-track editing.** This is a podcast editor, not a DAW.
- **Effects (EQ, compression, noise reduction).** Use dedicated tools for this pre-editing step.
- **Real-time recording.** Record in any app, then import.
- **Video support.** Audio only. Pair with a video editor if needed.
- **Per-region waveform visualization.** The waveform shows the full original audio. Muted regions are overlaid as dimmed. We don't re-render the waveform per edit.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| wavesurfer.js can't handle 2-hour files | Pre-decode peaks via bbc/audiowaveform; load peaks instead of full decode |
| Non-destructive playback engine is complex | Start with simple seek-based skipping; add smooth crossfade playback later |
| Electron 35+ macOS performance regression | Pin to Electron 34.x; monitor issue tracker |
| Transcription word timestamps off by >100ms | AssemblyAI has the best timestamp accuracy; allow manual word boundary adjustment |
| Complex FFmpeg filter graphs for many edits | Merge adjacent active regions before building filter graph; batch segments |
| Project file grows large with thousands of words | A 2-hour podcast at ~150 WPM = ~18,000 words ≈ 2MB JSON — acceptable |

---

## 11. Alternatives Considered

### A. Fork Audapolis

The closest existing open-source tool. Electron-based, AGPL-licensed, text-based audio editor with transcription. Development has largely stalled (v0.3.0, open issues accumulating without maintainer response). Missing crossfade, fine editing, modern transcription APIs. More work to modernize than to build fresh — but worth studying its transcript-editor UI for inspiration.

### B. Reaper + ReaScript Scripting

Use Reaper's Lua/Python scripting API as the audio engine, build a separate transcript UI that sends commands. Gets all audio features for free. Cons: two-window UX, $60 license, can't customize Reaper's timeline, limited API for the type of text-to-audio binding we need.

### C. Pure Web App

Build as a Next.js app using WebCodecs and File System Access API. No install needed. Cons: File System Access only in Chromium browsers, large file handling unreliable, no background processing, would need a server for transcription anyway.

### D. Native Swift + AVFoundation

Best macOS performance, smallest bundle, direct Metal and AVAudioEngine access. Cons: building a waveform timeline editor from scratch in SwiftUI/AppKit is 3-4 weeks of work alone, far fewer open-source components. Consider this as a v2 migration path if the tool becomes something you want to ship to others.

---

## 12. Getting Started

**Week 1:** Define the project file schema. Build the AssemblyAI transcription CLI wrapper. Test with a real episode.

**Week 2-3:** Build the FFmpeg render pipeline. Add filler detection. Complete the CLI pipeline. Edit a real episode by hand-editing the JSON.

**Week 4-6:** Build the Electron text editor UI. Get transcript display + word selection + mute working. Add wavesurfer.js for waveform visualization.

**After that:** Use it for real episodes. See what you actually reach for. Build that next.
