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
- Treat the managed package schema as the first published project format; do not add adapters for the retired unpublished path-identified shape.
- Main owns the active temporary or saved `.podcut` workspace, and renderer state uses path-free workspace and cache descriptors.
- Identify imported media with stable `AudioSourceId` values; never use filesystem paths as clip or transcript identities.
- Keep app-wide identity and project-extension values in [`src/shared/constants.ts`](../src/shared/constants.ts).

## Audio Access and Caches

- Serve only validated cache artifacts through `podcut://cache/<audio-source-id>/pcm` and `/waveform/<level>`; do not expose arbitrary paths or direct renderer `file://` access.
- Require and forward bounded byte ranges, and preserve binary MIME and CORS headers when changing the custom protocol.
- Treat continuous Float32 PCM, binary waveform levels, and cache manifests as regenerable data; copied files under `media/` remain durable originals.
- Resolve FFmpeg, FFprobe, and whisper.cpp binaries through [`src/main/audio/binaries.ts`](../src/main/audio/binaries.ts) so platform lookup, package fallback, caching, and actionable errors remain centralized.

## Playback

- UI components depend on [`IAudioPlayer`](../src/shared/player.types.ts), not a concrete playback implementation.
- Waveform UI depends on `WaveformDataProvider`; playback remains owned by the preview player through `IAudioPlayer`; storage and decoding must not leak into the renderer.
- Use [`WorkletAudioPlayer`](../src/renderer/src/audio/WorkletAudioPlayer.ts) with managed PCM providers; compressed WebCodecs chunking and media-element fallbacks are not supported playback paths.
- Push current track and clip state through `IAudioPlayer.setTracks` after timeline changes rather than reading renderer stores from shared playback contracts.
- Keep one acknowledged queue per track, share stateless providers by `AudioSourceId`, and represent muted ranges and output gaps as silence so every queue stays aligned with the output timeline.
- Build every cache and `AudioContext` at the project processing rate of 48 kHz.
- Target two buffered seconds and enforce a three-second hard maximum per active track.
- Keep the AudioWorklet processor alive for the player lifetime by returning `true` from `process()`.

## Transcription

- Route speech-to-text through [`ITranscriber`](../src/shared/transcriber.types.ts); callers must not invoke a transcription engine directly.
- The current implementation is local whisper.cpp in [`src/main/transcriber/whisper.ts`](../src/main/transcriber/whisper.ts), reached through the main-process transcript IPC handler.
- Keep availability failures actionable and preserve progress delivery through the typed IPC contract.

## Product Evolution

- Track future audio processing, intelligence, and plugin work in [`ROADMAP.md`](../ROADMAP.md), not as speculative interfaces in current architecture standards.
- Introduce new extension points only through a separately approved design that preserves the process, data, and playback boundaries above.
