import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileRangeResponse } from './fileRangeResponse'

const temporaryRoots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'riffcut-file-range-'))
  temporaryRoots.push(root)
  const path = join(root, 'artifact.bin')
  await writeFile(
    path,
    Uint8Array.from({ length: 64 }, (_, index) => index),
  )
  return path
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0)
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(
    roots.map((root) => expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })),
  )
})

describe('createFileRangeResponse', () => {
  it('is the cache adapter composed by the Electron main entrypoint', async () => {
    const mainSource = await readFile(join(__dirname, '../index.ts'), 'utf8')
    expect(mainSource).toContain(
      "import { createFileRangeResponse } from './protocol/fileRangeResponse'",
    )
    expect(mainSource).toContain('createCacheProtocolHandler(')
    expect(mainSource).toContain('createFileRangeResponse,')
    expect(mainSource).not.toContain('pathToFileURL')
    expect(mainSource).not.toContain('net.fetch')
  })

  it.each([
    [{ start: 0, end: 7 }, [0, 1, 2, 3, 4, 5, 6, 7]],
    [{ start: 24, end: 31 }, [24, 25, 26, 27, 28, 29, 30, 31]],
    [{ start: 60, end: 63 }, [60, 61, 62, 63]],
  ] as const)(
    'streams the inclusive range %# with exact partial headers',
    async (range, expected) => {
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
    },
  )

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

  it('aborts an in-flight file stream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'riffcut-file-range-abort-'))
    temporaryRoots.push(root)
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
})
