import { describe, expect, it } from 'vitest'
import type { PeakData } from '@shared/project.types'
import { PeakDataProviderRegistry } from './PeakDataProviderRegistry'

function peakData(): PeakData {
  return { data: [[0.5]], length: 1, durationSeconds: 1 }
}

describe('PeakDataProviderRegistry', () => {
  it('returns exactly one shared provider identity for ten clips using the same peak data object', () => {
    const sharedPeaks = peakData()
    const registry = new PeakDataProviderRegistry()

    const clipProviders = Array.from({ length: 10 }, () => registry.forPeakData(sharedPeaks))

    expect(new Set(clipProviders).size).toBe(1)
    for (const provider of clipProviders) expect(provider).toBe(clipProviders[0])
  })

  it('keeps providers separate for distinct peak data objects', () => {
    const registry = new PeakDataProviderRegistry()

    const firstProvider = registry.forPeakData(peakData())
    const secondProvider = registry.forPeakData(peakData())

    expect(secondProvider).not.toBe(firstProvider)
  })
})
