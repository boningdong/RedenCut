# Settings and onboarding workflow

## Goal

A first-time user chooses appearance, understands supported speech features, and can enter the editor without installing speech models; settings later exposes the same resource preparation state.

## Environment and fixtures

Run through the existing Docker MCP harness with a fresh isolated userData directory.
No private token or real account is required for the unauthenticated path.
Real gated downloads require a separately provided test account and real runtimes; lack of those capabilities must not be reported as model-download success.
The generated sample contains synthesized tones, not a speech-quality fixture.

## Mandatory checkpoints

| ID | Observable outcome |
| --- | --- |
| welcome | Fresh run shows one welcome heading, language and equal-width theme controls, compact skip/continue actions |
| preferences | Changing language/theme updates the current UI and does not create project edits |
| preparation | Text editing defaults on, Whisper and Chinese/English alignment are required, speaker recognition defaults on but remains optional |
| sequencing | Speaker authorization is locked until base resources are ready; explicit verification precedes gated download |
| skip | User can skip to editor without downloading; reopen/restart does not automatically repeat welcome |
| settings | Bottom-right settings opens General, Theme and Models & dependencies; General contains only language |
| persistence | Theme, language and feature preference survive restart |
| shared-state | Resource panel in Settings uses the same resource statuses and preparation actions as onboarding |
| model-safety | With no token/resources, UI does not claim authorization or model readiness and has no mock-only success controls |
| empty-project | Completing with an empty project creates an empty editor using normal transition safeguards |
| sample-project | Sample opens playable generated tones and can be edited/saved; previous user work is not silently lost |

## Additional resource integration checks

Use deterministic transport fixtures for repeatable byte-progress, canceled-download/resume, incompatible range response, corrupted files, invalid token and access-denied checks.
These establish application behavior, not real-model quality or remote authorization success.
A real-model run separately checks the load validator and enabled/disabled diarization outputs.

## Evidence

Retain MCP action logs and screenshots per owned run.
Record whether evidence comes from visible UI, deterministic resource tests or actual models.
Formal product acceptance and packaged-app acceptance remain separate from this development regression scenario.

## Development environment extension

- Non-bundled builds show local tool and Python runtime checks; packaged builds omit this card (unit coverage until packaging).
- A missing runtime disables model download and explicitly points to the setup section.
- Python instructions display `npm run setup:speech` and the current project's `speech-worker/.venv` location.
- Validate rechecks real executables/imports without installing anything or downloading models.
- A prepared runtime unlocks model download; uv absence alone does not block an existing usable environment (deterministic checks).
- Settings and onboarding expose the same development checks, including after skipping the welcome flow.

### Per-item checks and local login

- Each pending development check shows a spinner at the right-hand status location; completed rows show Ready while library checks continue (deterministic component and checker tests).
- Collapsing Text editing hides model controls without changing the feature switch or canceling downloads (visible Docker regression and component tests).
- In development authorization, detect local credentials without displaying them, then explicitly verify access before permitting gated downloads (synthetic credential/service/component tests).
- Bundled authorization does not expose or read local login; manual encrypted token entry remains available.
- Actual developer-account gated access is separate from tests using synthetic tokens.
