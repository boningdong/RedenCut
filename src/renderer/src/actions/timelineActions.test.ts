import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioSourceId, Clip, Track } from '@shared/project.types'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'
import { deleteSelection, muteSelection, unmuteSelection } from './timelineActions'
import { splitAtPlayhead } from './timelineActions'

const player = vi.hoisted(() => ({ getCurrentTime: () => 1 }))
vi.mock('@shared/player.types', () => ({ getAudioPlayerInstance: () => player }))

const sourceId = '00000000-0000-4000-8000-000000000001' as AudioSourceId

function clip(id: string, muted = false): Clip {
  return {
    id,
    trackId: 'track',
    audioSourceId: sourceId,
    sourceStart: 0,
    sourceEnd: 2,
    outputStart: id === 'a' ? 0 : 3,
    gain: 1,
    muted,
    effects: [],
  }
}

function clips(): Clip[] {
  return useTimelineStore.getState().tracks[0].clips
}

describe('batch timeline actions', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useTimelineStore.getState().reset()
    const track: Track = {
      id: 'track',
      name: 'Track',
      color: '#fff',
      volume: 1,
      muted: false,
      solo: false,
      effects: [],
      clips: [clip('a'), clip('b')],
    }
    useTimelineStore.setState({
      tracks: [track],
      selectedClipIds: ['a', 'b'],
      selectedClipId: 'a',
    })
  })

  it('mutes the complete clip selection in one undo step', () => {
    muteSelection()

    expect(clips().map((item) => item.muted)).toEqual([true, true])
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  })

  it('unmutes the complete clip selection in one undo step', () => {
    useTimelineStore.setState((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((item) => ({ ...item, muted: true })),
      })),
    }))

    unmuteSelection()

    expect(clips().map((item) => item.muted)).toEqual([false, false])
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  })

  it('deletes the complete clip selection in one undo step', () => {
    useEditorStore.getState().setSelection({ start: 0, end: 4 })

    deleteSelection()

    expect(clips()).toEqual([])
    expect(useEditorStore.getState().selection).toBeNull()
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)

    deleteSelection()
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  })

  it('does not split the primary clip while multiple clips are selected', () => {
    splitAtPlayhead()

    expect(clips().map((item) => item.id)).toEqual(['a', 'b'])
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  })
})
