# Settings Dialog Size Fix Plan

Approved design: [Stable Settings Dialog Size](../specs/2026-11-11-settings-window-size-design.md).

The required `superpowers:writing-plans` skill was requested but could not be loaded in this session; this short plan was written directly instead.

## 1. Establish Browser Verification

- Read the repository's `agent-testing` skill and the relevant scenario instructions.
- Establish Docker MCP availability and run the required baseline scenario.
- Capture Settings bounds across all four tabs and confirm the existing Diagnostics height difference.
- Use the current native minimum window dimensions when defining the smaller-window check; distinguish the native outer window from the renderer viewport.

## 2. Apply the Focused Fix

- Remove the Diagnostics-specific 502px height override and the Speech Resources-specific 870px width override discovered during implementation in `src/renderer/src/components/settings/preferences.css`.
- Preserve the shared 780px width, 680px preferred height, viewport height limits, and vertical scrolling behavior.
- Apply the November 13 approved extension: fix the desktop menu grid column at 220px, preserving the existing layout below 700px.
- Add focused regression coverage using existing browser-test conventions where supported.
- Assert equal dialog bounds across tabs at a fixed viewport and no horizontal overflow in the dialog or content area.

## 3. Verify Behavior and Repository Checks

- Exercise General, Theme, Speech Resources, and Diagnostics in a normal window and the minimum supported window.
- Check English and Chinese labels, content scrolling, and visibility of navigation and close controls.
- Switch English → Chinese → English in the same dialog at each supported test size and assert unchanged menu bounds, divider/content origin, and outer bounds, with no horizontal overflow or cropped labels.
- Exercise Diagnostics collection and inspection to confirm expanded content remains reachable without resizing the frame.
- Run `npm run format`, inspect its diff for unrelated changes, and run `npm run check`.
- Produce the evidence-backed acceptance report required by `agent-testing`; disclose any failed or blocked checks without claiming unperformed verification.

## Scope Guard

If browser checks reveal a need for broader layout changes, stop and discuss them before expanding the implementation.
