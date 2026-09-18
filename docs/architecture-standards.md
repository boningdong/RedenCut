# RedenCut Architecture Standards

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
- Persist source-relative redaction objects on their owning clip; never split a clip merely to redact text.
- Retain overlay identities independently of their effective union; clamp effects to visible clip bounds while preserving hidden trim metadata.
- Explicit splits partition overlay coverage into independent child objects; moving a clip preserves source coverage.
- Timeline selection identifies either a clip or an overlay; pointer previews are transient and completed edits share track snapshot undo/redo.
- Treat the managed package schema as the first published project format; do not add adapters for the retired unpublished path-identified shape.
- Main owns the active temporary or saved `.redencut` workspace, and renderer state uses path-free workspace and cache descriptors.
- Identify imported media with stable `AudioSourceId` values; never use filesystem paths as clip or transcript identities.
- Keep app-wide identity and project-extension values in [`src/shared/constants.ts`](../src/shared/constants.ts).

## User Workspace Preferences

- Main owns `workspace-layout.json` under Electron's active `userData` directory; harness userData isolation applies before preference initialization.
- Validate workspace preferences with [`WorkspaceLayoutSchema`](../src/shared/workspaceLayout.types.ts) and expose only typed get/set operations through preload.
- Keep workspace preferences independent of project files, project revisions, and audio edit history.
- Renderer workspace state coordinates hydration and serialized saves through preload; late responses must not overwrite newer local layout choices.
- Workspace owns panel placement and sizing; keep feature panels mounted with stable keys and keep DOM reading order aligned with visual placement.
- Feature panels own their integrated toolbars and receive workspace drag controls through render slots; do not add a second workspace title bar above a feature toolbar.
- Persist completed layout actions only; transient drag/resize previews and window-size clamping remain local.
- Recover compatible stored fields without rewriting configuration during reads; surface recovery warnings and propagate filesystem failures.

## Application Localization

- Main owns `app-preferences.json` under the active Electron `userData` directory, initialized after harness isolation.
- Keep language preference (`system`, `en`, `zh-CN`) independent of workspace layout, project files, edit history, and speech recognition language.
- Main resolves the effective language and publishes committed revisioned snapshots through typed preload IPC; renderer uses Zustand and ignores stale responses.
- Bundle English and Simplified Chinese resources in `src/shared/i18n/`; keep the shared translator independent of Electron and Node.js.
- Use semantic translation keys and whole-message interpolation for application copy, including accessible labels and native dialog text.
- Retain stable business reasons and safe parameters in error/progress state; translate at presentation time so retained messages follow language changes.
- Keep raw diagnostics in their diagnostic sink and preserve user-authored names, transcript content, timecodes, project identifiers and file extensions.
- Changing language must not remount the editor, reset playback, restart jobs or alter project revisions.

## Settings and Resource Preparation

- Main owns theme IDs, speech feature preferences and onboarding disposition in app-preferences.json, alongside locale preferences.
- Settings and onboarding share the same renderer speech-resource components and main ResourceManager snapshots.
- ModelRegistry resolves only verified app-managed installations; no legacy cache or Homebrew model discovery occurs.
- ModelDownloader prepares immutable manifest revisions in staging with integrity checks and explicit cancellation/resumption; readiness follows load validation.
- HuggingFaceTokenStore uses platform-protected credentials; HuggingFaceAccessService verifies target-model access explicitly without polling.
- No token is returned through preload, written into project artifacts or passed to ordinary inference workers.
- AppRuntimeLocator is the single executable-location boundary; development runtime availability does not certify packaged distribution.
- Non-bundled builds use DevelopmentEnvironmentChecker for read-only executable and Python import checks, exposed in ResourceManager snapshots.
- Model selection, preparation and cancellation reuse the latest environment result; first access and explicit resource refresh validate the environment. Per-group progress reflects active check keys, not unrelated resource operations.
- Developer installation is explicit through `npm run runtime:setup`; the app validates the result and blocks model preparation while required runtime checks fail.
- uv is only an environment-setup tool; an already usable runtime does not require uv for inference or model preparation.
- Bundled snapshots omit development setup; installation guide IPC accepts fixed guide IDs rather than renderer-supplied URLs.
- Explicit onboarding skip/close and completion persist independently of resources; dialog closure does not cancel preparation.
- Settings changes affect subsequent analysis tasks; started tasks retain their configuration snapshot.

## Audio Access and Caches

- Serve only validated cache artifacts through `redencut://cache/<audio-source-id>/pcm` and `/waveform/<level>`; do not expose arbitrary paths or direct renderer `file://` access.
- Require and forward bounded byte ranges, and preserve binary MIME and CORS headers when changing the custom protocol.
- Treat continuous Float32 PCM, binary waveform levels, and cache manifests as regenerable data; copied files under `media/` remain durable originals.
- Resolve FFmpeg, FFprobe, and whisper.cpp binaries through [`src/main/runtime/AppRuntimeLocator.ts`](../src/main/runtime/AppRuntimeLocator.ts) so manifest validation, architecture checks, file integrity and actionable errors remain centralized. No system/Homebrew/npm fallback is permitted.

## Playback

- UI components depend on [`IAudioPlayer`](../src/shared/player.types.ts), not a concrete playback implementation.
- Waveform UI depends on `WaveformDataProvider`; playback remains owned by the preview player through `IAudioPlayer`; storage and decoding must not leak into the renderer.
- Use [`WorkletAudioPlayer`](../src/renderer/src/audio/WorkletAudioPlayer.ts) with managed PCM providers; compressed WebCodecs chunking and media-element fallbacks are not supported playback paths.
- Push current track and clip state through `IAudioPlayer.setTracks` after timeline changes rather than reading renderer stores from shared playback contracts.
- Keep one acknowledged queue per track, share stateless providers by `AudioSourceId`, and represent muted ranges and output gaps as silence so every queue stays aligned with the output timeline.
- Build every cache and `AudioContext` at the project processing rate of 48 kHz.
- Target two buffered seconds and enforce a three-second hard maximum per active track.
- Keep the AudioWorklet processor alive for the player lifetime by returning `true` from `process()`.

## Export

- Export removes Redact intervals by default, independently of the interactive Preview toggle.
- Share interval eligibility and retained-overlap protection through [`redactionTimeline.ts`](../src/shared/redactionTimeline.ts); do not maintain a second export-specific skip policy.
- Contract retained clip positions and export progress by those intervals, preserving natural gaps and ordinary clip/track-mute duration.
- Share overlay union/complement through `ClipRedactions.ts`; rendering subranges are ephemeral, never persisted clips.
- Export remains non-destructive; source audio and project clip positions do not change.

## Transcription

- Route speech-to-text through [`ITranscriber`](../src/shared/transcriber.types.ts); callers must not invoke a transcription engine directly.
- The current implementation is local whisper.cpp in [`src/main/speech/transcriber/whisper.ts`](../src/main/speech/transcriber/whisper.ts), reached through the main-process transcript IPC handler.
- Keep availability failures actionable and preserve progress delivery through the typed IPC contract.
- SpeechAnalysisCoordinator runs transcription and Chinese/English alignment, with optional diarization based on snapshotted preferences.
- New speech artifacts explicitly distinguish skipped-disabled diarization from completed results; existing v1 artifacts remain readable.
- Skipped analysis uses source-track presentation without fabricated speaker results; settings changes preserve existing analysis and user overrides.
- Analysis consumes provisioned resources and never implicitly downloads or authenticates.

## Transcript Presentation and Editing

- Derive transcript occurrences from current clips and source acoustic boundaries; source, analysis revision, track, clip and text-unit identities must remain distinct.
- Recompute output-time relationships from timeline state after moves, splits, mute changes and undo/redo; never persist display overlap as project truth.
- Keep acoustic selection resolution independent of the Read/Align display mode and never infer source time from text pixel position.
- Apply canonical text edits to exact clip occurrences using `redactTranscriptRange` or `redactClipRanges`; ambiguous selections must not silently select a track or duplicate clip.
- Derive text redaction coverage from clip overlays: full coverage strikes text, partial coverage is disclosed, and ordinary mute only dims it.
- Preserve coarse acoustic boundaries and disclose partial clipped units instead of inventing character timestamps.

## Speaker Presentation

- Reserve eight audio-track colors in [`trackColors.ts`](../src/shared/trackColors.ts), shared by import and renderer track creation.
- Resolve speaker colors by source, analysis revision, and speaker identity; do not replace speaker colors with track colors when multiple tracks exist.
- Anchor the first speaker for a track to its track color by default and allocate secondary colors outside the reserved palette with project-wide collision tracking.
- Store optional user-selected colors alongside speaker display-name overrides; old projects without colors retain valid defaults.
- Keep speaker visibility in renderer transcript state; filtering changes neither track audibility nor export content and clears the active transcript edit selection.
- Keep color popovers outside clipping workspace panels so resizing does not make the controls inaccessible.

## Product Evolution

- Track future audio processing, intelligence, and plugin work in [`ROADMAP.md`](../ROADMAP.md), not as speculative interfaces in current architecture standards.
- Introduce new extension points only through a separately approved design that preserves the process, data, and playback boundaries above.

## Whisper Model Selection

- Onboarding and Settings share the Whisper selector and revisioned resource snapshots; selected model IDs are persisted in `app-preferences.json` independently of projects.
- Small retains the `transcription-default` installation ID. Older or unsupported selections resolve to Small; installed alternatives remain available and are not removed on switching.
- Base preparation and readiness depend only on the selected Whisper and the fixed Chinese/English alignment models, never on every downloadable Whisper alternative.
- Selection does not download. Model-specific preparation accepts only manifest-listed transcription IDs; alignment and diarization retain their fixed models.
- Started analysis jobs retain their snapshotted model path. Subsequent jobs resolve the selected model; an uninstalled selected model does not silently use a different installed model.
- Whisper preparation checks its native CLI and FFmpeg independently of Python-based alignment/diarization; missing unrelated Python dependencies must not block a selected Whisper download. Runtime-blocked requests publish an actionable failure rather than silently returning unchanged state.
