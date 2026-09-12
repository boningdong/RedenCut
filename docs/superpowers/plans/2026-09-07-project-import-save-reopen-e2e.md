# Project Import Save Reopen Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to execute these tightly coupled tasks inline with verification checkpoints.

**Goal:** Prove real audio import, project save and reopen after full Electron restart in Docker.

**Architecture:** Purpose-specific Main dialogs use native behavior normally and a generation-scoped one-shot file mailbox in validated harness mode. Runtime prepares constrained filename/project selections through MCP; product E2E performs UI actions and independently checks saved media.

**Tech Stack:** Existing pinned Electron, Playwright MCP, TypeScript, Vitest, Docker and FFprobe.

**Spec:** `docs/superpowers/specs/2026-09-07-project-import-save-reopen-e2e-design.md` (user-edited version, filename selection, no fixture registry).

## Global constraints

- No host Electron launches or AI-client configuration changes.
- No playback, transcription, editing or export automation.
- Preserve unrelated document changes and conversation fixtures.
- Keep production dialogs unchanged and harness failures explicit.

## Task 1: Dialog protocol and filesystem boundaries

Files: `src/shared/harnessDialog.types.ts`, `src/main/dialogs/HarnessDialogMailbox.ts`, `harness/dialogs/prepareDialog.ts`, corresponding unit tests.
Interface: `prepareDialog(repositoryRoot, runDirectory, generation, request)` publishes one validated reply; `HarnessDialogMailbox(directory).consume(purpose)` consumes once and records failure/consumption.

- [x] Write tests using temporary directories: successful filename resolution, cancel, path traversal/symlink rejection, existing-save rejection, unconsumed reply rejection, mismatch consumption and missing-reply errors.
- [x] Run `npm test -- harness/tests/prepareDialog.test.ts` and observe missing capability failures; this suite also exercises the Main mailbox.
- [x] Implement strict schemas, plain filenames, canonical paths, generation mailboxes, atomic publication and event recording; no filesystem paths supplied directly by MCP.
- [x] Rerun focused tests until green.

## Task 2: Main composition and MCP lifecycle wiring

Files: `src/main/dialogs/ProjectDialogs.ts`, `src/main/dialogs/createProjectDialogs.ts`, `src/main/index.ts`, relevant IPC registration functions, `harness/runtime/`, `harness/mcp/`, harness startup validation.
Interfaces: Main methods choose import/save/open/dirty/export; Runtime exposes `prepareDialog` using existing generation guards and operation queue; MCP exposes `redencut_prepare_dialog`.

- [x] Add failing tests for stale generations, native/default routing and unsupported harness dialogs.
- [x] Inject purpose-specific dialog methods while retaining current native options and cancellation mapping.
- [x] Pass generation mailbox through launch configuration; clear pending replies on shutdown and isolate every generation.
- [x] Add structured dialog events to diagnostics and replace obsolete empty-state tool descriptions.
- [x] Run focused unit tests, type checks and build.

## Task 3: Real product acceptance and waveform readiness

Files: `e2e/project-import-save-reopen.e2e.ts`, `vitest.e2e.config.ts`, `package.json`, waveform component readiness and tests, `e2e/README.md`.
Interface: E2E uses the real in-process MCP facade/SDK client and Runtime inside Docker, not direct application-state mutation.

- [x] Add E2E: import the supplied short WAV, verify visible track/waveform, save, inspect schema/media checksum, restart, open saved project, verify restored identity/duration/waveform and clean exit.
- [x] Compare duration with independent `ffprobe`; assert original checksum before and after; preserve screenshots, trace and saved project.
- [x] Observe missing waveform readiness in a failing component test before implementation; the first Docker E2E run additionally exposed an incorrect test expectation about the default track name.
- [x] Add narrowly scoped waveform readiness observations tied to successful drawing, and verify their failure/loading behavior in a component test.
- [x] Run container E2E, full harness suite and host-to-container smoke tests; run host and container `npm run check` and inspect screenshots.
- [x] Review final diff and record results; preserve unrelated changes and leave integration to the user.

## Execution record

Baseline: existing isolated branch `feat/ui-debugging-harness`; dependency installation already present.
User-edited spec is authoritative; the only allowed audio selector is a plain filename under `e2e/fixtures/audio/`.

Completed verification on 2026-09-07 (local date):

- Docker product E2E: 1/1 passed; run `79474f0d-f987-4b6b-9e1b-4c2a4f4cf776`, with imported/reopened screenshots and saved project under `.harness-runs/container/`.
- Docker full harness suite: 23/23 passed, including dialog cancellation, generation isolation, restart cleanup and explicit unprepared-dialog failure.
- Host-to-container MCP stdio smoke tests: 2/2 passed, covering EOF and Docker stop cleanup.
- Host and Linux `npm run check`: both passed formatting, lint, Knip, type checking, 489 tests and build.
- Reopened screenshot inspected visually; waveform restored and independent FFprobe duration was 13.5 seconds.
- Persisted media and unchanged source fixture SHA-256 matched: `4f77b1c4f7c427c0268065c9132af5c99ad59def010c2fab10da7180ecaa45d4`.

Review identified three boundary gaps: destination creation during Save As staging, parent-directory replacement after preparation, and missing preparation-rejection evidence.
Added regression tests and fixes: harness-only create-exclusive publication, Main-side path revalidation, and retained Runtime rejection events.
Follow-up review reported no remaining blockers.
Production native dialog defaults are covered by regression tests, but no host Electron/manual native-dialog check was performed.
Playback, transcription and editing remain outside this acceptance slice.
