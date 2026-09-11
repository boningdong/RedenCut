# Podcut Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent English and Simplified Chinese application localization without changing project or speech language semantics.

**Architecture:** Main owns the committed language preference and synchronizes revisioned snapshots through typed IPC. Shared resources feed independent translation instances; Zustand and a thin React hook drive renderer presentation.

**Tech Stack:** Electron, React, TypeScript, Zustand, Zod, i18next, Vitest, existing Docker MCP UI harness.

**Spec:** ../specs/2026-09-11-localization-design.md

## Global Constraints

- Locale is en | zh-CN; preference is system | en | zh-CN; fallback is en.
- Persist only app preferences under active userData after harness isolation.
- No project schema, audio processing, transcript content, or recognition-language changes.
- No additional application-state Context, remote translation loading, or editor remount on language change.
- Preserve session and job identity checks, error redaction, and keyboard behavior.
- Review the written spec before execution; use using-git-worktrees at execution time if isolation is needed.

## Task 1: Typed translation resources and language resolution

**Files:** Create src/shared/i18n/locale.types.ts, resolveLocale.ts, createTranslator.ts, locales/en.ts, locales/zh-CN.ts, and adjacent tests; modify package.json and package-lock.json.

**Interfaces:**
```ts
type Locale = 'en' | 'zh-CN'
type LocalePreference = 'system' | Locale
function resolveLocale(preference: LocalePreference, systemLanguages: string[]): Locale
// createTranslator(locale: Locale) returns an initialized independent i18next instance.
```

- [ ] Add i18next using the repository package manager and inspect its installed API/types before implementing the factory.
- [ ] Add failing resolution tests covering explicit selection, system priority, Simplified/Traditional script variants, and unknown language fallback.
```ts
expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN')
expect(resolveLocale('system', ['zh-Hans-SG', 'en'])).toBe('zh-CN')
expect(resolveLocale('system', ['zh-Hant-TW', 'en-GB'])).toBe('en')
expect(resolveLocale('system', ['fr-FR'])).toBe('en')
```
- [ ] Run `npx vitest run src/shared/i18n` and confirm the new behavior tests fail before implementation.
- [ ] Implement resolution, independent instances, bundled resources, English fallback, and typed keys; test interpolation with a filename containing angle brackets as ordinary data.
- [ ] Add resource shape/plural parity checks and an isolated incomplete-resource test proving English fallback without weakening production completeness checks.
- [ ] Run the focused tests and typecheck; review and commit the task.

## Task 2: Main-owned language preferences and IPC

**Files:** Create src/shared/appPreferences.types.ts, src/main/preferences/AppPreferencesStore.ts, src/main/ipc/appPreferences.ipc.ts and adjacent tests; modify src/main/index.ts, src/shared/ipc.types.ts, src/preload/index.ts and their tests.

**Interfaces:**
```ts
interface AppPreferencesSnapshot {
  preference: LocalePreference
  resolvedLocale: Locale
  revision: number
  warning: 'invalid-preferences' | null
}
// window.electronAPI.appPreferences:
// get(): Promise<AppPreferencesSnapshot>
// setLocale(preference: LocalePreference): Promise<AppPreferencesSnapshot>
// onChanged(listener: (value: AppPreferencesSnapshot) => void): () => void
```

- [ ] Write temporary-directory tests for missing files, invalid JSON, unsupported versions, restart persistence, and a failing write that leaves the committed snapshot unchanged.
- [ ] Write IPC tests proving invalid enum values are rejected and no change event is emitted after a failed write.
- [ ] Run `npx vitest run src/main/preferences/AppPreferencesStore.test.ts src/main/ipc/appPreferences.ipc.test.ts` and confirm failures before implementation.
- [ ] Implement schema validation and serialized atomic writes based on WorkspaceLayoutStore; initialize after harness startup isolation and app readiness.
- [ ] Implement typed get/set/event preload methods using existing invokeSafe conventions; keep filesystem access in main and remove listeners on unsubscribe.
- [ ] Verify concurrent writes produce ordered revisions and the event payload equals the successfully returned snapshot.
- [ ] Run focused tests plus preload/shared contract tests, review and commit.

## Task 3: Renderer switching and native dialogs

**Files:** Create src/renderer/src/stores/locale.store.ts, src/renderer/src/i18n/useTranslation.ts, src/renderer/src/components/LanguageSelector.tsx and tests; modify src/renderer/src/main.tsx, App.tsx, src/main/dialogs/nativeProjectDialogs.ts, createProjectDialogs.ts and tests.

**Interfaces:** Locale store consumes AppPreferencesSnapshot and exposes hydrate(), setLocale(preference), pending and a structured error; useTranslation() exposes a translator fixed to the store's resolvedLocale.

- [ ] Write failing tests for subscribe-before-get, stale hydration responses, two rapid changes, rejected saves, and language changes without remounting editor state.
- [ ] Add startup hydration with English recovery on read failure; update html lang and unsubscribe during teardown.
- [ ] Add a labeled select in the existing header; use stable values system/en/zh-CN and self-named explicit language options.
- [ ] Translate the export title/button as a vertical slice and test rerendering an already-open modal when locale changes.
- [ ] Inject a current-language translator into native dialog construction while preserving the harness mailbox path; resolve text at dialog invocation time.
- [ ] Verify mocked showOpenDialog/showSaveDialog/showMessageBox options in both languages, including unchanged response-to-action mapping.
- [ ] Run focused renderer/dialog tests and typecheck, review and commit.

## Task 4: Structured messages and complete copy migration

**Files:** Modify src/shared/ipc.types.ts, transcriber.types.ts, workspaceLayout.types.ts, src/main/ipc/ipcResult.ts, src/preload/invokeSafe.ts, src/main/speech/SpeechAnalysisError.ts, src/main/preferences/WorkspaceLayoutStore.ts, and affected message producers/consumers; expand shared resources and adjacent tests.

- [ ] Inventory JSX text, title/placeholder/aria-label attributes, alerts, warnings, error assignments, and progress callbacks across src/main, src/shared and src/renderer/src using rg; record every application-owned string in the resource groups defined by the spec.
- [ ] Trace each IPC error/status to its producer and consumer before editing; retain the existing broad error code and introduce a typed reason/parameter union for actionable distinctions.
- [ ] Write failing tests that show a stored error and active progress switching to Chinese while preserving session/job identity and excluding private paths.
- [ ] Update contracts, error mapping, preload propagation and renderer normalization together; map unknown failures to the generic localized error and keep full details in diagnostic sinks.
- [ ] Translate existing import stage codes at presentation time; replace free-form UI speech statuses with typed stages and safe parameters.
- [ ] Replace hardcoded copy throughout App, Transport, Waveform, Transcript, Export, FileInfoPanel and Workspace components, including tooltips, accessibility labels, empty states, warnings and confirmation prompts.
- [ ] Preserve user names and transcript content; translate only generated presentation defaults that have not become user-owned persisted data.
- [ ] Run tests for each changed contract and feature; search for remaining English literals and classify retained literals as user data, technical identifiers, diagnostics or product identity.
- [ ] Review the copy inventory against both resource files and commit.

## Task 5: Acceptance and documentation

**Files:** Update docs/architecture-standards.md and add localized acceptance coverage through the existing e2e scenario organization after reading its index and .agents/skills/agent-testing/SKILL.md.

- [ ] Document the language ownership, persistence and structured-message contracts in the architecture standard; leave personal/repository instruction files unchanged.
- [ ] Add acceptance scenarios for system default, manual selection, restart persistence, an open modal, a retained error, active playback, unchanged transcript language, and narrow-window labels in both locales.
- [ ] Run `npm run format`, inspect the diff for unrelated formatting, then run `npm run check`.
- [ ] Use agent-testing and Docker MCP for baseline and changed UI behavior; preserve report evidence and clearly separate mocked native-dialog tests from OS-native manual checks.
- [ ] Fix demonstrated regressions, rerun affected checks, review and commit.
- [ ] Report outcome, verification evidence and any blocked checks without claiming unobserved OS-native behavior.

## Plan self-review

The five tasks cover resource/type safety, persistence and IPC, renderer/native presentation, all public messages, and acceptance.
Locale identifiers and snapshot field names are consistent across tasks.
The application copy inventory is an execution step because it must include strings exposed by the final implementation diff; it does not authorize unrelated refactoring.
