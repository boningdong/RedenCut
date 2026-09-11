# Product E2E

## Fixed Tests and Agent Acceptance

The TypeScript E2Es below are deterministic product regressions driven through MCP.
[Agent scenarios](scenarios/README.md) complement them with fixed user goals, adaptive UI actions, visible feedback and change-focused exploration; they do not replace automated assertions.
Use the repository's [agent-testing skill](../.agents/skills/agent-testing/SKILL.md), for example: "Use $agent-testing to verify the editing workflow and the approved behavior changed in this task."
Agent reports and their supporting evidence stay in the runtime's artifact directory, not in the scenario source folder.

## Run Fixed E2Es

Run from the repository root using the [Docker harness](../harness/container/README.md):

```sh
docker build -f harness/container/Dockerfile -t podcut-harness:local .
sh harness/container/run.sh npm run test:e2e
```

`npm run test:e2e` directly launches Electron on the machine executing it; use the container wrapper to avoid host windows.
The import/save/reopen scenario imports `fixtures/audio/mandarin-short-female.wav`, saves a new `.podcut` project, fully restarts Electron and reopens the saved project.
It verifies track/clip/source identities, duration against independent FFprobe output, waveform drawing readiness and SHA-256 of copied media and original input.
The first imported track is named `Track 1`; the original filename is stored on the audio source.
This original test does not verify playback, editing or transcription.

## Editing and playback (Docker only)

The two additional flows use the same short WAV:

- Select a clip, seek to 5 seconds, split with `S`, drag the second clip about 2 seconds later, save, fully restart and reopen; verify the visible clip layout, waveforms and audible playback.
- Play, pause, seek while paused, then resume; verify visible button/time changes and captured sound, including sustained silence while paused.

Virtual audio output and capture are supported only in Docker containers in this first version, not native macOS, Windows or non-container Linux.
These tests fail before launching Electron when the private container audio prerequisite is absent; they never fall back to host speakers or skip audio assertions.
The container uses a private PulseAudio null sink and records its monitor source, without connecting host audio devices or sockets.
All application clicks, key presses and drags go through the existing MCP tools; the same Playwright Context supplies read-only visible text, bounding boxes and canvas pixels, not store/player state or hidden source metadata.
No new MCP methods or product state interfaces were added.

```sh
# New editing and playback flows only (Docker required)
sh harness/container/run.sh npm run test:e2e -- editing-playback

# Original import/save/reopen only (Docker recommended)
sh harness/container/run.sh npm run test:e2e -- project-import-save-reopen

# Original flow on the host; this WILL show a native Electron window
npm run build
npm run test:e2e -- project-import-save-reopen
```

Each run retains screenshots, `ui-actions.jsonl`, WAV recordings, capture logs and successful observation reports under `.harness-runs/container/<runId>/`.
Recordings are bounded to 120 seconds of audio; startup and stop have explicit deadlines, and only the owned recorder process is signaled.
Audio checks use 100 ms RMS windows: at least five windows above 0.002 full-scale RMS for audible output; paused output must remain below 0.0001 after a one-second buffer allowance.
Rendered clip-position tolerances are 0.1–0.15 seconds, derived from visible ruler spacing; the displayed transport time has whole-second precision.
These checks do not certify sample-exact source-position matching, device latency, transcription or host audio hardware.

The test uses a real MCP client/facade and Runtime within the container; `node --test harness/tests/container.smoke.mjs` separately verifies the host-to-container stdio transport.
Only the native file selection result is substituted; UI clicks, IPC, FFmpeg, cache generation and project persistence are real.
Inputs are immutable; outputs are retained under `.harness-runs/container/<runId>/`, including `imported.png`, `reopened.png`, per-generation trace/logs and `projects/short-audio.podcut/`.
Failures retain `e2e-failure.txt` along with whatever evidence was collected before failure.

## Dialog preparation

Call `podcut_prepare_dialog` with the current `runId`, `generation` and a typed `request`, then click the corresponding UI control:

```json
{"purpose":"import-audio","selection":{"type":"file","filename":"mandarin-short-female.wav"}}
```

`save-project` and `open-project` use `{"type":"project","name":"short-audio.podcut"}`; all three purposes accept `{"type":"cancel"}`.
Audio selection accepts plain filenames only within `e2e/fixtures/audio/`; no registry or arbitrary paths are exposed.
Project selections stay inside this run's `projects/` directory; new saves cannot replace existing projects.
Replies are single-use, purpose-matched and generation-scoped; restart clears pending replies.
Unprepared or unsupported dialogs fail explicitly and are recorded in diagnostics/events; dirty-project confirmations remain unsupported. Export uses purpose `export-audio` with selection `{type: "export", filename: "mix.wav", format: "wav"}` (or cancellation). Formats are `wav`, `mp3`, `flac`, `aac`, and the extension must match. Destinations stay in this run’s `exports/` directory; existing files, path traversal, symlink escapes and mismatched format consumption are rejected.
