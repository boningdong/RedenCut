import { describe, expect, it, vi } from 'vitest'
import { PcmWaveformAccumulator } from './PcmWaveformAccumulator'

function pcm(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return bytes
}

function bucket(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getFloat32(0, true), view.getFloat32(4, true)]
}

describe('PcmWaveformAccumulator', () => {
  it('preserves split stereo frames and emits literal min/max values', () => {
    const emitted: Uint8Array[] = []
    const accumulator = new PcmWaveformAccumulator(2, [256], (_level, value) => emitted.push(value))
    const bytes = pcm([-0.25, 0.5, -0.75, 0.2])

    accumulator.push(bytes.subarray(0, 5))
    accumulator.push(bytes.subarray(5))
    accumulator.finish()

    expect(accumulator.frameCount).toBe(2)
    expect(bucket(emitted[0])).toEqual([-0.75, 0.5])
  })

  it('emits one higher-level bucket after sixteen lower-level spans', () => {
    const emit = vi.fn()
    const accumulator = new PcmWaveformAccumulator(1, [256, 4096], emit)
    const values = Array.from({ length: 4096 }, (_, index) => (index === 3000 ? -0.9 : 0.4))

    accumulator.push(pcm(values))
    accumulator.finish()

    expect(emit.mock.calls.filter(([level]) => level === 256)).toHaveLength(16)
    const high = emit.mock.calls.find(([level]) => level === 4096)?.[1] as Uint8Array
    expect(bucket(high)[0]).toBeCloseTo(-0.9)
    expect(bucket(high)[1]).toBeCloseTo(0.4)
  })
})
