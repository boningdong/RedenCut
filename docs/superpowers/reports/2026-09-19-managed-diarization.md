# Managed diarization migration — implementation and verification

## Outcome

Implemented in `codex/managed-diarization`, based on main `cd3f312` (original project code already Apache-2.0).
The worktree is retained at `/Users/boning/Workspaces/Podcut/.worktrees/managed-diarization`; no merge, push or publication is part of this task.
[Approved design](../specs/2026-09-19-managed-diarization.md) and [implementation plan](../plans/2026-09-19-managed-diarization.md) are archived alongside this report.

## Behavior and structure

- `npm run runtime:setup` remains the single developer entry point; it prepares native/Python runtime and optional diarization assets.
- Missing gated assets produce signup/conditions/login guidance and hidden token input; existing valid models reuse without credential lookup. `--skip-models` supports audio-only setup, `--models-only` avoids native rebuilding, and `--import-model` explicitly migrates a verified previous cache without deleting it.
- Dev models live at `.runtime/models/diarization/<revision>`; weights remain ignored by Git. Packaged model resolution uses `resources/models/diarization/<revision>` and ignores development overrides.
- The application removes HF access/token/download IPC, services and UI for diarization, cleans only its retired app-owned credential, and loads locally with credential-free offline validation.
- Runtime shows model path, checking/ready/missing/invalid state and Validate; missing/invalid assets point to CLI setup. Native readiness remains independent of the optional model.
- Speaker recognition retains its toggle and availability text. Whisper/alignment downloads remain in the app.
- ResourceState adds optional `source`; DevelopmentEnvironment adds optional managed diarization state `{id, revision, path, status, error?}`. Installation records remain `{id, repository, revision, files}`. Project/transcript schemas are unchanged.
- Release staging requires pinned model bytes and exactly five nonempty, regular, allowlisted notices with source/revision/attribution/change/model-card verification. Credentials and extra cache files are rejected from that notice bundle.

## Verification

| Check | Final evidence |
| --- | --- |
| Formatting, lint, Knip, TypeScript, application tests and production build | `npm run format` followed by `npm run check`; 170 test files / 1,300 tests pass; `/tmp/managed-check-final.log`. |
| Runtime/setup/staging suite | `npm run test:runtime`; 43 pass; `/tmp/managed-runtime-final.log`. |
| Python worker | Managed Python unittest discovery; 70 pass; `/tmp/managed-python-tests.log`. |
| Real acquisition | Fresh authenticated download of all five pinned HF files, exact size/SHA-256 checks, real offline pyannote loading and atomic installation; repeat returned reused. No credentials printed. |
| Real legacy import | Existing app model copied through explicit import, verified against pinned manifest and load-tested; original cache retained. |
| Release resources | Full native macOS arm64 resource stage passed and runtime ready; `/tmp/managed-release-stage.log`. After the notice-gate fix, model+notice staging repeated against actual files and passed; `/tmp/managed-stage-notices-final.log`. |
| Docker E2E | Full suite first returned 12 pass / 1 fail; failure was forced shutdown while model validation ran. Fixed with lifetime cancellation and pending-prepare guards; final targeted save/reopen test passed. No other E2E failures. |
| UI acceptance | Docker MCP baseline and managed model UI reports linked below; English/Chinese, dark/light, normal/narrow layouts, real validation, toggle and restart persistence checked. |
| Independent review | Whole-branch review identified two P2s and one stale README sentence; all fixed. Scoped rereview passed 5 staging tests and 7 managed-model tests, actual notices validated, no remaining concrete blocker in reviewed fixes. |

### E2E evidence

All runs are retained below `.harness-runs/container/` in this worktree.

| Coverage | Run(s) |
| --- | --- |
| Editing/playback and captured output | b9030777-83e0-439c-9ac6-8923f1cbeec7; 57318d30-9df8-44c4-aad2-52971c0ad127 |
| Transcript fixture editing | 1ff86330-a9a1-42e2-bfc4-2692944be527; 2cff5f42-24d6-44e8-b603-92009a145642 |
| Redact/export | 6bc6a6a3-50ac-48bf-802b-554e1e4ed33e |
| Settings/onboarding including missing runtime | eef08b05-c8b3-4be3-9c4f-6d4c8f711c93; fa4652e0-301b-4fb2-a2f1-01dc5754305a; b2c90e98-1cc1-4c73-a464-1f9b82dc2a54; e7bb1072-46ae-467e-abe2-631dbb1ff328 |
| Real speech analysis, durable editable transcript/reopen | 501480d2-7008-4e91-bcfa-a4b17d279c51 |
| Real overlapping track alignment, clip movement and undo | d38814d2-6396-4ee7-b6b0-e786b9228441 |
| Localization/restart | 823f8163-2daa-44c3-8b24-0b15461ea1c8 |
| Final fixed save/reopen/clean exit | 1e96c5a3-ea34-425a-ae93-1e342d8a98fd; `/tmp/managed-exit-final.log` |

The original failed save/reopen run 987b2052-edd6-4539-841f-cc88ac1af854 is retained for diagnosis, not presented as passing.
The full E2E suite was not needlessly repeated after the scoped shutdown fix; affected save/reopen and lifecycle unit tests were rerun on final source.

### Docker MCP reports

- [Editing baseline](../../../.harness-runs/container/84d8b3fb-a3ce-49af-af11-81caf0faf002/agent-testing-report.md).
- [Managed model UI / localized layouts](../../../.harness-runs/container/fbd44a48-d3e2-4b1f-b948-df1c99a7ca71/agent-testing-report.md).
- [Final source focused acceptance](../../../.harness-runs/container/b1e1e151-5e4c-4864-b7ec-8d6d79f23c06/agent-testing-report.md).

These local artifacts are ignored by Git; this durable report records their IDs and scope for traceability.
Baseline editor evidence predates late backend fixes, which do not change editing components. Final-source lifecycle behavior has fresh targeted E2E and MCP coverage.

## Review fixes

Model paths previously could be exposed after byte validation but before load validation; the manager now hydrates readiness and withholds invalid managed paths.
Quit while loading could await Python too long; lifetime cancellation now aborts validation, and deferred preparation checks shutdown before starting any download.
Release notices previously copied an incomplete directory; staging now validates the exact inventory and source/content identity, and copies each allowed file explicitly.
README no longer instructs users to authorize diarization in Settings.

## Remaining release checks and limitations

This is release-resource preparation, not a signed/notarized application or a legal certification of the entire dependency inventory.
Final installer inspection, native clean-machine launch, signing/notarization, full third-party dependency notices and LGPL replacement/relinking obligations remain deferred release work.
Packaged-only model roots and toggle-only rendering are covered by tests, not by a shipped installer.
Docker UI evidence does not verify native macOS/Windows window or assistive-technology behavior; speech inference passed but this task does not assess subjective diarization accuracy.
The existing Settings/onboarding scenario document still contains obsolete HF authorization checkpoints; its update was proposed and awaits explicit permission under the agent-testing skill. Approved replacement behavior was tested directly instead.

## Existing neighboring UI issue

Focused UI exploration reproduced that Escape on the closed Whisper Change selector is consumed, leaving Settings open.
`WhisperModelSelector.tsx` unconditionally handles Escape; both it and PreferencesDialog.tsx are unchanged from cd3f312, establishing this handler predates the migration.
The added model Validate control does close Settings correctly with Escape.
This existing issue is recorded as a failed exploration checkpoint in b1e1e151; it was not silently counted as a passing check or expanded into unrelated implementation work.

The pinned upstream model card is preserved byte-for-byte, including its existing trailing whitespace and final blank line, because release validation checks its upstream Git blob hash.
`git diff --cached --check` flags only this vendored file; the check excluding that exact upstream artifact passes. It was deliberately not reformatted.
