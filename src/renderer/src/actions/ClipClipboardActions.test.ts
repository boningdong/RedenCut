import { beforeEach, describe, expect, it } from 'vitest'
import type { AudioSourceId, Clip, Track } from '@shared/project.types'
import { useEditorStore } from '../stores/editor.store'
import { usePlaybackStore } from '../stores/playback.store'
import { useTimelineClipboardStore } from '../stores/TimelineClipboardStore'
import { useTimelineStore } from '../stores/timeline.store'
import { copyClips, cutClips, duplicateClips, pasteClips } from './ClipClipboardActions'

const sourceId = '00000000-0000-4000-8000-000000000001' as AudioSourceId

function clip(id: string, trackId: string, outputStart: number, duration = 2): Clip {
  return {
    id,
    trackId,
    audioSourceId: sourceId,
    sourceStart: 1,
    sourceEnd: 1 + duration,
    outputStart,
    gain: 0.75,
    muted: false,
    redactions: [{ id: `redaction-${id}`, sourceStart: 1.25, sourceEnd: 1.5 }],
    effects: [{ id: `effect-${id}`, type: 'gain', enabled: true, params: { db: -3 } }],
  }
}

function track(id: string, clips: Clip[]): Track {
  return {
    id,
    name: id,
    color: '#fff',
    volume: 1,
    muted: false,
    solo: false,
    effects: [],
    clips,
  }
}

function allClips(): Clip[] {
  return useTimelineStore.getState().tracks.flatMap((item) => item.clips)
}

describe('clip clipboard actions', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    usePlaybackStore.getState().reset()
    useTimelineClipboardStore.getState().clear()
    useTimelineStore.getState().reset()
    useTimelineStore.setState({
      tracks: [
        track('track-a', [clip('a', 'track-a', 0)]),
        track('track-b', [clip('b', 'track-b', 3)]),
        track('track-c', []),
      ],
      selectedClipIds: ['a', 'b'],
      selectedClipId: 'a',
      selectedTrackId: null,
    })
  })

  it('copies source metadata and pastes independent IDs at the playhead', () => {
    usePlaybackStore.getState().setCurrentTime(8)

    expect(copyClips()).toBe(true)
    expect(pasteClips()).toBe(true)
    const firstPaste = allClips().filter((item) => !['a', 'b'].includes(item.id))

    expect(firstPaste).toHaveLength(2)
    expect(firstPaste.map((item) => item.outputStart)).toEqual([8, 11])
    expect(firstPaste.map((item) => item.audioSourceId)).toEqual([sourceId, sourceId])
    expect(firstPaste[0]).toMatchObject({
      sourceStart: 1,
      sourceEnd: 3,
      gain: 0.75,
      effects: [{ type: 'gain', enabled: true, params: { db: -3 } }],
    })
    expect(firstPaste[0].redactions?.[0].id).not.toBe('redaction-a')
    expect(useTimelineStore.getState().selectedClipIds).toEqual(firstPaste.map((item) => item.id))

    usePlaybackStore.getState().setCurrentTime(14)
    expect(pasteClips()).toBe(true)
    const pastedIds = allClips()
      .filter((item) => !['a', 'b'].includes(item.id))
      .map((item) => item.id)
    expect(new Set(pastedIds).size).toBe(4)
    expect(useTimelineStore.getState().undoStack).toHaveLength(2)
  })

  it('keeps normal paste anchored to the exact playhead near a clip edge', () => {
    usePlaybackStore.getState().setCurrentTime(2.05)

    expect(copyClips()).toBe(true)
    expect(pasteClips()).toBe(true)

    const pasted = allClips().filter((item) => !['a', 'b'].includes(item.id))
    expect(pasted.map((item) => item.outputStart)).toEqual([2.05, 5.05])
  })

  it('preserves source track offsets relative to the selected target track', () => {
    useTimelineStore.setState({ selectedTrackId: 'track-b' })
    usePlaybackStore.getState().setCurrentTime(8)

    expect(copyClips()).toBe(true)
    expect(pasteClips()).toBe(true)

    const selected = new Set(useTimelineStore.getState().selectedClipIds)
    expect(useTimelineStore.getState().tracks[1].clips.some((item) => selected.has(item.id))).toBe(
      true,
    )
    expect(useTimelineStore.getState().tracks[2].clips.some((item) => selected.has(item.id))).toBe(
      true,
    )
  })

  it('uses insertion mode for paste while retaining a paste history label', () => {
    useTimelineStore.setState({ insertMode: true })
    usePlaybackStore.getState().setCurrentTime(8)

    expect(copyClips()).toBe(true)
    expect(pasteClips()).toBe(true)

    const undoStack = useTimelineStore.getState().undoStack
    expect(undoStack[undoStack.length - 1]?.label).toBe('Paste clips')
  })

  it('cuts a batch in one undo step and leaves its clipboard available', () => {
    useEditorStore.getState().setSelection({ origin: 'clip', trackId: 'one', start: 0, end: 5 })

    expect(cutClips()).toBe(true)

    expect(allClips()).toHaveLength(0)
    expect(useEditorStore.getState().selection).toBeNull()
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
    expect(useTimelineClipboardStore.getState().contents?.clips).toHaveLength(2)

    void useTimelineStore.getState().undo()
    usePlaybackStore.getState().setCurrentTime(8)
    expect(pasteClips()).toBe(true)
    expect(allClips()).toHaveLength(4)
  })

  it('duplicates the group after its overall end without replacing the clipboard', () => {
    useTimelineStore.setState({ selectedClipIds: ['a'], selectedClipId: 'a' })
    expect(copyClips()).toBe(true)
    const priorClipboard = useTimelineClipboardStore.getState().contents
    useTimelineStore.setState({ selectedClipIds: ['a', 'b'], selectedClipId: 'a' })

    expect(duplicateClips()).toBe(true)

    const duplicates = allClips().filter((item) => !['a', 'b'].includes(item.id))
    expect(duplicates.map((item) => item.outputStart)).toEqual([5, 8])
    expect(useTimelineClipboardStore.getState().contents).toBe(priorClipboard)
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  })

  it('duplicates after the overall end when the primary starts later than the group', () => {
    useTimelineStore.setState((state) => ({
      tracks: state.tracks.map((item) =>
        item.id === 'track-b'
          ? { ...item, clips: item.clips.map((item) => ({ ...item, outputStart: 8 })) }
          : item,
      ),
      selectedClipIds: ['a', 'b'],
      selectedClipId: 'b',
    }))

    expect(duplicateClips()).toBe(true)

    const duplicates = allClips().filter((item) => !['a', 'b'].includes(item.id))
    expect(duplicates.map((item) => item.outputStart)).toEqual([10, 18])
  })

  it('does not paste when relative tracks would fall outside the project', () => {
    expect(copyClips()).toBe(true)
    useTimelineStore.setState({ selectedTrackId: 'track-c' })
    const before = useTimelineStore.getState().tracks

    expect(pasteClips()).toBe(false)
    expect(useTimelineStore.getState().tracks).toBe(before)
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  })
})
