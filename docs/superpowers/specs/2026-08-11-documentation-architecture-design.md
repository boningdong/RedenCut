# Documentation Architecture Cleanup Design

## Goal

Keep the repository documentation small, current, and clearly authoritative. `AGENTS.md` defines the repository-wide working contract, while `dev-docs/` contains focused extensions of that contract.

## Documentation Roles

### `AGENTS.md`

`AGENTS.md` remains the entry point for repository instructions. It contains:

- a concise description of the project and its supported platforms;
- links to authoritative repository contracts and standards;
- the working agreement for making and verifying changes; and
- the policy governing what belongs in `dev-docs/`.

When a linked file defines a rule or contract, `AGENTS.md` links to it instead of repeating it.

### `dev-docs/`

`dev-docs/` contains only durable project rules and standards that extend `AGENTS.md`. It must not contain plans, progress logs, audits, verification reports, historical proposals, or superseded design documents.

Every repository change must check `AGENTS.md` and the linked `dev-docs/` files for guidance affected by that change. Obsolete or inaccurate guidance must be updated or removed as part of the same change.

The active files will be:

- `coding-standards.md`: responsibility, naming, comments, process boundaries, and verification rules;
- `architecture-standards.md`: durable Electron, state, data-model, audio, transcription, filesystem, cache, and compatibility rules; and
- `key-mappings.md`: the canonical keyboard interaction contract, including focus and selection-dependent behavior.

### `ROADMAP.md`

`ROADMAP.md` describes current product status and future work. It does not duplicate coding or architecture standards. Its completed work, terminology, links, and verification references must match the current implementation.

### `docs/superpowers/`

Existing design specifications and implementation plans remain as dated implementation records. They are not current repository standards and are not linked as authoritative instructions from `AGENTS.md`.

## Content to Preserve

The cleanup preserves these durable requirements from the older documents:

- PodCut is a minimalist podcast editor built with Electron, React, and TypeScript, targeting macOS first and Windows later.
- Renderer state uses Zustand.
- Persisted data is defined by Zod schemas, with TypeScript types derived from those schemas.
- Electron main, preload, shared, and renderer responsibilities remain separate.
- Editing remains non-destructive, and legacy project loading remains supported.
- Renderer audio uses the `podcut://` protocol, while peak files remain regenerable caches.
- Playback uses `IAudioPlayer`, prefers `WebCodecsPlayer`, and retains `SimpleAudioPlayer` as a supported fallback.
- WebCodecs and AudioWorklet implementation constraints that prevent timing, pitch, or processor-lifetime regressions remain documented.
- Transcription remains behind `ITranscriber`; the current implementation uses local whisper.cpp.
- Current keyboard mappings and their contextual behavior remain documented.

## Content to Remove

Delete these obsolete or misplaced documents:

- `DEVLOG.md`
- `dev-docs/project-proposal.md`
- `dev-docs/project-proposal-simplified.md`
- `dev-docs/technical-roadmap.md`
- `dev-docs/technical-roadmap-addendum.md`
- `dev-docs/readability-cleanup-audit.md`

Do not carry forward outdated AssemblyAI recommendations, CLI-first architecture, obsolete directory layouts, WaveSurfer playback guidance, speculative Radix/cmdk or plugin APIs, development estimates, stale test counts, or resolved bug notes.

## Verification

The documentation cleanup will verify:

- every link in `AGENTS.md` resolves;
- `dev-docs/` contains only the three active standards files;
- deleted filenames and `CLAUDE.md` are not referenced by current authoritative documentation;
- shortcut documentation matches `useKeyboardShortcuts.ts`;
- architecture standards match current contracts and reachable implementations; and
- the repository's normal `npm run check` gate still passes.
