# Docker Harness Entrypoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give developers one clear Docker harness command for building, running, testing, model installation, and MCP use.

**Architecture:** A small `docker-harness.sh` dispatcher delegates to action scripts in named directories. Shared configuration resolves paths and image tags. Suite selection is explicit, and speech execution uses the current checkout's worker source while validating image-baked dependencies.

**Tech Stack:** POSIX shell, Docker, Node 24, Vitest, Electron.

**Spec:** `docs/superpowers/specs/2026-09-27-docker-harness-entrypoints-design.md`

## Global Constraints

- Keep separate base and speech Dockerfiles and tags; `build speech` builds the base first and passes its selected tag explicitly.
- The public dispatcher only selects actions; implementations live in action directories.
- `models install` may download into `/models`; tests never download implicitly.
- `/models`, `/test-models`, and `.runtime/models` remain distinct in this phase.
- Remove obsolete wrappers and npm aliases after migrating active references.

## Review Focus

- Missing or malformed action arguments must fail with actionable usage before Docker starts.
- Model and token paths with spaces must remain one Docker mount argument; token contents must never be printed.
- A speech test without a valid fixture must fail before Electron starts.
- A changed worker dependency manifest must fail on a stale speech image; a worker code edit must run from the current checkout.
- Host MCP startup must keep stdout protocol-only and preserve container shutdown behavior.

---

### Task 1: Public command contract and shared container runner

**Files:** Create `harness/container/docker-harness.sh`, `harness/container/config/HarnessEnvironment.sh`, `harness/container/run/RunContainer.sh`, `harness/container/build/BuildImages.sh`; test `harness/tests/docker-harness-commands.test.mjs`.

**Interfaces:** Dispatcher invokes private action scripts with the remaining arguments. Config defines repository, image tags, Docker executable, model volume, and error helpers. Run accepts `base|speech [--models ABSOLUTE_DIRECTORY] -- COMMAND [ARG...]`; build accepts `base|speech`.

- [x] Write command tests using a fake Docker binary: usage failures, build order and selected base tag, run mounts, explicit image, missing image guidance, and paths with spaces.
- [x] Run the command tests and confirm they fail on the absent entrypoint.
- [x] Implement dispatcher, config, build, and run actions; preserve container mounts, labels, name, and environment from the old runner.
- [x] Run the command tests and confirm they pass.

### Task 2: Named suites and speech source correctness

**Files:** Create `harness/container/test/RunSuites.sh`; modify `vitest.e2e.config.ts`, `package.json`, `e2e/diagnostics-failure.e2e.ts`, `e2e/support/McpTestSession.ts`, `harness/container/entrypoint.sh`; create `e2e/diagnostics-speech.e2e.ts` and focused classification tests.

**Interfaces:** `test harness|e2e-base|e2e-speech|e2e-all [--models ABSOLUTE_DIRECTORY]` maps to the correct image and npm suite. Speech worker and model manifest resolve from `/workspace/speech-worker`; image dependency lockfiles are checked against `/source`.

- [x] Write failing suite-selection and stale-image tests, including fixture rejection and active worker path.
- [x] Run them to observe failure.
- [x] Split the mixed diagnostics file, add explicit base/speech/all Vitest modes, and implement the test action and speech source validation.
- [x] Run focused tests and typecheck.

### Task 3: Models and MCP actions

**Files:** Create `harness/container/models/ManageModels.sh`, `harness/container/mcp/ServeMcp.sh`; modify `harness/tests/speech-container.smoke.mjs`, `harness/tests/container.smoke.mjs`.

**Interfaces:** `models install|check`; `mcp [base|speech] [--models ABSOLUTE_DIRECTORY]` delegates to run with the MCP server command.

- [x] Write failing fake-Docker tests for token resolution, offline check, MCP default/selection, and invalid options.
- [x] Run them to observe failure.
- [x] Implement models and MCP actions; migrate smoke tests.
- [x] Run focused command and smoke tests that do not require Docker.

### Task 4: Migration and verification

**Files:** Delete `harness/container/run.sh`, `harness/container/run-speech.sh`; modify active docs, error messages, and package scripts.

- [x] Update all active callers and documentation to the new commands; document the three model stores and exact suite scopes.
- [x] Remove old wrappers and npm aliases; search active files for stale references.
- [x] Run shell syntax checks, command tests, formatting, `npm run check`, and relevant runtime/release tests.
- [x] Build both images and run harness/base E2E, speech E2E when the fixture exists, and host MCP smoke; record any environmental blocker accurately.
- [x] Review the branch and resolve material findings before final handoff.
