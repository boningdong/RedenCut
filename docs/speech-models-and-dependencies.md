# Speech Models and Dependencies

## Purpose

This document is the operational source of truth for external runtimes, engines, models, credentials, caches, and provisioning used by RedenCut speech features. Architectural contracts remain in the speech design specifications; exact package versions and model revisions become machine-enforced in their implementation lockfiles and manifests.

The first implementation has fixed defaults and no model-selection UI. Future transcription, alignment, diarization, disfluency-detection, and speech-generation engines remain independently replaceable.

## Application-managed preparation

Settings and onboarding now use ResourceManager to download the fixed multilingual transcription model and both Chinese and English alignment models into Electron userData's managed model directories.
They do not discover or migrate developer caches described below.
The native executable/Python runtime is prepared by the managed runtime scripts for development and release-resource staging; signed application packaging and distribution remain separate release work.
Downloads are staged, integrity checked and load-tested before installation, and can be canceled/resumed without changing existing project results.
Development acquisition of the optional diarization model requires HF access through runtime:setup; the application only validates and loads it offline. Packaged releases include the model.
Public files have pinned hashes in models.json; gated metadata must be verified with authorized immutable-revision metadata where public hashes are unavailable.
The base transcription model is the pinned multilingual base candidate; this integration does not establish production quality/performance acceptance.
The previous shell provisioning commands remain developer/harness utilities rather than the application's model discovery mechanism.

## Component roles

| Capability           | Product role                                 | Initial implementation                                                                                   | Runtime                        | Status      |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------- |
| Transcription        | Transcriber (`best-effort-verbatim`)         | whisper.cpp                                                                                              | Native executable              | Existing    |
| Alignment            | Alignment Engine (forced alignment)          | WhisperX alignment adapter with a manifest-pinned language model                                         | Python worker                  | Implemented |
| Speaker separation   | Diarization Engine (anonymous speakers)      | pyannote.audio `speaker-diarization-community-1`, invoked through the worker                             | Python/PyTorch worker          | Implemented |
| Process hosting      | Job-scoped alignment and diarization process | RedenCut JSON Lines speech worker                                                                          | Independent Python environment | Implemented |
| Intended transcript  | Intended Transcript Model                    | Replaceable model; CrisperWhisper is research-only unless its distribution terms permit the intended use | Separate detector dependency   | Deferred    |
| Disfluency detection | Hybrid Disfluency Detector                   | Transcript-diff evidence plus deterministic rules                                                        | Separate pipeline              | Deferred    |
| Speech generation    | Speech Generation Engine                     | Not selected                                                                                             | Separate pipeline              | Deferred    |

WhisperX is not RedenCut's canonical transcriber in the first version. whisper.cpp produces the canonical best-effort-verbatim text; WhisperX aligns that text and hosts the initial diarization integration.

Speech analysis reads the imported source's validated Float32 PCM cache and prepares one temporary 16 kHz mono PCM WAV for both engines. This supports imported containers such as AAC/M4A even when the local whisper.cpp build cannot read them directly. The temporary WAV is removed on success, failure, or cancellation; artifacts retain the original source identity and fingerprint. Known alignment failures carry stable worker error codes into main, where they map to concise localized reasons and one diagnostic ID per failed source. The application log and user-exported report contain allowlisted stage and code facts, without underlying paths, transcript text, stderr or engine exception messages.

## Sources of truth

Each dependency class has one version owner:

| Dependency class                   | Version/configuration owner                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Node/Electron harness dependencies | Root `package-lock.json` and container base-image digest/tag                                                                  |
| Python worker dependencies         | Worker `pyproject.toml` plus committed lockfile introduced with the worker                                                    |
| Native whisper.cpp executable      | `runtime/runtime-lock.json`, pinned build recipes and installed manifest; application lookup uses AppRuntimeLocator                                       |
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

The initial diarization model, [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1), requires accepted model conditions and an authenticated read token. Authentication proves access for the current account; it is not a project credential shared by RedenCut developers. WhisperX's current setup and CPU guidance are documented in its [official repository](https://github.com/m-bain/whisperX).

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
- Project-local `.redencut/cache` and `.redencut/speech` data.

Inside the container, `HF_HOME`, `HF_HUB_CACHE`, and engine-specific cache roots point into the named model volume. During authenticated provisioning only, `HF_TOKEN_PATH` points to `/run/secrets/hf_token`; no login command runs inside the container and the named volume never stores the credential. A model-provision command downloads the exact manifest revisions and verifies required files before marking the cache ready. Test startup never silently downloads a model.

Model-cache cleanup is an explicit scoped operation. Neither ordinary harness shutdown nor project cache cleanup removes the shared model volume.

## Environment profiles

### Standard Docker harness

The existing `redencut-harness` image remains the fast Node/Electron/UI environment. It does not gain Python, PyTorch, WhisperX, pyannote.audio, or model weights.

### Speech-enabled Docker harness

A separate `redencut-harness-speech` target extends the standard harness with:

- A pinned Python runtime and package manager.
- A locked RedenCut worker environment.
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

Provisioning downloaded only the manifest's required files into the dedicated `redencut-speech-models` Docker volume. A subsequent container received no token mount and reported all four snapshots ready. Approximate snapshot sizes were 75 MB for whisper.cpp tiny, 1.2 GB for Chinese alignment, 361 MB for English alignment, and 32 MB for diarization.

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
npm run runtime:setup
npm run runtime:check
npm run setup:speech-models
npm run speech:native:preflight
```

The native launcher uses the same username-agnostic token lookup as Docker. Its default model location is `$HOME/Library/Caches/RedenCut/speech-models` (or `$XDG_CACHE_HOME/RedenCut/speech-models` when set). The app never installs or downloads anything at startup. `REDENCUT_RUNTIME_ROOT` selects an explicit managed runtime in development and the Docker harness. Packaged builds always use `resources/runtime`. The legacy per-executable overrides, including `REDENCUT_SPEECH_WORKER_PYTHON`, are ignored; worker-source and model-cache settings remain separate from the interpreter.

### Reusing a model cache created before the rename

The new default cache location does not automatically discover an older installation's cache.
Set `REDENCUT_SPEECH_MODEL_CACHE` to the existing cache root (and use that same setting when starting the app), or move the cache to the current default location.
Then run `npm run setup:speech-models` followed by `npm run speech:native:preflight`; Docker users can select their existing volume with `REDENCUT_SPEECH_MODEL_VOLUME` and use the corresponding Docker commands.
Provisioning verifies every required file and the existing marker's model ID, repository and immutable revision before adding `.redencut-model.json` to a cache carrying a legacy `.riffcut-model.json` or `.podcut-model.json` marker.
The newest present marker takes precedence (RedenCut, then RiffCut, then PodCut); an invalid newer marker is never bypassed using an older marker.
This migration does not download or rewrite the model files, preserves the legacy marker, and can be repeated without rewriting a valid current marker.
A missing, malformed or mismatched marker, or an incomplete snapshot, fails explicitly instead of certifying an unverified cache.
The existing provisioning command still requires its configured token file; the app itself never provisions or migrates models at startup.

The implemented worker consumes exactly one versioned JSON Lines request, sends progress and one terminal response, writes diagnostics only to stderr, and exits. Version 1 bounds each request and response line at 32 MiB; this accommodates hour-scale canonical transcripts and alignment output while retaining a memory-safety limit. An early worker exit or closed stream becomes a settled job failure rather than an uncaught Electron process error. Normal analysis sets Hugging Face and Transformers offline modes and receives no token. The durable artifact records model repository IDs, immutable revisions, config hashes, schema versions, and timestamps; `project.json` stores a readable artifact path plus SHA-256 and byte length for integrity, never a hash as the user-facing filename.

The new adapter verification added two real CPU checks in the speech container: the Chinese aligner produced a valid non-empty result for the 13.5-second Mandarin fixture with no unaligned requested unit, and the diarization adapter processed the mixed conversation into 33 turns across three anonymous speaker labels. These remain plumbing smoke evidence, not quality scores.

## Maintenance rule

When adding or replacing a speech dependency, update this document in the same change that updates its lockfile or model manifest. Record its product role, runtime boundary, version owner, model source and immutable revision, license or access conditions, cache location, supported execution profiles, provisioning procedure, preflight behavior, and verification lane.

### Development onboarding

Non-bundled builds show read-only tool and Python import checks in Settings and onboarding.
Run `npm run runtime:setup` at the current project root, then click Validate in the app.
This prepares `.runtime/<platform>-<arch>` with FFmpeg, FFprobe, whisper-cli and a Python environment, and prepares optional diarization under `.runtime/models/diarization/<revision>`.
The setup command obtains its pinned uv tool; developers and end users do not need a separately installed uv for inference.
`speech:native:setup` remains a compatibility alias for existing scripts and older instructions, not a harness-specific requirement.
Model preparation is blocked until the required runtime checks pass; uv itself is only needed for environment setup.
Bundled builds omit developer instructions and validate their supplied runtime instead.

### Development login and validation feedback

Environment checks publish each item's checking/completed state through resource snapshots; completed tools need not wait visually for Python library imports.
The resource section headers share one icon/title scale, and collapsing text-editing details never changes feature preferences or active preparation.
Diarization acquisition happens only in `npm run runtime:setup`, never in onboarding or Settings.
The CLI guides registration and acceptance on the HF model page, then reads a hidden token or explicitly configured/local HF credentials.
Use `--skip-models` to continue without speaker recognition, `--models-only` to provision after installing the runtime, and `--import-model <directory>` to reuse a legacy installation after pinned-file verification and an offline load check.
The CLI stores no token in `.runtime`; inference runs offline without authentication.
The development Runtime panel displays the path and validates the installed model; missing or invalid files point back to the CLI.
`REDENCUT_MODELS_ROOT` explicitly overrides the development model root; packaged builds ignore it and use `resources/models`.
Native runtime availability remains independent of this optional model.

### Model preparation entry points

For the app, use Download in Text editing for Whisper and alignment models.
`npm run runtime:setup` prepares the managed runtime and diarization model; `setup:speech` remains a compatibility alias.
`npm run setup:speech-models` remains a separate standalone worker provisioning tool; it does not populate the application's model roots.
Release resource staging requires verified diarization weights and bundled license/attribution material; the full installer compliance/signing audit is a separate release gate.

### Resetting development app data

Exit RedenCut before using either command so running downloads or in-memory preferences cannot recreate cleared files.
`npm run clear:onboarding` resets only `onboardingDisposition` to `pending`; the next launch shows onboarding again while language, theme, feature preferences, credentials and models remain intact.
`npm run clear:models` removes the app-managed `models` and `staging` directories, including partial downloads. It preserves Python environments, credentials, preferences, projects, standalone worker caches and Hugging Face caches.
Both commands target Electron's default user-data directory for the package name (`~/Library/Application Support/redencut` on macOS), shared by normal worktrees.
Use `-- --dry-run` to preview, or `-- --user-data-dir /absolute/path` to target an isolated test profile.
These commands do not stop the running app automatically.

## Managed runtime artifact and release resources

The macOS ARM64 recipe pins FFmpeg 7.1.5, LAME 4.0, whisper.cpp 1.9.3 and a relocatable CPython 3.11.16 distribution.
FFmpeg uses shared libraries, disables GPL/nonfree/version3 components and automatic external codec discovery, and includes MP3 encoding through LAME.
PyAV 14.4.0 is built from source against that FFmpeg; TorchCodec 0.7.0 is paired with PyTorch 2.8 and patched to resolve the same relative libraries.
The CLI, PyAV and TorchCodec therefore use one native library artifact on this target, with both Python import orders checked.
The Linux ARM64 speech harness uses the supported in-memory waveform path without TorchCodec, whose wheel is unavailable for that target.

```sh
# Compile a bundle without installing it.
npm run runtime:build
# Install a supplied, validated bundle instead of compiling again.
npm run runtime:setup -- --bundle /absolute/path/to/bundle
# Prepare a NEW directory for the application packager.
npm run runtime:stage -- --resources-dir /absolute/path/to/new-resources
# Exercise installer/integrity failure behavior.
npm run test:runtime
```

Development resolves `.runtime/<platform>-<arch>` or an explicit `REDENCUT_RUNTIME_ROOT`; packaged applications resolve `resources/runtime` only.
The artifact includes `manifest.json`, executable and shared-library directories, the Python tree, source archives, build configuration, package metadata and license notices.
The setup tool uses its own hash-pinned uv download; uv, a global Python and Homebrew FFmpeg are not inference requirements.
Initial source builds still require the documented compiler/CMake/Ninja/pkg-config tools.
Models stay in their existing cache and projects retain their existing schemas.

Staging also copies the live worker source and model manifest, unchanged project license, and Electron/Chromium notices.
It is a resources input, not a signed application or proof of distribution compliance.
A final packager must preserve executable permissions/symlinks, keep native files outside `app.asar`, verify post-signing loading on a clean machine, and retain the corresponding LGPL source and replacement/relinking materials.
The original project code is licensed under Apache-2.0 following the sole contributor's authorization; third-party software and model licenses remain unchanged.
Dependency-notice completion and final distribution verification remain separate release work.
See the migration design and verification report under `docs/superpowers/` for decisions and evidence.

### Rebuilding or replacing LGPL libraries in an unsigned development build

1. Keep the distributed runtime's `sources/`, `licenses/`, build configuration and manifest together with the matching application checkout and Python lockfile.
2. Make a separate checkout for the modification; unpack the retained FFmpeg/LAME source archives, make the library changes, and retain the patch and changed-source archive.
3. Update that checkout's `runtime/runtime-lock.json` source URL and SHA-256 to identify a fetch-accessible modified archive, preserving or updating its expected `sourceDirectory`; retain the LGPL-compatible configuration and compatible FFmpeg major ABI, or rebuild dependent PyAV/TorchCodec code against the changed ABI.
   If Python dependencies change, update `speech-worker/pyproject.toml`, regenerate `speech-worker/uv.lock`, and update both SHA-256 entries under `runtime-lock.json.pythonDependencies`; same-ABI native-only changes do not require changing Python inputs.
4. Run `npm run runtime:build -- --work-dir /absolute/new-build-cache --bundle-dir /absolute/new-bundle` in the modified checkout.
   New cache and bundle directories prevent accidentally reusing the original recipe's artifacts; the build creates a new hash inventory from the deliberate source inputs.
5. Run `npm run runtime:setup -- --bundle /absolute/new-bundle --runtime-root /absolute/new-runtime`, then `node scripts/runtime/CheckRuntime.mjs --runtime-root /absolute/new-runtime`.
6. Start the development application with `REDENCUT_RUNTIME_ROOT=/absolute/new-runtime npm run dev` and exercise import/export and speech decoding.
   The runtime manifest checks consistency; it is not signed and does not require an application vendor's private key.
7. For an unsigned staged application, create fresh resources with `npm run runtime:stage -- --bundle /absolute/new-runtime --resources-dir /absolute/new-resources` and place those resources through the same application packager.

Do not replace an in-use runtime tree one file at a time, or merely change a file's hash while retaining provenance that describes a different source build.
The native recipe ad-hoc signs its macOS libraries after adjusting relative load paths; this is separate from Developer ID signing of a distributable application.
A future signed application still needs an independently verified user-replacement/re-signing procedure and all applicable distribution notices/source obligations before release.
