# Draggable Workspace Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the approved checkpoint without another approval pause.

**Goal:** Integrate user-configured Transcript, Audio, and Transport regions with dragging, resizing, keyboard equivalents, and restart persistence.
**Architecture:** A renderer Zustand store coordinates preference hydration and serialized saves through the existing preload API; keyed Workspace panels own positioning while feature components retain their identity.
**Tech Stack:** Existing React, Zustand, TypeScript, pointer events, Vitest, Docker MCP; no new dependency.
**Spec:** [Approved workspace design](../specs/2026-09-10-editor-workspace-design.md).

## Global constraints

Keep preference changes outside project state and undo history.
Preserve feature content, audio player lifetime, text selection and scroll positions across layout changes.
Keep panel DOM order consistent with visual order and support keyboard operation.
Use existing theme tokens; the full visual migration and transcript overlap subsystem remain separate checkpoints.
Persist completed layout actions, not transient pointer coordinates or window-size clamping.
Keep main and preload unchanged unless integration reveals a contract defect.

## Task 1: Renderer preference coordination

Files: `src/renderer/src/stores/workspace.store.ts` and colocated tests.
Interface: `useWorkspaceStore` exposes `layout`, `hydrated`, `saving`, `warning`, `error`, `errorKind`, `hydrate()`, `updateLayout(layout)`, `retrySave()`, and `resetLayout()`.

- [x] Add deferred-promise tests before implementation for late hydration, coalesced saves, rejected saves, retrying latest state, and reset.
- [x] Implement an idempotent hydration operation with a local edit generation guard.
- [x] Snapshot completed updates, serialize saves, and replace pending unsent updates with the latest one.
- [x] Keep current layout usable on failure and expose recovery warnings without writing on hydration.
- [x] Run focused tests and review concurrency boundaries.

## Task 2: Workspace composition and interaction

Files: `src/renderer/src/components/Workspace/`, `src/renderer/src/workspace/`, `src/renderer/src/App.tsx`, colocated tests, and `docs/key-mappings.md`.
Consumes the exact Task 1 API.

- [x] Test geometry limits, cancellation, completed persistence, and stable mounted children before implementing their behavior.
- [x] Compose all three regions as keyed siblings in actual visual/DOM order; retain existing feature children and App-owned player.
- [x] Add dedicated pointer drag handles and legal visible drop targets; cancel with Escape, pointer cancellation, and loss of active interaction.
- [x] Add a horizontal content divider with pointer preview and one committed save; clamp rendered dimensions against panel minima without overwriting the stored preference on window resize.
- [x] Provide keyboard-equivalent reorder controls and divider ArrowUp/Down, Home/End commands.
- [x] Restore selection and scroll across reorder, isolate layout shortcuts from audio shortcuts, and expose reset/retry status controls.
- [x] Run focused tests, inspect App integration, and document contextual keyboard behavior.

## Task 3: Review and production acceptance

- [x] Run formatting and full `npm run check`; independently review the combined diff and resolve material findings.
- [x] Run Docker harness normal/fault regression and speech-enabled product E2Es on a fresh source snapshot.
- [x] Use an owned Docker MCP run for the editing-workflow baseline plus targeted workspace acceptance.
- [x] Observe default layout, pointer reorder, transport placement, cancellation, divider constraints, keyboard alternatives, reset, restart restoration, project dirty-state independence, and text selection/scroll stability.
- [x] Check the 900 by 600 minimum window and light theme as variations.
- [x] Retain screenshots/actions and an evidence-backed agent-testing report in the owned run directory.
- [x] Commit the verified checkpoint on the existing isolated branch and hand it back for review without merging.

## Acceptance boundaries

The baseline requires import, split/move, undo/redo, play/pause/seek/resume, and save/restart/reopen observations.
Existing deterministic E2Es supplement but do not replace the adaptive MCP acceptance.
No durable scenario definition is changed in this checkpoint; targeted checks are recorded with the run.
Native macOS titlebar and physical audio hardware remain outside Docker acceptance.

## Execution record

Completed on 2026-09-10 in the existing isolated branch, based on `cf21735`.
The user explicitly authorized this checkpoint to run through verification without another review pause.
Independent review found and resolved save-loop cleanup races and stale pointer-completion state; regression tests cover them.
Load errors and save errors are distinguished so a failed load cannot offer a misleading save retry.

Validation: `npm run format`, `npm run check` (557 tests in 80 files, lint, Knip, type checking and production build), Docker harness (25 tests in 12 files), and speech-enabled product E2Es (4 tests in 3 files) all passed.
Adaptive Docker MCP acceptance also passed the editing baseline and targeted workspace checks.
The evidence-backed report is retained at `.harness-runs/container/814fe916-42b2-4d1c-8abe-3748e0ac9a06/agent-testing-report.md` in this worktree.
Logs are `/tmp/workspace2-check-final.log`, `/tmp/workspace2-harness.log`, and `/tmp/workspace2-e2e.log`.

No new dependency, project schema, main/preload change, mock comparison controls, or transcript overlap behavior was introduced.
Full visual migration remains checkpoint 3; native macOS behavior remains outside Docker verification.
The verified branch is retained for user review without merge or push.
