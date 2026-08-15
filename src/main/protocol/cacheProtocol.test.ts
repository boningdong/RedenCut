import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { AudioSourceSchema, createEmptyProject } from '../../shared/project.types'
import { createCacheProtocolHandler } from './cacheProtocol'
import { createFileRangeResponse } from './fileRangeResponse'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001'

async function projectRoot() {
  const root = await mkdtemp(join(tmpdir(), 'podcut-protocol-'))
  const cache = join(root, 'cache', SOURCE_ID)
  await mkdir(join(cache, 'waveform'), { recursive: true })
  await writeFile(join(cache, 'audio.f32le'), Uint8Array.from({ length: 8 }, (_, index) => index))
  for (const level of [256, 4096, 65536])
    await writeFile(join(cache, 'waveform', `level-${level}.minmax-f32le`), new Uint8Array(8))
  await writeFile(
    join(cache, 'manifest.json'),
    JSON.stringify({
      version: 1,
      audioSourceId: SOURCE_ID,
      sourceSha256: 'a'.repeat(64),
      generatorVersion: 'podcut-cache-v1',
      pcm: {
        file: `cache/${SOURCE_ID}/audio.f32le`,
        sampleFormat: 'f32le',
        layout: 'interleaved',
        sampleRate: 48_000,
        channels: 2,
        frameCount: 1,
        byteLength: 8,
      },
      waveform: {
        representation: 'min-max-f32le',
        levels: [256, 4096, 65536].map((level) => ({
          file: `cache/${SOURCE_ID}/waveform/level-${level}.minmax-f32le`,
          samplesPerBucket: level,
          bucketCount: 1,
        })),
      },
    }),
  )
  const project = createEmptyProject()
  project.audioSources = [
    AudioSourceSchema.parse({
      id: SOURCE_ID,
      displayName: 'source.wav',
      location: { mode: 'copy', path: `media/${SOURCE_ID}/source.wav` },
      fingerprint: { byteLength: 1, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
      metadata: {
        durationSeconds: 1,
        sampleRate: 48_000,
        channels: 2,
        codec: 'pcm_s16le',
        bitrateKbps: 1536,
      },
    }),
  ]
  return { root, project }
}

describe('managed cache protocol', () => {
  it('serves a validated PCM artifact through the real bounded file adapter', async () => {
    const active = await projectRoot()
    const handler = createCacheProtocolHandler(() => active, createFileRangeResponse)
    const response = await handler(
      new Request(`podcut://cache/${SOURCE_ID}/pcm`, { headers: { Range: 'bytes=0-3' } }),
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-3/8')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3])
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it.each([
    'podcut://other/00000000-0000-4000-8000-000000000001/pcm',
    'podcut://cache/not-a-uuid/pcm',
    `podcut://cache/${SOURCE_ID}/waveform/512`,
    `podcut://cache/${SOURCE_ID}/../../project.json`,
  ])('returns 404 for an unprotected route: %s', async (url) => {
    const handler = createCacheProtocolHandler(
      () => ({ root: '/unused', project: createEmptyProject() }),
      vi.fn(),
    )
    expect((await handler(new Request(url))).status).toBe(404)
  })

  it('rejects missing and oversized byte ranges before touching the filesystem adapter', async () => {
    const fetchFile = vi.fn()
    const handler = createCacheProtocolHandler(
      () => ({ root: '/unused', project: createEmptyProject() }),
      fetchFile,
    )
    expect((await handler(new Request(`podcut://cache/${SOURCE_ID}/pcm`))).status).toBe(416)
    expect(
      (
        await handler(
          new Request(`podcut://cache/${SOURCE_ID}/pcm`, {
            headers: { Range: `bytes=0-${32 * 1024 * 1024}` },
          }),
        )
      ).status,
    ).toBe(416)
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('rejects a file adapter that ignores the bounded range request', async () => {
    const active = await projectRoot()
    const fetchFile = vi.fn(async () => new Response(new Uint8Array(8), { status: 200 }))
    const handler = createCacheProtocolHandler(
      () => active,
      fetchFile,
    )
    const response = await handler(
      new Request(`podcut://cache/${SOURCE_ID}/pcm`, { headers: { Range: 'bytes=0-3' } }),
    )
    expect(response.status).toBe(502)
    expect(fetchFile).toHaveBeenCalledWith(
      expect.stringContaining('audio.f32le'),
      { start: 0, end: 3 },
      expect.any(AbortSignal),
    )
  })

  it('rejects an adapter that does not return exact partial-content metadata', async () => {
    const active = await projectRoot()
    const handler = createCacheProtocolHandler(
      () => active,
      vi.fn(async () => new Response(new Uint8Array(4), { status: 200 })),
    )
    const response = await handler(
      new Request(`podcut://cache/${SOURCE_ID}/pcm`, { headers: { Range: 'bytes=0-3' } }),
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
      new Request(`podcut://cache/${SOURCE_ID}/pcm`, { headers: { Range: 'bytes=0-3' } }),
    )
    expect(response.status).toBe(500)
  })
})
