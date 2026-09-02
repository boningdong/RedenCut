# Documentation Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale and misplaced repository documentation with a concise, authoritative instruction system and an implementation-accurate product roadmap.

**Architecture:** `AGENTS.md` remains the instruction entry point and links to focused standards at the root of `docs/` without repeating them. `docs/superpowers/` contains dated, non-authoritative implementation records; `ROADMAP.md` contains product status and future work.

**Tech Stack:** Markdown, Electron, React, TypeScript, Zustand, Zod, Web Audio, WebCodecs, whisper.cpp, npm verification scripts.

## Global Constraints

- Preserve application behavior; this is a documentation-only change.
- Keep every prose sentence on one Markdown source line.
- Link authoritative files instead of duplicating their contents.
- Delete obsolete documentation rather than archiving it.
- The root of `docs/` contains only durable project rules and standards that extend `AGENTS.md`; dated records remain under `docs/superpowers/`.
- Every change must review `AGENTS.md` and its linked `docs/` files and update or remove obsolete guidance affected by that change.
- Do not present dated plans, specifications, audits, or verification results as current repository standards.

---

### Task 1: Establish the Authoritative Instruction Set

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/architecture-standards.md`
- Create: `docs/key-mappings.md`
- Verify: `docs/coding-standards.md`

**Interfaces:**
- Consumes: Current contracts in `src/shared/project.types.ts`, `src/shared/ipc.types.ts`, `src/shared/player.types.ts`, and `src/shared/transcriber.types.ts`; current shortcut behavior in `src/renderer/src/hooks/useKeyboardShortcuts.ts`.
- Produces: The repository instruction entry point and its complete set of focused standards extensions.

- [x] **Step 1: Add the documentation policy and project scope to `AGENTS.md`**

Add a concise project scope, link rows for `docs/architecture-standards.md` and `docs/key-mappings.md`, and the rule that the root of `docs/` contains only durable extensions of `AGENTS.md`.

Add the maintenance requirement that every change checks affected instructions for drift and updates or removes obsolete guidance in the same change.

- [x] **Step 2: Create `docs/architecture-standards.md`**

Document only current, enforceable invariants:

- Electron process boundaries and typed IPC;
- Zustand state ownership and Zod-derived persisted types;
- non-destructive editing and legacy project compatibility;
- `podcut://` audio access and regenerable peak caches;
- `IAudioPlayer`, preferred WebCodecs playback, and supported `SimpleAudioPlayer` fallback;
- AudioWorklet FIFO alignment, native sample-rate construction, and persistent processor lifetime;
- `ITranscriber` and the current local whisper.cpp implementation; and
- runtime binary resolution through `src/main/audio/binaries.ts`.

Use links to source contracts and implementation files instead of copying interfaces or code.

- [x] **Step 3: Create `docs/key-mappings.md`**

Document the mappings implemented by `useKeyboardShortcuts.ts`, including:

- macOS Command and Windows/Linux Control variants;
- selection-dependent behavior for M, U, Delete, and Backspace;
- preview-mode behavior when Space starts playback inside a muted clip;
- input, textarea, and content-editable focus exclusions; and
- the fact that transcript content-editable elements retain Space play/pause.

- [x] **Step 4: Verify the instruction links and shortcut contract**

Run:

```bash
for doc_path in docs/coding-standards.md docs/architecture-standards.md docs/key-mappings.md ROADMAP.md src/shared/project.types.ts src/shared/ipc.types.ts src/shared/player.types.ts src/shared/transcriber.types.ts src/shared/constants.ts; do test -e "$doc_path"; done
rg -n "case 'Space'|case 'KeyS'|case 'KeyM'|case 'KeyU'|case 'Delete'|case 'Backspace'|case 'Escape'|case 'ArrowLeft'|case 'ArrowRight'|KeyZ|KeyS" src/renderer/src/hooks/useKeyboardShortcuts.ts
```

Expected: every linked path exists, and every implemented keyboard branch has a corresponding entry in `docs/key-mappings.md`.

### Task 2: Remove Obsolete and Misplaced Documentation

**Files:**
- Delete: `DEVLOG.md`
- Delete: `docs/project-proposal.md`
- Delete: `docs/project-proposal-simplified.md`
- Delete: `docs/technical-roadmap.md`
- Delete: `docs/technical-roadmap-addendum.md`
- Delete: `docs/readability-cleanup-audit.md`

**Interfaces:**
- Consumes: The durable requirements extracted into Task 1 and current product direction retained in `ROADMAP.md`.
- Produces: A `docs/` root containing only the three approved standards files, with dated plans and specifications under `docs/superpowers/`.

- [x] **Step 1: Delete the six obsolete or misplaced documents**

Use `apply_patch` to delete the exact files listed above after Task 1 has preserved the approved durable rules.

- [x] **Step 2: Verify the `docs/` boundary**

Run:

```bash
find docs -maxdepth 1 -type f -name '*.md' -print | sort
```

Expected output contains only:

```text
docs/architecture-standards.md
docs/coding-standards.md
docs/key-mappings.md
```

### Task 3: Reconcile the Product Roadmap

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: Current implementation under `src/`, current tests, and future product direction already represented in `ROADMAP.md`.
- Produces: A concise roadmap that distinguishes completed capabilities, current gaps, and future milestones without acting as an architecture standard.

- [x] **Step 1: Replace stale implementation status**

Remove the stale fixed test counts, `CLAUDE.md` reference, resolved Phase 3 prerequisites, and superseded `activeTrackFilter` terminology.

Mark implemented Phase 3 capabilities as complete and retain current limitations as remaining work, including track-scoped waveform shortcut routing, native export-path selection, export processing gaps, and user-facing export error handling.

- [x] **Step 2: Remove duplicated architecture rules**

Replace detailed architecture notes with links to `docs/architecture-standards.md` and the relevant source contracts.

Keep future audio polish, intelligence, and plugin milestones only where they still express intended product direction.

- [x] **Step 3: Cross-check roadmap claims against the repository**

Run targeted searches for current Phase 3 features:

```bash
rg -n "addSourceFile|moveClip|removeTrack|updateTrack|visibleTrackIds|ensureTrackVisible|project:export|render:progress|ExportModal" src
rg -n "loudnorm|acrossfade|clip\.gain|track\.volume|track\.muted|track\.solo" src/main/audio src/main/ipc
```

Expected: completed roadmap claims have reachable implementations, while absent or partial export processing remains listed as future work.

### Task 4: Final Documentation and Repository Verification

**Files:**
- Verify: `AGENTS.md`
- Verify: `ROADMAP.md`
- Verify: `docs/*.md`
- Verify: repository-wide Markdown references

**Interfaces:**
- Consumes: All outputs from Tasks 1–3.
- Produces: A clean, committed documentation architecture with no known stale authoritative guidance.

- [x] **Step 1: Search for obsolete authoritative references**

Run:

```bash
rg -n "CLAUDE\.md|DEVLOG\.md|project-proposal|technical-roadmap|readability-cleanup-audit|activeTrackFilter|77 unit|77 existing" AGENTS.md ROADMAP.md docs || true
```

Expected: no matches.

- [x] **Step 2: Review the documentation diff**

Run:

```bash
git diff --check
git diff --stat
git diff -- AGENTS.md ROADMAP.md docs
```

Expected: no whitespace errors; all changes match the approved documentation roles; no application source files changed.

- [x] **Step 3: Run the complete repository gate**

Run:

```bash
npm run check
```

Expected: Prettier, ESLint, Knip, TypeScript, all Vitest suites, and the Electron build pass.

- [x] **Step 4: Commit the completed cleanup**

Run:

```bash
git add AGENTS.md ROADMAP.md docs DEVLOG.md
git commit -m "docs: establish authoritative repository standards"
```

- [x] **Step 5: Confirm the worktree is clean**

Run:

```bash
git status --short
git log -2 --oneline
```

Expected: clean status and the documentation cleanup commit immediately above the documentation design and implementation-plan commits.
