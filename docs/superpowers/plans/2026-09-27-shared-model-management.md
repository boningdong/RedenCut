# Shared Model Management Implementation Plan

> **For agentic workers:** Use executing-plans for the shared core and dispatch independent runtime/release and Docker integrations with explicit file ownership.

**Goal:** One verified model format and path contract across developer preparation, application downloads, Docker tests and packaged releases.

**Architecture:** Reuse ModelRegistry and ModelDownloader for installations. Resolve models path from explicit CLI override, REDENCUT_MODELS_PATH, then the platform RedenCut data directory. Diarization stays CLI-prepared in development and bundled in releases; worker receives explicit verified model paths.

**Spec:** Agreed design in docs/speech-models-and-dependencies.md, Model storage and release policy, plus the approved command and path discussion.

## Global Constraints

- Default macOS root: ~/Library/Application Support/RedenCut/models.
- All model directories: <capability>/<model-id>/<revision>; installation.json records identity and file integrity.
- setup:runtime handles tools only; setup:models installs weights; check:models is offline.
- --models-path overrides REDENCUT_MODELS_PATH; installation never persists a new default.
- Docker reads one host model root through a read-only /models mount; tests never download.
- Release staging bundles diarization under Resources/models with required notices, without credentials.
- Remove superseded aliases and scripts after updating active callers. Preserve historical plans.

## Review Focus

- Paths containing spaces, invalid flags, and custom roots propagate without changing userData settings.
- Failed/repeated installations preserve existing valid models; credentials do not leak into logs, markers or inference.
- Gated diarization failure does not prevent independent public models from being prepared.
- Packaged model selection ignores developer overrides and keeps downloaded models writable.
- Missing/corrupt fixture fails speech testing before Electron; missing-model UI can still start.

## Task 1: Shared paths, installation, CLI and application

- [x] Add failing tests for path precedence, common diarization layout, atomic publication and imports.
- [x] Implement ModelsPath, Registry custom root, shared installation service and setup/check CLI with default/model selections, explicit verified imports and token lookup.
- [x] Route application resources and dev launcher through the same root; remove worker cache fallback in application inference.
- [x] Update focused tests and UI guidance.

## Task 2: Runtime and release integration

- [x] Test runtime-only setup and shared model staging.
- [x] Remove model setup responsibilities/flags from SetupRuntime; use shared model root for release copying and package overrides.
- [x] Migrate runtime setup naming and affected tests.

## Task 3: Docker integration

- [x] Test --models-path/default path, read-only mount, required model integrity and missing fixture guidance.
- [x] Replace multiple model mounts/volume and models install/check verbs; use common directory layout in E2E fixtures.
- [x] Remove superseded container model scripts and update targeted tests.

## Task 4: Migration, docs and verification

- [x] Remove native cache provisioning wrapper and obsolete npm aliases; update cleanup path behavior and active documentation with tables and diagrams.
- [x] Run format/check, focused CLI/runtime/release/command tests, real Docker harness/E2E/MCP, and UI acceptance.
- [x] Independent review, resolve material concerns, report evidence and remaining limits.

## Completion evidence

- npm check: 210 test files, 1588 tests, formatting/lint/Knip/typecheck/build passed.
- Real Docker harness: 26/26; complete speech E2E: 22/22; host MCP EOF/stop smoke: 2/2.
- Models CLI: 7/7; focused runtime/release/container tests: 67/67; final command rerun: 12/12; Python inference: 60 passed.
- Real native existing-model import, default-set integrity check and release diarization staging passed without downloading weights.
- Independent review concerns fixed; editing baseline and final UI reports retained under `.harness-runs/container/24aa7d7c-c73d-43ac-af8c-a4da7ce37c4f/` and `.harness-runs/container/df1da15e-ce4a-4dd5-94ee-c5e1c03518b3/`.
- Live HF download, signed packaging/notarization and clean-machine release validation were not run.
