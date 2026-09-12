# Localization verification

Implemented persistent English, Simplified Chinese and Follow System preferences using i18next, with main-owned settings and renderer updates that preserve editor state.
Application UI, accessibility labels, tooltips, public errors/progress and native application-supplied dialog copy are localized.
Project data, user-owned names and speech recognition language remain independent.

## Verification

- `npm run check`:107 test files /741 tests passed, including format, lint, Knip, typecheck and production build.
- Docker fixed E2E:4 files /5 tests passed for editing/playback, import/save/restart/reopen, export and localization.
- Real Electron contextBridge regression: confirmed old Error subclasses lose custom reason/code fields; fixed serializable descriptors pass all4code cases while excluding private diagnostics.
- Fresh Docker MCP adaptive acceptance on product commit09c02e1: PASS for import, split/move, undo/redo, paused seek/resume, playback language switching, modal copy,900×600 layouts, saved/reopened edits and persisted Chinese preference.
- Independent whole-branch review and scoped bridge-fix review approved.

Run ID:62e016a6-1b04-4a65-94ae-d2add4d5d652, generations1 and2.
Owned run stopped cleanly; client close and process exit returned0.
Local evidence is retained under `/Users/boning/Workspaces/RiffCut/localization-evidence/`, with the final `agent-testing-report.md` in `harness-runs/container/62e016a6-1b04-4a65-94ae-d2add4d5d652/`.

## Limits

Linux Docker does not verify macOS-owned picker controls or native macOS font/window rendering.
Application-supplied native dialog strings and response mappings were tested with mocks.
No speech model was downloaded or live recognition executed; recognition-language independence and active-job preservation were verified through contract/component tests.
An earlier adaptive run encountered an engine-wide OrbStack outage, recovered without a shared restart and was superseded by the successful final run.
