# UI Consistency and Interaction Workflow

## User Goal

Use a newly implemented or fixed feature as part of the existing app without visual surprises, ambiguous states, broken interactions or inaccessible controls.
Run this scenario after every implementation or fix that can affect visible UI, alongside the [editing baseline](editing-workflow.md) and the relevant feature scenario.
Backend changes that alter visible loading, completion or error behavior also qualify.
For changes with no visible impact, record an explicit scope-based exclusion; do not infer UI correctness from unit tests or a successful build.
Execute through the [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md).

## Prepare a Bounded Review

Identify the changed surface, its neighboring controls, entry and exit paths, affected shared components, and at least one existing comparable control elsewhere in the app.
State the approved behavior and select the state combinations below before interacting.
Use real UI actions and disposable fixtures to reach states; follow the harness rules for dialogs, project copies, source freshness and lifecycle.
Inspect screenshots as well as semantic snapshots: a valid accessibility tree does not prove correct rendering, and an attractive screenshot does not prove correct behavior.
Judge consistency against the app's established controls and approved design, not a new aesthetic invented during verification.

## Design Changes and Routine Repairs

Discuss changes to the overall design with the user before implementing them: a new visual direction, reorganized information hierarchy, a different main layout or a changed user workflow requires agreement.
When the design or intended behavior has already been agreed, directly fix implementation defects within that scope without asking for approval again.
Examples include unintended wrapping, clipping, overlap, inconsistent button/icon styles, incorrect spacing or alignment, and interaction states that deviate from the agreed behavior.
Use the approved design and established app patterns to resolve routine details; do not treat every CSS or component adjustment as a new design decision.
If a repair requires choosing between materially different designs or changing the agreed behavior, discuss that decision while continuing independent repairs that remain within scope.
When acceptance finds an authorized defect, return to implementation, fix it, then verify the affected checks against a fresh product snapshot; report what changed and the evidence.
This authorization covers repairs to the approved task, not an unsolicited redesign of unrelated screens.

## Mandatory Checkpoints

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `ui-consistency` | Comparable controls use coherent height, spacing, alignment, typography, icon weight/size, color meaning, borders, corner radii and wording. Primary, secondary, selected and disabled states remain distinguishable. Approved differences serve a clear purpose. | Changed surface and named reference control in screenshots, with the concrete similarities or discrepancies noted. |
| `ui-layout` | Normal and narrow supported windows/panels preserve readable content and reachable actions. No unintended wrapping, overlap, clipping, cropped focus indicators or page-level overflow. Long content has a usable wrapping, truncation or scrolling behavior; fixed actions do not disappear behind it. | Window/panel dimensions, screenshots of both widths and actual access to overflowed content. |
| `ui-transitions` | Exercise the main action and its reverse or exit. Selected, completed and disabled states agree with available actions. Switching modes/tabs does not unexpectedly shift controls, duplicate actions, lose applicable state or leave stale popovers. Stable unavailable actions stay disabled where the approved design requires them. | Before/after snapshots and screenshots, actual actions and visible state; test the transition back as well. |
| `ui-input` | Pointer and keyboard can reach and activate affected controls. Focus is visible and ordered sensibly; disabled controls cannot activate. Enter/Space, Escape, text input and editor shortcuts follow the [keyboard contract](../../docs/key-mappings.md) without triggering unrelated actions. Focus returns to a sensible place after closing an overlay. | Actual keys/clicks, focused-control screenshots or snapshots, and observations that unrelated playback/editing did not occur. |
| `ui-neighbors` | At least one adjacent existing action and one affected shared-component consumer still work. Opening, closing, switching scope and returning to the changed surface do not leave invisible click blockers, stale selection, broken scrolling or duplicate UI. | Named neighboring actions/consumers, visible results and a return-to-feature observation. If there is no shared consumer, state that explicitly. |

These checks are required for the affected surface, not an instruction to retest every screen in the app.
For an inapplicable subcase, state why it cannot arise; missing fixtures or capabilities are BLOCKED, not inapplicability.

## Change-Dependent State Matrix

Select applicable rows based on the user-facing risk, including at least one boundary or less-common state.
Document each selection or exclusion and its reason before the run; test representative combinations rather than an exhaustive Cartesian product.
Selected rows become required checkpoints for that run.

| ID | When applicable | Expected outcomes and evidence |
| --- | --- | --- |
| `ui-data` | Lists, tags, tracks, names or user-generated text | Exercise empty, one-item and crowded/multi-item states; long names and Unassigned/unknown items where supported. Use existing fixtures or real UI edits. Inspect row alignment, ellipsis/wrapping, horizontal scroll and reachability of the final item. |
| `ui-task-states` | Generation, downloads, validation or other asynchronous actions | Check reachable idle, selected, running, partial completion, complete, failure and retry/cancel states. Feedback belongs to the correct target; repeated activation cannot start accidental duplicate work; completed work is reused or rerun as approved. Record unavailable states individually. |
| `ui-scope` | All/single selection, multiple tracks/sources, modes or project switching | Target labels and enabled actions match the actual scope. Switching away and back does not carry a previous target's selection, completion state or errors into another target. Single-target and all-target controls follow the same rules. |
| `ui-overlays` | Menus, tooltips, dialogs, editors or popovers | Open near a window/panel edge and after scrolling. Content and footer actions remain visible/reachable, layering is correct, outside-click/Escape/cancel behave as specified, and closure removes blockers. Reopening does not unexpectedly apply a discarded draft. |
| `ui-appearance` | New styling, shared CSS, icons, color or layout | Inspect the affected states in each supported explicit theme and at normal/narrow widths. Use actual settings controls. Check active/disabled legibility, focus, icon visibility and state meaning; color alone must not be the only status cue. |
| `ui-language` | New text, constrained widths or localized controls | Inspect affected controls in supported UI languages, including the longest relevant labels. No missing translations, raw keys, broken glyphs or cropped actionable labels. Use the [localization workflow](localization-workflow.md) for language behavior changes. |
| `ui-history` | Editable/persisted state or changes to its presentation | Save/cancel and undo/redo reflect the approved contract; display-only changes do not alter audio/content. Where persistence is expected, save, fully restart and reopen. Link relevant feature/baseline evidence instead of repeating identical checks. |

## Exploration and Reporting

After the selected matrix, try one or two relevant variations such as changing width with a menu open, switching mode after opening an editor, or revisiting the feature after changing tracks.
Reacquire geometry after resizing or zooming; do not use stale coordinates.
For every checkpoint report expected versus observed behavior, state/scope, dimensions/theme/language where relevant, and evidence paths.
Visual-consistency findings should identify the reference control and exact mismatch rather than only saying the UI looks good or bad.
Record discovered defects even when unrelated to the change; distinguish pre-existing observations from regressions only when comparison evidence supports that claim.
Fixes within the approved task require a fresh source snapshot and rerun of the affected checks before handoff.
Do not silently redesign unrelated UI or expand the task to fix every incidental issue.

Use the agent-testing report format: PASS / FAIL / BLOCKED per required check, explicit reasons for exclusions, cleanup result, and remaining uncertainty.
Overall PASS requires all mandatory and selected checks to pass; inaccessible required states remain BLOCKED.
Existing evidence may be linked only when the product source, surface and state under review are identified and unchanged; identify reused evidence explicitly.
Automated tests complement these observations and do not replace operating the actual app.
When trialing edits to this scenario itself, identify the executed subset and mark the remainder NOT RUN; a successful workflow trial is not full product acceptance.

## Limits

Docker Electron acceptance does not establish native macOS/Windows window, file-dialog, assistive-technology or hardware behavior.
Inspect native behavior separately when the change depends on it and report unavailable capabilities honestly.
Do not download models, fabricate project state or weaken expected behavior to make a checkpoint pass.
