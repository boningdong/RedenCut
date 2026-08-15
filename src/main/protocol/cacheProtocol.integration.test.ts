import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioSourceSchema, createEmptyProject } from '../../shared/project.types'
import type { AudioSourceCacheDescriptor } from '../../shared/import.types'
import { ContinuousPcmSampleProvider } from '../../renderer/src/audio/samples/ContinuousPcmSampleProvider'
import { BinaryWaveformDataProvider } from '../../renderer/src/components/Waveform/BinaryWaveformDataProvider'
import { createCacheProtocolHandler } from './cacheProtocol'
import { createFileRangeResponse } from './fileRangeResponse'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001'
const SOURCE_HASH = 'b'.repeat(64)
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function createFixture(): Promise<{
  root: string
  project: ReturnType<typeof createEmptyProject>
  descriptor: AudioSourceCacheDescriptor
}> {
  const root = await mkdtemp(join(tmpdir(), 'podcut-cache-integration-'))
  temporaryRoots.push(root)
  const source = AudioSourceSchema.parse({
    id: SOURCE_ID,
    displayName: 'fixture.wav',
    location: { mode: 'copy', path: `media/${SOURCE_ID}/fixture.wav` },
    fingerprint: { byteLength: 32, modifiedTimeMs: 1, sha256: SOURCE_HASH },
    metadata: {
      durationSeconds: 4 / 48_000,
      sampleRate: 48_000,
      channels: 2,
      codec: 'pcm_s16le',
      bitrateKbps: 1_536,
    },
  })
  const project = createEmptyProject()
  project.audioSources = [source]
  await writeFile(join(root, 'project.json'), JSON.stringify(project))
  const cacheRoot = join(root, 'cache', SOURCE_ID)
  await mkdir(join(cacheRoot, 'waveform'), { recursive: true })

  const interleaved = new Float32Array([0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1])
  const pcmBytes = new Uint8Array(interleaved.buffer)
  const waveformBytes = new Uint8Array(8)
  const waveformView = new DataView(waveformBytes.buffer)
  waveformView.setFloat32(0, -1, true)
  waveformView.setFloat32(4, 1, true)
  await writeFile(join(cacheRoot, 'audio.f32le'), pcmBytes)
  for (const level of [256, 4096, 65536]) {
    await writeFile(join(cacheRoot, 'waveform', `level-${level}.minmax-f32le`), waveformBytes)
  }
  await writeFile(
    join(cacheRoot, 'manifest.json'),
    JSON.stringify({
      version: 1,
      audioSourceId: SOURCE_ID,
      sourceSha256: SOURCE_HASH,
      generatorVersion: 'podcut-cache-v1',
      pcm: {
        file: `cache/${SOURCE_ID}/audio.f32le`,
        sampleFormat: 'f32le',
        layout: 'interleaved',
        sampleRate: 48_000,
        channels: 2,
        frameCount: 4,
        byteLength: pcmBytes.byteLength,
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

  return {
    root,
    project,
    descriptor: {
      audioSourceId: source.id,
      sampleRate: 48_000,
      channels: 2,
      frameCount: 4,
      waveformLevels: [256, 4096, 65536].map((samplesPerBucket) => ({
        samplesPerBucket: samplesPerBucket as 256 | 4096 | 65536,
        bucketCount: 1,
      })),
    },
  }
}

describe('managed cache provider integration', () => {
  it('traverses real bounded PCM and waveform cache responses', async () => {
    const { root, project, descriptor } = await createFixture()
    const handler = createCacheProtocolHandler(() => ({ root, project }), createFileRangeResponse)
    const requests: Request[] = []
    vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init)
      requests.push(request)
      return handler(request)
    })

    const provider = new ContinuousPcmSampleProvider(descriptor)
    const chunk = await provider.readFrames(1, 2, new AbortController().signal)

    expect([...chunk.channels[0]]).toEqual([0.5, 0.75])
    expect([...chunk.channels[1]]).toEqual([-0.5, -0.75])

    const range = await new BinaryWaveformDataProvider(descriptor).readRange({
      sourceStartSeconds: 0,
      sourceEndSeconds: 4 / 48_000,
      targetPixelWidth: 4,
      signal: new AbortController().signal,
    })
    expect(range.buckets).toEqual([{ min: -1, max: 1 }])

    const tail = await new ContinuousPcmSampleProvider(descriptor).readFrames(
      descriptor.frameCount - 1,
      1,
      new AbortController().signal,
    )
    expect([...tail.channels[0]]).toEqual([1])
    expect([...tail.channels[1]]).toEqual([-1])

    expect(requests).toHaveLength(3)
    for (const request of requests) {
      expect(request.url).toMatch(/^podcut:\/\/cache\//)
      const rangeHeader = request.headers.get('Range')
      expect(rangeHeader).toMatch(/^bytes=\d+-\d+$/)
      const [, start, end] = rangeHeader!.match(/^bytes=(\d+)-(\d+)$/)!
      expect(Number(end) - Number(start) + 1).toBeLessThanOrEqual(32 * 1024 * 1024)
    }
  })
})
