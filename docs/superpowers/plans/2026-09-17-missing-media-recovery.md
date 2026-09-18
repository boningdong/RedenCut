# Missing media recovery implementation plan

**Goal:** Restore missing copy-mode originals during project open, using the approved standalone mock.
**Architecture:** ProjectTransitionCoordinator waits for a main-owned recovery coordinator before cache preparation. A file service restores verified bytes without changing project metadata. Typed IPC exposes path-free snapshots to a localized modal.
**Spec:** User-approved architecture and mock at `/Users/boning/Workspaces/Podcut/output/missing-media-mock/index.html`.

- [x] File service: real-filesystem tests for matching bytes, mismatches, cancellation, unsafe paths and no-clobber publication; implement `findMissing(root, sources)` and `restore(root, source, selectedPath, signal, onBytes)`.
- [x] Recovery coordination: test ownership, early continue rejection, retry, cancellation and source identity retention; implement per-window runtime recovery state and typed IPC.
- [x] Open integration: invoke recovery after package validation and before descriptors; preserve existing dirty/save and switch barriers; test cancellation leaves current session active.
- [x] UI: localized Zustand snapshots and modal matching mock; test list, retry, disabled continue, cancel and event ordering; wire native file selection using existing import dialog seam.
- [x] Verification: format, full check, scoped review, Docker baseline/UI acceptance and missing-media scenarios; retain evidence and disclose unverified native behavior.

Constraints: Copy-mode missing files only. Preserve project.json, fingerprints, source IDs and speech data. Retain completed originals on cancel; remove unfinished staging. No actual main merge or remote push. No instruction or durable scenario edits without approval.

Verification: 156 test files / 1,138 tests passed with `npm run check`; scoped code review and Docker UI acceptance completed. Final keyboard-focus repair verified in a fresh container, run `8294a9c9-ce01-48ab-adc7-e6ac1c9b0089`. Native macOS picker and hardware audio were not exercised.
