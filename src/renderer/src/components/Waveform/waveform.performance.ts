import { expect, test } from 'vitest'
import type { PeakData } from '@shared/project.types'
import { PeakDataProvider } from './PeakDataProvider'
import type { WaveformDrawingContext } from './drawWaveform'
import { drawWaveform } from './drawWaveform'

const ONE_HOUR_SECONDS = 3_600
const PEAK_COUNT = 684_000
const VIEWPORT_DEVICE_PIXELS = 1_920
const VIEWPORT_SECONDS = 120
const SAMPLE_COUNT = 100
const INTERACTION_P95_LIMIT_MS = 8

function oneHourPeakData(): PeakData {
  return {
    data: [Array.from({ length: PEAK_COUNT }, (_, index) => ((index * 17) % 1_000) / 1_000)],
    length: PEAK_COUNT,
    durationSeconds: ONE_HOUR_SECONDS,
  }
}

function recordingContext() {
  let waveformPrimitiveCount = 0
  const context: WaveformDrawingContext = {
    fillStyle: '',
    clearRect: () => undefined,
    fillRect: () => {
      waveformPrimitiveCount++
    },
  }
  return {
    context,
    resetPrimitiveCount: () => {
      waveformPrimitiveCount = 0
    },
    waveformPrimitiveCount: () => waveformPrimitiveCount,
  }
}

function percentileIndex(sampleCount: number, percentile: number): number {
  return Math.ceil(sampleCount * percentile) - 1
}

test('keeps one-hour 1920-device-pixel waveform reads and draws within the interaction budget', async () => {
  const peaks = oneHourPeakData()
  const initializationStart = performance.now()
  const provider = new PeakDataProvider(peaks)
  const initializationMilliseconds = performance.now() - initializationStart
  const drawing = recordingContext()
  const signal = new AbortController().signal

  const warmRange = await provider.readRange({
    sourceStartSeconds: 0,
    sourceEndSeconds: VIEWPORT_SECONDS,
    targetPixelWidth: VIEWPORT_DEVICE_PIXELS,
    signal,
  })
  drawing.resetPrimitiveCount()
  drawWaveform(drawing.context, warmRange.buckets, VIEWPORT_DEVICE_PIXELS, 120, '#f00')

  const samples: number[] = []
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const sourceStartSeconds = (index * 31) % (ONE_HOUR_SECONDS - VIEWPORT_SECONDS)
    const request = {
      sourceStartSeconds,
      sourceEndSeconds: sourceStartSeconds + VIEWPORT_SECONDS,
      targetPixelWidth: VIEWPORT_DEVICE_PIXELS,
      signal,
    }
    drawing.resetPrimitiveCount()
    const interactionStart = performance.now()
    const range = await provider.readRange(request)
    drawWaveform(drawing.context, range.buckets, VIEWPORT_DEVICE_PIXELS, 120, '#f00')
    samples.push(performance.now() - interactionStart)

    expect(range.buckets.length).toBeLessThanOrEqual(VIEWPORT_DEVICE_PIXELS)
    expect(drawing.waveformPrimitiveCount()).toBeLessThanOrEqual(VIEWPORT_DEVICE_PIXELS)
  }

  const sortedSamples = [...samples].sort((left, right) => left - right)
  const p50Milliseconds = sortedSamples[percentileIndex(sortedSamples.length, 0.5)]
  const p95Milliseconds = sortedSamples[percentileIndex(sortedSamples.length, 0.95)]

  console.warn(`waveform provider initialization: ${initializationMilliseconds.toFixed(3)} ms`)
  console.warn(`waveform interaction p50: ${p50Milliseconds.toFixed(3)} ms`)
  console.warn(`waveform interaction p95: ${p95Milliseconds.toFixed(3)} ms`)

  expect(p95Milliseconds).toBeLessThanOrEqual(INTERACTION_P95_LIMIT_MS)
})
