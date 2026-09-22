# Release interaction fixes implementation plan

> **For agentic workers:** Use superpowers:executing-plans for each independently testable subsystem. Existing domain reviewers own bounded fixes; the parent owns integration and acceptance.

**Goal:** Apply the approved project-name menu plus native File menu, repair outstanding release-blocking interactions, and record new findings against main 21aca79.

**Architecture:** Retain current Project v4 and speaker catalog v1. Reuse project transition transactions for New/Close and close protection, with a typed main-to-renderer command boundary. Repair domain selection, history, modal focus and prepared-audio ownership locally.

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest, Docker MCP.

**Spec:** User-approved A project-name menu plus native File menu and prior audit at /Users/boning/Workspaces/Podcut/output/main-interaction-review-2026-09-20/review.md. Current re-audit reports at /Users/boning/Workspaces/Podcut/output/main-reaudit-2026-09-21/.

## Global constraints

- Keep project format v4; do not back-write v3 or regenerate source media.
- Main owns dialogs, filesystem and native lifecycle; preload exposes typed commands only.
- Keep existing main checkout untouched; implement in codex/release-interaction-fixes.
- New, Open, Close and Quit protect temporary populated workspaces and unsaved edits. Cancellation or failure retains current work.
- Native File commands and the project-name menu invoke the same renderer operations.
- Do not add a project library or automatic speaker rebinding.

## Review focus

- Cancel save destination during close: current editor remains usable and shutdown has not begun.
- Repeated quit/window-close requests: share one pending decision, no duplicate dialogs.
- Temporary imported project marked clean: still requires save/discard decision on departure.
- Multiple independently processed tracks: one consumer cannot invalidate another's prepared handle.
- Open modal/popover and focused scrollbar: local keys remain local; unrelated project commands retain documented behavior.

## Task 1 — Project commands and departure protection

Files: App.tsx, project-name menu component, shared project command/save-state types, preload/index.ts, main native menu/close coordination, applicationLifecycle.ts and focused tests.

- [x] Add failing tests for temporary populated departure, cancelled/repeated quit, and new/open/menu routing.
- [x] Derive project save state from workspace kind plus local dirty state. Use this predicate when capturing transition drafts.
- [x] Add New and Close using the existing empty-starter transition, preserving save/discard/cancel behavior.
- [x] Route File menu commands through typed project events. Close protection waits for a successful empty-session transition before allowing OS window closure or shutdown. Failed/unanswered requests fail closed.
- [x] Replace top-level Open/Save As buttons with a keyboard-accessible project-name menu; preserve Save and Export.
- [x] Run lifecycle, preload, App and project coordinator tests; update keyboard contract to approved behavior.

## Task 2 — Timeline selection and history

Files: TimelineStore.ts, UseTimelineContextMenu.tsx, UseClipInteraction.ts, MixLinkEditor, TimelineScrollbar.tsx and tests.

- [x] Reproduce right-click dismissal/Delete scope, remaining updateTrack history omission, readonly marquee and no-op Mix save.
- [x] Repair these ownership boundaries without changing serialized tracks.
- [x] Reproduce focused-scrollbar Save/Undo suppression and consume only scrollbar-owned navigation keys.
- [x] Run targeted timeline/control/context/placement tests.

## Task 3 — Speaker identity lifecycle

Files: SpeakerIdentityService, SpeakerIdentityEditor, source-scoped speech rerun impact helper, speechBatch IPC, App generateTranscript warning and tests.

- [x] Reproduce stale association unlink and missed reset warning using current catalog.
- [x] Permit removal of obsolete membership while validating newly added/edited live bindings.
- [x] Share current-catalog impact calculation for renderer confirmation and main enforcement; retain schema.
- [x] Run speaker service/editor/history and speech batch tests.

## Task 4 — Effects and export

Files: ExportModal, PreparedTrackProvider/WorkletAudioPlayer or prepared IPC ownership and tests.

- [x] Reproduce modal shortcut leakage and concurrent Auto Level lease collision.
- [x] Use existing dialog focus/cancel pattern; preserve asynchronous export cancellation.
- [x] Assign independent track preparations independent request ownership while preserving content pooling.
- [x] Run player/provider/IPC/export tests and actual PCM integration tests.

## Task 5 — Integration and release evidence

- [x] Run npm run format, inspect semantic diff, and npm run check. Final result: 200 files / 1553 tests, checks and production build pass.
- [x] Run agent-testing editing baseline plus applicable UI consistency, keyboard and changed-behavior checks through an owned Docker MCP run using current worktree snapshot.
- [x] Preserve report/evidence; stop owned run. Disclose unavailable native macOS close/quit and real-model coverage.
- [x] Consolidate old/new/fixed findings with exact evidence and remaining risks; do not merge without user instruction.

## Final verification outcome

`npm run check` passed (200 files, 1553 tests, production build); selected Docker fixed E2Es passed (4 files, 6 tests).
Docker MCP observed timeline/effects/project-menu checks passed, and owned runs were cleaned up.
Comprehensive manual acceptance remains BLOCKED on native dirty decisions/macOS lifecycle, stale-speaker fixture, running long export cancellation and forced I/O failure; these are disclosed in the consolidated report, not silently marked passing.
Consolidated report: /Users/boning/Workspaces/Podcut/output/main-reaudit-2026-09-21/review-and-fixes.md.
