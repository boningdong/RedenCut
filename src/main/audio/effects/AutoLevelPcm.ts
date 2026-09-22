import type { NormalizeParams } from '../../../shared/TrackEffects'

const SAMPLE_RATE = 48000
const WINDOW_FRAMES = SAMPLE_RATE / 10
const MAX_GAIN_DB = 12
const ABSOLUTE_GATE_DB = -55
const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-12))
const amplitude = (value: number) => 10 ** (value / 20)

/**
 * Streaming analysis of a complete logical track, after clip envelopes and before
 * manual track gain. Only 100 ms window statistics are retained, never the PCM.
 * All routed sources share one reference; independently prepared tracks do not.
 */
export class AutoLevelAnalyzer {
  private readonly levels: Float64Array
  private readonly peaks: Float64Array
  private readonly sums: Float64Array
  private frames = 0
  private windowFrames = 0
  private peak = 0
  private finished = false

  constructor(
    private readonly channels: number,
    private readonly frameCount: number,
  ) {
    validateDimensions(channels, frameCount)
    this.levels = new Float64Array(Math.ceil(frameCount / WINDOW_FRAMES))
    this.peaks = new Float64Array(this.levels.length)
    this.sums = new Float64Array(channels)
  }

  append(pcm: Buffer): void {
    if (this.finished) throw new Error('Auto-level analysis already finished')
    if (pcm.length % (this.channels * 4)) throw new Error('Unaligned auto-level PCM')
    const count = pcm.length / this.channels / 4
    if (this.frames + count > this.frameCount) throw new Error('Auto-level PCM duration mismatch')
    for (let frame = 0; frame < count; frame++) {
      for (let channel = 0; channel < this.channels; channel++) {
        const sample = pcm.readFloatLE((frame * this.channels + channel) * 4)
        if (!Number.isFinite(sample)) throw new Error('Invalid auto-level PCM sample')
        this.sums[channel] += sample * sample
        this.peak = Math.max(this.peak, Math.abs(sample))
      }
      this.frames++
      this.windowFrames++
      if (this.windowFrames === WINDOW_FRAMES) this.flushWindow()
    }
  }

  finish(params: NormalizeParams): AutoLevelEnvelope {
    if (this.finished) throw new Error('Auto-level analysis already finished')
    if (this.frames !== this.frameCount) throw new Error('Auto-level PCM duration mismatch')
    if (
      !Number.isFinite(params.truePeakDbtp) ||
      params.truePeakDbtp < -9 ||
      params.truePeakDbtp > 0
    )
      throw new Error('Invalid auto-level peak ceiling')
    this.finished = true
    if (this.windowFrames) this.flushWindow()
    const sorted = Array.from(this.levels)
      .filter((level) => level > ABSOLUTE_GATE_DB)
      .sort((a, b) => a - b)
    const gate = sorted.length
      ? Math.max(ABSOLUTE_GATE_DB, quantile(sorted, 0.95) - 40)
      : ABSOLUTE_GATE_DB
    const active = sorted.filter((level) => level > gate)
    const reference = active.length ? quantile(active, 0.5) : null
    const raw = Array.from(this.levels, (level) =>
      reference === null || level <= gate
        ? 0
        : Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, 0.85 * (reference - level))),
    )
    const gains = new Float64Array(this.levels.length)
    const ceiling = amplitude(params.truePeakDbtp)
    for (let index = 0; index < gains.length; index++) {
      // Half-second triangular smoothing preserves fast syllabic dynamics.
      let sum = 0
      let weight = 0
      for (let delta = -2; delta <= 2; delta++) {
        const other = Math.max(0, Math.min(gains.length - 1, index + delta))
        const w = 3 - Math.abs(delta)
        sum += raw[other] * w
        weight += w
      }
      const gainDb = this.levels[index] <= gate ? Math.min(0, sum / weight) : sum / weight
      // Both interpolation endpoints must be safe for this and adjacent windows.
      const peak = Math.max(
        this.peaks[Math.max(0, index - 1)],
        this.peaks[index],
        this.peaks[Math.min(gains.length - 1, index + 1)],
      )
      // Hold both neighbors of gated windows at unity or lower so the silence
      // gate never creates a discontinuous gain step at a window boundary.
      const touchesGate = [-1, 0, 1].some(
        (delta) => this.levels[Math.max(0, Math.min(gains.length - 1, index + delta))] <= gate,
      )
      gains[index] = Math.min(
        amplitude(gainDb),
        peak > 0 ? ceiling / peak : 1,
        touchesGate ? 1 : Infinity,
      )
    }
    return new AutoLevelEnvelope(
      this.channels,
      this.frameCount,
      gains,
      this.levels,
      reference,
      gate,
    )
  }

  private flushWindow(): void {
    const index = Math.floor((this.frames - 1) / WINDOW_FRAMES)
    this.levels[index] = db(Math.sqrt(Math.max(...this.sums) / this.windowFrames))
    this.peaks[index] = this.peak
    this.sums.fill(0)
    this.peak = 0
    this.windowFrames = 0
  }
}

/**
 * Apply the analyzed envelope in a second streaming pass. Legacy targetLufs/LRA
 * parameters do not impose a loudness target. The gate is a level heuristic, not
 * speech recognition: louder background can be classified as program material.
 * Peak safety bounds PCM samples, not certified intersample true peaks.
 */
export class AutoLevelEnvelope {
  constructor(
    private readonly channels: number,
    private readonly frameCount: number,
    private readonly gains: Float64Array,
    private readonly levels: Float64Array,
    readonly referenceDb: number | null,
    readonly gateDb: number,
  ) {}

  apply(pcm: Buffer, startFrame: number): void {
    if (pcm.length % (this.channels * 4)) throw new Error('Unaligned auto-level PCM')
    const frames = pcm.length / this.channels / 4
    if (
      !Number.isSafeInteger(startFrame) ||
      startFrame < 0 ||
      startFrame + frames > this.frameCount
    )
      throw new Error('Invalid auto-level PCM range')
    for (let frame = 0; frame < frames; frame++) {
      const absolute = startFrame + frame
      const window = Math.floor(absolute / WINDOW_FRAMES)
      const position = (absolute % WINDOW_FRAMES) / WINDOW_FRAMES - 0.5
      const other = Math.max(0, Math.min(this.gains.length - 1, window + (position < 0 ? -1 : 1)))
      let gain = this.gains[window] + Math.abs(position) * (this.gains[other] - this.gains[window])
      if (this.levels[window] <= this.gateDb) gain = Math.min(1, gain)
      for (let channel = 0; channel < this.channels; channel++) {
        const offset = (frame * this.channels + channel) * 4
        const sample = pcm.readFloatLE(offset)
        if (!Number.isFinite(sample)) throw new Error('Invalid auto-level PCM sample')
        pcm.writeFloatLE(sample * gain, offset)
      }
    }
  }
}

function validateDimensions(channels: number, frameCount: number): void {
  if (
    !Number.isSafeInteger(channels) ||
    channels < 1 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 0
  )
    throw new Error('Invalid auto-level PCM dimensions')
}

function quantile(sorted: number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}
