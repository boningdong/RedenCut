# Saved transcript projects

## Default: normal editing

`transcript-editing-high-precision.redencut` is the default fixture for normal functional tests.
It is the user-supplied project saved on 2026-09-15, with two 81.48375-second audio sources (conversation mix and track A), two tracks, and real whisper.cpp small analysis.
The two artifacts contain 355/116 text units and 354/85 acoustic edit units respectively.
Project JSON, referenced media and referenced speech artifacts were copied byte-for-byte; disposable `cache/` and `.staging/` contents were omitted.
The original user project remains untouched.
“High precision” identifies the user-selected normal-test version, not an assertion that every word or timestamp is correct.

## Edge cases: older recognition

`transcript-editing.redencut` remains an immutable, self-contained project fixture for editing existing transcripts without speech models or network access.
It contains one 30-second clip, 139 text units, 138 acoustic edit units, and three anonymous speakers.

## Provenance

Audio is the first 30 seconds of `../audio/conversation/mandarin-conversation-mix.wav`, decoded to 48 kHz stereo float PCM and packaged losslessly as float WAV.
The saved analysis is a real whisper.cpp base + Chinese alignment + diarization result from the 2026-09-15 native recovery validation (`native-recovery-mix-30s`).
Before packaging, decoded PCM SHA-256 was verified against the analysis source fingerprint: `b604eee94d986b5d36007316f4b65a83408c9546c0f8682c52180049006adb32`.
Only source fingerprints were rebound from raw PCM to the WAV container; text, identities, timestamps, confidence, recovery evidence and speaker attribution are unchanged.
The fixture deliberately freezes the older base-model output even though the application's current default is small.
It is an editing regression input, not a transcription accuracy gold standard or proof of current model behavior.
There are no private Demo2 project contents, external media paths, model weights, or generated playback caches.

## Open in an isolated harness run

1. Start a run and obtain its run directory.
2. Copy the complete `transcript-editing-high-precision.redencut` directory into that run's `projects/` directory using a fresh destination; never open/edit the repository fixture directly.
3. Call `redencut_prepare_dialog` with `purpose: "open-project"` and `selection: {type: "project", name: "transcript-editing-high-precision.redencut"}`.
4. Click the real Open Project button, then select/edit the visible text normally.
5. Save edits in the run copy; reopening uses the same prepared project selection.

For host-driven Docker MCP, the host run directory is `.harness-runs/container/<runId>/`; inside Docker it is `/workspace/.harness-runs/<runId>/`.
No new MCP method or private application state injection is needed.
Use `transcript-editing.redencut` instead for older recognition and low-confidence/recovery cases.
The fixed E2E performs the copy automatically and runs both projects:

```sh
sh harness/container/run.sh npm run test:e2e -- transcript-fixture
```

`harness/tests/transcriptFixture.test.ts` validates project/artifact schemas, source and artifact hashes, references and audio bounds.
The UI test opens the actual project without Generate, selects text by mouse, creates an overlay without splitting clips, undoes/redoes, resizes by pointer and keyboard, removes/restores the overlay, saves, fully restarts and verifies the resized edit remains.
The default fixture supplies multi-source/overlap material, but the current E2E only validates the stated text-editing workflow.
Neither fixture nor this test proves all low-confidence/shared-AEU cases, live generation, or the full overlay overlap/move/trim matrix; those require targeted cases.
Keep source inputs unchanged; retain screenshots and edited project copies only in run evidence directories.
