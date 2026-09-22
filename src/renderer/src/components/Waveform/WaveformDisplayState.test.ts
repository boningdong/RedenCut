import { beforeEach, expect, it } from 'vitest'
import { useWaveformDisplayStore, fittedWaveformScale } from './WaveformDisplayState'

beforeEach(() => useWaveformDisplayStore.getState().resetWorkspace('test'))
it('fits at 85 percent without expanding silence or corrupt samples', () => {
  expect(fittedWaveformScale(0.25)).toBe(3.4)
  expect(fittedWaveformScale(0)).toBe(1)
  expect(fittedWaveformScale(NaN)).toBe(1)
  expect(fittedWaveformScale(0.00000001)).toBe(1)
})
it('locks initial track scale until explicit fit/reset and isolates projects', () => {
  const s = useWaveformDisplayStore.getState()
  s.initialize('a', 0.25)
  s.initialize('a', 0.8)
  expect(useWaveformDisplayStore.getState().scales.a).toBe(3.4)
  s.setScale('a', 1)
  s.initialize('a', 0.1)
  expect(useWaveformDisplayStore.getState().scales.a).toBe(1)
  s.previewGain('a', -12)
  s.resetWorkspace('new')
  expect(useWaveformDisplayStore.getState().scales).toEqual({})
  expect(useWaveformDisplayStore.getState().gainPreviews).toEqual({})
})
