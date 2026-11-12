# RedenCut Coding Standards

## Responsibility

- Each function performs one coherent operation at one abstraction level.
- Each class represents one clear responsibility.
- Each module has one named responsibility.
- Split large units by responsibility, not by arbitrary line counts.
- Parallel logics should follow the same form.
- Keep each function at a single level of abstraction.

## Source of Truth
- Reuse the same source of truths, (e.g. const values, paths, dependencies).
- Avoid use more than one source of truths for different workflows share parallel logic.
- If existing source of truth breaks clean code principle, discuss about it.

## Embdded Scripts
- Inline code is acceptable for a short, simple probe or expression.
- Put substantial executable logic in a dedicated file in its own language. Keep Dockerfiles, shell commands and process-launching code focused on invoking those files and passing arguments.
- Extract inline code when it contains branching, loops, multiple operations, or logic that needs independent testing.
- Pass dynamic values through arguments or environment variables instead of inserting them into source-code strings.
- When modifying existing embedded scripts, apply this rule within the affected scope; avoid unrelated cleanup.

## Naming

- Use descriptive names that communicate domain intent.
- Avoid unexplained abbreviations.
- Use short conventional names only when their meaning is obvious in context.

## Developer Command Interfaces

- Give related developer workflows one documented public entrypoint, with explicit action and target names.
- Keep the entrypoint focused on dispatch; put substantial actions in modules or directories named for their responsibilities.
- Make prerequisites, downloads, and test scope clear. Do not implicitly build images or provision persistent resources from a `run` command; document any compilation required at startup.
- After updating callers, tests, and documentation, remove superseded commands unless compatibility is required.

## Stable Identifiers

- Define error codes, diagnostic event names, IPC channels, persisted state values, and other stable string identifiers as named constants or enums when they are used at multiple call sites or cross module, process, or language boundaries.
- Keep each definition in the owning domain contract, and reference it from schemas and production callers.
- Preserve the serialized string values of existing contracts.
- Tests may use literal values to verify an external contract independently.
- Do not extract ordinary copy or one-off local strings solely to eliminate literals.

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
