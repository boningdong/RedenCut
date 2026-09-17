# Speaker identities and associations

Approved in conversation; user requests autonomous implementation through verification.

## Domain

Keep source diarization immutable. A Person has a stable project ID, displayName, color, and source binding (audioSourceId, analysisRevisionId, speakerId). An Association has its own ID, displayName, automatic or custom color, and ordered memberPersonIds. No master/slave. A person belongs to at most one association; associations contain at least two people. New recognition revisions never inherit identities by speaker number. Preserve historical people/associations and flag bindings as needs-review; only completed diarization speakers can be edited or linked. No speaker editing for skipped, pending, failed, or unassigned audio. Existing names/colors migrate without loss. Same-revision speaker enrichment preserves identities.

## Interaction

Approved visual: ../mockups/2026-09-16-speaker-associations.html.
Tags show single people or associations, replacing associated member tags. Track-colored short left rail and faint T1 badges remain independent of speaker color. Associations use a 12px gradient dot with a thin outer ring; no inner icon or stretching. A restores automatic member-gradient color. Basic palette is visible, Hex expands only input and confirmation. Member color editor includes palette and Hex. Editing opens one anchored viewport-clamped portal popover, with basic information and association sections, one atomic save footer. All edits are drafts including member name/color edits; cancel discards them. Member names edit inline on double click or keyboard action, member colors expand inline. Removed rows disappear. Candidates exclude self and all draft-selected members. Unassociated person has an empty list. Association members list includes all members; a person's associations list excludes self. No separate leave command in the UI.

Dragging B onto A creates an association named after A; existing receiving association keeps its information. Merge existing associations without nesting. One save or drop is one undo step. Person names remain independent from association names. Removing B through the association makes B independent. Removing all others through A's person editor detaches A and leaves B/C associated. Partial person edits preserve other members together and detach the edited person plus selected retained peers into their own association if necessary. Automatically dissolve single-member associations.

Management is a collapsible tree: associations as parent rows with editable members beneath; independent people are roots and appear exactly once. All edit buttons use the same popover. Filtering affects transcript visibility, not audio mute/export. Unknown/unassigned speakers keep their separate filters. Reanalysis leaves stale people visible in management, read-only, with needs-review state; new completed speakers receive new people. Background analysis/import must not cancel or overwrite editing results.

## Architecture

Shared schemas and pure association transformations; main owns authoritative validation and atomic metadata persistence under existing workspace mutex. Renderer owns draft/popover state and presentation. Identity changes use specific requests rather than whole-project replacement. Versioned identity catalog is optional for older project v2 documents and normalized on load/session projection; preserve legacy overrides for compatibility until migration is committed. Main checks catalog expectations and current source bindings, allowing unrelated background project revisions to advance without overwriting new work.

Extend existing ordered undo history to support identity metadata entries alongside timeline snapshots; each entry restores only its own domain, and identity undo uses guarded main IPC. Failed undo does not consume the entry. Background recognition reconciliation must retain unrelated identity edits and invalidate incompatible stale undo actions clearly.

## Acceptance

Domain tests: creation/merge/default name; source uniqueness; person vs association removal; draft exclusion; no invalid diarization editing; migration; reanalysis stale protection; same-revision retention; transaction failure; metadata concurrent with import; interleaved timeline/identity undo. UI tests: one portal, viewport bounds, basic and inline member edits, palette/default/Hex, save/cancel, tree hierarchy, filtering and drag semantics. Full npm check plus Docker MCP baseline and changed-behavior acceptance on disposable prepared fixtures. Never open or modify real user project data or download models.
