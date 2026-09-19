import { expect, it } from 'vitest'
import { placePopover } from './UseAnchoredPopover'

it('places above, flips below and constrains both horizontal edges', () => {
  expect(placePopover({ left: 0, right: 20, top: 300, bottom: 350 }, 200, 100, 500, 500)).toEqual({
    left: 8,
    top: 192,
    maxHeight: 284,
  })
  expect(placePopover({ left: 480, right: 500, top: 20, bottom: 70 }, 200, 100, 500, 500)).toEqual({
    left: 292,
    top: 78,
    maxHeight: 414,
  })
})
it('uses the larger side and limits height when neither side fits', () => {
  expect(
    placePopover({ left: 100, right: 200, top: 120, bottom: 160 }, 180, 300, 300, 300),
  ).toEqual({ left: 60, top: 168, maxHeight: 124 })
})
