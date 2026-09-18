# Managed Runtime and License Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace implicit native dependency discovery with a traceable managed runtime and exercise existing audio/editor/speech behavior.
**Architecture:** Build or obtain pinned LGPL native artifacts, provision an isolated Python stack, and route all application consumers through AppRuntimeLocator and a validated runtime manifest.
**Tech Stack:** Electron, TypeScript/Zod, Node build scripts, Python/uv, FFmpeg shared libraries, whisper.cpp, Docker MCP.
**Spec:** docs/superpowers/specs/2026-09-18-managed-runtime-license-design.md

## Global Constraints

- No implicit Homebrew/system/npm fallback.
- No project-format, worker JSONL or model-cache migrations.
- No source or binary license can be inferred solely from package metadata.
- Existing PyAV/TorchCodec version mismatch must be resolved by evidence or separate LGPL builds.
- Use macOS ARM64 first and maintain Linux ARM64 harness support.
- Changes stay in the isolated worktree; no publishing or merging.
- Runtime preparation is explicit; inference never installs dependencies.

## Task 1: Runtime supply and compatibility

Files: runtime/runtime-lock.json, scripts/runtime native build/provision/check modules, scripts/runtime tests, speech-worker/pyproject.toml, speech-worker/uv.lock.
Produces: a real task-local native/Python runtime, recorded build evidence, and a documented manifest contract for application integration.
- [ ] Inspect native toolchain, Python cache, Docker and model availability without reading credentials.
- [ ] Freeze manifest fields with Task 2 before implementation: schemaVersion, runtimeId, platform, arch, executables, components, files.
- [ ] Add installer failure tests for mismatched hashes, traversal and incomplete staged installation; run them red before implementation.
- [ ] Build LGPL FFmpeg with shared libraries, ffprobe and libmp3lame, excluding GPL/nonfree components; retain exact source hashes/configuration/licenses.
- [ ] Build or provision pinned whisper.cpp and relocatable Python, then build compatible PyAV and bind TorchCodec to audited shared libraries.
- [ ] Verify binary -L/-buildconf, library loading and actual audio operations; retain source archives and output hashes.
- [ ] Exercise script tests and real Python imports; record unresolved external constraints precisely.

## Task 2: Application runtime boundary

Files: src/main/runtime/AppRuntimeLocator.ts, src/main/runtime/RuntimeValidator.ts, src/shared/RuntimeManifest.ts, runtime tests, src/main/ipc/speechAnalysis.ipc.ts, runtime setup/check UI and localization consumers where needed.
Consumes: Task 1 manifest and relative runtime paths.
Produces: deterministic runtime selection with typed failures and no implicit executable discovery.
- [ ] Add failing tests that a valid system executable is not selected when the managed executable is absent.
- [ ] Add real filesystem tests for invalid manifests, wrong architecture, relative-path containment and missing components.
- [ ] Replace system/package fallback resolution with manifest-backed resolution; route all Python worker paths through it.
- [ ] Preserve live developer worker source and offline inference configuration; separate uv setup availability from runtime readiness.
- [ ] Expose actionable runtime errors through existing settings/onboarding patterns and localizations without raw internal data in normal UI.
- [ ] Run affected runtime/resource/IPC tests and typecheck.

## Task 3: Development, packaging and documentation integration

Files: package.json, package-lock.json, .gitignore, scripts/runtime development/release entrypoints, harness/container scripts and image, README.md, docs/architecture-standards.md, docs/speech-models-and-dependencies.md.
Consumes: Tasks 1–2.
- [ ] Remove static npm packages using npm lockfile tooling.
- [ ] Add runtime:setup, runtime:check and controlled dev launch commands; record build/source provenance.
- [ ] Stage a release runtime using the same artifacts, with relative library paths and license/source materials; do not copy a nonportable venv blindly.
- [ ] Adapt Docker harness to an explicit identified runtime; do not silently certify distribution packages as LGPL builds.
- [ ] Update active documentation for managed runtime behavior and retain historical docs unchanged.
- [ ] Run setup from empty destination and repeat setup; verify failure leaves the earlier validated runtime intact.

## Task 4: Regression, independent review and handoff

Files: docs/superpowers/reports/2026-09-18-managed-runtime-license.md and task-owned .harness-runs evidence.
- [ ] Run npm run format and npm run check, Python unittest discovery, harness normal/fault tests, container smoke and complete product E2Es.
- [ ] Run real audio import/export smoke in all supported export formats and compare durations/decoding behavior.
- [ ] Run available real-model speech checks with existing authorized caches; no credential disclosure.
- [ ] Exercise Docker MCP editing baseline, UI consistency, settings and change-specific checks against the final source snapshot.
- [ ] Obtain independent code/spec review, address actionable findings, and repeat only affected checks.
- [ ] Archive exact commands, results, failures, scope limitations, provenance and migration decisions.
- [ ] Keep the branch/worktree for review; do not claim signing, clean-machine, unavailable model or platform acceptance.
