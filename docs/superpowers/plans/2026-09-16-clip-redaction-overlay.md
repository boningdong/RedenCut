# Clip Redaction Overlay Implementation Plan

**Goal:** Text deletion creates editable clip-owned audio redactions without splitting clips; clip mute preserves duration.
**Architecture:** Persist source-relative redactions on clips. Shared pure interval functions drive playback/export and text coverage. Selection and pointer previews are transient; committed mutations enter existing track snapshot history.
**Spec:** Approved in this thread: removable/resizable overlays follow clips, adjacent effects form a union while objects remain independent, ordinary clip mute is separate, no old-project migration, PascalCase for new modules.
**Tech stack:** TypeScript, Zod, Zustand, React, AudioWorklet, FFmpeg, Vitest and Docker MCP.

## Constraints

- Preserve existing fixtures and other pending changes. No filename-wide refactor in this feature.
- Source timestamps remain authoritative. No transcript/alignment artifact rewrites.
- Store overlay identity separately from merged effective coverage. Clamp visible effects to clip boundaries; retain hidden metadata on trims.
- Split partitions overlay ranges; edits to either half are independent and undo restores originals.
- Mouse selects; selected overlay Delete removes it. Pointer edge movement previews locally, release commits once, Escape cancels.
- New projects with no redactions default to an empty array. Do not convert old mute markers.

## 1. Shared model and rendering

- [x] Add failing behavior tests: 10–20s source clip at 0 with overlays 12–14 and 14–16 yields 2–6s deletion; mute alone yields no skip; a retained overlapping track protects that interval.
- [x] Add `ClipRedaction` schema in `project.types.ts` and `ClipRedactions.ts` pure union/complement/coverage functions.
- [x] Playback plans and FFmpeg args render retained subranges, without mutating clips; global skip rules use redaction ranges only.
- [x] Test exact frames and decoded WAV retained content, including adjacent redactions and ordinary mute duration.

## 2. Editing and history

- [x] Write store tests asserting transcript deletion keeps clip ID/count/range and creates an overlay; one undo/redo restores the operation.
- [x] Replace transcript split/mute paths with `redactClipRanges` and `redactTranscriptRange`; retain stale-occurrence guards.
- [x] Add overlay resize/remove and transient typed timeline selection; ordinary mute/unmute does not merge clips.
- [x] Test moves, split partitioning, invalid bounds, independent overlapping overlays and imported-track history.

## 3. Presentation and interaction

- [x] Derive none/partial/full text coverage from AEUs and overlay union; keep mute dimming separate from redaction strike-through.
- [x] Add `ClipRedactionOverlay.tsx` with selected state and two resize handles, pointer capture, cancellation and localized accessible controls.
- [x] Route keyboard/toolbar actions by selected target; prevent parent clip dragging while interacting with overlays.
- [x] Add real component regressions for resize commit/cancel, selection/delete and mixed text coverage.

## 4. Acceptance

- [x] Update architecture/keyboard contracts and activate resolved overlay scenario checkpoints.
- [x] Run format and full `npm run check`; adjust obsolete mute-as-redact expectations to approved semantics.
- [x] Run Docker fixed E2Es on both transcript fixtures, plus agent baseline/overlay checks and export-content inspection. Report missing coverage explicitly.
- [x] Review final diff and hand off outcome, verification and limits.

## Verification outcome

Implementation and targeted checks completed; full manual transcript/preview scenario acceptance remains incomplete.
See `.harness-runs/container/4a53a99e-68aa-4a55-9145-5b75e2c5a349/agent-testing-report.md` for passing checks and explicit coverage gaps.
