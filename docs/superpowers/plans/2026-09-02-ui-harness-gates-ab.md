# UI Harness Gates A/B Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and `superpowers:test-driven-development` for these tightly coupled bring-up tasks; request independent code review at the gate boundaries.

**Goal:** Prove shared-context MCP compatibility, then expose an isolated real Podcut instance through one lifecycle-aware MCP server.

**Architecture:** The Node runtime alone owns Electron and tracing; the official Playwright MCP adapter borrows its BrowserContext through the public `createConnection` API.
The external facade forwards MCP schemas/results, with runtime admission and generation checks around UI operations.

**Tech Stack:** Node 24.14.0, existing Electron 40.8.0, `@playwright/mcp` 0.0.80, matching Playwright 1.63.0-alpha-2026-08-31, MCP SDK 1.30.0, TypeScript, Vitest.

**Spec:** [UI debugging harness design](../specs/2026-09-02-ai-ui-debugging-harness-design.md).

## Global Constraints

- A Node harness runtime owns Electron startup, shutdown, restart, isolation, and artifacts.
- Reuse official Playwright MCP UI tools through its programmatic interface, passing the BrowserContext owned by the Electron launcher.
- Dual-CDP is not an authorized automatic fallback.
- Runtime alone owns application lifecycle; one trace manager owns trace recording.
- Rebuild UI adapter/session state after an application restart; never retain old page references as if they were current.
- Use explicit build/restart first; HMR is outside initial bring-up.
- Preserve the existing main/preload/renderer and path-free IPC boundaries.
- Scope is Gates A/B only: no fixture import, native-dialog replies, transcription, editing E2E, client configuration changes, or system dependency/model installation.
- Keep artifact-management code in `harness/artifacts/`; generated evidence goes in ignored `.harness-runs/`.
- Infrastructure tests belong in `harness/tests/`; future product E2E belongs in root `e2e/`.
- Do not merge or push this implementation without user direction.

## File Responsibilities

| Path                                                | Responsibility                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `harness/mcp/createMcpFacade.ts`                    | Public MCP discovery/call forwarding with complete result content     |
| `harness/mcp/ToolBackend.ts`                        | Facade/backend contract                                               |
| `harness/ui/PlaywrightMcpAdapter.ts`                | Official MCP server/client pair borrowing a context                   |
| `harness/runtime/HarnessRuntime.ts`                 | Run state, lifecycle and admission coordination                       |
| `harness/runtime/OperationGate.ts`                  | Exclusive lifecycle admission and serialized UI calls                 |
| `harness/runtime/ElectronSession.ts`                | Owned Electron launch/readiness/close and fixed read-only diagnostics |
| `harness/runtime/deadline.ts`                       | Bounded operation waits without silent retries                        |
| `harness/artifacts/RunArtifacts.ts`                 | Durable run/generation manifests, logs and tool events                |
| `harness/artifacts/buildProvenance.ts`              | Fresh checkout/dependency observations for each generation            |
| `harness/artifacts/TraceRecorder.ts`                | Single tracing owner and incomplete-trace reporting                   |
| `harness/runtime/electronEnvironment.ts`            | Explicit child environment allowlist; exclude unrelated secrets       |
| `harness/runtime/processIdentity.ts`                | OS process identity lookup and comparison                             |
| `harness/runtime/orphanInspection.ts`               | Read-only matching of retained ownership manifests to surviving apps  |
| `harness/runtime/closePreconditions.ts`             | Dirty/busy close policy                                               |
| `harness/mcp/RuntimeToolBackend.ts`                 | Lifecycle schemas, curated UI tools and generation envelopes          |
| `harness/server.ts`                                 | Stdio entry, signal/disconnect cleanup; no user-facing CLI            |
| `src/main/harnessStartup.ts`                        | Opt-in isolated paths configured before the single-instance lock      |
| `harness/tests/fixtures/minimal-electron.cjs`       | Small visible Electron compatibility fixture                          |
| `harness/tests/compatibility.integration.ts`        | Gate A: actual MCP traffic, images, context lifetime, trace           |
| `harness/tests/lifecycle.integration.ts`            | Gate B: real Podcut lifecycle, isolation and clean exit evidence      |
| `harness/tests/server.integration.ts`               | External stdio discovery, calls and disconnect behavior               |
| `harness/tests/failureCleanup.fault.integration.ts` | Cleanup despite ownership/evidence write failures                     |
| `harness/tests/startupRaces.integration.ts`         | Public launch automation defaults                                     |
| `harness/tests/*.fault.integration.ts`              | Explicit lifecycle, transport, startup and abnormal-exit fault tests  |
| `harness/tests/earlyShutdown.integration.ts`        | Repeated clean shutdown during native startup                         |
| `harness/runtime/quitElectronOnEventLoop.ts`        | Public deferred quit request and bounded owned-process exit wait      |
| `harness/tests/*.test.ts`                           | Focused infrastructure unit tests                                     |
| `vitest.harness.config.ts`                          | Explicit headed integration test runner, serial execution             |
| `harness/tsconfig.json`                             | Type-check harness without including it in product bundles            |

## Task 1: Shared-Context Compatibility (Gate A)

**Files:** Create the facade, backend contract, adapter, minimal fixture, compatibility test, harness TypeScript/test configuration; update package scripts, lockfile, ESLint, Knip and ignore rules.

**Interfaces:**

```ts
interface ToolBackend {
  listTools(): Promise<Tool[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>
}
function createMcpFacade(backend: ToolBackend): Server
class PlaywrightMcpAdapter implements ToolBackend {
  static create(
    getContext: () => Promise<BrowserContext>,
    outputDir: string,
  ): Promise<PlaywrightMcpAdapter>
  listTools(): Promise<Tool[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>
  close(): Promise<void>
}
```

- [x] Install exact MCP/Playwright versions matching the official MCP dependency declaration; retain existing Electron initially and record audit findings without unrelated upgrades.
- [x] Write a compatibility test that launches a visible isolated fixture, connects an SDK client to the actual facade, lists upstream tools and performs snapshot/click/screenshot requests.
- [x] Use this observable fixture behavior: heading `Harness probe`, button `Increment`, and an output initially `0`; a real click must produce `1`.
- [x] Assert screenshot content has an image block with PNG bytes, not merely a path; assert the Main PID matches the launched child.
- [x] Start tracing before the UI actions; stop it to a retained ZIP; inspect the trace for the click and screenshot resources.
- [x] Close the adapter and assert a Main evaluation and renderer read still succeed, then explicitly close Electron and assert process exit.
- [x] Run the new test red before implementing the forwarding/adapter behavior:

```sh
npm run test:harness -- harness/tests/compatibility.integration.ts
```

- [x] Implement only public SDK transports and `@playwright/mcp.createConnection`; configure `browser.isolated: false`, `imageResponses: 'allow'`, no upstream session/trace recording, and bounded action timeouts.
- [x] Re-run Gate A and type/lint checks; inspect its screenshot and trace; request code review before promoting the composition into Gate B.
- [x] If context ownership fails, investigate compatible public versions; stop for user confirmation before any topology or private-API workaround.

## Task 2: Isolated Real Application and Runtime (Gate B)

**Files:** Create runtime and artifact modules, startup module and unit tests; modify `src/main/index.ts` and the renderer root only for explicit readiness/dirty/busy observation.

**Interfaces:**

```ts
type RunState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
interface GenerationIdentity {
  runId: string
  generation: number
}
interface RuntimeStatus {
  state: RunState
  runId?: string
  generation: number
  stage: string
  runDirectory?: string
  pid?: number
  error?: string
}
class HarnessRuntime {
  status(): RuntimeStatus
  start(): Promise<RuntimeStatus>
  restart(options: { rebuild?: boolean; discardUnsaved?: boolean }): Promise<RuntimeStatus>
  stop(options?: { discardUnsaved?: boolean }): Promise<RuntimeStatus>
  listUiTools(): Promise<Tool[]>
  callUiTool(
    name: string,
    args: Record<string, unknown>,
    identity: GenerationIdentity,
    signal?: AbortSignal,
  ): Promise<CallToolResult>
  shutdown(): Promise<void>
}
```

- [x] Write focused red tests for admission: lifecycle excludes new UI calls, already-admitted work settles first, queued UI never enters a new generation, timeout does not replay a mutation, and status stays readable.
- [x] Implement admission with promise settlement, explicit timeout errors, and generation validation at execution time as well as request time.
- [x] Write startup tests proving opt-in paths are absolute and isolated, ordinary startup is unchanged, and invalid harness configuration fails before Electron starts.
- [x] Configure `userData`, `sessionData` and `temp` under a unique run directory before `startApplicationLifecycle`; never disable the ordinary lock globally.
- [x] Add DOM attributes reporting installed renderer session, dirty state and busy jobs; do not expose stores or a new renderer filesystem/control API.
- [x] Build the real application and launch its built entry with no dev-server environment; verify Main initialization and renderer session readiness rather than just window creation.
- [x] Create generation-tagged evidence containing build commit, dirty status, dependency versions, paths, PID, tool calls and independent Main/renderer logs.
- [x] Implement one trace owner per generation; flush before closing and retain incomplete status if a crash interrupts finalization.
- [x] Implement restart as admission close → settle work → dirty/busy preflight → trace flush → adapter dispose → owned Electron close → optional build → next generation readiness → fresh adapter.
- [x] Dirty projects require save through UI or explicit discard; busy product work blocks ordinary restart/stop until settled, since C/D job controls are not implemented yet.
- [x] Write and run real integration checks for repeated restart, stale refs, isolation between independent runs, startup timeout and application crash.
- [x] Validate owned-process shutdown by process identity; never kill by app name, and report hard-kill recovery limits instead of claiming guaranteed cleanup.

## Task 3: Single MCP Entry and Failure Acceptance (Gate B)

**Files:** Create runtime tool backend and stdio server; extend unit/integration tests and package scripts.

**Interfaces:** External tools are `podcut_start`, `podcut_status`, `podcut_restart`, `podcut_stop`, `podcut_read_diagnostics`, `podcut_list_artifacts`, plus curated upstream UI tools.
UI tool schemas add required `runId` and `generation`; returned results carry the same identity.
Only `browser_snapshot` may establish the first current-generation snapshot; state-dependent UI calls fail until it succeeds.

- [x] Write red protocol tests that list tools before launch, reject UI calls before readiness, and forward image/text/structured results unchanged except for the documented identity metadata.
- [x] Discover the upstream tool catalog without launching an unrelated browser; allow only snapshot, click, drag, keyboard, typing, hovering, scrolling, screenshots and console/network observation as supported by the pinned version.
- [x] Exclude browser/context close, navigation, new tabs, arbitrary evaluation/code execution, browser installation, file upload, and independent tracing tools from the external catalog.
- [x] Reject unlisted tools and stale identities with structured recovery instructions; do not accept client overrides of internal output roots or upstream metadata.
- [x] Keep stdout protocol-only; send host diagnostics to stderr and run evidence.
- [x] On ordinary stdin close/SIGTERM, close admission and clean up owned resources with bounded waits; record unsaved-loss caveats for forced host shutdown.
- [x] Test a real SDK stdio client against `node --import tsx harness/server.ts`; verify discovery/start/snapshot/screenshot/restart and exit after client disconnect; real UI click and explicit stop are also covered by the runtime integration test.
- [x] Test crash/timeout paths and owned-process leak checks, including host hard kill where safely observable; record limitations in the acceptance result.
- [x] Run full verification and inspect generated evidence:

```sh
npm run format
npm run check
npm run test:harness:all
git diff --check
```

- [x] Obtain independent code review and address the reported correctness/safety findings.
- [x] Complete bounded local startup/shutdown revalidation, retain historical failure evidence, and record remaining causal uncertainty in the September 5 acceptance record.

## Historical acceptance notes — 2026-09-03

Gates A/B implementation is present, but final stability acceptance remains incomplete.
Full repository verification passed with 467 unit tests, and the headed suite has passed all 18 infrastructure integration tests in a single run.
Other full-suite runs intermittently timed out before Main readiness, including with the default public Electron launcher and the explicit Main-ready barrier; a green rerun does not establish that this issue is fixed.
The final rerun passed 16 of 18 integration tests, with two `MAIN_READY_TIMEOUT` failures; no owned process was found surviving the suite.
Independent review and scoped re-review resolved the reported findings, but do not supersede this outstanding runtime evidence.
The [design acceptance record](../specs/2026-09-02-ai-ui-debugging-harness-design.md#12-gates-ab-acceptance-record) records the tested version set, entry point, evidence layout and unresolved startup risk.
Next acceptance work must reproduce and resolve the Main-startup instability using public APIs or a verified compatible version set; changing topology still requires explicit approval.
Host hard-kill recovery remains manual after read-only identity-checked detection; AI-client registration and Gates C/D remain outside this implementation.

## Shutdown stabilization — 2026-09-05

- [x] Correlate native crash reports with run PIDs and reproduce early shutdown with an explicit clean-exit assertion.
- [x] Defer the fixed public Main quit request onto the normal event loop and share it with Gate A cleanup.
- [x] Record process exit codes/signals, reject abnormal normal-stop outcomes, and preserve explicit failed-generation recovery.
- [x] Separate normal and fault test files; preserve `test:harness:all` as the complete acceptance command.
- [x] Review the lifecycle change independently and address pre-existing abnormal exits during cleanup.
- [x] Complete final full-suite revalidation and record its scope and remaining uncertainty in [section 13 of the design](../specs/2026-09-02-ai-ui-debugging-harness-design.md#13-shutdown-stabilization-and-revalidation--2026-09-05).

Final verification: 467 unit tests and the repository checks/build passed; two consecutive full harness runs passed 22/22 tests each, and three default-suite runs passed 6/6 each.
No post-fix native crash report or owned process residue was found; the historical normal-startup timeout did not recur, though its causal relationship to the shutdown crash is not proven.
