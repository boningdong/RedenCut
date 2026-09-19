import { describe, expect, it } from 'vitest'
import type { Clip, Track } from '@shared/ProjectTypes'
import { planClipPlacement } from './TimelinePlacement'

const clip = (id: string, trackId: string, outputStart: number, duration = 2): Clip => ({
  id,
  trackId,
  audioSourceId: '00000000-0000-4000-8000-000000000001' as Clip['audioSourceId'],
  sourceStart: 0,
  sourceEnd: duration,
  outputStart,
  gain: 1,
  muted: false,
  effects: [],
})

const track = (id: string, clips: Clip[]): Track => ({
  id,
  name: id,
  clips,
  volume: 1,
  muted: false,
  solo: false,
  color: '#fff',
  effects: [],
})

describe('planClipPlacement', () => {
  it('moves a cross-track selection while preserving time and track offsets', () => {
    const tracks = [
      track('a', [clip('one', 'a', 2)]),
      track('b', [clip('two', 'b', 5)]),
      track('c', []),
    ]

    const result = planClipPlacement(tracks, ['one', 'two'], 'one', 10, 'b', {
      insert: false,
    })

    expect(result?.tracks[1].clips).toMatchObject([{ id: 'one', trackId: 'b', outputStart: 10 }])
    expect(result?.tracks[2].clips).toMatchObject([{ id: 'two', trackId: 'c', outputStart: 13 }])
    expect(tracks[0].clips[0]).toMatchObject({ id: 'one', trackId: 'a', outputStart: 2 })
  })

  it('resolves all selected clips to the nearest group placement without overlap', () => {
    const tracks = [
      track('a', [clip('one', 'a', 0), clip('two', 'a', 3)]),
      track('b', [clip('block', 'b', 4, 4)]),
    ]

    const result = planClipPlacement(tracks, ['one', 'two'], 'one', 6, 'b', {
      insert: false,
    })

    expect(
      result?.tracks[1].clips
        .filter((item) => item.id !== 'block')
        .map((item) => [item.id, item.outputStart]),
    ).toEqual([
      ['one', 8],
      ['two', 11],
    ])
  })

  it('does not accept the minimum bound when it remains inside a collision', () => {
    const tracks = [
      track('a', [clip('moving', 'a', 10, 3)]),
      track('b', [clip('block', 'b', 0, 5)]),
    ]
    const result = planClipPlacement(tracks, ['moving'], 'moving', 0, 'b', { insert: false })
    expect(result?.tracks[1].clips.find((item) => item.id === 'moving')?.outputStart).toBe(5)
  })

  it('keeps a shared collision boundary available as a valid zero-width seam', () => {
    const tracks = [
      track('a', [clip('moving', 'a', 10, 2)]),
      track('b', [clip('left', 'b', 0, 3), clip('right', 'b', 5, 3)]),
    ]
    const result = planClipPlacement(tracks, ['moving'], 'moving', 3.5, 'b', { insert: false })
    expect(result?.tracks[1].clips.find((item) => item.id === 'moving')?.outputStart).toBe(3)
  })

  it('snaps in normal mode only when a threshold is supplied', () => {
    const tracks = [track('a', [clip('moving', 'a', 0)]), track('b', [clip('seam', 'b', 10, 2)])]

    const unsnapped = planClipPlacement(tracks, ['moving'], 'moving', 7.5, 'a', {
      insert: false,
    })
    const snapped = planClipPlacement(tracks, ['moving'], 'moving', 7.5, 'a', {
      insert: false,
      snapThreshold: 0.6,
    })

    expect(unsnapped?.tracks[0].clips.find((item) => item.id === 'moving')?.outputStart).toBe(7.5)
    expect(snapped?.tracks[0].clips.find((item) => item.id === 'moving')?.outputStart).toBe(8)
    expect(snapped?.guideTime).toBe(10)
  })

  it('snaps insertion by the group leading edge when the anchor starts later', () => {
    const tracks = [
      track('a', [clip('original-early', 'a', 0), clip('early', 'a', 0)]),
      track('b', [clip('original-anchor', 'b', 3), clip('anchor', 'b', 3)]),
    ]
    const result = planClipPlacement(tracks, ['early', 'anchor'], 'anchor', 8, 'b', {
      insert: true,
    })
    expect(result?.guideTime).toBe(5)
    expect(result?.tracks[0].clips.find((item) => item.id === 'early')?.outputStart).toBe(5)
    expect(result?.tracks[1].clips.find((item) => item.id === 'anchor')?.outputStart).toBe(8)
  })

  it('inserts at the nearest seam and shifts only affected destination tracks by the group span', () => {
    const tracks = [
      track('a', [clip('one', 'a', 0)]),
      track('b', [clip('before', 'b', 0, 2), clip('two', 'b', 3), clip('after-b', 'b', 6, 2)]),
      track('c', [clip('after-c', 'c', 6, 2)]),
      track('d', [clip('untouched', 'd', 6, 2)]),
    ]

    const result = planClipPlacement(tracks, ['one', 'two'], 'one', 2.2, 'b', { insert: true })

    expect(result?.guideTime).toBe(2)
    expect(result?.tracks[1].clips.map((item) => [item.id, item.outputStart])).toEqual([
      ['before', 0],
      ['one', 2],
      ['after-b', 11],
    ])
    expect(result?.tracks[2].clips.map((item) => [item.id, item.outputStart])).toEqual([
      ['two', 5],
      ['after-c', 11],
    ])
    expect(result?.tracks[3]).toBe(tracks[3])
  })

  it('chooses the nearest insertion seam that is valid across every destination track', () => {
    const tracks = [
      track('a', [clip('one', 'a', 10)]),
      track('b', [clip('before', 'b', 0), clip('two', 'b', 10), clip('after', 'b', 6)]),
      track('c', [clip('crossing', 'c', 1, 2)]),
    ]
    const result = planClipPlacement(tracks, ['one', 'two'], 'one', 2.2, 'b', { insert: true })
    expect(result?.guideTime).toBe(3)
    expect(result?.tracks[1].clips.find((item) => item.id === 'one')?.outputStart).toBe(3)
    expect(result?.tracks[2].clips.find((item) => item.id === 'two')?.outputStart).toBe(3)
  })

  it('rejects missing selections, anchors, and out-of-range track destinations', () => {
    const tracks = [track('a', [clip('one', 'a', 0)]), track('b', [clip('two', 'b', 1)])]
    expect(planClipPlacement(tracks, [], 'one', 0, 'a', { insert: false })).toBeNull()
    expect(planClipPlacement(tracks, ['missing'], 'missing', 0, 'a', { insert: false })).toBeNull()
    expect(planClipPlacement(tracks, ['one', 'two'], 'one', 0, 'b', { insert: false })).toBeNull()
    expect(planClipPlacement(tracks, ['one'], 'one', 0, 'missing', { insert: false })).toBeNull()
  })
})
