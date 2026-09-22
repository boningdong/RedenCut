# Agent Acceptance Scenarios

These Markdown scenarios describe user goals and observable acceptance, not sequences of Playwright calls.
The [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md) owns execution, environment safety, recovery and reporting.
Existing [fixed E2Es](../README.md) continue to own deterministic regression assertions; overlapping setup is not a reason to repeat checksums or exact timing calculations manually.

## Scenario Index

| Scenario | When to run | Required capabilities |
| --- | --- | --- |
| [Settings and onboarding workflow](settings-onboarding-workflow.md) | First-run setup, appearance preferences and resource preparation | Docker MCP, snapshots; real downloads additionally require runtimes and appropriate access |
| [Localization workflow](localization-workflow.md) | UI language, preference persistence, and localized editing controls | Docker MCP, prepared fixture/project dialogs, snapshots and screenshots |
| [Editing workflow](editing-workflow.md) | Baseline for user-visible changes; waveform fit/overflow, effects and replacement display regressions; explicit workflow trials | Docker MCP, prepared fixture/project dialogs, snapshots and screenshots |
| [UI consistency and interaction workflow](ui-consistency-workflow.md) | Every implementation/fix that can affect visible UI, including backend-driven UI states | Docker MCP, real interactions, screenshots and semantic snapshots |
| [Transcript editing workflow](transcript-editing-workflow.md) | Saved-text edits, timing boundaries, occurrence scope, filters, history and persistence; overlay checks when implemented | Docker MCP and disposable saved transcript fixtures; no models required |
| [Redact preview workflow](redact-preview-workflow.md) | Redact playback or export changes: Preview comparison, default export removal and retained-overlap protection | Docker MCP, prepared dialogs, ordered playback snapshots and FFmpeg/FFprobe output inspection |
| [Keyboard editing workflow](keyboard-workflow.md) | Shortcut routing, keyboard editing, focus behavior and keyboard-driven save/persistence | Docker MCP with keyboard input, prepared fixture/project dialogs, saved transcript fixture |
| [Speech analysis workflow](speech-analysis-workflow.md) | Generate and edit a canonical aligned transcript with anonymous speakers | Speech-enabled Docker MCP, provisioned models, prepared audio/project dialogs |

For a feature or behavior fix that can affect visible UI, run the editing baseline, the UI consistency and interaction workflow, and checks for the approved changed behavior.
Select the UI workflow's applicable state matrix before execution; include a concrete comparison with existing app controls and inspect rendered screenshots.
Record their expected outcomes and selection rationale; an unrelated successful baseline does not validate the feature.
For documentation-only or mechanical changes, explain why product acceptance is not applicable.
Changes to this skill or its scenario require a workflow trial to validate the instructions even though product behavior is unchanged.

## Authoring Scenarios

- Describe the user task, fixtures, mandatory checkpoint IDs, observable outcomes, evidence needs and capability boundaries.
- Fix the intent and acceptance, not selectors, screen coordinates, tool-call sequences or arbitrary sleeps.
- Add a scenario for a distinct reusable user task; avoid creating one Markdown copy for each scripted E2E.
- Change acceptance only when approved requirements change, not because the current app fails a checkpoint.
- Keep small change-specific variations in the run report; promote them to a durable scenario when they become a recurring user task.

Reports belong in the run's artifact directory, not this folder.
No recordings, copied source files or generated screenshots belong beside the scenario definitions.
