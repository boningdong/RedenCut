# Managed runtime independent review archive

This record preserves initial findings and their later resolution; the final implementation report owns the overall acceptance verdict.

# Task 2 independent app runtime review

Reviewed the uncommitted application changes against `docs/superpowers/specs/2026-09-18-managed-runtime-license-design.md` and Task 2 of the matching implementation plan, based on HEAD `1a790c7`.
Supply/build code under `scripts/runtime` and `runtime`, and in-progress release/harness integration, were excluded.
No source files were modified and no host Electron instance was launched.

## Findings

### P1: Audio launches inherit loader overrides and can bypass the managed-library boundary

Locations: `src/main/audio/import/probeAudio.ts:51`, `src/main/audio/import/FfmpegAudioSourceCacheBuilder.ts:133`, and `src/main/audio/export/ExportCoordinator.ts:77`.
All three production spawn paths omit `env`, so Node forwards the inherited process environment even though `AppRuntimeLocator` validates the selected executable.
With the new shared FFmpeg build, launching the development app with `LD_LIBRARY_PATH`, `LD_PRELOAD`, or macOS `DYLD_LIBRARY_PATH` / `DYLD_INSERT_LIBRARIES` can redirect loading to an external or Homebrew library, or fail a normal import/export despite successful Settings checks.
Relative runtime rpaths do not neutralize loader injection.
The executable hash still passes, so this defeats the intended guarantee that the identified managed artifacts are what the app executes.
Settings checks and speech execution already use `offlineEnvironment`, which makes the discrepancy especially misleading.
Both FFmpeg silence detection and whisper execution in `speech/transcriber/whisper.ts` already sanitize their environments; they do not need the same fix.
Use one shared process-environment sanitizer at these three spawn boundaries, either by reusing `offlineEnvironment` or extracting its native-loader filtering to the runtime layer.
Add spawn-boundary tests that set inherited loader overrides and assert their absence from the options actually passed to the audio subprocesses; a helper-only test does not cover these omitted calls.

### P2: Missing audio runtime errors do not reach the actionable runtime message

Location: `src/main/ipc/ipcResult.ts:38`, interacting with `src/main/audio/import/probeAudio.ts:52`.
The new mapper handles only a top-level `RuntimeValidationError`, but `probeAudio` catches the locator failure and wraps it in `new Error(..., { cause: error })`.
Consequently, importing an audio file with a missing or corrupted managed ffprobe/manifest returns generic `operation-failed` instead of `runtime-unavailable`, so the user receives no setup/repair instruction in this common failure path.
This was reproduced by configuring an `AppRuntimeLocator` with an absent root and executing `toIpcResult(() => probeAudio('/example.wav'))`; the returned reason was `operation-failed`.
Preserve the runtime validation error in the probe catch or recognize this typed cause safely at the mapping boundary without exposing raw diagnostics.
Add a regression test that exercises `probeAudio` through `toIpcResult`, rather than only throwing a `RuntimeValidationError` directly into the mapper.

## Verification

Ran `npx vitest run src/main/runtime/AppRuntimeLocator.test.ts src/main/runtime/DevelopmentEnvironmentChecker.test.ts src/main/speech/inferenceEnvironment.test.ts src/main/speech/SpeechWorkerClient.test.ts src/main/ipc/ipcResult.test.ts src/main/ipc/speechAnalysis.ipc.test.ts src/main/resources/validateModelLoad.test.ts`.
Result: 6 existing test files passed, 48 tests passed.
There is no `validateModelLoad.test.ts`; that requested filter matched no additional file.
The reviewed tests cover no executable fallback, traversal and symlink escape, architecture mismatch, integrity checks, optional speech absence, manifest refresh, no uv readiness requirement, worker command refresh, and environment helper filtering.
The executable-only resolve verification is consistent with the explicitly approved split in which setup/check owns full-tree verification.
The locator refresh and late worker command resolution support repair without restarting the application.
Full application, real-library-loading, packaged relocation, and UI integration verification remain with the parent task and were not inferred from these focused tests.

## Scoped fix review addendum

Re-reviewed the parent task's follow-up snapshot after both findings and the worker PATH fix were implemented.
Both original findings are resolved by the reviewed changes; no new actionable issue was identified in this scoped follow-up.
`RuntimeEnvironment.ts` now removes all inherited `LD_` and `DYLD_` variables and is applied at the actual probe, audio cache builder, and export spawn boundaries.
`offlineEnvironment` delegates native loader sanitization to the same helper while retaining Python and offline credential controls.
The probe now preserves `RuntimeValidationError`, and its new test exercises the real probe-to-IPC path to confirm `runtime-unavailable` survives.
Worker environment resolution is lazy, keeps the explicit live-source `PYTHONPATH`, and sets `PATH` exclusively to the validated managed FFmpeg directory so WhisperX's bare `ffmpeg` subprocess cannot search the system path.
The worker client regression test confirms both command and environment resolvers use their current values after construction.

Ran `npx vitest run src/main/runtime/AppRuntimeLocator.test.ts src/main/runtime/DevelopmentEnvironmentChecker.test.ts src/main/runtime/RuntimeEnvironment.test.ts src/main/speech/inferenceEnvironment.test.ts src/main/speech/SpeechWorkerClient.test.ts src/main/ipc/ipcResult.test.ts src/main/ipc/speechAnalysis.ipc.test.ts src/main/audio/import/probeAudio.test.ts src/main/audio/import/FfmpegAudioSourceCacheBuilder.test.ts src/main/audio/export/ExportCoordinator.test.ts`.
Result: 10 test files passed, 87 tests passed.
Also ran `npm run typecheck`; it passed.
The passing cache-builder suite includes its existing actual WAV/MP3 FFmpeg tests, but this does not certify full Python inference, all export formats, production library provenance, or packaged relocation.
Those broader acceptance checks remain with the parent task.


# Independent supply review — 2026-09-18

Scope: read-only review of `scripts/runtime`, `runtime/runtime-lock.json`, `scripts/StageReleaseResources.mjs`, and archived approved design/plan in the migration worktree.
Production files were not modified by this reviewer.
Implementation was still changing during review; findings below describe the inspected snapshot and require follow-up verification.

## Findings

1. **P1 — Installation replaces a working runtime before testing whether the replacement can run.**
   `scripts/runtime/RuntimeInstaller.mjs:23–32` performs file-hash validation and swaps/deletes the previous generation without checking target architecture, executable permissions/load, or Python imports after relocation.
   A disposable reproducer supplied a valid manifest declaring Linux on this Darwin host and nonexecutable text entrypoints: installation returned success and removed the old working marker (`installedWrongPlatform: linux`, `oldWorkingRuntimePreserved: false`).
   Use staged runtime checks before swapping, final-location checks before retiring the prior generation, and rollback on final-location failure.

2. **P1 — Native cache output is trusted by a recipe marker alone.**
   `scripts/runtime/BuildRuntime.mjs:66–69` accepts a prefix when its marker's recipe hash matches; it does not verify the produced binaries/libraries.
   Changing a cached FFmpeg or library after a build and selecting a fresh bundle destination causes the changed artifact to receive a new valid manifest with the original pinned-source provenance.
   Record and verify the complete relevant output inventory when reusing the native prefix, or rebuild it from verified sources.

3. **P2 — Existing bundles ignore Python dependency lock changes.**
   `scripts/runtime/BuildRuntime.mjs:504–538` compares native source identities and a constant Python recipe description but not `speech-worker/uv.lock` or `pyproject.toml`.
   Updating a Python dependency and rerunning runtime setup silently reuses the prior environment.
   Include both dependency input hashes in bundle evidence and reject/rebuild on changes; retain those exact inputs for provenance.

4. **P2 — Isolated Python probes override bytecode suppression.**
   `scripts/runtime/CheckRuntime.mjs:66,82` and `scripts/runtime/VerifyRuntimeOperations.mjs` use `-I -E`, which ignore `PYTHONDONTWRITEBYTECODE` from the controlled environment.
   Probes can recreate bytecode after inventory creation, leaving a checked runtime mutated and introducing unrecorded files.
   Pass explicit `-B` on these probe commands and verify the tree does not change after repeated checks.

5. **P2 — Native verification inherits loader overrides.**
   `scripts/runtime/CheckRuntime.mjs:37,56` uses `process.env` for native tools, while Python verification uses a sanitized environment.
   `DYLD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, or analogous `LD_*` settings can change which libraries load during native verification.
   Sanitize native probes and operation verification consistently with the application runtime boundary.

6. **P2 — Build setup fails in checkout paths containing spaces or non-ASCII characters.**
   `scripts/runtime/BuildRuntime.mjs:28` treats the encoded URL pathname as a filesystem path.
   A checkout such as `My Project` becomes `My%20Project`, so reading runtime-lock.json fails before setup.
   Use `fileURLToPath(import.meta.url)` as StageReleaseResources already does.

## Verification performed

- Read approved archived specification and implementation plan, root AGENTS.md, and relevant coding rules.
- Read implementation and manifest/installer/check/build tests.
- `node --test scripts/runtime/*.test.mjs`: **15 passed**, demonstrating existing coverage does not catch the installation reproducer above.
- Executed the disposable wrong-platform/nonexecutable installation reproducer and removed all its temporary files.
- Inspected generated Python package inventory without interpreting package metadata as final license clearance.

## Licensing and release boundaries

The FFmpeg recipe explicitly disables GPL, nonfree, version-3, and auto-detected components and preserves native source archives/configuration/license materials.
The output is resource staging, not a signed distributable application; the staging README correctly discloses this.
The generated Python inventory still has 16 NOASSERTION entries, including TorchCodec, torchaudio and pyannote components, and transitive native libraries have additional obligations that metadata alone cannot clear.
Retaining that inventory is useful evidence but does not establish complete corresponding-source coverage or release compliance.
The approved spec also requires a concrete LGPL replacement/relink workflow; current staging README only lists this as a release check, so final documentation should provide the actual unsigned-runtime procedure and clearly retain signed-application verification as pending.
No final signing/notarization, clean-machine loading, additional platform certification, or copyright relicensing authority is asserted by this review.

## Status

Changes requested; all findings communicated to the runtime supply implementer and root agent.
The implementer acknowledged fixes 1–4 in progress, and fixes 5–6 were sent separately.
A final rereview is required after implementation completes.

## Final resolution appendix

The supply implementer confirmed the implementation stable for rereview; all six reported findings are addressed in that snapshot.

| Finding | Resolution inspected |
| --- | --- |
| Replacement before readiness | Installer probes the staging directory, keeps the prior generation through final-location probing, and restores it on failure. |
| Native output cache trust | Native prefix markers now include a sorted complete output-file SHA-256 inventory; reuse compares the live inventory as well as the recipe fingerprint. |
| Stale Python dependency reuse | The runtime lock pins pyproject and uv.lock hashes; build evidence and reuse comparisons include those hashes, Python distribution/PyAV/uv identities, and the installation recipe. |
| Probe bytecode mutation | Both isolated Python decoding probes and operation verification pass explicit `-B`; the version probe also passes `-B`. |
| Native loader environment | Native checks and operation probes use the same loader-variable-stripping environment; the macOS inspection tool uses `/usr/bin/otool` explicitly. |
| Encoded checkout pathname | Builder now derives its project root with `fileURLToPath(import.meta.url)`. |

Independent final command: `node --test scripts/runtime/*.test.mjs` — **20 passed, 0 failed**, exit code 0.
The retained output is `final-supply-review-tests.log` in this directory.
Coverage includes changed dependency inputs, cached-output tampering, wrong-platform installation, staged load failure, and final-location-only failure rollback.
An additional disposable reviewer-created fixture independently confirmed `finalLocationFailureRejected: true` and `priorRestored: true`; its temporary directory was removed.

The new unsigned LGPL replacement instructions in `docs/speech-models-and-dependencies.md` match the actual script interfaces: build `--work-dir/--bundle-dir`, setup `--bundle/--runtime-root`, check `--runtime-root`, stage `--bundle/--resources-dir`, and the development runtime-root environment override.
The instructions now state the modified archive must be fetch-accessible and preserve/update the expected source directory; Python dependency changes require refreshing both locked input hashes.
Signed application replacement and final distribution clearance remain explicitly pending rather than implied by this unsigned workflow.

**Final scoped verdict: no remaining actionable findings from the six-item supply review.**
This verdict is based on source review and the tests above; the full native build, model workload, staged release relocation, and UI acceptance results belong to the respective implementer/root evidence and are not independently re-executed by this reviewer.
The earlier license-inventory and release-boundary limitations remain applicable.


## Controller follow-up

The controller identified the analogous extracted-source and uv-executable cache gaps after the independent rereview.
Fresh extraction before all three native compile branches and an extracted uv executable hash check were added, with two additional passing script regressions (22 total).
The final application environment-check shutdown and Validate focus fixes passed 65 related tests, the full 1259-test application suite, 26 full-speech harness tests and a fresh adaptive Docker run.
The subsequent settings E2E changes only clarify observable readiness prerequisites and supply a genuinely absent runtime for the missing-runtime case; all 4 affected E2Es passed.
