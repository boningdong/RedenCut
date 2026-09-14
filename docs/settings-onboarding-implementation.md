# Settings and onboarding implementation

## Delivered development functionality

- Settings replaces the transport theme action and offers General (language), Theme, and Speech & resources.
- Main-owned preferences persist theme IDs, language, feature switches, and explicit onboarding completion/skip.
- Welcome, preparation, and project entry reuse the approved mock and shared resource panel.
- Managed resources use pinned model revisions, verified file checksums, staging/resume, cancellation, and a real load check before publishing readiness.
- Preparation includes one multilingual Whisper model and Chinese/English alignment; optional speaker recognition requires explicit Hugging Face access verification before download.
- Tokens are encrypted with Electron safeStorage, never returned to the renderer or passed to inference workers.
- Analysis snapshots feature/model configuration, supports explicit skipped diarization, preserves source tracks, and reads existing version-1 artifacts.
- Sample and empty-project entry use normal project transition safeguards; the current sample is generated tones, not a speech demo.

## Automated verification

The existing Docker MCP harness drives the real Electron renderer; no host Electron instance is used.
The settings/onboarding scenario is documented in `e2e/scenarios/settings-onboarding-workflow.md` and implemented in `e2e/settings-onboarding.e2e.ts`.
Existing editor regression scenarios now dismiss first-run onboarding through the visible UI.

- `npm run format` and `npm run check`: passed; formatting, lint, dead-code analysis, TypeScript, 116 test files / 795 tests, and application build.
- Python worker unit tests: 29 passed; optional diarization, model paths, schema and offline validation contracts.
- Docker UI scenarios: 7 passed across targeted runs; first run/skip, persisted preferences, sample/empty entry, language changes, import/save/reopen, editing and audible playback.
- Docker harness lifecycle/fault tests: 13 files / 26 tests passed; host stdio smoke: 2 passed, covering startup/restart, diagnostics, trace retention, and clean process shutdown.

Deterministic resource/auth tests cover failure and recovery; they do not establish real download speed, live gated access, or transcription quality.
Evidence is retained under `.harness-runs/container/` in the implementation worktree.

## Deliberately deferred

Formal acceptance, real-model Chinese/English quality and mixed-language validation, packaging, signing, runtime bundling, and FFmpeg rebuild/license release work are excluded from this implementation run at the user's request.
Development requires available native speech executables and a configured Python speech environment; missing runtime dependencies produce a preparation failure before model downloads.
The packaged-runtime resolver boundary is present, but no standalone distributable or clean-machine setup success is claimed.
Actual gated model configuration/loading still needs an authorized account for live verification.
