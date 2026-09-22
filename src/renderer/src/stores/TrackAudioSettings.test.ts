import { beforeEach, describe, expect, it } from 'vitest'
import { TrackSchema } from '@shared/ProjectTypes'
import { getNormalizeEffect } from '@shared/TrackEffects'
import { useTimelineStore } from './TimelineStore'
const store = () => useTimelineStore.getState()
beforeEach(() => {
  store().reset()
  useTimelineStore.setState({ tracks: [TrackSchema.parse({ id: 't', name: 'Voice' })] })
})
describe('undoable track audio settings', () => {
  it('records one completed gain edit and restores it on undo/redo', async () => {
    store().setTrackGain('t', 6)
    expect(store().tracks[0].gainDb).toBe(6)
    expect(store().undoStack).toHaveLength(1)
    store().setTrackGain('t', 6)
    expect(store().undoStack).toHaveLength(1)
    await store().undo()
    expect(store().tracks[0].gainDb ?? 0).toBe(0)
    await store().redo()
    expect(store().tracks[0].gainDb).toBe(6)
  })
  it('toggles Normalize retaining the effect identity and parameters', async () => {
    store().toggleTrackNormalize('t')
    const effect = getNormalizeEffect(store().tracks[0])!
    expect(effect.params.targetLufs).toBe(-16)
    store().toggleTrackNormalize('t')
    expect(getNormalizeEffect(store().tracks[0])).toBeUndefined()
    expect(store().tracks[0].effects[0].id).toBe(effect.id)
    store().toggleTrackNormalize('t')
    expect(store().tracks[0].effects).toEqual([effect])
    await store().undo()
    expect(getNormalizeEffect(store().tracks[0])).toBeUndefined()
  })
  it('records output volume separately and rejects malformed controls', () => {
    store().setTrackVolume('t', 0.5)
    expect(store().tracks[0].volume).toBe(0.5)
    for (const value of [NaN, Infinity, 25, -25]) store().setTrackGain('t', value)
    for (const value of [NaN, Infinity, 2, -1]) store().setTrackVolume('t', value)
    expect(store().undoStack).toHaveLength(1)
    expect(store().tracks[0].gainDb).toBeUndefined()
  })
  it('does not mutate linked children', () => {
    useTimelineStore.setState({
      tracks: [
        TrackSchema.parse({ id: 'master', name: 'Mix', mixLink: { stemTrackIds: ['t'] } }),
        ...store().tracks,
      ],
    })
    store().setTrackGain('t', 6)
    store().setTrackVolume('t', 0.5)
    store().toggleTrackNormalize('t')
    expect(store().tracks[1].volume).toBe(1)
    expect(store().tracks[1].effects).toEqual([])
    expect(store().undoStack).toHaveLength(0)
  })
})

it.each([{ muted: true }, { solo: true }, { name: 'Renamed' }])(
  'records track patch %j separately and invalidates redo',
  async (patch) => {
    store().setTrackGain('t', 6)
    store().updateTrack('t', patch)
    expect(store().undoStack).toHaveLength(2)
    await store().undo()
    expect(store().tracks[0]).toMatchObject({ name: 'Voice', muted: false, solo: false, gainDb: 6 })
    await store().redo()
    expect(store().tracks[0]).toMatchObject(patch)
    await store().undo()
    store().updateTrack('t', { name: 'New branch' })
    expect(store().redoStack).toHaveLength(0)
    await store().redo()
    expect(store().tracks[0].name).toBe('New branch')
  },
)
