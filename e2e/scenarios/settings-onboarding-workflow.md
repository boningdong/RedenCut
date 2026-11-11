# Settings and onboarding workflow

## Goal

A first-time user chooses appearance, understands supported speech features, and can enter the editor without installing speech models; settings later exposes the same resource preparation state.

## Environment and fixtures

Run through the existing Docker MCP harness with a fresh isolated userData directory.
Application model preparation does not request credentials; no private token or real account is required for this UI workflow.
Gated developer diarization acquisition belongs to the model CLI and requires separate authorized acquisition checks; do not report UI readiness as proof of remote access.
The generated sample contains synthesized tones, not a speech-quality fixture.

## Mandatory checkpoints

| ID | Observable outcome |
| --- | --- |
| welcome | Fresh run shows one welcome heading, language and equal-width theme controls, compact skip/continue actions |
| preferences | Changing language/theme updates the current UI and does not create project edits |
| preparation | Text editing defaults on, Whisper and Chinese/English alignment are required, speaker recognition defaults on but remains optional |
| sequencing | Text-model preparation requires its runtime dependencies; speaker readiness is independently validated, with CLI-prepared development assets and bundled release assets |
| skip | User can skip to editor without downloading; reopen/restart does not automatically repeat welcome |
| settings | Bottom-right settings opens General, Theme, Models & dependencies and Diagnostics; General contains only language |
| persistence | Theme, language and feature preference survive restart |
| shared-state | Resource panel in Settings uses the same resource statuses and preparation actions as onboarding |
| model-safety | With missing resources, UI does not claim model readiness and offers no credential-entry or mock-only success controls |
| empty-project | Completing with an empty project creates an empty editor using normal transition safeguards |
| sample-project | Sample opens playable generated tones and can be edited/saved; previous user work is not silently lost |

## Additional resource integration checks

Use deterministic resource tests for byte-progress, canceled-download/resume, incompatible range responses and corrupted files.
Downloader and CLI credential tests separately cover invalid tokens and access denial; they do not establish an application login flow.
These checks establish resource handling, not real-model quality or remote authorization success.
A real-model run separately checks the load validator and enabled/disabled diarization outputs.

## Evidence

Retain MCP action logs and screenshots per owned run.
Record whether evidence comes from visible UI, deterministic resource tests or actual models.
Formal product acceptance and packaged-app acceptance remain separate from this development regression scenario.

## Development environment extension

- Non-bundled builds show local tool and Python runtime checks; packaged builds omit this card. Native package acceptance remains separate from Docker UI verification.
- Model downloads follow per-capability readiness and show actionable setup guidance. Whisper preparation needs FFmpeg and whisper-cli; alignment waits for the full managed environment, including its Python checks.
- Python instructions display `npm run setup:runtime` and the managed `.runtime` location; speaker-model instructions display `setup:models` with the selected model directory.
- Validate rechecks real executables/imports without installing anything or downloading models.
- With FFmpeg and whisper-cli ready, Whisper preparation remains available even if unrelated Python checks fail; alignment remains blocked until its environment is ready (deterministic checks). uv absence alone does not block an existing usable environment.
- Settings and onboarding expose the same development checks, including after skipping the welcome flow.

### Per-item progress and speaker readiness

- Each pending development check shows a spinner at the right-hand status location; completed rows show Ready while library checks continue (deterministic component and checker tests).
- Collapsing Text editing hides model controls without changing the feature switch or canceling downloads (visible Docker regression and component tests).
- Development speaker-model acquisition happens in the CLI, which guides HF access without exposing credentials; the UI validates prepared assets and does not download diarization.
- Packaged speaker recognition uses bundled Resources without local login or token entry; missing or invalid bundled assets remain unavailable.
- Actual developer-account gated access is separate from tests using synthetic tokens.
