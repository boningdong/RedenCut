# PodCut — Architecture Addendum: Minimalism + Plugin System

*Supplement to Technical Roadmap v1 — March 2026*

---

## Overview of Impact

| New Requirement | Scope of Impact | Urgency |
|---|---|---|
| Minimalism design | UI layer only — does not touch audio engine | Low: can defer styling decisions to Phase 1 |
| Plugin system | Affects `AudioEngine`, `ProjectStore`, `IPCBridge`, UI layout | **High: must lay groundwork in Phase 0, or retrofitting is painful** |

The minimalism requirement is a UI concern that mainly guides component and styling choices. The plugin system is an architectural concern — if you don't design extension points from the beginning, adding them later means breaking interfaces that other code (and eventually other developers) depend on.

---

## Part 1: Minimalism Design

### Philosophy

Minimalism in a tool like this means: **show only what the user needs right now**. The waveform is the center. The transcript appears when there is one. The inspector appears when something is selected. Nothing competes for attention.

This is not just an aesthetic choice — it directly shapes the component architecture. Each panel must be independently collapsible and aware of its own "relevance" state.

### What Changes in the Architecture

**1. Design Token System (add in Step 0.5)**

Instead of hard-coding Tailwind color values throughout components, define a set of CSS custom properties in a single tokens file. This lets the entire visual language change in one place — including supporting a light/dark mode later, or letting plugins apply custom themes.

```css
/* src/renderer/styles/tokens.css */
:root {
  /* Palette — monochrome base with a single accent */
  --color-bg-primary:     #0f0f0f;
  --color-bg-secondary:   #1a1a1a;
  --color-bg-elevated:    #242424;
  --color-border:         #2e2e2e;
  --color-text-primary:   #e8e8e8;
  --color-text-secondary: #888888;
  --color-text-muted:     #555555;
  --color-accent:         #6366f1;    /* indigo — the only chromatic value */
  --color-accent-muted:   rgba(99, 102, 241, 0.15);
  --color-danger:         #ef4444;    /* muted regions */
  --color-danger-muted:   rgba(239, 68, 68, 0.12);

  /* Spacing — 4px base grid */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;

  /* Typography */
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
  --text-sm: 0.8125rem;   /* 13px — transcript word size */
  --text-base: 0.9375rem; /* 15px */
}
```

This single file is the complete design vocabulary. Every component uses these variables, never raw color values. When a plugin wants to contribute a panel, it inherits the same tokens automatically.

**2. Radix UI Primitives (replace raw HTML elements)**

Use [Radix UI Primitives](https://www.radix-ui.com/primitives) for any interactive component: Dialog, ContextMenu, Tooltip, Slider, DropdownMenu, ScrollArea. Radix handles accessibility (ARIA, keyboard navigation, focus trapping) and is completely unstyled — you apply your own Tailwind/token classes. This keeps the UI minimal (no opinionated visual style baked in) while having solid accessibility for free.

```bash
npm install @radix-ui/react-tooltip @radix-ui/react-context-menu @radix-ui/react-slider @radix-ui/react-scroll-area @radix-ui/react-dialog
```

**3. Progressive Disclosure Pattern**

The rule: a panel at rest shows only the most essential information. Detail appears on hover, focus, or explicit selection.

```
At rest:          On hover / selection:
┌─────────────┐   ┌─────────────────────────────┐
│ e001  mute  │   │ e001  mute  [0:05.2 – 0:08.4]│
└─────────────┘   │ Crossfade: ───●─── 30ms       │
                  │ [Unmute]  [Extend ±]           │
                  └─────────────────────────────────┘
```

Implement this as a `<DetailOnHover>` wrapper component that toggles a CSS class. Not a state machine — just a CSS `:hover`/`[data-selected]` variant with Tailwind.

**4. Command Palette (adds to Phase 3)**

Minimalist tools shift towards keyboard-driven workflows and away from menu bars. A command palette (`Cmd+K`) lets power users access all actions without navigating menus. This is also where plugin-contributed commands will surface naturally.

Use `cmdk` (shadcn's command palette primitive):
```bash
npm install cmdk
```

The command registry is a simple array of `{ id, label, shortcut, action }` objects. Both core commands and plugin commands register here.

---

## Part 2: Plugin System

### Why You Must Design This in Phase 0

The plugin system is not a feature you add on top of a finished app. It's a constraint on how you design the internal interfaces. Specifically:

- The `AudioEngine`'s export pipeline must be designed as a **chain of stages**, not a monolithic function, so plugins can insert processing steps.
- The `ProjectStore`'s schema must accommodate **plugin-defined metadata**, or plugins will have to store their data outside the project file.
- The **IPC bridge** must have a plugin-specific API surface that is separate from and narrower than the core API, so you can evolve the core without breaking plugins.
- The **UI layout** must have named **slots** where plugin panels can mount, so the dockable system doesn't have to know about specific plugins.

None of this requires writing the full plugin system in Phase 0. It requires making the right structural choices so the plugin system can be bolted on later without a rewrite.

### The Plugin Model: Three Concepts

**1. Manifest (`plugin.json`)** — describes what the plugin is and what it contributes:

```json
{
  "id": "com.example.noise-reducer",
  "displayName": "Noise Reducer",
  "version": "1.0.0",
  "engines": { "podcut": ">=1.0.0" },
  "main": "./dist/index.js",
  "contributes": {
    "panels": [
      { "id": "noise-panel", "title": "Noise Reduction", "icon": "wand" }
    ],
    "audioProcessors": [
      { "id": "noise-reduce", "hook": "pre-export", "label": "Reduce Background Noise" }
    ],
    "commands": [
      { "id": "noise.analyze", "title": "Analyze Background Noise", "shortcut": "Cmd+Shift+N" }
    ]
  }
}
```

**Contribution points** (the extension points the app exposes):
- `panels` — a new panel the plugin can mount in the dockable layout
- `audioProcessors` — a function that receives audio and returns processed audio, hooked at `pre-export` or `post-export`
- `commands` — entries in the command palette with optional keyboard shortcuts
- `transcriptionEngines` — an alternative to whisper.cpp (Phase 3+)
- `editDetectors` — a function like the filler-word detector that produces `Edit[]` from a transcript (Phase 3+)

**2. Plugin API (`IPluginContext`)** — the surface the plugin code can call. This is intentionally narrow:

```typescript
// src/shared/plugin.types.ts

export interface Disposable {
  dispose(): void;
}

export interface IPluginContext {
  // Read/write the current project (sandboxed — plugins cannot call ipcMain directly)
  project: {
    getProject(): ProjectFile;
    addEdits(edits: Edit[]): void;
    onProjectChanged(cb: (project: ProjectFile) => void): Disposable;
    // Plugin-specific metadata stored in project.pluginData[pluginId]
    getPluginData<T>(key: string): T | undefined;
    setPluginData<T>(key: string, value: T): void;
  };

  // Request audio processing (plugin cannot call FFmpeg directly)
  audio: {
    getSourcePath(): string;
    // Plugin submits a declarative spec; the host executes it via FFmpeg
    requestProcess(spec: AudioProcessSpec): Promise<string>;
  };

  // UI contributions
  ui: {
    registerPanel(config: PanelConfig): Disposable;
    showNotification(message: string, type?: 'info' | 'error'): void;
    registerCommand(command: CommandConfig): Disposable;
  };

  // Private storage for plugin state (isolated per plugin)
  storage: {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
    getStoragePath(): string;   // directory on disk
  };
}

export interface AudioProcessSpec {
  inputPath: string;
  operation: 'ffmpeg-filter';
  filter: string;    // e.g., "highpass=f=80,lowpass=f=16000"
  outputPath: string;
}
```

Notice what plugins **cannot** do: call `ipcMain` directly, spawn arbitrary processes, access arbitrary filesystem paths, call FFmpeg with arbitrary arguments. This is the security boundary.

**3. Plugin Host (`PluginHost`)** — the main process module that loads and manages plugins:

```typescript
// src/main/plugins/host.ts

export class PluginHost {
  private plugins = new Map<string, LoadedPlugin>();

  async loadPluginsFromDirectory(dir: string): Promise<void> {
    // Scan ~/.podcut/plugins/ for plugin.json files
    // Validate manifest against schema
    // require() the plugin's main entry point
    // Call plugin.activate(createContext(pluginId))
  }

  createContext(pluginId: string): IPluginContext {
    // Returns a context object where every method is scoped to pluginId
    // The plugin cannot call methods on behalf of another plugin
    // All project mutations go through the same ProjectStore the core uses
    return { project: ..., audio: ..., ui: ..., storage: ... };
  }

  getContributions(): AllContributions {
    // Aggregates panels, commands, processors from all loaded plugins
    // Used by IPC bridge to expose to renderer
  }
}
```

### How This Affects Each Existing Module

**`AudioEngine` (render.ts) — Processing Pipeline**

Replace the monolithic `renderProject()` function with a pipeline of named stages. This is the single most important structural change for plugin support:

```typescript
// BEFORE (monolithic):
async function renderProject(project, outputPath) {
  // one big FFmpeg filter graph
}

// AFTER (pluggable pipeline):
interface PipelineStage {
  id: string;
  name: string;
  execute(input: StageInput): Promise<StageOutput>;
}

class RenderPipeline {
  private stages: PipelineStage[] = [
    new EditStage(),        // apply mutes/cuts
    new GainStage(),        // apply gain adjustments
    new CrossfadeStage(),   // apply crossfades
    new NormalizeStage(),   // loudnorm to -16 LUFS
  ];

  // Plugin registers here:
  insertStage(stage: PipelineStage, position: 'pre-export' | 'post-export'): void {
    if (position === 'pre-export') this.stages.unshift(stage);
    else this.stages.push(stage);
  }

  async execute(project: ProjectFile, outputPath: string): Promise<void> {
    let currentPath = project.source.file;
    for (const stage of this.stages) {
      const result = await stage.execute({ inputPath: currentPath, project });
      currentPath = result.outputPath;
    }
    fs.renameSync(currentPath, outputPath);
  }
}
```

This change can be made in Phase 2 Step 2.6 (the export step). The core stages replace what was previously hardcoded. Plugins add stages later.

**`ProjectStore` — Plugin Metadata Slot**

Add a `pluginData` field to the `ProjectFile` schema from day one. This way plugins have a home in the project file without changing the schema later:

```typescript
// src/shared/project.types.ts — add to ProjectFileSchema:
pluginData: z.record(z.string(), z.unknown()).optional().default({}),
// e.g., project.pluginData["com.example.noise-reducer"] = { noiseProfile: "..." }
```

This is a one-line schema addition in Phase 0 Step 0.3. Cost: nothing. Benefit: plugins can persist state to the project file without schema changes.

**IPC Bridge — Plugin API Channel**

Add a separate `plugins` namespace to `IElectronAPI`. This is distinct from the core audio/project channels:

```typescript
// src/shared/ipc.types.ts — add:
plugins: {
  getContributions(): Promise<AllContributions>;   // panels, commands contributed by plugins
  executeCommand(pluginId: string, commandId: string): Promise<void>;
  requestAudioProcess(pluginId: string, spec: AudioProcessSpec): Promise<string>;
}
```

**UI Layout — `<PluginPanelSlot>`**

Add a slot mechanism to the layout from Phase 1. Even when no plugins exist, the slot is present and simply renders nothing:

```tsx
// src/renderer/components/PluginPanelSlot.tsx
import { usePluginStore } from '@renderer/stores/plugin.store';

interface Props {
  position: 'left' | 'right' | 'bottom';
}

export function PluginPanelSlot({ position }: Props) {
  const panels = usePluginStore(s => s.panels.filter(p => p.position === position));
  if (panels.length === 0) return null;

  return (
    <div className="plugin-panel-slot">
      {panels.map(panel => (
        <PluginPanel key={panel.id} panel={panel} />
      ))}
    </div>
  );
}
```

Place `<PluginPanelSlot position="right" />` in `App.tsx` in Phase 1. When the first plugin contributes a panel, it appears there without any layout changes.

### Updated Directory Structure

```
podcut/
├── src/
│   ├── main/
│   │   ├── plugins/                       # NEW
│   │   │   ├── host.ts                    # PluginHost — loads and manages plugins
│   │   │   ├── context-factory.ts         # Creates IPluginContext per plugin
│   │   │   ├── manifest.ts                # Validates plugin.json against schema
│   │   │   └── pipeline-bridge.ts         # Connects plugin audioProcessors to RenderPipeline
│   │   ├── audio/
│   │   │   ├── pipeline.ts                # RENAMED/REFACTORED: RenderPipeline class
│   │   │   ├── stages/                    # NEW: individual pipeline stages
│   │   │   │   ├── edit.stage.ts
│   │   │   │   ├── gain.stage.ts
│   │   │   │   ├── crossfade.stage.ts
│   │   │   │   └── normalize.stage.ts
│   │   │   └── ...existing files
│   │   └── ipc/
│   │       └── plugins.ipc.ts             # NEW
│   │
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── PluginPanelSlot.tsx        # NEW
│   │   │   ├── CommandPalette/            # NEW (cmdk)
│   │   │   └── ...existing components
│   │   ├── stores/
│   │   │   └── plugin.store.ts            # NEW: tracks loaded plugin contributions
│   │   └── styles/
│   │       └── tokens.css                 # NEW: design tokens
│   │
│   └── shared/
│       ├── plugin.types.ts                # NEW: IPluginContext, manifests, contributions
│       └── ...existing files
│
└── plugins/                               # NEW: first-party example plugins (for dev/testing)
    └── example-filler-highlighter/
        ├── plugin.json
        └── src/index.ts
```

### Security Model (Trust Levels)

For a personal tool in v1, use a pragmatic trust model:

**Level 1 (v1 — now):** Plugins are Node.js modules loaded via `require()` in the main process. They have access to whatever `IPluginContext` exposes. You trust plugins like you trust npm packages. Document this clearly: "only install plugins from sources you trust."

**Level 2 (future):** High-risk plugins (those that do audio processing) run in a `worker_thread` with a sandboxed `IPluginContext` that communicates via `postMessage`. This isolates them from the main process's memory.

**Level 3 (future):** UI panel plugins run in a sandboxed `<iframe>` (or Electron `BrowserView`) with a `MessageChannel` connection to the renderer. The iframe has no access to the parent DOM or Zustand stores directly.

Build Level 1 in Phase Plugin (between Phase 3 and Phase 4). The architecture you lay in Phase 0 supports upgrading to Level 2/3 without breaking the plugin API — only the host changes.

---

## Updated Phase Plan

### New: Phase 0 Additions

**Step 0.6 — Design Tokens + Radix UI**

Create `src/renderer/styles/tokens.css` with the full token set. Import it in `index.tsx`. Install Radix primitives. Create a `<Button>` and `<Tooltip>` component using tokens to validate the system.

PR scope: App renders with tokens applied. `<Button>` has correct hover/active states from CSS variables. No hardcoded color values anywhere.

**Step 0.7 — Plugin types + `pluginData` schema slot**

Add `src/shared/plugin.types.ts` with `IPluginContext`, `PluginManifest`, `AudioProcessSpec`, and `AllContributions`. Add `pluginData` field to `ProjectFileSchema`. Add `plugins` namespace to `IElectronAPI` (stubbed — all methods return empty/void for now).

PR scope: Types compile. A sample plugin manifest passes Zod validation. `pluginData` field in a project JSON loads without error.

**Step 0.8 — `<PluginPanelSlot>` + `plugin.store`**

Add the empty Zustand `plugin.store` and `<PluginPanelSlot>` component. Place the slot in `App.tsx`. With no plugins loaded, it renders nothing.

PR scope: App renders identically to before. `<PluginPanelSlot>` is present in the DOM but empty.

### New: Phase Plugin (between Phase 3 and Phase 4)

**Step P.1 — `RenderPipeline` refactor**

Extract the FFmpeg export logic from `renderer.ts` into named `PipelineStage` classes. `RenderPipeline` executes them sequentially. Existing behavior is identical — this is a refactor, not a new feature.

PR scope: Export produces byte-identical output to before the refactor. Unit tests for each stage with a short test audio clip.

**Step P.2 — `PluginHost` + manifest loading**

Implement `PluginHost` with plugin discovery from `~/.podcut/plugins/`, manifest validation, and `require()`-based loading. Register `plugins.ipc.ts` handlers. The renderer calls `getContributions()` on startup.

PR scope: Place a minimal plugin (just a `plugin.json` + empty `index.js`) in the plugins directory. It loads without error. `getContributions()` returns its manifest data.

**Step P.3 — `createContext()` + project/storage API**

Implement `context-factory.ts` to produce a scoped `IPluginContext` per plugin. Wire `project.getProject()`, `project.addEdits()`, `project.getPluginData()` to the real `ProjectStore`. Wire `storage.get/set/getStoragePath()` to a plugin-specific directory under `app.getPath('userData')`.

PR scope: A test plugin calls `ctx.project.addEdits([...])` on activation. The edit appears in the Zustand store. `ctx.storage.set('key', 'value')` persists a JSON file to disk.

**Step P.4 — `audioProcessors` contribution point**

Wire `plugin-bridge.ts` to insert a plugin's `audioProcessor` into `RenderPipeline` at the declared hook position (`pre-export`/`post-export`). The plugin implements an `AudioProcessSpec` — the host executes it via FFmpeg (the plugin never calls FFmpeg directly).

PR scope: A test plugin registers an `audioProcessor` that applies a `highpass=f=80` filter. Export a clip, confirm the filter was applied via FFprobe analysis of the output.

**Step P.5 — Command Palette + plugin commands**

Install `cmdk`. Build `<CommandPalette>` triggered by `Cmd+K`. Core commands (Open File, Export, Undo, Redo, Mute All Fillers) register at startup. Plugin commands from `getContributions()` are added to the palette dynamically.

PR scope: `Cmd+K` opens palette. All core commands work. A test plugin's command appears and executes.

**Step P.6 — First real first-party plugin**

Build the filler-word detector as a proper plugin (rather than baked into the core), located in `plugins/filler-detector/`. It contributes: one command ("Detect Filler Words"), one panel (the filler review list), and one editDetector function.

This is the proof of the architecture: a feature that previously lived in the core now lives in a plugin that uses only the public `IPluginContext` API.

PR scope: Remove filler detection from the core. Install the plugin. All existing filler detection tests pass.

---

## Summary: What Changes from the Original Roadmap

| Original Decision | Updated Decision | Reason |
|---|---|---|
| `renderProject()` monolithic function | `RenderPipeline` with `PipelineStage[]` | Plugins need to insert processing stages |
| `ProjectFileSchema` with fixed fields | Add `pluginData: Record<string, unknown>` from Phase 0 | Plugins need project-scoped storage |
| `IElectronAPI` for core only | Add `plugins` namespace from Phase 0 (stubbed) | Plugin API is stable from day one |
| Fixed flex layout | Add `<PluginPanelSlot>` from Phase 1 | Plugin panels need mount points |
| Filler detection in core | Move to first-party plugin in Phase Plugin | Validates the plugin architecture |
| No styling system | Design tokens (`tokens.css`) + Radix UI from Phase 0 | Plugins inherit visual language; a11y for free |
| `shared/project.types.ts` | Add `plugin.types.ts` alongside | Plugin contracts need their own type surface |

### What Does NOT Change

The audio engine, FFmpeg render logic, whisper.cpp N-API integration, Zustand stores, and IPC patterns from the original roadmap are all unchanged. The plugin system is additive — it gives plugins controlled access to these systems through a facade, without changing how the core uses them.

---

## One Sentence Per Decision

- **Minimalism**: One accent color, design tokens as CSS variables, Radix UI for accessibility, `cmdk` for keyboard-first navigation.
- **Plugins**: Manifest-declared contribution points, `IPluginContext` as the API surface, `RenderPipeline` for audio hooks, `pluginData` for project storage, `<PluginPanelSlot>` for UI, Node.js modules in main process for v1 trust model.
- **Migration risk**: The plugin architecture must be stubbed in Phase 0 — `pluginData` in schema, `IPluginContext` types, empty `PluginPanelSlot`. The full implementation comes in Phase Plugin. The cost of doing it this way is 2 hours in Phase 0. The cost of retrofitting it later is 2 weeks.
