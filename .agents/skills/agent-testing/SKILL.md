---
name: agent-testing
description: Use when completing a user-visible RedenCut feature or behavior fix, or when asked to exercise RedenCut through its Docker MCP harness. Not for unrelated apps or documentation-only changes.
---

# Agent Testing

Validate user tasks through the real UI: fixed goals, adaptive actions, explicit evidence.
This complements fixed E2Es; their success does not replace this acceptance.

## Prepare

Read the [scenario index](../../../e2e/scenarios/README.md), selected scenario, [Docker harness guide](../../../harness/container/README.md), and [keyboard contract](../../../docs/key-mappings.md).
Before acting, list mandatory checkpoints and additional checks derived from the approved feature requirements, not its implementation.

For a new user-visible feature, check whether existing scenarios cover its main user goals and acceptance conditions.
If coverage is missing, tell the user what is missing and propose extending a related scenario or adding one, with a brief test goal and expected outcomes.
Prefer extending a related scenario; do not create a scenario for every feature or modify scenario files without user confirmation.
Still verify the current feature with targeted checks; pending approval of a durable scenario is not a reason to skip testing.

Before testing, confirm that the MCP connection targets Docker, uses the intended checkout, and controls a test run owned by this task.
Ensure the container includes the latest code changes. Source code is copied when the container starts; restarting or rebuilding Electron does not pick up later host edits. After product code changes, recreate the container through an available authorized mechanism. If that is unavailable, report BLOCKED without changing client configuration.

Documentation-only changes may reuse a verified unchanged product build; disclose this reuse. Do not rely solely on the Git revision in the lifecycle manifest: it reads live host metadata and may not match the code running inside the container.

## Execute and Observe

Start an isolated run, take a full snapshot, and use MCP for lifecycle and UI actions.
Use only prepared fixture/project dialog replies described in the harness guide.
Observe visible UI, not stores, private APIs or project JSON; diagnostics explain failures but do not establish acceptance.

| Situation | Action |
| --- | --- |
| Button or input | Locate from current snapshot; use semantic targets. |
| Timeline canvas | Derive coordinates from current region/ruler geometry; inspect screenshots to verify results. |
| Edit, zoom or resize | Refresh geometry; fit scaling can change. |
| Restart | Use returned generation and a new full snapshot; reacquire references. |
| Missing ref after partial snapshot | Re-observe the target/full page before retrying. |
| Timeout or overlay | Preserve error, re-observe; at most two informed recovery attempts, then classify the unresolved checkpoint. |

Wait for observable completion, with bounded polling; tool success alone is insufficient.
Record actual actions, not a script of assumed actions.
After mandatory checks, try one or two change-relevant variations and report them separately.
Keep workarounds visible; do not force clicks through overlays or turn a violated requirement into PASS.

## Evidence and Handoff

Create `agent-testing-report.md` through the host filesystem inside the verified `.harness-runs/container/<runId>/` directory; preserve existing files and link runtime-generated evidence.
If startup fails before a run exists, provide the same report structure in the task response.

Required report sections:

- **Context:** scenario, approved change/expected behavior, selected extra checks and rationale, checkout/revision/dirty state, snapshot freshness, run ID/generations.
- **Checkpoints:** one row per scenario ID and added check, with `PASS / FAIL / BLOCKED`, actual observation, and evidence path or explicit missing evidence. For a baseline-only trial, `changed-behavior` may be `EXCLUDED` with "No product change under review"; unavailable required checks remain BLOCKED.
- **Exploration:** variations, findings, tool errors and workarounds; separate these from mandatory results.
- **Limits:** excluded coverage and unavailable capabilities.
- **Cleanup:** owned-run stop result and retained artifact/report paths.
- **Verdict:** PASS only when every applicable mandatory check has evidence and passes; FAIL for observed requirement violations; otherwise BLOCKED. A cleanup failure prevents an overall PASS.

Example: `transport | BLOCKED | Paused seek observed; resume not observed | Missing resume evidence`.
Missing provenance or evidence remains explicit; old E2Es and screenshots cannot establish acceptance of unidentified code.
Stop the owned run even after failure; discard only this run's disposable edits when needed, preserving evidence.
Relevant edits after verification require a new acceptance run.

## Boundaries

Never fall back to host Electron or modify real projects/another task's run.
Do not independently fix product code, download models, upload audio, or weaken requirements.
Current MCP lacks recorder controls; moving playheads cannot prove audible output or sound-content correctness.
Required audio/transcription checks unavailable in this environment are BLOCKED, not silently excluded.
This skill is an execution instruction, not a guaranteed automatic trigger or merge gate.
