# Track loudness effects and A2 controls

## Authorization and goal
The user approved proceeding without human design/plan review on 2026-09-21.
Use non-destructive speech loudness normalization to reduce level differences between people, including audio routed from synchronized replacement tracks.
Implement the approved A2 two-row track header: row one Sync, Mute, Solo (one column each), Volume (three columns); row two Effects (three), Gain (three).
All controls occupy one 26px-high grid row; level controls have no resting box, a subtle setting indicator, and hover/focus feedback.

## Audio semantics
A constant whole-track gain is insufficient for quiet and loud speakers within one Mix.
Normalize combines FFmpeg dynamic audio leveling with loudness normalization, using one shared fixed filter definition for playback preparation and export.
Defaults: dynaudnorm frame 500ms, Gaussian window 11, max gain 4, target RMS 0.1, coupled channels, silence threshold 0.01; loudnorm target -16 LUFS, true peak -1.5 dBTP, LRA 7, linear=false, final aresample=48000.
These are product defaults, not a promise that overlapping speakers can be independently isolated or every phrase reaches identical loudness.
Order: resolved sources/clip gain/redactions/crossfades → composite track → Normalize → manual track Gain → Volume → track summation.
Manual Gain is -24..+24 dB, defaults 0; volume retains its existing 0..1 meaning.
Gain after effects does not trigger normalization; positive gain can exceed the Normalize-stage peak ceiling, so no final-master limiter guarantee is made.
Linked children remain read-only, and their saved gain/effects do not affect sound routed into the master.
No original audio or project clips are rewritten.

## Data
Add optional validated gainDb to TrackSchema; absent means 0, preserving existing in-memory Track construction compatibility.
Add a typed normalize effect with params {targetLufs:-16,truePeakDbtp:-1.5,loudnessRange:7}, validate finite and supported parameter ranges.
Retain legacy gain/eq/compressor/noise-reduction effect records without executing unimplemented effects; do not discard them.
Project writes use version 4; v2/v3 inputs migrate explicitly, new controls are forbidden on older-version inputs to prevent silent downgrade.
Persist only settings; normalization PCM is regenerable, versioned and content-keyed, never an original media asset.
Effects highlight derives from any enabled effect; Normalize is unique per track and menu state derives from its enabled value.

## Runtime and ownership
Shared TrackEffects module owns defaults, activation, gain conversion and the exact filter string.
TrackRenderPlan includes optional gainDb and normalize parameters.
Main process prepares one fully assembled track to temporary Float32 PCM using managed FFmpeg; bounded reads return samples through typed IPC/provider adapters without exposing filesystem paths.
Requests are validated against the active workspace/session and source identities; never accept arbitrary file paths or executable arguments.
WorkletAudioPlayer uses the processed track as a provider when Normalize is enabled, awaiting preparation before playing; raw path remains unchanged when disabled.
Cache keys include source content identity, contribution timing/gain/envelopes, mode, normalization parameters and algorithm revision, exclude post-effect gain/volume/name/color.
Playback timeline and edited modes prepare their own exact compositions; export uses edited composition. Never reuse PCM prepared for a different mode.
Stale jobs/results must not be attached after newer edits, project change, seek/rebuild or destroy.
Preparation failures surface through player error/UI, never silently fall back to dry audio while showing ready.
Bounded IPC reads and disk-backed PCM keep memory independent of recording length.
Export places the same filter chain after each track's contribution mix and before manual gain/volume.

## Editing and UI
Use existing track snapshots for undo/redo. Add dedicated level/effect mutations; each slider gesture is one undo item, not one per sample of pointer movement.
TrackLevelControl owns popover interactions, keyboard support and local draft during a drag; commit once on completed gesture; Escape dismisses/cancels local editing safely.
TrackEffectsMenu uses icon+label+chevron, aria-pressed for button and menuitemcheckbox for Normalize.
Applied Normalize remains checked on reopen, can be disabled/re-enabled without losing params, persists and undoes/redoes.
Do not place action buttons beside track name; preserve remove/expand access via a separate safe context action, rather than removing functionality.
Reuse project localization, icon and popover patterns; Simplified Chinese and English labels.
Do not change waveform source cache or claim waveforms visualize processed peaks.

## Validation
Unit tests: schema versions, finite/range validation, linked-source routing, gain conversions, filter ordering, undo and one-step gesture commits, menu persistence/highlight.
Runtime tests: stale preparation, cancellation/project disposal, seek consistency, preparation/read failures, bounded PCM reads, gain-only changes without normalization rebuild.
Audio integration with managed FFmpeg: alternating loud/quiet speech-like signals, replacement audio included, output gap reduced, silence remains finite, stereo coherent, source hash unchanged, playback/export stage equivalence.
Run npm run format, npm run check, and targeted acceptance using the repository Docker MCP agent-testing workflow.
If Docker MCP is unavailable, disclose UI/audio acceptance as BLOCKED, not PASS; do not launch host Electron as a substitute.

## References
- https://ffmpeg.org/ffmpeg-filters.html#dynaudnorm
- https://ffmpeg.org/ffmpeg-filters.html#loudnorm
- Existing src/shared/audio/AudioRenderPlanBuilder.ts and src/main/audio/export/FfmpegPlanCompiler.ts
