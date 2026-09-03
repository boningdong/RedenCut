# Podcut AI UI Debugging Harness

Date: 2026-09-02
Status: Architecture agreed in conversation; written design pending user review; runtime compatibility not yet verified.

## 1. Goal and scope

Build a local macOS-first harness that lets an AI start an isolated, visible Podcut instance, operate its real UI, inspect evidence, restart it after code changes, and repeat the same workflow.
Expose application control and UI automation through one MCP entry point, without a separate user-facing CLI.
The immediate deliverable is infrastructure bring-up, not a broad collection of UI tests.

The eventual acceptance workflows are:

1. Open/import a project, edit it, save it, and reopen it.
2. Split audio, drag clips, and play the resulting timeline.
3. Generate a real transcript, split the audio, move one resulting clip, and verify that clicking transcript text seeks to the correct output position.

Recorded transcripts may support deterministic supplementary scenarios, but do not replace the real generation acceptance workflow.
Playback UI verification does not establish subjective audio quality; sample-level checks and listening remain separate concerns.

## 2. Confirmed architecture decisions

- A Node harness runtime owns Electron startup, shutdown, restart, isolation, and artifacts.
- A custom Podcut Harness MCP server is the only AI-facing entry point.
- Reuse official Playwright MCP UI tools through its programmatic interface, passing the BrowserContext owned by the Electron launcher.
- Do not introduce a second CDP attachment as the default UI connection.
- Runtime alone owns application lifecycle; one trace manager owns trace recording.
- Rebuild UI adapter/session state after an application restart; never retain old page references as if they were current.
- Use explicit build/restart first; HMR is outside initial bring-up.
- Preserve the existing main/preload/renderer and path-free IPC boundaries.
- If shared-context compatibility blocks progress, report evidence and ask the user before changing architecture.
- Dual-CDP is not an authorized automatic fallback.

## 3. System boundaries

| Module                 | Responsibility                                                                                    | Ownership boundary                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| MCP facade             | Publish tool schemas, validate requests, route lifecycle and UI tools, return errors and evidence | Owns the external MCP session, not product behavior                               |
| Harness runtime        | Preflight, prepare each run, launch and close Electron, coordinate restart and readiness          | Sole owner of ElectronApplication and run state                                   |
| Playwright MCP adapter | Reuse upstream snapshots, clicks, keys, dragging, screenshots, and console inspection             | Borrows the runtime's BrowserContext; does not own application shutdown           |
| Product test adapters  | Deterministic native-dialog responses, isolated startup settings, narrow read-only diagnostics    | Test-only composition at main boundaries; no arbitrary filesystem API in renderer |
| Artifact/trace manager | Persist manifests, logs, screenshots, tool events, and trace files                                | One trace owner per application generation                                        |

The runtime and facade should remain separate modules, so fixed E2E tests can later use the same runtime without going through an AI client.
Separate modules do not require separate daemon processes.
The first implementation should use one Node host process for the facade, runtime, and in-process UI adapter.
Electron remains a child process with its normal main, preload, renderer, and audio execution boundaries.
Use local stdio MCP transport for the external client in the first version; stdout carries only protocol traffic, while diagnostics go to stderr and run artifacts.
An in-memory MCP client/server transport pair can connect the facade to the upstream server; compatibility of that public SDK composition is part of Gate A.

### MCP composition

The external server exposes a curated combination of `podcut_*` application tools and upstream UI tools.
Use the official `createConnection(config, contextGetter)` entry point rather than importing Playwright's private backend classes or copying their implementation.
The adapter must use supported MCP transport/client APIs to obtain and forward upstream schemas and tool results where needed.
Prove tool aggregation, image forwarding, adapter disposal, and context ownership in the first compatibility probe.

The MCP server can initialize and publish its tool catalog before Electron starts.
Before application readiness, UI calls return an explicit application-not-ready error instead of silently launching an unrelated browser.
Keep tool names/schema availability stable across application restarts for the pinned upstream version.
Put preconditions, side effects, lifecycle requirements, and recovery instructions in tool descriptions and structured results.
There is no separate end-user command vocabulary to document.

### Proposed application tool surface

These names specify responsibilities for review, not implemented APIs.

| Tool                      | Contract                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `podcut_start`            | Start one isolated run from an allowed scenario/configuration; return run identity and readiness             |
| `podcut_status`           | Report run state, current generation, startup stage, available diagnostics, and errors                       |
| `podcut_restart`          | Explicitly rebuild/restart as requested, retaining the isolated project unless reset is explicitly requested |
| `podcut_stop`             | Stop the owned application with bounded cleanup and preserve artifacts                                       |
| `podcut_list_scenarios`   | Describe available fixtures and their dependency requirements                                                |
| `podcut_prepare_dialog`   | Register one typed, purpose-specific native-dialog response before the UI action                             |
| `podcut_read_diagnostics` | Read narrow product/run state without mutating editing state                                                 |
| `podcut_list_artifacts`   | List evidence for the selected run/generation                                                                |

Do not expose a general main-process JavaScript evaluator as an application tool.
Exclude or mediate upstream tools that close the application/context, start an independent trace, or escape the intended application target.
The shared context is a trusted automation capability, not a security sandbox; local permission controls and process/data isolation remain necessary.

## 4. Lifecycle and concurrency

### Normal ordering

Normal use is sequential: start the application, operate the UI, finish the current operation, then restart or stop.
There are not two independent agents intentionally controlling the application at the same time.
The concurrency guard exists for overlapping tool requests, unfinished asynchronous operations, cancellation, and crashes, not to support simultaneous lifecycle changes and UI actions.

### Admission policy

- Allow one active run per MCP server instance in the first version.
- Serialize UI-mutating tool calls.
- Lifecycle transitions take an exclusive admission gate and prevent new UI calls from starting.
- Wait for an already admitted UI call to settle within a bounded timeout before normal restart/stop.
- Read-only runtime status/log access remains available during startup and shutdown; page-dependent reads do not bypass the gate.
- Product background jobs may outlive the click that started them; shutdown must use product cancellation/settlement behavior, not assume that a completed click means the app is idle.
- On timeout, record the state and failure; stop escalation may terminate only the process tree owned by this run after graceful shutdown fails.
- Never automatically replay a mutating UI call after disconnection: its outcome may be unknown.

### Identity and stale references

Use a run identity plus an application generation that changes on every restart.
Tag tool events and artifacts with both values.
Restart invalidates the UI backend, its snapshots, page handles, and element references.
The facade rejects known stale-generation requests and requires a fresh snapshot before new state-dependent interactions.
The probe must establish whether upstream element references can be distinguished across generations; if not, add an adapter-owned generation envelope rather than assuming upstream reference IDs are globally unique.

### Restart transaction

1. Close UI admission and mark the generation as stopping.
2. Settle the active call and flush trace/log artifacts while the context is still available.
3. Dispose the upstream UI backend without allowing it to own Electron shutdown.
4. Close Electron through the runtime and confirm process exit.
5. Rebuild if requested; launch the next generation against the retained isolated project, or install a fresh fixture only if reset was explicitly requested.
6. Wait for the required readiness stages and create a new upstream UI adapter for the new context.
7. Reopen admission; return the new generation and instructions to take a fresh snapshot.

If rebuilding or launch fails, retain diagnostics and report the failed stage; do not claim readiness or silently reopen an older build.
The external MCP server remains available to report the failure.
Before closing a dirty project for an ordinary restart, require an explicit save/discard decision; preserving the project directory does not preserve unsaved renderer edits.
Make that precondition check before the destructive part of the restart transaction, not after disposing the old UI adapter.

### Host shutdown

As a first-version design default, ordinary MCP transport closure or host SIGTERM initiates bounded cleanup of its owned Electron instance.
Unexpected host death must be covered by orphan detection/recovery checks; graceful signal handlers alone do not prove cleanup after a hard kill.
Recovery must validate run ownership and process identity before acting, and must never stop the user's ordinary Podcut process based on its name alone.

## 5. Startup protocol and isolation

1. Preflight the pinned Node/Electron/Playwright/MCP setup and the requested build.
2. Check required media tools; real transcription scenarios additionally require a usable whisper executable and model.
3. Create a unique run directory for userData, temporary workspaces, project copies, export outputs, and evidence.
4. Configure isolated app identity/userData before the existing single-instance lock and before application readiness.
5. Launch the real built application through Playwright's Electron support and acquire its BrowserContext.
6. Install/configure product test adapters before exposing actions that depend on them.
7. Wait for Main initialization, renderer session readiness, and scene-specific waveform readiness.
8. Initialize the upstream MCP UI adapter with the shared context and publish the ready result.

Missing dependencies are explicit failures with actionable diagnostics.
Never silently replace real transcription with recorded output or real audio processing with a renderer mock.
Never automatically install system dependencies, download models, or modify AI-client settings as a hidden part of `start`.

The shared-context route still uses Playwright's underlying inspector/debugging transport.
It does not require a second user-configured CDP endpoint or opening debugging ports in ordinary production startup.
Any debug endpoints opened by the launcher must be restricted to the local isolated run and checked during bring-up.
Do not automatically open DevTools in harness mode.

### Readiness

Window creation is not equivalent to application readiness.
Report the last completed stage and the stage that timed out.
Renderer readiness means the relevant session is installed and its controls can operate; it does not mean all future jobs have completed.
Waveform readiness refers to the current visible render request, not merely the existence of a canvas element.
New viewport/source requests invalidate earlier waveform-ready observations.
Use bounded condition-based waits, not arbitrary sleeps or permanent network-idle assumptions.

## 6. Real behavior and controlled external boundaries

### Native dialogs

Introduce purpose-specific injectable dialog behavior at existing main-process call sites.
Production implementations call Electron dialogs; harness implementations consume validated one-shot replies.
Distinguish project opening, audio import, saving, exporting, and dirty-project confirmation.
An unexpected dialog fails explicitly rather than opening an OS window or choosing a permissive default.
Reset unconsumed replies when their run/generation ends.

The UI must still invoke the normal preload and IPC flows after a response is prepared.
Fixture setup is allowed before a scenario, but test operations must not directly modify stores to impersonate successful clicks, splits, or dragging.

### Fixture data

Use small synthetic audio for signal/editing cases and a redistributable or explicitly supplied speech fixture for real transcription.
Install only copies into the run directory; imported user references must not point tests at mutable personal originals.
The scenario manifest records source assets, intended state, required tools/model, window dimensions, and theme.
Reset restores the scenario; ordinary restart preserves the run's saved project.
Exact fixture packaging and generation code will be selected in the implementation plan after the compatibility gate passes.

### Transcript alignment diagnostics

Provide read-only evidence linking word/source identity, source-time interval, matching clip source/output ranges, expected output seek time, and observed player/playhead time.
Keep the click and seek behavior on the real UI/player path.
Use deterministic recorded words for precise supplementary mapping checks and real generation for the requested end-to-end workflow.
Do not demand identical model text/timestamps on every run as the only correctness criterion for real generation.

## 7. Evidence and tracing

Record a run manifest with build identity, dirty-worktree status, dependency versions, scenario, selected media/model tools, window/theme, and lifecycle outcome.
Collect main stdout/stderr from launch, renderer console/errors, tool calls/results, and failures with run/generation identity.
Store artifacts outside the transient browser context cleanup directory so failed or closed runs remain inspectable.
Do not collect unrelated personal projects, paths, recordings, or transcripts.

One harness trace manager starts, chunks, and stops context tracing.
Disable independent upstream automatic/manual trace starts where they would conflict.
Before closing the context, attempt to flush trace data with a bounded timeout.
If a crash prevents trace finalization, report the artifact as incomplete and retain independent logs.
Do not assume that recording a context trace automatically merges test-runner steps or records all Main/FFmpeg events; those are separate evidence streams.

## 8. Bring-up gates

Each gate produces reproducible evidence before the next expands scope.
The first implementation plan should focus on Gates A and B; C and D extend the same architecture afterward.

### Gate A: shared-context compatibility

- Pin a mutually compatible Electron launcher, Playwright, Playwright MCP, and MCP SDK version set.
- Launch a minimal visible Electron application and obtain its existing BrowserContext.
- Initialize official MCP tools with that context using public interfaces.
- Exercise actual MCP discovery/call traffic for snapshot, click, and screenshot; verify image results survive facade forwarding.
- Read Main information and collect logs while UI tools operate on the same application.
- Dispose the UI adapter and prove that runtime still owns a live Electron instance until it explicitly closes it.
- Record and inspect a trace containing the relevant UI actions and screenshot evidence.
- Fail explicitly if public shared-context composition is unavailable or ownership semantics cannot be made reliable.

Gate A is a compatibility test, not proof that the full Podcut workflows pass.
Do not bypass a failure by importing private upstream objects, creating a second CDP connection, or replacing official tools without user confirmation.

### Gate B: host and lifecycle

- Apply the lifecycle host to the real Podcut empty state; fixture import and dialog-dependent workflows are not required yet.
- Expose lifecycle and UI tools through the single MCP facade without a separate CLI.
- Exercise start, status, stop, explicit restart, and adapter recreation.
- Verify application-not-ready and stale-generation behavior.
- Verify lifecycle/UI mutual exclusion, active-call timeout, and no implicit replay of mutations.
- Verify isolation from the ordinary application, including the single-instance lock and project data.
- Verify graceful host disconnect, application crash, startup timeout, and recoverable evidence.
- Check for owned child-process leaks and report any hard-kill recovery limitations.

### Gate C: real Podcut boundaries

- Apply the same runtime to the real Podcut build.
- Prove native-dialog replies, actual audio import/cache generation, waveform readiness, project opening, save, and reopen.
- Confirm that product code follows normal preload/IPC boundaries.

### Gate D: requested editing workflows

- Split, drag, and play real audio; inspect UI state plus appropriate playback evidence.
- Run real transcript generation with explicit dependency/model preflight.
- After splitting and moving a clip, click transcript words and verify correct output seeking using the read-only alignment diagnostics.
- Preserve reproductions as focused automated scenarios.

CI, Windows support, HMR, a broad visual baseline matrix, generic fault injection, and unattended autonomous repair scheduling are outside these initial gates.

## 9. Repository integration boundaries

Harness implementation belongs under a dedicated repository-level `harness/` directory, with responsibilities split into MCP facade, runtime, UI adapter, artifacts, fixtures, and infrastructure tests.
Follow [file organization standards](../../file-organization-standards.md); keep artifact-management code under `harness/artifacts/` and store generated evidence separately.
Harness unit and integration tests belong in `harness/tests/` and verify the infrastructure itself, including lifecycle and MCP integration.
Product-level E2E tests belong in a separate repository-level `e2e/` directory alongside `harness/` and `src/`, not inside `harness/`.
They verify Podcut user workflows and reuse the harness runtime without moving product scenarios into the harness's own tests.

```text
Podcut/
├── src/                 # Product implementation and existing unit tests
├── harness/             # Reusable UI debugging infrastructure
│   ├── artifacts/       # Artifact-management code, not generated output
│   └── tests/           # Harness unit and integration tests
└── e2e/                 # Product workflow E2E tests that use the harness
```

This partial tree describes the intended layout, not directories already implemented.
Production entry points receive only the narrow composition changes required for testability.
Review existing repository standards before implementation; do not change global or project instruction files as an incidental setup action.
Any AI-client registration is an explicit setup step, not an unannounced user-config mutation.
Do not implement a plugin package merely to expose the MCP server unless separately chosen.

## 10. Research basis and remaining uncertainty

Confirmed from public interfaces/source:

- [Playwright ElectronApplication](https://playwright.dev/docs/api/class-electronapplication) exposes the application context and Main access.
- [Playwright MCP public declaration](https://github.com/microsoft/playwright-mcp/blob/main/index.d.ts) accepts `createConnection(config, contextGetter)`.
- [Current MCP implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/index.ts) distinguishes caller-supplied context ownership.
- [Reported library usage and tracing conflicts](https://github.com/microsoft/playwright-mcp/issues/1166) demonstrate real use of context injection and why trace ownership requires testing.
- [Playwright double-CDP test](https://github.com/microsoft/playwright/blob/main/tests/library/chromium/connect-over-cdp.spec.ts) is evidence for an alternative topology, not permission to switch to it.
- [External trace merge discussion](https://github.com/microsoft/playwright/issues/40915) distinguishes context traces from test-runner traces.

Research inspected moving upstream sources, not an installed, validated version combination.
BrowserContext sharing with Podcut's exact Electron version, facade composition, shutdown ownership, restart invalidation, and trace integrity remain runtime acceptance checks.
No compatibility probe or product UI verification has been performed for this design yet.

## 11. Review boundary

This document records the approved architectural direction and makes implementation defaults explicit for written review.
After user review, produce a bounded implementation plan for the first bring-up gates.
Do not treat written design approval as evidence of working runtime integration.
If the shared-context route is blocked, stop at that boundary, report the concrete result and alternatives, and obtain explicit approval before changing topology.
