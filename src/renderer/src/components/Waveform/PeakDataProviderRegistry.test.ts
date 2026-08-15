import { describe, expect, it } from 'vitest'
import type { PeakData } from '@shared/project.types'
import { PeakDataProviderRegistry } from './PeakDataProviderRegistry'

function peakData(): PeakData {
  return { data: [[0.5]], length: 1, durationSeconds: 1 }
}

describe('PeakDataProviderRegistry', () => {
  it('returns one shared provider when a clip and track use the same peak data object', () => {
    const sharedPeaks = peakData()
    const registry = new PeakDataProviderRegistry()

    const clipProvider = registry.forPeakData(sharedPeaks)
    const trackProvider = registry.forPeakData(sharedPeaks)

    expect(trackProvider).toBe(clipProvider)
  })

  it('keeps providers separate for distinct peak data objects', () => {
    const registry = new PeakDataProviderRegistry()

    const firstProvider = registry.forPeakData(peakData())
    const secondProvider = registry.forPeakData(peakData())

    expect(secondProvider).not.toBe(firstProvider)
  })
})
