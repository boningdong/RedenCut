# RedenCut English and Simplified Chinese Localization

## Decision and scope

The user approved i18next and the main-owned language preference architecture on 2026-09-11.
Provide English and Simplified Chinese for application-owned UI, tooltips, accessibility labels, native dialog copy, progress messages, and public errors.
Keep project data, user-authored names, source content, transcript text, speech recognition language, audio processing, and edit history independent of UI language.
Use i18next, Zustand, and a thin React translation hook; do not add a second application-state Context or a remote translation service.

## Language resolution and persistence

Define Locale as en | zh-CN and LocalePreference as system | en | zh-CN.
Default new installations to system; resolve system preferences in order using Electron app.getPreferredSystemLanguages() after app readiness.
Match English variants to en and Simplified Chinese variants (zh, zh-CN, zh-SG, zh-Hans and its region variants) to zh-CN.
Do not silently treat explicit Traditional Chinese variants as Simplified Chinese; skip unsupported preferences and fall back to en.
Resolve system preferences on startup and whenever the user selects system; live OS language monitoring is outside this version.
Store { version: 1, localePreference } in app-preferences.json under active userData, after harness isolation is configured.
Do not modify workspace-layout.json or the project schema.
Validate with Zod, serialize writes, and use a same-directory temporary file and atomic rename as in WorkspaceLayoutStore.
Missing files use defaults; malformed or unsupported files return defaults plus a structured warning without rewriting on read.
Filesystem failures remain observable; a failed save keeps the previously committed language and displays a localized error.

## Process contracts and switching

Shared code owns serializable types, resource dictionaries, locale resolution, and a translator factory with no Electron or Node imports.
Main owns committed preferences and its own translator instance.
Preload exposes appPreferences.get(), appPreferences.setLocale(preference), and appPreferences.onChanged(listener), returning an unsubscribe function for the event.
Snapshots include preference, resolvedLocale, and a monotonically increasing runtime revision; revision is not persisted.
Main publishes a new snapshot only after successful persistence and translator update.
Renderer subscribes before hydration, ignores older snapshots, and serializes local changes so an old response cannot overwrite a newer choice.
Use a Zustand store for the renderer snapshot and pending/error state.
Initialize language before rendering application copy; hydration failure renders English with a visible recoverable warning rather than blocking startup.
Use a fixed translator for the selected locale in the React hook so changing locale rerenders consumers without a second mutable language authority.
Set document.documentElement.lang to the resolved locale.
Do not remount the editor, restart jobs, or alter session identity when changing language.

## Resources and presentation

Bundle both language resources with the app and initialize i18next with English fallback.
Use TypeScript resources with matching key shape and semantic groups: common, app, transport, waveform, transcript, export, workspace, dialogs, progress, errors.
Use complete sentences with named interpolation; counts use i18next plural handling.
Keep user strings as interpolation data and render through React text nodes; do not render translated HTML.
Add a compact labeled language selector to the existing application header with stable self-named options: English, 简体中文, and a translated Follow System option.
Resolve native dialog strings when each dialog opens; dialogs already open need not change.
Application-supplied strings are covered; OS-owned file-picker controls may follow OS language and must be reported accurately during acceptance.
Keep timecodes, serialized numbers, keyboard shortcut semantics, product names, and extensions stable.
Use locale-aware formatting for human-readable counts and dates where present.

## Errors, warnings, and progress

Keep business codes independent of translation keys.
Replace stored display sentences with serializable message descriptors containing a stable reason and safe scalar parameters.
Retain the existing broad IPC error code for control flow and add a typed reason where the existing operation-failed category loses actionable detail.
Update main mapping, shared contract, preload unwrapping, and renderer error normalization together.
Unknown errors map to a generic localized message; raw diagnostics stay in the diagnostic sink and must not leak filesystem paths into UI.
Migrate workspace preference warnings and user-visible cleanup warnings as part of the copy inventory.
Import progress already provides a stage code; translate it at display time without changing the import workflow.
For transcription and speech analysis, audit status producers and replace UI-facing free text with typed stages and parameters while preserving diagnostic logs and job/session identities.
Messages retained in state must translate again after a locale switch.

## Acceptance

Verify English and Simplified Chinese key parity, fallback, interpolation, plural handling, and language mapping.
Verify missing/malformed preferences, failed writes, serialized updates, and out-of-order hydration/event delivery.
Verify native dialog options through Electron mocks and disclose OS controls not exercised by the harness.
Verify switching with active playback, an open export modal, and a visible error does not reset editing or jobs.
Verify persistence across restart, labels/tooltips, narrow-window layout, and existing keyboard actions in both languages.
Run npm run format and npm run check.
Before claiming the feature complete, use the repository agent-testing skill for the Docker MCP baseline and localized UI scenarios, with an evidence report and any blocked/manual checks disclosed.

## Status

Architecture approved in conversation; this document and the implementation plan record the design for review.
No application code has been changed or runtime acceptance performed by this documentation step.
