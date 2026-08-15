import { expect, test, vi } from 'vitest'
import type { AudioSourceCacheDescriptor } from '@shared/import.types'
import { BinaryWaveformDataProvider } from './BinaryWaveformDataProvider'
import type { WaveformDrawingContext } from './drawWaveform'
import { drawWaveform } from './drawWaveform'

const SAMPLE_RATE = 48_000
const ONE_HOUR_SECONDS = 3_600
const VIEWPORT_DEVICE_PIXELS = 1_920
const VIEWPORT_SECONDS = 120
const SAMPLE_COUNT = 100
const INTERACTION_P95_LIMIT_MS = 8

const descriptor: AudioSourceCacheDescriptor = {
  audioSourceId:
    '00000000-0000-4000-8000-000000000001' as AudioSourceCacheDescriptor['audioSourceId'],
  sampleRate: SAMPLE_RATE,
  channels: 2,
  frameCount: SAMPLE_RATE * ONE_HOUR_SECONDS,
  waveformLevels: [256, 4096, 65536].map((samplesPerBucket) => ({
    samplesPerBucket: samplesPerBucket as 256 | 4096 | 65536,
    bucketCount: Math.ceil((SAMPLE_RATE * ONE_HOUR_SECONDS) / samplesPerBucket),
  })),
}

function recordingContext() {
  let primitiveCount = 0
  const context: WaveformDrawingContext = {
    fillStyle: '',
    clearRect: () => undefined,
    fillRect: () => {
      primitiveCount++
    },
  }
  return {
    context,
    reset: () => {
      primitiveCount = 0
    },
    count: () => primitiveCount,
  }
}

test('keeps one-hour binary waveform range reads and draws within the interaction budget', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('Range')!
      const [start, end] = range.replace('bytes=', '').split('-').map(Number)
      const bytes = new Uint8Array(end - start + 1)
      const view = new DataView(bytes.buffer)
      for (let offset = 0; offset < bytes.byteLength; offset += 8) {
        view.setFloat32(offset, -0.5, true)
        view.setFloat32(offset + 4, 0.5, true)
      }
      return new Response(bytes, { status: 206 })
    }),
  )
  const provider = new BinaryWaveformDataProvider(descriptor)
  const drawing = recordingContext()
  const samples: number[] = []
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const sourceStartSeconds = (index * 31) % (ONE_HOUR_SECONDS - VIEWPORT_SECONDS)
    drawing.reset()
    const start = performance.now()
    const range = await provider.readRange({
      sourceStartSeconds,
      sourceEndSeconds: sourceStartSeconds + VIEWPORT_SECONDS,
      targetPixelWidth: VIEWPORT_DEVICE_PIXELS,
      signal: new AbortController().signal,
    })
    drawWaveform(drawing.context, range.buckets, VIEWPORT_DEVICE_PIXELS, 120, '#f00')
    samples.push(performance.now() - start)
    expect(range.buckets.length).toBeLessThanOrEqual(VIEWPORT_DEVICE_PIXELS)
    expect(drawing.count()).toBeLessThanOrEqual(VIEWPORT_DEVICE_PIXELS)
  }
  const sorted = [...samples].sort((left, right) => left - right)
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
  console.warn(`binary waveform interaction p95: ${p95.toFixed(3)} ms`)
  expect(p95).toBeLessThanOrEqual(INTERACTION_P95_LIMIT_MS)
  vi.unstubAllGlobals()
})
