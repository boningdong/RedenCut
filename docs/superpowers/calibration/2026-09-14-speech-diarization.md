# Native diarization duration calibration

Date: 2026-09-14.
Scope: advisory diarization estimates for the speech process reliability implementation.

## Measured configuration

These observations used native macOS on Apple M4 (arm64), the CPU inference device, pyannote-audio 4.0.7, torch/torchaudio 2.8.0, and whisperx 3.8.6 from the pinned worker environment.
The managed diarization snapshot revision was `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`.
The measured host exposes ten physical/logical CPU cores: four performance cores and six efficiency cores.
An independent read-only check of `os.cpus()` and macOS `sysctl` confirmed this topology.
The experiments used `OMP_NUM_THREADS=4`; the pinned torch 2.8.0 runtime was independently checked with OMP/MKL unset and no other thread overrides, reporting four intraop threads and ten interop threads.
This observation applies to the measured ten-core model and is not assumed for other Apple M4 variants.
Other BLAS/OpenMP overrides were unset.

## Observations

| Audio duration      | Observed diarization stage duration |
| ------------------- | ----------------------------------- |
| 300 seconds         | 206,302 milliseconds                |
| 300 seconds, repeat | 216,239 milliseconds                |
| 900 seconds         | 606,408 milliseconds                |

The 900-second worker reached a measured peak resident memory of 3,461,677,056 bytes; this is a worker-wide observation, not isolated diarization memory.

The stage observations include the stage's process/model preparation rather than claiming isolated steady-state kernel performance.
They establish a narrow empirical estimate, not a statistical confidence interval or a duration guarantee.
The full 3,877.424-second recording was stopped at the user’s request after 4,540,291 milliseconds total, while diarization still emitted real activity.
Transcription completed in 595,439 milliseconds and alignment in 407,872 milliseconds; diarization had run for 3,535,198 milliseconds without finishing.
The worker had already exceeded its former 30-minute deadline, demonstrating that the removed wall timeout no longer interrupted this healthy active run.
External SIGTERM stopped the owned calibration worker; the raw driver records process-exit, not a spontaneous inference failure or an app UI cancellation test.
This incomplete long run does not extend the supported estimate range, and its completion time remains unknown.
Its observed duration already exceeded linear extrapolation from the shorter runs; the cause is unresolved.
The adapter discards pyannote substep names and counters, so these activity logs cannot establish an overall percentage or identify the active substep.
Whole-file clustering remains a scaling concern, but recurring batch-hook activity is not evidence that clustering caused this particular slowdown.

## Shipped advisory policy

The [measured profile](../../../src/main/speech/measuredSpeechProfiles.ts) uses zero fixed overhead and `216239 / 300` milliseconds of processing per audio second, the largest observed duration ratio, multiplied by a conservative allowance of 1.5.
The accepted audio-duration range is 300 through 900 seconds inclusive.
This deliberately simple envelope avoids estimating a startup intercept from only two durations.

A match requires macOS, arm64, exactly ten reported CPUs whose model is `Apple M4`, CPU inference, and the exact managed snapshot revision.
`OMP_NUM_THREADS` and `MKL_NUM_THREADS` must each be unset or exactly `4`; other recognized BLAS, OpenMP, or torch thread overrides reject the profile.
Pinned dependency regression tests require revalidation when the relevant worker package versions change.
The implementation assumes the app-managed pinned environment; it does not probe imported runtime package versions during a job.

Unmatched configurations and recordings outside the measured range receive no estimate.
No transcription estimate is shipped because the experiment's Whisper GPU setting differed from the default app configuration.
No alignment estimate is shipped because automatic-language configuration is not sufficiently matched.
Exceeding the estimate leaves inference running and enables the existing advisory overrun presentation; this policy introduces no inference termination deadline.
