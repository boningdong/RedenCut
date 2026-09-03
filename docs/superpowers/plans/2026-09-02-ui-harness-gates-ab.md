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

| Path                                          | Responsibility                                                        |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `harness/mcp/createMcpFacade.ts`              | Public MCP discovery/call forwarding with complete result content     |
| `harness/mcp/ToolBackend.ts`                  | Facade/backend contract                                               |
| `harness/ui/PlaywrightMcpAdapter.ts`          | Official MCP server/client pair borrowing a context                   |
| `harness/runtime/HarnessRuntime.ts`           | Run state, lifecycle and admission coordination                       |
| `harness/runtime/OperationGate.ts`            | Exclusive lifecycle admission and serialized UI calls                 |
| `harness/runtime/ElectronSession.ts`          | Owned Electron launch/readiness/close and fixed read-only diagnostics |
| `harness/runtime/deadline.ts`                 | Bounded operation waits without silent retries                        |
| `harness/artifacts/RunArtifacts.ts`           | Durable run/generation manifests, logs and tool events                |
| `harness/artifacts/TraceRecorder.ts`          | Single tracing owner and incomplete-trace reporting                   |
| `harness/mcp/RuntimeToolBackend.ts`           | Lifecycle schemas, curated UI tools and generation envelopes          |
| `harness/server.ts`                           | Stdio entry, signal/disconnect cleanup; no user-facing CLI            |
| `src/main/harnessStartup.ts`                  | Opt-in isolated paths configured before the single-instance lock      |
| `harness/tests/fixtures/minimal-electron.cjs` | Small visible Electron compatibility fixture                          |
| `harness/tests/compatibility.integration.ts`  | Gate A: actual MCP traffic, images, context lifetime, trace           |
| `harness/tests/lifecycle.integration.ts`      | Gate B: real Podcut lifecycle, isolation and failures                 |
| `harness/tests/server.integration.ts`         | External stdio discovery, calls and disconnect behavior               |
| `harness/tests/*.test.ts`                     | Focused infrastructure unit tests                                     |
| `vitest.harness.config.ts`                    | Explicit headed integration test runner, serial execution             |
| `harness/tsconfig.json`                       | Type-check harness without including it in product bundles            |

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

- [ ] Install exact MCP/Playwright versions matching the official MCP dependency declaration; retain existing Electron initially and record audit findings without unrelated upgrades.
- [ ] Write a compatibility test that launches a visible isolated fixture, connects an SDK client to the actual facade, lists upstream tools and performs snapshot/click/screenshot requests.
- [ ] Use this observable fixture behavior: heading `Harness probe`, button `Increment`, and an output initially `0`; a real click must produce `1`.
- [ ] Assert screenshot content has an image block with PNG bytes, not merely a path; assert the Main PID matches the launched child.
- [ ] Start tracing before the UI actions; stop it to a retained ZIP; inspect the trace for the click and screenshot resources.
- [ ] Close the adapter and assert a Main evaluation and renderer read still succeed, then explicitly close Electron and assert process exit.
- [ ] Run the new test red before implementing the forwarding/adapter behavior:

```sh
npm run test:harness -- harness/tests/compatibility.integration.ts
```

- [ ] Implement only public SDK transports and `@playwright/mcp.createConnection`; configure `browser.isolated: false`, `imageResponses: 'allow'`, no upstream session/trace recording, and bounded action timeouts.
- [ ] Re-run Gate A and type/lint checks; inspect its screenshot and trace; request code review before promoting the composition into Gate B.
- [ ] If context ownership fails, investigate compatible public versions; stop for user confirmation before any topology or private-API workaround.

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

- [ ] Write focused red tests for admission: lifecycle excludes new UI calls, already-admitted work settles first, queued UI never enters a new generation, timeout does not replay a mutation, and status stays readable.
- [ ] Implement admission with promise settlement, explicit timeout errors, and generation validation at execution time as well as request time.
- [ ] Write startup tests proving opt-in paths are absolute and isolated, ordinary startup is unchanged, and invalid harness configuration fails before Electron starts.
- [ ] Configure `userData`, `sessionData` and `temp` under a unique run directory before `startApplicationLifecycle`; never disable the ordinary lock globally.
- [ ] Add DOM attributes reporting installed renderer session, dirty state and busy jobs; do not expose stores or a new renderer filesystem/control API.
- [ ] Build the real application and launch its built entry with no dev-server environment; verify Main initialization and renderer session readiness rather than just window creation.
- [ ] Create generation-tagged evidence containing build commit, dirty status, dependency versions, paths, PID, tool calls and independent Main/renderer logs.
- [ ] Implement one trace owner per generation; flush before closing and retain incomplete status if a crash interrupts finalization.
- [ ] Implement restart as admission close → settle work → dirty/busy preflight → trace flush → adapter dispose → owned Electron close → optional build → next generation readiness → fresh adapter.
- [ ] Dirty projects require save through UI or explicit discard; busy product work blocks ordinary restart/stop until settled, since C/D job controls are not implemented yet.
- [ ] Write and run real integration checks for repeated restart, stale refs, isolation between independent runs, startup timeout and application crash.
- [ ] Validate owned-process shutdown by process identity; never kill by app name, and report hard-kill recovery limits instead of claiming guaranteed cleanup.

## Task 3: Single MCP Entry and Failure Acceptance (Gate B)

**Files:** Create runtime tool backend and stdio server; extend unit/integration tests and package scripts.

**Interfaces:** External tools are `podcut_start`, `podcut_status`, `podcut_restart`, `podcut_stop`, `podcut_list_artifacts`, plus curated upstream UI tools.
UI tool schemas add required `runId` and `generation`; returned results carry the same identity.
Only `browser_snapshot` may establish the first current-generation snapshot; state-dependent UI calls fail until it succeeds.

- [ ] Write red protocol tests that list tools before launch, reject UI calls before readiness, and forward image/text/structured results unchanged except for the documented identity metadata.
- [ ] Discover the upstream tool catalog without launching an unrelated browser; allow only snapshot, click, drag, keyboard, typing, hovering, scrolling, screenshots and console/network observation as supported by the pinned version.
- [ ] Exclude browser/context close, navigation, new tabs, arbitrary evaluation/code execution, browser installation, file upload, and independent tracing tools from the external catalog.
- [ ] Reject unlisted tools and stale identities with structured recovery instructions; do not accept client overrides of internal output roots or upstream metadata.
- [ ] Keep stdout protocol-only; send host diagnostics to stderr and run evidence.
- [ ] On ordinary stdin close/SIGTERM, close admission and clean up owned resources with bounded waits; record unsaved-loss caveats for forced host shutdown.
- [ ] Test a real SDK stdio client against `node --import tsx harness/server.ts`; verify start/snapshot/click/screenshot/restart/stop and exit after client disconnect.
- [ ] Test crash/timeout paths and owned-process leak checks, including host hard kill where safely observable; record limitations in the acceptance result.
- [ ] Run full verification and inspect generated evidence:

```sh
npm run format
npm run check
npm run test:harness
git diff --check
```

- [ ] Obtain independent final code review, address correctness/safety findings, update design status with exact verified versions and A/B results, and commit the worktree changes.
- [ ] Report A/B results and remaining risks without claiming AI-client registration or C/D workflows are complete.
