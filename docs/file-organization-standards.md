# PodCut File Organization Standards

## Clear Names

- Name each file and directory after its responsibility or contents so its purpose is clear from the path.
- The naming conventions should be consistent (length, number of words, Camel case vs dash separated, noun vs verb, etc).
- Avoid catch-all names such as `misc`, `common`, or `utils` when a specific subsystem or responsibility can be named.

## Single Responsibility

- Keep each file focused on one cohesive responsibility; split unrelated responsibilities even when the file is short.
- Prefer at most one primary class per file; closely related private helpers and types may stay with it.
- Function-, component-, and type-focused files do not need a class merely to satisfy this convention.

## Logical Hierarchy

- Make directory nesting reflect the project's logical decomposition: parent directories identify subsystems, and children refine their responsibilities.
- Keep siblings at a comparable level of abstraction; do not mix whole subsystems with unrelated implementation details.
- Keep implementation code, fixture inputs, and generated outputs in clearly distinguishable locations; add nesting only when it communicates a meaningful boundary.
