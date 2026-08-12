# PodCut Repository Instructions

## Repository References

Use the repository's authoritative files instead of duplicating their contents here:

| Topic | Authoritative source |
| --- | --- |
| Commands and verification | [`package.json`](package.json) |
| Coding and review standards | [`dev-docs/coding-standards.md`](dev-docs/coding-standards.md) |
| Product direction | [`ROADMAP.md`](ROADMAP.md) |
| Shared project model and schemas | [`src/shared/project.types.ts`](src/shared/project.types.ts) |
| IPC contract | [`src/shared/ipc.types.ts`](src/shared/ipc.types.ts) |
| Playback abstraction | [`src/shared/player.types.ts`](src/shared/player.types.ts) |
| Transcription abstraction | [`src/shared/transcriber.types.ts`](src/shared/transcriber.types.ts) |
| App name and project extension | [`src/shared/constants.ts`](src/shared/constants.ts) |

When an authoritative repository file defines a policy or contract, link to it instead of repeating it in an instruction file.

## Architectural Invariants

- Keep Electron main, preload, shared, and renderer responsibilities separate according to the coding standards.
- Route renderer-to-main calls through the typed `window.electronAPI`; never import Electron or Node.js APIs into the renderer.
- Treat WaveSurfer as waveform visualization only; UI playback depends on `IAudioPlayer`.
- Preserve `WebCodecsPlayer` as the preferred player and `SimpleAudioPlayer` as an active fallback.
- Keep speech-to-text behind `ITranscriber`.
- Serve renderer audio through the `podcut://` protocol registered in `src/main/index.ts`; do not replace it with `file://`.
- Treat `*.peaks.json` files as regenerable cache, never source data.
- Keep edits non-destructive and never modify source audio.
- Preserve loading of legacy project data unless a separately approved migration removes that compatibility.

## Working Agreement

- Propose changes and explain why before editing; wait for confirmation.
- Keep explanations concise and name unfamiliar concepts so they can be researched independently.
- Follow the verification workflow in the coding standards and report any manual behavior that was not verified.
- Treat ESLint and Knip output as investigation candidates; trace dynamic IPC, worklet, CSS, build-tool, and runtime-package references before deleting code.
- Keep mechanical formatting separate from semantic changes.
