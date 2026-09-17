import { beforeEach, describe, expect, it } from 'vitest'
import type { Clip, Track } from '@shared/project.types'
import { useTimelineStore } from './timeline.store'

const clip = (id: string, trackId = 'track', outputStart = 0): Clip => ({
  id,
  trackId,
  audioSourceId: '00000000-0000-4000-8000-000000000001' as Clip['audioSourceId'],
  sourceStart: 0,
  sourceEnd: 2,
  outputStart,
  gain: 1,
  muted: false,
  effects: [],
})

const makeTracks = (): Track[] => [
  {
    id: 'track',
    name: 'Track',
    clips: [clip('one'), clip('two', 'track', 3)],
    volume: 1,
    muted: false,
    solo: false,
    color: '#fff',
    effects: [],
  },
]

const state = () => useTimelineStore.getState()

beforeEach(() => {
  state().reset()
  useTimelineStore.setState({ tracks: makeTracks() })
})

describe('timeline editing state', () => {
  it('normalizes unique valid selection IDs and a valid primary clip', () => {
    state().setSelectedClipIds(['two', 'missing', 'one', 'two'], 'one')
    expect(state().selectedClipIds).toEqual(['two', 'one'])
    expect(state().selectedClipId).toBe('one')
    expect(state().timelineSelection).toEqual({ kind: 'clip', clipId: 'one' })

    state().setSelectedClipId('two')
    expect(state().selectedClipIds).toEqual(['two'])
    expect(state().selectedClipId).toBe('two')
  })

  it('guardedly commits one history entry and rejects stale or no-op snapshots', () => {
    const expected = state().tracks
    const next = [
      { ...expected[0], clips: expected[0].clips.map((item) => ({ ...item, muted: true })) },
    ]
    expect(state().commitTracks(expected, next, 'Mute selection', ['one', 'two'])).toBe(true)
    expect(state().undoStack).toHaveLength(1)
    expect(state().selectedClipIds).toEqual(['one', 'two'])
    expect(state().commitTracks(expected, makeTracks(), 'stale')).toBe(false)
    expect(state().commitTracks(state().tracks, state().tracks, 'same')).toBe(false)
    expect(state().undoStack).toHaveLength(1)
  })

  it('syncs the selected track to the primary clip after a guarded cross-track commit', () => {
    const expected = [
      ...state().tracks,
      {
        ...state().tracks[0],
        id: 'other',
        name: 'Other',
        clips: [] as Clip[],
      },
    ]
    useTimelineStore.setState({ tracks: expected, selectedTrackId: 'track' })
    const moving = expected[0].clips[0]
    const next = [
      { ...expected[0], clips: expected[0].clips.slice(1) },
      { ...expected[1], clips: [{ ...moving, trackId: 'other', outputStart: 8 }] },
    ]
    expect(state().commitTracks(expected, next, 'Move clip', ['one'])).toBe(true)
    expect(state().selectedTrackId).toBe('other')
  })

  it('removes and mutes batches atomically with normalized selection and one undo each', () => {
    state().setSelectedClipIds(['one', 'two'], 'two')
    state().setClipsMuted(['one', 'two'], true)
    expect(state().tracks[0].clips.every((item) => item.muted)).toBe(true)
    expect(state().undoStack).toHaveLength(1)

    state().removeClips(['one', 'missing'])
    expect(state().tracks[0].clips.map((item) => item.id)).toEqual(['two'])
    expect(state().selectedClipIds).toEqual(['two'])
    expect(state().selectedClipId).toBe('two')
    expect(state().undoStack).toHaveLength(2)
  })

  it('promotes the next selected clip when the primary clip is removed', () => {
    state().setSelectedClipIds(['one', 'two'], 'one')
    state().removeClips(['one'])
    expect(state().selectedClipIds).toEqual(['two'])
    expect(state().selectedClipId).toBe('two')
    expect(state().timelineSelection).toEqual({ kind: 'clip', clipId: 'two' })
  })

  it('clears multi-selection on undo, redo, load, and reset', () => {
    state().setSelectedClipIds(['one', 'two'])
    state().removeClips(['one'])
    void state().undo()
    expect(state().selectedClipIds).toEqual([])
    expect(state().selectedClipId).toBeNull()
    void state().redo()
    expect(state().selectedClipIds).toEqual([])

    state().setSelectedClipIds(['two'])
    state().loadFromProject([], makeTracks())
    expect(state().selectedClipIds).toEqual([])
    state().setSelectedClipIds(['one'])
    state().reset()
    expect(state().selectedClipIds).toEqual([])
  })

  it('resets interaction preferences on project replacement', () => {
    state().setSnappingEnabled(false)
    state().setInsertMode(true)
    state().loadFromProject([], makeTracks())
    expect(state().snappingEnabled).toBe(true)
    expect(state().insertMode).toBe(false)
  })

  it('advances project generation only when project state is replaced', () => {
    const generation = state().projectGeneration
    state().setClipsMuted(['one'], true)
    expect(state().projectGeneration).toBe(generation)
    state().loadFromProject([], makeTracks())
    expect(state().projectGeneration).toBe(generation + 1)
    state().reset()
    expect(state().projectGeneration).toBe(generation + 2)
  })

  it('does not delete a clip when moveClip receives a missing destination', () => {
    state().moveClip('one', 10, 'missing')
    expect(state().tracks).toEqual(makeTracks())
    expect(state().undoStack).toHaveLength(0)
  })
})
