# Final Editor UI Implementation Plan

> Execute with superpowers:subagent-driven-development; the user authorized all remaining phases through testing and acceptance before the next handoff.

**Goal:** Deliver the approved visual interface and single-column multitrack transcript with local overlap alignment using real project data.
**Architecture:** Workspace retains layout ownership, existing production feature paths remain active, and a pure renderer projection maps source acoustic boundaries into clip occurrences on the output timeline.
**Stack:** Existing React, TypeScript, Zustand, Electron IPC, CSS, Vitest and Docker MCP.
**References:** [Workspace specification](../specs/2026-09-10-editor-workspace-design.md); [approved mock](../../../ui-mock/2026-09-10/redencut-ui-final.html) and [English requirements](../../../ui-mock/2026-09-10/redencut-ui-requirements.md).

## Constraints

Do not add fake project actions, comments/bookmarks, model features, remote fonts, or new external dependencies.
Use actual timestamps; preserve natural spacing outside overlap; alignment is local to a simultaneous-speech card.
Names appear once per speaker group, wrapped correspondence is maintained, and faint guides convey matching positions.
Same-track ambiguous speaker separation is deferred; never imply independent audio removal there.
Preserve real generation, progress, availability, rename, playback, selection expansion, export and project persistence.
Keep changes in the existing isolated review branch without automatic merge/push.

## Task 1: Occurrence-scoped edits

- [x] Add failing tests for a moved duplicate clip, other-track isolation, multiple selected ranges in one undo entry, invalid IDs/ranges and clipping.
- [x] Implement `muteClipRanges(trackId, clipId, sourceRanges)` in the timeline store; map source ranges to the selected occurrence and keep history atomic.
- [x] Run focused timeline tests; 55 passed.

## Task 2: Transcript projection and overlap UI

Owner: transcript implementer; files under renderer domain and components/Transcript.

- [x] Document output occurrence identity and projection rules in an English design record.
- [x] Test all analyses/clip occurrences, trim/split/move/removal, touching nonoverlap, multiple tracks, repeated source occurrences, punctuation/unaligned content, and undo/redo-derived updates.
- [x] Build conversational blocks and exact simultaneous intervals without spacing normal pauses by time.
- [x] Render local Read/Align controls with wrapped speaker groups, subtle guides, real seek and concurrent playback highlighting.
- [x] Resolve selections to the correct source/analysis/track/clip; use the scoped mute action, preserve expansion confirmation, and explain unsupported cross-occurrence selections.
- [x] Preserve generation for all tracks and machine-speaker rename behavior.
- [x] Run focused tests and resolve independent review findings.

## Task 3: Visual integration

Owner: visual implementer; App, Workspace chrome, Transport, FileInfo, Waveform and theme/shared controls.

- [x] Apply the approved mock's dark surfaces, restrained borders, rounded panels, purple actions and readable sans typography; preserve light theme.
- [x] Keep the project header compact, metadata behind Details, and macOS window controls clear of interactive content.
- [x] Wire real undo/redo into Transport with history-aware disabled states; retain play/time, preview and theme controls.
- [x] Preserve drag/resize/keyboard behavior and minimum-window reachability while removing redundant chrome.
- [x] Run focused interaction tests and compare actual rendered UI with the mock.

## Task 4: Integrated verification and user handoff

- [x] Perform independent review of projection, editing scope and integration; fix material findings before acceptance.
- [x] Run format and full npm check, plus Docker harness normal/fault and speech-enabled E2E regression.
- [x] Use a fresh owned Docker MCP source snapshot for baseline editing and targeted multitrack/visual acceptance.
- [x] Verify import/generate, two-track overlap, local mode switching, seeking/highlighting, clip movement removing/restoring overlap, scoped text mute/undo, speaker rename, save/restart, draggable layout, minimum viewport and light theme.
- [x] Retain evidence-backed agent-testing report with limitations; commit verified product/docs, then present for user acceptance.

## Delivery and verification

Completed visual integration and multitrack transcript implementation on `codex/workspace-preferences`.
Real acceptance found and fixed muted paragraph fragmentation and analysis completion reloading an obsolete player timeline.
Independent review also fixed ordinary conversational turn order and stale selection/confirmation boundaries.
Full check passed589 tests; Docker harness passed25; real product E2Es passed5.
Final adaptive run `f429ca59-f3d9-4fc1-9032-e0748ae537ba` passed its baseline and targeted checks across two application generations and closed cleanly.
Evidence: `.harness-runs/container/f429ca59-f3d9-4fc1-9032-e0748ae537ba/agent-testing-report.md`.
Native macOS chrome, actual export destination/encoding, model-quality assessment and large-session performance remain outside this Docker verification.
No merge or push was performed; the isolated branch is retained for user review.
