# Mix Source Replacement Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and test-driven-development. User waived subsequent review pauses and authorized worktree execution.

**Goal:** Make linked independent recordings replace selected Mix intervals while preserving master editing semantics.
**Architecture:** Persist links on the owning track and overrides on master clips so existing Track[] snapshots remain atomic. Reuse shared frame render plan, main-owned redactions and exact source identities.
**Tech Stack:** TypeScript, Zod, Zustand, React, Electron, Vitest, Docker MCP.
**Spec:** docs/superpowers/specs/2026-09-19-mix-source-replacement-design.md

## Global Constraints
- Work only in this worktree; no main edits or merge.
- Shared contract: Track.mixLink?: {stemTrackIds:string[], hiddenSegments?: HiddenSegment[]}; Clip.sourceOverrides?: SourceOverride[]; SourceOverride={id,sourceStart,sourceEnd,stemTrackIds}.
- Zod source of truth; 48 kHz frame rendering; no source modification; PascalCase new modules; translated UI strings.
- Master alone edits time/redactions; child redactions persist but are ignored in composite; atomic undo.

## Review Focus
- Partial child coverage or overlapping child clips must not leak Mix or double-play audio.
- Crossfade wing spanning source changes retains sample envelope origin.
- Split/copy/trim/insert retains source mappings and independent IDs.
- Unlink restores entire affected override with history and saved child edits intact.
- Transcript replacement edits master rather than child and preserves coarse timing disclosure.

## Task 1: Data and audio pipeline
- [x] Add failing ProjectTypes and shared audio tests for links, override validation, v2 migration and B+C contribution output; run focused Vitest to observe failure.
- [x] Add MixLinkTypes.ts schemas and SourceRouting.ts pure helpers; integrate ProjectTypes.ts validation and migration.
- [x] Extend AudioRenderPlanBuilder.ts with substitutions after master planning; remove children from eligibility; preserve envelopes and frame coordinates.
- [x] Cover partial/gapped source coverage and crossfade wings using numerical PCM. Update WorkletAudioPlayer playback-structure comparison to include link/override metadata.
- [x] Run focused tests, format owned files and record results.

## Task 2: Synchronized domain edits and store
- [x] Add failing MixLinkEdits tests for link, split/move/copy, restore/unlink and history.
- [x] Add domain/MixLinkEdits.ts shared edit normalization; update TimelineEdits/Placement, clipboard and TimelineStore without a parallel state store.
- [x] Expose setMixLink(mixTrackId,stemTrackIds):boolean, replaceMixSources(mixTrackId,start,end,stemTrackIds):boolean, restoreMixSources(mixTrackId,start,end):boolean. Empty stem list detaches all; each mutation is one history entry.
- [x] Guard child editing, preserve child prior metadata, make conflicting cross-track edits invalid.
- [x] Verify store/domain suites and report behavioral edge cases.

## Task 3: UI
- [x] Add UI tests for connected icon, associate/unlink warning, floating draft apply/cancel and read-only children.
- [x] Add MixLinkDialog.tsx and SourceOverridePopover.tsx, connect TrackHeader/WaveformView using store API from Task 2.
- [x] Use existing ruler selection and anchored popover behavior; show multi-source replacement waveforms inside master lane and compact children.
- [x] Use mono Mute/Solo icons, accessible state/labels and English/Chinese resources.
- [x] Run component tests and format owned files.

## Task 4: Transcript and integration
- [x] Add projection tests for default hidden children, multi-source replacement, parent redaction ownership and missing analyses.
- [x] Integrate transcript source projection without persisting derived occurrences; preserve output/source mapping and parent edit target.
- [x] Verify session save/open/version migration and structural history deep clones; update authoritative architecture/keyboard docs.

## Task 5: Review and acceptance
- [x] Run npm run format then npm run check and harness tests; independently review code and fix material findings.
- [x] Use Docker MCP baseline plus UI-consistency and feature-specific checks, inspect produced exports when available.
- [x] Retain acceptance evidence and report explicit blocked checks; leave reviewable commits on worktree branch.
