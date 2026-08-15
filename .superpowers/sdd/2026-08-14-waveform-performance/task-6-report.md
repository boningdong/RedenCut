# Task 6 Report: Dedicated Waveform Performance Regression Gate

## Outcome

Added an isolated Node/Vitest waveform benchmark and the `npm run profile:waveform` runner.
The benchmark builds deterministic one-hour peak data (684,000 peaks), measures provider initialization separately, warms the real `PeakDataProvider` and drawing adapter, then times exactly 100 varied 1,920-device-pixel reads plus draws.
Every measured read asserts no more than 1,920 buckets and every draw asserts no more than 1,920 waveform primitives.

The normal `npm test` continues to use `vitest.config.ts`, whose `*.test`/`*.spec` include excludes `*.performance.ts`.
`vitest.performance.config.ts` is Node-only and includes only `src/**/*.performance.ts`.

## RED Evidence

Command:

```sh
npm run profile:waveform
```

Result: exit 1 before implementation with `npm error Missing script: "profile:waveform"`.
This was the expected missing-runner failure.

## GREEN Evidence and Measurements

The first complete dedicated-runner GREEN measurement was:

```text
waveform provider initialization: 6.931 ms
waveform interaction p50: 0.244 ms
waveform interaction p95: 0.329 ms
```

The final pre-commit benchmark measurement was:

```text
waveform provider initialization: 5.073 ms
waveform interaction p50: 0.251 ms
waveform interaction p95: 0.344 ms
```

Both runs passed the hard interaction p95 limit of 8 ms.
The p95 index is computed as `ceil(samples.length * 0.95) - 1`, which selects index 94 for the 100 sorted samples.

## Commands and Results

| Command | Result |
| --- | --- |
| `npm run profile:waveform` before implementation | Expected RED: exit 1, missing script |
| `npm run profile:waveform` after implementation | GREEN: 1 test passed; init 6.931 ms, p50 0.244 ms, p95 0.329 ms |
| `node --expose-gc ./node_modules/vitest/vitest.mjs run --config vitest.performance.config.ts --disableConsoleIntercept` | GREEN: verified the required `console.warn` measurements are visible; init 5.064 ms, p50 0.240 ms, p95 0.349 ms |
| `npm run check` (first attempt) | Expected integration issue: format and lint passed; Knip reported the new dynamic config and performance test as unused |
| `./node_modules/.bin/knip --debug --include files` | Diagnosed Knip’s Vitest plugin recognizing `vitest.config.*` but not the dynamically selected `vitest.performance.config.ts` |
| `npm run deadcode` | GREEN after explicit narrow Knip entries |
| `npm run format` | GREEN; all matched files formatted or unchanged |
| `npm run check` | GREEN: format check, lint, Knip, typecheck, 14 test files / 139 tests, and Electron build all passed |
| `npm run profile:waveform` | GREEN: 1 test passed; init 5.073 ms, p50 0.251 ms, p95 0.344 ms |
| `git diff --check` | GREEN: exit 0, no whitespace errors |
| `git status --short` before commit | Only intended Task 6 changes present |

## Post-commit Verification

```text
npm run check
  GREEN: format check, lint, Knip, typecheck, 14 test files / 139 tests, and Electron build passed.

npm run profile:waveform
  waveform provider initialization: 5.125 ms
  waveform interaction p50: 0.249 ms
  waveform interaction p95: 0.341 ms
  GREEN: 1 performance test passed; p95 remained within the 8 ms limit.

git status --short
  GREEN: no output (clean worktree before recording this report update).
```

## Files

- `package.json` — adds the exact `profile:waveform` script.
- `vitest.performance.config.ts` — Node-only aliases and isolated `*.performance.ts` include; console interception is disabled so the required performance measurements print.
- `src/renderer/src/components/Waveform/waveform.performance.ts` — deterministic real-provider bounded-work regression gate.
- `knip.jsonc` — declares the dynamically selected config and benchmark as explicit entries so `npm run check` remains valid; the adjacent comment documents the limitation.
- `package-lock.json` — intentionally unchanged: no dependency update was required.

## Self-review

- Uses `PeakDataProvider` (not the deprecated naming from the original brief).
- Provider construction happens once and outside the interaction timing window.
- Warm-up is outside the 100 measured interaction iterations.
- Each iteration uses a unique source offset, a 120-second viewport, and exactly 1,920 target device pixels.
- The only test-originated output is the required initialization, p50, and p95 measurement lines.
- The timing threshold remains the required hard 8 ms assertion; it was neither hidden nor relaxed.

## Interactive Acceptance Checks

All native interactive profiling checks remain unverified because this environment does not provide a launched Electron renderer, native trace capture, or an instrumented one-hour cached project fixture.
No values were inferred or fabricated for:

1. Cached one-hour project open / first waveform paint p95.
2. Fit → 32× zoom → pan → fit missed-frame rate.
3. Seek-to-unseen-region waveform update p95.
4. Retained-heap comparison after GC.
5. Ten-clip shared-source provider/pyramid retention.
6. Sixty-second playhead-motion request and static-redraw counts.

## Concerns

There are no remaining automated-gate concerns.
The six native interactive acceptance measurements above require execution on the reference development machine with the Electron app and profiling tooling available.
