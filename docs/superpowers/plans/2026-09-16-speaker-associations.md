# Speaker Associations Implementation Plan

**Goal:** Deliver the approved person/association workflow with durable metadata, staged editing, and undo.
**Architecture:** Pure shared identity catalog; main atomic guarded persistence; renderer draft editor and derived display; ordered domain-specific history.
**Tech Stack:** TypeScript, Zod, React, Zustand, Electron, Vitest, Docker MCP.
**Spec:** ../specs/2026-09-16-speaker-associations-design.md

## Global constraints

No source audio/artifact modifications, no unverified speaker-number reassignment, no editing without completed diarization. New modules PascalCase. English and Chinese localization. No host Electron or model downloads. Worktree codex/speaker-associations based on e18072b; existing installed node_modules reused.

## Tasks

- [x] Shared domain and main persistence. Create SpeakerIdentityTypes.ts, SpeakerAssociations.ts, SpeakerIdentityReconciler.ts and SpeakerIdentityService.ts plus colocated tests. Add optional speakerIdentities to project/session, derive initial catalog from completed speakers and legacy overrides. Persist source bindings separately from source artifacts. Save request: {workspaceToken, expected: SpeakerIdentityCatalog, next: SpeakerIdentityCatalog}; guard expected catalog and affected current bindings under mutex, then save only metadata. Reconciliation must retain old person metadata and compute current/needs-review status without reusing new revision speaker IDs. Add identity IPC/preload contract.
- [x] UI components. In components/speakers add SpeakerIdentityControls, SpeakerIdentityEditor, SpeakerIdentityPresentation, SpeakerColorChoices, and SpeakerIdentities.css. Consume catalog, analyses, tracks, source names; emit catalog commit through callback. Real React tests for empty person membership, atomic draft edits, per-member editing, duplicate candidate suppression, tree and no-edit pending sources. Pixel-sized dot and anchored portal menus must match mock.
- [x] Presentation and ordered history integration. Replace SpeakerLabels contents with identity UI; use source bindings to resolve display names, group color and visibility for transcript paragraphs. Add domain-specific identity entries to existing history without replacing unrelated timeline data. Async save/undo must guard session and retain local clip edits. Keyboard/menu undo must reflect last chronological operation. Add regression tests for interleaved redactions/identity updates, imports and analysis.
- [x] Verification and review. Run focused tests during implementation, npm run format then npm run check. Independently review diff and fix findings. Read agent-testing scenario/harness guide; use fresh owned Docker run, baseline plus fixture-driven multi-source speaker tests. Save report, stop owned container. Document any blocked checks truthfully. Commit finished work on feature branch, do not merge/push without current request.

## Commands

```sh
npx vitest run src/shared/SpeakerAssociations.test.ts src/main/speakers
npx vitest run src/renderer/src/components/speakers src/renderer/src/stores
npm run format
npm run check
```

## Execution record

User approved implementation without further design gates. Independent UI and domain work may be delegated through dispatching-parallel-agents; integration remains root-owned. No instruction files will be changed without permission.


## Completion record

Implemented the shared catalog and reconciliation, guarded main-process IPC, staged renderer editor and management tree, presentation, and chronological metadata/timeline history.
SpeakerIdentityEquality compares JSON structure independently of property insertion order so schema-normalized IPC responses do not produce false undo/redo conflicts.
Independent review and live acceptance identified and resolved detached-source editability, concurrent redo history, historical-name validation, toolbar wrapping, and inline-name blur/save positioning regressions.

Verification: `npm run format` and `npm run check` passed; 149 test files and 1086 tests, ESLint, Knip, TypeScript, and production build.
Final fresh Docker acceptance: `ead24911-3395-4440-addc-d307cd2705e2`, generations 1–4, using renderer `index-viGr_eOC.js` / `index-BBWPFe4X.css`.
Report retained under `.harness-runs/container/ead24911-3395-4440-addc-d307cd2705e2/agent-testing-report.md` with snapshots, screenshots, lifecycle provenance and check output.
Real UI verified drag/drop, staged multi-member edits, association/member names, automatic/Hex colors, tree, visibility, unlink, undo/redo, stale readonly presentation, save/restart persistence, and the baseline editing workflow.
Unit tests cover pending/skipped diarization, analysis revisions, imports, stale saves, asynchronous history and three-person unlink semantics.
Live inference, audible output and native macOS window behavior were not exercised; no source audio, real projects or model caches were changed.
