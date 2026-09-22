# Auto Level preparation implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development; root integrates/reviews all changes and owns final verification.

**Goal:** Deliver the approved Auto Level behavior and eliminate duplicate preparation/full processed-PCM waveform scan.
**Architecture:** Dry composition + streamed RMS analysis, bounded gain envelope applied during indexed PCM write, shared content-keyed preparation jobs, and renderer polling of measured progress.
**Tech Stack:** Electron, TypeScript, FFmpeg, Node streams, Vitest, Docker MCP.
**Spec:** ../specs/2026-09-21-auto-level-preparation.md

## Global constraints

Non-destructive originals; preview/export parity; no fixed -16 LUFS makeup; unchanged sample-domain timing; no new dependencies; bounded PCM memory; shared jobs isolated to sender/workspace; no host-app testing.

## Review focus

Cancellation while multiple consumers share a job; sample/channel/chunk boundaries; project revision versus workspace switches; stale completion replacing newer waveform; export applying gain exactly once.

## Tasks

- [x] DSP worker: AutoLevelAnalyzer/Envelope and real PCM tests; remove fixed FFmpeg loudnorm path. Verify alternating speakers, quiet unity, silence/noise, stereo and peak bounds.
- [x] Stream worker: PreparedTrackService output streaming + indexed final PCM; PreparedWaveform builder; frame-based progress and abort cleanup. Verify split chunks and no overview rescan.
- [x] Cache worker: content jobs/reference counts/LRU; progress API and preload; strict lease ownership and session teardown. Verify shared requests and independent cancellation.
- [x] Root: renderer progress polling and phase copy, retaining previous provider; integrate shared prepared PCM export with cancellation and gain parity tests.
- [x] Root: review each worker diff and resolve integration tests; full format/check, long-file numeric timing evidence, fresh Docker baseline/changed behavior.
- [x] Root: update active standards/scenario, produce evidence report, commit completed verified change.

## Rulings

Proceed without another plan approval: user explicitly approved all four items and earlier waived engineering-document review. Track-level adaptive reference covers the entire composed master including Replace; no automatic cross-track speech/music grouping is introduced. Peak protection is described as sample-peak safety rather than claiming certified intersample true-peak limiting.
