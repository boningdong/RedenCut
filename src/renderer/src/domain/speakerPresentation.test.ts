import { expect, it } from 'vitest'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import type { Track } from '@shared/ProjectTypes'
import { TRACK_COLORS } from '@shared/trackColors'
import { buildSpeakerColors, speakerKey } from './speakerPresentation'

function analysis(source: string, count = 2): RendererSpeechAnalysis {
  return {
    audioSourceId: source,
    analysisRevisionId: `revision-${source}`,
    speakers: Array.from({ length: count }, (_, index) => ({ id: `${source}-${index}` })),
    speakerLabelOverrides: [],
  } as never
}
function track(source: string, index: number): Track {
  return { id: source, color: TRACK_COLORS[index], clips: [{ audioSourceId: source }] } as never
}
it('anchors each track first speaker and allocates unique secondary colors outside all eight reserved colors', () => {
  const analyses = Array.from({ length: 8 }, (_, i) => analysis(`source-${i}`, 12))
  const tracks = analyses.map((a, i) => track(a.audioSourceId, i))
  const colors = buildSpeakerColors(analyses, tracks)
  expect(new Set(colors.values()).size).toBe(96)
  for (const [i, a] of analyses.entries()) {
    expect(colors.get(speakerKey(a, a.speakers[0].id))).toBe(TRACK_COLORS[i])
    for (const s of a.speakers.slice(1))
      expect(TRACK_COLORS).not.toContain(colors.get(speakerKey(a, s.id)))
  }
  expect(buildSpeakerColors([...analyses].reverse(), [...tracks].reverse())).toEqual(colors)
})
it('keeps existing colors when another track is imported, and honors saved overrides', () => {
  const a = analysis('a'),
    b = analysis('b')
  const initial = buildSpeakerColors([a], [track('a', 0)])
  const added = buildSpeakerColors([a, b], [track('a', 0), track('b', 1)])
  for (const [key, color] of initial) expect(added.get(key)).toBe(color)
  a.speakerLabelOverrides = [
    { speakerId: a.speakers[1].id, displayName: 'Guest', color: '#dc8b9c' },
  ]
  expect(
    buildSpeakerColors([a, b], [track('a', 0), track('b', 1)]).get(speakerKey(a, a.speakers[1].id)),
  ).toBe('#dc8b9c')
})
it('allocates just one track-colored anchor when multiple sources share a track', () => {
  const a = analysis('a'),
    b = analysis('b')
  const t = track('a', 0)
  t.clips.push({ audioSourceId: 'b' } as never)
  const colors = buildSpeakerColors([a, b], [t])
  expect([...colors.values()].filter((c) => c === TRACK_COLORS[0])).toHaveLength(1)
  expect(new Set(colors.values()).size).toBe(4)
})
