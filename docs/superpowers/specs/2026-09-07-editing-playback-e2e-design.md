# Editing and Playback E2E Design

## Scope and approved boundaries

Add two product E2Es: split/move/save/reopen, and play/pause/seek/resume.
First provide container-only virtual audio output and recording, shared by both flows.
The initial virtual-audio implementation supports Docker containers only; native macOS, Windows and non-container Linux execution are out of scope.
Audio-dependent E2Es must check this prerequisite before launching Electron and fail with an actionable Docker command when invoked outside the supported environment, rather than silently skipping assertions or using host audio.
Document this restriction in the E2E and container READMEs and keep the existing audio-capture-independent import/save/reopen test separately runnable.
All application actions use the existing MCP UI tools and native-dialog preparation; do not add semantic split, move, seek or play MCP methods.
Do not expose additional application state, read stores/player internals, or assert new flows through hidden clip attributes or project JSON.
Observe rendered controls, visible time labels, timeline geometry, waveform screenshots and actual audio output.
Existing import/save/reopen coverage remains unchanged.
Do not launch host Electron, change AI-client configuration, connect host audio devices, or modify unrelated work.

## Audio subsystem

Use a private per-container PulseAudio server with one named null sink at 48 kHz and its monitor source.
This is preferred to a full PipeWire stack for the limited output/capture requirement; application-side audio interception is excluded because it would bypass the output path under test.
The container startup owns audio-server initialization, readiness timeout and stderr logging alongside the existing virtual display.
Electron inherits the private audio connection and explicit output selection; no host socket, microphone, sound device or TCP audio endpoint is exposed.
Capture code under `harness/audio/` owns one bounded recording process at a time and writes WAV plus capture logs into the active run's artifacts.
Start capture and confirm readiness before UI playback; stop and finalize it in cleanup, including failed tests.
Application restart must not leave a recording spanning generations: stop/finalize before restart and explicitly begin a fresh capture afterwards.
Missing devices, capture failure or premature exit fail explicitly; never silently skip audio assertions or fall back to host sound.
Audio capture is test infrastructure, not a new product API or mandatory new MCP method.

The null-sink monitor mechanism is documented in [PulseAudio modules](https://wiki.freedesktop.org/www/Software/PulseAudio/Documentation/User/Modules/).
Compatibility with the pinned Electron image still requires an actual container bring-up test.

## UI interaction and assertions

Use existing Playwright MCP click, key and pointer-drag operations directly.
Read visible element geometry and ruler labels to derive coordinates; use a stable viewport and explicit zoom/scroll setup rather than absolute screen coordinates.
Prefer accessible names and existing visible UI structure; do not add hidden state solely to satisfy assertions.
Keep test steps inline initially and extract only repeated operations into ordinary E2E code, not MCP tools.
Use bounded polling and documented pixel/time tolerances; do not rely on fixed sleeps as the sole readiness condition.
If visible UI cannot support a reliable assertion, report the limitation and ask before introducing an internal observation interface.

## Flow 1: split, move, save, reopen

Import the existing `mandarin-short-female.wav` through the UI.
Seek to an interior point using visible time controls/ruler and press `S` with editor focus.
Assert two visible clip regions and their boundary against the ruler.
Drag the second region to a distinct later position that creates an observable gap, avoiding an ambiguous snap target.
Assert that the first region remains in place and that the second changes position without changing its rendered duration.
Save, fully restart Electron and open the saved project through the UI.
Assert the restored two-region layout, gap and visible waveforms against the pre-save view with explicit tolerances.
Use UI playback and captured output to verify audio remains audible after reopening; do not interpret audibility alone as sample-exact edit correctness.
Retain before/after/reopened screenshots, trace and recorded output.

## Flow 2: play, pause, seek, resume

Import the same fixture in an isolated project and begin capture before clicking Play.
Assert the visible button changes to Pause, the displayed time advances, and recorded output includes sustained non-silent audio.
Click Pause; assert the displayed time stabilizes and output becomes silent after a bounded buffer-drain allowance.
Seek to a visibly distinct interior position while paused, verify the visible time and that playback does not resume by itself.
Resume; assert the displayed time advances from the selected position and sustained audio returns.
Pause before cleanup; save the test project or use the existing explicit test-discard lifecycle option for this isolated run, since pausing does not clear dirty state.
Non-silence checks use sustained windows and thresholds to reject isolated clicks; speech pauses must not be mistaken for broken output.
This slice proves UI transport behavior and real output, not sample-exact source-position matching, device latency or host speaker behavior.

## File responsibilities

- `harness/container/`: audio dependencies, private server configuration, startup/readiness and container shutdown integration.
- `harness/audio/`: recording process lifecycle and capture-format handling, independently unit tested.
- `harness/tests/`: virtual-output integration and cleanup/failure checks.
- `e2e/`: the two product flows and narrowly scoped recording analysis assertions.
- `.harness-runs/`: generated screenshots, recordings, trace and logs; never source fixtures.

## Verification and rollout

First prove the virtual device and capture path in isolation, including a negative silence case and cleanup.
Then prove real Podcut UI playback reaches that capture path; a standalone tone played by another process is insufficient product evidence.
Implement the editing flow, followed by the transport flow; rerun each to detect coordinate/timing flakiness.
Run all product E2Es, the full Docker harness suite, host-to-container stdio smoke tests and repository `npm run check`.
Inspect screenshots and retained audio evidence; report what is and is not certified.
Do not weaken failures into skips or change product behavior without explaining the issue and obtaining approval where scope expands.
