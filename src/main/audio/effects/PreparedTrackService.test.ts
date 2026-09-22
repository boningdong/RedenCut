import { describe, expect, it } from 'vitest'
import { preparedTrackKey, validatePreparedRead } from './PreparedTrackService'
import { buildAudioRenderPlan } from '../../../shared/audio/AudioRenderPlanBuilder'

describe('prepared track identity and bounded reads', () => {
  it('rejects unbounded, negative, fractional, and non-finite requests', () => {
    for (const [start, count] of [
      [-1, 1],
      [0, 16385],
      [0.1, 1],
      [0, Infinity],
      [0, -1],
    ])
      expect(() => validatePreparedRead(start, count, 48000)).toThrow()
    expect(() => validatePreparedRead(47999, 2, 48000)).toThrow()
    expect(() => validatePreparedRead(100, 4096, 48000)).not.toThrow()
  })
  it('keys source identities, algorithm and composition but excludes post-effect levels', () => {
    const plan = {
      ...buildAudioRenderPlan([], 'timeline'),
      tracks: [{ trackId: 'x', volume: 1, contributions: [] }],
    }
    const key = preparedTrackKey(plan, 'timeline', ['hash'])
    expect(
      preparedTrackKey(
        { ...plan, tracks: [{ ...plan.tracks[0], gainDb: 6, volume: 0.2 }] },
        'timeline',
        ['hash'],
      ),
    ).toBe(key)
    expect(preparedTrackKey(plan, 'edited', ['hash'])).not.toBe(key)
    expect(preparedTrackKey(plan, 'timeline', ['changed'])).not.toBe(key)
  })
})
