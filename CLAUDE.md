# PodCut — Claude Context File

## Project
A minimalist, modular podcast/audio editor built with Electron + React + TypeScript.
Target users: podcasters who want a simple editing tool, with extensibility via plugins.
Distribution: macOS first, Windows later. App name TBD — see `src/shared/constants.ts`.

## Key Commands
- `npm run dev` — start dev server + Electron window
- `npm run build` — production build (outputs to `out/`)
- `npm run typecheck` — type-check all three tsconfigs without building
- Build tool is electron-vite v5 (outputs to `out/`, not `dist/`)

## Architecture
Three processes — never mix their concerns:

| Layer    | Location        | Access                        |
|----------|-----------------|-------------------------------|
| Main     | `src/main/`     | Full Node.js + OS             |
| Preload  | `src/preload/`  | Bridge only via contextBridge |
| Renderer | `src/renderer/` | Browser APIs only, no Node    |

IPC contract lives in `src/shared/ipc.types.ts`. All renderer→main calls go through
`window.electronAPI` (typed, exposed by the preload). Never use `ipcRenderer` directly
in the renderer.

Shared types and Zod schemas live in `src/shared/project.types.ts`.
App-wide constants (file extension, app name) live in `src/shared/constants.ts`.

## Key Patterns
- **State**: Zustand stores (`src/renderer/src/stores/`), not React context
- **Types**: Derived from Zod schemas — edit the schema, types follow
- **WaveSurfer**: instance exposed via `getWaveSurferInstance()` in `WaveformView.tsx`
- **Peaks**: `*.peaks.json` are regenerable cache — never treat as source data
- **STT**: all speech-to-text goes through the `ITranscriber` interface
  (`src/shared/transcriber.types.ts`). Never call Whisper directly.

## Platform Notes
- Requires `brew install ffmpeg` on macOS (Apple Silicon). The app throws an
  actionable error if binaries are missing.
- Binary resolution is in `src/main/audio/binaries.ts` — Homebrew paths take
  priority over npm static packages (which are x64-only and fail on Apple Silicon).
- Audio is served to the renderer via the `podcut://` custom protocol
  (registered in `src/main/index.ts`). Do not replace with `file://` — Chromium
  blocks local file access from the renderer.

## Edit Model
- Edits are non-destructive: stored as `{ id, type: 'cut' | 'mute', startTime, endTime }`
- Source audio is never modified
- **Preview Mode**: when on, playback skips muted regions in real time (seek to region
  end on `timeupdate`). Reflects what the final export will sound like.
  If the playhead is inside a muted region when Play is pressed, immediately skip forward.
  Clicking a word in the transcript repositions the playhead only — no auto-play.

## Transcript
- Words are stored as `{ word, startTime, endTime, muted }` — one entry per word
- Rendered as individual `<span>` elements (not a standard text editor)
- Deleting text mutes the corresponding audio region + shows strikethrough
- A display toggle switches between showing strikethrough text and hiding muted words
- Transcript panel lives on the right side, resizable via a drag handle

## Keyboard Shortcuts
| Key                 | Action                      |
|---------------------|-----------------------------|
| Space               | Play / Pause                |
| S                   | Split at playhead           |
| M                   | Mute selected region        |
| U                   | Unmute selected region      |
| Delete / Backspace  | Mute region + strikethrough |
| Cmd+Z / Cmd+Shift+Z | Undo / Redo                 |
| Cmd+S               | Save project                |
| Escape              | Clear selection             |
| ← / →               | Nudge playhead 1s           |
| Shift+← / Shift+→   | Nudge playhead 5s           |

## Working Preferences
- Always propose changes before making them. Show what/why, wait for confirmation.
- When explaining concepts, name the topic only — the developer researches independently.
- Run `npm run build` to verify after any non-trivial change.
