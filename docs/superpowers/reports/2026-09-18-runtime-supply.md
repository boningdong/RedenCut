# Task 1: managed runtime supply report

## Outcome

Task 1 produced and installed a real macOS ARM64 managed runtime at `.runtime/darwin-arm64` with runtime ID `redencut-darwin-arm64-20260918`.
The installed artifact is 1.1 GB and its manifest inventories 30,819 files by SHA-256.
It contains FFmpeg, ffprobe, libmp3lame, whisper.cpp, a relocatable CPython 3.11.16 distribution, the locked speech-worker Python environment, source archives, license texts, Python distribution metadata, and native build evidence.

The application-facing manifest contract is schema version 1 with `runtimeId`, `platform`, `arch`, `executables`, `components`, and `files`.
The full artifact exposes `bin/ffmpeg`, `bin/ffprobe`, `bin/whisper-cli`, and `python/bin/python3` as root-relative entrypoints.

## Locked supply

The version-controlled lock records these runtime sources:

| Component | Version | License declaration | Source SHA-256 |
| --- | --- | --- | --- |
| FFmpeg | 7.1.5 | LGPL-2.1-or-later | `de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f` |
| LAME | 4.0 | LGPL-2.0-only | `3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb` |
| whisper.cpp | 1.9.3 | MIT | `1650f884effba487025143bd8facd2f9fb40a83b3737a732803c67a8d659d9c0` |
| CPython source | 3.11.16 | PSF-2.0 | `91bcdebfdde239a003ae93738a7fce0f9230fee5c4bc2b86f6e6e8c6f98aabe8` |
| python-build-standalone | 3.11.16+20260901 | PSF-2.0 AND MPL-2.0 | `50424fa409e8ae84b82a3052522f64695b47dff2158b70bb7358e0ebd6c085c9` |
| PyAV source | 14.4.0 | BSD-3-Clause | `3ecbf803a7fdf67229c0edada0830d6bfaea4d10bfb24f0c3f4e607cd1064b42` |

The setup-only uv tool is pinned to 0.12.12.
Its official archive SHA-256 is `46740540b63fdee9a6cb2e19baf3f1f475b850c440a33e63455087a6871263f1`, and the extracted executable SHA-256 is `53cf843c2eed12d1cafdaab7a1ba95e53496f7df280fc2be4fa8f3d7c32a1496`.
BuildRuntime downloads and verifies that archive and invokes only its absolute extracted path; uv is not included in or required by the inference runtime.
The lock also fingerprints `speech-worker/pyproject.toml` and `speech-worker/uv.lock`, so dependency changes cannot silently reuse a stale Python environment.

PyAV is pinned to 14.4.0 and built from source against the managed FFmpeg 7 libraries.
TorchCodec 0.7.0 and PyAV both resolve the runtime's major-version dylibs through relative loader paths.

## Build and installation controls

The FFmpeg build uses shared libraries and includes `--disable-autodetect`, `--disable-gpl`, `--disable-nonfree`, `--disable-version3`, and `--enable-libmp3lame`.
The resulting FFmpeg reports `LGPL version 2.1 or later` and has no Homebrew loader dependency.
FFmpeg, ffprobe, PyAV, TorchCodec, and the inspected FFmpeg/LAME dylibs use `@rpath`, `@loader_path`, `/usr/lib`, or `/System/Library` dependencies only.

whisper.cpp is built statically into `whisper-cli` with `GGML_NATIVE=OFF`, an ARMv8-A CPU baseline, Accelerate, Metal enabled, and embedded Metal kernels.
This avoids requiring a separate Metal resource file at runtime.

Native cache reuse requires both an exact locked recipe fingerprint and a complete SHA-256 inventory of the prior prefix output.
When compilation is required, the corresponding pinned archive is freshly extracted before configure/CMake runs, and an incomplete prior whisper build directory is removed.
A modified cache output, modified dependency lock, or stale recipe produces a clear rebuild-needed failure rather than a new manifest.
The extracted uv executable is independently hash-checked on every reuse and restored from the verified archive if it was modified.

The installer copies with verbatim relative symlinks, validates every manifest hash, runs a full readiness probe in staging, atomically selects the staged directory, runs the same probe at the final path, and only then deletes the previous generation.
A staging, architecture, load, or final-location failure restores the previous generation.
Precompiled Python bytecode is removed before manifest creation, and all isolated Python probes use `-B`; runtime processes also set `PYTHONDONTWRITEBYTECODE=1`.

Managed execution removes `PYTHONHOME`, `PYTHONUSERBASE`, inherited `PYTHONPATH`, and every `LD_*` and `DYLD_*` variable.
Python inference receives `PATH=<runtime>/bin` so WhisperX's bare `ffmpeg` subprocess cannot fall back to a system executable.
`RunPython.mjs` permits one explicit `--python-path` for development source while preserving that native runtime boundary.

## Script interfaces

```text
node scripts/runtime/BuildRuntime.mjs [--work-dir PATH] [--bundle-dir PATH]
node scripts/runtime/SetupRuntime.mjs [--bundle PATH] [--runtime-root PATH]
node scripts/runtime/CheckRuntime.mjs [--runtime-root PATH]
node scripts/runtime/RunPython.mjs --runtime-root PATH [--python-path PATH] -- <python args>
node scripts/runtime/VerifyRuntimeOperations.mjs [--runtime-root PATH] [--output PATH]
```

The full native build intentionally rejects targets other than `darwin-arm64` because they have not been certified by this supply lane.

## TDD and verification evidence

The installer tests were introduced before the installer implementation for mismatched hashes, traversal, and incomplete staged replacement and failed in the initial red run.
The relative-symlink relocation test then reproduced Node `fs.cp` converting a portable Python link into an absolute link; the focused red run failed 1/1 before `verbatimSymlinks: true` and passed after the fix.
Later red/green coverage added staged load failure, wrong architecture, final-location-only failure rollback, dependency fingerprint drift, native cache output tampering, modified source extraction, and uv executable tampering.

Final script suite:

```text
node --test scripts/runtime/*.test.mjs
tests 22; pass 22; fail 0
```

The committed build script was exercised from empty native work and bundle destinations:

```text
node scripts/runtime/BuildRuntime.mjs \
  --work-dir .runtime/build-cache-final \
  --bundle-dir .runtime/build/darwin-arm64-bundle-final
```

That run downloaded and hash-verified its own uv and sources, compiled LAME/FFmpeg/whisper.cpp, built PyAV from source, installed the hash-locked Python environment, generated native output markers and compliance inventory, and validated the completed bundle.
The final license-inventory-only assembly reused those verified output markers to create `darwin-arm64-bundle-final2`, which was installed as `.runtime/darwin-arm64` through both staging and final-path readiness probes.

Setup and relocation cases exercised successfully:

- installation into an empty `.runtime/darwin-arm64` destination;
- repeated installation over an existing validated generation, including the final2 replacement;
- installation into a separate `/tmp/.../resources/runtime` relocation followed by readiness checking;
- repeated readiness checks after Python imports without manifest drift.

The controller's final staged release directory passed three consecutive checks.
After the final installed checks, operations probe, and 70-test worker run, `.runtime/darwin-arm64` contains zero `.pyc`/`.pyo` files and zero `__pycache__` directories.

`CheckRuntime` validates all 30,819 file hashes and runs the following fresh-process probes:

- each native entrypoint loads without injected loader variables;
- TorchCodec is imported before PyAV and `AudioDecoder.get_all_samples()` decodes real audio;
- PyAV is imported first in a separate process, followed by TorchCodec, torch, WhisperX, and pyannote.audio;
- `whisperx.load_audio()` decodes through the runtime-only `PATH`.

Actual audio operations passed on the final installed runtime:

- trim, two-input mix, and 48 kHz to 16 kHz resampling;
- WAV, MP3 through libmp3lame, AAC/M4A, and FLAC encoding and ffprobe decoding;
- 11,200 samples decoded independently by TorchCodec and WhisperX;
- portable dependency inspection for FFmpeg, ffprobe, libavcodec, libavformat, libmp3lame, PyAV, and TorchCodec.

Machine-readable evidence: `task-1-runtime-operations.json`.

The managed Python interpreter ran the speech worker's complete standard-library test suite with the development source path supplied explicitly:

```text
Ran 70 tests in 0.080s
OK
```

Log: `task-1-speech-worker-tests.log`.

Real whisper.cpp inference used the existing read-only multilingual tiny model and JFK sample.
Both backends produced: “And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.”

- Metal cold start: 10.64 s wall, including first shader compilation.
- Metal warm start: 0.31 s wall, 0.13 s user CPU.
- Explicit `--no-gpu`: 0.40 s wall, 0.99 s user CPU.

The initial Metal invocation inside the task filesystem sandbox failed GPU buffer allocation; the same installed binary succeeded when run outside that sandbox.
This isolates the failure to the verification sandbox rather than the shipped binary.
Logs: `task-1-whisper-metal.log`, `task-1-whisper-metal-warm.log`, and `task-1-whisper-cpu.log`.

## Compliance material

The bundle retains the exact FFmpeg, LAME, whisper.cpp, CPython, and PyAV source archives plus their primary license texts.
`build-evidence` contains the FFmpeg and LAME configure logs, whisper CMake cache, locked recipes, source provenance, and toolchain identity.
The Python inventory covers 102 installed distributions and records each package's `License-Expression` first, raw license classifiers, declared license-file fields, retained metadata path, and discovered license/notice files.

Sixteen Python distributions report `NOASSERTION` because their installed metadata has no license expression or legacy license value; nine of those provide raw license classifiers.
The inventory preserves the underlying metadata instead of inferring a license from a package name.
This is a known third-party clearance follow-up, not a claim that transitive provenance is complete.

## Remaining boundaries

- Full runtime certification is limited to macOS ARM64. Linux ARM64 audio/speech harness work is a separate test lane; macOS x64, Windows, and Linux release artifacts were not built here.
- The dylibs altered for relative runtime loading are ad-hoc signed for local execution. Distribution signing and notarization remain release-stage work and must be verified on the final signed application.
- Real-model Chinese/English alignment and diarization were exercised by the controller's application/harness lanes, not by the 70 isolated worker unit tests recorded here.
- The FFmpeg configure evidence contains absolute build-directory strings as provenance text. Runtime loader paths and application entrypoints remain relative and were validated after relocation.
- Python package metadata still requires legal review for the `NOASSERTION` entries described above.
