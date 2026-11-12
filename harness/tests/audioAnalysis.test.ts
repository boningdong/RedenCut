import { expect, test } from 'vitest'
import { rmsWindows, recordedLevelChangeDb } from '../../e2e/audioAnalysis'

test('silence and an isolated click cannot look like sustained playback', () => {
  expect(rmsWindows(new Float32Array(20), 10)).toEqual([0, 0])
  const click = new Float32Array(30)
  click[0] = 1
  expect(rmsWindows(click, 10).filter((rms) => rms > 0.01)).toHaveLength(1)
  expect(rmsWindows(new Float32Array(20).fill(0.5), 10)).toEqual([0.5, 0.5])
})

test('complete-recording gain is independent of capture silence and RMS window alignment', () => {
  const signal = Float32Array.from(
    { length: 1800 },
    (_, index) => (Math.sin(index / 17) * (index % 113)) / 113,
  )
  const reference = new Float32Array(2600)
  reference.set(signal, 173)
  const candidate = new Float32Array(3100)
  candidate.set(
    signal.map((value) => value * 10 ** (-12 / 20)),
    541,
  )
  expect(recordedLevelChangeDb(rmsWindows(reference, 100), rmsWindows(candidate, 100))).toBeCloseTo(
    -12,
    5,
  )
  expect(() => recordedLevelChangeDb([0], [1])).toThrow('AUDIBLE')
})
