# Clip editing design

Approved in conversation on 2026-09-16.

Deliver cross-track dragging first, with a target-lane highlight and exact placement ghost, then non-destructive edge trim/restoration, Shift-click and marquee multi-selection, atomic batch move/delete/mute, same-project cut/copy/paste/duplicate, seam-based insertion, and a simple default-on snapping toggle.
Normal placement preserves group timing/track offsets and resolves collisions as a group; insertion snaps to a seam and shifts only affected destination tracks. Duplicate inserts after the selection. Delete leaves gaps. No join/group persistence, ripple delete, clip effects, or project format migration is included.

Use pure timeline placement/edit functions shared by preview and commit. Zustand remains the sole edit-state owner; pointer previews stay transient. Commits compare the source track snapshot to prevent stale previews from overwriting edits, and each gesture produces one undo entry. Preserve clip source identity and hidden redaction metadata on trim; clone independent IDs on copy. Clipboard and interaction preferences are transient and reset on project replacement.

Selection supports multiple clip IDs and one primary clip; overlay selection is mutually exclusive. Existing single-clip consumers remain compatible through the primary ID. The target preview uses theme colors, thin borders, subtle fill and exact clip geometry; invalid drops do not mutate. Escape/pointer cancellation discards preview. Keyboard clipboard handling is restricted to Audio focus and leaves text editing native.

New modules live under renderer domain, Waveform components, and stores with PascalCase filenames. No new classes or IPC are needed. Playback/transcript consume committed tracks through existing interfaces.

Validation: placement/trim domain cases, atomic store history, keyboard focus, real pointer component integration, full npm check, Docker MCP baseline plus feature-specific visual acceptance. Report unavailable audio evidence explicitly.
