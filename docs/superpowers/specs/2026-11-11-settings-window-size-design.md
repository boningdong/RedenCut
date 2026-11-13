# Stable Settings Dialog Size

## Intent

Address [issue #5](https://github.com/boningdong/RedenCut/issues/5): switching settings tabs changes the dialog size and makes it feel buggy.
The user approved the design in this conversation.

## Goals and Constraints

- Keep the Settings dialog at 780 × 680px when the app's content area allows it.
- Keep its dimensions unchanged when switching between General, Theme, Speech Resources, and Diagnostics.
- Preserve the existing viewport height limit so shorter app windows reduce the dialog height.
- Allow vertical content scrolling, but no horizontal scrolling or inaccessible clipped controls.
- Keep navigation, the heading, and the close button visible while content scrolls.
- Preserve existing English and Chinese layouts.
- Keep the desktop Settings menu at 220px across English/Chinese language switches so the divider and content column do not move; the user approved this extension on November 13, 2026.

The app currently specifies a minimum native window size of 900 × 600px in `src/main/index.ts`.
Normal window resizing therefore leaves room for the existing 780px dialog width; this fix does not need a new narrow-width layout.
Existing viewport limits remain defensive constraints, not a request to change app minimum dimensions.

## Approaches

1. **Remove tab-specific sizing exceptions (selected).** Reuse the existing shared 780 × 680px shell, viewport limits, and internal vertical scrolling, minimizing the change and regression risk.
2. **Rework dialog sizing.** More invasive and unnecessary unless browser verification exposes another problem within the approved behavior.

The user accepted reuse of the shared shell and confirmed that vertical scrolling is allowed but horizontal scrolling is not.
For the language-switch extension, use a fixed 220px menu column rather than a label-sized column: the latter saves space for Chinese but causes the reported movement.

## Design

Implementation inspection found two tab-specific sizing exceptions in `src/renderer/src/components/settings/preferences.css`: a 502px Diagnostics height and an 870px Speech Resources width.
Remove both exceptions to satisfy the approved requirement for unchanged 780 × 680px dimensions across all four tabs.
Keep content styling and the shared modal sizing rules unchanged unless verification demonstrates that a narrow correction is required for the approved behavior.
No React state, persisted preferences, native window sizing, onboarding behavior, or settings functionality changes are intended.
Replace the desktop Settings grid's `minmax(176px, max-content)` menu column with `220px`, approximately its existing English width.
Preserve the existing single-column navigation layout below 700px rather than introducing an unrelated mobile redesign.

## Non-goals and Failure Conditions

Do not redesign Settings, change its preferred dimensions, or refactor unrelated CSS.
A fix is not acceptable if it stabilizes the outer frame but makes content or controls unreachable, introduces horizontal scrolling, or breaks Diagnostics collection and inspection.

## Verification

Check all tab transitions at the normal window size and at the app's minimum 900 × 600px window size.
Confirm constant dialog bounds within each window size, vertical access to overflowing content, no horizontal overflow, and reachable navigation and close controls.
Repeat relevant checks in English and Chinese and include Diagnostics before and after collection.
Switch English → Chinese → English within the same open dialog at normal and minimum supported renderer sizes; verify the menu width, divider, content origin, and outer bounds stay fixed and labels remain fully visible.
Use the repository's agent-testing workflow for the baseline and changed-behavior acceptance checks, and run `npm run format` and `npm run check` before handing off an implemented fix.

## Builder Decisions

Choose focused regression coverage using the existing test harness; measure layout in a real browser rather than relying on DOM-only tests to establish CSS dimensions.
If verification requires changes beyond the sizing exceptions and narrowly related overflow behavior, discuss the expanded scope before proceeding.
