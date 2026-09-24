# Diagnostic Report Workflow

## User goal

Understand why speech alignment did not complete and export a reviewed, private diagnostic report that can be shared with support.

## Setup

Use a disposable project and prepared audio fixture in the Docker MCP run owned by this task. Use a fault fixture or other authorized deterministic worker response to produce an alignment failure. No real user media or credentials are used.

## Mandatory checkpoints

| ID | Observable outcome | Evidence |
| --- | --- | --- |
| DIAG-1 | A failed alignment shows a plain-language explanation, relevant next action, diagnostic ID and Export Diagnostic Report control on its owning surface. | UI snapshot and screenshot |
| DIAG-2 | A two-source batch keeps successful output and displays each failed source with its own reason and distinct ID. | Batch summary snapshot and screenshot |
| DIAG-3 | Changing the UI language retranslates a retained failure while its diagnostic ID stays the same. | Before/after snapshots |
| DIAG-4 | Export preview shows the exact JSON to be saved, a partial-history notice when applicable, and an explicit excluded-content notice. The JSON contains no audio, transcript, project file or token content. | Screenshot and inspected exported JSON |
| DIAG-5 | Canceling native Save is quiet. Saving writes the previewed bytes, and Show in Finder reveals the saved report. | Dialog observations and saved-file comparison |
| DIAG-6 | After dismissing the failure, Help → Export recent diagnostic report reopens a preview for the latest retained failure. | Menu and dialog snapshots |

## Capability boundary

If the Docker MCP run lacks speech models or deterministic fault injection, mark those checkpoints BLOCKED with the observed capability and still exercise preview/save and menu behavior through an available reportable failure. Do not use private user projects or simulate UI success from internal stores.
