# Shared Runtime Build Inputs Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make native and Docker builds consume one dependency definition while preserving their current platform recipes and versions.

**Architecture:** runtime/runtime-lock.json owns shared source records and explicit Linux overrides. A shared loader resolves those records; a shared downloader verifies archives. Docker build scripts consume the resolved configuration, while manifest writers derive component metadata from the same records.

**Tech Stack:** Node.js ES modules, POSIX shell, Docker multi-stage builds, node:test.

**Spec:** User-approved scope in this conversation: unify dependency inputs and Docker build scripts; defer full manifest-generator unification.

## Global Constraints

- Keep macOS LAME 4.0 and Linux LAME 3.100 as explicit platform choices.
- Preserve existing native build flags, Python dependency locks, and base/speech image layering.
- Keep downloads and compiler commands out of Dockerfiles.
- Use PascalCase for new JavaScript modules and preserve the user's uncommitted coding-standards changes.
- Do not commit changes until requested.

## Review Focus

- A shared dependency edit must affect Docker compilation and recorded metadata together.
- Linux overrides must not alter macOS dependency selection.
- Docker build contexts must include all imported modules without including application secrets.
- Source downloads must reject altered archives, including corrupt cached downloads.
- An unavailable Docker service must be reported as missing verification, never as a successful image build.

## Task 1: Shared build inputs

- [x] Add failing tests for platform resolution and checksum-verified downloads.
- [x] Implement RuntimeLock.mjs and DownloadRuntimeSource.mjs; migrate the native builder.
- [x] Record the existing Linux LAME dependency as an explicit override.
- [x] Run targeted tests.

## Task 2: Docker consumers

- [x] Add build scripts that download resolved native sources and stage NLTK data using shared helpers.
- [x] Keep Linux compilation in explicit recipes with paths supplied by the build scripts.
- [x] Read Python/uv versions and manifest component records from the resolved lock.
- [x] Update Dockerfiles and context allowlists; preserve frozen Python dependency installation and caching layers.
- [x] Test real local fixture downloads, recipe execution with controlled tool substitutes, and manifest generation.

## Task 3: Verification and handoff

- [x] Update developer documentation to point to the authoritative dependency inputs and describe platform overrides.
- [x] Run formatting and npm run check.
- [x] Build Docker images if Docker is accessible; otherwise document the exact blocker.
- [x] Review the final changes and report evidence and remaining limitations.


## Execution decisions and verification

Ruling: preserve the existing platform-specific LAME versions as an explicit Linux override; do not perform an unrelated dependency upgrade.
Ruling: keep native compilation before Python source copies and copy manifest scripts after compilation so source/metadata edits preserve expensive build caches.
Ruling: retain separate platform inventory generators in this change while deriving dependency component records from the resolved lock.
A fresh review identified workspace ownership and native-layer caching issues; both were fixed and the follow-up review reported no remaining actionable findings.
Full npm checks passed, including 1,645 application tests and 51 runtime tests after separating audio and speech coverage.
Final task-specific base and speech images built successfully.
The existing Docker harness started as its normal non-root user, copied current source, built the app, verified runtime inventory and ran real English/Chinese alignment with isolated caches and downloads blocked.
The smoke result was harness-speech-7.1.5-arm64 with one EN segment/11 characters and one ZH segment/4 characters.
This was build/runtime verification, not UI acceptance or transcription accuracy assessment.
No macOS runtime rebuild, DMG packaging or publication was performed in this change.
The implementation was committed in five focused commits covering shared inputs, the audio image, the speech image, usage documentation and coding standards.
Evidence is retained under /Users/boning/Workspaces/Podcut/output/shared-runtime-*-2026-11-11.log.
