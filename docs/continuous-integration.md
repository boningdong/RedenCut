# Continuous Integration

## Entry Workflows and Shared Checks

[`pr.yml`](../.github/workflows/pr.yml) runs for PRs targeting `main` and pushes to `main`.
[`release.yml`](../.github/workflows/release.yml) runs for `v*` tags.
Both call the same underscore-prefixed reusable workflow files; those files run only through `workflow_call`.
The underscore is a repository naming convention, not a GitHub privacy setting.

| Group | Shared workflow | Environment and requirements |
| --- | --- | --- |
| Code quality | [`_code-quality.yml`](../.github/workflows/_code-quality.yml) | Ubuntu, pinned Node, npm dependencies; formatting, lint, unused-code analysis, and TypeScript are separate steps in one job |
| Build | [`_build.yml`](../.github/workflows/_build.yml) | macOS arm64, pinned Node, npm dependencies; compiles application code and uploads it with a build record |
| Unit tests | [`_unit-tests.yml`](../.github/workflows/_unit-tests.yml) | Separate Ubuntu JavaScript/TypeScript and Python jobs; no installed audio runtime, running Electron, or speech models |
| Integration tests | [`_integration-tests.yml`](../.github/workflows/_integration-tests.yml) | Ubuntu with Docker; base image supplies managed FFmpeg/FFprobe, Electron, virtual display and private virtual audio |
| User workflows | [`_user-workflows.yml`](../.github/workflows/_user-workflows.yml) | Same Docker base image; runs the existing base product E2Es without speech models |

Unit tests also run the existing runtime, model, release, maintenance, and workflow-tooling suites.
Those suites use temporary fixtures and controlled command substitutes; they do not provision models or create real release packages.
Integration tests include application `*.integration.test.ts` files and normal harness `*.integration.ts` files, excluding the fault suite.
The test-membership guard checks that application unit and integration groups together cover the complete default application/harness-helper scope without overlap.

Full command definitions live in [`package.json`](../package.json).
`npm test` retains its original complete application/harness-helper scope, including real FFmpeg tests, and therefore needs the managed audio runtime.
`npm run check` retains the existing developer verification scope; Docker workflows and the separately prepared Python unit environment are explicit additional commands.

## Python Unit Environment

Use Python 3.11 and the uv version recorded in [`runtime/runtime-lock.json`](../runtime/runtime-lock.json).
The worker's `unit` dependency group shares [`speech-worker/uv.lock`](../speech-worker/uv.lock) with production dependencies but installs only the small packages needed by model-free tests.

From the checkout root:

```sh
uv sync --project speech-worker --locked --only-group unit --python 3.11
REDENCUT_TEST_PYTHON="$PWD/speech-worker/.venv/bin/python" npm run test:python
```

The test command requires that prepared environment; it does not install packages or download models implicitly.
If worker dependency files change, regenerate their recorded hashes using `node scripts/runtime/UpdatePythonDependencyHashes.mjs` and validate the resulting lock diff.
Real speech inference is not covered by these unit tests.

## Docker Checks

Build the base image explicitly, then run the required suites through the [container entrypoint](../harness/container/README.md#run-tests).
CI passes an empty disposable model directory so pre-existing developer model files cannot affect the result.
The existing `test harness` shortcut includes deliberate-crash tests; CI uses `run base -- npm run test:harness` instead.
Do not replace that command with `test:harness:all` or a fault mode.

The Linux container builds its own copied application source when starting.
That build is separate from the macOS compiled application used for packaging; Linux success is not macOS distribution certification.
Container evidence is retained under `.harness-runs/container/` and uploaded by the integration/user workflow jobs, including after test failures.
Uploads are limited to test-owned directories with seven-day retention; hosted-runner ownership correction applies only to container evidence, not the checkout.

## Release Build Transfer

Every release tag reruns the shared checks against that tag's commit.
The release-only job waits for all selected groups, then downloads the exact artifact ID returned by the Build job in the same workflow execution.
It does not search for an earlier PR build.

`dist-electron/build-record.json` records the source commit, package version, npm lockfile hash, macOS arm64 target, and complete compiled-file checksums.
Packaging rejects changed, missing, extra, or symlinked compiled files and requires the source checkout to remain clean.
The build artifact contains `out/` and its record, not dependencies, models, or runtime bundles.
The packaging job installs its own npm dependencies and prepares the existing native runtime and bundled diarization model.

CI supplies `--build-record dist-electron/build-record.json` to release preparation so packaging validates and uses the compiled application without rebuilding it or repeating the completed shared checks.
Default local packaging/release commands retain build-first behavior and their existing checks.
This is a source/output consistency check, not a claim of reproducible builds or an independent signed provenance attestation.
For credentials, package verification, retries, and draft publication, see [GitHub Releases](github-releases.md).

## Deferred Checks

Automatic real speech inference, deliberate-crash suites, and additional packaged-macOS application behavior tests are deferred in [issue #8](https://github.com/boningdong/RedenCut/issues/8).
Their existing manual commands remain available.
Existing release runtime, signing, document-type, DMG, checksum, and draft-publication safeguards remain enabled.
