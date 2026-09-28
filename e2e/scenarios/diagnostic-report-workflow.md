# Diagnostic Report Workflow

## User goal

Understand why speech alignment did not complete and collect and review retained diagnostic logs in a ZIP that can be shared with support.

## Setup

Use a disposable project and prepared audio fixture in the Docker MCP run owned by this task. Use a fault fixture or other authorized deterministic worker response to produce an alignment failure. No real user media or credentials are used.

## Mandatory checkpoints

| ID | Observable outcome | Evidence |
| --- | --- | --- |
| DIAG-1 | A failed alignment shows a plain-language explanation, relevant next action, diagnostic ID and Export Diagnostic Report control on its owning surface. | UI snapshot and screenshot |
| DIAG-2 | A two-source batch keeps successful output and displays each failed source with its own reason and distinct ID. | Batch summary snapshot and screenshot |
| DIAG-3 | Changing the UI language retranslates a retained failure while its diagnostic ID stays the same. | Before/after snapshots |
| DIAG-4 | Collection shows environment, file inventory, retained coverage and applicable loss/history warnings. Inspect collected files exposes the snapshot contents before saving; audio, transcript and project files are not included, and free-text privacy limits are explained. | Screenshot and independently extracted ZIP |
| DIAG-5 | Canceling native Save is quiet. Saving writes the collected snapshot files, and Show in Finder reveals the saved report. | Dialog observations and saved-file comparison |
| DIAG-6 | After dismissing the failure, Help → Collect diagnostics opens a recent-history collection even when no failure exists. | Menu and dialog snapshots |

| DIAG-7 | Settings → Diagnostics → Collect diagnostics uses the same collection summary/actions inline, without a nested dialog or prior failure. | Settings snapshot and screenshot |
| DIAG-8 | Save failure offers another location; recollecting produces a fresh snapshot. Closing and reopening does not leave a busy state or block editing. | Retry/reopen observations |
| DIAG-9 | Switching UI language retranslates diagnostics without recollection; controls remain usable in both themes and at narrow width. | Localized/theme screenshots |

## Capability boundary

If the Docker MCP run lacks speech models or deterministic fault injection, mark those checkpoints BLOCKED with the observed capability and still exercise preview/save and menu behavior through an available reportable failure. Do not use private user projects or simulate UI success from internal stores.
