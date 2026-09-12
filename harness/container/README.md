# Container harness

Runs the existing RedenCut MCP server, Runtime, Playwright and Electron inside a Linux container with an Xvfb virtual display and private PulseAudio virtual output.
The host AI communicates through Docker stdin/stdout; there is no second CDP connection, published port, host display connection, or AI-client registration performed by these scripts.

## Build

From the repository/worktree root, with Docker Engine running:

```sh
docker build -f harness/container/Dockerfile -t redencut-harness:local .
```

The launcher uses the normal Docker CLI and its current context; set `DOCKER_CONTEXT` explicitly if necessary.
The image uses the repository's Node version and lockfile, installing Linux-native dependencies rather than reusing Mac `node_modules`.
The image includes Noto CJK fonts so Simplified Chinese UI acceptance can inspect rendered glyphs.
Debian FFmpeg supplies `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`, avoiding reliance on static npm binary availability for Linux ARM64.
Debian packages are installed from the configured repositories at build time, so rebuilding without cache is not a bit-for-bit reproducibility guarantee.
Only the dependency manifests and container startup/supervisor scripts enter the image build context; product source code and Git metadata are not uploaded to a registry or baked into the image.
Rebuild after dependency manifests or container image configuration change; ordinary source changes do not need an image rebuild.
The entrypoint rejects dependency manifest drift instead of silently running an old dependency set.

## Run tests

```sh
sh harness/container/run.sh npm run test:harness:all
node --test harness/tests/container.smoke.mjs
sh harness/container/run.sh npm run test:e2e
```

The first command runs the existing full normal/fault suite inside the virtual display.
Fault tests deliberately crash or terminate isolated processes; no host Electron is launched.
The second runs an MCP client on the host against the real container server, including screenshot delivery, rebuild/restart, and cleanup.
It requires the host project's npm dependencies to be installed.
The third command runs the [product E2Es](../../e2e/README.md): import/save/reopen, split/drag/save/reopen, and play/pause/seek/resume with the supplied short audio fixture.

## Virtual audio (container only)

Virtual output and recording currently support Docker containers only; no native host audio setup is performed.
Startup creates a private 48 kHz PulseAudio null sink (`redencut_test`) and local Unix socket, then waits for the server before starting the requested command.
Electron routes audio to this device; E2Es record `redencut_test.monitor` as WAV, which never plays through host speakers.
No sound device, host audio socket, microphone or audio network port is shared.
Missing audio prerequisites fail explicitly before audio-dependent E2Es launch Electron.
PulseAudio may log unavailable D-Bus/desktop services in this minimal image; device readiness and actual sound capture are verified separately and these services are not used for the null sink.
Recorder cleanup is bounded and retained output lives in each test run's evidence directory; container exit removes its private audio server.

## MCP entry

Use `sh` as the MCP command with the absolute path to `harness/container/run.sh` as its sole argument.
Do not allocate a TTY or wrap the MCP entry in a noisy npm command.
The launcher resolves the checkout from its own path, so the client's current directory does not choose the source checkout.
The default server command remains `node --import tsx harness/server.ts`; the tool catalog is unchanged.
Initial builds and diagnostics go to stderr, reserving stdout for MCP messages.
AI-client configuration is a separate explicit step; successfully testing this entry does not install or register it in an AI client.

## Files and lifetime

| Host/image contents | Container path | Access/lifetime |
| --- | --- | --- |
| Current checkout, including uncommitted files | `/source` | Read-only bind mount; do not use an untrusted checkout |
| Source snapshot copied at startup | `/workspace` | Writable private container layer; excludes dependencies, outputs, `.env*` and Git storage |
| Checkout's Git common directory | Same absolute path as host | Read-only, for linked-worktree provenance |
| Image's Linux dependencies | `/workspace/node_modules` | Private anonymous volume per container |
| Build output | `/workspace/out` | Private anonymous volume per container |
| Host `.harness-runs/container/` | `/workspace/.harness-runs` | Writable retained evidence |

The launcher snapshots and builds current source at startup because electron-vite writes temporary config files beside its configuration.
Host source edits require closing and recreating the container; `redencut_restart` with `rebuild: true` rebuilds the same container snapshot, not newer host files.
Do not edit source or Git state during the startup copy; it is a file copy, not an atomic filesystem snapshot.
The existing provenance observes the copied source against the read-only live Git metadata, not a content-addressed attestation of compiled output.
Container paths reported in artifacts map to the host evidence directory above; PNG responses also travel directly through MCP.
Run IDs identify evidence; container PIDs must never be used to signal processes on the host.

`--rm` removes the container and anonymous dependency/output volumes after exit; retained host evidence is not deleted automatically.
Images and build cache remain reusable; no broad Docker prune is performed.
`REDENCUT_HARNESS_IMAGE` overrides the image tag and `REDENCUT_CONTAINER_NAME` optionally gives a specific container name.
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

Use `redencut_prepare_dialog` with `purpose: "export-audio"` and `selection: {type: "export", filename: "mix.wav", format: "wav"}` before clicking the modal’s Export button.
Supported formats are `wav`, `mp3`, `flac`, and `aac`; the filename must be a single basename with its matching extension.
`{type: "cancel"}` cancels without creating an output.
The destination is `<runDirectory>/exports/<filename>`, retained on the host under `.harness-runs/container/<runId>/exports/`.
Preparation and consumption reject existing outputs, symlink parent changes and format mismatches; no arbitrary path or other run destination is accepted.
To inspect an actual export, wait for the UI’s Done confirmation, then read only that run-owned output using FFprobe/FFmpeg.
This file inspection verifies produced media and is separate from live audio recording, which MCP does not expose.
