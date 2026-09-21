import { beforeEach, expect, it } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import { useTimelineStore } from './TimelineStore'
import { trimClip } from '../domain/TimelineEdits'
const state = () => useTimelineStore.getState()
const makeTrack = (id: string): Track => ({
  id,
  name: id,
  volume: 1,
  muted: false,
  solo: false,
  color: '#fff',
  effects: [],
  clips: [
    {
      id: `${id}-clip`,
      trackId: id,
      audioSourceId: `source-${id}` as Track['clips'][number]['audioSourceId'],
      sourceStart: 0,
      sourceEnd: 10,
      outputStart: 0,
      gain: 1,
      muted: false,
      effects: [],
      redactions: [{ id: `${id}-redaction`, sourceStart: 2, sourceEnd: 8 }],
    },
  ],
})
beforeEach(() => {
  state().reset()
  useTimelineStore.setState({ tracks: [makeTrack('mix'), makeTrack('stem'), makeTrack('other')] })
})
it('links transactionally, validates coverage and restores affected whole overrides on detach', async () => {
  expect(state().setMixLink('mix', ['stem', 'other'])).toBe(true)
  expect(state().replaceMixSources('mix', 2, 6, ['stem', 'other'])).toBe(true)
  expect(state().tracks[0].clips[0].sourceOverrides).toHaveLength(1)
  expect(state().setMixLink('mix', ['other'])).toBe(true)
  expect(state().tracks[0].clips[0].sourceOverrides).toHaveLength(0)
  expect(state().tracks[1].muted).toBe(true)
  await state().undo()
  expect(state().tracks[0].clips[0].sourceOverrides?.[0].stemTrackIds).toEqual(['stem', 'other'])
})
it('normalizes child pieces before split, move and delete and undoes atomically', async () => {
  state().setMixLink('mix', ['stem'])
  state().setSelectedClipId('mix-clip')
  state().splitAt(4)
  expect(state().tracks[1].clips.map((c) => [c.sourceStart, c.sourceEnd, c.outputStart])).toEqual([
    [0, 4, 0],
    [4, 10, 4],
  ])
  const right = state().tracks[0].clips[1]
  state().moveClip(right.id, 12)
  expect(state().tracks[1].clips.map((c) => c.outputStart)).toEqual([0, 12])
  state().removeClip(right.id)
  expect(state().tracks[1].clips).toHaveLength(1)
  await state().undo()
  expect(state().tracks[1].clips).toHaveLength(2)
})
it('blocks direct child mutation and cross-lane moves', () => {
  state().setMixLink('mix', ['stem'])
  const before = state().tracks
  state().removeClip('stem-clip')
  state().redactRange('stem', 0, 1)
  state().updateTrack('stem', { muted: true })
  state().moveClip('mix-clip', 12, 'other')
  expect(state().tracks).toBe(before)
  expect(trimClip(before, 'stem-clip', 'end', 5, 10)).toBeNull()
})
it('refuses gaps and overlaps in selected sources', () => {
  state().setMixLink('mix', ['stem'])
  useTimelineStore.setState({
    tracks: state().tracks.map((t) =>
      t.id === 'stem' ? { ...t, clips: [{ ...t.clips[0], sourceEnd: 4 }] } : t,
    ),
  })
  expect(state().replaceMixSources('mix', 2, 6, ['stem'])).toBe(false)
  expect(state().replaceMixSources('mix', 2, 3, ['stem'])).toBe(true)
})
it('trims child timing while retaining hidden redactions', () => {
  state().setMixLink('mix', ['stem'])
  const before = state().tracks
  state().commitTracks(before, trimClip(before, 'mix-clip', 'start', 3, 10)!, 'trim')
  expect(state().tracks[1].clips[0]).toMatchObject({
    sourceStart: 3,
    outputStart: 3,
    sourceEnd: 10,
    redactions: [{ sourceStart: 2, sourceEnd: 8 }],
  })
})
it('removes a master without destroying children and restores both with undo', async () => {
  state().setMixLink('mix', ['stem'])
  state().removeTrack('mix')
  expect(state().tracks[0]).toMatchObject({ id: 'stem', muted: true })
  expect(state().tracks[0].clips).toHaveLength(1)
  await state().undo()
  expect(state().tracks[0].mixLink?.stemTrackIds).toEqual(['stem'])
})
it('extends a trimmed child again using its retained source metadata', () => {
  state().setMixLink('mix', ['stem'])
  let before = state().tracks
  state().commitTracks(before, trimClip(before, 'mix-clip', 'start', 3, 10)!, 'trim')
  before = state().tracks
  state().commitTracks(before, trimClip(before, 'mix-clip', 'start', 1, 10)!, 'extend')
  expect(state().tracks[1].clips[0]).toMatchObject({ sourceStart: 1, outputStart: 1 })
})
it('rejects direct snapshot mutation of linked children', () => {
  state().setMixLink('mix', ['stem'])
  const before = state().tracks
  const next = before.map((t) => (t.id === 'stem' ? { ...t, clips: [] } : t))
  expect(state().commitTracks(before, next, 'delete child')).toBe(false)
  expect(state().tracks).toBe(before)
})
it('rejects a replacement over ambiguous overlapping child coverage', () => {
  const tracks = state().tracks
  tracks[1].clips.push({ ...tracks[1].clips[0], id: 'overlap', outputStart: 3 })
  state().setMixLink('mix', ['stem'])
  expect(state().replaceMixSources('mix', 2, 5, ['stem'])).toBe(false)
})
it('partitions linked redactions at explicit split boundaries with independent IDs', () => {
  state().setMixLink('mix', ['stem'])
  state().setSelectedClipId('mix-clip')
  state().splitAt(4)
  const [left, right] = state().tracks[1].clips
  expect(left.redactions?.[0]).toMatchObject({ sourceStart: 2, sourceEnd: 4 })
  expect(right.redactions?.[0]).toMatchObject({ sourceStart: 4, sourceEnd: 8 })
  expect(left.redactions?.[0].id).not.toBe(right.redactions?.[0].id)
})
it('preserves hidden override bounds at the outside of a split', () => {
  state().setMixLink('mix', ['stem'])
  state().replaceMixSources('mix', 0, 8, ['stem'])
  const before = state().tracks
  state().commitTracks(before, trimClip(before, 'mix-clip', 'start', 2, 10)!, 'trim')
  state().setSelectedClipId('mix-clip')
  state().splitAt(5)
  expect(state().tracks[0].clips[0].sourceOverrides?.[0]).toMatchObject({
    sourceStart: 0,
    sourceEnd: 5,
  })
})
it('reveals exact child topology after trim, JSON reload and move', () => {
  const tracks = state().tracks
  tracks[1].clips = [
    { ...tracks[1].clips[0], id: 'a', sourceEnd: 5 },
    {
      ...tracks[1].clips[0],
      id: 'b',
      audioSourceId: tracks[2].clips[0].audioSourceId,
      sourceStart: 20,
      sourceEnd: 25,
      outputStart: 5,
    },
  ]
  state().setMixLink('mix', ['stem'])
  let before = state().tracks
  state().commitTracks(before, trimClip(before, 'mix-clip', 'end', 4, 10)!, 'trim')
  state().loadFromProject([], JSON.parse(JSON.stringify(state().tracks)))
  state().moveClip('mix-clip', 30)
  before = state().tracks
  expect(state().commitTracks(before, trimClip(before, 'mix-clip', 'end', 40, 10)!, 'reveal')).toBe(
    true,
  )
  expect(
    state().tracks[1].clips.map((c) => [
      c.audioSourceId,
      c.sourceStart,
      c.sourceEnd,
      c.outputStart,
    ]),
  ).toEqual([
    [tracks[1].clips[0].audioSourceId, 0, 5, 30],
    [tracks[2].clips[0].audioSourceId, 20, 25, 35],
  ])
})
it('splits repeated master source occurrences using the original output correspondence', () => {
  const tracks = state().tracks
  tracks[0].clips.push({ ...tracks[0].clips[0], id: 'mix-second', outputStart: 10 })
  tracks[1].clips.push({
    ...tracks[1].clips[0],
    id: 'stem-second',
    audioSourceId: tracks[2].clips[0].audioSourceId,
    outputStart: 10,
  })
  state().setMixLink('mix', ['stem'])
  state().setSelectedClipId('mix-clip')
  state().splitAt(9)
  expect(state().tracks[1].clips.find((c) => c.outputStart === 9)?.audioSourceId).toBe(
    tracks[1].clips[0].audioSourceId,
  )
})
it('normalizes a spanning child into unique occurrence IDs across pre-edited master clips', () => {
  const tracks = state().tracks
  tracks[0].clips = [
    { ...tracks[0].clips[0], sourceEnd: 5 },
    { ...tracks[0].clips[0], id: 'mix-second', sourceStart: 5, sourceEnd: 10, outputStart: 5 },
  ]
  state().setMixLink('mix', ['stem'])
  state().moveClip('mix-second', 10)
  const children = state().tracks[1].clips
  expect(children.map((c) => [c.sourceStart, c.sourceEnd, c.outputStart])).toEqual([
    [0, 5, 0],
    [5, 10, 10],
  ])
  expect(new Set(children.map((c) => c.id)).size).toBe(children.length)
  const before = state().tracks
  state().commitTracks(before, trimClip(before, 'mix-second', 'end', 12, 10)!, 'trim')
  const hidden = state().tracks[0].mixLink?.hiddenSegments?.[0]
  expect(hidden?.clip.id).toBe(state().tracks[1].clips[1].id)
  state().loadFromProject([], JSON.parse(JSON.stringify(state().tracks)))
  const trimmed = state().tracks
  state().commitTracks(trimmed, trimClip(trimmed, 'mix-second', 'end', 15, 10)!, 'reveal')
  expect(state().tracks[1].clips.map((c) => [c.sourceStart, c.sourceEnd, c.outputStart])).toEqual([
    [0, 5, 0],
    [5, 10, 10],
  ])
  expect(new Set(state().tracks[1].clips.map((c) => c.id)).size).toBe(2)
})

it('rejects more than six linked recordings without modifying the project', () => {
  const master = state().tracks[0]
  const children = Array.from({ length: 7 }, (_, i) => ({ ...master, id: `extra-${i}`, clips: [] }))
  useTimelineStore.setState({ tracks: [master, ...children] })
  const before = state().tracks
  expect(
    state().setMixLink(
      master.id,
      children.map((t) => t.id),
    ),
  ).toBe(false)
  expect(state().tracks).toBe(before)
  expect(
    state().setMixLink(
      master.id,
      children.slice(0, 6).map((t) => t.id),
    ),
  ).toBe(true)
})

it('resizes an existing replacement and restores its removed tail in one undo', async () => {
  state().setMixLink('mix', ['stem', 'other'])
  state().replaceMixSources('mix', 2, 6, ['stem'])
  const before = state().tracks
  expect(state().replaceMixSources('mix', 3, 5, ['other'], { start: 2, end: 6 })).toBe(true)
  expect(state().tracks[0].clips[0].sourceOverrides).toEqual([
    expect.objectContaining({ sourceStart: 3, sourceEnd: 5, stemTrackIds: ['other'] }),
  ])
  await state().undo()
  expect(state().tracks).toEqual(before)
})
