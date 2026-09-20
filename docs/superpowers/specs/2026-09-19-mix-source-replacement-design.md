# Mix source replacement

Approved conversational design, 2026-09-19; user explicitly waived further document review and authorized isolated implementation and acceptance.
Baseline: main cd3f312. Preserve prior standalone mock; reference output/sync-source-mock/replacement.html outside this worktree.

## Intent
Edit one Mix while associated independent recordings supply selected intervals. Linked children never independently sound; the effective composite is the Mix. They are read-only during association. Use a connected monochrome hierarchy icon (long master line, branch connected to two indented child lines), with active button background, alongside volume. No music/lock glyph or disconnected branch.

## User flow
Import aligned recordings, choose independent tracks from the Mix header, acknowledge existing timing is preserved, then associate. Permit already edited material with explicit alignment warning; do not invent original timing. Drag existing time ruler, target Mix, open Replace audio… anchored above the selected interval. Choose one or multiple child tracks and Apply atomically; cancel/outside/Escape discards draft. Main waveform displays replaced sources and colors within that same lane; child lanes compact/read-only/collapsible. Reopen replacement, change tracks, restore Mix. No transcript entry in v1. Children still supply source-colored transcript occurrences for enabled intervals; all transcript edits route to Mix. Do not add shortcuts conflicting with M/S/Delete.

## Data and identity
Keep Track[] as the transactional document: optional Track.mixLink = { stemTrackIds: string[] }; optional Clip.sourceOverrides = [{ id, sourceStart, sourceEnd, stemTrackIds }]. This avoids a second relationship snapshot and preserves current session drafts. Zod owns types. Root project version becomes 3, with explicit v2-to-v3 migration; old readers reject v3. Unique tracks/clips, unique child ownership, no cycles/nesting, valid nonempty child selections, finite ordered source bounds, nonoverlapping override ranges. Missing fields preserve old sound. Child original redactions/mute/volume metadata remain stored, ignored only when contributing through Mix. Main controls and clip gain apply to result; v1 replacement uses raw child source audio rather than child effects/gain.

## Time editing
Operations originate on master. Main split/move/trim/delete/insert/copy/paste propagate timing to corresponding child material, identified by intersections with original master output intervals. Normalize child segments at affected interval boundaries before transformations; preserve source offsets, redactions and hidden trim metadata. Already-edited tracks may contain gaps: only existing material follows, no fabricated audio or silent fallback to Mix. Replacement application requires complete unambiguous source coverage for every selected child over master-covered selection; invalid selection yields actionable error. Child direct structural/redaction/mute/solo controls are blocked while linked. Preserve associated set on same-group copies; cross-lane reassignment must not silently break relationship.

## Rendering
Reuse shared AudioRenderPlanBuilder, integer 48 kHz frames and timeMap. Exclude child tracks from independent scheduling and skip/crossfade eligibility. Compile master redactions/transitions using master topology; then substitute each contribution's timeline/source interval with child spans from the selected override, preserving master envelope, gain, output frame and track volume. Crossfade wings may switch sources internally: slice at override and child boundaries, retaining envelope origin. Resolve pre-contraction editing coordinates; never use output transport time as override time. Source override itself never contracts time. Both timeline and edited modes use substitutions; edited mode alone contracts redactions/crossfades as today. Mute/Solo apply to final master, not original stems. Gain-only updates retain the existing lightweight path.

## Transcript
Hide linked children by default, replace master transcript coverage with actual selected source occurrences. Source color is background, speaker label identity retained. Missing analysis yields no fabricated Mix words for substituted intervals. Preserve partial acoustic bounds and simultaneous child occurrences. Redact from substituted text must resolve exact master output range and apply to master, never mutate children. Child stored redactions do not strike substituted text. Continuous/speaker modes share projection.

## Unlink and deletion
Confirm if detached sources participate in any overrides; affected complete override intervals restore Mix, other overrides survive. Child becomes ordinary muted track with stored redactions and all prior/synchronized timing edits intact. Removing a master must not destroy children; detach muted and preserve. All relationship, restoration, and structural operations undo atomically. Save/open/export retain relationships.

## Validation
Unit tests pin schema/migration, interval splitting, synchronized timing/history, render plan and numerical PCM replacement/crossfade, transcript ownership. UI checks cover creation, range, multi-selection, restore/unlink warnings, icon, collapse, read-only children, escaped/dismissed draft, save/reopen. Full npm run check plus harness tests. Docker MCP editing baseline and UI consistency plus targeted scenario, with actual export inspection. Report unavailable audio hardware/transcription accurately. No auto alignment, drift correction or extra boundary crossfade in v1.
