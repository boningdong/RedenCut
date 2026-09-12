# Workspace User Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session, with a user review after the configuration checkpoint.

**Goal:** Establish validated, durable user-level workspace layout configuration without changing the visible editor layout yet.

**Architecture:** Main owns a dedicated layout preference file; preload exposes typed get/set operations; renderer uses the contract without accessing filesystem paths.
This is checkpoint 1 of the approved workspace design, not the entire UI migration.

**Tech Stack:** Existing Electron, TypeScript, Zod, Vitest, and Node filesystem APIs; no new dependency.

**Spec:** [Editor Workspace Layout Design](../specs/2026-09-10-editor-workspace-design.md).

## Global Constraints

- Preserve the Electron main/preload/renderer boundaries and use typed IPC.
- Use Zustand for renderer application state.
- Persist layout in local user configuration, not in project files.
- Layout changes must not dirty a project or enter audio editing history.
- Do not modify AGENTS.md or skills as part of this change.
- Do not add comments, bookmarks, floating windows, or a general docking framework in this phase.
- Keep source audio, playback, transcription, and export behavior on their existing production paths.
- Preserve the existing light theme while making the approved dark mock the primary visual acceptance reference.

## Execution boundaries

Read repository instructions and the specification first.
Check the working tree and active work before editing; use an isolated checkout if other implementation work needs separation.
Do not alter the renderer panel composition in this checkpoint.
Do not automatically continue into dragging or transcript work after this checkpoint's review handoff.
Commit only the reviewed checkpoint's files after required verification, preserving unrelated work.

## Task 1: Define and normalize layout preferences

**Files:** Create `src/shared/workspaceLayout.types.ts` and `src/shared/workspaceLayout.types.test.ts`.

**Interfaces:** Export `WorkspaceLayoutSchema`, inferred `WorkspaceLayout`, `DEFAULT_WORKSPACE_LAYOUT`, and `decodeStoredWorkspaceLayout(input: unknown): { layout: WorkspaceLayout; warning: string | null }`.
The default is version 1, content order Transcript then Audio, transcriptRatio 0.6, and Transport at the bottom.

- [x] Add behavior tests for valid layout, defaults, partial invalidity, duplicated/obsolete panel IDs, missing panels, nonfinite ratio, and unknown schema versions.

```ts
expect(decodeStoredWorkspaceLayout({
  version: 1,
  contentOrder: ['audio', 'retired-panel', 'audio'],
  transcriptRatio: 0.7,
  transportPosition: 'top',
}).layout).toEqual({
  version: 1,
  contentOrder: ['audio', 'transcript'],
  transcriptRatio: 0.7,
  transportPosition: 'top',
})
expect(WorkspaceLayoutSchema.safeParse({
  ...DEFAULT_WORKSPACE_LAYOUT,
  transcriptRatio: Number.NaN,
}).success).toBe(false)
```

- [x] Run `npm test -- src/shared/workspaceLayout.types.test.ts` and confirm the expected missing implementation failure.
- [x] Define a strict Zod union for the two valid panel orders, a finite ratio bounded from 0.1 to 0.9, and the top/bottom transport enum.
- [x] Implement decoding as field-by-field recovery for version 1: deduplicate known panel IDs in order, append missing IDs in default order, and retain only independently valid ratio/transport values.
- [x] Return defaults with a warning for nonobjects or unsupported versions; do not pretend an unknown newer version has been migrated.
- [x] Rerun the focused test and confirm that returned defaults are fresh objects rather than mutable shared state.

## Task 2: Persist preferences in the main process

**Files:** Create `src/main/preferences/WorkspaceLayoutStore.ts` and `WorkspaceLayoutStore.test.ts`.

**Interfaces:** Export `WorkspaceLayoutStore`, constructed with an absolute preference file path supplied by main initialization.
Expose `read(): Promise<{ layout: WorkspaceLayout; warning: string | null }>` and `write(layout: WorkspaceLayout): Promise<WorkspaceLayout>`.

- [x] Write temp-directory tests for a missing file, valid round trip, malformed JSON, partial recovery, unknown version preservation, failed writes, and consecutive writes.

```ts
const store = new WorkspaceLayoutStore(join(testDirectory, 'workspace-layout.json'))
expect((await store.read()).layout).toEqual(DEFAULT_WORKSPACE_LAYOUT)
const first = { ...DEFAULT_WORKSPACE_LAYOUT, transcriptRatio: 0.7 }
const latest = { ...DEFAULT_WORKSPACE_LAYOUT, transportPosition: 'top' as const }
await Promise.all([store.write(first), store.write(latest)])
expect((await store.read()).layout).toEqual(latest)
```

- [x] Run `npm test -- src/main/preferences/WorkspaceLayoutStore.test.ts` and confirm failure before implementation.
- [x] Handle ENOENT as defaults; decode existing JSON through Task 1; report malformed JSON as recoverable without replacing the file during read.
- [x] Propagate permission and unexpected filesystem failures instead of silently presenting them as a successful read or save.
- [x] Validate writes, serialize them with a queue that remains usable after a failure, write a unique sibling temporary file, then rename it over the destination.
- [x] Clean up only the temporary file created by the failed operation; preserve the previous destination on failure.
- [x] Rerun tests, including a rejected write followed by a successful write and a read after queued writes settle.

## Task 3: Connect typed IPC and application initialization

**Files:** Create `src/main/ipc/workspaceLayout.ipc.ts` and `workspaceLayout.ipc.test.ts`.
Modify `src/shared/ipc.types.ts`, `src/preload/index.ts`, `src/preload/index.test.ts`, and `src/main/index.ts`.

**Interfaces:** Add `IElectronAPI.workspaceLayout.get(): Promise<{ layout: WorkspaceLayout; warning: string | null }>` and `set(layout: WorkspaceLayout): Promise<WorkspaceLayout>`.
Use channels `workspace-layout:get` and `workspace-layout:set` through the existing IpcResult envelope and invokeSafe adapter.
Expose `registerWorkspaceLayoutIpc(store: WorkspaceLayoutStore): void` from the handler module.

- [x] Add IPC tests proving valid writes reach the store, invalid payloads return `invalid-request`, and filesystem failures return `operation-failed`.
- [x] Extend preload tests to verify both exact channel names, payload forwarding, successful unwrapping, and rejected error envelopes.
- [x] Run `npm test -- src/main/ipc/workspaceLayout.ipc.test.ts src/preload/index.test.ts` and confirm the new contract tests fail before wiring.
- [x] Register the handlers using existing repository IPC conventions, validating payloads before calling the store.
- [x] Construct the store in main initialization with `join(app.getPath('userData'), 'workspace-layout.json')`, after harness startup isolation has selected the userData directory.
- [x] Confirm handlers work without an open project and do not call project mutation coordinators or change project revision/history.
- [x] Rerun the focused tests and type checking with `npm run typecheck`.

## Checkpoint verification and review

- [x] Run `npm run format`, inspect its diff, and keep unrelated formatting out of this checkpoint.
- [x] Run `npm run check` and report actual results.
- [x] Verify production changes are restricted to preferences, their IPC contract, and initialization; no visible workspace integration has been introduced.
- [x] Report product UI acceptance as excluded for this checkpoint because it introduces no visible UI flow; visible integration at checkpoint 2 requires Docker baseline and changed-behavior acceptance.
- [x] Review the diff for source/project path leakage, silent persistence failures, and modifications to project schemas or history.
- [x] Commit the verified checkpoint as `feat: persist user workspace layout preferences` and present its contract, tests, and remaining limitations for user review.

## Next review checkpoints

After configuration review, write the bounded execution plan for Zustand hydration/save coordination, stable panel composition, drag/drop previews, resize constraints, keyboard alternatives, and restart persistence.
After workspace review, write the visual integration plan against the final mock, including production controls and Docker acceptance.
These checkpoints share the specification but are deliberately not authorized as one uninterrupted implementation batch.

## Execution record — 2026-09-10

Implemented checkpoint 1 on `codex/workspace-preferences`, based on `366507e`, in an isolated worktree.
The shared schema, main-owned preference store, typed IPC, preload contract, initialization, and architecture documentation are complete.
No dependency, project schema, editing history, or production renderer composition changed.
The renderer test double was updated to satisfy the expanded API contract.

### Verification

- `npm run format` and `git diff --check`: passed; no unrelated formatting changes.
- `npm run check`: passed formatting, lint, unused-code checks, type checking, 538 tests across 78 files, and production build.
- `sh harness/container/run.sh npm run test:harness:all`: passed 25 tests across 12 files, including lifecycle and injected failure cases.
- `REDENCUT_HARNESS_IMAGE=redencut-harness-speech:local sh harness/container/run.sh npm run test:e2e`: passed all 4 tests across 3 files, covering clip split/drag, real audio playback, project save/restart, and real speech analysis with transcript persistence.
- Independent static review found a temporary-file ownership bug; an exclusive-create collision regression reproduced it before the fix, and the reviewer confirmed no remaining blockers afterward.

The first E2E attempt used the base image, which lacks whisper-cli, and failed the speech test while the other three tests passed.
The complete final run used the existing speech-enabled image and passed without changing production speech code or weakening tests.

### Evidence and limits

Final local logs are `/tmp/workspace-check.log`, `/tmp/workspace-harness-final.log`, and `/tmp/workspace-e2e-final.log`.
Container evidence is retained under this worktree's ignored `.harness-runs/container/` directory.
Final E2E session IDs are `436e10fd-f14c-4366-8149-50b1850eeac0`, `31ba9230-96ab-4f42-9755-007bd9ff59c4`, `67294b23-6272-4cc7-9f15-6ba743781f1a`, and `d690ce05-990d-4ca6-980f-c04657332f8b`.
New preference behavior is verified by schema, filesystem, IPC, and preload tests; existing E2Es verify product regressions and do not exercise a layout settings UI.
Visible layout acceptance is deferred because this checkpoint exposes no new UI controls.
Writes use serialized atomic replacement, but no power-loss durability guarantee is claimed.
The branch is retained for checkpoint review, without merging or pushing.
