# Editor interaction polish

## Approved requirements

Keep deleted words struck through inside the original reading paragraph instead of exposing audio clip splits as paragraphs.
Retain exact occurrence identity for audio edits; moved or repeated source material must not silently acquire shared editing scope.
Use a compact title bar ordered as native window controls, project title, save status, Open Project, Save, Save As, and Export.
Remove the application brand and import actions from the title bar.
Keep the normal Audio panel visible for empty projects and place Add Track below the final track.
Repair keyboard routing and make keyboard acceptance a durable harness scenario.

## Implementation and verification

1. Separate paragraph continuity from clip edit identity and cover inline deletion plus moved/duplicate boundary regressions.
2. Repair shortcut focus routing, preserving native text input behavior and canonical selection safety.
3. Update the title bar and empty/loaded audio layouts without changing persisted project data.
4. Review the combined changes, run format and check, and run Docker harness tests and real UI acceptance on the final source.

## Scope

No project schema or audio engine change is needed.
Native macOS traffic-light placement is configured in Electron but cannot be visually certified by Linux Docker acceptance.

## Verification record

The final product build is `index-Bq4JiBSo.js` / `index-DqqRNbCO.css`.
`npm run check` passed 618 tests across 89 files, formatting, lint, dead-code analysis, typechecking, and production build.
The Docker harness suite passed 25 tests across 12 files.
The real-audio E2E suite passed four scenarios initially; the overlap scenario passed separately after correcting its timing assertion and awaiting asynchronous import completion.
The original overlap assertion incorrectly assumed that moving one track moves the earliest overlap by the same amount even when the two real analyses begin speaking at different times.
No product change was required for those test corrections.

Final UI acceptance evidence is under `.harness-runs/container/ee4568d7-5a6a-465e-bee8-d297d359f33e/`.
The empty workspace is shown in `visual-4.png` and middle-of-sentence inline deletion in `visual-28.png`.
The durable keyboard scenario is `e2e/scenarios/keyboard-workflow.md`.
Native macOS chrome and menu integration require platform verification; Docker exercises Linux Electron.

The final `agent-testing-report.md` records PASS for the editing baseline and all five requested fixes.
The expanded keyboard scenario is BLOCKED only for real-UI coarse acoustic-boundary confirmation, which the available character-aligned fixture could not trigger; resolver regression coverage passed but is not substituted for UI evidence.
The owned Docker run was stopped and the client closed after generation 2.
