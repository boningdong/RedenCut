import { AudioSourceIdSchema, type ProjectFile } from '../../shared/project.types'
import { AudioSourceCacheStore } from '../audio/cache/AudioSourceCacheStore'

export type CacheResourceFetcher = (path: string, request: Request) => Promise<Response>
export interface BoundedByteRange {
  start: number
  end: number
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
      const response = await fetchFile(path, request)
      const contentRange = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/\d+$/)
      if (
        response.status !== 206 ||
        !contentRange ||
        Number(contentRange[1]) !== range.start ||
        Number(contentRange[2]) !== range.end
      ) {
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
    } catch {
      return notFound()
    }
  }
}

function parseBoundedRange(value: string | null): { start: number; end: number } | null {
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

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}
