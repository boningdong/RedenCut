# File Range Response Design

## Status

This design repairs the protected cache transport introduced by the managed AudioSource and PCM-cache architecture.

The supplied 148 MB MP3 imports successfully, produces a valid 48 kHz PCM cache and waveform pyramid, and supports correct early, middle, and late-file reads when accessed through a standards-compliant range adapter. The failure occurs only at Electron's `net.fetch(file://...)` boundary: a request for `bytes=0-31` returns the correct 32-byte body with status `200` and no `Content-Range`. The protected cache protocol requires an exact `206 Content-Range` response and therefore returns `502` for every PCM and waveform request.

## Goals

- Serve validated PCM and waveform artifacts as exact bounded byte ranges.
- Preserve the protocol's strict `206` and `Content-Range` validation.
- Remove playback correctness from undocumented Electron `file://` response behavior.
- Keep file access, memory use, and renderer authority bounded.
- Add integration coverage using a real filesystem adapter instead of an idealized response mock.

## Non-goals

- No project schema, cache manifest, IPC, preload, or renderer-provider changes.
- No new durable project files or directories.
- No migration or cache rebuild solely because of this repair.
- No relaxation that accepts full-file `200` responses.
- No unrelated playback, waveform, or import refactoring.

## Project layout

The repository adds one functional module and its focused test:

```text
src/main/
├── index.ts
└── protocol/
    ├── cacheProtocol.ts
    ├── cacheProtocol.test.ts
    ├── fileRangeResponse.ts
    └── fileRangeResponse.test.ts
```

The `.podcut` bundle remains unchanged:

```text
Project.podcut/
├── project.json
├── media/
│   └── <audioSourceId>/...
└── cache/
    └── <audioSourceId>/
        ├── manifest.json
        ├── audio.f32le
        └── waveform/
            ├── level-256.minmax-f32le
            ├── level-4096.minmax-f32le
            └── level-65536.minmax-f32le
```

## Component responsibilities

### Cache protocol

`cacheProtocol.ts` continues to own:

- `podcut://cache/<audioSourceId>/pcm` and waveform route validation;
- active-project and AudioSource authorization;
- cache-manifest validation and artifact resolution;
- bounded-range syntax and maximum-range policy;
- verification that the file adapter returns the exact requested `206` interval;
- binary MIME and CORS response headers.

It parses the renderer's `Range` header once and passes the validated byte interval to the file adapter.

### File range response

`fileRangeResponse.ts` owns only filesystem range delivery. It:

1. Stats the already-authorized artifact.
2. Rejects negative, reversed, or out-of-file intervals.
3. Opens a read stream constrained to the inclusive `start` and `end` offsets.
4. Converts the Node stream to a web-readable response body.
5. Returns status `206` with exact `Content-Range`, `Content-Length`, `Accept-Ranges`, and binary content type headers.
6. Propagates abort and stream errors without buffering the requested body in full.

The filename uses lower camel case because the module exports a function, not a class.

### Application composition

`index.ts` replaces the `net.fetch(file://...)` callback with the file range response function. It remains composition-only and does not parse ranges or access manifests.

### Renderer connection policy

The renderer Content Security Policy explicitly permits cache fetches with `connect-src 'self' podcut:`. The `podcut` scheme remains registered with `secure`, `supportFetchAPI`, and `stream` privileges, but it must not use Electron's `bypassCSP` privilege.

This keeps Chromium's policy enforcement active while authorizing only the connection scheme required by the managed PCM and waveform providers. Main-process route, source, manifest, range, and artifact validation remain the authorization boundary behind that scheme.

### Renderer providers

`ContinuousPcmSampleProvider` and `BinaryWaveformDataProvider` remain unchanged. Their existing requirement for status `206` and exact body length is the desired consumer contract.

## Runtime contracts

The validated byte interval is runtime-only and never crosses IPC or enters persisted data:

```ts
export interface BoundedByteRange {
  start: number
  end: number
}

export type CacheResourceFetcher = (
  path: string,
  range: BoundedByteRange,
  signal: AbortSignal,
) => Promise<Response>

export function createFileRangeResponse(
  path: string,
  range: BoundedByteRange,
  signal: AbortSignal,
): Promise<Response>
```

`cacheProtocol.ts` exports `BoundedByteRange` and `CacheResourceFetcher` because it owns range validation and the adapter boundary. `fileRangeResponse.ts` uses a type-only import of `BoundedByteRange`; this introduces no runtime dependency cycle.

The protocol obtains the signal from the incoming request and forwards it so canceled waveform or seek requests close the underlying file stream.

## Data flow

```text
PCM or waveform provider
    -> podcut://cache URL plus bounded Range
    -> cache protocol route, source, manifest, and range validation
    -> createFileRangeResponse(path, range, signal)
    -> exact filesystem stream
    -> 206 response with exact range metadata
    -> provider length validation and decoding
```

Filesystem paths remain confined to the main process. The renderer supplies only an AudioSource identity, resource kind, waveform level, and bounded range.

## Error behavior

- Missing or malformed `Range`: `416` before filesystem access.
- Range larger than the protocol maximum: `416` before filesystem access.
- End offset beyond the validated artifact: `416` from the file adapter boundary.
- Unknown source, route, level, manifest, or artifact: `404`.
- File open/read failure after successful authorization: `500` rather than a misleading `404`.
- Adapter response that does not exactly match the requested interval: `502` defense-in-depth failure.
- Request cancellation: abort the file stream and propagate `AbortError`; do not report it as a playback failure.

## Testing

### File adapter tests

Use a temporary file with deterministic bytes and assert:

- beginning, middle, and final-byte ranges return the exact bytes;
- status is `206`;
- `Content-Range`, `Content-Length`, `Accept-Ranges`, and content type are exact;
- reversed, negative, and past-EOF ranges are rejected;
- abort closes the stream and does not deliver a late response;
- the implementation does not call a whole-file read API.

### Protocol integration tests

Replace the idealized `206` mock in the positive path with the real file range adapter and a real validated cache fixture. Retain a deliberately malformed adapter test to prove defense-in-depth rejection.

Assert both PCM and every supported waveform route, including beginning, middle, and EOF-adjacent requests.

### Provider integration tests

Route `ContinuousPcmSampleProvider` and `BinaryWaveformDataProvider` through the real protocol and file adapter. Verify exact PCM frame deinterleaving, waveform bucket decoding, late-file reads, short EOF reads, and abort behavior.

### Workflow verification

Re-import the supplied `long-sample.mp3`, then verify:

- waveform rendering at the beginning, middle, and end;
- playback from zero;
- seeks near 60, 2,400, and 4,800 seconds;
- bounded network responses with no `4xx` or `5xx` cache requests;
- no AudioWorklet underruns attributable to cache transport;
- reopening the generated project and repeating a late seek.

The workflow must also confirm that renderer-originated `podcut://cache/...` requests reach the registered handler without CSP violations. A successful main-process diagnostic alone is insufficient because it bypasses the renderer policy boundary.

## Completion criteria

The repair is complete when the real file adapter returns exact standards-compliant `206` responses, PCM and waveform providers succeed through the protected protocol, the renderer CSP permits `podcut:` without `bypassCSP`, the supplied MP3 plays and seeks at late positions without cache transport errors, the repository quality gate passes, and no project-format or renderer-authority expansion has been introduced.
