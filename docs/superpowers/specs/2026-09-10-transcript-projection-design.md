# Multitrack transcript projection

The transcript is a derived view of the current timeline and canonical speech analyses.
Its inputs are current tracks/clips and source speech artifacts; its outputs are occurrence-scoped text, output-time seeking/highlights, overlap dialogue, and safe source-range edits.
It does not persist a second timeline or invent finer transcription timing.

## Occurrence projection

Each identity includes audio source, analysis revision, track, clip, and transcript unit.
Every current clip occurrence is projected independently, intersecting aligned acoustic bounds with the retained clip source bounds and mapping those bounds to output time.
Source trimming or splitting inside an acoustic unit retains its full textual context with a visible `partial` label; the retained source interval is the only editable audio.
Punctuation and unaligned speech keep null timing and are positioned in reading order by a precomputed nearest timed neighbor.
A linear neighbor pass indexes each analysis, and an event sweep counts active tracks for positive, half-open overlap intervals.
Track mute, clip mute, and solo suppression retain struck-through speech but exclude it from audible overlaps and current-speech highlighting.

## Dialogue and alignment

Normal turns remain single-column speaker paragraphs.
Each overlap card has its own Read/Align state and derives its identity from participating occurrences.
Coarse acoustic context spanning disjoint interjections links those intervals into one card while preserving the actual intervals and gaps.
Align measures text in the computed transcript font and sizes each shared acoustic-anchor column from its widest speaker content.
A ResizeObserver supplies available card width; shared columns wrap into lines inside each speaker lane, so all of speaker A's lines precede speaker B's lines.
Faint dotted boundaries and continuation dots communicate correspondence without duplicating the original transcript text.
Only line starts display timing; other anchor timing is available in a title.
Acoustic units crossing an actual overlap boundary are labeled as boundary-spanning context; no character subdivision or timestamp interpolation is performed.

## Editing and lifecycle

Native selection resolves through occurrence identity before acoustic expansion.
Mixed tracks or clip occurrences show an explicit noneditable scope explanation, preventing accidental edits to the first matching source occurrence.
Acoustic expansion retains the existing confirmation and clips confirmed source ranges to the selected occurrence.
Confirmation revalidates source, clip bounds/output position, and analysis revision before calling the atomic `muteClipRanges(trackId, clipId, sourceRanges)` action.
Timeline edits, removal, split, moves, undo, and redo recompute projection from the store.
All simultaneous audible units highlight at the current output time, and clicking a timed unit seeks to that occurrence's output start.
Missing tracks remain generatable from the transcript controls after another source has been analyzed; reanalysis, progress, and source-specific speaker renaming remain available.

## Verification

Focused automated coverage includes occurrence duplicates, three-track intersections, touching/nonoverlapping intervals, mute exclusion, trims/partial units, unaligned text, punctuation spacing, cross-occurrence selection rejection, acoustic expansion, actual clicked output seeking, simultaneous highlights, duplicate-only mute with undo/redo, native mode-control Space, disjoint interjections within a long acoustic unit, content measurement, and grouped responsive lane DOM order.
The final integrated check and Docker UI acceptance are performed by the coordinating task and reported with their evidence.
