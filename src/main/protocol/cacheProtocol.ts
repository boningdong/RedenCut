import { AudioSourceIdSchema, type ProjectFile } from '../../shared/project.types'
import { AudioSourceCacheStore } from '../audio/cache/AudioSourceCacheStore'

export type CacheResourceFetcher = (
  path: string,
  range: BoundedByteRange,
  signal: AbortSignal,
) => Promise<Response>
export interface BoundedByteRange {
  readonly start: number
  readonly end: number
}
const MAX_RANGE_BYTES = 32 * 1024 * 1024

export function createCacheProtocolHandler(
  getActiveProject: () => { root: string; project: ProjectFile },
  fetchFile: CacheResourceFetcher,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'cache') return notFound()
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length < 2 || segments.length > 3) return notFound()
    const [sourceValue, resource, levelValue] = segments
    const parsedId = AudioSourceIdSchema.safeParse(sourceValue)
    if (!parsedId.success) return notFound()
    const validResource =
      (resource === 'pcm' && segments.length === 2) ||
      (resource === 'waveform' &&
        segments.length === 3 &&
        [256, 4096, 65536].includes(Number(levelValue)))
    if (!validResource) return notFound()
    const range = parseBoundedRange(request.headers.get('Range'))
    if (!range) {
      return new Response('A bounded byte range is required', { status: 416 })
    }
    try {
      const active = getActiveProject()
      const source = active.project.audioSources.find((candidate) => candidate.id === parsedId.data)
      if (!source) return notFound()
      const store = new AudioSourceCacheStore(active.root)
      const path =
        resource === 'pcm' && segments.length === 2
          ? await store.resolvePcm(source)
          : resource === 'waveform' && segments.length === 3 && levelValue
            ? await store.resolveWaveform(source, Number(levelValue))
            : null
      if (!path) return notFound()
      let response: Response
      try {
        response = await fetchFile(path, range, request.signal)
      } catch (error) {
        if (isAbortError(error)) throw error
        return new Response('Unable to read cache resource', { status: 500 })
      }
      if (response.status === 416) return response
      const contentRange = response.headers
        .get('content-range')
        ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
      const contentLength = parseSafeInteger(response.headers.get('content-length'))
      const expectedLength = range.end - range.start + 1
      if (
        response.status !== 206 ||
        !contentRange ||
        !contentLength ||
        Number(contentRange[1]) !== range.start ||
        Number(contentRange[2]) !== range.end ||
        !isSafePositiveInteger(Number(contentRange[3])) ||
        Number(contentRange[3]) <= range.end ||
        contentLength !== expectedLength
      ) {
        await cancelResponseBody(response)
        return new Response('Cache resource did not honor the requested byte range', {
          status: 502,
        })
      }
      const headers = new Headers(response.headers)
      headers.set('content-type', 'application/octet-stream')
      headers.set('access-control-allow-origin', '*')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      return notFound()
    }
  }
}

function parseBoundedRange(value: string | null): BoundedByteRange | null {
  const match = value?.match(/^bytes=(\d+)-(\d+)$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    end >= start &&
    end - start + 1 <= MAX_RANGE_BYTES
    ? { start, end }
    : null
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

function parseSafeInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Ignore cancellation failures while rejecting malformed adapter metadata.
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}
