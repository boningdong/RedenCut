# File Range Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Electron's non-compliant `net.fetch(file://...)` cache adapter with an exact, abortable filesystem range response so managed PCM playback and waveform reads receive standards-compliant `206` responses.

**Architecture:** The protected cache protocol continues to authorize routes, validate active-project manifests, parse and limit renderer ranges, and verify adapter responses. A new main-only `fileRangeResponse.ts` function opens the authorized artifact, streams only the inclusive validated byte interval, and constructs exact partial-content headers. Renderer providers, project schemas, cache manifests, IPC contracts, and `.riffcut` directory structure remain unchanged.

**Tech Stack:** Electron 40, Node.js `fs/promises` and `FileHandle.createReadStream`, Web `Response`/`ReadableStream`, TypeScript 5.9, Vitest 4.

## Global Constraints

- Do not accept or normalize full-file `200` cache responses.
- Do not use `net.fetch(file://...)` for cache artifacts.
- Do not read an entire PCM or waveform artifact into memory.
- Preserve the 32 MiB maximum request size enforced by `cacheProtocol.ts`.
- Keep filesystem paths and `BoundedByteRange` inside the main process.
- Add no project schema, manifest, IPC, preload, renderer-provider, or `.riffcut` layout changes.
- Use lower camel case filenames for function-primary modules: `fileRangeResponse.ts` and `fileRangeResponse.test.ts`.
- The range end is inclusive everywhere.
- Run each red test before implementation and confirm it fails for the stated reason.

---

## File map

- Create `src/main/protocol/fileRangeResponse.ts`: open an authorized file, validate an inclusive byte interval, and return an abortable exact `206` streaming response.
- Create `src/main/protocol/fileRangeResponse.test.ts`: exercise response bytes, headers, boundaries, missing files, and cancellation against real temporary files.
- Modify `src/main/protocol/cacheProtocol.ts`: expose the validated range contract, pass range plus abort signal to the adapter, distinguish authorization failures from adapter failures, and retain exact-response validation.
- Modify `src/main/protocol/cacheProtocol.test.ts`: use the real adapter for positive PCM/waveform routes and retain malformed-adapter defense tests.
- Create `src/main/protocol/cacheProtocol.integration.test.ts`: run both renderer providers through the real protocol, real manifest validation, and real filesystem range adapter.
- Modify `src/main/index.ts`: replace `net.fetch(file://...)` composition with `createFileRangeResponse`.

### Task 1: Exact filesystem range response

**Files:**
- Create: `src/main/protocol/fileRangeResponse.ts`
- Create: `src/main/protocol/fileRangeResponse.test.ts`
- Reference: `docs/superpowers/specs/2026-08-15-file-range-response-design.md`

**Interfaces:**
- Consumes: `BoundedByteRange` from `cacheProtocol.ts` as a type-only import.
- Produces: `createFileRangeResponse(path: string, range: BoundedByteRange, signal: AbortSignal): Promise<Response>`.

- [ ] **Step 1: Add failing exact-range and header tests**

Create a deterministic temporary file and assert beginning, middle, and EOF-adjacent ranges:

```ts
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createFileRangeResponse } from './fileRangeResponse'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'riffcut-file-range-'))
  const path = join(root, 'artifact.bin')
  await writeFile(path, Uint8Array.from({ length: 64 }, (_, index) => index))
  return path
}

describe('createFileRangeResponse', () => {
  it.each([
    [{ start: 0, end: 7 }, [0, 1, 2, 3, 4, 5, 6, 7]],
    [{ start: 24, end: 31 }, [24, 25, 26, 27, 28, 29, 30, 31]],
    [{ start: 60, end: 63 }, [60, 61, 62, 63]],
  ] as const)('streams the inclusive range %# with exact partial headers', async (range, expected) => {
    const response = await createFileRangeResponse(
      await fixture(),
      range,
      new AbortController().signal,
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes ${range.start}-${range.end}/64`)
    expect(response.headers.get('content-length')).toBe(String(range.end - range.start + 1))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(expected)
  })
})
```

- [ ] **Step 2: Run the exact-range test and confirm the module is missing**

Run:

```bash
npx vitest run src/main/protocol/fileRangeResponse.test.ts
```

Expected: FAIL because `./fileRangeResponse` cannot be resolved.

- [ ] **Step 3: Add failing invalid-range, missing-file, and pre-abort tests**

Append:

```ts
it.each([
  { start: -1, end: 4 },
  { start: 8, end: 7 },
  { start: 60, end: 64 },
])('returns 416 without streaming invalid range $start-$end', async (range) => {
  const response = await createFileRangeResponse(
    await fixture(),
    range,
    new AbortController().signal,
  )
  expect(response.status).toBe(416)
  expect(response.body).toBeNull()
})

it('propagates a missing authorized artifact so the protocol can report 500', async () => {
  await expect(
    createFileRangeResponse(
      join(tmpdir(), 'riffcut-definitely-missing-artifact.bin'),
      { start: 0, end: 1 },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects an already-aborted request before opening a stream', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    createFileRangeResponse(await fixture(), { start: 0, end: 7 }, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
})
```

- [ ] **Step 4: Implement the minimal streaming adapter**

Create `fileRangeResponse.ts`:

```ts
import { open } from 'fs/promises'
import { Readable } from 'stream'
import type { BoundedByteRange } from './cacheProtocol'

export async function createFileRangeResponse(
  path: string,
  range: BoundedByteRange,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted()
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end >= info.size
    ) {
      await handle.close()
      return new Response(null, { status: 416 })
    }

    const length = range.end - range.start + 1
    const stream = handle.createReadStream({
      start: range.start,
      end: range.end,
      autoClose: true,
      signal,
    })
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(length),
        'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
        'content-type': 'application/octet-stream',
      },
    })
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}
```

If TypeScript rejects the generic stream conversion, use the narrow Node-supported cast `Readable.toWeb(stream) as ReadableStream<Uint8Array>`; do not buffer with `readFile` or `response.arrayBuffer()` inside production code.

- [ ] **Step 5: Add an in-flight abort test**

Use a 1 MiB fixture so the response body remains unread when cancellation occurs:

```ts
it('aborts an in-flight file stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'riffcut-file-range-abort-'))
  const path = join(root, 'large.bin')
  await writeFile(path, new Uint8Array(1024 * 1024))
  const controller = new AbortController()
  const response = await createFileRangeResponse(
    path,
    { start: 0, end: 1024 * 1024 - 1 },
    controller.signal,
  )
  controller.abort()
  await expect(response.arrayBuffer()).rejects.toMatchObject({ name: 'AbortError' })
})
```

- [ ] **Step 6: Run adapter tests and typecheck**

Run:

```bash
npx vitest run src/main/protocol/fileRangeResponse.test.ts
npm run typecheck
```

Expected: all adapter tests PASS; typecheck PASS.

- [ ] **Step 7: Commit the adapter**

```bash
git add src/main/protocol/fileRangeResponse.ts src/main/protocol/fileRangeResponse.test.ts
git commit -m "fix: stream exact cache file ranges"
```

### Task 2: Protected protocol adapter contract

**Files:**
- Modify: `src/main/protocol/cacheProtocol.ts:1-82`
- Modify: `src/main/protocol/cacheProtocol.test.ts:1-120`
- Consume: `src/main/protocol/fileRangeResponse.ts`

**Interfaces:**
- Produces: `export interface BoundedByteRange { readonly start: number; readonly end: number }`.
- Produces: `CacheResourceFetcher = (path: string, range: BoundedByteRange, signal: AbortSignal) => Promise<Response>`.
- Consumes: `createFileRangeResponse` as the real positive-path adapter in tests.

- [ ] **Step 1: Replace the positive protocol mock with a failing real-adapter test**

In `cacheProtocol.test.ts`, make the fixture return the expected first PCM bytes and import the real adapter:

```ts
import { createFileRangeResponse } from './fileRangeResponse'

it('serves a validated PCM artifact through the real bounded file adapter', async () => {
  const active = await projectRoot()
  const handler = createCacheProtocolHandler(() => active, createFileRangeResponse)
  const response = await handler(
    new Request(`riffcut://cache/${SOURCE_ID}/pcm`, {
      headers: { Range: 'bytes=0-3' },
    }),
  )

  expect(response.status).toBe(206)
  expect(response.headers.get('content-range')).toBe('bytes 0-3/8')
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3])
})
```

Write the fixture PCM as `Uint8Array.from({ length: 8 }, (_, index) => index)`.

- [ ] **Step 2: Run the focused test and confirm the signature mismatch**

Run:

```bash
npx vitest run src/main/protocol/cacheProtocol.test.ts
```

Expected: FAIL because the protocol passes a `Request`, while `createFileRangeResponse` requires a validated range and signal.

- [ ] **Step 3: Change the protocol contract and forward parsed range plus cancellation**

Update the contract and return type from `parseBoundedRange`:

```ts
export interface BoundedByteRange {
  readonly start: number
  readonly end: number
}

export type CacheResourceFetcher = (
  path: string,
  range: BoundedByteRange,
  signal: AbortSignal,
) => Promise<Response>
```

Call the adapter with:

```ts
const response = await fetchFile(path, range, request.signal)
```

Keep the existing maximum-size calculation and exact start/end response validation unchanged.

- [ ] **Step 4: Add failing status-classification tests**

Add one malformed adapter test and one authorized-file failure test:

```ts
it('rejects an adapter that does not return exact partial-content metadata', async () => {
  const active = await projectRoot()
  const handler = createCacheProtocolHandler(
    () => active,
    vi.fn(async () => new Response(new Uint8Array(4), { status: 200 })),
  )
  const response = await handler(
    new Request(`riffcut://cache/${SOURCE_ID}/pcm`, {
      headers: { Range: 'bytes=0-3' },
    }),
  )
  expect(response.status).toBe(502)
})

it('reports 500 when an authorized cache artifact disappears before it can be opened', async () => {
  const active = await projectRoot()
  const handler = createCacheProtocolHandler(
    () => active,
    vi.fn(async () => {
      throw Object.assign(new Error('file vanished'), { code: 'ENOENT' })
    }),
  )
  const response = await handler(
    new Request(`riffcut://cache/${SOURCE_ID}/pcm`, {
      headers: { Range: 'bytes=0-3' },
    }),
  )
  expect(response.status).toBe(500)
})
```

- [ ] **Step 5: Separate authorization errors from adapter failures**

Keep source lookup, manifest validation, and artifact resolution inside the existing `try` that maps failures to `404`. Move the adapter call into a second `try`:

```ts
let response: Response
try {
  response = await fetchFile(path, range, request.signal)
} catch (error) {
  if (isAbortError(error)) throw error
  return new Response('Unable to read cache resource', { status: 500 })
}
if (response.status === 416) return response
```

Add the local structural helper:

```ts
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
```

Do not include filesystem paths or raw error messages in the response.

- [ ] **Step 6: Update existing mock signatures without weakening assertions**

Every `CacheResourceFetcher` mock must now receive `(path, range, signal)`. Assert the parsed values explicitly:

```ts
expect(fetchFile).toHaveBeenCalledWith(
  expect.stringContaining('audio.f32le'),
  { start: 0, end: 3 },
  expect.any(AbortSignal),
)
```

- [ ] **Step 7: Run protocol, adapter, and type tests**

Run:

```bash
npx vitest run src/main/protocol/fileRangeResponse.test.ts src/main/protocol/cacheProtocol.test.ts
npm run typecheck
```

Expected: all focused tests PASS; typecheck PASS.

- [ ] **Step 8: Commit the protocol contract**

```bash
git add src/main/protocol/cacheProtocol.ts src/main/protocol/cacheProtocol.test.ts
git commit -m "fix: route validated ranges to cache files"
```

### Task 3: Real provider-to-filesystem integration

**Files:**
- Create: `src/main/protocol/cacheProtocol.integration.test.ts`
- Consume: `src/main/protocol/cacheProtocol.ts`
- Consume: `src/main/protocol/fileRangeResponse.ts`
- Consume: `src/renderer/src/audio/samples/ContinuousPcmSampleProvider.ts`
- Consume: `src/renderer/src/components/Waveform/BinaryWaveformDataProvider.ts`

**Interfaces:**
- Consumes the unchanged path-free `AudioSourceCacheDescriptor`.
- Proves both renderer providers can traverse the real protocol and real file adapter without an idealized fetch mock.

- [ ] **Step 1: Create a real managed-cache fixture**

Build a two-channel, four-frame PCM file with these interleaved Float32 values:

```ts
const interleaved = new Float32Array([0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1])
const pcmBytes = new Uint8Array(interleaved.buffer)
const waveformBytes = new Uint8Array(8)
const waveformView = new DataView(waveformBytes.buffer)
waveformView.setFloat32(0, -1, true)
waveformView.setFloat32(4, 1, true)
```

Write `project.json`, the cache manifest, `audio.f32le`, and all three required waveform files under a temporary project root. Each waveform level has `bucketCount: 1` and the matching eight-byte artifact. Use a valid AudioSource with `channels: 2`, the same source hash as the manifest, and a descriptor with `frameCount: 4`.

- [ ] **Step 2: Add a failing PCM-provider integration test**

Install a scoped fetch bridge in the test:

```ts
const handler = createCacheProtocolHandler(() => ({ root, project }), createFileRangeResponse)
vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) =>
  handler(new Request(url, init)),
)
```

Then assert real deinterleaving:

```ts
const provider = new ContinuousPcmSampleProvider(descriptor)
const chunk = await provider.readFrames(1, 2, new AbortController().signal)
expect([...chunk.channels[0]]).toEqual([0.5, 0.75])
expect([...chunk.channels[1]]).toEqual([-0.5, -0.75])
```

- [ ] **Step 3: Run the integration test before completing the fixture**

Run:

```bash
npx vitest run src/main/protocol/cacheProtocol.integration.test.ts
```

Expected: FAIL until the fixture has a manifest and all exact-size artifacts accepted by `AudioSourceCacheStore`.

- [ ] **Step 4: Complete the fixture and add waveform-provider integration**

Add:

```ts
const provider = new BinaryWaveformDataProvider(descriptor)
const range = await provider.readRange({
  sourceStartSeconds: 0,
  sourceEndSeconds: 4 / 48_000,
  targetPixelWidth: 4,
  signal: new AbortController().signal,
})
expect(range.buckets).toEqual([{ min: -1, max: 1 }])
```

Also assert the scoped fetch bridge observed only `riffcut://cache/` URLs and bounded `Range` headers.

- [ ] **Step 5: Add a late-file range case**

Read the final PCM frame and assert its exact channels:

```ts
const tail = await new ContinuousPcmSampleProvider(descriptor).readFrames(
  descriptor.frameCount - 1,
  1,
  new AbortController().signal,
)
expect([...tail.channels[0]]).toEqual([1])
expect([...tail.channels[1]]).toEqual([-1])
```

- [ ] **Step 6: Restore globals and run the integration group**

Use `afterEach(() => vi.unstubAllGlobals())`, then run:

```bash
npx vitest run src/main/protocol/cacheProtocol.integration.test.ts src/main/protocol/cacheProtocol.test.ts src/main/protocol/fileRangeResponse.test.ts
npm run typecheck
```

Expected: all integration and unit tests PASS; typecheck PASS.

- [ ] **Step 7: Commit integration coverage**

```bash
git add src/main/protocol/cacheProtocol.integration.test.ts
git commit -m "test: exercise managed cache range workflow"
```

### Task 4: Application wiring and regression verification

**Files:**
- Modify: `src/main/index.ts:1-50`
- Verify: `src/main/protocol/fileRangeResponse.ts`
- Verify: `src/main/protocol/cacheProtocol.ts`
- Verify: `src/main/audio/import/FfmpegAudioSourceCacheBuilder.test.ts`

**Interfaces:**
- Replaces the `net.fetch(pathToFileURL(...))` adapter with `createFileRangeResponse`.
- Leaves `createCacheProtocolHandler` and renderer-facing `riffcut://cache` URLs unchanged.

- [ ] **Step 1: Add a source-wiring assertion before changing `index.ts`**

Add this narrow assertion to `fileRangeResponse.test.ts` so the regression cannot silently return through composition:

```ts
import { readFile } from 'fs/promises'

it('is the cache adapter composed by the Electron main entrypoint', async () => {
  const mainSource = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  expect(mainSource).toContain("import { createFileRangeResponse } from './protocol/fileRangeResponse'")
  expect(mainSource).toContain('createCacheProtocolHandler(')
  expect(mainSource).toContain('createFileRangeResponse,')
  expect(mainSource).not.toContain('pathToFileURL')
  expect(mainSource).not.toContain('net.fetch')
})
```

- [ ] **Step 2: Run the wiring assertion and confirm it fails on the old adapter**

Run:

```bash
npx vitest run src/main/protocol/fileRangeResponse.test.ts
```

Expected: FAIL because `index.ts` still imports `net`, imports `pathToFileURL`, and composes `net.fetch`.

- [ ] **Step 3: Replace Electron file fetching with the exact adapter**

Change imports from:

```ts
import { app, BrowserWindow, net, protocol } from 'electron'
import { pathToFileURL } from 'url'
```

to:

```ts
import { app, BrowserWindow, protocol } from 'electron'
import { createFileRangeResponse } from './protocol/fileRangeResponse'
```

Compose:

```ts
protocol.handle(
  'riffcut',
  createCacheProtocolHandler(
    () => ({ root: controller.workspace.root, project: controller.workspace.project }),
    createFileRangeResponse,
  ),
)
```

- [ ] **Step 4: Run focused and full automated verification**

Run in this order:

```bash
npx vitest run src/main/protocol/fileRangeResponse.test.ts src/main/protocol/cacheProtocol.test.ts src/main/protocol/cacheProtocol.integration.test.ts
npm run format
npm run check
npm run profile:waveform
git diff --check
```

Expected:

- focused tests PASS;
- formatting, ESLint, Knip, typecheck, all tests, and production build PASS;
- waveform profile stays below its existing 8 ms p95 threshold;
- `git diff --check` prints no output.

- [ ] **Step 5: Exercise the supplied MP3 through the actual application workflow**

Run:

```bash
npm run dev
```

In the Electron application:

1. Choose Import, select `/Users/boning/Documents/自来野/long-sample.mp3`, and use Reference mode.
2. Wait for validation, fingerprinting, cache build, publication, and waveform display to complete.
3. Confirm the waveform renders at the beginning, around 2,400 seconds, and near 4,800 seconds.
4. Play from zero for at least 15 seconds.
5. Seek to approximately 60, 2,400, and 4,800 seconds and play for at least 10 seconds at each position.
6. Confirm cache requests return `206`, no cache request returns `4xx` or `5xx`, playback produces sound at non-silent positions, and the player reports no cache-transport errors.
7. Save the project, close it, reopen it, and repeat the 4,800-second seek.
8. Cancel the development process after recording the results.

If any step fails, stop completion and return to `superpowers:systematic-debugging` with the first failing boundary. Do not add a second speculative fix.

- [ ] **Step 6: Commit application wiring**

```bash
git add src/main/index.ts src/main/protocol/fileRangeResponse.test.ts
git commit -m "fix: serve cache ranges without electron file fetch"
```

- [ ] **Step 7: Request final code review**

Invoke `superpowers:requesting-code-review` over the complete repair range. Require the reviewer to verify:

- no `net.fetch(file://...)` cache path remains;
- no filesystem path crosses renderer IPC;
- the adapter cannot return bytes outside the validated interval;
- canceled requests close their stream;
- all positive protocol tests use the real adapter;
- the supplied MP3 workflow evidence covers late playback and seeking.

Address every Critical or Important finding with a new failing test before changing implementation.

### Task 5: Narrow renderer policy and complete workflow validation

**Files:**
- Modify: `src/renderer/index.html:6-15`
- Create: `src/main/protocol/cacheProtocolSecurity.test.ts`
- Verify: `src/main/index.ts:11-13`

**Interfaces:**
- Produces: renderer CSP directive `connect-src 'self' riffcut:`.
- Preserves: `{ secure: true, supportFetchAPI: true, stream: true }` protocol privileges without `bypassCSP`.
- Consumes: the unchanged renderer-facing `riffcut://cache/...` URLs and protected main-process handler.

- [ ] **Step 1: Add a failing semantic policy regression test**

Create `cacheProtocolSecurity.test.ts`:

```ts
import { readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function parseDirectives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  )
}

describe('managed cache renderer security policy', () => {
  it('allows only the required renderer connection schemes without bypassing CSP', async () => {
    const rendererHtml = await readFile(
      join(__dirname, '../../renderer/index.html'),
      'utf8',
    )
    const mainSource = await readFile(join(__dirname, '../index.ts'), 'utf8')
    const policy = rendererHtml.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1]

    expect(policy).toBeDefined()
    expect(parseDirectives(policy!).get('connect-src')).toEqual(["'self'", 'riffcut:'])
    expect(mainSource).not.toContain('bypassCSP')
  })
})
```

- [ ] **Step 2: Run the regression test and confirm the missing directive**

Run:

```bash
npx vitest run src/main/protocol/cacheProtocolSecurity.test.ts
```

Expected: FAIL because `connect-src` is absent, while the no-`bypassCSP` assertion already passes.

- [ ] **Step 3: Add only the narrow CSP connection directive**

Change the renderer CSP to:

```html
content="default-src 'self'; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' riffcut:; media-src 'self' blob: file:; img-src 'self' data: blob:"
```

Update the adjacent CSP comment to state that `connect-src 'self' riffcut:` permits managed cache fetches. Do not add `bypassCSP` or any wildcard source.

- [ ] **Step 4: Run the policy and cache integration tests**

Run:

```bash
npx vitest run src/main/protocol/cacheProtocolSecurity.test.ts src/main/protocol/fileRangeResponse.test.ts src/main/protocol/cacheProtocol.test.ts src/main/protocol/cacheProtocol.integration.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 5: Run the complete automated verification**

Run in this order:

```bash
npm run format
npm run check
npm run profile:waveform
git diff --check
```

Expected: formatting, ESLint, Knip, typecheck, all tests, production build, and waveform performance PASS; `git diff --check` prints no output.

- [ ] **Step 6: Repeat the complete supplied-MP3 workflow**

Run `npm run dev` and import `/Users/boning/Documents/自来野/long-sample.mp3` in Reference mode. If macOS Accessibility still blocks native-picker automation, substitute only `dialog.showOpenDialog`'s Import Audio result as in Task 4 and record that limitation.

Verify all of these checkpoints:

1. The renderer reports no CSP violation for `riffcut://cache/...`.
2. Waveforms render at the beginning, around 2,400 seconds, and near 4,800 seconds.
3. Playback runs from zero for at least 15 seconds.
4. Playback runs for at least 10 seconds after seeks near 60, 2,400, and 4,800 seconds.
5. Renderer cache requests return exact `206` responses with no `4xx` or `5xx` responses or cache-transport errors.
6. The AudioWorklet queue does not report transport-attributable underruns during those intervals.
7. Save the project, close it, reopen it, seek near 4,800 seconds, and play for at least 10 seconds.

Stop at the first failure and return to `superpowers:systematic-debugging`; do not stack another speculative fix. Shut down Electron and remove only the temporary diagnostic workspace created by this run after evidence is recorded.

- [ ] **Step 7: Commit the policy repair**

```bash
git add src/renderer/index.html src/main/protocol/cacheProtocolSecurity.test.ts
git commit -m "fix: allow managed cache protocol connections"
```

- [ ] **Step 8: Request final whole-branch review**

Invoke `superpowers:requesting-code-review` over the complete managed-audio repair range. Require the reviewer to verify the exact CSP directive, absence of `bypassCSP`, protected range behavior, cancellation, provider integration, and complete supplied-MP3 workflow evidence.

## Final acceptance

- Electron no longer serves cache files through `net.fetch(file://...)`.
- Every successful PCM and waveform request returns exact `206`, `Content-Range`, and `Content-Length` metadata.
- Invalid or oversized ranges return `416` without opening an unrestricted stream.
- Authorized file failures return `500`; authorization and manifest failures remain `404`.
- Cancellation aborts in-flight file delivery without producing a playback error.
- Renderer providers require no code or contract changes.
- Renderer CSP contains exactly `connect-src 'self' riffcut:` and the protocol registration does not use `bypassCSP`.
- The supplied MP3 imports, renders waveforms, plays from zero, and seeks near 60, 2,400, and 4,800 seconds without cache transport errors.
- `npm run check`, `npm run profile:waveform`, and `git diff --check` pass.
