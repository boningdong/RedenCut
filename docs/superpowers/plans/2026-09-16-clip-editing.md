# Clip Editing Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent modules and final review.

**Goal:** Deliver the approved basic clip editing workflow with accurate cross-track drag previews.
**Architecture:** Pure placement and edit functions calculate next tracks; Zustand commits one guarded snapshot. React interaction hooks own transient gestures, with a project-local clipboard.
**Tech Stack:** TypeScript, React, Zustand, Vitest, Electron, Docker MCP.
**Spec:** ../specs/2026-09-16-clip-editing-design.md

## Global Constraints

- Preserve source audio, current redactions, and unrelated work.
- No format migration, ripple delete, effects or join operations.
- New module filenames are PascalCase; copy is localized in English and Simplified Chinese.
- Pointer preview and commit share an exact calculation; each completed gesture is one Undo.

## Task 1: Domain and store

Create domain/TimelinePlacement.ts and TimelineEdits.ts plus tests; modify stores/timeline.store.ts.
Interface: planClipPlacement(tracks, ids, anchorId, outputStart, targetTrackId, {insert, snapThreshold?}) returns {tracks, clipIds, guideTime?} or null. trimClip(tracks, clipId, edge, outputTime, sourceDuration) returns Track[] or null.
Store adds selectedClipIds, setSelectedClipIds(ids, primaryId?), commitTracks(expected, next, label, selectedIds?), removeClips(ids), setClipsMuted(ids, muted), snappingEnabled and insertMode setters.
- [x] Test cross-track placement, group offsets, collision slots, insertion seams, invalid target, trim limits and restoration.
- [x] Implement pure calculations, preserving source metadata and immutable snapshots.
- [x] Test and implement guarded atomic commits and selection normalization, including project reset.

## Task 2: Clipboard and actions

Create TimelineClipboardStore.ts and ClipClipboardActions.ts with tests; modify timelineActions.ts and useKeyboardShortcuts.ts.
- [x] Test copy/paste source reuse with new clip/redaction IDs, project invalidation, one Undo, and text-focus exclusion.
- [x] Implement same-project clipboard; paste at playhead/selected track using placement; duplicate after selection using insertion.
- [x] Route batch delete/mute/unmute and Audio-only clipboard shortcuts.

## Task 3: Pointer UI

Create UseClipInteraction.ts, ClipDragPreview.tsx, ClipView.tsx; modify WaveformView.tsx and locale resources.
- [x] Add failing pointer integration tests for cross-track preview/commit, cancellation, trim and selection.
- [x] Implement drag threshold, lane hit testing, shared placement, edge scrolling, marquee and trim gestures.
- [x] Add simple snapping/insertion buttons and contextual clipboard actions without expanding the panel layout.
- [x] Verify component tests, existing-theme styling and keyboard focus compatibility (manual UI acceptance used the default dark theme).

## Task 4: Verification and review

- [x] Update architecture/key mappings/roadmap for delivered behavior.
- [x] Run npm run format and npm run check; investigate failures without deleting unrelated work.
- [x] Review the combined change, fix identified correctness issues and rerun affected checks.
- [x] Use fresh Docker MCP source snapshot for baseline and feature acceptance; retain screenshots and report limits.

## Completion evidence

See `docs/clip-editing-implementation.md` for module responsibilities and `.harness-runs/container/eb16adb2-e196-4886-8bc1-49d9491586be/agent-testing-report.md` for final acceptance.
Full check: 1056 tests; Docker regression: 5 tests; final MCP baseline and feature checks passed.
