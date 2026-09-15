import { describe, expect, it } from 'vitest'
import type { Track } from '../../shared/project.types'
import { planSpeechSources } from './SpeechBatchPlanner'
const tracks = [
  { id: 'empty', clips: [] },
  { id: 'one', clips: [{ audioSourceId: 'A' }, { audioSourceId: 'B' }] },
  { id: 'two', clips: [{ audioSourceId: 'A' }, { audioSourceId: 'C' }] },
] as unknown as Track[]
describe('speech source planning', () => {
  it('includes every source after an empty first track, once across clips and tracks', () => {
    expect(planSpeechSources({ kind: 'all' }, tracks)).toEqual(['A', 'B', 'C'])
  })
  it('includes every distinct source on a selected track', () => {
    expect(planSpeechSources({ kind: 'track', trackId: 'one' }, tracks)).toEqual(['A', 'B'])
  })
  it('rejects an unknown track rather than falling back to the first', () => {
    expect(() => planSpeechSources({ kind: 'track', trackId: 'missing' }, tracks)).toThrow()
  })
  it('captures a list independent of later clip imports', () => {
    const copy = structuredClone(tracks)
    const plan = planSpeechSources({ kind: 'all' }, copy)
    copy[0].clips.push({ audioSourceId: 'D' } as never)
    expect(plan).toEqual(['A', 'B', 'C'])
  })
})
