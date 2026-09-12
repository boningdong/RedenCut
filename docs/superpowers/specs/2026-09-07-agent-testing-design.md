# Agent Testing Design

## Goal and Scope

Add repository-guided AI acceptance using the existing Docker MCP harness.
Keep user goals and acceptance checkpoints stable while allowing the agent to choose UI actions from current observations.
The repository skill is named `agent-testing` and is specific to RedenCut despite its short name.
This is an instruction-driven development workflow, not a new runner or an enforced merge gate.

Existing fixed E2Es remain the deterministic regression baseline.
Do not translate those three tests into three equivalent Markdown scripts or ask the agent to repeat checksums and exact timing assertions.
Agent testing complements them with task completion, visible feedback, discoverability and change-focused exploration.

## Files and Responsibilities

| File | Responsibility |
| --- | --- |
| `AGENTS.md` | Require agent acceptance before handing off user-visible behavior changes; link to the skill and scenario index. |
| `.agents/skills/agent-testing/SKILL.md` | Environment checks, MCP execution, observation, recovery, evidence and cleanup. |
| `e2e/scenarios/README.md` | Scenario index, applicability, and the distinction from fixed E2Es. |
| `e2e/scenarios/editing-workflow.md` | One user-task scenario with mandatory checkpoints and change-focused checks. |
| `e2e/README.md` | Link to agent scenarios without duplicating their instructions. |
| `.harness-runs/container/<runId>/agent-testing-report.md` | Generated per-run acceptance report alongside harness evidence; not committed. |

Reuse `e2e/fixtures/audio/mandarin-short-female.wav` and existing runtime-owned projects and artifacts.
Keep protocol details in the existing harness documentation and keyboard contracts in `docs/key-mappings.md` rather than copying them into each scenario.

## Trigger and Execution Contract

- After implementing a user-visible feature or behavior fix, run the editing workflow plus acceptance checks for the changed behavior before claiming completion.
- Documentation-only and mechanical changes do not require product UI acceptance; explain that exclusion in the handoff.
- For a new behavior, establish its expected user-observable outcome from the approved requirements before testing; do not derive acceptance solely from the implementation.
- Select relevant additional checks before execution and record the selection rationale.
- Add or update a durable scenario when a new user task warrants it; do not weaken existing checkpoints merely to match an implementation.
- Read the actual MCP tool catalog, verify the connection uses the intended Docker checkout, and record code provenance, run ID and generation.
- Source edits after container startup require a fresh container snapshot; rebuilding inside the old container does not pick up newer host files.
- If the connected server is stale or cannot be safely reconnected, report the blocker instead of testing old code or silently changing client configuration.
- Use an isolated test project; never start host Electron, modify real user projects, or attach to another task's active run.
- Missing Docker, MCP or required capabilities produce an explicit blocked result, not a host fallback or a substituted fixed-test result.

## Initial Scenario: Editing Workflow

User goal: make a short edit, inspect and revise it, then save it for later work.
Use stable checkpoint IDs so reports can identify omissions without prescribing selectors, coordinates or individual tool calls.

| Checkpoint | Required observable outcome |
| --- | --- |
| `import` | Import the fixture; the track, waveform and useful audio information are visible. |
| `edit` | Split and move a portion to create a visible gap; identify the selected portion and inspect the resulting layout. |
| `revise` | Undo and redo the move; observe that the gap disappears and returns. |
| `transport` | Start playback, observe time advancing, pause, seek while paused, then resume; visible time and controls agree with the actions. |
| `persist` | Save, fully restart, reopen, and compare the visible edited layout with the saved-state evidence. |
| `changed-behavior` | Exercise the feature or fix under review against its agreed user-visible acceptance criteria; for a baseline workflow trial, explicitly record that no product change is under review. |

The agent chooses suitable positions and input methods and records what it actually did.
It must not replace a required behavior with an easier one, such as refreshing instead of restarting.
Inspect feedback and usability throughout; after mandatory checks, try one or two relevant variations selected from the change, such as zooming, changing selection or a different operation order.
Exploration supplements mandatory coverage and is reported separately.
The initial scenario certifies playback UI only, not sound content or sample-accurate positions.

## Observation and Recovery

Use MCP for app interactions and lifecycle; use visible UI evidence for acceptance.
Do not mutate or read internal stores, invoke private product APIs, or inspect project JSON as a substitute for user-observable acceptance.
Runtime diagnostics and logs may explain environment or tool failures but cannot prove that the user task succeeded.

Actual MCP exploration at commit `d1e4f5f` informed these rules:

- Timeline clips were absent from the accessibility snapshot: combine current visible region/ruler geometry with screenshot verification rather than equating tool success with edit success.
- Fit scaling changed after a move: refresh observations after edits, zooming and resizing; do not reuse stale coordinates.
- An out-of-scope reference failed after a targeted snapshot: reacquire a full snapshot or locate the target again before retrying.
- The Generate menu backdrop intercepted a second button click: retain the failure and report the workaround; do not force clicks through overlays.
- Playback controls changed correctly without any listening evidence: never infer audio correctness from transport UI.

For an interaction failure, preserve the error, re-observe, and allow at most two evidence-informed recovery attempts before marking that checkpoint blocked or failed.
Refreshing a stale reference is a tool recovery; a reproducible violation of an acceptance criterion is a product failure.
A workaround must remain in the report and must not turn a failed requirement into a pass.
Keep diagnosis and implementation separate; this skill does not independently authorize product fixes, downloads, external audio uploads or changes to test requirements.

## Evidence and Result Contract

Every mandatory checkpoint has `PASS`, `FAIL` or `BLOCKED`, with the actual observation and evidence path.
Use `FAIL` for an observed requirement violation and `BLOCKED` when the required observation cannot be obtained.
Overall acceptance passes only when every applicable mandatory checkpoint passes; missing evidence is not a pass.

The report records the scenario, change under review, code provenance, run/generation, actual operations, checkpoint results, exploration findings, errors and workarounds, exclusions and cleanup outcome.
Capture meaningful screenshots before and after edits and after reopening; retain existing snapshots, logs and traces.
Save the report through the host filesystem into the verified run directory, without adding an MCP report-writing API.
Stop only the owned run and preserve evidence, including on failure.
Later relevant code changes invalidate the report as final acceptance evidence and require a new run.

## Capability Boundaries

No product code changes, new MCP methods, audio-model integration, CI runner or AI-client configuration changes are included.
The current recorder is available to fixed test code, not exposed as MCP capture tools; this workflow cannot claim audio acceptance.
If the changed feature requires sound-content or transcription acceptance beyond available capabilities, mark that part blocked instead of silently excluding it.
Native dialogs remain limited to the existing prepared import/open/save replies; do not certify unsupported dialog flows.
Instructions encourage automatic execution but do not technically prevent an agent from omitting it; an enforced gate is separate future work.

## Verification of the Workflow

- Check skill metadata, repository links, scenario/checkpoint consistency, and report completeness rules.
- Exercise the authored skill against the real Docker MCP connection and produce a new report; the earlier exploration is design input, not validation of the finished skill.
- Check that missing capabilities, stale references and incomplete evidence are reported honestly rather than passed or silently bypassed.
- Follow repository formatting and verification requirements; do not claim deterministic E2Es were rerun unless they actually were.
