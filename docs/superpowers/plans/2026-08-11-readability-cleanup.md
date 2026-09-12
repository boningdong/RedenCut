# Readability Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a green verification baseline, enforce the approved repository rules, apply isolated mechanical formatting, and remove only code and dependencies proven unused by the current RiffCut implementation.

**Architecture:** This is package 1 of the umbrella readability-refactor design. Work proceeds through independently reviewable gates: baseline repair, tooling, formatting, lint remediation, test-layout consolidation, evidence-backed dead-code cleanup, and final verification. Structural decomposition of the timeline, App, transcript, waveform, and playback subsystems is reserved for later packages.

**Tech Stack:** Electron 40, React 19, TypeScript 5.9, electron-vite 5, Vitest 4, Zustand 5, Zod 4, ESLint flat config, typescript-eslint, eslint-plugin-react-hooks, Prettier, and Knip.

## Global Constraints

- Preserve all observable behavior, including `WebCodecsPlayer` with `SimpleAudioPlayer` fallback and legacy project migration.
- Preserve Electron main, preload, and renderer boundaries and route renderer-to-main calls through `window.electronAPI`.
- Preserve the non-destructive edit model, current schemas, supported audio behavior, and user-facing workflows.
- Run `npm run build` after every non-trivial change.
- Apply formatting as a separate mechanical task from semantic cleanup.
- Delete a candidate only after static analysis, repository reference tracing, dynamic-entry review, and relevant verification support the deletion.
- Use one coherent responsibility per function, class, and module; keep one primary class per file.
- Use descriptive names and avoid unexplained abbreviations.
- Use section comments only as signposts for methods with several distinct, non-obvious stages.
- Comment fields only when name and type do not explain their semantics, lifecycle, units, ownership, or valid states.
- Do not modify the user's untracked `AGENTS.md` or `docs/architecture/` files.

## Current Baseline

The baseline was measured on 2026-08-11 at commit `81bd5af`:

- `npm run build`: passes.
- `npm run typecheck`: fails because `tsconfig.node.json` uses legacy Node module resolution for ESM-exported build plugins, `ProjectFileSchema` uses Zod 3 default semantics under Zod 4, and `Button.tsx` uses an Electron CSS property absent from `React.CSSProperties`.
- `npm test`: 109 tests pass and 4 tests fail. The failures expect removed or unreferenced audio sources to fall back to full-source playback, but commit `beb1332` intentionally changed `buildSegmentsForSource` to return no segments and prevent ghost audio.

## Authoritative References

- Design: `docs/superpowers/specs/2026-08-10-readability-refactor-design.md`
- TypeScript module resolution: <https://www.typescriptlang.org/tsconfig/moduleResolution>
- electron-vite TypeScript types: <https://electron-vite.org/guide/typescript>
- Zod 4 prefault semantics: <https://zod.dev/v4/changelog#default-updates>
- ESLint flat configuration: <https://eslint.org/docs/latest/use/configure/configuration-files>
- typescript-eslint setup: <https://typescript-eslint.io/getting-started/>
- React Hooks linting: <https://react.dev/reference/eslint-plugin-react-hooks>
- Prettier installation and checks: <https://prettier.io/docs/install.html>
- Knip project and entry configuration: <https://knip.dev/guides/configuring-project-files>

---

### Task 1: Restore a Green Pre-Tooling Baseline

**Files:**

- Create: `src/shared/project.types.test.ts`
- Modify: `src/shared/project.types.ts`
- Modify: `src/renderer/src/audio/__tests__/buildSegments.test.ts`
- Modify: `src/renderer/src/components/ui/Button.tsx`
- Modify: `tsconfig.node.json`
- Modify: `electron.vite.config.ts`

**Interfaces:**

- Consumes: `ProjectFileSchema.parse(input)` and `buildSegmentsForSource(sourceId, startTime, tracks, seekFn, sourceDuration, fetchChunkSize)`.
- Produces: a green existing verification baseline; no new production API.

- [ ] **Step 1: Add a regression test for nested export defaults**

Create `src/shared/project.types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ProjectFileSchema } from './project.types'

describe('ProjectFileSchema', () => {
  it('applies nested export defaults when export settings are omitted', () => {
    const project = ProjectFileSchema.parse({
      version: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      source: {
        file: 'episode.wav',
        sampleRate: 48_000,
        channels: 2,
        durationSeconds: 60,
      },
    })

    expect(project.export).toEqual({
      targetLUFS: -16,
      truePeakDbTP: -1.5,
      format: 'mp3',
      sampleRate: 48_000,
    })
  })
})
```

- [ ] **Step 2: Run the schema regression test and verify the current behavior is wrong**

Run: `npm test -- src/shared/project.types.test.ts`

Expected: FAIL because Zod 4 `.default({})` returns the empty object without parsing the nested field defaults.

- [ ] **Step 3: Restore the intended Zod 3-compatible behavior under Zod 4**

In `ProjectFileSchema`, replace:

```ts
export: ExportSettingsSchema.default({}),
```

with:

```ts
export: ExportSettingsSchema.prefault({}),
```

Run: `npm test -- src/shared/project.types.test.ts`

Expected: PASS.

- [ ] **Step 4: Align stale segment tests with the ghost-audio behavior**

In `src/renderer/src/audio/__tests__/buildSegments.test.ts`:

- Replace the three tests under `fallback: no tracks defined` with one test named `returns no segments when no clip references the source` that asserts `buildSegmentsForSource(SOURCE_A, 0, [], mockSeek, DURATION, FETCH)` equals `[]`.
- Rename `falls back to full-source if no clips match sourceId` to `returns no segments if no clips match sourceId` and assert the result equals `[]`.
- In `skips the segment when startTime is past the clip end`, assert that the returned segment is muted and has `durationSecs === 0`; remove the stale full-source comment.
- In `excludes clips from muted tracks`, assert that the returned segment is muted; replace the stale fallback comment with wording that the source contributes silence.
- Update the file-level coverage comment from full-source fallback to orphan-source suppression.

Run: `npm test -- src/renderer/src/audio/__tests__/buildSegments.test.ts`

Expected: PASS.

- [ ] **Step 5: Correct Node-side module resolution for modern package exports**

In `tsconfig.node.json`:

- Set `module` to `NodeNext`.
- Set `moduleResolution` to `NodeNext`.
- Add `"types": ["electron-vite/node"]`.
- Replace the specific `electron.vite.config.*` include with `*.config.ts` so both Electron Vite and Vitest configuration files belong to the Node-side TypeScript project.
- Update comments so they explain that NodeNext models modern Node package exports while `package.json` keeps `.ts` files in CommonJS mode; electron-vite still owns emitted bundles.

In `electron.vite.config.ts`, call the current Tailwind Vite plugin with its required options object:

```ts
plugins: [react(), tailwindcss({})],
```

- [ ] **Step 6: Type the Electron-specific CSS property explicitly**

In `Button.tsx`, add a local style type and remove the ineffective `as string` cast:

```ts
type ElectronCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag'
}
```

Declare `base` as `ElectronCSSProperties`. Do not change the rendered styles.

- [ ] **Step 7: Verify the restored baseline**

Run separately:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all three commands exit 0.

- [ ] **Step 8: Commit the baseline repair**

```bash
git add src/shared/project.types.test.ts src/shared/project.types.ts src/renderer/src/audio/__tests__/buildSegments.test.ts src/renderer/src/components/ui/Button.tsx tsconfig.node.json electron.vite.config.ts
git commit -m "test: restore green refactor baseline"
```

---

### Task 2: Add Formatting, Linting, Dead-Code Analysis, and Coding Standards

**Files:**

- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `eslint.config.mjs`
- Create: `knip.jsonc`
- Create: `docs/coding-standards.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: the source boundaries defined by `tsconfig.node.json` and `tsconfig.web.json`.
- Produces: `npm run format`, `format:check`, `lint`, `deadcode`, and `check` commands used by all later tasks.

- [ ] **Step 1: Install exact local tool versions**

Run:

```bash
npm install --save-dev --save-exact eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-config-prettier globals prettier knip
```

Expected: `package.json` and `package-lock.json` record exact installed versions; no global tools are required.

- [ ] **Step 2: Add the approved Prettier configuration**

Create `.prettierrc.json`:

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `.prettierignore`:

```text
node_modules/
out/
dist/
dist-electron/
coverage/
docs/architecture/
*.html
*.peaks.json
```

The npm formatting scripts added below target application source and root configuration files explicitly, so unrelated untracked Markdown such as `AGENTS.md` is not formatted.

- [ ] **Step 3: Add a typed ESLint flat configuration**

Create `eslint.config.mjs`:

```js
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { builtinModules } from 'node:module'
import tseslint from 'typescript-eslint'

const nodeImports = [...new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])]
const restrictedNodeImports = nodeImports.map((name) => ({
  name,
  message: 'Renderer and shared code cannot import Node.js modules.',
}))

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'dist-electron/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Renderer code must use window.electronAPI.' },
            ...restrictedNodeImports,
          ],
          patterns: [
            {
              group: ['@main/*', '@preload/*', '**/main/**', '**/preload/**'],
              message: 'Renderer code cannot import main or preload internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@renderer/*', '**/renderer/**', '**/preload/**'],
              message: 'Main code cannot import renderer or preload internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main/*', '@renderer/*', '**/main/**', '**/renderer/**'],
              message: 'Preload code must remain a narrow bridge over shared contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Shared code must remain process-neutral.' },
            ...restrictedNodeImports,
          ],
          patterns: [
            {
              group: ['@main/*', '@preload/*', '@renderer/*', '**/main/**', '**/preload/**', '**/renderer/**'],
              message: 'Shared code cannot import process-specific modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  prettier,
)
```

If the installed package version exposes a renamed documented flat-config export, adjust only the corresponding import/config composition to the installed package's official API; preserve the rules and file boundaries above.

- [ ] **Step 4: Configure Knip around real application entries**

Create `knip.jsonc`:

```jsonc
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": [
    "src/main/index.ts",
    "src/preload/index.ts",
    "src/renderer/src/main.tsx",
    "electron.vite.config.ts",
    "vitest.config.ts"
  ],
  "project": ["src/**/*.{ts,tsx}", "*.config.ts"],
  "ignoreDependencies": [
    // Loaded by package name at runtime in src/main/audio/binaries.ts.
    "ffmpeg-static",
    "ffprobe-static"
  ]
}
```

Do not add source files to `entry` merely to hide unused-file findings. Resolve configuration hints before suppressing findings.

- [ ] **Step 5: Add repository commands**

Add these scripts to `package.json` while preserving the existing commands:

```json
{
  "format": "prettier --write \"src/**/*.{ts,tsx,css,json}\" \"*.{ts,mjs,json}\" .prettierrc.json",
  "format:check": "prettier --check \"src/**/*.{ts,tsx,css,json}\" \"*.{ts,mjs,json}\" .prettierrc.json",
  "lint": "eslint \"src/**/*.{ts,tsx}\" \"*.config.ts\"",
  "deadcode": "knip",
  "check": "npm run format:check && npm run lint && npm run deadcode && npm run typecheck && npm test && npm run build"
}
```

- [ ] **Step 6: Document the repository coding standard**

Create `docs/coding-standards.md` with these sections and approved rules:

```markdown
# RiffCut Coding Standards

## Responsibility

- Each function performs one coherent operation at one abstraction level.
- Each class represents one clear responsibility.
- Each module has one named responsibility.
- Each file contains one primary class; supporting private types and helpers may remain when they serve only that class.
- Split large units by responsibility, not by arbitrary line counts.

## Naming

- Use descriptive names that communicate domain intent.
- Avoid unexplained abbreviations.
- Use short conventional names only when their meaning is obvious in context.

## Comments

- Explain constraints, decisions, lifecycle details, and non-obvious meaning.
- Use section comments only as signposts for methods with several distinct, non-obvious stages.
- Do not add section comments to methods whose flow is already obvious.
- Comment fields only when name and type do not explain semantics, lifecycle, units, ownership, or valid states.
- Remove narration, historical notes, and inaccurate comments.

## Process Boundaries

- Main owns Node.js and operating-system access.
- Preload is a narrow contextBridge adapter.
- Renderer uses browser APIs and window.electronAPI only.
- Cross-process contracts belong in src/shared.

## Verification

- Run npm run format before review.
- Run npm run check before declaring a change complete.
- Explain every lint or Knip exception beside its narrow configuration or suppression.
```

Do not add unrelated example domains. Add a RiffCut example only when a real repository case materially clarifies a rule.

- [ ] **Step 7: Verify that each tool executes and reports the current repository honestly**

Run separately:

```bash
npm run format:check
npm run lint
npm run deadcode
npm run typecheck
npm test
npm run build
```

Expected:

- `format:check`, `lint`, and `deadcode` may exit nonzero and list existing work for Tasks 3, 4, and 6.
- `typecheck`, `test`, and `build` exit 0.
- Knip emits no unresolved configuration hints. Fix entry/project configuration if it does.

- [ ] **Step 8: Commit the tooling and standards**

```bash
git add .prettierrc.json .prettierignore eslint.config.mjs knip.jsonc docs/coding-standards.md package.json package-lock.json
git commit -m "chore: add repository quality checks"
```

---

### Task 3: Apply the Mechanical Formatting Baseline

**Files:**

- Modify: all tracked `src/**/*.{ts,tsx,css,json}` files selected by the `format` script.
- Modify: root `*.{ts,mjs,json}` configuration and manifest files selected by the `format` script.

**Interfaces:**

- Consumes: `.prettierrc.json` and `.prettierignore` from Task 2.
- Produces: a formatting-only baseline on which later semantic diffs remain reviewable.

- [ ] **Step 1: Capture the pre-format worktree**

Run: `git status --short`

Expected: only the user's pre-existing untracked `AGENTS.md` and `docs/architecture/` entries appear. Stop if unrelated tracked changes are present.

- [ ] **Step 2: Apply formatting**

Run: `npm run format`

Expected: Prettier rewrites selected tracked source and configuration files without touching `AGENTS.md`, `docs/architecture/`, generated output, or dependencies.

- [ ] **Step 3: Review the diff as mechanical-only**

Run separately:

```bash
git diff --stat
git diff --check
git diff -- src
```

Review every non-whitespace-looking change. Revert and investigate any edit that changes an identifier, literal value, control flow, import target, or runtime data.

- [ ] **Step 4: Verify formatting did not change behavior**

Run separately:

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit formatting by itself**

```bash
git add src electron.vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json package.json package-lock.json eslint.config.mjs knip.jsonc .prettierrc.json
git commit -m "style: apply repository formatting"
```

---

### Task 4: Resolve ESLint Findings Without Changing Behavior

**Files:**

- Modify: files reported by `npm run lint`.
- Expected log cleanup: `src/main/ipc/render.ipc.ts`
- Expected log cleanup: `src/renderer/src/App.tsx`
- Expected log cleanup: `src/renderer/src/hooks/useKeyboardShortcuts.ts`
- Expected log cleanup: `src/renderer/src/stores/timeline.store.ts`
- Expected log cleanup: `src/renderer/src/audio/FrameIndex.ts`
- Expected log cleanup: `src/renderer/src/audio/SimpleAudioPlayer.ts`
- Expected log cleanup: `src/renderer/src/audio/WebCodecsPlayer.ts`
- Expected log cleanup: `src/renderer/src/components/Waveform/WaveformView.tsx`
- Expected suppression cleanup: `src/main/audio/binaries.ts`

**Interfaces:**

- Consumes: `npm run lint` and the process-specific rules from Task 2.
- Produces: a zero-finding ESLint run with no broad or unexplained suppression.

- [ ] **Step 1: Capture the complete lint report**

Run: `npm run lint`

Expected: nonzero if existing violations remain. Work from the complete report rather than fixing only the first file.

- [ ] **Step 2: Apply safe ESLint fixes**

Run: `npm run lint -- --fix`

Expected: type-only imports and other syntax-preserving findings are fixed automatically. Review the entire diff before continuing.

- [ ] **Step 3: Remove routine debug logging**

Remove `console.log`, `console.group`, and `console.groupEnd` calls reported by ESLint. Preserve `console.warn` for degraded fallback behavior and `console.error` for actionable failures. Do not replace removed logs with an abstraction in this package.

When a log occupies a multi-line statement, remove the complete call and leave surrounding control flow unchanged.

- [ ] **Step 4: Resolve promise findings explicitly**

For each `no-floating-promises` or `no-misused-promises` finding:

- `await` work that must complete before the containing action finishes.
- Prefix deliberately detached work with `void` only when the callee already owns error reporting or the caller intentionally cannot wait.
- Add `.catch((error) => console.error(...))` when detached work can reject without another owner.
- Do not use a rule suppression to hide an unhandled rejection.

- [ ] **Step 5: Resolve Hooks findings without broad suppression**

- Remove the obsolete `eslint-disable-line react-hooks/exhaustive-deps` after `loadAudio` in `App.tsx` if the approved dependency list already passes.
- Preserve the intentional primary-peak synchronization semantics in `WaveformView.tsx`: the effect must react to `peaks`, must not stamp old peaks onto a newly added first track, and must retain a concise local explanation if a narrow `exhaustive-deps` suppression remains necessary.
- Run the waveform-related tests and production build after any Hook dependency change.

- [ ] **Step 6: Remove obsolete suppressions and fix remaining unused symbols**

- Remove the `no-var-requires` suppression in `src/main/audio/binaries.ts` if the configured rules do not prohibit its dynamic runtime `require(packageName)`.
- Remove imports, locals, parameters, and private declarations reported unused only after confirming they have no side effects.
- Keep underscore-prefixed callback parameters when the external callback signature requires their position.
- Do not remove exported declarations solely from ESLint output; Task 6 handles repository-level export reachability.

- [ ] **Step 7: Verify lint remediation**

Run separately:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit lint remediation**

Stage only files changed for lint findings, then run `git diff --cached --check`.

```bash
git commit -m "refactor: resolve repository lint findings"
```

---

### Task 5: Consolidate Tests into the Colocated Convention

**Files:**

- Modify: `src/renderer/src/stores/timeline.store.test.ts`
- Delete: `src/renderer/src/stores/__tests__/timeline.store.test.ts`
- Create: `src/renderer/src/stores/transcript.store.test.ts`
- Delete: `src/renderer/src/stores/__tests__/transcript.store.test.ts`
- Delete: `src/renderer/src/__tests__/transcript.store.test.ts`
- Create: `src/renderer/src/utils/wordOutputTime.test.ts`
- Delete: `src/renderer/src/__tests__/wordOutputTime.test.ts`
- Create: `src/renderer/src/audio/buildSegments.test.ts`
- Delete: `src/renderer/src/audio/__tests__/buildSegments.test.ts`

**Interfaces:**

- Consumes: all existing Vitest `describe` blocks and the behavior-corrected segment suite from Task 1.
- Produces: one `*.test.ts` file beside each tested module, with every unique assertion preserved.

- [ ] **Step 1: Merge timeline-store coverage into the colocated target**

Use `src/renderer/src/stores/__tests__/timeline.store.test.ts` as the comprehensive base content for `src/renderer/src/stores/timeline.store.test.ts`. Add these unique suites from the existing shorter colocated file:

- `addSourceFile`
- `splitAt — after moveClip`
- `addSourceFile — same path, different duration`

Reuse the comprehensive suite's `resetAll`, `tl`, and clip helpers instead of duplicating helpers. Delete `src/renderer/src/stores/__tests__/timeline.store.test.ts` only after the merged target passes.

- [ ] **Step 2: Merge transcript-store coverage into one colocated target**

Create `src/renderer/src/stores/transcript.store.test.ts` from the comprehensive `stores/__tests__` suite. Add these unique suites from `src/renderer/src/__tests__/transcript.store.test.ts`:

- `toggleTrackVisibility`
- `ensureTrackVisible`
- `removeWordsForTrack`

Reuse the target's reset and word helpers. Delete both source transcript test files only after the merged target passes.

- [ ] **Step 3: Move utility and audio tests beside their modules**

- Move the complete `getWordOutputTime` suite to `src/renderer/src/utils/wordOutputTime.test.ts` and update its imports from `../utils/...` to `./...`.
- Move the complete `buildSegmentsForSource` suite to `src/renderer/src/audio/buildSegments.test.ts` and update its imports from `../...` to `./...`.
- Delete the two old `__tests__` copies after the new paths pass.

- [ ] **Step 4: Verify no suite or test name was lost**

Before deletion, capture suite names with:

```bash
rg "describe\(" src/renderer/src/__tests__ src/renderer/src/stores/__tests__ src/renderer/src/stores src/renderer/src/audio/__tests__ src/renderer/src/utils
```

After consolidation, run:

```bash
rg "describe\(" src/renderer/src/stores src/renderer/src/audio src/renderer/src/utils
```

Confirm that every unique suite listed in the pre-consolidation output appears once in the post-consolidation output.

- [ ] **Step 5: Run the consolidated tests and full verification**

Run separately:

```bash
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
```

Expected: all commands exit 0; Vitest discovers no test under a repository-level `__tests__` directory.

- [ ] **Step 6: Commit test consolidation**

```bash
git add src/renderer/src/stores src/renderer/src/audio src/renderer/src/utils
git commit -m "test: colocate renderer unit tests"
```

---

### Task 6: Remove Confirmed Dead Code, Exports, Dependencies, and Style Tokens

**Files:**

- Create: `docs/readability-cleanup-audit.md`
- Modify: files named by confirmed Knip findings.
- Modify: `src/shared/constants.ts`
- Modify: `src/shared/project.types.ts`
- Modify: `src/main/audio/importer.ts`
- Modify: `src/renderer/src/audio/WebCodecsPlayer.ts`
- Modify: `src/renderer/src/audio/FrameIndex.ts`
- Modify: `src/renderer/src/styles/globals.css`
- Modify: `src/renderer/src/themes/dark.json`
- Modify: `src/renderer/src/themes/light.json`
- Modify: `knip.jsonc`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: a clean ESLint graph, Knip's repository graph, `rg` reference evidence, package history, and the current runtime entry points.
- Produces: a zero-finding Knip run or narrow documented dynamic exceptions; no observable behavior change.

- [ ] **Step 1: Capture Knip findings and configuration hints**

Run separately:

```bash
npm run deadcode
npx knip --files
npx knip --dependencies
```

Create `docs/readability-cleanup-audit.md` with one row per finding using these columns:

```markdown
| Candidate | Finding type | Reference evidence | Dynamic-entry check | Decision |
| --- | --- | --- | --- | --- |
```

Populate each row with the exact `rg`, import-chain, package-history, or runtime-registration evidence used to remove or retain the candidate. Do not use “appears unused” as evidence.

- [ ] **Step 2: Remove the already confirmed unused exports and helper**

After rerunning `rg` for each name, remove:

- `APP_FILE_MIME` from `src/shared/constants.ts`.
- The unused `formatDuration` helper and its stale renderer-sharing comment from `src/main/audio/importer.ts`.
- The redundant `export type { Segment }` re-export from `src/renderer/src/audio/WebCodecsPlayer.ts`; keep the direct import from `buildSegments.ts` used internally.
- Unused derived type aliases reported by Knip in `src/shared/project.types.ts` only when the corresponding type name has no consumer. Keep every Zod schema used by `ProjectFileSchema` and preserve runtime parsing behavior.

Record the exact search evidence and decision for each item in the audit.

- [ ] **Step 3: Remove the unreachable MP4Box branch while preserving current M4A behavior**

Confirm all of the following before editing:

```bash
rg -n "mp4box|MP4Box" src package.json
rg -n "<script" src/renderer/index.html
```

The current renderer does not import `mp4box` or load an MP4Box script, so `window.MP4Box` is always absent and `buildM4aIndex` always delegates to the uniform AAC index.

Replace the unreachable global-MP4Box parsing branch in `buildM4aIndex` with the current fallback behavior:

```ts
async function buildM4aIndex(url: string): Promise<FrameIndex> {
  return buildUniformIndex(url, 'aac', 1024)
}
```

Remove `mp4box` from dependencies with:

```bash
npm uninstall mp4box
```

Update the `FrameIndex.ts` file header so it describes the uniform M4A/AAC index rather than nonexistent MP4Box parsing.

- [ ] **Step 4: Audit the explicit Rollup platform package**

Use:

```bash
git log -S'@rollup/rollup-linux-arm64-gnu' --oneline -- package.json
npm explain @rollup/rollup-linux-arm64-gnu
```

The direct optional dependency was present in the initial project and has no source consumer. Remove it with `npm uninstall @rollup/rollup-linux-arm64-gnu` if `npm explain` confirms Rollup already owns its required platform package transitively. If the installed Rollup version requires the direct package for a supported build environment, retain it and document that concrete requirement in both the audit and a narrow Knip exception.

- [ ] **Step 5: Remove confirmed unused design tokens and selectors**

Rerun repository searches, then remove these keys from both theme JSON files when they still have no consumer outside the theme definitions:

- `color-bg-hover`
- `color-accent-hover`
- `color-success`
- `waveform-progress-color`
- `waveform-cursor-color`
- `waveform-region-muted`

Keep `waveform-color` and `waveform-color-muted`, which have current consumers.

From `globals.css`, remove these unreferenced static tokens:

- `--text-lg`
- `--space-1`
- `--space-5`
- `--space-6`

Remove `.selectable` only if no JSX `className` or DOM assignment uses it. Remove `.wavesurfer-region > div` only if no Regions plugin or generated region element is registered. Record the searches in the audit.

- [ ] **Step 6: Resolve every remaining Knip finding top-down**

Process unused files first, then unresolved imports, unused exports, and dependencies. For each finding:

1. Search the exact symbol, file, or package with `rg`.
2. Trace imports from the five configured entry points.
3. Check Electron registration, IPC channels, Vite/Vitest discovery, AudioWorklet string embedding, CSS strings, and runtime `require` before deletion.
4. Delete only when all checks show no consumer.
5. Add a Knip exception only for a demonstrated dynamic consumer, with a nearby JSONC comment naming that consumer.
6. Add the evidence and decision to the audit.

Keep `ffmpeg-static` and `ffprobe-static`: `src/main/audio/binaries.ts` loads them dynamically by package name as Apple Silicon fallbacks. Their documented `ignoreDependencies` entries are intentional.

- [ ] **Step 7: Verify the dead-code cleanup**

Run separately:

```bash
npm run deadcode
npm run lint
npm run format
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0. Review `package-lock.json` to confirm only intentionally removed packages and their now-unneeded transitive packages disappeared.

- [ ] **Step 8: Commit the evidence-backed cleanup**

Stage the audit and only the files justified by it. Run `git diff --cached --check` and inspect the staged dependency diff.

```bash
git commit -m "refactor: remove confirmed unused code"
```

---

### Task 7: Final Package-1 Verification and Handoff

**Files:**

- Modify: `docs/coding-standards.md` only if command names or narrow exceptions changed during implementation.
- Modify: `docs/readability-cleanup-audit.md` with final verification results.

**Interfaces:**

- Consumes: all package-1 commits and the complete `npm run check` command.
- Produces: a verified clean baseline for package 2, the timeline-domain and project-transformation refactor.

- [ ] **Step 1: Run the complete automated gate from a clean tracked worktree**

Run:

```bash
npm run check
```

Expected: formatting, linting, Knip, type-checking, tests, and production build all exit 0.

- [ ] **Step 2: Verify architecture imports independently**

Run:

```bash
rg -n "from ['\"](electron|node:|fs|path|child_process|@main/|@preload/)" src/renderer
rg -n "from ['\"](@renderer/|.*renderer/)" src/main src/preload
```

Expected: no renderer import bypasses `window.electronAPI`, and neither main nor preload imports renderer modules. Investigate every match rather than relying only on ESLint patterns.

- [ ] **Step 3: Perform the package-1 smoke test**

Run `npm run dev` and verify:

- The Electron window opens without a startup error.
- A supported audio file opens and generates a waveform.
- Playback starts, pauses, seeks, and stops at the end.
- Preview mode skips muted regions.
- Adding and removing a track does not produce ghost audio.
- Successful playback produces no routine debug logging; if an actionable fallback warning occurs, `SimpleAudioPlayer` plays the primary source.
- A current project saves and reopens.
- A legacy project still opens through migration.
- Transcript generation availability and export dialogs still reach their existing success or actionable error states.

Do not claim an item passed if the required media, legacy fixture, Whisper binary, or FFmpeg dependency is unavailable. Record the exact unverified item and reason.

- [ ] **Step 4: Record final evidence**

Append a `## Final Verification` section to `docs/readability-cleanup-audit.md` containing:

- The commit tested.
- Exit status for each command in `npm run check`.
- Pass, fail, or not-run status for each smoke-test item.
- Every remaining narrow Knip or ESLint exception and its runtime reason.

- [ ] **Step 5: Commit final documentation if it changed**

```bash
git add docs/coding-standards.md docs/readability-cleanup-audit.md
git commit -m "docs: record readability cleanup verification"
```

- [ ] **Step 6: Request review before package 2**

Present the outcome, automated verification, manual verification, removed candidates, retained exceptions, and remaining risks. Do not begin timeline-domain decomposition until package 1 is reviewed.
