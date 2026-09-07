# Container Harness Implementation Plan

**Goal:** Run the existing Electron/shared-context MCP harness inside Linux containers without displaying windows on the Mac host.

**Architecture:** The host Docker CLI forwards MCP stdio to the unchanged server; Xvfb and Electron run inside one container.
The source checkout and Git metadata are read-only mounts; source is copied into a private writable container snapshot because electron-vite writes temporary root-level files.
Dependencies and build output are disposable volumes, and artifacts are retained in `.harness-runs/container/`.

**Constraints:** Preserve pinned Node/Electron/Playwright/MCP versions, do not modify product window behavior, expose no debugging ports, and do not register an AI client without separate approval.
The user approved implementation in this session; execute locally in the existing feature worktree.

## Tasks

- [x] Add a host-side container MCP acceptance test; verify failure before the container launcher exists.
- [x] Add `harness/container/Dockerfile`, a minimal build context allowlist, container entrypoint, and host launcher.
- [x] Build the image on OrbStack and verify read-only checkout, Linux dependencies, Git provenance, and artifact mounts.
- [x] Run the existing complete harness suite inside Xvfb; investigate actual failures without silent architecture fallback.
- [x] Pass host-to-container MCP catalog/start/snapshot/click/screenshot/restart/disconnect checks, including retained artifacts and container removal.
- [x] Run repository formatting/checks, inspect a returned screenshot, review implementation, and document commands and limitations.

## Verification commands

```sh
node --test harness/tests/container.smoke.mjs
docker build -f harness/container/Dockerfile -t podcut-harness:local .
sh harness/container/run.sh npm run test:harness:all
npm run format
npm run check
git diff --check
```

The smoke test is opt-in and never launches host Electron.
The container launcher defaults to the current Docker context; this machine uses `orbstack`.

## Acceptance record

Verified on OrbStack Linux ARM64 with the final image `podcut-harness:local` (image index `sha256:4f66dc1c56b63f25cdedcf684f52748a59f1ed1efafed9df63d9f455c1734f64`).

- Host and container `npm run check`: formatting, lint, Knip, types, 467 unit tests and production build passed on both platforms.
- Container `test:harness:all`: 22/22 passed, including explicit fault injection.
- Host MCP acceptance: 2/2 passed, separately verifying EOF and `docker stop` cleanup without forced Electron close.
- Retained acceptance run IDs: `b188df57-0d26-4745-932d-6b7aa61fbb95` and `f3ff38da-da49-48a3-85e8-84aee30404ee`; the latter's returned PNG was visually inspected.
- Shell syntax, explicit new `.mjs` formatting checks and independent static review passed.

Bring-up exposed three infrastructure requirements: a writable source snapshot for electron-vite temporary configuration, supervisor-mediated EOF to avoid competing SIGTERM handlers, and Debian FFmpeg for Linux ARM64 FFprobe availability.
An existing backend unit test now uses its own temporary artifact directory so accumulated developer runs cannot cause status-scan timeouts.
No product code, MCP tool contract, window behavior, or AI-client configuration was changed.
Real audio playback, transcription and complete product E2E flows were not verified in this bring-up.
