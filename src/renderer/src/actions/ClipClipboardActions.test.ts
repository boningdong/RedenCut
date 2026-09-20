import { beforeEach, describe, expect, it } from 'vitest'
import type { AudioSourceId, Clip, Track } from '@shared/ProjectTypes'
import { useEditorStore } from '../stores/editor.store'
import { usePlaybackStore } from '../stores/PlaybackStore'
import { useTimelineClipboardStore } from '../stores/TimelineClipboardStore'
import { useTimelineStore } from '../stores/TimelineStore'
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

it('copies crossfade settings independently from the original and clipboard', () => {
  useTimelineStore.getState().reset()
  useEditorStore.getState().reset()
  useTimelineClipboardStore.getState().clear()
  const original = clip('a', 'track-a', 0)
  original.redactions![0].crossfade = { enabled: true, durationMs: 40, curve: 'linear' }
  useTimelineStore.setState({
    tracks: [track('track-a', [original])],
    selectedClipIds: ['a'],
    selectedClipId: 'a',
    selectedTrackId: 'track-a',
  })
  usePlaybackStore.getState().setCurrentTime(4)
  expect(copyClips()).toBe(true)
  const copied = useTimelineClipboardStore.getState().contents!.clips[0].clip
  expect(copied.redactions![0].crossfade).toEqual(original.redactions![0].crossfade)
  expect(copied.redactions![0].crossfade).not.toBe(original.redactions![0].crossfade)
  expect(pasteClips()).toBe(true)
  const pasted = allClips().find((item) => item.id !== 'a')!
  expect(pasted.redactions![0].crossfade).toEqual(copied.redactions![0].crossfade)
  expect(pasted.redactions![0].crossfade).not.toBe(copied.redactions![0].crossfade)
})

it('cuts and pastes a Mix with captured child fragments and independent metadata', async () => {
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
  const master = track('mix', [clip('master', 'mix', 0, 4)])
  const child = track('stem', [clip('child', 'stem', 0, 8)])
  useTimelineStore.setState({ tracks: [master, child] })
  const state = () => useTimelineStore.getState()
  state().setMixLink('mix', ['stem'])
  state().replaceMixSources('mix', 1, 3, ['stem'])
  state().setSelectedClipId('master')
  expect(cutClips()).toBe(true)
  usePlaybackStore.getState().setCurrentTime(10)
  state().setSelectedTrackId('mix')
  expect(pasteClips()).toBe(true)
  expect(state().tracks[0].clips[0].outputStart).toBe(10)
  expect(state().tracks[1].clips.map((c) => [c.outputStart, c.sourceStart, c.sourceEnd])).toEqual([
    [4, 5, 9],
    [10, 1, 5],
  ])
  expect(state().tracks[1].clips[1].redactions?.[0].id).not.toBe('redaction-child')
  await state().undo()
  expect(state().tracks[0].clips).toHaveLength(0)
})
it('duplicates linked material with replacement metadata in the same group', () => {
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
  useTimelineStore.setState({
    tracks: [
      track('mix', [clip('master', 'mix', 0, 4)]),
      track('stem', [clip('child', 'stem', 0, 4)]),
    ],
  })
  const state = () => useTimelineStore.getState()
  state().setMixLink('mix', ['stem'])
  state().replaceMixSources('mix', 1, 3, ['stem'])
  state().setSelectedClipId('master')
  expect(duplicateClips()).toBe(true)
  expect(state().tracks.map((t) => t.clips.map((c) => c.outputStart))).toEqual([
    [0, 4],
    [0, 4],
  ])
  expect(state().tracks[0].clips[1].sourceOverrides?.[0].id).not.toBe(
    state().tracks[0].clips[0].sourceOverrides?.[0].id,
  )
})
it('copies hidden linked topology so pasted Mix can reveal the original sources', () => {
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
  const a = clip('a', 'stem', 0, 5),
    b = clip('b', 'stem', 5, 5)
  b.audioSourceId = '00000000-0000-4000-8000-000000000002' as Clip['audioSourceId']
  useTimelineStore.setState({
    tracks: [track('mix', [clip('master', 'mix', 0, 10)]), track('stem', [a, b])],
  })
  const state = () => useTimelineStore.getState()
  state().setMixLink('mix', ['stem'])
  const before = state().tracks
  state().commitTracks(
    before,
    before.map((t) => (t.id === 'mix' ? { ...t, clips: [{ ...t.clips[0], sourceEnd: 5 }] } : t)),
    'trim',
  )
  state().setSelectedClipId('master')
  expect(cutClips()).toBe(true)
  usePlaybackStore.getState().setCurrentTime(20)
  state().setSelectedTrackId('mix')
  expect(pasteClips()).toBe(true)
  const pasted = state().tracks
  expect(
    state().commitTracks(
      pasted,
      pasted.map((t) => (t.id === 'mix' ? { ...t, clips: [{ ...t.clips[0], sourceEnd: 11 }] } : t)),
      'reveal',
    ),
  ).toBe(true)
  expect(
    state().tracks[1].clips.some(
      (c) => c.audioSourceId === b.audioSourceId && c.outputStart === 25,
    ),
  ).toBe(true)
})
