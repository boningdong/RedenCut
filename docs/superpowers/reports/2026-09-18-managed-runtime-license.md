# Managed runtime and license migration — implementation record

## Authorization and archive

The user approved archiving this design and implementation plan, then autonomous implementation in an isolated worktree with feature regression testing and no additional human review gate.
The pre-migration tree already contained 22 Superpowers specifications, 31 plans, one verification report, one mockup and one calibration record; that establishes substantial historical documentation, not complete coverage of every feature.
Design: [managed runtime design](../specs/2026-09-18-managed-runtime-license-design.md).
Plan: [implementation plan](../plans/2026-09-18-managed-runtime-license.md).
Archive commit: `1a790c7`; implementation branch: `codex/runtime-license-migration`.
The branch and worktree are retained; no merge, push or release was requested.

## Resulting architecture

The application locates FFmpeg, FFprobe, whisper-cli and Python through one platform-specific manifest and runtime root.
Development uses `.runtime/<platform>-<arch>` or an explicit root override; a packaged application uses `resources/runtime` only.
Missing/corrupt/mismatched executables fail with a localized setup message instead of selecting a system/Homebrew or old npm executable.
CLI audio calls and Python processes sanitize dynamic-loader overrides; Python inference runs offline with the worker source explicitly selected and FFmpeg PATH limited to the managed directory.
WhisperX's internal bare `ffmpeg` invocation is included in this boundary.
Python selection and its environment resolve when each worker starts, allowing a validated runtime repair without restarting the application.

The macOS ARM64 artifact uses shared FFmpeg 7.1.5, LAME 4.0, whisper.cpp1.9.3 with embedded Metal kernels, relocatable CPython3.11.16, source-built PyAV14.4.0 and TorchCodec0.7.0/PyTorch2.8.
PyAV18's FFmpeg-major mismatch was resolved by selecting a compatible source-built version rather than importing its bundled FFmpeg.
All three paths use the same reviewed FFmpeg shared libraries on macOS ARM64.
The Linux ARM64 harness has its own explicitly identified LGPL audio build; its speech lane uses in-memory pyannote inputs because this locked stack has no TorchCodec wheel for Linux ARM64.

The runtime lock owns source URLs/hashes, tool versions and Python dependency-input hashes; the generated manifest owns relative entrypoints, target and artifact hashes.
Sources, build configurations and notices accompany the generated runtime.
A hash-pinned uv download is a setup tool; inference and a prepared release do not require a separately installed uv.
Release staging copies the same artifact, worker source/model manifest and Electron/Chromium notices into a fresh resources directory.
It does not produce a signed `.app` or installer.

Project schemas, model identities/cache locations, speech JSONL protocol and durable analysis formats are unchanged by this migration.
Two real speech E2Es had stale speaker-editor and artifact-name assumptions predating the migration; their UI assertions were updated to current behavior and artifact bytes are independently SHA-256 verified.
The tests now explicitly mount an existing model fixture read-only instead of relying on an unprovisioned test profile.

## Review-driven fixes

- Preserve typed runtime failures through probeAudio and IPC rather than showing a generic audio error.
- Sanitize native audio subprocess environments as well as Python; preserve lazy runtime repair behavior.
- Keep Python symlinks relative during installation and prevent Python checks/inference from generating untracked bytecode.
- Bootstrap hash-pinned uv rather than requiring a global installation.
- Check native cache output inventory and Python lock/recipe fingerprints before reuse; never recertify arbitrary stale binaries merely because they exist.
- Re-extract verified sources before native compilation and check the extracted uv executable hash, closing the corresponding source/tool cache gaps.
- Probe staged and final-location runtime loads before retiring the previous generation; rollback on failure.
- Preserve focused Validate controls and explicit expansion while checking, and handle unconsumed Escape within preferences dialogs.
- Cancel environment probes before application resource shutdown, including early exit before a first check completes.

The last two were exposed by actual Docker interaction and the complete speech-runtime cleanup lane; they were not concealed by relaxing harness timeouts.
Detailed test-first logs are retained under `.superpowers/sdd/2026-09-18-managed-runtime-license/` in the worktree.
The [native supply record](2026-09-18-runtime-supply.md) and [independent review archive](2026-09-18-runtime-reviews.md) preserve build provenance, initial findings and resolutions in version control.

## Verification

The initial baseline was 163 test files /1235 tests passing.
The final application source passed the following checks; evidence paths below are relative to `.superpowers/sdd/2026-09-18-managed-runtime-license/` unless otherwise stated.

| Lane / command | Result | Evidence |
| --- | --- | --- |
| `npm run format` and `npm run check` | PASS: 167 files, 1259 tests; format, lint, dead-code, typecheck and production build | `final-check.log`, `format.log` |
| `npm run test:runtime` | PASS: 22 installer/integrity/recipe/path/source/tool-cache tests, including staged failure and final-location rollback | `runtime-tests-final.log`; independent `final-supply-review-tests.log` |
| Waveform performance profile | PASS: 1 test, observed p95 1.488ms in this run | `waveform-performance-final.log` |
| Host MCP/container EOF and docker stop | PASS: 2 tests with final source and full speech image | `container-smoke-final.log` |
| Native Python worker unittest discovery | PASS: 70 tests | `task-1-speech-worker-tests.log` |
| Docker full speech image `npm run test:harness:all` | PASS: 13 files, 26 tests including faults, real sound capture and lifecycle cleanup | `full-container-verified.log` |
| Complete product E2E coverage, followed by affected settings rerun | PASS: all 13 tests across 8 files; see split-run explanation below | `full-container-verified.log`, `settings-final.log` |
| Native release-resource stage | PASS:installed into new root, then checked again after final resource-directory relocation | `release-stage-verified.log` |
| Native codec operations | PASS:trim/mix/resample; four export encoders; actual decode/non-silence checks for WAV,MP3,FLAC,AAC,M4A,OGG,AIFF | `task-1-runtime-operations.json`, `native-formats-final.json` |
| Docker adaptive MCP UI | PASS for declared affected subset plus unchanged editing baseline | `.harness-runs/container/d37ca8c9-7a99-4677-9a82-2d1431d0e42f/agent-testing-report.md` |

The complete E2E invocation passed 9 tests and exposed 4 settings-test prerequisite failures on the full speech image.
The first three attempted to click controls before the real initial Python check finished; they now wait for the observable enabled state.
The fourth intentionally tests a missing runtime and now launches with a genuinely nonexistent runtime path under its owned run, restoring the launch environment in `finally`.
The affected settings file was rerun on the full speech image and all 4 passed; the other 9 unchanged scenarios were not needlessly rerun after this test-only correction.
This covers real audible playback, split/move/undo, saved transcript editing, import/save/reopen, redaction export, localization, onboarding sample/empty projects, real transcription/alignment/speaker persistence, and multi-track transcript occurrence movement/undo.
Real model files were mounted read-only from an existing cache; no downloads, credentials or modifications of original model files were required.

Adaptive evidence retains the earlier failing runs `307c2467-87ef-4743-9cdc-af4562b4469c` and `7145fb40-02b9-488d-b0d6-eddde15a0547` for diagnosis.
The final fresh-source run repeats the fixed keyboard paths in dark English and narrow light Chinese, verifies preference persistence and closes cleanly.
Its report explicitly identifies the unchanged editor baseline reused from the first run; unavailable remote-download, signed/native-OS or sound-listening capabilities are not reported as adaptive successes.
Intermediate failures are retained and distinguished from final passing runs; no earlier green result certifies later edits.
The seven-format standalone smoke initially requested unsupported mono Vorbis encoding when creating its test input; changing the fixture to stereo resolved that fixture-generation error (OGG is an import format, not a product export format).

## Release and compliance boundaries

The old npm FFmpeg/FFprobe static packages are removed from package manifests and lockfile.
The new FFmpeg configuration explicitly disables GPL, nonfree, version3 and external codec autodetection, while keeping existing MP3 export through LAME.
The repository `LICENSE` and package license remain **GPL-3.0-only**: runtime remediation alone does not establish copyright authority to relicense existing application code to Apache-2.0.
The active operational documentation includes an unsigned LGPL rebuild/replacement procedure using fresh build artifacts and a regenerated manifest without a vendor signing key.
Final signed-application replacement/re-signing behavior, corresponding-source completeness across all native transitive dependencies, model distribution terms and remaining third-party metadata ambiguity require release review.
The tested Python inventory covers 102 distributions, including 16 with no declared license value (`NOASSERTION`); their underlying metadata, classifiers and license files are retained for review.
Package license metadata is inventory evidence, not a legal clearance certificate.

macOS ARM64 is the implemented full-runtime target.
Intel macOS, Windows, a clean machine without developer tools, Developer ID signing/notarization, GPU quality/performance certification and actual remote model authorization/download are not claimed by this work.
Real-model integration tests establish plumbing and regression behavior on supplied fixtures, not transcription/diarization quality scores.
A native tiny-model smoke succeeded with Metal and explicit CPU backends; observed warm wall times were 0.31s and 0.40s, while first Metal shader compilation took 10.64s.
These single-sample observations establish backend operation and retain acceleration, not a representative performance guarantee.
