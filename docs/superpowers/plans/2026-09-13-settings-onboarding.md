# Settings and Onboarding Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the current task; do not delegate unless subsequently authorized.

**Goal:** Implement the approved settings and onboarding mock with real model preparation, optional diarization and app-owned preferences.

**Architecture:** Main owns preferences, resource tasks, credentials and subprocesses; preload exposes typed operations; renderer uses shared components and Zustand snapshots. Runtime location is abstracted before packaging, which is the final phase.

**Tech Stack:** Existing Electron, React, TypeScript, Zustand, Zod, Python 3.11, whisper.cpp, WhisperX and pyannote stack.

**Spec:** [Settings and onboarding design](../specs/2026-09-13-settings-onboarding-design.md)

## Implementation status

Development implementation for Tasks 1–8 is present.
Automated regression and documentation portions of Task 9 are being recorded in [the implementation report](../../settings-onboarding-implementation.md).
The original checklist below remains the review checklist; unchecked acceptance items are not claims of completed verification.
Formal acceptance and Task 10 (including FFmpeg rebuilds) are explicitly deferred by the user.

## Global constraints

- Preserve the approved mock except the existing app logo, real authorization/recovery controls and Chinese/English support copy.
- No model/language selectors in the first release; prepare a fixed multilingual transcription model and both alignment languages.
- No model cache migration or production search of system model directories.
- Normal analysis never downloads, authenticates or installs dependencies.
- Keep settings changes independent of project edits and in-flight task configuration.
- Separate directory/import moves from semantic changes.
- Packaging and distribution happen last; the current nonredistributable FFmpeg is blocked from release.
- Actual CPU/OS release targets and production Whisper model require validation before release selection.

## Execution order and reviewable deliverables

### Task 1: Runtime boundary and mechanical directory organization

Files: create src/main/runtime/AppRuntimeLocator.ts and its test; move src/main/transcriber/* to src/main/speech/transcriber/*; update imports and src/main/ipc/speechAnalysis.ipc.ts; retire src/main/audio/binaries.ts after callers migrate.

- [ ] Read all current binary resolver callers and existing resolver/transcriber tests before moving files.
- [ ] Move the transcriber directory and update imports without changing behavior; run typecheck and affected tests.
- [ ] Add tests distinguishing explicitly configured development paths, packaged resource paths and missing executables.
- [ ] Expose getFfmpegPath(), getFfprobePath(), getWhisperExecutablePath(), getSpeechPythonPath() from one locator; inject development/packaged roots instead of duplicating path assembly.
- [ ] Route worker and native invocation through the locator; retain actionable errors and existing timeout/cancellation behavior.
- [ ] Verify no analysis caller constructs its own Python or executable location.

Deliverable: existing speech behavior works through one runtime boundary; no runtime packaging is added yet.

### Task 2: Managed model manifest and registry

Files: speech-worker/models.json, src/shared/modelManifest.schema.ts, src/shared/resources.types.ts, src/main/resources/resourcePaths.ts, ModelRegistry.ts and colocated tests; worker preflight/provisioning readers as required by manifest changes.

- [ ] Define capability/model/file identifiers, immutable revision, source, expected size, integrity metadata and access requirements in a shared validated manifest.
- [ ] Keep the existing smoke model distinct from the validated production model; measure candidate multilingual model behavior before setting the product default.
- [ ] Define local installation states as missing, incomplete, verifying, ready or failed with safe structured reasons.
- [ ] Test missing files, incorrect versions, corrupt files and interrupted installation records using isolated directories.
- [ ] Implement managed model paths and atomic installation registration; never consult legacy cache directories.
- [ ] Make readiness for alignment require both Chinese and English resources, while resolving the actual execution model by detected language.
- [ ] Ensure Python and main interpret the same manifest rather than maintaining independent lists.

Deliverable: deterministic inspection and resolution of model resources without network traffic.

### Task 3: Downloads and resource orchestration

Files: src/main/resources/ModelDownloader.ts, ResourceManager.ts, their tests, resources.types.ts, src/main/ipc/resources.ipc.ts, src/shared/ipc.types.ts, src/preload/index.ts and relevant existing IPC/preload tests.

- [ ] Define serializable resource snapshots with a monotonic revision and preparation IDs; main-only results may contain paths, renderer snapshots may not.
- [ ] Define typed get-snapshot, prepare-base, prepare-diarization, cancel, resume and snapshot-subscription operations.
- [ ] Test duplicate preparation requests, HTTP range acceptance/refusal, changed remote identity, checksum failure, insufficient space and cancellation using a deterministic local HTTP fixture.
- [ ] Implement streaming file writes with real byte counts, bounded error reporting and recoverable staging records.
- [ ] Resume only compatible partial content; otherwise restart only the incomplete file.
- [ ] Implement ResourceManager dependency selection, one shared preparation job and aggregation of alignment progress.
- [ ] Make dialog closure independent of job lifetime; implement process shutdown cancellation and explicit post-restart resume.
- [ ] Publish ready only after file verification and required load checks; keep analysis away from staging files.
- [ ] Test IPC subscriptions and ensure late events cannot regress newer renderer state.

Deliverable: real base-model preparation with interruption/recovery and no UI dependency.

### Task 4: Hugging Face access and token protection

Files: src/main/speech/huggingface/HuggingFaceTokenStore.ts, HuggingFaceAccessService.ts and tests; src/shared/modelAccess.types.ts; src/main/ipc/modelAccess.ipc.ts; ipc.types.ts; preload/index.ts.

- [ ] Define access states: unchecked, checking, granted, denied and failed, with reasons distinguishing invalid token and network failure.
- [ ] Implement platform-protected token storage and an explicit unavailable-protection error; prohibit plaintext fallback.
- [ ] Add tests proving no token appears in snapshots, errors, task persistence or project data.
- [ ] Implement explicit verification of required target-model file access, including redirect handling that does not forward credentials indiscriminately.
- [ ] Expose verify/store, recheck and delete operations, with no saved-token readback IPC.
- [ ] Require successful access checks before gated downloads and handle access revocation during transfer.
- [ ] Keep normal inference token-free and independent of online access when resources are already valid.

Deliverable: gated-model download is available after explicit real verification, without polling.

### Task 5: Optional diarization and durable results

Files: src/main/speech/SpeechAnalysisCoordinator.ts, SpeechWorkerClient.ts, transcriber/whisper.ts; src/shared/speechWorker.types.ts, speechArtifact.schema.ts, speech.types.ts as required; speech-worker/src/redencut_speech_worker/protocol.py, __main__.py, preflight.py; artifact reader/store and transcript projection callers found through references; colocated TypeScript and Python tests.

- [ ] Introduce a versioned request option for speaker recognition and snapshot it with model identities at task start.
- [ ] Test that the disabled path requires no diarization resources and never calls the diarization adapter.
- [ ] Test the enabled/missing-resource path fails preflight without silently downgrading.
- [ ] Introduce an explicit skipped-disabled versus completed result; retain existing source/revision/reference validation.
- [ ] Add fixtures proving existing v1 artifacts are readable as completed without rewriting project files.
- [ ] Adapt canonical projection to use source tracks for skipped analysis without inventing speaker IDs or attribution artifacts.
- [ ] Route transcription and alignment through registry-provided resources; reject unsupported language explicitly.
- [ ] Verify settings changes leave in-flight configuration and stored previous results unchanged.
- [ ] Test successful re-analysis atomically replaces results, and failures/cancellation preserve previous results.

Deliverable: both real pipeline paths are supported and existing successful project results remain readable.

### Task 6: Persisted preferences and theme registry

Files: existing AppPreferencesStore.ts, appPreferences.types.ts, appPreferences.ipc.ts, locale.store.ts, theme.store.ts and their tests; new themes/themeRegistry.ts; renderer bootstrap.

- [ ] Extend preference validation with stable theme ID, text/speaker defaults and onboarding pending/completed/skipped disposition.
- [ ] Preserve existing locale semantics and revision ordering; make legacy preference records receive compatible defaults.
- [ ] Test that valid existing localStorage theme is imported only when no main-owned theme exists.
- [ ] Apply theme without remounting the editor and persist main-owned changes; surface write failures.
- [ ] Preserve synchronous initial theme behavior as far as the existing bootstrap permits and verify no incorrect-theme flash during hydration.
- [ ] Test that stale preference responses cannot overwrite newer choices.

Deliverable: one authoritative preference system ready for both UI surfaces.

### Task 7: Shared resource UI and Settings

Files: components/settings/*, components/speech-resources/* listed in spec; stores/resources.store.ts; Transport/TransportBar.tsx; App.tsx; shared i18n resources; colocated UI tests.

- [ ] Replace the bottom-right theme action with Settings while retaining existing keyboard/focus conventions.
- [ ] Implement three tabs with General containing only language and Theme using the registry.
- [ ] Reproduce the mock resource hierarchy, aligned headings, switches, dividers and right-aligned status indicators.
- [ ] Subscribe once to main-owned resource snapshots and hydrate after opening; do not create a second task per surface.
- [ ] Implement real token entry and explicit Verify access UI with safe failure text and no simulation controls.
- [ ] Add cancel/resume at the existing download-action position; preserve byte progress spinners and verification states.
- [ ] Test switching tabs/closing dialogs during download, save errors, keyboard focus, language changes and unsupported resource states.

Deliverable: fully working Settings with direct resource management.

### Task 8: Onboarding and project entry

Files: components/onboarding/* listed in spec; App.tsx; existing project-open/new entry points; shared translations; bundled sample artifact and its attribution.

- [ ] Implement welcome copy, equal-size language/theme controls and compact footer from the approved mock.
- [ ] Reuse SpeechResourcesPanel for preparation with fixed Chinese/English support copy.
- [ ] Persist explicit close/skip, persist completion, and leave pending on unexpected process exit.
- [ ] Ensure completed/skipped onboarding does not reopen just because a model disappears.
- [ ] Provide a distributable sample project and use existing project safeguards for sample/new actions.
- [ ] Test first launch, skip, crash/restart, background downloads, sample opening and empty project creation.

Deliverable: complete first-run experience with real settings and resources.

### Task 9: Feature acceptance and documentation

Files: e2e/scenarios/settings-onboarding-workflow.md, scenario index and corresponding e2e tests; affected active architecture and speech dependency standards.

- [ ] Read and apply the agent-testing skill, then run the baseline and approved workflow through Docker MCP.
- [ ] Capture dark/light and Chinese/English screenshots against the mock for welcome, settings tabs, locked, downloading, failure, resumed and ready states.
- [ ] Run real-model Chinese and English workflows with diarization enabled and disabled; separately record mixed-language behavior.
- [ ] Run npm run format followed by npm run check, addressing actual failures rather than suppressing them broadly.
- [ ] Update current architecture/dependency standards to describe the implemented behavior and resource paths.
- [ ] Publish an evidence-backed acceptance report distinguishing mock/stub tests from real-model runs and noting unresolved checks.

Deliverable: validated application functionality before distribution work.

### Task 10: Distribution and clean-install acceptance

Files: package.json, release/build configuration chosen for the approved channel, runtime staging scripts and platform manifests, third-party license/source materials, release acceptance scenarios.

- [ ] Confirm release OS/architecture and channel priorities with the user before selecting channel-specific packaging policy.
- [ ] Produce distributable FFmpeg/FFprobe and whisper.cpp artifacts with reproducible version/source/configuration records.
- [ ] Stage a relocatable locked Python environment per supported platform and inspect all bundled binary/library licenses.
- [ ] Include corresponding notices/source delivery materials and required model attribution.
- [ ] Connect packaged runtime roots to AppRuntimeLocator and prohibit development PATH fallback.
- [ ] Build, sign and notarize the independent package; if Mac App Store is included, separately validate sandbox, child processes, model delivery and review constraints.
- [ ] Run from a clean environment without Node/npm/uv/Python/Homebrew, verify model preparation and analysis, then verify upgrade preserves installed resources.
- [ ] Measure installer size, installed size and actual download sizes; report platform coverage and remaining release blockers.

Deliverable: releasable artifacts, distinct from completion of development-environment functionality.

## Review checkpoints

Review each deliverable with its actual tests and changed contracts before advancing.
No product implementation or packaging verification is claimed by this document.
The approved architecture is stable; decisions still requiring evidence are exact production model selection, runtime package compatibility and release channel/platform coverage.
