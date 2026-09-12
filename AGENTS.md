# RedenCut Repository Instructions

## Project Scope

RedenCut is a minimalist podcast and audio editor built with Electron, React, and TypeScript.
It targets macOS first and Windows later, with future extensibility tracked in the product roadmap.

## Documentation Policy

This file is the entry point for repository instructions.
The durable project rules and standards that extend this file live at the root of `docs/`; plans and historical design records live under `docs/superpowers/`.
Do not place progress logs, audits, verification reports, historical proposals, or superseded designs alongside the active standards.
For every change, review this file and its linked `docs/` standards for affected guidance, and update or remove anything that has become inaccurate or obsolete as part of the same change.

## Repository References

Use the repository's authoritative files instead of duplicating their contents here:

| Topic | Authoritative source |
| --- | --- |
| Commands and verification | [`package.json`](package.json) |
| Coding and review standards | [`docs/coding-standards.md`](docs/coding-standards.md) |
| File responsibility, naming and directory organization | [`docs/file-organization-standards.md`](docs/file-organization-standards.md) |
| Architecture standards | [`docs/architecture-standards.md`](docs/architecture-standards.md) |
| Keyboard interaction contract | [`docs/key-mappings.md`](docs/key-mappings.md) |
| Agent-driven UI acceptance | [agent-testing skill](.agents/skills/agent-testing/SKILL.md) and [scenario index](e2e/scenarios/README.md) |
| Product direction | [`ROADMAP.md`](ROADMAP.md) |
| Shared project model and schemas | [`src/shared/project.types.ts`](src/shared/project.types.ts) |
| IPC contract | [`src/shared/ipc.types.ts`](src/shared/ipc.types.ts) |
| Playback abstraction | [`src/shared/player.types.ts`](src/shared/player.types.ts) |
| Transcription abstraction | [`src/shared/transcriber.types.ts`](src/shared/transcriber.types.ts) |
| App name and project extension | [`src/shared/constants.ts`](src/shared/constants.ts) |

When an authoritative repository file defines a policy or contract, link to it instead of repeating it in an instruction file.

## Working Agreement

- Propose changes and explain why before editing; wait for confirmation.
- Keep explanations concise and name unfamiliar concepts so they can be researched independently.
- Follow the verification workflow in the coding standards and report any manual behavior that was not verified.
- Before handing off a user-visible feature or behavior fix, use `agent-testing` to run the baseline scenario and checks for the approved changed behavior through Docker MCP; link the evidence-backed report and disclose failed or blocked checks.
- Documentation-only and mechanical changes may exclude product UI acceptance with a stated reason; changes to the agent-testing instructions themselves require a workflow trial.
- Treat ESLint and Knip output as investigation candidates; trace dynamic IPC, worklet, CSS, build-tool, and runtime-package references before deleting code.
- Keep mechanical formatting separate from semantic changes.
