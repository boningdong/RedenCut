import { describe, expect, it } from 'vitest'
import type { PeakData } from '@shared/project.types'
import { PeakDataProvider } from './PeakDataProvider'

function peakData(values: number[], durationSeconds = values.length): PeakData {
  return { data: [values], length: values.length, durationSeconds }
}

function request(start: number, end: number, width: number, signal = new AbortController().signal) {
  return { sourceStartSeconds: start, sourceEndSeconds: end, targetPixelWidth: width, signal }
}

describe('PeakDataProvider', () => {
  it('aggregates source peaks into symmetric min/max pixel buckets', async () => {
    const provider = new PeakDataProvider(peakData([0.125, 0.5, 0.25, 0.75]))

    await expect(provider.readRange(request(0, 4, 2))).resolves.toEqual({
      buckets: [
        { min: -0.5, max: 0.5 },
        { min: -0.75, max: 0.75 },
      ],
    })
  })

  it('maps a partial time range to only the contributing peaks', async () => {
    const provider = new PeakDataProvider(peakData([0.125, 0.5, 0.25, 0.75]))

    await expect(provider.readRange(request(1, 3, 2))).resolves.toEqual({
      buckets: [
        { min: -0.5, max: 0.5 },
        { min: -0.25, max: 0.25 },
      ],
    })
  })

  it('returns an empty range when the peak data has no valid duration', async () => {
    const provider = new PeakDataProvider(peakData([0.5], 0))

    await expect(provider.readRange(request(0, 1, 1))).resolves.toEqual({ buckets: [] })
  })

  it('returns an empty range when the requested interval is empty', async () => {
    const provider = new PeakDataProvider(peakData([0.5]))

    await expect(provider.readRange(request(1, 1, 1))).resolves.toEqual({ buckets: [] })
  })

  it('returns an empty range when the target pixel width is invalid', async () => {
    const provider = new PeakDataProvider(peakData([0.5]))

    await expect(provider.readRange(request(0, 1, 0))).resolves.toEqual({ buckets: [] })
  })

  it('rejects an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new PeakDataProvider(peakData([0.5]))

    await expect(provider.readRange(request(0, 1, 1, controller.signal))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('keeps a coarse trimmed range within its exact source boundaries without rereading source peaks', async () => {
    const values = Array.from({ length: 4_096 }, () => 0.1)
    values[0] = 0.99
    values[1_000] = 0.5
    values[3_000] = 0.75
    values[4_095] = 0.98

    let trackReads = false
    let sourcePeakReads = 0
    const trackedValues = new Proxy(values, {
      get(target, property, receiver) {
        if (trackReads && /^\d+$/.test(String(property))) {
          sourcePeakReads++
          if (sourcePeakReads > 32) throw new Error('source peak read limit exceeded')
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const provider = new PeakDataProvider({
      data: [trackedValues],
      length: trackedValues.length,
      durationSeconds: 4_096,
    })
    trackReads = true

    await expect(provider.readRange(request(17, 4_079, 2))).resolves.toEqual({
      buckets: [
        { min: -0.5, max: 0.5 },
        { min: -0.75, max: 0.75 },
      ],
    })
  })

  it('returns no more buckets than target device pixels for one hour', async () => {
    const values = Array.from({ length: 684_000 }, (_, index) => (index % 100) / 100)
    const provider = new PeakDataProvider(peakData(values, 3_600))

    const result = await provider.readRange(request(-10, 4_000, 1_920))

    expect(result.buckets.length).toBeLessThanOrEqual(1_920)
  })
})
