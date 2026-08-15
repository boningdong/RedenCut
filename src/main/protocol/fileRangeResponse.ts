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
