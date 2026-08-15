import type { WaveformDataProvider } from './WaveformDataProvider'

export class WaveformRequestController {
  private active: AbortController | null = null
  private revision = 0

  async request(
    provider: WaveformDataProvider,
    sourceStartSeconds: number,
    sourceEndSeconds: number,
    targetPixelWidth: number,
    commit: (range: Awaited<ReturnType<WaveformDataProvider['readRange']>>) => void,
    reportError: (error: unknown) => void = () => undefined,
  ): Promise<void> {
    this.cancel()
    const active = new AbortController()
    const revision = ++this.revision
    this.active = active

    try {
      const range = await provider.readRange({
        sourceStartSeconds,
        sourceEndSeconds,
        targetPixelWidth,
        signal: active.signal,
      })
      if (!active.signal.aborted && revision === this.revision) commit(range)
    } catch (error) {
      if (!active.signal.aborted && revision === this.revision) reportError(error)
    }
  }

  cancel(): void {
    this.active?.abort()
    this.active = null
    this.revision++
  }
}
