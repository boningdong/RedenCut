import { describe, expect, it } from 'vitest'
import { AutoLevelAnalyzer } from './AutoLevelPcm'
import { NORMALIZE_DEFAULTS } from '../../../shared/TrackEffects'

const rate = 48000
async function process(samples: Float32Array, channels = 1) {
  const pcm = Buffer.from(samples.buffer.slice(0))
  const analyzer = new AutoLevelAnalyzer(channels, samples.length / channels)
  analyzer.append(pcm)
  analyzer.finish(NORMALIZE_DEFAULTS).apply(pcm, 0)
  return Float32Array.from({ length: pcm.length / 4 }, (_, i) => pcm.readFloatLE(i * 4))
}
function tone(seconds: number, amplitude: (t: number) => number) {
  return Float32Array.from(
    { length: seconds * rate },
    (_, i) => amplitude(i / rate) * Math.sin((2 * Math.PI * 180 * i) / rate),
  )
}
function rms(samples: Float32Array, start: number, end: number) {
  let square = 0
  for (let i = start * rate; i < end * rate; i++) square += samples[i] ** 2
  return Math.sqrt(square / ((end - start) * rate))
}
const db = (value: number) => 20 * Math.log10(value)

describe('speech auto leveling PCM', () => {
  it('reduces a 20 dB speaker gap through both local amplification and attenuation', async () => {
    const input = tone(20, (t) => (Math.floor(t / 5) % 2 ? 0.2 : 0.02))
    const output = await process(input)
    const quietGain = db(rms(output, 1, 4) / rms(input, 1, 4))
    const loudGain = db(rms(output, 6, 9) / rms(input, 6, 9))
    expect(quietGain).toBeGreaterThan(4)
    expect(loudGain).toBeLessThan(-4)
    expect(db(rms(output, 6, 9) / rms(output, 1, 4))).toBeLessThan(4)
    expect(quietGain).toBeLessThanOrEqual(12.01)
  })
  it('preserves uniformly quiet speech instead of pushing it toward -16 LUFS', async () => {
    const input = tone(8, () => 0.012)
    const output = await process(input)
    expect(db(rms(output, 1, 7) / rms(input, 1, 7))).toBeCloseTo(0, 2)
  })
  it('does not amplify silence or low background between speakers', async () => {
    const input = tone(20, (t) => (t < 5 ? 0 : t < 10 ? 0.0001 : t < 15 ? 0.02 : 0.2))
    const output = await process(input)
    expect(rms(output, 1, 4)).toBe(0)
    expect(rms(output, 6, 9)).toBeLessThanOrEqual(rms(input, 6, 9) * 1.001)
  })
  it('links stereo channel gains and keeps samples under the configured peak ceiling', async () => {
    const mono = tone(8, (t) => (t < 4 ? 0.05 : 1.5))
    const input = Float32Array.from(
      { length: mono.length * 2 },
      (_, i) => mono[Math.floor(i / 2)] * (i % 2 ? 0.5 : 1),
    )
    const output = await process(input, 2)
    let peak = 0
    let channelError = 0
    for (let i = 0; i < output.length; i += 2) {
      peak = Math.max(peak, Math.abs(output[i]))
      channelError = Math.max(channelError, Math.abs(output[i + 1] - output[i] * 0.5))
    }
    expect(channelError).toBeLessThan(1e-7)
    expect(peak).toBeLessThanOrEqual(10 ** (NORMALIZE_DEFAULTS.truePeakDbtp / 20) + 1e-6)
  })
  it('preserves fast syllabic dynamics instead of flattening the waveform', async () => {
    const input = tone(8, (t) => 0.06 * (1 + 0.35 * Math.sin(2 * Math.PI * 5 * t)))
    const output = await process(input)
    let maxChange = 0
    for (let i = rate; i < 7 * rate; i++)
      maxChange = Math.max(maxChange, Math.abs(output[i] - input[i]))
    expect(maxChange).toBeLessThan(0.002)
  })
  it('is exactly independent of analysis and output chunk boundaries, including partial windows', () => {
    const source = tone(3.125, (t) => (t < 1.5 ? 0.01 : 0.2))
    const whole = Buffer.from(source.buffer.slice(0))
    const chunks = Buffer.from(whole)
    const a = new AutoLevelAnalyzer(1, source.length)
    const b = new AutoLevelAnalyzer(1, source.length)
    a.append(whole)
    for (let offset = 0; offset < chunks.length; offset += 1236)
      b.append(chunks.subarray(offset, offset + 1236))
    const first = a.finish(NORMALIZE_DEFAULTS)
    const second = b.finish(NORMALIZE_DEFAULTS)
    expect(second.referenceDb).toBe(first.referenceDb)
    first.apply(whole, 0)
    for (let offset = 0; offset < chunks.length; offset += 4364)
      second.apply(chunks.subarray(offset, offset + 4364), offset / 4)
    expect(chunks.equals(whole)).toBe(true)
  })
  it('does not use legacy LUFS and loudness-range targets as makeup gain', () => {
    const input = Buffer.from(tone(2, () => 0.02).buffer)
    const a = new AutoLevelAnalyzer(1, input.length / 4)
    const b = new AutoLevelAnalyzer(1, input.length / 4)
    a.append(input)
    b.append(input)
    const first = Buffer.from(input)
    const second = Buffer.from(input)
    a.finish(NORMALIZE_DEFAULTS).apply(first, 0)
    b.finish({ ...NORMALIZE_DEFAULTS, targetLufs: -5, loudnessRange: 1 }).apply(second, 0)
    expect(first.equals(second)).toBe(true)
  })
  it('handles empty PCM and rejects incomplete, unaligned, and nonfinite PCM', () => {
    const empty = new AutoLevelAnalyzer(2, 0).finish(NORMALIZE_DEFAULTS)
    expect(empty.referenceDb).toBeNull()
    empty.apply(Buffer.alloc(0), 0)
    expect(() => new AutoLevelAnalyzer(1, 1).finish(NORMALIZE_DEFAULTS)).toThrow(/duration/)
    expect(() => new AutoLevelAnalyzer(2, 1).append(Buffer.alloc(4))).toThrow(/Unaligned/)
    for (const sample of [NaN, Infinity, -Infinity]) {
      const bytes = Buffer.alloc(4)
      bytes.writeFloatLE(sample)
      expect(() => new AutoLevelAnalyzer(1, 1).append(bytes)).toThrow(/Invalid/)
    }
  })
  it('bounds amplification of a minority quiet speaker without raising the dominant program', async () => {
    const input = tone(20, (t) => (t < 5 ? 0.02 : 0.2))
    const output = await process(input)
    const quietGain = db(rms(output, 1, 4) / rms(input, 1, 4))
    const loudGain = db(rms(output, 6, 19) / rms(input, 6, 19))
    expect(quietGain).toBeCloseTo(12, 1)
    expect(loudGain).toBeCloseTo(0, 1)
    // A bounded leveler intentionally cannot eliminate arbitrarily large gaps.
    expect(db(rms(output, 6, 9) / rms(output, 1, 4))).toBeCloseTo(8, 1)
  })
  it('does not chase extremely faint material and limits extreme dynamic corrections', async () => {
    const input = tone(20, (t) => (t < 5 ? 0.0001 : t < 10 ? 0.005 : 0.8))
    const output = await process(input)
    expect(rms(output, 1, 4)).toBeLessThanOrEqual(rms(input, 1, 4) * 1.001)
    expect(db(rms(output, 6, 9) / rms(input, 6, 9))).toBeLessThanOrEqual(12.001)
    expect(db(rms(output, 11, 19) / rms(input, 11, 19))).toBeLessThanOrEqual(0.001)
  })
})
