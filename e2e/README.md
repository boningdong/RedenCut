# Product E2E

Run from the repository root using the [Docker harness](../harness/container/README.md):

```sh
docker build -f harness/container/Dockerfile -t podcut-harness:local .
sh harness/container/run.sh npm run test:e2e
```

`npm run test:e2e` directly launches Electron on the machine executing it; use the container wrapper to avoid host windows.
The current scenario imports `fixtures/audio/mandarin-short-female.wav`, saves a new `.podcut` project, fully restarts Electron and reopens the saved project.
It verifies track/clip/source identities, duration against independent FFprobe output, waveform drawing readiness and SHA-256 of copied media and original input.
The first imported track is named `Track 1`; the original filename is stored on the audio source.
This test does not verify playback, editing or transcription.

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
Unprepared or unsupported dialogs fail explicitly and are recorded in diagnostics/events; dirty-project confirmations and export dialogs remain unsupported.
