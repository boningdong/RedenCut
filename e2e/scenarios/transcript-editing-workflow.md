# Transcript Editing Workflow

## User Goal

Open an already analyzed podcast, edit audio through its transcript, inspect the affected clip occurrence, revise the edit, and preserve it across a full restart.
Execute through the [agent-testing skill](../../.agents/skills/agent-testing/SKILL.md), alongside the [editing baseline](editing-workflow.md) when reviewing product changes.
Live generation belongs to the [speech analysis scenario](speech-analysis-workflow.md); these existing-text checks need no models.

## Fixtures and Preparation

Use a fresh disposable copy of `transcript-editing-high-precision.redencut` for normal checks: two sources and two overlapping tracks.
Use `transcript-editing.redencut` for older recognition and recovery cases.
Follow the [saved project setup](../fixtures/projects/README.md), then open through the prepared dialog and real UI.
Never edit the repository fixture or the user's original project.
Record source snapshot, run ID, generation, fixture, selected words and visible track/clip context.
Use clean copies or undo when prior exploration would obscure the expected result.

Inventory actual visible timing states first: directly aligned, recovered approximate timing, shared acoustic edit units (AEUs), untimed speech and punctuation.
An AEU is the smallest audio interval available for editing; multiple text units can share it.
Older recognition or a misspelling does not guarantee any specific timing state.
Find examples through visible timing feedback and expansion notices; unavailable examples or setup gestures are BLOCKED, never silently passed.
Do not fabricate timestamps, edit project JSON or inject private state to create a passing case.
Fixture metadata and domain tests may diagnose gaps but do not establish UI acceptance.

## Core Editing

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `text-open` | Both tracks, waveforms, transcript and speaker controls load without Generate. | Opened project and action record. |
| `text-seek` | Clicking reliably timed speech seeks to its current occurrence; this remains correct after moving its clip and undoing. | Words, clip geometry and paused playhead/time in each state; this alone does not prove sound content. |
| `text-single` | Selecting one directly aligned speech unit edits only its resolved range in the intended occurrence. | Native selection, track/clip and affected versus adjacent text/waveform. |
| `text-range` | Continuous multi-character selection edits the resolved interval without unrelated edits. | Selected endpoints, resulting bounds and unchanged neighboring content. |
| `text-direction` | Forward and backward selections of the same phrase resolve equivalently; multiline selection respects its endpoints. | Each selection on restored state and resulting bounds. |
| `text-punctuation` | Punctuation alone creates no audio edit; mixed speech/punctuation uses supported speech boundaries. | Selection, feedback, unchanged punctuation-only timeline and mixed-selection result. |
| `text-shortcuts` | Delete, Backspace and M apply equivalent edits to the same restored selection. | Actual keys, focus and resulting ranges. |
| `text-history` | One confirmed deletion is one undo operation; redo restores it. Canceling creates no edit-history entry. | Edit/undo/redo states; cancel followed by undo of the preceding real edit. |
| `text-persist` | After visible save completion, fully restart and reopen; edits, transcript and unaffected tracks persist. | Saved state, distinct generations, reopened text and waveform. |

## Timing Boundaries

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `timing-recovered` | Recovered timing discloses approximate/shared boundaries and permits its supported edit; spelling alone does not decide editability. | Actual timing feedback and edit result. |
| `timing-internal-gap` | Reliable outer boundaries allow a continuous phrase edit despite missing individual timing inside. | Uncertain internal unit, supported endpoints and continuous edit. |
| `timing-unresolved-edge` | An unresolved endpoint offers a supported expansion or blocks with explanation, without invented character timing. | Endpoint selection, feedback and absence of unintended edits. |
| `timing-shared-unit` | A partial shared-AEU selection discloses requested/expanded text. Cancel changes nothing; confirm edits the disclosed group. | Actual multi-character AEU, cancel and confirm states; whole-group selection for comparison. |
| `timing-no-audio` | Text lacking a supported interval cannot independently edit or seek with fabricated timing. | Untimed example and unchanged waveform/playhead. Establish silence independently for any silence-specific claim. |
| `timing-clip-edge` | Speech intersected by a clip trim discloses partial coverage and cannot edit outside the retained occurrence. | Trim geometry, partial-unit feedback, edit bounds and unaffected neighboring clip. |

## Occurrence Scope, Filters and Focus

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `scope-two-sources` | Editing either source affects only its selected occurrence, even with similar text/times on the other track. | Both tracks before/after; exercise each source on restored state. |
| `scope-split-join` | Supported continuous selection across adjacent pieces edits the intended interval. Discontinuous source/output regions do not silently include gaps or unrelated audio. | UI split/move setup, selection, result or explicit rejection. |
| `scope-repeated-source` | Editing one repeated source occurrence leaves the other intact. | UI-created repeat or dedicated fixture and both results; unavailable setup is BLOCKED. |
| `scope-stale-selection` | Moving/removing a selected clip, changing speaker visibility or switching projects cannot leave an actionable stale audio target. | Before/after selection, feedback and unaffected audio. |
| `scope-speakers` | Hiding all categories, including unassigned when present, leaves no orphan text; restoring filters changes no audio. Hidden text is not silently included in a deletion. | Filter states, empty/restored view and hidden-content selection outcome. |
| `scope-overlap` | Read/Align resolve the same speech to the same occurrence and boundaries. Muted/deleted text follows the current display contract without arbitrary single-character fragments. | Both modes, restored-state edits and surrounding utterance layout. |
| `focus-transcript` | Space controls transport without typing; ordinary typing leaves this read-only surface unchanged. Undo/redo/save retain editor meanings. | Actual keys, focus, text and transport/save state. |
| `focus-transfer` | Waveform interaction transfers shortcut scope and clears transcript selection. Transcript focus does not act on a stale waveform clip; rename inputs retain ordinary typing behavior. | Selection/focus transitions, actual keys and unaffected unrelated clips. |

Use the [keyboard scenario](keyboard-workflow.md) for the complete shortcut contract; explicitly linked observations can serve both reports.
Try narrow panel width and increased timeline zoom as additional variations, reacquiring geometry after layout changes.
Do not derive source-time boundaries from text pixel positions.

## Playback and Export

Run the [redact preview scenario](redact-preview-workflow.md) with an edit created through actual transcript selection.
Cover preview on/off, crossing and starting inside a redaction, retained overlapping audio, natural gaps, pause/resume and save/reopen.
Inspect exported WAV duration and decoded retained prefix/suffix; shorter duration alone cannot prove the right content was removed.
Interactive MCP has no recording controls: moving playheads cannot prove audible correctness.
Fixed Docker recording tests can provide separate audio evidence when the required content assertions exist.

## Clip Redaction Overlays

The approved overlay feature uses clip-owned source-relative ranges, independently of ordinary clip mute.
Core checks above intentionally describe user outcomes independently of split/mute implementation.

| ID | Required observable outcome | Evidence |
| --- | --- | --- |
| `overlay-create` | Text deletion adds an overlay without changing clip count, position or duration. | Selection, before/after clip geometry/count and overlay/text. |
| `overlay-remove` | Selecting/deleting an overlay restores only its coverage, preserving its clip and other overlays. | Selected overlay, delete/undo/redo and surviving clip. |
| `overlay-resize` | Either edge adjusts audio boundaries and full/partial text state. One committed drag is one undo; cancellation restores original bounds. | Both edge drags, text feedback, undo/redo and canceled drag. |
| `overlay-move` | Overlay follows its clip with unchanged source coverage and updated transcript timing. | Move and undo/redo geometry plus corresponding text. |
| `overlay-body-move` | Dragging the overlay body translates its range with constant duration and bounded visible coverage; one undo reverses the gesture, Escape cancels. | Before/after range, unchanged clip geometry, undo/redo and canceled drag. |
| `overlay-hover-bypass` | Overlay fills clip height and owns hover; Option/Alt at pointer-down selects/drags the underlying clip, with the gesture target locked until release. | Hover comparison and actual held-modifier gesture; modifier-hold capability is required. |
| `overlay-cycle` | Full-height overlapping overlays remain independently reachable, including one large overlay covering two disjoint smaller ones. | Cycle control, successive keyboard activations and selected-object removal. |
| `overlay-adjacent` | Overlays at touching clip edges remove a continuous interval while remaining independently editable. Separating clips preserves the natural gap. | Adjacent/separated states, independent removal, preview and decoded export. |
| `overlay-overlap` | Overlapping overlays apply their union; removing one preserves coverage by the other. | Both identities and remaining interval after individual removal. |
| `overlay-mute` | Clip mute retains duration and existing text/overlap presentation, independently of overlays. Removing either state preserves the other. | Both operation orders, text, preview timing and silent full-duration export for mute alone. |
| `overlay-retained-track` | Retained overlapping audio prevents a global skip; only the redacted source contribution is suppressed. | Both tracks, playing-time observations and decoded export in the overlap. |
| `overlay-persist` | Created, resized and independently removed overlays retain their final state across save/full restart. | Reopened bounds, clip mute, text and playback/export. |

Explicit splits partition crossing coverage into independently editable child overlays, with one undo restoring the original.
Dragging is clamped to clip bounds; a trim clips effective coverage while preserving hidden overlay metadata.
Partially covered AEUs show partial coverage without invented character timestamps.
Repeated clip occurrences remain independent; no old mute-marker migration is required for this unpublished format.

## Reporting and Limits

List each applicable checkpoint as PASS, FAIL or BLOCKED with evidence.
For a workflow trial/subset, name executed checkpoints and mark the remainder NOT RUN; do not claim full scenario acceptance.
The fixed `transcript-fixture.e2e.ts` covers opening, a normal range edit, preserved clip count, overlay pointer/keyboard resize, removal, undo/redo and persistence on both fixtures; it does not establish the rest of this matrix.
Missing examples remain gaps even when domain/component tests pass.
Model quality, live diarization editing, macOS input and long-audio performance remain separate acceptance work.
Stop owned runs and retain screenshots, actions, exports and the evidence-backed report in the run directory.
