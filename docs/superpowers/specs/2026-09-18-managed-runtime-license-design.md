# Managed Runtime and License Migration

## Approval and scope

Approved in the 2026-09-18 license audit conversation.
The user authorized archiving the design, skipping another document review, creating an isolated worktree, implementing the migration, and exercising existing features for regressions.
This approval supersedes intermediate review pauses; it does not authorize publishing, merging, changing instruction files, or declaring unperformed checks successful.

## Problem and evidence

The application currently discovers native tools from environment overrides, Homebrew/system paths, and ffmpeg-static/ffprobe-static.
The audited local ffmpeg-static executable reports nonfree/nonredistributable status; ffprobe-static contains a GPL build despite its MIT package metadata.
PyAV 18.1.0 ships another FFmpeg linked to x264/x265, with contradictory LGPL self-identification requiring independent artifact review.
TorchCodec 0.7.0 supports FFmpeg 4–7 while PyAV 18.1.0 supports FFmpeg 8; one shared version is an optimization, not a release prerequisite.
Audit evidence is retained in the task workspace at output/license-audit-2026-09-18.

## Goals

- Ship identifiable, locally managed native runtimes with no implicit Homebrew/system/npm fallback.
- Use the same pinned component sources and build recipes for development and release.
- Developers prepare the environment once; end users do not install uv, Python, FFmpeg, or whisper.cpp.
- Keep application code eligible for Apache-2.0 while retaining third-party licenses and corresponding source obligations.
- Preserve project formats, model caches, model authorization, editing semantics, and worker JSONL contracts.
- Exercise all existing automated verification lanes and relevant Docker MCP acceptance; report unavailable checks as blocked.

## Runtime boundary

AppRuntimeLocator remains the only application executable resolver.
A root manifest identifies runtime ID, platform/architecture, relative executable/library paths, component versions, and provenance.
Development defaults to a project-local .runtime directory; packaged mode uses its bundled runtime root.
A single explicit runtime-root override is permitted for controlled tests; individual executable overrides must not silently escape the selected runtime.
Missing, incompatible, or corrupted managed artifacts fail with actionable errors and never trigger a search for system substitutes.
UV belongs to setup, not inference readiness.
Speech worker startup and model validation use the same locator and controlled Python environment; development worker source remains live for iteration.
Model weights remain independently managed by ResourceManager and models.json.

## Artifact supply

Maintain pinned source recipes for LGPL FFmpeg/ffprobe and whisper.cpp, audited Python wheels, and a Python distribution suitable for relocation.
Prefer compatible shared-library builds without GPL or nonfree components, with LAME support for existing MP3 export.
If Python consumers cannot safely share a FFmpeg major, retain separate, explicitly identified LGPL builds instead of untested upgrades.
Build scripts record configuration, exact sources/patches, hashes, license texts and third-party notices.
Ordinary venv directories are not assumed portable; release staging must recreate or assemble a relocatable environment and validate it after moving.
Never turn developer-machine Homebrew binaries into approved artifacts merely by copying them.

## Installation and data structures

RuntimeLock records platform-specific source/artifact identities and hashes.
RuntimeManifest records the built runtime ID, schema version, platform, architecture, component versions, relative entrypoints and files.
RuntimeCheckResult distinguishes missing, wrong-architecture, version-mismatch, integrity-failed, load-failed and ready conditions.
The lock is version-controlled; generated .runtime artifacts are ignored.
Installation uses staging and validation before selecting a completed generation; it must not overwrite a working runtime on failure.
Relative paths must reject traversal, absolute paths and symlink escape.
Existing project and analysis schemas remain unchanged; runtime identity is diagnostic metadata initially.

## Release and licensing

Remove ffmpeg-static and ffprobe-static from application dependencies.
Document Apache licensing intent and third-party boundaries; do not claim an exhaustive copyright provenance clearance from Git authorship alone.
Any project-license change requires a recorded disposition of existing copyright authority; runtime remediation can be completed independently.
Include third-party notices, corresponding sources/build instructions, and a documented LGPL library replacement/relink path.
Fix dynamic-library locations before signing; verify the final signed application separately from development binaries.
No public artifact publication, credentials, signing-identity changes, or uploads are implicit in this task.

## Acceptance

1. A clean developer setup selects pinned artifacts and starts without Homebrew tool discovery.
2. Removing a required artifact fails explicitly; it does not select another installed program.
3. Actual FFmpeg libraries used by PyAV and TorchCodec are identified and match the reviewed runtime.
4. FFmpeg import, trim/mix/resample, WAV/MP3/AAC/FLAC export, and speech preparation retain behavior.
5. Python unit tests, real-model Chinese/English alignment and available diarization tests are exercised.
6. npm run check, full harness/fault suite, fixed E2Es, editing/UI/settings/transcript/redact/keyboard scenarios are exercised as applicable.
7. Prepared source checksums and license materials accompany runtime build evidence.
8. Clean-machine relocation, signing/notarization and platforms unavailable to this task are explicitly reported, never inferred from unit tests.

## Risk controls

Begin with macOS ARM64 and the existing Linux ARM64 Docker harness; do not claim Windows or Intel certification.
Preserve user projects and existing model caches; use disposable fixtures and task-owned harness runs.
Pin task runtime generation during execution; rollback selects only a previously validated generation.
Validate compatibility with real workloads before forcing a single FFmpeg major.
