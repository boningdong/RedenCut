# Editing and Playback E2E Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with verification checkpoints; the container and UI steps share a sequential bring-up dependency.

**Goal:** Exercise two real UI flows with captured container audio and no new internal application-state interfaces.
**Architecture:** Private PulseAudio null sink at container startup; bounded recording owner in `harness/audio/`; product tests invoke existing MCP actions and inspect visible UI plus recorded samples.
**Tech Stack:** Existing Docker, Electron, Playwright MCP, Vitest, FFmpeg and PulseAudio packages.
**Spec:** `docs/superpowers/specs/2026-09-07-editing-playback-e2e-design.md`.

## Constraints

Docker only for audio-dependent tests; fail before Electron launch outside Docker with the supported command.
No host sound, new MCP semantic methods, internal state exposure, source fixture changes, or changes to unrelated work.
Retain the existing import/save/reopen test as separately runnable.

## Task 1: Private audio and recording

Files: container Dockerfile, `harness/container/start-audio.sh`, entrypoint; `harness/audio/AudioCapture.ts`, `harness/tests/audio.integration.ts`, `harness/tests/AudioCapture.test.ts`.
Interface: `requireContainerAudio(): void`; `AudioCapture.start(directory, label): Promise<AudioCapture>`; `stop(): Promise<string>` returns a finalized WAV path; recording lifetime is bounded and only its owned process is signaled.

- [x] Write a guard test using an empty environment: `expect(() => requireContainerAudio({})).toThrow(/Docker/)`; run `npm test -- harness/tests/AudioCapture.test.ts` and observe red.
- [x] Write a container test that records silence, plays a known external tone into the private device, records non-silence and verifies capture termination; run it against the current image and observe the missing audio prerequisite.
- [x] Add private PulseAudio startup, readiness and explicit sink selection; stderr-only logs; no device/socket sharing or network listener.
- [x] Implement capture using FFmpeg Pulse input, retain logs, readiness and shutdown deadlines, idempotent stop and explicit early-exit errors.
- [x] Rebuild image and run the audio integration test; verify silence is not misreported as audio and failed capture cleans up.

## Task 2: Real UI editing and transport

Files: `e2e/editing-playback.e2e.ts`, repeated MCP setup only if necessary under `e2e/support/`, `harness/tests/audioAnalysis.test.ts` and `e2e/audioAnalysis.ts`.
Interface: audio analysis consumes captured PCM/WAV and reports RMS windows; it cannot access the player or application state.

- [x] Add analysis tests with literal silence and hand-built sustained samples: silence yields zero and an isolated impulse cannot satisfy sustained-output acceptance; observe red then implement.
- [x] Connect the existing MCP facade/client; use UI controls and visible geometry only, keeping product actions inline.
- [x] Add playback test: import, capture, click Play, poll visible time/button, Pause, observe stable time and quiet output, seek while paused, resume and observe time/audio again.
- [x] Add editing test: import, select the clip, seek and S, assert two visible clip regions, drag second region to create gap, save/restart/reopen and compare rendered geometry in seconds relative to visible ruler; capture audible playback after reopen.
- [x] Run `sh harness/container/run.sh npm run test:e2e -- editing-playback`; investigate failures without bypassing UI or weakening unsupported assertions.
- [x] Retain screenshots, action/recording timing, logs and WAV files on failure and success; stop capture before restart and cleanup.

## Task 3: Regression, documentation and review

- [x] Document container-only support and commands in `e2e/README.md` and `harness/container/README.md`; add the separate existing-flow command if needed.
- [x] Run formatting, `npm run check`, all Docker E2Es repeatedly, full harness suite and host-to-container smoke tests.
- [x] Inspect screenshots and audio evidence, request a scoped code review, address findings with regression tests.
- [x] Record exact verification results and remaining limits; commit only intended changes and leave merge/push to the user.

## Execution record

Baseline: existing linked worktree `feat/ui-debugging-harness`, no submodule, 489 tests passed before changes.

Final verification (2026-09-07 local date):

- New flows passed together, followed by three full product E2E runs with 3/3 passing each; the final run includes the review cleanup fix.
- Final editing evidence: `.harness-runs/container/1ba3383a-ce27-4ace-ba10-0d832ccf9001/`.
- Final transport evidence: `.harness-runs/container/55091f46-f51d-4e08-8070-dee6067d3539/`.
- Final original import/save/reopen evidence: `.harness-runs/container/b2d3bfce-d519-46c9-bbce-05cc6596e1c8/`.
- Docker full normal/fault harness suite: 25/25 passed, including two audio integration tests.
- Real host-to-container stdio smoke: 2/2 passed (EOF and Docker stop cleanup).
- Host and Linux `npm run check`: formatting, lint, Knip, types, 493 tests in 67 files, and build all passed.
- Direct host execution of the new flows was deliberately tested: both fail with `CONTAINER_AUDIO_REQUIRED` before Electron launch, as designed.
- Reopened waveform screenshot inspected; rendered starts/durations match after restart, and captured playback has sustained audio while paused capture is silent.
- Original short WAV SHA-256 remains `4f77b1c4f7c427c0268065c9132af5c99ad59def010c2fab10da7180ecaa45d4`.

Bring-up observations and review:

- The old image correctly failed the new audio prerequisite; after startup support, silence captured correctly.
- The isolated tone probe initially stopped recording when the FFmpeg writer finished rather than when buffered playback drained; using `paplay` for this infrastructure probe verifies actual completion.
- UI coordinate rounding and whole-second floor formatting require aiming one pixel past the selected ruler tick; clip geometry remains checked with 0.1–0.15 second tolerances.
- The real split operation requires an explicitly selected clip; the test now clicks it and the existing keyboard documentation was corrected.
- Read-only review found no blockers; a cleanup-error regression was reproduced and fixed so the real shared-context factory is restored even if client close rejects.
- No product code under `src/`, application-state interfaces, fixture audio, host audio setup or AI-client configuration was changed.
- PulseAudio's unavailable desktop D-Bus warnings are documented; private-device readiness and captured audio are independently verified.
- This slice certifies visible editing/transport behavior and actual audibility/silence, not sample-exact source-position matching or host audio hardware.
