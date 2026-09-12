# RiffCut Coding Standards

## Responsibility

- Each function performs one coherent operation at one abstraction level.
- Each class represents one clear responsibility.
- Each module has one named responsibility.
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
