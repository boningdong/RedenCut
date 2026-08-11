# Readability Cleanup Dead-Code Audit

## Baseline and entry graph

Baseline commit: `8f085addc0c022aaebee4aa56a652618b5a6742f`.

- `npm run deadcode` exited 1 with one unused dependency, 19 unused exports, and nine unused exported types; it reported no configuration hints, unused files, or unresolved imports.
- `npx knip --files` exited 0 with no unused files.
- `npx knip --dependencies` exited 1 with only `mp4box`.
- `npx knip --debug --files` confirmed the Electron/Vite/Vitest discovery graph: main `src/main/index.ts`, preload `src/preload/index.ts`, renderer HTML `src/renderer/index.html`, renderer module `src/renderer/src/main.tsx`, and Vitest's `src/**/*.test.ts` / `src/**/*.spec.ts` entries.
- `rg -n 'ipcMain\.handle|register.*Handlers|register.*Protocol|protocol\.handle|contextBridge' src/main src/preload` confirmed Electron protocol, IPC, and preload registration sites.
- `rg -n 'WORKLET_CODE|audioWorklet\.addModule|new Blob|createObjectURL' src/renderer/src/audio` confirmed that `AudioPlayerWorklet.ts` is dynamically embedded as a string and registered from `WebCodecsPlayer.ts`.

## Knip findings

All reference evidence below was captured before editing. A result described as “definition only” means the exact `rg` command returned no import, call, JSX, DOM, IPC, or runtime-registration consumer.

| Candidate | Finding type | Reference evidence | Dynamic-entry check | Decision |
| --- | --- | --- | --- | --- |
| `mp4box` | Unused dependency | `rg -n 'mp4box|MP4Box' src package.json` returned only `package.json` and the global branch in `FrameIndex.ts`; no module import existed. | `rg -n '<script' src/renderer/index.html` returned only `/src/main.tsx`, so `window.MP4Box` was never installed and the reachable path was `buildUniformIndex(url, 'aac', 1024)`. | Removed the unreachable branch with `npm uninstall mp4box`; M4A/AAC still delegates to the same uniform index. |
| `formatDuration` | Unused export | `rg -n -w 'formatDuration' src package.json` returned the main-process definition and a separate renderer-local helper in `FileInfoPanel.tsx`; nothing imported the main helper. | Knip's main entry graph found no consumer, and IPC registration does not reference it. | Removed the main helper and stale renderer-sharing comment; kept the live renderer-local helper. |
| `WhisperTranscriber` | Unused export | `rg -n -w 'WhisperTranscriber' src package.json` returned the class, comments, and same-file singleton construction only. | `rg -n -w 'whisperTranscriber' src` traced the exported singleton to `transcript.ipc.ts` handlers. | Made the class module-private; retained the runtime singleton and all transcription behavior. |
| `APP_FILE_MIME` | Unused export | `rg -n -w 'APP_FILE_MIME' src package.json` returned only its definition. | No Electron dialog, protocol, preload, or renderer entry referenced the value. | Removed the constant. |
| `AudioSourceSchema` | Unused export | `rg -n -w 'AudioSourceSchema' src package.json` returned its definition, the unused derived alias, and `ProjectFileSchema.source`. | `rg -n -w 'ProjectFileSchema' src` traced runtime `.parse()` calls in `project.ipc.ts` and `render.ipc.ts`. | Kept the schema and made it module-private; removed only the unused `AudioSource` alias. |
| `WordSchema` | Unused export | `rg -n -w 'WordSchema' src package.json` returned its definition, live `Word` inference, and `TranscriptSchema.words`. | The nested schema reaches runtime through `ProjectFileSchema.parse`; `Word` has main and renderer consumers. | Kept the schema and made it module-private. |
| `SpeakerSchema` | Unused export | `rg -n -w 'SpeakerSchema' src package.json` returned its definition and `TranscriptSchema.speakers` only. | The nested schema reaches runtime through `ProjectFileSchema.parse`. | Kept the schema and made it module-private. |
| `TranscriptSchema` | Unused export | `rg -n -w 'TranscriptSchema' src package.json` returned its definition, live `Transcript` inference, and `ProjectFileSchema.transcript`. | Runtime parsing is performed by the main-process project/export IPC handlers. | Kept the schema and made it module-private. |
| `EditTypeSchema` | Unused export | `rg -n -w 'EditTypeSchema' src package.json` returned its definition, unused derived alias, and `EditSchema.type`. | It remains in the runtime root-schema graph through `EditSchema`. | Kept the schema module-private; removed only the unused `EditType` alias. |
| `EditSchema` | Unused export | `rg -n -w 'EditSchema' src package.json` returned its definition, unused derived alias, and `ProjectFileSchema.edits`. | `rg -n 'legacy|migrat|sourceFiles\.length|tracks\.length' src` confirmed the legacy `edits[]` migration and backward-compatible save path in `App.tsx`. | Kept the runtime schema module-private; removed only the unused `Edit` alias. |
| `GainAdjustmentSchema` | Unused export | `rg -n -w 'GainAdjustmentSchema' src package.json` returned its definition and `AdjustmentSchema` member only. | It remains in the runtime root-schema graph through `AdjustmentSchema`. | Kept the schema and made it module-private. |
| `CrossfadeAdjustmentSchema` | Unused export | `rg -n -w 'CrossfadeAdjustmentSchema' src package.json` returned its definition and `AdjustmentSchema` member only. | It remains in the runtime root-schema graph through `AdjustmentSchema`. | Kept the schema and made it module-private. |
| `AdjustmentSchema` | Unused export | `rg -n -w 'AdjustmentSchema' src package.json` returned its definition, unused derived alias, and `ProjectFileSchema.adjustments`. | Runtime parsing is performed by the main-process project/export IPC handlers. | Kept the schema module-private; removed only the unused `Adjustment` alias. |
| `MarkerSchema` | Unused export | `rg -n -w 'MarkerSchema' src package.json` returned its definition, unused derived alias, and `ProjectFileSchema.markers`. | Runtime parsing is performed by the main-process project/export IPC handlers. | Kept the schema module-private; removed only the unused `Marker` alias. |
| `ExportSettingsSchema` | Unused export | `rg -n -w 'ExportSettingsSchema' src package.json` returned its definition, unused derived alias, and `ProjectFileSchema.export`. | Runtime parsing and defaults remain exercised through `ProjectFileSchema.parse`. | Kept the schema module-private; removed only the unused `ExportSettings` alias. |
| `PluginDataSchema` | Unused export | `rg -n -w 'PluginDataSchema' src package.json` returned its definition and `ProjectFileSchema.pluginData` only. | It remains in the runtime root-schema graph and preserves plugin metadata parsing. | Kept the schema and made it module-private. |
| `EffectSchema` | Unused export | `rg -n -w 'EffectSchema' src package.json` returned its definition, unused derived alias, and both clip/track effect arrays. | It remains in the runtime root-schema graph through `ClipSchema` and `TrackSchema`. | Kept the schema module-private; removed only the unused `Effect` alias. |
| `ClipSchema` | Unused export | `rg -n -w 'ClipSchema' src package.json` returned its definition, live `Clip` inference, and `TrackSchema.clips`. | The nested schema reaches runtime through `ProjectFileSchema.parse`; `Clip` has renderer/main consumers. | Kept the schema and made it module-private. |
| `TrackSchema` | Unused export | `rg -n -w 'TrackSchema' src package.json` returned its definition, live `Track` inference, and `ProjectFileSchema.tracks`. | The nested schema reaches runtime through `ProjectFileSchema.parse`; `Track` drives both players and export. | Kept the schema and made it module-private. |
| `SourceFileSchema` | Unused export | `rg -n -w 'SourceFileSchema' src package.json` returned its definition, live `SourceFile` inference, and `ProjectFileSchema.sourceFiles`. | The nested schema reaches runtime through `ProjectFileSchema.parse`; `SourceFile` has timeline consumers. | Kept the schema and made it module-private. |
| `Segment` from `WebCodecsPlayer.ts` | Unused exported type | `rg -n -w 'Segment' src package.json` showed the canonical export in `buildSegments.ts`, the internal WebCodecs import, and only the redundant re-export in `WebCodecsPlayer.ts`. | The player uses the direct `buildSegments.ts` import; no entry imports `Segment` from the player. | Removed only the redundant re-export and stale suppression comment. |
| `TimeRange` | Unused exported type | `rg -n -w 'TimeRange' src package.json` returned only the definition and same-file store fields/actions. | Zustand state consumes it internally; no external or dynamic API exposes the name. | Made the interface module-private. |
| `AudioSource` | Unused exported type | `rg -n -w 'AudioSource' src package.json` returned only the alias definition. | The underlying schema remains in `ProjectFileSchema`; deleting a type alias cannot affect runtime parsing. | Removed the alias. |
| `EditType` | Unused exported type | `rg -n -w 'EditType' src package.json` returned only the alias definition. | The underlying enum schema remains in `EditSchema`. | Removed the alias. |
| `Edit` | Unused exported type | `rg -n -w 'Edit' src package.json` found the alias definition plus prose uses of the English word, with no type import. | The runtime edit schema and legacy migration path remain intact. | Removed the alias. |
| `Adjustment` | Unused exported type | `rg -n -w 'Adjustment' src package.json` returned only the alias definition. | The runtime discriminated-union schema remains in `ProjectFileSchema`. | Removed the alias. |
| `Marker` | Unused exported type | `rg -n -w 'Marker' src package.json` returned only the alias definition. | The runtime marker schema remains in `ProjectFileSchema`. | Removed the alias. |
| `ExportSettings` | Unused exported type | `rg -n -w 'ExportSettings' src package.json` returned only the alias definition. | The runtime export schema and defaults remain in `ProjectFileSchema`. | Removed the alias. |
| `Effect` | Unused exported type | `rg -n -w 'Effect' src package.json` returned only the alias definition. | The runtime effect schema remains in both clip and track schema graphs. | Removed the alias. |

## Additional candidates and dynamic guards

| Candidate | Finding type | Reference evidence | Dynamic-entry check | Decision |
| --- | --- | --- | --- | --- |
| `@rollup/rollup-linux-arm64-gnu` root optional dependency | Package audit | `git log -S'@rollup/rollup-linux-arm64-gnu' --oneline -- package.json` traced it to initial commit `17fd049`; `npm explain @rollup/rollup-linux-arm64-gnu` reported it absent on the current macOS host; `npm explain rollup` traced Rollup 4.59.0 through Vite. | `node -p "JSON.stringify(require('./node_modules/rollup/package.json').optionalDependencies, null, 2)"` showed Rollup itself owns exact `@rollup/rollup-linux-arm64-gnu: 4.59.0`; the lockfile retains that transitive optional edge. | Removed the redundant root declaration with `npm uninstall @rollup/rollup-linux-arm64-gnu`; no Knip exception was needed. |
| `color-bg-hover` | Theme token | `rg -n 'color-bg-hover' src` returned only the dark/light definitions. | `theme.store.ts` injects every JSON key generically, but no CSS/JS consumer requests this property. | Removed from both themes. |
| `color-accent-hover` | Theme token | `rg -n 'color-accent-hover' src` returned only the dark/light definitions. | Generic theme injection is not a rendered consumer. | Removed from both themes. |
| `color-success` | Theme token | `rg -n 'color-success' src` returned only the dark/light definitions. | Generic theme injection is not a rendered consumer. | Removed from both themes. |
| `waveform-progress-color` | Theme token | `rg -n 'waveform-progress-color' src` returned only the dark/light definitions. | `rg -n 'var\(--waveform|waveColor|progressColor|cursorColor' src/renderer/src` showed WaveSurfer derives progress color from each track color instead. | Removed from both themes. |
| `waveform-cursor-color` | Theme token | `rg -n 'waveform-cursor-color' src` returned only the dark/light definitions. | Waveform configuration had no cursor-token reference. | Removed from both themes. |
| `waveform-region-muted` | Theme token | `rg -n 'waveform-region-muted' src` returned only the dark/light definitions. | No Regions plugin or generated region consumer is registered. | Removed from both themes. |
| `waveform-color` | Guarded theme token | `rg -n 'waveform-color' src` confirmed the theme token family and waveform rendering path. | Retained as an intentionally supported base waveform theme value per task scope. | Kept. |
| `waveform-color-muted` | Guarded theme token | `rg -n 'waveform-color-muted' src` found the live `var(--waveform-color-muted)` consumer in `WaveformView.tsx`. | Applied dynamically by `theme.store.ts`. | Kept. |
| `--text-lg` | Static CSS token | `rg -n -- '--text-lg' src` returned only its definition. | No JSX style or dynamic property assignment references it. | Removed. |
| `--space-1` | Static CSS token | `rg -n -- '--space-1' src` returned only its definition. | No JSX style or dynamic property assignment references it. | Removed. |
| `--space-5` | Static CSS token | `rg -n -- '--space-5' src` returned only its definition. | No JSX style or dynamic property assignment references it. | Removed. |
| `--space-6` | Static CSS token | `rg -n -- '--space-6' src` returned only its definition. | No JSX style or dynamic property assignment references it. | Removed. |
| `.selectable` | CSS selector | `rg -n 'selectable|className=.*selectable|classList.*selectable' src` returned only the selector definition. | No JSX or DOM class assignment uses it. | Removed. |
| `.wavesurfer-region > div` | CSS selector | `rg -n 'wavesurfer\.js/dist/plugins/regions|RegionsPlugin|region-created|region-updated|addRegion|registerPlugin' src package.json` returned no matches. | Waveform rendering uses custom SVG clips, not generated Regions plugin elements. | Removed. |
| `ffmpeg-static` | Dynamic dependency guard | `rg -n 'ffmpeg-static|resolveFromStaticPackage|require\(packageName\)' src/main/audio/binaries.ts knip.jsonc package.json` traced the literal package name into runtime `require(packageName)`. | Apple Silicon binary resolution uses the static package only after Homebrew paths fail. | Kept the dependency and documented Knip exception. |
| `ffprobe-static` | Dynamic dependency guard | `rg -n 'ffprobe-static|resolveFromStaticPackage|require\(packageName\)' src/main/audio/binaries.ts knip.jsonc package.json` traced the literal package name into runtime `require(packageName)`. | Apple Silicon binary resolution uses the static package only after Homebrew paths fail. | Kept the dependency and documented Knip exception. |
| `SimpleAudioPlayer` | Supported fallback guard | `rg -n 'SimpleAudioPlayer|new SimpleAudioPlayer|WebCodecsPlayer' src/renderer/src` traced both fallback branches in `App.tsx`. | Instantiated when WebCodecs is unavailable or initialization fails. | Kept. |
| Legacy project migration | Runtime behavior guard | `rg -n 'legacy|migrat|sourceFiles\.length|tracks\.length' src` found legacy open migration, word fallbacks, compatibility save logic, and tests. | Reachable from `App.tsx` project open/save flows. | Kept. |
| Zod child schemas | Runtime behavior guard | `rg -n -w 'ProjectFileSchema' src` found runtime `.parse()` calls in three IPC paths and schema tests. | Child schemas are composed into the runtime root even when not imported individually. | Kept every schema; removed export visibility only. |
| `WORKLET_CODE` | Dynamic file/symbol guard | `rg -n 'WORKLET_CODE|audioWorklet\.addModule|new Blob|createObjectURL' src/renderer/src/audio` traced string export to Blob URL registration. | Runtime AudioWorklet consumer is invisible to ordinary file execution. | Kept. |

## Package-lock review

- `git diff -- package.json package-lock.json` shows `mp4box` and its package node removed.
- The root `@rollup/rollup-linux-arm64-gnu` optional declaration was removed, while `package-lock.json` retains Rollup's transitive platform package node and marks it `dev: true`.
- No application dependency other than `mp4box` disappeared; the Rollup platform package remains represented because Rollup still owns it.

## Result

- Post-edit `npm run deadcode`: exit 0, no findings.
- Post-edit `npx knip --files`: exit 0, no findings.
- Post-edit `npx knip --dependencies`: exit 0, no findings.
- No new Knip exceptions were added; the two existing dynamic binary exceptions were retained and clarified with the runtime consumer.

## Final Verification

Tested commit: `61412d67ed92efbd1a691ab21e7c464501a0a2d0` (`refactor: remove confirmed unused code`). The tracked worktree was clean before verification.

### Automated gate

`npm run check` exited 0. Its complete chained gate ran every component:

| Command | Exit status | Evidence |
| --- | --- | --- |
| `npm run format:check` | 0 | Prettier reported `All matched files use Prettier code style!` |
| `npm run lint` | 0 | ESLint completed with no findings. |
| `npm run deadcode` | 0 | Knip completed with no findings. |
| `npm run typecheck` | 0 | `tsc --build --noEmit` completed with no diagnostics. |
| `npm test` | 0 | Vitest reported 7 test files passed and 112 tests passed. |
| `npm run build` | 0 | electron-vite built main, preload, and renderer outputs successfully. |

The independent process-boundary searches both produced no matches (`rg` exit 1 is the expected no-match status):

- `rg -n "from ['\"](electron|node:|fs|path|child_process|@main/|@preload/)" src/renderer`: exit 1, no renderer imports of Node, Electron, main, or preload modules.
- `rg -n "from ['\"](@renderer/|.*renderer/)" src/main src/preload`: exit 1, no main/preload imports of renderer modules.

### Smoke test

`npm run dev` was first attempted in the sandbox. Main and preload built, but the renderer server could not bind `::1:5173` (`EPERM`), so that attempt exited 1. An escalated retry built main and preload, served the renderer at `http://localhost:5173/`, printed `starting electron app...`, and remained alive without additional terminal output until it was intentionally stopped with Ctrl-C. Desktop capture failed with `could not create image from display`, and macOS window inspection did not return because the required permission was unavailable. Repository search found no supported audio files or `.podcut` fixtures. `command -v` found `/opt/homebrew/bin/ffmpeg`, `/opt/homebrew/bin/ffprobe`, and `/opt/homebrew/bin/whisper-cli`, but dependency presence alone does not verify the corresponding UI paths.

| Smoke item | Status | Evidence and reason |
| --- | --- | --- |
| Electron window opens without a startup error | Not run | The dev process reached `starting electron app...` and stayed alive, but direct window observation was unavailable; terminal liveness is not sufficient evidence that a window opened. |
| Supported audio opens and generates a waveform | Not run | No supported audio fixture was present, and the window could not be controlled. |
| Playback starts, pauses, seeks, and stops at the end | Not run | No supported audio fixture was present, and the window could not be controlled. |
| Preview mode skips muted regions | Not run | No supported audio fixture was present, and the window could not be controlled. |
| Adding and removing a track produces no ghost audio | Not run | No supported audio fixture was present, and the window could not be controlled. |
| Successful playback has no routine debug logging; fallback warnings still use `SimpleAudioPlayer` with the primary source | Not run | No playback occurred and no fallback branch was exercised. |
| A current project saves and reopens | Not run | No current project fixture or controllable window was available. |
| A legacy project opens through migration | Not run | No legacy `.podcut` fixture was present. |
| Transcript generation availability reaches its existing success or actionable error state | Not run | `whisper-cli` is installed, but no media was available and the transcript UI could not be exercised. |
| Export dialogs reach their existing success or actionable error states | Not run | FFmpeg and FFprobe are installed, but no media/project was available and the export UI could not be exercised. |

### Retained narrow exceptions

- `knip.jsonc` ignores `ffmpeg-static` and `ffprobe-static` because `src/main/audio/binaries.ts` selects those Apple Silicon fallback package names at runtime and loads them through `require(packageName)`, which static dependency analysis cannot resolve.
- `src/main/audio/binaries.ts` suppresses `@typescript-eslint/no-require-imports` on that dynamic load because runtime `require(packageName)` permits the optional fallback to be selected by name and a missing package to be caught.
- `src/renderer/src/components/Waveform/WaveformView.tsx` suppresses `react-hooks/exhaustive-deps` for primary peak synchronization because the effect must run only when `peaks` changes; adding `tracks` would stamp the old primary peaks onto a newly added track ID.

### Remaining verification risk

Package 1 has a clean automated baseline, but all interactive smoke behaviors remain unverified for the reasons recorded above and require a manual run with supported media plus current and legacy project fixtures. The coverage inventories at the top of `timeline.store.test.ts` and `transcript.store.test.ts` omit some suites added during test colocation; Task 7 permits final-documentation edits only, so those test-file comments remain a deferred minor cleanup.
