import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/project.types'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import { projectTranscript, findTranscriptOverlaps } from './transcriptProjection'

const analysis = (source = 'source'): RendererSpeechAnalysis =>
  ({
    audioSourceId: source as never,
    analysisRevisionId: `revision-${source}`,
    transcript: {
      units: [
        { id: 'a', text: 'Hello', kind: 'speech' },
        { id: 'p', text: '.', kind: 'punctuation' },
        { id: 'u', text: 'uncertain', kind: 'speech' },
      ],
    },
    alignment: {
      acousticEditUnits: [
        { id: 'acoustic', transcriptUnitIds: ['a'], sourceStart: 1, sourceEnd: 3 },
      ],
    },
    speakerAttribution: { attributions: [] },
    speakers: [],
    speakerLabelOverrides: [],
  }) as unknown as RendererSpeechAnalysis
const track = (id: string, outputStart = 0, source = 'source'): Track =>
  ({
    id,
    name: id,
    color: '#fff',
    volume: 1,
    muted: false,
    solo: false,
    effects: [],
    clips: [
      {
        id: `clip-${id}`,
        trackId: id,
        audioSourceId: source as never,
        sourceStart: 0,
        sourceEnd: 4,
        outputStart,
        gain: 1,
        muted: false,
        effects: [],
      },
    ],
  }) as Track

describe('timeline transcript projection', () => {
  it('projects every source occurrence with distinct identity and output times', () => {
    const a = track('a')
    a.clips.push({ ...a.clips[0], id: 'duplicate', outputStart: 10 })
    const result = projectTranscript([analysis(), analysis('other')], [a, track('b', 5, 'other')])
    expect(
      result
        .filter((u) => u.unit.id === 'a')
        .map((u) => [u.track.id, u.clip.id, u.outputStart, u.outputEnd]),
    ).toEqual([
      ['a', 'clip-a', 1, 3],
      ['b', 'clip-b', 6, 8],
      ['a', 'duplicate', 11, 13],
    ])
    expect(new Set(result.map((u) => u.id)).size).toBe(result.length)
  })
  it('clips acoustic intervals to source trims and preserves untimed punctuation without inventing timing', () => {
    const a = track('a')
    a.clips[0].sourceStart = 2
    a.clips[0].sourceEnd = 2.5
    a.clips[0].outputStart = 8
    const result = projectTranscript([analysis()], [a])
    expect(result[0]).toMatchObject({
      sourceStart: 2,
      sourceEnd: 2.5,
      outputStart: 8,
      outputEnd: 8.5,
      partial: true,
    })
    expect(result.find((u) => u.unit.id === 'p')?.outputStart).toBeNull()
    expect(result.find((u) => u.unit.id === 'u')?.outputStart).toBeNull()
    expect(projectTranscript([analysis()], [])).toEqual([])
  })
  it('finds only positive audible cross-track intersections, including three tracks', () => {
    const units = projectTranscript(
      [analysis()],
      [track('a'), track('b', 1), track('c', 1.5), track('touch', 2)],
    )
    expect(findTranscriptOverlaps(units).map((r) => [r.start, r.end, r.trackIds])).toEqual([
      [2, 2.5, ['a', 'b']],
      [2.5, 3, ['a', 'b', 'c']],
      [3, 4, ['b', 'c', 'touch']],
      [4, 4.5, ['c', 'touch']],
    ])
    const muted = track('b', 1)
    muted.muted = true
    expect(findTranscriptOverlaps(projectTranscript([analysis()], [track('a'), muted]))).toEqual([])
    expect(
      findTranscriptOverlaps(projectTranscript([analysis()], [track('a'), track('b', 2)])),
    ).toEqual([])
  })
  it('does not classify duplicate same-track speech as cross-track overlap', () => {
    const a = track('a')
    a.clips.push({ ...a.clips[0], id: 'duplicate' })
    expect(findTranscriptOverlaps(projectTranscript([analysis()], [a]))).toEqual([])
  })
  it('keeps natural Latin punctuation spacing without altering transcript text', () => {
    const result = projectTranscript([analysis()], [track('a')])
    expect(result.map((u) => `${u.leadingSpace ? ' ' : ''}${u.unit.text}`).join('')).toBe(
      'Hello. uncertain',
    )
  })
})
