# PR and Release Workflow Implementation Plan

## Status and Scope

Planning only; do not execute these tasks as part of writing this document.
The [approved design](../specs/2026-11-11-ci-workflow-design.md) owns the agreed groups, naming, triggers, and exclusions.
Deferred speech inference, harness fault suites, and new packaged-app behavior tests remain tracked in [issue #8](https://github.com/boningdong/RedenCut/issues/8).
Do not change branch protection, instruction files, or the agent-testing skill.

The requested `superpowers:writing-plans` skill was unavailable in this session; this plan was prepared directly from the approved design and repository inspection.

## Implementation Choices Worth Reviewing

1. Use Ubuntu 24.04 for code quality, unit tests, Docker integration tests, and Docker user workflows; use macOS 15 arm64 for the application Build job and release packaging.
2. Install only the locked Python packages required by worker unit tests, initially NumPy and NLTK plus their dependencies, rather than installing the complete speech runtime.
3. Preserve Docker's existing source-copy and application-build behavior for Linux tests.
   Build reuse applies to the macOS Build job and subsequent packaging; Linux containers still compile their own source copy, and existing harness restart/rebuild tests may compile again.
   Do not introduce cross-platform compiled-output reuse or modify harness startup to achieve a literal single compilation across every job.
4. Keep normal harness integration tests in Integration tests, but never invoke `docker-harness.sh test harness` from CI because that command includes deferred fault tests.
5. Preserve the existing scopes of `npm test` and `npm run check`, including existing runtime-dependent application tests.
   Introduce explicit CI suite commands rather than silently making developer checks download Python environments, launch Docker, or run additional UI suites.

These are implementation proposals, not claims that the environments or execution times have been verified.

## Target Jobs

| File                     | Jobs and execution                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `_code-quality.yml`      | Ubuntu: `npm ci`, then separately named formatting, lint, unused-code, and TypeScript steps                                         |
| `_build.yml`             | macOS arm64: `npm ci`, production build, build record, compiled-output upload                                                       |
| `_unit-tests.yml`        | Ubuntu JavaScript/TypeScript job for unit and existing script-tooling suites; separate Ubuntu Python 3.11 job for worker unit tests |
| `_integration-tests.yml` | Ubuntu Docker base image: application integration tests and normal harness integrations                                             |
| `_user-workflows.yml`    | Ubuntu Docker base image: existing base E2Es                                                                                        |
| `pr.yml`                 | Call all five shared workflows on PRs targeting `main` and pushes to `main`                                                         |
| `release.yml`            | Call all five on `v*` tags; package only after all pass, using their macOS Build artifact                                           |

Shared workflows use `workflow_call` only.
Keep existing serial execution within the application workflow test suite.
Record the actual runner architecture before producing or consuming a release build.
Use the repository-pinned Node and supported Python 3.11, not this session's Python 3.14.

## Task 1: Separate Test Discovery Without Losing Assertions

**Files:** `vitest.config.ts`, new `vitest.config.unit.ts`, new `vitest.config.integration.ts`, `package.json`, `knip.jsonc`, affected test files, and new `scripts/ci/TestSuiteMembership.test.mjs`.

1. Capture current discovered test files/cases for the default suite, harness modes, and E2E modes before edits.
2. Use `*.integration.test.ts` for application integrations and retain `*.integration.ts` for existing harness integrations.
3. Initially place these real-tool application cases in the integration suite:
   - `src/main/audio/effects/PreparedTrackService.integration.test.ts`.
   - `src/main/audio/export/PreparedExport.integration.test.ts`.
   - Actual PCM publication and MP3 decoding cases from `src/main/audio/import/FfmpegAudioSourceCacheBuilder.test.ts`.
   - Actual FFmpeg execution cases from `src/main/audio/export/FfmpegPlanCompiler.test.ts`.
   - `src/main/audio/redactionExport.test.ts`, including its FFmpeg fixture setup.
4. Keep `src/main/protocol/cacheProtocol.integration.test.ts` in the integration suite even though it does not need external tools; integration also includes real cross-module behavior.
5. Keep pure compiler assertions and fake-child cache-builder assertions in unit files when splitting mixed files.
   Preserve case names/assertions and avoid unrelated helper cleanup.
6. Remove hidden runtime requirements at the test boundary.
   For example, `probeAudio.test.ts` injects fake process creation but still calls real `getFfprobePath()` first; fake cache-builder cases need the same inspection.
   Use narrow module mocks or test-owned runtime fixtures without weakening production validation or adding system-tool fallback.
7. Add `test:unit` and `test:integration`; preserve `npm test` as the original application/harness-helper union.
8. Add a membership test proving unit and integration file sets are disjoint and together cover the original default scope, accounting for split files and `.spec` variants.
   Also compare case names/counts before and after splitting; file counts alone are insufficient.
9. Update Knip discovery if needed and fix inaccurate Vitest comments.

**Verification:** unit tests pass without any installed managed runtime; all moved cases appear in integration discovery; the full original suite passes on a prepared runtime; unclassified or duplicated fixture tests fail the membership guard.

## Task 2: Give Python Unit Tests a Small, Locked Environment

**Files:** `speech-worker/pyproject.toml`, `speech-worker/uv.lock`, `runtime/runtime-lock.json`, new `scripts/ci/RunPythonUnitTests.mjs` and `.test.mjs`, and `package.json`.

1. Add a unit-test dependency group for actual test imports, initially NumPy and NLTK.
2. Resolve it with the existing worker lockfile, keeping versions compatible with production; do not introduce a separately maintained requirements file.
3. Update Python dependency input hashes in `runtime/runtime-lock.json`, since runtime builds reject changed pyproject/lock hashes.
   Use an existing helper if available, otherwise add a small tested helper instead of manual hash transcription.
4. Obtain the uv version pinned by the existing runtime lock for CI without building the full runtime.
5. Add `test:python` with an explicit prepared-interpreter requirement and Python 3.11 validation.
   Run unittest discovery under `speech-worker/tests` with `speech-worker/src` on `PYTHONPATH` and propagate failures.
   Running the command must not implicitly install dependencies or download models.
6. In the Python workflow job, explicitly sync only the locked unit group and invoke the test command with that environment active.
7. Verify all ten worker test files run, including NLTK tests that create temporary sentence-table fixtures.
   Missing dependencies must fail rather than skip.
8. Do not install WhisperX, PyTorch, pyannote, models, or credentials unless inspection proves a selected test requires them.
   Report such a discrepancy before converting PR unit tests into a full speech-runtime build.

**Verification:** stale lock rejection, compatible locked versions, correct Python version, all worker files discovered, useful missing-environment errors, and runtime dependency hashes passing validation.

## Task 3: Pass Verified Build Files to Packaging

**Files:** new `scripts/ci/BuildArtifact.mjs` and `.test.mjs`, `scripts/PackageMac.mjs`, `scripts/release/PackageMac.test.mjs`, `scripts/release/PrepareRelease.mjs`, and `scripts/release/PrepareRelease.test.mjs`.

1. Add build-record creation/validation binding the entire compiled `out/` directory to its source commit, package version, package-lock hash, operating system, architecture, and compiled-file checksums.
2. Reject missing/incomplete output, wrong source/version/dependencies/target, and modified or missing files.
   Obtain expected main/preload/renderer entrypoint names from a real build rather than guessing.
3. Upload compiled output and record only, using ignored build locations.
   Do not upload credentials, model weights, runtime bundles, or `node_modules`; the packaging job still installs its own npm dependencies.
4. Add `--build-record PATH` to `package:mac`.
   Without the option retain local build-first packaging; with it validate and consume `out/` without invoking electron-vite build.
5. Add the corresponding option to `release:prepare`.
   Its default local path retains runtime and complete developer checks.
   Its explicit prebuilt CI path validates the record, retains runtime verification, skips repeated developer aggregate checks, and forwards the record to packaging.
   Release `needs` dependencies prove the checks passed; a claim in the record cannot replace that dependency graph.
6. Preserve resource/model staging, signing, document-type validation, packaged-runtime checks, final source-state checks, hashes, DMG verification, and draft safeguards.
7. Extend subprocess-trace tests to prove prebuilt CI packaging calls neither application build nor `npm run check`, while default local behavior retains checks/build.
   Use narrow dependency injection to test packaging execution without producing a DMG in unit tests if needed.

**Verification:** missing/stale/tampered records fail before packaging; supplied compiled bytes do not change; failures invalidate stale release metadata; existing release regression tests pass.

## Task 4: Implement the Five Reusable Workflows

**Files:** `.github/workflows/_code-quality.yml`, `_build.yml`, `_unit-tests.yml`, `_integration-tests.yml`, `_user-workflows.yml`.

1. Implement the target jobs with named steps, finite timeouts, read-only repository permissions, and checkout credential persistence disabled.
2. Pin supported actions to verified commit SHAs with readable version comments; keep versions consistent.
3. Have Build expose its uploaded artifact ID/name as workflow outputs.
   Packaging must download that exact artifact from the same execution, including retries, rather than searching previous PR builds.
4. Build the existing Docker base image through the documented command; do not build the speech image or native macOS speech runtime for these shared jobs.
5. Run application `test:integration` and normal `test:harness` through `docker-harness.sh run base -- ...`.
   Never use `test harness`, which dispatches to `test:harness:all` and includes deferred faults.
6. Use `docker-harness.sh test e2e-base` for User workflows, retaining speech exclusions and serial execution.
7. Pass a disposable empty models directory explicitly to each Docker job so runner state or inherited model-path variables cannot alter results.
8. Upload bounded logs/results and retained container evidence even on failure, with distinct artifact names per job.
   Ensure the host evidence directory is writable by the container's `node` user on GitHub Ubuntu without making the entire checkout writable or running tests as root.
9. Start with npm download caching and normal Docker builds; optimize persistent image caching after measuring cold runs.
   Do not publish images or provision persistent model infrastructure as part of this task.

**Verification:** fresh-run tool installation, private virtual audio, no host display/audio access, no models/credentials, normal harness cases selected, faults/speech absent, and useful failure evidence retained.

## Task 5: Connect PR and Release Entry Workflows

**Files:** new `.github/workflows/pr.yml`, existing `.github/workflows/release.yml`, existing `.github/workflows/checks.yml`.

1. Trigger PR checks for PRs targeting `main` and pushes to `main`, calling all five shared definitions.
2. Cancel superseded executions of the same PR with event-aware concurrency groups; preserve non-canceling releases per tag.
3. Keep the release `v*` trigger and existing release job ID where practical, with `needs` listing every shared check, not just Build.
   Do not use `always()` or `continue-on-error` to permit packaging after failed/canceled checks.
4. Download the exact Build artifact, install packaging prerequisites, validate platform/tag/version/commit, prepare native runtime and bundled model, then prepare the prebuilt release and upload the draft.
5. Preserve explicit release model directory and step-scoped credentials; never inherit model secrets into shared workflows.
6. Remove `checks.yml` only after every current check has an owner, including the maintenance regression under the inherited release model-path environment.
   Keep that targeted regression in the JavaScript/TypeScript unit job with a disposable model path and no model downloads.
7. Keep publication write permissions restricted to the release-only job; no protected-environment or repository-settings changes here.

**Verification:** failures/cancellation in any required group block packaging/upload; main-push coverage remains; old workflow no longer duplicates checks; model failures still stop publication.

## Task 6: Update Workflow Contract Tests

**Files:** `scripts/ci/WorkflowCommands.test.mjs`, new focused workflow-structure tests under `scripts/ci/`, and affected package test commands.

1. Preserve literal npm-entrypoint validation and runtime/model/packaging ordering/failure regressions.
2. Teach command extraction the documented Docker wrapper form containing `npm run` after `--`.
   Add positive/negative parser fixtures and continue rejecting arbitrary Bash composition.
3. Validate local workflow references, `workflow_call`, entry triggers, release dependencies, artifact consumption, permissions, model credential boundaries, and deferred-suite exclusion.
4. Update release subprocess fixtures for prebuilt execution without weakening runtime/model verification or the local developer-command tests.
5. Add negative fixtures for missing shared files, omitted dependencies, all/fault harness commands, missing npm entrypoints, and secrets passed into shared checks.

**Verification:** each negative fixture fails for the intended reason and the current complete tooling/release suites pass.

## Task 7: Update Documentation and Verify Locally

**Files:** affected sections of `README.md`, `e2e/README.md`, `harness/container/README.md`, `docs/speech-models-and-dependencies.md`, and a focused CI reference under `docs/` if needed.

1. Document concrete command prerequisites, CI group scope, Python environment setup, prebuilt packaging, and the Linux/macOS build distinction.
2. Link to `package.json` for command definitions rather than duplicating them as policy; preserve manual speech/fault commands and link issue #8.
3. Run targeted unit/Python/tooling/release tests, actionlint workflow validation, and Docker integration/user suites.
4. Run `npm run format` and `npm run check` with a prepared native runtime; inspect the diff and separate unrelated mechanical formatting.
5. This pipeline change does not change product behavior or agent-testing instructions, so adaptive product UI acceptance is not required.
   Executing existing fixed Docker tests is still required to validate the actual CI commands.

**Verification:** documented commands match scripts, dependency hashes validate, test selection is complete, workflow YAML passes validation, and unavailable runtime/Docker prerequisites are disclosed.

## Task 8: Verify GitHub Execution Before Handoff

1. After permission to push/open a PR, run the entry workflow through a PR targeting `main`.
   Creating production release tags, uploading drafts, or changing repository settings is not authorized merely to test the plan.
2. Inspect discovered cases/counts, runner architectures, model isolation, artifacts, failures, and elapsed times on actual GitHub machines.
3. Verify cold installations and Docker builds before optimizing their time.
4. Exercise artifact download and prebuilt macOS packaging during an authorized packaging-only trial or the next authorized release.
   Use the same packaging scripts, without draft upload in the packaging-only trial.
5. Use a disposable test repository or explicitly approved temporary workflow revision if real release-graph failure testing is necessary; do not deliberately break main or create production tags.
6. If packaging has not actually consumed the downloaded artifact, state that limitation even if mocked tests pass.

## Completion Criteria

- Shared definitions are reused by PRs, main pushes, and release tags as agreed.
- Existing assertions remain covered and Python unit tests run without the full inference environment.
- Fresh Ubuntu Docker integration/user jobs pass without models or secrets.
- Every selected check blocks release preparation on failure.
- Packaging validates and uses the exact macOS build without rebuilding it.
- Existing local commands and release safeguards remain available.
- Deferred work stays deferred in issue #8.
- Handoff distinguishes local verification, actual GitHub execution, and any unverified release behavior.
