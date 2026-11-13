# GitHub Releases

## Release pipeline

Pushing a `v*` tag runs `.github/workflows/release.yml` and the same reusable checks used for PRs; see [continuous integration](continuous-integration.md).
After all five shared check groups pass, `_package-macos.yml` on macOS 15 ARM64 checks the tag, downloads and validates that execution's compiled application, builds the pinned native runtime, prepares the bundled diarization model, and packages and verifies the DMG.
It uploads the verified release files as an Actions artifact; a separate publication job downloads that exact artifact, rechecks source identity and checksums, then creates a GitHub Release **draft**.
Versions containing a prerelease suffix, including `0.1.0-alpha.2`, are marked as prereleases and are not marked Latest.
There is no updater, Developer ID signing or Apple notarization in this pipeline.

The draft contains:

- `RedenCut-<version>-arm64.dmg`: manually installable Apple Silicon package.
- `SHA256SUMS.txt`: SHA-256 checksum for that exact DMG.
- `release.json`: source commit, version, runtime ID, build time, artifact size and checksum.

The workflow installs Node from `package.json` and dependencies from the npm lockfile.
Native source archives and Python packages are checked against the existing runtime locks.
The initial workflow deliberately builds the runtime afresh on each run; it does not depend on a developer machine, a self-hosted runner, or a shared native build cache.
It can take substantially longer than a local package using an already prepared runtime.
The runtime source archives and license material remain inside the app resources.

## Test a release before tagging

1. Ensure `release-test.yml` has been merged into the default branch so GitHub offers its manual trigger.
2. Open **Actions → Release (Test) → Run workflow**.
3. Select the branch to test and start the run; only use trusted branches because packaging uses the repository's model-download credential.
4. Wait for all five shared check groups and shared macOS packaging to pass.
5. Open the run's **Artifacts** section and download `release-macos-arm64-<attempt>`.
6. Extract the ZIP and open its `v<version>/` directory for the DMG, `SHA256SUMS.txt`, `release.json` and `release-notes.md`.

**Release (Test)** runs only manually, not when opening a PR.
It uses the same build transfer, runtime, model, signing, DMG and checksum checks as **Release**, but does not require a version tag or create a GitHub Release draft.
Both paths validate the package/lockfile version, macOS arm64 platform and selected source commit.
The test installer retains the package version; it does not reserve or bump a release version.
Use `release.json` to distinguish candidates built from different commits with the same version.
Actions artifacts are retained for seven days; download the candidate before expiry.
The test needs the same `HF_TOKEN` setup as a formal release and builds the native runtime afresh.

## One-time repository setup

1. Merge the packaging and release workflow commits into `main` before creating the first release tag.
2. Enable GitHub Actions and permit the pinned actions referenced by the workflows, including checkout, Node setup, artifact upload/download, and uv setup.
3. On Hugging Face, use the account that has accepted access conditions for [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1).
4. Create a read token that can access that model and store it in **Settings → Secrets and variables → Actions → New repository secret**, named `HF_TOKEN`.
5. Ensure repository or organization policy permits the workflow's `contents: write` permission to create Release drafts.

`HF_TOKEN` is supplied only to the credential preflight and model installation steps, not to runtime preparation, offline model checks, packaging or upload.
The existing model downloader sends it only to Hugging Face, and resource staging excludes credentials.
GitHub supplies `GITHUB_TOKEN` automatically; the workflow exposes it as `GH_TOKEN` only to the draft-upload step.
No personal GitHub token, local `gh` installation, or Apple credential is required for this Actions path.

GitHub runner availability, usage limits and billing depend on repository visibility and account settings.
The workflow asserts ARM64 explicitly so an unexpected runner architecture fails before building.

## Creating a release tag

Use a clean `main` checkout containing all changes intended for release, after merging and reviewing the packaging branch.
Do not create the tag from a worktree that still lacks another task's pending changes.
Create the tag from the version recorded in `package.json`, after all intended fixes and the matching lockfile are on `main`.
Keep existing release tags unchanged.

```sh
git switch main
git pull --ff-only origin main
git status --short
# Continue only when the working tree is clean and the intended changes are present.
release_version=$(node -p "require('./package.json').version")
git tag -a "v$release_version" -m "RedenCut $release_version"
git push origin "v$release_version"
```

Open **Actions → Release** and wait for the tagged run to succeed.
Open **Releases**, edit the generated draft's release notes, download the DMG and perform installation and core editing/speech checks.
Publish through **Publish release** only when ready; leave the prerelease option enabled for alpha builds.
The workflow does not publish the draft automatically.

The generated notes identify the build and installation limitations; replace the Changes placeholder with actual user-facing changes before publishing.
GitHub automatically offers source archives for the tag; users wanting the app should download the attached DMG.

## Subsequent releases

Each published version gets a new version number and a new tag.
Set the next unused version on the release branch or main checkout, commit both package files, and merge that change into `main` before tagging.
For example, when advancing from alpha.4:

```sh
npm version 0.1.0-alpha.5 --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release 0.1.0-alpha.5"
# Merge the version commit into main if it was prepared on a separate branch.
git push origin main
git tag -a v0.1.0-alpha.5 -m "RedenCut 0.1.0-alpha.5"
git push origin v0.1.0-alpha.5
```

Before tagging, ensure the checkout is main at the intended release commit and is clean.
Use `0.1.0` / `v0.1.0` when releasing the stable version; the suffix-free version produces a draft that is not marked prerelease.
Publishing and choosing Latest remain maintainer decisions in the GitHub Release editor.

## Failed runs and retries

A tag/version mismatch fails before expensive runtime preparation.
Missing `HF_TOKEN`, denied model access, source download failures, failing tests, signing verification failures or checksum failures stop the workflow before draft creation.
After correcting a secret or resolving a transient download error, use **Re-run failed jobs** for the same tagged workflow run.
If code must change, commit the fix and use a new version/tag rather than moving a published tag.

If draft upload was interrupted, rerunning the failed publication job reuses the verified package artifact without preparing the runtime/model or packaging again.
It replaces only the existing draft's DMG, checksum and metadata assets; edited draft notes are preserved.
Rerunning failed packaging reuses the matching compiled artifact, prepares the runtime/model again, and repackages.
Compiled and packaged artifacts have seven-day retention; after expiry, rerun all jobs to create fresh artifacts for the same tag rather than attempting to download expired files.
A published Release is never overwritten by the script, including when GitHub release immutability is disabled.
The first successful build from that tag creates the draft; an existing published version requires a new version.
Builds are tied to a source commit, but are not claimed to be byte-for-byte reproducible across runner or build-tool updates.

## Local diagnosis and verification

The Actions steps reuse local commands:

```sh
npm ci
export REDENCUT_MODELS_PATH="$PWD/.runtime/release-models"
npm run setup:runtime
npm run setup:models -- --model diarization-default
npm run check:models -- --model diarization-default
npm run release:prepare
npm run release:draft -- --dry-run
```

Run these on an Apple Silicon Mac from a clean checkout after committing the release scripts.
The workflow supplies `.runtime/release-models` through job-level `REDENCUT_MODELS_PATH`, so installation, offline verification and staging use the same explicit directory across separate Actions steps.
Local commands use the macOS Application Support model directory if no override is supplied; weights do not need to be moved into `.runtime` to be packaged.
Local release preparation also inherits `REDENCUT_RUNTIME_ROOT` for runtime validation and packaging; without it, the checkout’s default runtime is used.
See [runtime directory selection](speech-models-and-dependencies.md#runtime-directory) for shared-runtime usage.
`release:prepare -- --models-path PATH` overrides the environment for that preparation and forwards the resolved directory to `package:mac`; installation must have prepared the same path.
Packaging copies verified diarization weights into the app's `Contents/Resources/models/diarization/<id>/<revision>` directory.
It never downloads model weights.

By default, `release:prepare` runs `check:runtime`, the full application checks including runtime, release, model and tooling tests, packaging, code-signature verification, disk-image verification, and generates `dist-electron/releases/v<version>/`.
CI passes `--build-record dist-electron/build-record.json`, retaining runtime/package verification while using the shared Build output and not repeating the completed shared checks.
It rejects source changes observed during preparation and invalidates old release metadata before attempting a rebuild.
`release:draft -- --dry-run` checks local source identity and artifact checksums and prints the planned command without contacting GitHub or uploading anything.
Actual `release:draft` execution additionally requires an authenticated GitHub CLI, matching local/remote tags, and repository write access; CI already supplies these.
A local dry run does not establish that GitHub credentials, hosted-runner builds or uploads work.

## Checks before tagging

`npm run check` includes the dedicated runtime, release, model and developer-tooling suites.
The PR and main checks workflow runs those offline tooling suites alongside code quality, application build, unit tests, managed-audio integration tests, and base user workflows; it does not provision speech models, package a DMG or upload a release.
Maintenance-command tests also run with the release model-path environment; their subprocesses isolate fixture paths so checks cannot remove the prepared release models.
Its tests parse active workflow YAML and validate standalone literal npm script calls against `package.json`.
Workflow npm entrypoints must remain standalone literal commands or use the documented Docker base wrapper; arbitrary shell composition and dynamic script names fail the guard rather than being silently accepted.
Release orchestration tests execute the actual workflow npm steps against controlled command substitutes, checking order, shared model paths, credential scope and failure stops.
Separate temporary-file tests verify real shared-model installation and staging.
These checks complement a clean macOS release run; they do not certify remote credentials or final DMG installation.

Docker workflows exercise audible playback and export behavior in Linux, not in the packaged macOS app.
The automated checks do not establish clean-machine installation, Gatekeeper behavior, packaged-app playback/export UX, or full transcription quality.
Run those acceptance checks on the downloaded candidate DMG before publishing.
See [macOS packaging](macos-packaging.md) for the bundle layout and local signing limitations.
