# Acoustic edit unit recovery implementation plan

Goal: Restore usable source-audio mappings for low-confidence text and allow continuous selections with reliable outer boundaries to redact despite internal missing character timings.
Architecture: Raw observations and audio evidence are retained separately from final disjoint-text-coverage AEUs. Recovery happens before publishing text, independently of diarization. Renderer consumes source ranges and never creates timestamps.
User approved this architecture and implementation in conversation. Continue current checkout; preserve prior uncommitted fixes. Do not modify real user projects, instructions, model installations, or redact storage representation.

- [x] Worker evidence/recovery: red tests for anchored one/multiple-character gaps, quiet positive-score audio, silence, edge fallback, invalid/overlapping boundaries, retry limits and segment offsets. Retain observations; bounded local retry using already-loaded model; resolve direct, inferred or group-level AEUs; retain truly unresolvable text.
- [x] Shared/main contracts: optional recoveryVersion 1 metadata and provenance, typed observations and timingOrigin, final unique text membership; retain v1/v2 artifacts. Test worker validation, coordinator creation, persistence and renderer session propagation in pending/completed/skipped states.
- [x] Selection: internal unaligned selected text allowed when first/last selected speech have usable boundaries. Single/group AEU boundary expansion uses existing confirmation. Preserve hidden text, duplicate source occurrence, disjoint clips and stale target protections. Actual pending-stage component edit test.
- [x] Presentation/integration: expose approximate time hints without inventing per-character granularity, retain raw text, verify newly recovered groups remain readable and deletable.
- [x] Verification: focused red/green suites, full npm format/check and Python tests; native short real-model pipeline and Demo2 diagnostic recovery; fresh Docker baseline and supported changed-behavior checks, explicit inference-resource blockers. Independent review and final evidence report.

Primary ownership: alignment.py/alignment_quality.py/new alignment_recovery.py; shared speech schemas and main speech/session mapping; AcousticSelectionResolver/transcriptSelection; renderer projection and timing presentation. Tests remain beside implementation.
No LLM text correction or clip overlay changes in this item. Long local retry windows or missing reliable context must fall back without unbounded inference work.

## Verification so far

- Full npm check: 131 files, 969 tests passed, format/lint/deadcode/typecheck/build passed.
- Full Python suite: 69 tests passed, including EOF context clipping discovered during native verification.
- Native real-model 30-second conversation: text published at 10.9 seconds, completed with diarization at 26.3 seconds. 138 AEUs, no unmapped speech text; one local retry recovery and one bounded group fallback. Alignment and transcript identities preserved through diarization.
- Read-only Demo2 diagnostic: missing 晖 receives inferred bounds 17.714–18.384 from saved outer anchors and actual source audio; 32 historical candidate text units over genuine silent B audio remain rejected.
- Fresh Docker baseline and Demo2 bridging, redaction, undo/redo, full restart/reopen PASS. Owned run stopped. Multi-character group confirmation and live pending-diarization UI BLOCKED by unavailable fixture/models; those paths have separate component/native coverage. Report: `.harness-runs/container/9dfe951d-b323-4ba2-9e7a-62212138b4db/agent-testing-report.md`.

Limits: This does not correct transcription spelling. Nonzero background noise is not proof of speech; current silence test establishes digital silence only. Shared timing is a coarse audio range, not fabricated per-character precision. Missing evidence may still leave text unaligned. Overlap-only failures use conservative range recovery rather than consuming a retry. Existing artifacts gain new recovery metadata on reanalysis; continuous-selection behavior works with existing validated outer boundaries.
