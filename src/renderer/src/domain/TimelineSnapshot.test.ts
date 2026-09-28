import { expect, test, vi } from 'vitest'
import { protectTimelineSnapshot, timelineValuesEqual } from './TimelineSnapshot'

test('optional unset metadata is equal but array order and nested settings remain significant', () => {
  expect(timelineValuesEqual({ gainDb: undefined, name: 'Track' }, { name: 'Track' })).toBe(true)
  expect(timelineValuesEqual({ gainDb: 0 }, {})).toBe(false)
  expect(timelineValuesEqual(['one', 'two'], ['two', 'one'])).toBe(false)
  expect(timelineValuesEqual([{ params: { gain: 1 } }], [{ params: { gain: 2 } }])).toBe(false)
  expect(timelineValuesEqual({ crossfade: null }, {})).toBe(false)
})

test('production snapshot protection preserves identity without freezing input', () => {
  vi.stubEnv('DEV', false)
  try {
    const tracks: Parameters<typeof protectTimelineSnapshot>[0] = []
    expect(protectTimelineSnapshot(tracks)).toBe(tracks)
    expect(Object.isFrozen(tracks)).toBe(false)
  } finally {
    vi.unstubAllEnvs()
  }
})
