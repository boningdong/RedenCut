# RedenCut File Organization Standards

## Clear Names

- Name each file and directory after its responsibility or contents so its purpose is clear from the path.
- Use PascalCase (uppercase first letter, capitalized word boundaries) for project-owned TypeScript and JavaScript module filenames, regardless of whether they contain a component, class, hook, store, types or functions: `ClipRedactions.ts`, `TimelineStore.ts`, `UseKeyboardShortcuts.ts`, `ProjectTypes.ts`.
- Keep conventional test suffixes: `ClipRedactions.test.ts`, `WaveformView.test.tsx`, `TranscriptFixture.e2e.ts`.
- Preserve ecosystem/tool-required names such as `index.ts`, `vite.config.ts` and `package.json`; this rule does not rename documentation, assets, directories, generated/vendor files or Python modules (which retain snake_case).
- Apply PascalCase to newly created modules now. Rename existing modules in the dedicated filename refactor after the clip redaction overlay feature is complete; avoid mixing repository-wide renames with feature changes.
- Avoid catch-all names such as `misc`, `common`, or `utils` when a specific subsystem or responsibility can be named.

## Single Responsibility

- Keep each file focused on one cohesive responsibility; split unrelated responsibilities even when the file is short.
- Prefer at most one primary class per file; closely related private helpers and types may stay with it.
- Function-, component-, and type-focused files do not need a class merely to satisfy this convention.

## Logical Hierarchy

- Make directory nesting reflect the project's logical decomposition: parent directories identify subsystems, and children refine their responsibilities.
- Keep siblings at a comparable level of abstraction; do not mix whole subsystems with unrelated implementation details.
- Keep implementation code, fixture inputs, and generated outputs in clearly distinguishable locations; add nesting only when it communicates a meaningful boundary.
