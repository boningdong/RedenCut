# Runtime source UI

## Approved design

The user approved the revised mock with a Runtime title and small .runtime/darwin-arm64 path below it.
Resolved tool paths sit below their names; Python libraries list WhisperX, PyTorch, pyannote.audio, PyAV and TorchCodec with the managed site-packages location.
Use existing icon, disclosure, status and guide/validation actions.

## Implementation

AppRuntimeLocator supplies the selected root without requiring it to be installed; project-contained roots display relative to the app project, while external overrides show their actual absolute path.
DevelopmentEnvironmentChecker includes transient root/path metadata in existing resource snapshots, derived from validated executable resolution and the pinned CPython 3.11 directory layout.
The renderer uses this metadata, keeps the root visible while collapsed, and wraps long paths.
English and Chinese titles and runtime-error guidance were updated; no project schema or persisted user data changed.

## Verification

npm run format and npm run check passed: 167 test files, 1260 tests, lint, dead-code analysis, type checking and production build.
The location test first failed before implementation, then passed with the full suite.
A real macOS managed check returned ready=true, .runtime/darwin-arm64, bin/ffmpeg, bin/ffprobe, bin/whisper-cli, python/bin/python3 and python/lib/python3.11/site-packages.
Docker UI acceptance covered onboarding and Settings, actual external-root display, missing-runtime state, collapse/expand, guide, keyboard Validate, Escape, English/Chinese, dark/light and normal/narrow widths.
Evidence: .harness-runs/container/8bfaa048-46c2-426b-ade8-6af38e80e9a0/agent-testing-report.md and agent-mcp.jsonl.
Existing editing baseline evidence was reused only for unchanged editor/audio/persistence surfaces; native macOS UI and new speech-quality tests were not run for this presentation change.
