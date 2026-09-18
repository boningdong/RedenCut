# Audio Preparation Progress Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent renderer work and main-process work, followed by branch review.

**Goal:** Display truthful preparation feedback for project open and audio import in the approved 36px full-width single-line bar.

**Architecture:** Main publishes observational project-open progress keyed by operationId and sequence, preserving existing transactions. Preload forwards typed events. A transient Zustand store and independently subscribed UI display current phases until renderer application completes.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest, Docker MCP harness.

**Spec:** ../specs/2026-09-18-audio-preparation-progress.md (final selection: 36px single-line with left spinner).

## Global Constraints

- No project/cache schema migrations, decoder changes, or source-audio modifications.
- Keep import identity and cancellation/commit-won semantics.
- Progress delivery failures never abort a project transaction.
- Unknown phases use indeterminate progress; percentages apply to current phase.
- Preserve existing edit/save/shortcut gating and draft preservation.
- New modules use PascalCase; UI uses theme tokens and en/zh-CN semantic translation.
- Do not modify instruction files or durable acceptance scenarios.

## Tasks

### 1. Main progress and IPC

Files: shared/AudioPreparationTypes.ts, shared/session.types.ts, shared/ipc.types.ts, preload/index.ts, main/project/{WorkspaceController,ProjectTransitionCoordinator}.ts, main/ipc/project.ipc.ts and adjacent tests.

- [x] Run baseline unit tests.
- [x] Add tests proving missing-cache rebuild emits per-source fractions and cache hits omit rebuild; observer failures preserve commit; chooser cancellation emits no candidate progress.
- [x] Run targeted tests and observe failures before adding runtime changes.
- [x] Add StageProgress, ProjectOpenStage, ProjectOpenProgressEvent with operationId/sequence; request requires operationId.
- [x] Pass optional observation through prepareOpen/prepareStarter/descriptors; emit verification before and after rebuild; keep non-open callers unchanged.
- [x] Coordinator attaches operationId/sequence and safely sends project:open-progress only to origin sender, then sends settlement/switch phases.
- [x] Validate operationId at IPC boundary; add typed preload subscription; update all request fixtures.
- [x] Run targeted tests and typecheck.

### 2. Renderer state and 36px bar

Files: renderer/src/stores/PreparationProgressStore.ts; components/audio-preparation/{AudioPreparationProgress.tsx,AudioPreparationProgress.css}; App.tsx; shared/i18n/locales/{en,zh-CN}.ts; adjacent tests.

- [x] Add tests for wrong operation IDs, decreasing sequence, ended operations, renderer completion, import cancel/commit race, and correct determinate/indeterminate presentation.
- [x] Observe failing tests, then implement transient state and independently subscribed progress component.
- [x] Register open operation before invoke; show only after first main progress; transition to preparing-editor while applying result, clean up in finally.
- [x] Preserve import busy gating separately from high-frequency visual snapshots to avoid rerendering App on every tick; preserve authoritative job guards.
- [x] Keep cancel pending until original result settles; old main ticks cannot overwrite renderer preparation.
- [x] Use 36px single line, full-height leading spinner column, truncatable filenames, persistent stages and trailing fraction/cancel, 2px bottom meter.
- [x] Run renderer targeted tests.

### 3. Risk verification and handoff

- [x] Run npm run format then npm run check; investigate all new failures.
- [x] Review full diff for transaction changes, stale events, state duplication, missing callers and rendering overhead.
- [x] Start owned Docker MCP session from this worktree after source edits are complete.
- [x] Execute editing baseline and applicable UI consistency states; add targeted import/open/rebuild checks with screenshots and lifecycle provenance.
- [x] Run product E2Es in Docker; report unavailable checks explicitly.
- [x] Write evidence-backed acceptance report, stop owned run, retain source and artifacts.

## Rulings

- Work in an isolated worktree at .worktrees/audio-preparation-progress; main is shared with other tasks.
- Starter generates only source WAV; actual cache builds occur in WorkspaceController, so createStarterWorkspace need not change.
- Existing import busy identity must not be conflated with visual phase; preserve gating while isolating tick updates in the progress store.

- Review fix: open rollback-session capture also accepts the same observational callback; current-source verification can be expensive before candidate selection. No validation order changed.

## Verification outcome

Final npm run check passes (162 files, 1212 tests, format/lint/deadcode/typecheck/build).
Docker MCP first-run report records baseline editing, real import/open cache progress, cancellation, error/retry and missing-media recovery.
Review found overlapping pending opens hid import cancellation; fixed in the same 36px row and covered with failing-before/passing-after App/component tests.
Fresh final container re-verifies changed UI; external OS file-open delivery cannot be driven by MCP and remains explicitly limited to deterministic App tests.
Full E2E first run: 11 passed, 2 speech-dependent failures; unchanged main reproduced the model-preparation error. No models downloaded.
Final non-speech E2E rerun and final evidence report are linked in handoff; no merge/push performed.
