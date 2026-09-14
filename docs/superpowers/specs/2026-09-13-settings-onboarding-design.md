# Settings and Onboarding Design

Date: 2026-09-13
Status: Architecture and behavior approved in conversation; implementation has not started.

## Goal and scope

Implement settings and onboarding in the existing Electron app using the approved [mock](../../ui-mock/2026-09-13/settings-onboarding.html).
Preserve its layout, typography, spacing, themes, control placement and interaction hierarchy except for the logo, which uses the existing application implementation.
Replace all simulated actions and progress with real operations; omit mock-only controls and notices.
Keep implementation within existing main/preload/renderer boundaries, Zustand state and shared localization.
Implement functionality first and distribution/packaging last.

## Approved product decisions

- Settings replaces the bottom-right theme button and contains General, Theme, and Speech & resources tabs.
- General contains only language selection.
- Themes use stable IDs, initially dark and light.
- Bundle the application runtime, native executables and locked Python environment; download models inside the app.
- Users do not install npm, uv, Python or Homebrew.
- First release uses one validated multilingual Whisper model, both Chinese and English alignment models, and one optional diarization model.
- Do not add model-size or language selectors in the first release.
- Explain Chinese and English support in the preparation step.
- Do not claim mixed-language alignment quality until separately verified.
- Do not scan or migrate old model caches; consume only ResourceManager-managed models.

## Ownership and modules

### Main services

| Module | Responsibility |
| --- | --- |
| Existing AppPreferencesStore | Validate and persist locale, theme ID, feature preferences and onboarding disposition; publish revisioned committed snapshots |
| ResourceManager | Resolve requested capability dependencies, coordinate preparation jobs, deduplicate work and publish resource snapshots |
| ModelRegistry | Inspect managed files and installation records, verify identity and provide usable model paths |
| ModelDownloader | Download files, report byte progress, preserve partial files, resume safely and verify integrity |
| HuggingFaceTokenStore | Securely save/read/delete the Hugging Face token, independently of normal preferences and projects |
| HuggingFaceAccessService | Check token access to the selected gated model and supply authentication to downloads |
| AppRuntimeLocator | Resolve Python, whisper.cpp, FFmpeg and FFprobe for development and packaged execution |
| Existing SpeechAnalysisCoordinator | Snapshot task settings and orchestrate transcription, alignment and optional diarization |

Main owns filesystem, credentials, processes and actual task state.
Preload exposes narrowly typed operations and subscriptions through IElectronAPI.
Renderer stores observable snapshots and transient presentation state, never filesystem truth.
Do not add a generic SettingsManager, OnboardingManager, RecoveryManager or authorization polling service.

### File organization

New main files:

- src/main/runtime/AppRuntimeLocator.ts
- src/main/resources/ResourceManager.ts
- src/main/resources/ModelRegistry.ts
- src/main/resources/ModelDownloader.ts
- src/main/resources/resourcePaths.ts
- src/main/speech/huggingface/HuggingFaceTokenStore.ts
- src/main/speech/huggingface/HuggingFaceAccessService.ts
- src/main/ipc/resources.ipc.ts
- src/main/ipc/modelAccess.ipc.ts

Move existing src/main/transcriber into src/main/speech/transcriber in a mechanical change, updating imports and tests.
Replace src/main/audio/binaries.ts with the single AppRuntimeLocator implementation once callers are migrated.
Extend existing preferences, speech IPC, SpeechWorkerClient and SpeechAnalysisCoordinator.

New shared contracts:

- src/shared/resources.types.ts
- src/shared/modelManifest.schema.ts
- src/shared/modelAccess.types.ts

Extend appPreferences.types.ts, ipc.types.ts, speechWorker.types.ts, speechArtifact.schema.ts and shared translation resources.
Keep speech-worker/models.json as the sole model manifest consumed by main and worker.

New renderer groups:

- components/settings: SettingsDialog, GeneralSettings, ThemeSettings, SpeechResourcesSettings.
- components/onboarding: OnboardingDialog, WelcomeStep, PreparationStep, StartCreatingStep.
- components/speech-resources: SpeechResourcesPanel, TextEditingResources, SpeakerRecognitionResources, ModelResourceRow, ModelAccessDialog.
- stores/resources.store.ts: snapshot hydration and progress subscription.
- themes/themeRegistry.ts: stable IDs, translated display names and existing theme tokens.

Extend the existing stores/locale.store.ts for the preference snapshot flow instead of introducing a second preference persistence system.
Keep theme.store.ts responsible for applying theme tokens, with persistence owned by main.
Keep active tab and onboarding step local to the containing component.
Add colocated meaningful tests and e2e scenarios, following existing repository conventions.

## Independent state dimensions

Preferences express intent: text editing enabled and speaker recognition enabled, both default true.
Installed resources express verified local availability, not whether an option is enabled.
Remote access status describes the last access check, not durable model readiness.
Onboarding disposition describes whether to show welcome automatically, not whether resources exist.
A completed download marker is not sufficient when files are missing or corrupt.
Local model inference does not require an ongoing authenticated connection.
Do not serialize token values, model absolute paths or resource-installation booleans into project files.

## Resource storage and preparation

Bundle executable code and runtime libraries in the app; store models under a platform-resolved app-managed data root, compatible with sandbox locations.
Organize models by capability, model ID and immutable revision, with separate staging/download records.
Record exact repository/revision, file list, byte sizes, integrity data, access conditions and supported language/capability in the manifest.
Do not use temporary OS caches as durable model storage.
Only publish verified installations atomically; analysis cannot consume staging files.

The first preparation action downloads missing multilingual transcription and Chinese/English alignment resources.
The alignment row aggregates both language model downloads and is ready only when both are verified.
Use actual downloaded/total bytes for progress; unknown totals must not produce invented percentages.
After transfer, display verifying until integrity and required load checks pass.
Skip existing valid resources.

Closing a dialog keeps preparation running.
Exiting the application cancels active transfer safely and preserves recovery records.
After restart, offer explicit resume rather than automatically starting network traffic.
Resume only when remote resource identity and range support permit it; otherwise restart the incomplete file while preserving completed valid files.
Cancel means stop active transfer while retaining resumable data; display Continue download afterward.
Disable related feature toggles during preparation and provide cancellation at the existing download-action position.
Do not introduce horizontal progress bars.

## Authorization

Unlock optional diarization setup after all base resources are ready.
Open the external model conditions page, accept a user-provided token, then require an explicit Verify access action.
Check access to required gated model files, not merely whether a token is valid.
No background timer and no simulated authorization-success action.
Show a loading state during verification and distinguish invalid token, access denied and network failure.
Successful verification unlocks download; it does not automatically start it.
Downloads must still handle expired/revoked access.
Renderer may submit a token but cannot read a saved token through IPC.
Do not persist tokens in logs, normal preference JSON, project artifacts or download recovery records.
Use platform-backed secret protection with a defined unavailable-backend failure; never silently fall back to plaintext.
Normal offline inference does not receive authentication credentials.

## Analysis and persistent results

At task start, main snapshots model IDs/revisions, automatic language strategy and speaker-enabled preference; no new per-task configuration dialog is introduced.
Settings changes apply to subsequent tasks, not in-flight work.
Preflight only requires enabled capabilities.
If speaker recognition is enabled but unavailable, surface an actionable preparation failure before starting rather than silently skipping it.
Pipeline: transcription, supported-language alignment, optional diarization, validation and atomic result publication.
Detect unsupported languages and present a translated support-range message; do not certify incorrect alignment.

Represent diarization as explicitly skipped because disabled or successfully completed with real results.
Completed-with-no-speakers differs from skipped; failures never become successful skipped results.
Update worker request/response validation and artifact validation consistently.
Preserve reading of existing v1 successful artifacts as completed results; do not rewrite projects merely by reading them.
Choose a versioned new representation and adapt rendering at the read boundary; maintain source/revision/fingerprint invariants.
When skipped, omit fabricated speaker/attribution data and present transcript using source-track identity.
Turning off recognition preserves previous project results, names and colors.
Re-analysis replaces previous results only after new results are successfully validated and saved; failure/cancellation preserves old results.

## Preferences and onboarding

Language and theme apply immediately without resetting the editor, playback or ongoing work.
Persist through main and surface save failures; keep revision ordering protections.
Migrate an existing valid localStorage theme only when no main-owned theme preference exists, without reintroducing model-cache migration.
Use onboarding disposition pending/completed/skipped, independent of capability readiness.
New users see welcome; explicit close/skip persists skipped; completion persists completed.
An unexpected process exit while still pending does not count as an explicit skip.
Upgrades preserve completed/skipped disposition.
Resources started before closing welcome continue while the application remains alive.
Final step opens a bundled sample through existing project operations or creates an empty project; protect existing unsaved work using existing project safeguards.
Shared resource UI appears directly in settings; it never requires restarting onboarding.

## Distribution deferred to last phase

Development may use explicitly configured existing runtimes through AppRuntimeLocator.
Packaged production uses bundled runtimes without PATH/Homebrew fallback.
Current local ffmpeg-static binary reports --enable-gpl, --enable-nonfree and nonredistributable status; it is a release blocker, not an approved distribution artifact.
Prepare traceable LGPL-compatible FFmpeg/FFprobe builds, corresponding sources, build configuration and license materials.
Audit exact runtime artifacts and transitive libraries, not only package metadata; include third-party notices and model attribution.
Finalize multilingual Whisper production model through actual quality/runtime validation; current Docker tiny model is smoke-only.
Measure bundle size rather than promise estimates.
Confirm initial CPU/OS targets and independent distribution versus Mac App Store priority before producing release artifacts.
Mac App Store sandbox, signing, review and GPL compatibility remain separate release checks; model downloads are not assumed automatically acceptable.

## Verification and completion

Use meaningful unit tests for state transitions, interrupted/resumed files, integrity failures, deduplication, revoked permissions and stale preference snapshots.
Test both diarization branches, prior artifact reads, unsupported language, cancellation and atomic replacement.
Run the repository baseline and approved new UI scenarios using the agent-testing workflow, with evidence and explicit blockers.
Compare settings/onboarding to the mock in dark/light and both UI languages, including locked, downloading, verifying, failed, resumed and ready states.
Validate real Chinese and English model execution; test mixed language separately and disclose its result.
Run npm run format and npm run check before claiming implementation complete.
Packaged acceptance additionally requires a clean environment without development runtimes, upgrade persistence and supported-architecture smoke tests.
Documentation-only design work does not run product UI acceptance and does not establish any of these implementation checks as passed.
