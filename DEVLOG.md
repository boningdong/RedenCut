# Dev Log

Tracks in-progress work, bugs, missing pieces, and implementation notes.
For the high-level roadmap see ROADMAP.md.

Tags: `[BUG]` `[MISSING]` `[DECISION]` `[GOTCHA]`

Completed items are marked ~~strikethrough~~.

---

## Phase 3

### ~~[BUG] `splitAt` outputStart miscalculates after clip moves~~

- 2026-03-21: Identified — `right.outputStart = time` in `timeline.store.splitAt`
  assumes `outputStart === sourceStart`. This holds today because clips have
  never been moved, but will silently produce wrong positions once
  drag-to-reposition (Step 3.4) is wired up.
  Fix: `right.outputStart = clip.outputStart + (time - clip.sourceStart)`
- 2026-03-21: **Resolved** — applied correct formula in Task 5 (timeline.store TDD pass).

### ~~[MISSING] `addSourceFile` absent from `timeline.store`~~

- 2026-03-21: Identified — `addTrack(name, sourceFileId)` accepts a sourceFileId
  but never pushes a new entry into `sourceFiles[]`. There is currently no way
  to register a second audio file at the store level. Required before Step 3.6
  (add track via file drop) can work.
  Fix: add `addSourceFile(filePath: string, duration: number): string` that
  creates a `SourceFile`, appends it to `sourceFiles`, and returns its id.
- 2026-03-21: **Resolved** — `addSourceFile` implemented in Task 5 (timeline.store TDD pass).
