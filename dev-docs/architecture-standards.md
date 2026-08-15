# PodCut Architecture Standards

## Process Boundaries

- Keep main-process code in [`src/main/`](../src/main/), preload code in [`src/preload/`](../src/preload/), cross-process contracts in [`src/shared/`](../src/shared/), and browser UI code in [`src/renderer/`](../src/renderer/).
- Main owns Node.js, Electron, filesystem, process, and operating-system access.
- Preload remains a narrow adapter that implements [`IElectronAPI`](../src/shared/ipc.types.ts) and exposes it through `contextBridge`.
- Renderer code uses browser APIs and the typed `window.electronAPI`; it must not import Electron, Node.js, main-process, or preload modules.
- Send only serializable data across IPC, and update the shared contract, preload implementation, and main handler together.

## State and Persisted Data

- Use Zustand stores in [`src/renderer/src/stores/`](../src/renderer/src/stores/) for renderer application state; do not introduce React context as a parallel application-state system.
- Treat [`ProjectFileSchema`](../src/shared/project.types.ts) as the source of truth for persisted project data and derive TypeScript types from its Zod schemas.
- Keep editing non-destructive: store timeline decisions as project metadata and never modify source audio.
- Preserve loading of legacy project data unless a separately approved migration removes that compatibility.
- Keep app-wide identity and project-extension values in [`src/shared/constants.ts`](../src/shared/constants.ts).

## Audio Access and Caches

- Serve local renderer audio through the `podcut://` protocol registered in [`src/main/index.ts`](../src/main/index.ts); do not replace it with direct renderer `file://` access.
- Preserve byte-range request forwarding and correct audio MIME headers when changing the custom protocol.
- Treat `*.peaks.json` files as regenerable waveform caches, never source data.
- Resolve FFmpeg, FFprobe, and whisper.cpp binaries through [`src/main/audio/binaries.ts`](../src/main/audio/binaries.ts) so platform lookup, package fallback, caching, and actionable errors remain centralized.

## Playback

- UI components depend on [`IAudioPlayer`](../src/shared/player.types.ts), not a concrete playback implementation.
- Waveform UI depends on `WaveformDataProvider`; playback remains owned by the preview player through `IAudioPlayer`; storage and decoding must not leak into the renderer.
- Prefer [`WebCodecsPlayer`](../src/renderer/src/audio/WebCodecsPlayer.ts) and retain [`SimpleAudioPlayer`](../src/renderer/src/audio/SimpleAudioPlayer.ts) as the supported fallback when WebCodecs initialization or codec support fails.
- Push current track and clip state through `IAudioPlayer.setTracks` after timeline changes rather than reading renderer stores from shared playback contracts.
- Keep muted ranges and output gaps represented as silence in the WebCodecs queue so the AudioWorklet FIFO stays aligned with the output timeline.
- Construct the WebCodecs `AudioContext` at the primary source file's native sample rate because the worklet does not resample decoded PCM; secondary sources reuse that context.
- Keep the AudioWorklet processor alive for the player lifetime by returning `true` from `process()`.

## Transcription

- Route speech-to-text through [`ITranscriber`](../src/shared/transcriber.types.ts); callers must not invoke a transcription engine directly.
- The current implementation is local whisper.cpp in [`src/main/transcriber/whisper.ts`](../src/main/transcriber/whisper.ts), reached through the main-process transcript IPC handler.
- Keep availability failures actionable and preserve progress delivery through the typed IPC contract.

## Product Evolution

- Track future audio processing, intelligence, and plugin work in [`ROADMAP.md`](../ROADMAP.md), not as speculative interfaces in current architecture standards.
- Introduce new extension points only through a separately approved design that preserves the process, data, and playback boundaries above.
