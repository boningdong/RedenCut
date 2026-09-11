# Editor Workspace Layout Design

Date: 2026-09-10.
Status: All implementation checkpoints approved in conversation; configuration, draggable workspace and visual integration are implemented. Final verification is recorded in the final editor UI plan.

## Goal and scope

Introduce a repositionable editor workspace and apply the approved visual design while preserving existing audio and transcript behavior.
The delivery has three review checkpoints: user layout configuration, draggable workspace integration, and visual integration.
Multitrack transcript projection, overlap detection, and content-driven alignment are defined in the companion [transcript projection design](2026-09-10-transcript-projection-design.md).

The approved mock and requirements are located in the enclosing workspace at `docs/ui-mock/2026-09-10/podcut-ui-final.html` and `podcut-ui-requirements.md`.
From this repository's current checkout, the enclosing workspace is `/Users/boning/Workspaces/Podcut`.
The mock is a visual reference, not production logic: do not copy simulated generation, playback, export, or timestamp allocation.

## Global constraints

- Preserve the Electron main/preload/renderer boundaries and use typed IPC.
- Use Zustand for renderer application state.
- Persist layout in local user configuration, not in project files.
- Layout changes must not dirty a project or enter audio editing history.
- Do not modify AGENTS.md or skills as part of this change.
- Do not add comments, bookmarks, floating windows, or a general docking framework in this phase.
- Keep source audio, playback, transcription, and export behavior on their existing production paths.
- Preserve the existing light theme while making the approved dark mock the primary visual acceptance reference.

## Workspace structure

The workspace owns layout mechanics; each feature owns its panel content.
The initial content panels are Transcript and Audio, and Transport occupies a top or bottom strip.
Transcript and Audio can swap vertical order and share available content height through a draggable divider.
Transport can move above or below the content region.
Dragging starts only from a designated panel handle, with a visible legal drop target and cancellation through Escape or pointer cancellation.
Keyboard-accessible layout commands provide an equivalent way to reorder panels.

Future Transcript-local comments or bookmarks can be composed beside its main editor using an internal split.
This does not require making those subregions independently dockable across the entire workspace.
Panel definitions contain IDs, labels, minimum dimensions, and allowed placement capabilities; content components do not contain global placement logic.
The first version does not use an arbitrary recursive docking tree.

## State and contracts

The persisted schema belongs in `src/shared/workspaceLayout.types.ts`, because it crosses IPC.
Renderer-only drag and drop types belong in `src/renderer/src/workspace/workspaceLayout.types.ts`.

```ts
interface WorkspaceLayout {
  version: 1
  contentOrder: ['transcript', 'audio'] | ['audio', 'transcript']
  transcriptRatio: number
  transportPosition: 'top' | 'bottom'
}

type WorkspaceDropTarget =
  | { kind: 'content-order'; first: 'transcript' | 'audio' }
  | { kind: 'transport-position'; position: 'top' | 'bottom' }
```

Define the runtime WorkspaceLayout schema with Zod and derive its TypeScript type from the schema.
Default values are transcript-first, transcriptRatio 0.6, and transport at the bottom.
The stored ratio must be finite and between 0.1 and 0.9.
The rendered ratio is further constrained by available height and panel minima; resizing the window does not overwrite the user's stored preference.
At the current application minimum of 900 by 600 pixels, both editing regions and Transport must remain reachable; content scrolls within panels when required.

Zustand stores the current layout, hydration/save status, and transient drag state.
Transient pointer coordinates and drag previews are not persisted.
Use a monotonically increasing local edit generation to prevent a delayed hydration response or save response from overriding newer local choices.
During resize, preview locally; persist once after completion.
When several completed changes occur quickly, serialize saves and coalesce pending unsent layouts to the latest choice.
A save failure leaves the current layout usable and offers a retry or a concise nonmodal message.

## User configuration persistence

Main owns `workspace-layout.json` under `app.getPath('userData')`.
Keep the file scoped to workspace preferences so this change does not introduce a generic configuration service or interfere with unrelated future settings.
Resolve userData after the existing harness startup isolation is configured.
Renderer never receives or chooses a filesystem path.

The preload API exposes `workspaceLayout.get()` and `workspaceLayout.set(layout)`.
Use the repository's existing IpcResult/invokeSafe conventions so rejected requests and filesystem failures are handled consistently.
Validate incoming write requests before writing.
Writes use a same-directory temporary file and rename, and the main service serializes writes.

Missing configuration returns defaults without error.
Malformed JSON or invalid fields produces safe defaults with a recoverable warning, preserving the existing file until an explicit user change is saved.
For a version-1 record, normalize valid known panel IDs, discard obsolete IDs, append missing supported panels, preserve valid fields, and fall back individually for invalid fields.
Unknown newer versions return defaults with a warning and must not be automatically overwritten on startup.
Permission and other filesystem errors are returned as failures, rather than falsely reporting persistence success.
No project session or open audio file is required to load or save layout.

## Component ownership

```text
src/
├── shared/workspaceLayout.types.ts
├── main/preferences/WorkspaceLayoutStore.ts
├── main/ipc/workspaceLayout.ipc.ts
├── renderer/src/workspace/
│   ├── workspaceLayout.types.ts
│   └── workspaceLayout.ts
├── renderer/src/stores/workspace.store.ts
└── renderer/src/components/Workspace/
    ├── EditorWorkspace.tsx
    ├── WorkspacePanel.tsx
    ├── PanelDragHandle.tsx
    ├── PanelDropIndicator.tsx
    └── PanelDivider.tsx
```

Integrate through existing main initialization, shared IPC contract, preload adapter, and App composition.
Tests are colocated with the corresponding responsibility.
Keep feature panel instances mounted under stable parents when changing layout; do not recreate the player.
Visual ordering must be reconciled with keyboard focus navigation and accessible reading order; CSS ordering alone is not sufficient acceptance evidence.
Native text selection and scroll positions require explicit acceptance checks after panel movement.

## Visual integration checkpoint

Apply the mock's dark surfaces, fine borders, spacing, typography, panel chrome, and track-color continuity through existing theme tokens and focused shared styles.
Keep Generate transcript in the Transcript header, including real availability, progress, cancellation, and error behavior already supported by the application.
Expose real undo and redo alongside playback and time in Transport, using the existing editing history.
Keep project operations and export functional, and move technical metadata into a details entry point.
Use recognizable accessible labels, visible focus states, and disabled states for unavailable actions.
Respect the macOS inset titlebar and keep window-drag regions separate from interactive controls.
The demonstration scenario panel and comparison-mode controls from the HTML are not production UI.

## Review checkpoints and acceptance

1. Configuration: defaults, recovery, serialized durable saves, preload contract, and project independence.
2. Workspace: legal drag targets, cancellation, resize limits, keyboard alternatives, reset, restart persistence, and stable editing state.
3. Visual integration: comparison against the mock, all current feature controls, light-theme regression, and titlebar behavior.

At each code checkpoint run focused tests; before declaring the checkpoint complete run `npm run format` and `npm run check`.
For user-visible changes, follow `.agents/skills/agent-testing/SKILL.md` with an owned Docker run, the required baseline, and targeted workspace checks.
Ask before modifying durable scenario definitions if additional scenario coverage is needed; still execute the targeted checks.
Report blocked Docker or audio checks explicitly, and do not substitute the HTML mock for production acceptance.
This document itself changes no product behavior and does not require product UI acceptance.

## Subsequent Transcript design boundary

The next specification will cover timeline occurrences identified by source, analysis revision, acoustic unit, track, and clip instance.
Overlap intervals must derive from current output-time projections and update after clip moves, splits, removal, undo, and redo.
Display layout must remain separate from semantic selection and acoustic edit resolution.
Preserve the chosen single-column overlap cards with a local Read/Align control, names once per speaker block, natural non-overlap text, and faint correspondence marks.
Same-track ambiguous speaker presentation remains a later design discussion; source separation is not in scope.
