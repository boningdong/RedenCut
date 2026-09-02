# Waveform Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duration-proportional SVG waveform rendering with viewport-bounded canvas rendering while continuing to consume the existing `PeakData` cache.

**Architecture:** `LegacyPeakDataProvider` performs one initialization pass over existing peaks to build shared in-memory summary levels, then answers viewport requests through the storage-independent `WaveformDataProvider` contract. `WaveformView` computes visible clip/source intersections, and `CanvasWaveform` uses an abortable request controller plus a pure canvas drawing function so interaction work is bounded by visible device pixels.

**Tech Stack:** Electron 40, React 19, TypeScript 5.9, Zustand, Canvas 2D, Vitest 4, Testing Library, jsdom.

## Global Constraints

- Follow [`AGENTS.md`](../../../AGENTS.md), [`docs/architecture-standards.md`](../../architecture-standards.md), and [`docs/coding-standards.md`](../../coding-standards.md).
- Follow test-driven development: add a focused failing test, confirm the expected failure, add the minimum implementation, and confirm the test passes.
- Renderer work for a fixed viewport and visible-track count must be bounded independently of source duration after provider initialization.
- `LegacyPeakDataProvider` initialization is the only accepted duration-proportional renderer step in this project.
- A viewport request must return no more buckets than its integer target device-pixel width.
- Ten clips referencing the same peak data must share one provider and one in-memory pyramid.
- Playhead updates must not cause waveform-data requests or static waveform redraws.
- No waveform UI node may be created per source peak.
- Do not add filesystem, Electron, playback, or Zustand dependencies to provider, range, request-controller, or drawing modules.
- Keep existing ruler, selection, dragging, mute styling, gaps, split markers, track loading, and playback behavior unless a task explicitly changes it.
- Keep machine-dependent performance thresholds out of ordinary `npm test`; run them through the dedicated profiling command.
- Run `npm run format` before final review and `npm run check` before claiming completion.

---

## Planned file structure

```text
src/renderer/src/components/Waveform/
├── WaveformView.tsx
├── WaveformView.test.tsx
├── CanvasWaveform.tsx
├── CanvasWaveform.test.tsx
├── WaveformDataProvider.ts
├── LegacyPeakDataProvider.ts
├── LegacyPeakDataProvider.test.ts
├── waveformRange.ts
├── waveformRange.test.ts
├── drawWaveform.ts
├── drawWaveform.test.ts
├── WaveformRequestController.ts
├── WaveformRequestController.test.ts
└── waveform.performance.ts
```

`WaveformView` remains timeline orchestration. Each new file owns exactly the responsibility named by its filename.

Supporting changes are limited to `vitest.config.ts`, a new `vitest.performance.config.ts`, package manifests, affected WaveSurfer comments, and `docs/architecture-standards.md`.

---

### Task 1: Legacy multiresolution waveform provider

**Files:**
- Create: `src/renderer/src/components/Waveform/WaveformDataProvider.ts`
- Create: `src/renderer/src/components/Waveform/LegacyPeakDataProvider.ts`
- Create: `src/renderer/src/components/Waveform/LegacyPeakDataProvider.test.ts`

**Interfaces:**
- Consumes: `PeakData` from `src/shared/project.types.ts`.
- Produces: `WaveformDataProvider.readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange>`.
- Produces: `LegacyPeakDataProvider`, constructed once per loaded `PeakData` object and shared by its clips.

- [ ] **Step 1: Create the provider contract and write failing provider tests**

Create `WaveformDataProvider.ts`:

```ts
export interface WaveformRangeRequest {
  sourceStartSeconds: number
  sourceEndSeconds: number
  targetPixelWidth: number
  signal: AbortSignal
}

export interface WaveformBucket {
  min: number
  max: number
}

export interface WaveformBucketRange {
  buckets: WaveformBucket[]
}

export interface WaveformDataProvider {
  readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange>
}
```

Create `LegacyPeakDataProvider.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { PeakData } from '@shared/project.types'
import { LegacyPeakDataProvider } from './LegacyPeakDataProvider'

function peakData(values: number[], durationSeconds = values.length): PeakData {
  return { data: [values], length: values.length, durationSeconds }
}

function request(start: number, end: number, width: number, signal = new AbortController().signal) {
  return { sourceStartSeconds: start, sourceEndSeconds: end, targetPixelWidth: width, signal }
}

describe('LegacyPeakDataProvider', () => {
  it('aggregates source peaks into symmetric min/max pixel buckets', async () => {
    const provider = new LegacyPeakDataProvider(peakData([0.125, 0.5, 0.25, 0.75]))
    await expect(provider.readRange(request(0, 4, 2))).resolves.toEqual({
      buckets: [
        { min: -0.5, max: 0.5 },
        { min: -0.75, max: 0.75 },
      ],
    })
  })

  it('maps a partial time range to only the contributing peaks', async () => {
    const provider = new LegacyPeakDataProvider(peakData([0.125, 0.5, 0.25, 0.75]))
    await expect(provider.readRange(request(1, 3, 2))).resolves.toEqual({
      buckets: [
        { min: -0.5, max: 0.5 },
        { min: -0.25, max: 0.25 },
      ],
    })
  })

  it('returns no more buckets than target device pixels for one hour', async () => {
    const values = Array.from({ length: 684_000 }, (_, index) => (index % 100) / 100)
    const provider = new LegacyPeakDataProvider(peakData(values, 3_600))
    const result = await provider.readRange(request(-10, 4_000, 1_920))
    expect(result.buckets.length).toBeLessThanOrEqual(1_920)
  })

  it('returns an empty range for invalid duration, interval, or pixel width', async () => {
    const provider = new LegacyPeakDataProvider(peakData([0.5], 0))
    await expect(provider.readRange(request(1, 1, 10))).resolves.toEqual({ buckets: [] })
    await expect(provider.readRange(request(0, 1, 0))).resolves.toEqual({ buckets: [] })
  })

  it('rejects an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new LegacyPeakDataProvider(peakData([0.5]))
    await expect(provider.readRange(request(0, 1, 1, controller.signal))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
```

- [ ] **Step 2: Run the provider test and confirm the expected failure**

Run:

```bash
npx vitest run src/renderer/src/components/Waveform/LegacyPeakDataProvider.test.ts
```

Expected: FAIL because `LegacyPeakDataProvider.ts` does not exist.

- [ ] **Step 3: Implement the shared in-memory pyramid and bounded range reader**

Create `LegacyPeakDataProvider.ts` with these private units and signatures:

```ts
import type { PeakData } from '@shared/project.types'
import type {
  WaveformBucket,
  WaveformBucketRange,
  WaveformDataProvider,
  WaveformRangeRequest,
} from './WaveformDataProvider'

interface PeakLevel {
  basePeakSpan: number
  min: Float32Array
  max: Float32Array
}

const LEVEL_FACTOR = 16

function abortError(): Error {
  return Object.assign(new Error('Waveform request aborted'), { name: 'AbortError' })
}

function buildBaseLevel(values: readonly number[]): PeakLevel {
  const min = new Float32Array(values.length)
  const max = new Float32Array(values.length)
  for (let index = 0; index < values.length; index++) {
    const magnitude = Math.max(0, Math.min(1, Math.abs(values[index] ?? 0)))
    min[index] = -magnitude
    max[index] = magnitude
  }
  return { basePeakSpan: 1, min, max }
}

function buildNextLevel(previous: PeakLevel): PeakLevel {
  const length = Math.ceil(previous.min.length / LEVEL_FACTOR)
  const min = new Float32Array(length)
  const max = new Float32Array(length)
  for (let outputIndex = 0; outputIndex < length; outputIndex++) {
    const start = outputIndex * LEVEL_FACTOR
    const end = Math.min(previous.min.length, start + LEVEL_FACTOR)
    let bucketMin = 1
    let bucketMax = -1
    for (let inputIndex = start; inputIndex < end; inputIndex++) {
      bucketMin = Math.min(bucketMin, previous.min[inputIndex])
      bucketMax = Math.max(bucketMax, previous.max[inputIndex])
    }
    min[outputIndex] = bucketMin
    max[outputIndex] = bucketMax
  }
  return { basePeakSpan: previous.basePeakSpan * LEVEL_FACTOR, min, max }
}

export class LegacyPeakDataProvider implements WaveformDataProvider {
  private readonly durationSeconds: number
  private readonly basePeakCount: number
  private readonly levels: PeakLevel[]

  constructor(peaks: PeakData) {
    const base = buildBaseLevel(peaks.data[0] ?? [])
    this.durationSeconds = peaks.durationSeconds
    this.basePeakCount = base.min.length
    this.levels = [base]
    while (this.levels[this.levels.length - 1].min.length > 1) {
      this.levels.push(buildNextLevel(this.levels[this.levels.length - 1]))
    }
  }

  async readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange> {
    if (request.signal.aborted) throw abortError()
    const width = Math.max(0, Math.floor(request.targetPixelWidth))
    if (this.durationSeconds <= 0 || this.basePeakCount === 0 || width === 0) {
      return { buckets: [] }
    }
    const startSeconds = Math.max(0, Math.min(this.durationSeconds, request.sourceStartSeconds))
    const endSeconds = Math.max(startSeconds, Math.min(this.durationSeconds, request.sourceEndSeconds))
    if (endSeconds <= startSeconds) return { buckets: [] }
    const baseStart = Math.floor((startSeconds / this.durationSeconds) * this.basePeakCount)
    const baseEnd = Math.min(
      this.basePeakCount,
      Math.ceil((endSeconds / this.durationSeconds) * this.basePeakCount),
    )
    let level = this.levels[0]
    for (const candidate of this.levels.slice(1)) {
      const count =
        Math.ceil(baseEnd / candidate.basePeakSpan) -
        Math.floor(baseStart / candidate.basePeakSpan)
      if (count >= width) level = candidate
    }
    const levelStart = Math.floor(baseStart / level.basePeakSpan)
    const levelEnd = Math.min(level.min.length, Math.ceil(baseEnd / level.basePeakSpan))
    const available = Math.max(0, levelEnd - levelStart)
    const outputCount = Math.min(width, available)
    const buckets: WaveformBucket[] = []
    for (let outputIndex = 0; outputIndex < outputCount; outputIndex++) {
      if (request.signal.aborted) throw abortError()
      const inputStart = levelStart + Math.floor((outputIndex * available) / outputCount)
      const inputEnd = levelStart + Math.ceil(((outputIndex + 1) * available) / outputCount)
      let bucketMin = 1
      let bucketMax = -1
      for (let inputIndex = inputStart; inputIndex < inputEnd; inputIndex++) {
        bucketMin = Math.min(bucketMin, level.min[inputIndex])
        bucketMax = Math.max(bucketMax, level.max[inputIndex])
      }
      buckets.push({ min: bucketMin, max: bucketMax })
    }
    return { buckets }
  }
}
```

Do not expose the pyramid or add a second duration-sized object cache.

- [ ] **Step 4: Run focused and full Tier 1 tests**

```bash
npx vitest run src/renderer/src/components/Waveform/LegacyPeakDataProvider.test.ts
npm test
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the provider unit**

```bash
git add src/renderer/src/components/Waveform/WaveformDataProvider.ts src/renderer/src/components/Waveform/LegacyPeakDataProvider.ts src/renderer/src/components/Waveform/LegacyPeakDataProvider.test.ts
git commit -m "feat: add bounded waveform data provider"
```

---

### Task 2: Visible clip and source-range geometry

**Files:**
- Create: `src/renderer/src/components/Waveform/waveformRange.ts`
- Create: `src/renderer/src/components/Waveform/waveformRange.test.ts`

**Interfaces:**
- Consumes: clip output position, clip source range, `pxPerSec`, viewport scroll offset, and viewport width.
- Produces: `calculateVisibleWaveformRange(input): VisibleWaveformRange | null`.

- [ ] **Step 1: Write failing geometry tests**

Create `waveformRange.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calculateVisibleWaveformRange } from './waveformRange'

const base = {
  outputStart: 10,
  sourceStart: 20,
  sourceEnd: 30,
  pxPerSec: 100,
  viewportStartPx: 0,
  viewportWidthPx: 1_920,
}

describe('calculateVisibleWaveformRange', () => {
  it('maps the visible right portion of a clip to source time', () => {
    expect(calculateVisibleWaveformRange(base)).toEqual({
      leftInClipPx: 0,
      widthPx: 920,
      sourceStartSeconds: 20,
      sourceEndSeconds: 29.2,
    })
  })

  it('maps a left-clipped viewport to the matching source start', () => {
    expect(
      calculateVisibleWaveformRange({ ...base, viewportStartPx: 1_250, viewportWidthPx: 500 }),
    ).toEqual({
      leftInClipPx: 250,
      widthPx: 500,
      sourceStartSeconds: 22.5,
      sourceEndSeconds: 27.5,
    })
  })

  it('returns null outside the viewport or for non-positive inputs', () => {
    expect(
      calculateVisibleWaveformRange({ ...base, viewportStartPx: 2_100, viewportWidthPx: 500 }),
    ).toBeNull()
    expect(calculateVisibleWaveformRange({ ...base, pxPerSec: 0 })).toBeNull()
    expect(calculateVisibleWaveformRange({ ...base, viewportWidthPx: 0 })).toBeNull()
    expect(calculateVisibleWaveformRange({ ...base, sourceEnd: 20 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the geometry test and confirm the expected failure**

```bash
npx vitest run src/renderer/src/components/Waveform/waveformRange.test.ts
```

Expected: FAIL because `waveformRange.ts` does not exist.

- [ ] **Step 3: Implement the pure intersection and time mapping**

Create `waveformRange.ts`:

```ts
export interface VisibleWaveformInput {
  outputStart: number
  sourceStart: number
  sourceEnd: number
  pxPerSec: number
  viewportStartPx: number
  viewportWidthPx: number
}

export interface VisibleWaveformRange {
  leftInClipPx: number
  widthPx: number
  sourceStartSeconds: number
  sourceEndSeconds: number
}

export function calculateVisibleWaveformRange(
  input: VisibleWaveformInput,
): VisibleWaveformRange | null {
  const clipDuration = input.sourceEnd - input.sourceStart
  if (clipDuration <= 0 || input.pxPerSec <= 0 || input.viewportWidthPx <= 0) return null
  const clipStartPx = input.outputStart * input.pxPerSec
  const clipEndPx = clipStartPx + clipDuration * input.pxPerSec
  const viewportEndPx = input.viewportStartPx + input.viewportWidthPx
  const visibleStartPx = Math.max(clipStartPx, input.viewportStartPx)
  const visibleEndPx = Math.min(clipEndPx, viewportEndPx)
  if (visibleEndPx <= visibleStartPx) return null
  return {
    leftInClipPx: visibleStartPx - clipStartPx,
    widthPx: visibleEndPx - visibleStartPx,
    sourceStartSeconds: input.sourceStart + (visibleStartPx - clipStartPx) / input.pxPerSec,
    sourceEndSeconds: input.sourceStart + (visibleEndPx - clipStartPx) / input.pxPerSec,
  }
}
```

- [ ] **Step 4: Run focused tests**

```bash
npx vitest run src/renderer/src/components/Waveform/waveformRange.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the geometry unit**

```bash
git add src/renderer/src/components/Waveform/waveformRange.ts src/renderer/src/components/Waveform/waveformRange.test.ts
git commit -m "feat: calculate visible waveform ranges"
```

---

### Task 3: Abortable requests and bounded canvas drawing

**Files:**
- Create: `src/renderer/src/components/Waveform/WaveformRequestController.ts`
- Create: `src/renderer/src/components/Waveform/WaveformRequestController.test.ts`
- Create: `src/renderer/src/components/Waveform/drawWaveform.ts`
- Create: `src/renderer/src/components/Waveform/drawWaveform.test.ts`

**Interfaces:**
- `WaveformRequestController` owns one in-flight provider request and prevents stale commits.
- `drawWaveform(context, buckets, width, height, color)` is a pure bounded drawing adapter.

- [ ] **Step 1: Write failing request-controller tests**

Use a deferred fake `WaveformDataProvider` to prove that starting request B aborts request A, a late result from A cannot commit, B can commit, and `cancel()` aborts the active signal.

```ts
import { describe, expect, it, vi } from 'vitest'
import type { WaveformDataProvider, WaveformRangeRequest } from './WaveformDataProvider'
import { WaveformRequestController } from './WaveformRequestController'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

describe('WaveformRequestController', () => {
  it('aborts and ignores an obsolete request', async () => {
    const first = deferred<{ buckets: [] }>()
    const second = deferred<{ buckets: [] }>()
    const signals: AbortSignal[] = []
    const provider: WaveformDataProvider = {
      readRange: vi.fn((request: WaveformRangeRequest) => {
        signals.push(request.signal)
        return signals.length === 1 ? first.promise : second.promise
      }),
    }
    const commit = vi.fn()
    const controller = new WaveformRequestController()
    const firstRun = controller.request(provider, 0, 10, 100, commit)
    const secondRun = controller.request(provider, 10, 20, 100, commit)
    expect(signals[0].aborted).toBe(true)
    first.resolve({ buckets: [] })
    second.resolve({ buckets: [] })
    await Promise.all([firstRun, secondRun])
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('aborts the active request when cancelled', () => {
    let signal: AbortSignal | undefined
    const provider: WaveformDataProvider = {
      readRange: vi.fn((request) => {
        signal = request.signal
        return new Promise(() => undefined)
      }),
    }
    const controller = new WaveformRequestController()
    void controller.request(provider, 0, 1, 1, vi.fn())
    controller.cancel()
    expect(signal?.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Confirm the controller tests fail, then implement it**

```bash
npx vitest run src/renderer/src/components/Waveform/WaveformRequestController.test.ts
```

Create `WaveformRequestController.ts`:

```ts
import type { WaveformDataProvider } from './WaveformDataProvider'

export class WaveformRequestController {
  private active: AbortController | null = null
  private revision = 0

  async request(
    provider: WaveformDataProvider,
    sourceStartSeconds: number,
    sourceEndSeconds: number,
    targetPixelWidth: number,
    commit: (range: Awaited<ReturnType<WaveformDataProvider['readRange']>>) => void,
    reportError: (error: unknown) => void = () => undefined,
  ): Promise<void> {
    this.cancel()
    const active = new AbortController()
    const revision = ++this.revision
    this.active = active
    try {
      const range = await provider.readRange({
        sourceStartSeconds,
        sourceEndSeconds,
        targetPixelWidth,
        signal: active.signal,
      })
      if (!active.signal.aborted && revision === this.revision) commit(range)
    } catch (error) {
      if (!active.signal.aborted && revision === this.revision) reportError(error)
    }
  }

  cancel(): void {
    this.active?.abort()
    this.active = null
    this.revision++
  }
}
```

- [ ] **Step 3: Write failing drawing tests**

Create a recording context with `clearRect` and `fillRect` spies. Assert that drawing N buckets issues exactly N `fillRect` calls, maps `{ min: -0.5, max: 0.25 }` into `y = 30, height = 30` for an 80-pixel canvas, and clamps non-finite/out-of-range amplitudes to `[-1, 1]`.

- [ ] **Step 4: Implement the minimal drawing adapter**

```ts
import type { WaveformBucket } from './WaveformDataProvider'

export interface WaveformDrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
}

function amplitude(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}

export function drawWaveform(
  context: WaveformDrawingContext,
  buckets: readonly WaveformBucket[],
  width: number,
  height: number,
  color: string,
): void {
  context.clearRect(0, 0, width, height)
  context.fillStyle = color
  if (width <= 0 || height <= 0 || buckets.length === 0) return
  const bucketWidth = width / buckets.length
  buckets.forEach((bucket, index) => {
    const top = ((1 - amplitude(bucket.max)) / 2) * height
    const bottom = ((1 - amplitude(bucket.min)) / 2) * height
    context.fillRect(index * bucketWidth, top, Math.max(1, bucketWidth), Math.max(1, bottom - top))
  })
}
```

- [ ] **Step 5: Run and commit the bounded request/draw unit**

```bash
npx vitest run src/renderer/src/components/Waveform/WaveformRequestController.test.ts src/renderer/src/components/Waveform/drawWaveform.test.ts
git add src/renderer/src/components/Waveform/WaveformRequestController.ts src/renderer/src/components/Waveform/WaveformRequestController.test.ts src/renderer/src/components/Waveform/drawWaveform.ts src/renderer/src/components/Waveform/drawWaveform.test.ts
git commit -m "feat: add abortable waveform canvas pipeline"
```

---

### Task 4: Canvas waveform component

**Files:**
- Create: `src/renderer/src/components/Waveform/CanvasWaveform.tsx`
- Create: `src/renderer/src/components/Waveform/CanvasWaveform.test.tsx`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Props:**

```ts
interface CanvasWaveformProps {
  provider: WaveformDataProvider
  sourceStartSeconds: number
  sourceEndSeconds: number
  leftInClipPx: number
  widthPx: number
  heightPx: number
  color: string
  muted: boolean
}
```

The component must not receive current time, transport state, a whole track, a whole clip, or the Zustand store.

- [ ] **Step 1: Install the DOM test dependencies and include TSX tests**

```bash
npm install --save-dev @testing-library/react jsdom
```

Change the normal Vitest include to `src/**/*.{test,spec}.{ts,tsx}`.

- [ ] **Step 2: Write failing component tests**

At the top of `CanvasWaveform.test.tsx`, use `// @vitest-environment jsdom`. Mock `HTMLCanvasElement.prototype.getContext`, set `window.devicePixelRatio = 2`, and render with a 300 CSS-pixel width. Assert:

- the provider receives `targetPixelWidth: 600` and the exact visible source interval;
- resolving the request draws the returned buckets;
- rerendering with a new source interval aborts the previous signal and a late old result does not draw;
- muted rendering resolves `--waveform-color-muted` through `getComputedStyle`.

- [ ] **Step 3: Confirm failure, then implement `CanvasWaveform`**

```bash
npx vitest run src/renderer/src/components/Waveform/CanvasWaveform.test.tsx
```

Implement a `React.memo` component that:

1. Keeps only a canvas ref and `WaveformRequestController` ref.
2. Sets CSS position/size from `leftInClipPx`, `widthPx`, and `heightPx`.
3. Sets backing dimensions to `ceil(cssSize * devicePixelRatio)`.
4. Requests exactly that backing width from the provider.
5. Draws only the committed result using `drawWaveform`.
6. Resolves muted color with `getComputedStyle(canvas).getPropertyValue('--waveform-color-muted')`, falling back to `${color}cc`.
7. Cancels the active request in the effect cleanup.

- [ ] **Step 4: Run focused and full Tier 1 tests**

```bash
npx vitest run src/renderer/src/components/Waveform/CanvasWaveform.test.tsx
npm test
```

Expected: PASS, with no request or redraw dependency on playhead state.

- [ ] **Step 5: Commit the component unit**

```bash
git add package.json package-lock.json vitest.config.ts src/renderer/src/components/Waveform/CanvasWaveform.tsx src/renderer/src/components/Waveform/CanvasWaveform.test.tsx
git commit -m "feat: render bounded waveform canvases"
```

---

### Task 5: Integrate viewport rendering and remove WaveSurfer

**Files:**
- Modify: `src/renderer/src/components/Waveform/WaveformView.tsx`
- Create: `src/renderer/src/components/Waveform/WaveformView.test.tsx`
- Modify: `src/shared/project.types.ts`
- Modify: `src/main/audio/peaks.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Transport/TransportBar.tsx`
- Modify: `docs/architecture-standards.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Ownership:**

```text
WaveformView
├── owns viewport geometry and one provider per track PeakData
├── renders clip shell, selection, trim, drag, and gap UI
└── gives CanvasWaveform only visible source/rectangle data
    └── owns request lifetime and static pixels

Transport/playhead overlay ── independent of CanvasWaveform
```

- [ ] **Step 1: Write a failing DOM integration test**

Use `// @vitest-environment jsdom`, an immediate `ResizeObserver` fake, a mocked canvas context, and the real timeline store initialization helpers. Cover these observable behaviors:

- loaded peak data produces a visible `<canvas>` and no per-peak `<svg>` or hidden WaveSurfer host;
- splitting one source into two clips produces two canvases while the production provider map still contains one provider for that track's `PeakData`;
- advancing playback time leaves provider-request and canvas-draw counts unchanged.

If the last assertion cannot observe the provider without adding a production test seam, move it to a `CanvasWaveform` rerender test that changes an unrelated `data-playhead` wrapper attribute; do not inject a test-only provider factory into production code.

- [ ] **Step 2: Confirm the integration test fails for the old renderer**

```bash
npx vitest run src/renderer/src/components/Waveform/WaveformView.test.tsx
```

Expected: FAIL because the current implementation renders SVG peak rectangles and the hidden WaveSurfer element.

- [ ] **Step 3: Build shared providers and viewport state in `WaveformView`**

Import `CanvasWaveform`, `LegacyPeakDataProvider`, and `calculateVisibleWaveformRange`.

Create providers with `useMemo` from `trackPeaks`: iterate the map once and create exactly one `LegacyPeakDataProvider` per `PeakData` entry. Never create a provider inside a clip loop.

Track `{ scrollLeft, width }` for the scrolling viewport. Update it from resize events and a `requestAnimationFrame`-throttled scroll handler so one browser frame creates at most one React update. Cancel a queued animation frame during cleanup.

- [ ] **Step 4: Replace each clip's SVG peaks with one visible canvas**

For each clip with a provider, call:

```ts
const visible = calculateVisibleWaveformRange({
  outputStart: clip.outputStart,
  sourceStart: clip.sourceStart,
  sourceEnd: clip.sourceEnd,
  pxPerSec,
  viewportStartPx: viewport.scrollLeft,
  viewportWidthPx: viewport.width,
})
```

When `visible` is non-null, render `CanvasWaveform` with that visible source interval and rectangle. Keep the clip container responsible for selection, borders, handles, gaps, and pointer behavior. Keep the playhead in its existing independent overlay.

Delete `TrackWaveform`, `ClipWaveform`, the `WaveSurfer` import, WaveSurfer refs/effects, and the hidden waveform host.

- [ ] **Step 5: Remove the dependency and update authoritative terminology**

```bash
npm uninstall wavesurfer.js
```

Update stale WaveSurfer-specific comments in `src/shared/project.types.ts`, `src/main/audio/peaks.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Transport/TransportBar.tsx`, and `WaveformView.tsx`.

In `docs/architecture-standards.md`, replace the WaveSurfer visualization rule with this boundary: waveform UI depends on `WaveformDataProvider`; playback remains owned by `PreviewPlayer`; storage and decoding must not leak into the renderer.

- [ ] **Step 6: Run automated integration verification**

```bash
npx vitest run src/renderer/src/components/Waveform/WaveformView.test.tsx
npm test
rg -n "WaveSurfer|wavesurfer|<svg|<rect" src package.json package-lock.json docs
```

Expected: tests PASS. Search output contains no WaveSurfer dependency/reference and no waveform peak SVG implementation; unrelated SVG icons may remain.

- [ ] **Step 7: Run the interactive behavior checklist**

```bash
npm start
```

Open representative short and one-hour sources and verify waveform display, fit, zoom, horizontal pan, seek, selection, split, trim, move, mute styling, gaps, multitrack alignment, and transport playback. Record any environment limitation rather than claiming an unrun check.

- [ ] **Step 8: Commit the integration**

```bash
git add src/renderer/src/components/Waveform/WaveformView.tsx src/renderer/src/components/Waveform/WaveformView.test.tsx src/shared/project.types.ts src/main/audio/peaks.ts src/renderer/src/App.tsx src/renderer/src/components/Transport/TransportBar.tsx docs/architecture-standards.md package.json package-lock.json
git commit -m "refactor: replace waveform SVG with canvas"
```

---

### Task 6: Dedicated performance regression gate and final verification

**Files:**
- Create: `src/renderer/src/components/Waveform/waveform.performance.ts`
- Create: `vitest.performance.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add an isolated performance runner**

Create `vitest.performance.config.ts` by copying the repository aliases from `vitest.config.ts`, selecting the Node environment, and including only `src/**/*.performance.ts`.

Add this script:

```json
"profile:waveform": "node --expose-gc ./node_modules/vitest/vitest.mjs run --config vitest.performance.config.ts"
```

This suite is intentionally excluded from ordinary `npm test` because timing thresholds are machine-dependent.

- [ ] **Step 2: Write the one-hour bounded-work benchmark**

In `waveform.performance.ts`:

1. Construct 684,000 deterministic peaks representing one hour.
2. Construct `LegacyPeakDataProvider` once, outside the timed section.
3. Warm the provider and drawing function.
4. Run 100 reads and draws for a 1,920-device-pixel viewport at varied source offsets.
5. Assert every result contains at most 1,920 buckets and every draw issues at most 1,920 waveform primitives.
6. Sort elapsed samples and calculate p95 using index `ceil(samples.length * 0.95) - 1`.
7. Print the measured p50/p95 using `console.warn` and assert p95 is at most 8 ms on the reference development machine.

Do not include provider construction in the 8 ms interaction measurement. Add a separate informational measurement for initialization so it cannot be mistaken for viewport work.

- [ ] **Step 3: Run the dedicated benchmark**

```bash
npm run profile:waveform
```

Expected: PASS on the reference development machine with p95 request-plus-draw at or below 8 ms. If CI hardware proves materially slower, preserve the hard boundedness assertions and calibrate the timing threshold from recorded baseline evidence rather than silently loosening it.

- [ ] **Step 4: Perform interactive performance profiling**

On the reference development machine, record:

1. Cached one-hour project open: first waveform paint at or below 500 ms p95 across 20 opens.
2. Fit → 32× zoom → pan → fit: no more than 1% missed animation frames during a 60-second trace.
3. Seek to a previously unseen region: waveform update at or below 150 ms p95.
4. Retained heap after GC: a one-hour source exceeds a ten-minute source by no more than the larger of 15% or 25 MiB during equivalent viewport interactions.
5. Ten clips sharing a source: only one provider/pyramid is retained.
6. Sixty seconds of playhead motion: zero waveform-data requests and zero static waveform redraws after the initial draw.

Save the measurements in the implementation handoff or linked issue. These are acceptance checks, not ordinary CI tests.

- [ ] **Step 5: Run the complete repository gate**

```bash
npm run format
npm run check
npm run profile:waveform
git diff --check
git status --short
```

Expected: format, checks, benchmark, and whitespace validation PASS. `git status` lists only intentional changes before the final commit.

- [ ] **Step 6: Commit the performance gate**

```bash
git add package.json package-lock.json vitest.performance.config.ts src/renderer/src/components/Waveform/waveform.performance.ts
git commit -m "test: guard waveform interaction performance"
```

- [ ] **Step 7: Verify the committed result**

```bash
npm run check
npm run profile:waveform
git status --short
```

Expected: both commands PASS and the worktree is clean. Report interactive measurements separately, including anything not verified and why.
