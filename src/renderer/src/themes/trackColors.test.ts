import { expect, it } from 'vitest'
import { TRACK_COLORS, trackPresentationColor } from './trackColors'

it('maps legacy defaults without changing custom saved colors', () => {
  expect(trackPresentationColor('#6366F1')).toBe(TRACK_COLORS[0])
  expect(trackPresentationColor('#10b981')).toBe(TRACK_COLORS[1])
  expect(trackPresentationColor('#123456')).toBe('#123456')
  expect(trackPresentationColor(TRACK_COLORS[2])).toBe(TRACK_COLORS[2])
})
