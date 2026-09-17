import { beforeEach, expect, it } from 'vitest'
import { useTimelineStore } from './timeline.store'
import { ProjectFileSchema } from '@shared/project.types'
import { redactionSkipRanges } from '@shared/redactionTimeline'
import { redactionCoverage, clipRedactionRanges } from '@shared/ClipRedactions'
import { deleteSelection } from '../actions/timelineActions'

const tracks = () =>
  ProjectFileSchema.parse({
    version: 2,
    createdAt: '',
    audioSettings: { processingSampleRate: 48000 },
    audioSources: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        displayName: 'Voice',
        location: { mode: 'copy', path: 'media/550e8400-e29b-41d4-a716-446655440000/v.wav' },
        fingerprint: { byteLength: 0, modifiedTimeMs: 0, sha256: 'a'.repeat(64) },
        metadata: {
          durationSeconds: 20,
          sampleRate: 48000,
          channels: 1,
          codec: 'pcm',
          bitrateKbps: 1,
        },
      },
    ],
    tracks: [
      {
        id: 't',
        name: 'Voice',
        color: '#fff',
        clips: [
          {
            id: 'c',
            trackId: 't',
            audioSourceId: '550e8400-e29b-41d4-a716-446655440000',
            sourceStart: 0,
            sourceEnd: 20,
            outputStart: 0,
          },
        ],
      },
    ],
  }).tracks
const state = () => useTimelineStore.getState()
beforeEach(() => {
  state().reset()
  state().loadFromProject([], tracks())
})
it('redacts selected speech without splitting the clip and restores one atomic edit', () => {
  const original = state().tracks[0].clips[0]
  state().redactTranscriptRange('t', [original], { start: 2, end: 4 })
  expect(state().tracks[0].clips).toHaveLength(1)
  expect(state().tracks[0].clips[0]).toMatchObject({
    id: 'c',
    muted: false,
    sourceStart: 0,
    sourceEnd: 20,
    redactions: [{ sourceStart: 2, sourceEnd: 4 }],
  })
  void state().undo()
  expect(state().tracks[0].clips[0].redactions ?? []).toEqual([])
  void state().redo()
  expect(state().tracks[0].clips[0].redactions).toHaveLength(1)
})

it('keeps touching and overlapping overlays individually removable; ordinary mute is independent', () => {
  state().redactClipRanges('t', 'c', [{ start: 2, end: 4 }])
  state().redactClipRanges('t', 'c', [{ start: 3, end: 6 }])
  const clip = state().tracks[0].clips[0]
  const [first, second] = clip.redactions!
  expect(redactionSkipRanges(state().tracks)).toEqual([{ start: 2, end: 6 }])
  state().selectRedaction('c', first.id)
  deleteSelection()
  expect(state().tracks[0].clips).toHaveLength(1)
  expect(redactionSkipRanges(state().tracks)).toEqual([{ start: 3, end: 6 }])
  state().setClipMuted('c', true)
  state().removeRedaction('c', second.id)
  expect(state().tracks[0].clips[0]).toMatchObject({ muted: true, redactions: [] })
  expect(redactionSkipRanges(state().tracks)).toEqual([])
  void state().undo()
  expect(state().tracks[0].clips[0].redactions).toEqual([second])
})

it('moves overlays with their clip and partitions crossing coverage on explicit split', () => {
  state().redactClipRanges('t', 'c', [{ start: 2, end: 6 }])
  state().moveClip('c', 10)
  expect(redactionSkipRanges(state().tracks)).toEqual([{ start: 12, end: 16 }])
  state().setSelectedClipId('c')
  state().splitAt(14)
  const clips = state().tracks[0].clips
  expect(clips).toHaveLength(2)
  expect(clips.map((c) => c.redactions!.map((r) => [r.sourceStart, r.sourceEnd]))).toEqual([
    [[2, 4]],
    [[4, 6]],
  ])
  expect(clips[0].redactions![0].id).not.toBe(clips[1].redactions![0].id)
  expect(redactionSkipRanges(state().tracks)).toEqual([{ start: 12, end: 16 }])
  expect(state().timelineSelection).toBeNull()
  void state().undo()
  expect(state().tracks[0].clips).toHaveLength(1)
})

it('validates resize, restores independent history, and projects partial coverage after resize', () => {
  state().redactClipRanges('t', 'c', [{ start: 2, end: 6 }])
  const id = state().tracks[0].clips[0].redactions![0].id
  for (const range of [
    { sourceStart: NaN, sourceEnd: 4 },
    { sourceStart: 6, sourceEnd: 2 },
    { sourceStart: -1, sourceEnd: 4 },
    { sourceStart: 2, sourceEnd: 21 },
  ])
    state().updateRedaction('c', id, range)
  expect(state().undoStack).toHaveLength(1)
  state().updateRedaction('c', id, { sourceStart: 3, sourceEnd: 6 })
  expect(redactionCoverage(state().tracks[0].clips[0], 2, 4)).toBe('partial')
  expect(state().undoStack).toHaveLength(2)
  void state().undo()
  expect(redactionCoverage(state().tracks[0].clips[0], 2, 4)).toBe('full')
  void state().redo()
  expect(redactionCoverage(state().tracks[0].clips[0], 2, 4)).toBe('partial')
})

it('clips effective coverage on trim without losing hidden metadata', () => {
  const clip = {
    ...state().tracks[0].clips[0],
    redactions: [{ id: 'r', sourceStart: 2, sourceEnd: 6 }],
  }
  const trimmed = { ...clip, sourceStart: 4, sourceEnd: 5 }
  expect(clipRedactionRanges(trimmed)).toEqual([{ start: 4, end: 5 }])
  expect(trimmed.redactions).toEqual(clip.redactions)
  expect(clipRedactionRanges({ ...trimmed, sourceStart: 0, sourceEnd: 20 })).toEqual([
    { start: 2, end: 6 },
  ])
})

it('clears overlay selection when its clip disappears or a different project loads', () => {
  state().redactClipRanges('t', 'c', [{ start: 2, end: 6 }])
  const id = state().tracks[0].clips[0].redactions![0].id
  state().selectRedaction('c', id)
  state().removeClip('c')
  expect(state().timelineSelection).toBeNull()
  void state().undo()
  state().selectRedaction('c', id)
  state().loadFromProject([], tracks())
  expect(state().timelineSelection).toBeNull()
})
