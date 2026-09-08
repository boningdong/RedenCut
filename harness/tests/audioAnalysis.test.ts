import { expect, test } from 'vitest'
import { rmsWindows } from '../../e2e/audioAnalysis'

test('silence and an isolated click cannot look like sustained playback', () => {
  expect(rmsWindows(new Float32Array(20), 10)).toEqual([0, 0])
  const click = new Float32Array(30)
  click[0] = 1
  expect(rmsWindows(click, 10).filter((rms) => rms > 0.01)).toHaveLength(1)
  expect(rmsWindows(new Float32Array(20).fill(0.5), 10)).toEqual([0.5, 0.5])
})
