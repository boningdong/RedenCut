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

## Header alignment correction

The user identified a visual defect missed in the initial review: the path was a separate paragraph below the disclosure button, so the icon centered only on the title.
The title/badge/chevron and path now form one two-line block inside the header; the icon and status align with that block, matching Audio editing.
Removed obsolete subtitle padding and the inherited transparent button border, which otherwise offset the text by 1px.
Fresh Docker inspection measured equal 69px headers and 45px text blocks with matching left edges; checked both dialog consumers, expanded/collapsed, Space/Enter/Escape, English/Chinese, dark/light, normal/narrow widths.
Final evidence: .harness-runs/container/017b821e-d3df-4278-acc8-369ab3b91feb/agent-testing-report.md and agent-1–4.png.
The full npm run check passed again: 167 files / 1260 tests, lint, dead-code analysis, type checking and production build.
The initial visual-consistency claim above is superseded for header alignment by this correction and fresh evidence.
