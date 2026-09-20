# Managed Diarization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare diarization outside the app and ship it as a verified offline asset.
**Architecture:** CLI installs pinned model files into a separate managed model root. ModelRegistry resolves that root; ResourceManager validates readiness and UI presents it without HF controls.
**Tech Stack:** Node.js, TypeScript, Electron, React, Python/pyannote.
**Spec:** `docs/superpowers/specs/2026-09-19-managed-diarization.md`

## Global Constraints

Reuse `npm run runtime:setup`; no dev:setup command.
Dev `.runtime/models/diarization/<revision>`; release `resources/models/diarization/<revision>`.
No project schema changes; no application HF credentials or downloads for diarization.
Whisper/alignment downloads remain unchanged.

## Review Focus

- Optional model absence must not block transcription/alignment or audio editing.
- Refresh after external setup must upgrade missing to ready without restart.
- Packaged builds must ignore external development model paths.
- CLI partial failures must preserve an earlier valid installation.
- Model weights and release notices must be validated rather than merely present.

### Task 1: CLI provisioning and release assets

**Files:** scripts/runtime/SetupRuntime.mjs; new focused scripts/runtime model modules and tests; speech-worker/models.json; scripts/StageReleaseResources.mjs; runtime model license resources.
**Interfaces:** installation directory `<modelsRoot>/diarization/<revision>`; installation.json retains `{id, repository, revision, files}`; files use committed size and SHA-256 (or existing git blob hash for config). CLI adds `--models-root`, `--skip-models`, `--models-only`, `--import-model`; default root `.runtime/models`. Application consumes the same directory/record.
- [x] Write and run failing node tests for reuse without auth, corruption, noninteractive behavior, skip, failed promotion and release omission.
- [x] Pin authenticated upstream hashes; preserve trusted original metadata provenance without credentials.
- [x] Implement staged downloads with hidden credential input / HF_TOKEN or existing local HF login; validate local pyannote load before promotion; import verified legacy directory when explicitly requested.
- [x] Wire existing setup and release stage; release copies only allowlisted model assets and attribution.
- [x] Run `npm run test:runtime`; report actual acquisition and load evidence separately.

### Task 2: App model resolution and readiness

**Files:** src/main/resources/ModelRegistry.ts, ResourceManager.ts, new ManagedModelLocation.ts; src/main/index.ts; src/shared/resources.types.ts and developmentEnvironment.types.ts; tests.
**Interfaces:** optional ModelRegistry managed configuration `{root, source:'development-runtime'|'bundled', displayRoot}`. ResourceState adds optional source. DevelopmentEnvironment adds optional `diarization` record `{id,revision,path,status,error?}`. Native `ready` excludes optional model availability.
- [x] Write failing tests for root selection, packaged override isolation, corruption and external setup refresh.
- [x] Route only diarization through managed root; reuse existing immutable installation checks with fixed manifest hashes.
- [x] Publish checking/ready/missing/invalid state; load-validate ready model on initial/explicit refresh, no HF calls.
- [x] Reject application diarization preparation with managed-model-required if missing, retain ready no-op.
- [x] Run targeted resource and location tests.

### Task 3: UI and obsolete authorization cleanup

**Files:** speaker and development panels, resources store, locale resources; preload and IPC contracts; obsolete HF services/dialog/tests; main initialization.
- [x] Add UI/store tests for toggle-only public view and Runtime model checks with missing guidance.
- [x] Remove token/auth/download UI and IPC; clean only app-owned old token file on startup.
- [x] Add Runtime model status/path/Validate; leave tool/Python readiness independent.
- [x] Run targeted UI/IPC tests and typecheck.

### Task 4: Integration, documentation and acceptance

**Files:** Docker harness model integration as needed; README; docs/speech-models-and-dependencies.md; docs/architecture-standards.md; report archive.
- [x] Adapt explicit Docker model-root provisioning; preserve existing transcribe/align fixtures.
- [x] Update authoritative setup docs and architecture descriptions.
- [x] Run `npm run format`, `npm run check`, `npm run test:runtime`, Python worker tests.
- [x] Run Docker MCP baseline plus onboarding/Settings model availability, bilingual/theme/narrow layout checks.
- [x] Verify real model offline loading/inference and release resource failure/success paths where supported.
- [x] Request independent whole-branch review, resolve findings, archive evidence and commit. Do not merge or publish.
