# Container harness

Runs the existing RedenCut MCP server, Runtime, Playwright and Electron inside a Linux container with an Xvfb virtual display and private PulseAudio virtual output.
The host AI communicates through Docker stdin/stdout; there is no second CDP connection, published port, host display connection, or AI-client registration performed by these scripts.

## Script organization

`docker-harness.sh` is the public command entrypoint; the Dockerfiles and this README stay beside it.
Host command modules live in `build/`, `run/`, `test/`, and `mcp/`, with shared configuration in `config/`.
Image construction helpers live in `build/audio/` and `build/speech/`: they compile tools and write runtime manifests, without downloading model weights.
Container startup and shutdown helpers live in `lifecycle/`: `Entrypoint.sh` prepares the source snapshot and virtual display, `StartAudio.sh` starts virtual audio, and `SuperviseCommand.mjs` manages the requested command's lifetime.
These internal helpers are called by Dockerfiles or container startup; use the public entrypoint for user commands.

## Build

From the repository/worktree root, with Docker Engine running:

```sh
sh harness/container/docker-harness.sh build base
sh harness/container/docker-harness.sh build speech
```

`build speech` first rebuilds the base image, then builds the speech layer from that exact base tag. Neither build downloads model weights.
The commands use the normal Docker CLI and its current context; set `DOCKER_CONTEXT` explicitly if necessary.
The image uses the repository's Node version and lockfile, installing Linux-native dependencies rather than reusing Mac `node_modules`.
The image includes Noto CJK fonts so Simplified Chinese UI acceptance can inspect rendered glyphs.
The audio harness builds pinned FFmpeg 7.1.5 and LAME 3.100 sources into `/opt/redencut-runtime`, with GPL/nonfree features and automatic system codec discovery disabled.
The generated manifest inventories executables, libraries, source archives and license materials; `REDENCUT_RUNTIME_ROOT` selects it explicitly.
This minimal Linux runtime supports audio UI regression; it does not certify the full macOS Python/speech release runtime.
Debian packages are installed from the configured repositories at build time, so rebuilding without cache is not a bit-for-bit reproducibility guarantee.
Only dependency manifests and container build/startup/supervisor files are copied into the audio image; product source code and Git metadata are not uploaded to a registry or baked into the image.
Rebuild after dependency manifests or container image configuration change; ordinary source changes do not need an image rebuild.
The entrypoint rejects Node dependency manifest drift. Speech runs also reject stale Python dependency lockfiles while using the current checkout's worker source and model manifest.

## Run tests

```sh
sh harness/container/docker-harness.sh test harness
node --test harness/tests/container.smoke.mjs
sh harness/container/docker-harness.sh test e2e-base
sh harness/container/docker-harness.sh test e2e-speech --models-path /absolute/path/to/app/models
sh harness/container/docker-harness.sh test e2e-all --models-path /absolute/path/to/app/models
```

`test harness` runs the existing full normal/fault suite inside the base image's virtual display.
Fault tests deliberately crash or terminate isolated processes; no host Electron is launched.
The `node --test` command runs an MCP client on the host against the real container server, including screenshot delivery, rebuild/restart, and cleanup.
It requires the host project's npm dependencies to be installed.
`e2e-base` runs the [product E2Es](../../e2e/README.md) that need only the base image, including missing speech setup feedback. `e2e-speech` runs real speech and speech fault cases. `e2e-all` runs both sets in the speech image. The speech suites require an existing application model fixture and never download it.

For a one-off command, use `sh harness/container/docker-harness.sh run base -- COMMAND [ARG...]` or `run speech [--models-path DIRECTORY] -- COMMAND [ARG...]`. `run` requires a built image and does not build one; container startup compiles the current application source snapshot.

## Shared host models

Prepare model files on the host before running speech tests:

```sh
npm run setup:runtime
npm run setup:models
npm run check:models
sh harness/container/docker-harness.sh test e2e-speech
```

`setup:runtime` prepares native tools and Python dependencies only.
`setup:models` prepares Small Whisper, English/Chinese alignment and diarization in the common `<capability>/<id>/<revision>/` layout.
`check:models` checks the installation markers and file hashes offline; it does not download or require inference runtime loading.
Use `--set text` for Whisper and alignment, `--model ID` for one manifest model, or `--import-from OLD_ROOT` to migrate matching older files through validation.
Hugging Face authorization is needed only to acquire gated models; inference and packaged users do not authenticate.
See [speech models and dependencies](../../docs/speech-models-and-dependencies.md) for sources and access requirements.

`run`, `mcp`, and `test` resolve host models in this order:

| Priority | Model path source |
| --- | --- |
| 1 | Explicit `--models-path DIRECTORY` |
| 2 | `REDENCUT_MODELS_PATH` |
| 3 | Platform RedenCut application models directory; macOS: `~/Library/Application Support/RedenCut/models` |

An existing directory is mounted read-only at `/models`, with `REDENCUT_MODELS_PATH=/models` inside the container.
There is no Docker model volume or model acquisition action.
An absent default directory can start `run`/`mcp` so the app displays missing-resource guidance; an explicitly supplied missing directory fails with setup instructions.
Speech suites check the default model set before Docker starts and fail if any required installation or digest is invalid.

## Virtual audio (container only)

Virtual output and recording currently support Docker containers only; no native host audio setup is performed.
Startup creates a private 48 kHz PulseAudio null sink (`redencut_test`) and local Unix socket, then waits for the server before starting the requested command.
Electron routes audio to this device; E2Es record `redencut_test.monitor` as WAV, which never plays through host speakers.
No sound device, host audio socket, microphone or audio network port is shared.
Missing audio prerequisites fail explicitly before audio-dependent E2Es launch Electron.
PulseAudio may log unavailable D-Bus/desktop services in this minimal image; device readiness and actual sound capture are verified separately and these services are not used for the null sink.
Recorder cleanup is bounded and retained output lives in each test run's evidence directory; container exit removes its private audio server.

## MCP entry

Use `sh` as the MCP command with the absolute path to `harness/container/docker-harness.sh` followed by `mcp` (and optionally `speech --models-path DIRECTORY`).
Do not allocate a TTY or wrap the MCP entry in a noisy npm command.
The launcher resolves the checkout from its own path, so the client's current directory does not choose the source checkout.
The default server command remains `node --import tsx harness/server.ts`; the tool catalog is unchanged.
Diagnostics go to stderr, reserving stdout for MCP messages. Build images explicitly before configuring the client.
AI-client configuration is a separate explicit step; successfully testing this entry does not install or register it in an AI client.

## Files and lifetime

| Host/image contents | Container path | Access/lifetime |
| --- | --- | --- |
| Current checkout, including uncommitted files | `/source` | Read-only bind mount; do not use an untrusted checkout |
| Source snapshot copied at startup | `/workspace` | Writable private container layer; excludes dependencies, outputs, `.env*` and Git storage |
| Checkout's Git common directory | Same absolute path as host | Read-only, for linked-worktree provenance |
| Image's Linux dependencies | `/workspace/node_modules` | Private anonymous volume per container |
| Build output | `/workspace/out` | Private anonymous volume per container |
| Resolved host application model directory, when present | `/models` | Read-only shared bind mount; never downloaded or modified by tests |
| Host `.harness-runs/container/` | `/workspace/.harness-runs` | Writable retained evidence |

The launcher snapshots and builds current source at startup because electron-vite writes temporary config files beside its configuration.
Host source edits require closing and recreating the container; `redencut_restart` with `rebuild: true` rebuilds the same container snapshot, not newer host files.
Do not edit source or Git state during the startup copy; it is a file copy, not an atomic filesystem snapshot.
The existing provenance observes the copied source against the read-only live Git metadata, not a content-addressed attestation of compiled output.
Container paths reported in artifacts map to the host evidence directory above; PNG responses also travel directly through MCP.
Run IDs identify evidence; container PIDs must never be used to signal processes on the host.

`--rm` removes the container and anonymous dependency/output volumes after exit; retained host evidence is not deleted automatically.
Images and build cache remain reusable; no broad Docker prune is performed.
`REDENCUT_HARNESS_IMAGE` and `REDENCUT_SPEECH_IMAGE` override the respective image tags. `REDENCUT_CONTAINER_NAME` optionally gives a specific container name.
Containers have the label `dev.redencut.harness=container` for scoped inspection.

## Scope and security

This is a trusted local development harness, not a sandbox for untrusted code or websites.
The source mount includes local checkout files; do not place secrets in an untrusted checkout.
The container runs as the non-root `node` user, without privileged mode, Docker socket mounting, host IPC, or published ports.
It has 1 GiB of private shared memory; the existing Playwright Electron launch defaults are unchanged, including its default Chromium sandbox disablement for Electron automation.
Xvfb listens only inside the container; a supervisor receives termination through Tini and delivers EOF to the MCP server.
This avoids competing Playwright SIGTERM handlers and keeps Runtime in charge of coordinated shutdown.
Explicit container stop has a 15-second supervisor deadline; expiry is a reported nonzero exit, not a clean shutdown.
Linux containers still share host compute resources, and this does not certify macOS window behavior, GPU performance or audio hardware.
Native file selection is replaced by purpose-matched one-shot replies for import/open/save; the real UI, import, cache and project persistence paths remain active.
Container audio-output and basic editing acceptance are covered by the named product E2Es; real transcription/model setup and native OS dialog interaction remain separate work.

## Prepared export destinations

For diagnostic reports, prepare `redencut_prepare_dialog` with `purpose: "diagnostic-report"` and `selection: {type: "report", filename: "diagnostic.json"}` before clicking Save Report. The JSON is retained under `<runDirectory>/reports/`. `{type: "cancel"}` closes the flow without a file. Names must be a single `.json` basename and existing files cannot be overwritten.

Use `redencut_prepare_dialog` with `purpose: "export-audio"` and `selection: {type: "export", filename: "mix.wav", format: "wav"}` before clicking the modal’s Export button.
Supported formats are `wav`, `mp3`, `flac`, and `aac`; the filename must be a single basename with its matching extension.
`{type: "cancel"}` cancels without creating an output.
The destination is `<runDirectory>/exports/<filename>`, retained on the host under `.harness-runs/container/<runId>/exports/`.
Preparation and consumption reject existing outputs, symlink parent changes and format mismatches; no arbitrary path or other run destination is accepted.
To inspect an actual export, wait for the UI’s Done confirmation, then read only that run-owned output using FFprobe/FFmpeg.
This file inspection verifies produced media and is separate from live audio recording, which MCP does not expose.

## Real speech E2E models

Speech E2Es require the default set: recommended Small Whisper, all English/Chinese alignment models, and diarization for speaker scenarios.
Use `test e2e-speech` or `test e2e-all` with the default shared directory, or pass `--models-path /absolute/path/to/app/models`.
The common model CLI verifies manifest identities, `installation.json` and file hashes before launching Docker; application readiness is still validated normally during the test.
Models remain at `/models` across isolated test user-data directories, without per-run symlinks.
No token, account profile, download, or modification of the original model directory is involved.
A missing or invalid model set is an explicit test prerequisite failure, not a skipped or simulated speech success.
Use the audio-only image to exercise missing-Python setup feedback and the speech image for complete real-model E2Es.
