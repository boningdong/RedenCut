# RedenCut UI Requirements and Final Mock

Date: 2026-09-10.
This document records the requirements explicitly raised and the direction selected during the UI discussion, while distinguishing mock behavior from remaining production work.
It is a design deliverable, not an AGENTS.md file, skill, or instruction for other projects.
All artifacts from this iteration are stored under `ui-mock/2026-09-10/`.

## 1. Deliverables and Opening Instructions

- Final mock: [redencut-ui-final.html](redencut-ui-final.html).
- CSS, JavaScript, SVG icons, and demonstration data are embedded in the HTML; fonts come from the operating system.
- Double-click the HTML or open it in a browser; no Node.js, build step, dependency installation, internet connection, or server is required.
- The HTML can be copied independently to another directory or computer; this Markdown document is not needed at runtime.
- A modern browser with JavaScript, Canvas, ResizeObserver, and native dialog support is required; the tested scope is recorded below.
- Expand the demonstration panel at the top to switch scenarios, loop an overlapping passage, or compare the earlier side-by-side approach.
- The demonstration panel is not a final product feature and starts collapsed.
- The selected product direction is **single-column dialogue with overlap markers**, with a **Read / Align** switch inside each overlap card.
- Alignment starts enabled in this mock to demonstrate the selected presentation.

## 2. Product Goal and Visual Direction

### User-confirmed direction

- RedenCut's primary purpose is editing audio content.
- Reduce the engineering-heavy feel of the existing UI by emphasizing content and editing actions.
- The user approved the mock's overall visual style; the final HTML should serve as the visual reference for subsequent work.
- The supplied reference image guides visual style and similar interface elements, not the entire feature set.
- Base features on capabilities already present in the App; do not introduce unsupported capabilities simply because they appear in the reference image.
- Mock buttons should provide hover, pressed, disabled, and other relevant feedback; simulated interactions are acceptable for exploring the experience.

### Presentation used in the approved mock

- Dark gray surfaces, fine borders, restrained corner radii, and purple primary actions.
- Consistent track colors across transcript text and waveforms to connect related content.
- Generous space for reading and editing; technical metadata is accessible through a details entry point.
- Clear focus, selection, playback highlighting, and muted states.

## 3. Editor Regions

| Region | Default location | Core content |
| --- | --- | --- |
| Transcript | Above the audio region | Transcript, text selection and editing, Generate transcript button |
| Audio | Below the transcript | Existing audio clip editing capabilities, multitrack waveforms, clip operations |
| Controls | Bottom of the App | Time display, play/pause, undo/redo |

- The Generate transcript action must remain in the upper transcript region.
- The user requires these regions to be draggable and repositionable.
- The mock demonstrates region swapping, moving controls to the top or bottom, resizing transcript/audio heights, and restoring the default layout.
- Left/right docking, freely floating panels, and cross-window behavior have not been confirmed as production requirements.

## 4. Selected Transcript Presentation

### 4.1 Single-column dialogue with overlap markers

- Present non-overlapping content vertically in conversational order.
- When different tracks speak simultaneously, identify the relationship with a simultaneous-speech card and lightweight markers.
- Alignment is a display mode within an overlap card, not a third global layout alongside the single-column approach.
- Place the Read / Align switch at the top of the simultaneous-speech card.
- Retain the earlier local side-by-side approach for comparison; it is not the selected default product design.

### 4.2 Establish horizontal correspondence only where speech overlaps

- Vertical progression expresses conversational order and coarse time progression.
- In alignment mode, horizontal positions help relate speech occurring at the same time.
- Non-overlapping text should flow naturally and continuously without reproducing every real-time gap.
- Do not turn the entire transcript into a proportionally spaced text timeline.
- Do not insert large gaps merely to represent natural pauses or ordinary phrase boundaries.
- Reserve space only as needed to relate simultaneous speech.
- Keep character spacing natural; the goal is to understand who interjects when, rather than spacing every character uniformly by absolute time.

### 4.3 Group wrapped lines by person and show each name once

- Keep a person's wrapped lines together beneath their name; do not repeat the name on continuation lines.
- Show A's complete group of lines, followed by B's corresponding group of lines.
- Maintain horizontal correspondence between matching lines instead of alternating A/B groups and repeating their names for every wrapped segment.
- Very subtle dots, small crosses, or similar marks may identify corresponding positions; the current mock uses faint dots.

Illustration:

```text
A: XXXXXX,XXXXX,    XXXXX
   XXXXXX.    XXX    XXXX
B:              XXX
          XXX
```

This illustrates correspondence, not required character counts, exact whitespace, or a mandated font.

### 4.4 Demonstrated scenarios

- Brief response: a short interjection within another person's continuing speech.
- Extended overlap: both people speak continuously for a period.
- Intermittent interjections: one person interjects twice, with silence between the two contributions.
- Narrow container: wrapping preserves corresponding lines and horizontal positions.

## 5. Interaction Expectations and Implementation Boundaries

### Behavior demonstrated in the accepted mock

- Clicking text seeks to its playback position.
- Text on both tracks can be highlighted simultaneously during overlapping speech.
- Muting selected text affects the corresponding track only and can be undone.
- The selection toolbar identifies the track being edited; selections spanning tracks should clearly communicate their scope.
- Switching between Read and Align must not change audio edits or playback position.
- Track identity should not depend on color alone; retain text labels.

### Production work still required

- Use actual project data for transcript timestamps, track ownership, and mappings after timeline edits.
- Phrase and character timestamps in the mock are assigned for demonstration, not a production alignment algorithm or accuracy guarantee.
- In content-driven alignment, horizontal distance is not a fixed number of seconds; a simple x/width ratio cannot determine the actual playback time.
- Three or more overlapping speakers, complex cross-track selections, long-project performance, and accessible reading order need separate design and validation.
- Multiple overlap cards should support their own display state; the single-card example does not establish a complete state model.
- Preserving scroll position, focus, text selection, and waveform zoom during panel rearrangement requires production verification.

## 6. Mock Limitations

- Playback simulates time progression, highlighting, and playhead movement without producing sound.
- Canvas waveforms use demonstration data.
- Transcript generation simulates progress; it does not run Whisper or another model.
- Export demonstrates format selection and progress without encoding or creating actual audio files.
- Audio import accepts local file selections and adds demonstration tracks without decoding the audio or extracting waveforms.
- Save uses browser local storage; if storage is blocked, the UI directs the user to Save as.
- Save as downloads demonstration JSON that can be loaded through the mock's Open project action; it is not the production RedenCut project format.
- Refreshing is not guaranteed to restore all edits, layout, or playback state; use demonstration JSON to carry edited state between sessions.
- This deliverable does not modify the existing App source code.

## 7. Retained Comparison Versions

| File | Purpose |
| --- | --- |
| [redencut-v1.html](redencut-v1.html) | Original complete interface mock |
| [redencut-overlap.html](redencut-overlap.html) | Single-column overlap markers versus local side-by-side comparison |
| [redencut-alignment-v1.html](redencut-alignment-v1.html) | Earlier exploration using a proportional time scale |
| [redencut-alignment.html](redencut-alignment.html) | Content-driven alignment comparison preceding the final deliverable |
| [redencut-ui-final.html](redencut-ui-final.html) | Final standalone offline deliverable |

Earlier versions remain available for traceability; retaining them does not make every alternative a final requirement.
Screenshots from the same iteration are retained in this dated directory alongside the HTML files.

## 8. Verification Scope

The final standalone HTML was opened directly through file:// in local Chrome with the browser set offline.
Checks covered absence of external network requests and page script errors, the default layout and local display switch, overlap scenarios, simulated playback, text muting and undo, simulated export, fallback behavior when local storage is blocked, and basic desktop and narrow layouts.
The dated-directory move was verified using file hashes; all moved files were unchanged before translating this Markdown document.
Safari, Firefox, Windows, and the actual Electron App were not used to validate this standalone deliverable.
