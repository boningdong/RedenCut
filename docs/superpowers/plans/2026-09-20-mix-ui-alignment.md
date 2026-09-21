# Mix UI alignment implementation plan

> **For agentic workers:** Use superpowers:executing-plans task by task.

**Goal:** Implement the approved app-aligned mock and preserve all existing audio editing semantics.
**Architecture:** Keep routing and timeline edits unchanged; presentation derives the current range's uniform or mixed source state. Range controls update the existing timeline selection. Linked recordings are limited to six at the domain edit boundary.
**Tech Stack:** React, TypeScript, Zustand, Vitest, Docker MCP.
**Spec:** User-approved `output/sync-source-mock/app-aligned.html` in the parent workspace and the conversation's subsequent fixed-height correction.

## Constraints and decisions

- Work in the existing codex/mix-source-replacement worktree; preserve source mock history.
- Master row stays 64px. Up to three linked recordings use stacked source waveforms; four through six use one explicitly illustrative waveform. Threshold uses linked count, not selected source count.
- Participants: at most three names if they fit; otherwise colored dots and participant count. Full names in tooltip and editable floating selector.
- Child × still deletes the track and transcript. Unlink remains a separate management action with affected-range warning.
- Master role, child branch hierarchy, collapse count, explicit creation vs management and unlink-all controls.
- Floating replacement has local draft, numeric bounds, multi-choice, explicit replace CTA, mixed-state warning, restore availability. Click an existing replacement to edit its exact visible bounds. Range edge dragging changes selection, never clips.
- Master controls/redaction semantics, transcript routing and playback/export behavior remain unchanged.
- User explicitly approved implementation and previously waived plan review; execute without another approval gate.

## Review focus

Mixed original/replaced regions must never imply a uniform set; editing a range after choosing sources must remain predictable; replacement clicks must not start clip dragging; narrow labels must remain clickable; seven-source mutations must fail without changing project or undo history.

## Tasks

- [x] 1. Add failing regression tests for mixed/partial range status, six-source limit, floating range inputs and exact replacement activation. Implement range-state helper and domain limit.
- [x] 2. Update SourceOverridePopover, MixLinkDialog, TrackHeader and locale copy; update tests to explicit action labels. Keep stored data backward readable and reject new links above six.
- [x] 3. Update MixClipWaveform and extract range handles; wire WaveformView selection, stable toolbar entry, direct edit and completion feedback. Test fixed presentation modes and range gestures.
- [x] 4. Run formatter, focused regressions and full `npm run check`; review whole change; inspect actual Docker MCP screenshots at 3/4/6 tracks, light/dark and narrow widths plus baseline task. Record blockers honestly and preserve evidence.

## Progress

- Initial read-only review complete. No product changes yet; base 60e4bbc. Existing worktree has only runtime/dependency symlinks untracked.
- Tasks 1–3 implemented. Mixed range helper, domain maximum, exact interval entry, numeric and pointer bounds, semantic grouping and compact source display have focused regressions.
- Initial full check passed: 180 files, 1384 tests, lint/Knip/typecheck/build.
- Whole-change review found transient success feedback and offscreen toolbar anchor issues. Fixed with separate expiring feedback and reveal-before-open; focused regression passes.
- Docker baseline running on first UI snapshot; changes after snapshot will be validated in a fresh container before handoff.

- Final: 180 test files / 1385 tests and complete check pass. Docker final run `67f2d600-1da9-42bf-a94b-c5ecc5eb60df` passed targeted UI and editing baseline; stopped and retained evidence. No live-listening claim.
- Resize re-edit restores old bounds and applies new bounds in one commit; regression confirms one Undo.
- Floating layout conflict found in screenshots fixed with source-specific selectors, then rerun in a fresh container.
