# Speech Models and Dependencies

## Purpose

This document is the operational source of truth for external runtimes, engines, models, credentials, caches, and provisioning used by RiffCut speech features. Architectural contracts remain in the speech design specifications; exact package versions and model revisions become machine-enforced in their implementation lockfiles and manifests.

The first implementation has fixed defaults and no model-selection UI. Future transcription, alignment, diarization, disfluency-detection, and speech-generation engines remain independently replaceable.

## Component roles

| Capability           | Product role                                 | Initial implementation                                                                                   | Runtime                        | Status      |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- |
| Transcription        | Transcriber (`best-effort-verbatim`)         | whisper.cpp                                                                                              | Native executable              | Existing    |
| Alignment            | Alignment Engine (forced alignment)          | WhisperX alignment adapter with a manifest-pinned language model                                         | Python worker                  | Implemented |
| Speaker separation   | Diarization Engine (anonymous speakers)      | pyannote.audio `speaker-diarization-community-1`, invoked through the worker                             | Python/PyTorch worker          | Implemented |
| Process hosting      | Job-scoped alignment and diarization process | RiffCut JSON Lines speech worker                                                                          | Independent Python environment | Implemented |
| Intended transcript  | Intended Transcript Model                    | Replaceable model; CrisperWhisper is research-only unless its distribution terms permit the intended use | Separate detector dependency   | Deferred    |
| Disfluency detection | Hybrid Disfluency Detector                   | Transcript-diff evidence plus deterministic rules                                                        | Separate pipeline              | Deferred    |
| Speech generation    | Speech Generation Engine                     | Not selected                                                                                             | Separate pipeline              | Deferred    |

WhisperX is not RiffCut's canonical transcriber in the first version. whisper.cpp produces the canonical best-effort-verbatim text; WhisperX aligns that text and hosts the initial diarization integration.

Speech analysis reads the imported source's validated Float32 PCM cache and prepares one temporary 16 kHz mono PCM WAV for both engines. This supports imported containers such as AAC/M4A even when the local whisper.cpp build cannot read them directly. The temporary WAV is removed on success, failure, or cancellation; artifacts retain the original source identity and fingerprint. Preparation and engine failures display a fixed, stage-specific recovery message, while underlying paths and engine diagnostics remain in the main-process log.

## Sources of truth

Each dependency class has one version owner:

| Dependency class                   | Version/configuration owner                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Node/Electron harness dependencies | Root `package-lock.json` and container base-image digest/tag                                                                  |
| Python worker dependencies         | Worker `pyproject.toml` plus committed lockfile introduced with the worker                                                    |
| Native whisper.cpp executable      | Availability descriptor plus recorded executable version; installation remains external                                       |
| Model repositories                 | Committed speech-model manifest containing repository ID, immutable revision, purpose, license/terms note, and expected files |
| Engine defaults                    | Validated speech-engine configuration, hashed into artifact provenance                                                        |
| Test fixtures and expectations     | Repository `e2e/fixtures/audio/` and named speech acceptance scenarios                                                        |

Do not rely on a floating model branch, an unrecorded auto-selected alignment model, or whatever happens to be present in a developer cache. If WhisperX selects an alignment model by language, the resolved model ID and immutable revision must still be captured in the request result and provenance; supported first-version languages must have tested defaults in the model manifest.

Secrets, host-specific absolute paths, and account names are never versioned configuration.

## Hugging Face authentication

### Developer prerequisites

A developer who provisions a gated model must:

1. Create or use their own Hugging Face account.
2. Accept the conditions for every gated model in the committed manifest.
3. Authenticate locally with `hf auth login` using a read token.
4. Verify the active account with `hf auth whoami` without printing the token.

The initial diarization model, [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1), requires accepted model conditions and an authenticated read token. Authentication proves access for the current account; it is not a project credential shared by RiffCut developers. WhisperX's current setup and CPU guidance are documented in its [official repository](https://github.com/m-bain/whisperX).

### Username-agnostic Docker mount

The flow is username agnostic when the launcher resolves the token path rather than embedding `/Users/<name>` or a Hugging Face account name.

Resolution order on the supported macOS/Linux developer hosts is:

1. Explicit `HF_TOKEN_PATH`.
2. `HF_HOME/token` when `HF_HOME` is configured.
3. The Hugging Face platform default, which is under the current user's cache directory.

This order follows the documented [`HF_TOKEN_PATH` and `HF_HOME` behavior](https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables).

The launcher validates that the resolved value is a regular readable file and mounts only that file:

```text
host resolved token file  --read-only-->  /run/secrets/hf_token
```

The container path is stable; the host username and account name are irrelevant. Another developer can follow the same flow after logging in with their own account and accepting the same gated-model conditions.

The token must not be copied into the Docker build context, image layer, named model volume, source snapshot, environment diagnostics, command-line arguments, logs, project artifacts, or retained harness evidence. The worker reads the mounted file into memory only when authenticated provisioning is requested. Ordinary cached test runs should not receive the token mount when all required models are already present and verified.

## Model cache separation

The speech-enabled harness uses a dedicated named Docker volume for downloaded models. It is separate from:

- The read-only token bind mount.
- The read-only source checkout.
- Per-container `node_modules` and build-output volumes.
- Per-run `.harness-runs` evidence.
- Project-local `.riffcut/cache` and `.riffcut/speech` data.

Inside the container, `HF_HOME`, `HF_HUB_CACHE`, and engine-specific cache roots point into the named model volume. During authenticated provisioning only, `HF_TOKEN_PATH` points to `/run/secrets/hf_token`; no login command runs inside the container and the named volume never stores the credential. A model-provision command downloads the exact manifest revisions and verifies required files before marking the cache ready. Test startup never silently downloads a model.

Model-cache cleanup is an explicit scoped operation. Neither ordinary harness shutdown nor project cache cleanup removes the shared model volume.

## Environment profiles

### Standard Docker harness

The existing `riffcut-harness` image remains the fast Node/Electron/UI environment. It does not gain Python, PyTorch, WhisperX, pyannote.audio, or model weights.

### Speech-enabled Docker harness

A separate `riffcut-harness-speech` target extends the standard harness with:

- A pinned Python runtime and package manager.
- A locked RiffCut worker environment.
- PyTorch, WhisperX, and pyannote.audio.
- Native libraries required by the locked packages.
- whisper.cpp plus the configured smoke transcription model when the full product pipeline is exercised.
- Preflight and explicit model-provision commands.

The validated development environment is OrbStack running Linux ARM64. This environment uses CPU inference. Its real-model smoke test verifies installation, worker protocol, model loading, alignment, diarization, canonical normalization, project publication, reopen, and UI projection with a short conversation fixture. It is not a quality or acceleration benchmark.

CPU thread count, worker concurrency, memory limits, and timeouts are explicit harness configuration. Only one heavy speech job runs at a time in the first version.

### Native macOS

Native macOS is the product environment and quality/performance acceptance target. It uses the existing local whisper.cpp transcriber and the independently installed worker environment. Worker CPU execution is the required baseline; acceleration is accepted only after the pinned stack demonstrates it on the supported Mac architecture.

Native acceptance uses representative full fixtures and records engine/model provenance, elapsed time, failures, and quality observations. It must not claim CUDA coverage.

### Native Linux with NVIDIA

CUDA validation requires a native Linux host with a supported NVIDIA GPU, driver, CUDA runtime, and matching PyTorch build. It is a separate optional acceptance profile and is not blocked on the Linux ARM64 Docker smoke path.

## Provisioning and preflight

Provisioning and testing are separate operations.

Provisioning must:

1. Validate runtime and architecture.
2. Validate the manifest and free disk space.
3. Resolve credentials without logging them.
4. Download exact model revisions into a staging cache location.
5. Verify expected repository revisions and files.
6. Atomically mark that model set ready.

Preflight must report distinct actionable failures for:

- Missing or incompatible worker runtime.
- Missing native executable or shared library.
- Missing token file when authenticated download is requested.
- Authenticated account lacking gated-model access.
- Missing, partial, corrupt, or wrong-revision model files.
- Unsupported execution backend for the current architecture.
- Insufficient writable cache space.

A normal analysis job consumes an already provisioned model set. It does not install packages, authenticate, accept licenses, or download models.

## Verification lanes

| Lane                | Environment                     | Models                                              | Purpose                                                      |
| ------------------- | ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Fast                | Host or standard Docker harness | Deterministic adapters/fixtures                     | Domain, protocol, cancellation, transaction, and UI behavior |
| Real-model smoke    | Linux ARM64 speech harness, CPU | Pinned small/default smoke models and short fixture | Real dependency and end-to-end integration                   |
| Quality/performance | Native macOS                    | Product defaults and representative full fixtures   | Product quality, runtime, and resource evidence              |
| CUDA acceptance     | Native Linux plus NVIDIA        | Product defaults                                    | Optional GPU compatibility and performance                   |

A deterministic adapter is valid supplementary coverage but cannot be reported as real-model verification. Likewise, a successful CPU smoke run cannot be reported as evidence of production quality, Metal acceleration, or CUDA support.

## Current verified facts and remaining work

As of 2026-09-09, a developer-side access check established:

- A developer-owned Hugging Face account with the required model conditions accepted was active.
- Docker was OrbStack Linux ARM64.
- Mounting the host token file read-only at `/run/secrets/hf_token` allowed an authenticated request for `pyannote/speaker-diarization-community-1/resolve/main/config.yaml` to return HTTP 200.
- No model was downloaded and no repository code was changed by that check.
- The Linux ARM64 container is a CPU target; CUDA acceptance requires native Linux plus NVIDIA hardware.

That side-conversation check established credential forwarding and gated repository access only. The implementation evidence below supersedes some of its remaining unknowns; alignment correctness, production diarization quality, representative runtime and memory, and cancellation behavior still require their later acceptance tasks.

### Speech harness implementation evidence

The first implementation pass on 2026-09-09 added a separate Linux ARM64 CPU image and verified the following locked environment:

| Component      | Pinned version |
| -------------- | -------------- |
| Python         | 3.11           |
| uv             | 0.12.12        |
| PyTorch        | 2.8.0 CPU      |
| torchaudio     | 2.8.0          |
| WhisperX       | 3.8.6          |
| pyannote.audio | 4.0.7          |

The committed model manifest uses immutable revisions:

| Capability                      | Repository                                            | Revision                                   |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| whisper.cpp smoke transcription | `ggerganov/whisper.cpp`                               | `5359861c739e955e79d9a303bcbc70fb988958b1` |
| Chinese alignment               | `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn` | `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd` |
| English alignment               | `facebook/wav2vec2-base-960h`                         | `22aad52d435eb6dbaf354bdad9b0da84ce7d6156` |
| Speaker diarization             | `pyannote/speaker-diarization-community-1`            | `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` |

Provisioning downloaded only the manifest's required files into the dedicated `riffcut-speech-models` Docker volume. A subsequent container received no token mount and reported all four snapshots ready. Approximate snapshot sizes were 75 MB for whisper.cpp tiny, 1.2 GB for Chinese alignment, 361 MB for English alignment, and 32 MB for diarization.

An offline load of the pinned pyannote pipeline succeeded. A real CPU smoke run on the first 20 seconds of `mandarin-conversation-mix.wav`, preloaded as an in-memory 48 kHz waveform, completed and returned nine turns across three anonymous speaker labels. This proves model loading and inference plumbing only; it is not a diarization-quality acceptance result.

Linux ARM64 has no compatible `torchcodec` wheel in this stack. The worker must therefore decode or convert audio outside pyannote and pass `{"waveform": Tensor, "sample_rate": number}`. The container smoke used this supported in-memory path. The remaining `torchcodec` warning at pyannote import is expected; any attempt to pass a filename directly is an implementation error.

Current developer commands are:

```sh
npm run speech:docker:build
npm run speech:docker:provision
npm run speech:docker:preflight
```

Only `speech:docker:provision` forwards the read-only Hugging Face token. `speech:docker:preflight` verifies the persistent model volume without credentials or downloads.

For native macOS development, dependency installation and model provisioning are also explicit:

```sh
npm run speech:native:setup
npm run speech:native:provision
npm run speech:native:preflight
```

The native launcher uses the same username-agnostic token lookup as Docker. Its default model location is `$HOME/Library/Caches/RiffCut/speech-models` (or `$XDG_CACHE_HOME/RiffCut/speech-models` when set). The app never installs or downloads anything at startup. `RIFFCUT_SPEECH_WORKER_ROOT`, `RIFFCUT_SPEECH_WORKER_PYTHON`, `RIFFCUT_SPEECH_MODEL_CACHE`, and `RIFFCUT_SPEECH_MANIFEST` can point a development or packaged build at an independently managed runtime.

### Reusing a model cache created before the rename

The new default cache location does not automatically discover an older installation's cache.
Set `RIFFCUT_SPEECH_MODEL_CACHE` to the existing cache root (and use that same setting when starting the app), or move the cache to the current default location.
Then run `npm run speech:native:provision` followed by `npm run speech:native:preflight`; Docker users can select their existing volume with `RIFFCUT_SPEECH_MODEL_VOLUME` and use the corresponding Docker commands.
Provisioning verifies every required file and the existing marker's model ID, repository and immutable revision before adding `.riffcut-model.json` to a cache carrying the legacy `.podcut-model.json` marker.
This migration does not download or rewrite the model files, preserves the legacy marker, and can be repeated without rewriting a valid current marker.
A missing, malformed or mismatched marker, or an incomplete snapshot, fails explicitly instead of certifying an unverified cache.
The existing provisioning command still requires its configured token file; the app itself never provisions or migrates models at startup.

The implemented worker consumes exactly one versioned JSON Lines request, sends progress and one terminal response, writes diagnostics only to stderr, and exits. Version 1 bounds each request and response line at 32 MiB; this accommodates hour-scale canonical transcripts and alignment output while retaining a memory-safety limit. An early worker exit or closed stream becomes a settled job failure rather than an uncaught Electron process error. Normal analysis sets Hugging Face and Transformers offline modes and receives no token. The durable artifact records model repository IDs, immutable revisions, config hashes, schema versions, and timestamps; `project.json` stores a readable artifact path plus SHA-256 and byte length for integrity, never a hash as the user-facing filename.

The new adapter verification added two real CPU checks in the speech container: the Chinese aligner produced a valid non-empty result for the 13.5-second Mandarin fixture with no unaligned requested unit, and the diarization adapter processed the mixed conversation into 33 turns across three anonymous speaker labels. These remain plumbing smoke evidence, not quality scores.

## Maintenance rule

When adding or replacing a speech dependency, update this document in the same change that updates its lockfile or model manifest. Record its product role, runtime boundary, version owner, model source and immutable revision, license or access conditions, cache location, supported execution profiles, provisioning procedure, preflight behavior, and verification lane.
