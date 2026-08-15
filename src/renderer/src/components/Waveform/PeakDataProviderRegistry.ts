import type { PeakData } from '@shared/project.types'
import { PeakDataProvider } from './PeakDataProvider'

export class PeakDataProviderRegistry {
  private readonly providers = new WeakMap<PeakData, PeakDataProvider>()

  forPeakData(peaks: PeakData): PeakDataProvider {
    const existing = this.providers.get(peaks)
    if (existing) return existing

    const provider = new PeakDataProvider(peaks)
    this.providers.set(peaks, provider)
    return provider
  }
}
