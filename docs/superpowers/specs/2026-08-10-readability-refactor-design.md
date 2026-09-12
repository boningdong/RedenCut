# Behavior-Preserving Readability Refactor Design

**Date:** 2026-08-10

## 1. Goal and Scope

### Goal

Make the RedenCut repository easier for a human to read, navigate, and safely change while preserving all observable behavior.

### Inputs

- The current source, tests, build configuration, and documented architecture.
- Findings from TypeScript, ESLint, Prettier, Knip, and manual reference tracing.
- Characterization tests for important behavior that is not sufficiently covered.

### Outputs

- Consistently formatted code.
- Enforced correctness and readability rules.
- Confirmed unused code, exports, files, dependencies, styles, and configuration removed.
- Large modules decomposed into smaller units with explicit responsibilities.
- Updated developer documentation and verification commands.

### Behavioral Invariants

- Preserve `WebCodecsPlayer` with `SimpleAudioPlayer` fallback.
- Preserve legacy project migration.
- Preserve Electron main, preload, and renderer boundaries and IPC contracts.
- Preserve audio importing, waveform generation, playback, editing, transcript behavior, undo and redo, saving, and export.
- Preserve the non-destructive edit model and source files.
- Avoid public data-schema changes unless needed solely to express existing behavior.

### Out of Scope

- New product features or UI redesign.
- Changes to audio semantics or supported formats.
- Replacement of Zustand, Electron, WaveSurfer, or the playback architecture.
- Performance optimization unless required to prevent a refactor regression.
- Arbitrary line-count targets or abstraction for its own sake.

## 2. Repository Rules and Tooling

### Formatting

Prettier owns whitespace and presentation with these defaults:

- No semicolons.
- Single quotes.
- Trailing commas where supported.
- A 100-character print width.
- Consistent JSX, JSON, CSS, and TypeScript formatting.
- Generated output, dependencies, architecture HTML, and cache files excluded.

Formatting is applied as an isolated mechanical stage so later semantic diffs remain readable.

### ESLint Correctness Rules

ESLint enforces:

- No unused imports, variables, or parameters, with explicit allowances for intentional placeholders.
- Correct React Hooks dependencies and usage.
- Type-aware checks for unsafe or accidentally ignored promises.
- Consistent use of type-only imports.
- No debugging `console.log` calls in production code; `warn` and `error` remain permitted when operationally meaningful.
- No suppressed rules without a local explanation.

Existing violations are fixed before the checks become mandatory.

### Architectural Boundaries

Path-specific ESLint rules protect the three-process model:

- Renderer code cannot import Electron, Node built-ins, main-process modules, or preload internals.
- Preload remains a narrow bridge and cannot absorb application behavior.
- Main-process code cannot import renderer modules.
- Cross-process contracts continue through `src/shared` and `window.electronAPI`.

### Dead-Code Analysis

Knip checks:

- Unreferenced source files and exports.
- Unused dependencies and development dependencies.
- Unused package scripts.

Electron main and preload files, IPC registration, AudioWorklet code, tests, and Vite configuration are configured as dynamic entry points where required. Every Knip finding requires reference tracing before deletion.

### Human Readability Rules

#### Responsibility Boundaries

- Each function performs one coherent operation at one abstraction level.
- Each class represents one clear responsibility.
- Each module has one named responsibility.
- Each file contains one primary class. Supporting types or small private helpers may remain alongside it when they exist only to serve that class.
- Pure transformations are separated from stateful orchestration.
- Large units are split according to responsibilities, not arbitrary line-count limits.

#### Naming

- Use descriptive names that communicate domain intent.
- Avoid unexplained abbreviations.
- Prefer names describing purpose over implementation mechanics.
- Short conventional names are acceptable only when their meaning is obvious in context.

#### Comments

- Comments explain constraints, decisions, lifecycle details, and non-obvious meaning.
- Remove historical narration and comments that merely restate the code.
- Use section comments as signposts only when a method has several distinct, non-obvious stages.
- Section comments describe the purpose of each stage, not its syntax.
- Do not add section comments to short methods or stages whose flow is already obvious.
- Comment a field only when its name and type do not fully explain its semantics, lifecycle, units, ownership, or valid states.
- Update or remove comments when implementation changes make them inaccurate.
- Any examples added to coding standards must come from RedenCut and accurately represent its current code.

#### Abstraction Discipline

- Keep code within a function or section at a consistent abstraction level.
- Introduce shared abstractions only when multiple consumers represent the same stable concept.
- Prefer explicit dependencies and narrow interfaces.
- Avoid barrel files unless they define a genuine public module boundary.

### Commands

The repository exposes these checks:

- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run deadcode`
- Existing `npm run typecheck`, `npm test`, and `npm run build` commands.
- A combined `npm run check` command for normal verification.

## 3. Unused-Code Cleanup Pipeline

### Stage A: Capture the Baseline

- Run the existing type-check, tests, and production build.
- Record existing failures so they are not mistaken for refactor regressions.
- Identify critical behavior that lacks tests and add characterization coverage before modifying that area.

### Stage B: Introduce the Guardrails

Add Prettier, ESLint, and Knip configurations and package scripts. Prettier establishes the canonical format, ESLint reports the agreed correctness and boundary violations, and Knip reports dead-code candidates.

The repository does not silence broad categories merely to obtain a passing result. Necessary exceptions are narrow and explained.

### Stage C: Isolate Mechanical Formatting

Apply Prettier separately from semantic cleanup. This stage changes presentation only. Generated artifacts and excluded documentation remain untouched. The build and tests must pass before proceeding.

### Stage D: Remove Confirmed Unused Code

Process candidates by category:

1. Local symbols: unused imports, variables, parameters, private methods, and types.
2. Public surface: unreferenced exports and store actions.
3. Files: unreferenced components, utilities, tests, and obsolete implementations.
4. Dependencies: unused runtime packages, development packages, and scripts.
5. Presentation: unused CSS selectors and theme tokens.
6. Residue: stale comments, obsolete suppressions, and nonessential debug logging.
7. Duplication: overlapping tests or helpers whose behavior is already covered elsewhere.

A candidate is deleted only when:

- Static analysis identifies it.
- Repository reference tracing finds no consumer.
- It is not a dynamic Electron, IPC, worklet, test, build, or CSS entry point.
- Relevant verification passes after removal.

`SimpleAudioPlayer`, legacy-project migration, and other reachable fallback paths are active code rather than deletion candidates.

### Stage E: Make Enforcement Mandatory

Once existing findings are resolved, formatting, linting, dead-code analysis, type-checking, tests, and build become the repository's standard verification suite. New exceptions require a local explanation, and Knip configuration remains conservative around dynamic behavior.

## 4. Structural Decomposition

The decomposition preserves current public interfaces and proceeds from lower-risk pure logic toward higher-risk playback code.

### Timeline Domain

`timeline.store.ts` remains the Zustand-facing state boundary. Focused modules own:

- Clip splitting, muting, merging, and movement calculations.
- Track and source lookup and overlap calculations.
- Undo and redo history construction and restoration.
- Timeline state types internal to the renderer.

The store coordinates state transitions; pure modules calculate them. Existing timeline tests are retained and reorganized around those responsibilities.

### Application Orchestration

`App.tsx` becomes the application shell rather than the owner of every workflow. Focused units own:

- Player creation and WebCodecs-to-Simple fallback.
- Audio-session lifecycle and store subscriptions.
- Project loading and legacy migration.
- Project snapshot construction and persistence.
- Transcript-generation orchestration.
- Resizable-panel interaction.
- Loading, error, and empty-state presentation.

Pure project conversion logic is separated from Electron calls. `App` composes these units and renders the main layout.

### Waveform and Timeline UI

`WaveformView.tsx` is decomposed by responsibility into:

- Timeline zoom and viewport behavior.
- Preview-mode playback synchronization.
- Clip-drag calculations and pointer lifecycle.
- Per-track peak loading.
- Track lane and gap rendering.
- Timeline ruler.
- Track waveform.
- Clip waveform.

Pure coordinate and snapping calculations are tested independently from React pointer events.

### Transcript UI

`TranscriptPanel.tsx` retains panel composition while focused units handle:

- Playhead-to-current-word calculation.
- Native browser selection mapped to transcript words.
- Word deletion mapped to timeline mute operations.
- Track visibility controls.
- Transcript word rendering.
- Empty and generating states.

Existing transcript utilities are reused rather than duplicated.

### Playback Engine

`WebCodecsPlayer` remains the `IAudioPlayer` implementation and external facade. Extraction begins with low-risk responsibilities:

- WAV metadata parsing.
- Codec configuration.
- Source-entry creation and lifecycle.
- AudioContext and worklet setup.
- Decode-range operations and PCM conversion.
- Playback clock and event subscriptions where separation remains behaviorally safe.

Each extracted class is the primary class in its own file. Pure functions are preferred where state is unnecessary.

`SimpleAudioPlayer` remains a separate fallback implementation. Shared behavior moves behind small helpers only when both players genuinely perform the same operation.

### Test Organization

Tests use one consistent colocated `*.test.ts` or `*.test.tsx` convention. Apparent duplicates are compared individually; coverage is merged before any duplicate file is removed.

### Order of Work

1. Pure timeline and project transformations.
2. App orchestration.
3. Transcript components and hooks.
4. Waveform components, hooks, and calculations.
5. WebCodecs internals.
6. SimpleAudioPlayer cleanup.
7. Final repository-wide dead-code and boundary audit.

### Implementation Packaging

This design is the umbrella specification for the refactor program. The work is delivered through independently reviewable implementation plans rather than one repository-wide change:

1. Baseline, tooling, mechanical formatting, and confirmed unused-code cleanup.
2. Timeline domain and project transformations.
3. Application orchestration.
4. Transcript UI.
5. Waveform and timeline UI.
6. Playback engine and `SimpleAudioPlayer` cleanup.
7. Final repository-wide audit and documentation.

The first implementation plan covers package 1 only. Before each later package begins, its concrete file boundaries and characterization tests are checked against the code left by the preceding work. If a later package introduces design choices not settled by this document, it receives a focused design addendum and user approval before implementation.

## 5. Contracts, Errors, and Verification

### Contract Preservation

- `window.electronAPI` remains the renderer's only route to the main process.
- Shared IPC types and Zod schemas remain authoritative.
- UI code continues to depend on `IAudioPlayer`, not concrete playback classes.
- Zustand stores remain the renderer's state boundaries.
- Source audio remains immutable; edits remain timeline data.
- Existing saved-project structures continue loading, including legacy migration.

Internal APIs may change only after all consumers are identified and updated together.

### Error Behavior

- Preserve existing user-visible error states and actionable messages.
- Preserve WebCodecs-to-SimpleAudioPlayer fallback on any player initialization failure.
- Do not replace specific failures with broad silent catches.
- Keep operational `console.warn` and `console.error` calls when they explain degraded behavior or failure.
- Remove routine debug logging or place it behind a deliberate development-only logging boundary.
- Include useful context in errors without exposing unnecessary file or system details.

### Test Strategy

- Pure functions receive focused unit tests for inputs, outputs, and edge cases.
- Zustand stores receive state-transition and undo and redo tests.
- React hooks and components receive interaction tests where extraction could change user behavior.
- The player factory receives tests proving WebCodecs preference and `SimpleAudioPlayer` fallback.
- Project conversion receives tests for current and legacy formats.
- Audio internals receive unit tests for parsing, mapping, scheduling calculations, and lifecycle transitions that can be tested without real hardware.
- Runtime audio behavior receives targeted manual smoke tests because browser codec and audio-device behavior cannot be fully established by Vitest.

Characterization tests are written before changing behaviorally dense code whose expectations are not already captured.

### Verification Gates

Before the new tools become mandatory, each stage must pass every check that is available and must not add findings beyond the recorded baseline. After Stage E, every substantive stage must pass the complete suite:

1. `npm run format:check`
2. `npm run lint`
3. `npm run deadcode`
4. `npm run typecheck`
5. `npm test`
6. `npm run build`

Playback-sensitive stages also require manual checks for:

- WebCodecs selection and successful playback.
- Forced or naturally occurring `SimpleAudioPlayer` fallback.
- Seek, pause, resume, and end-of-playback behavior.
- Preview skipping and muted regions.
- Multi-track loading, removal, volume, and synchronization.
- Opening current and legacy projects.
- Save, transcript, undo and redo, and export workflows affected by the stage.

### Completion Criteria

The refactor is complete when:

- All agreed automated checks pass.
- Every deletion has reference evidence.
- The major modules have clear responsibility boundaries.
- No known behavior regression remains.
- New rules and commands are documented.
- Remaining Knip exceptions are narrow and explained.
- Any behavior that could not be automated is listed with its manual verification result.

## 6. Risks and Controls

| Risk | Control |
| --- | --- |
| Mechanical formatting hides semantic edits | Apply formatting as its own stage before semantic changes. |
| Static analysis misclassifies dynamic code | Configure dynamic entries and manually trace every deletion candidate. |
| Structural extraction changes runtime behavior | Add characterization tests first and preserve public contracts. |
| Audio behavior passes unit tests but fails in Electron | Perform targeted manual playback checks after playback-sensitive stages. |
| New rules create unexplained suppressions | Require narrow, locally explained exceptions. |
| Refactoring introduces unnecessary abstractions | Extract only named responsibilities with clear consumers and dependencies. |
