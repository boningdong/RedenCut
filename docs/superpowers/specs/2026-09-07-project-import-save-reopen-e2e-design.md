# Project import, save and reopen E2E

## Goal and scope

Prove that importing `mandarin-short-female.wav`, saving a project, fully restarting RedenCut and reopening the saved project preserves the imported audio and restores the visible track and waveform.
Run the acceptance test inside Docker using the existing shared-context MCP harness.
Do not implement playback verification, editing, transcription, export automation or native OS dialog interaction in this slice.

## Input and output ownership

- Store the user-supplied file unchanged at `e2e/fixtures/audio/mandarin-short-female.wav`; retain the Downloads original.
- Select audio fixtures by filename, such as `mandarin-short-female.wav`, resolved only within `e2e/fixtures/audio/`; do not introduce fixture IDs or an ID-to-file registry.
- Accept only a plain filename for audio selection; reject path separators, traversal, absolute paths, missing/non-regular files and symlink escapes from the fixture directory.
- Keep all saved projects under the current run's `projects/` directory, retained with the existing run artifacts.
- Accept only normalized project names within that directory; reject traversal, absolute paths and symlink escapes.
- Saving a new project must not overwrite an existing destination implicitly.
- Reopening may select only an existing project within the same run.
- Preserve the run's saved projects across application restart, but never carry pending dialog replies into the next generation.

## Dialog boundary

Introduce a purpose-specific dialog interface at Main's existing call sites.
The production implementation calls Electron dialogs with the existing options and preserves current cancellation behavior.
The harness implementation is selected only by validated harness startup configuration; it returns a prepared one-shot reply without opening an OS window.
Use the same interface and harness behavior on macOS and Linux.

Supported purposes in this slice are `import-audio`, `save-project` and `open-project`, including explicit cancellation.
Other native dialogs in harness mode must fail explicitly rather than opening a window or choosing a default; dirty-project decisions and export remain unsupported.
The failure must be visible in harness diagnostics/events, not only in an application notification.

Add `redencut_prepare_dialog` to the existing MCP server with current `runId` and `generation`, a purpose and a typed selection: audio filename, project name or cancellation.
For `import-audio`, use `selection: { "type": "file", "filename": "mandarin-short-female.wav" }`; the fixture directory is fixed and does not depend on the caller's working directory.
Runtime validates and resolves the selection, serializes preparation with UI/lifecycle work and refuses to replace an unconsumed reply.
Use a generation-scoped file mailbox inside the isolated run directory to deliver the validated reply to Main; publish replies atomically and consume them once before returning a result.
Purpose mismatch or an unprepared request is an explicit error and must not leave a reply available for a later unrelated action.
Record preparation, consumption and rejection without exposing arbitrary renderer filesystem access or adding a second MCP/CDP connection.

Tests and AI must still click the real Import, Save and Open Project controls.
The adapter substitutes file selection only: selection tokens, IPC validation, import coordination, FFmpeg/cache generation and project persistence remain real.

## Acceptance scenario

1. Start an isolated empty application and capture the initial UI snapshot.
2. Prepare the `mandarin-short-female.wav` filename selection and click Import Audio through MCP.
3. Wait with a bounded deadline for import completion, one visible track and rendered waveform readiness; capture a screenshot.
4. Prepare a fresh project destination and click Save through MCP.
5. Wait for clean/not-busy state and a persisted project whose schema, media location and metadata are valid.
6. Capture the saved source ID, track identity, duration and imported media checksum as evidence.
7. Restart through Runtime without discarding unsaved changes; require the old Electron process to exit cleanly and the new generation to use a different process.
8. In the fresh generation, capture a snapshot, prepare the saved-project selection and click Open Project.
9. Verify the restored track name, source/track identity, duration, waveform readiness and clean state; capture a second screenshot.
10. Verify copied project media has the same SHA-256 as the supplied fixture, and the fixture itself remains unchanged; stop cleanly.

Derive expected source duration from independent FFprobe inspection, not from RedenCut's own imported metadata.
Waveform readiness must reflect successful data loading/rendering, not merely the presence of a canvas element; use a narrow read-only readiness observation if the UI lacks one.
Screenshots supplement assertions and are retained for inspection; a screenshot alone is not a pass condition.
All waits are bounded and tied to observable conditions rather than fixed sleeps.

## Organization and verification

- `src/main/dialogs/`: production dialog boundary and native implementation.
- Harness-only mailbox consumer/composition: a clearly named Main-side harness module, enabled only for isolated harness launches.
- `harness/dialogs/`: fixture/destination validation and reply preparation.
- `harness/mcp/` and `harness/runtime/`: expose and coordinate the new capability using existing generation and operation guards.
- `e2e/`: product workflow test and its runner configuration; not nested under `harness/`.
- `e2e/fixtures/audio/`: immutable input audio, separate from generated projects and evidence.

Write failing tests before implementation for reply consumption, purpose mismatch, missing preparation, cancellation, path restrictions and stale generation handling.
Verify the real import/save/reopen scenario in Docker, then rerun the existing harness normal/fault suite, container smoke tests and repository checks.
Do not launch host Electron for this verification or modify AI-client configuration.
Record failures and retained artifacts, and do not report playback or transcription as verified by this test.
