# Managed diarization model assets

Approved by the user on 2026-09-19. Implement in an isolated worktree from main.

## Behavior

Reuse `npm run runtime:setup` to prepare the native runtime and optional diarization model.
An existing valid model is reused without Hugging Face authentication.
For missing models the CLI explains HF registration, acceptance on the pinned model's page, and read credentials; interactive input is hidden and noninteractive execution never waits for input.
Allow explicit skip without blocking ordinary editing.
Download pinned files into staging, verify against committed hashes, load-test offline, and promote only a complete installation.
Dev location is `.runtime/models/diarization/<revision>`; packaged location is `resources/models/diarization/<revision>`.
An explicit dev model-root override supports the Docker harness; packaged builds ignore overrides.
Existing userData models may be imported by CLI after verification; never remove old models automatically.
Only diarization changes provisioning ownership; Whisper and alignment retain their application download flow.

## App

Both onboarding and Settings remove HF authentication and diarization download controls.
Speaker recognition retains a toggle and actionable availability text.
The development Runtime panel adds model status, path, Validate, and CLI setup guidance.
The app validates and loads models without downloading or authenticating.
Optional model absence must not block native runtime readiness or other models.
Refresh must discover a newly provisioned model without restarting the app.
Remove obsolete HF IPC, renderer state, dialogs and main services; remove only the app-owned legacy token file, not global HF credentials.
Project schemas, analysis result formats and existing user choices remain compatible.

## Distribution

Release resource staging requires the pinned verified model and its license, source attribution and change notice.
No credentials or HF cache directories enter release assets.
The full third-party inventory, signed installer and notarization audit remain later release work.

## Verification

Test setup reuse, skipped models, noninteractive missing credentials, interruption, invalid hashes, stale versions, offline model load, path override isolation, refresh, UI controls, and stage failure on missing/corrupt model.
Run format/check, runtime tests, Python worker tests and Docker MCP baseline plus targeted Settings/onboarding checks.
Record real HF acquisition and real offline model inference separately from fixtures; disclose unavailable evidence.
