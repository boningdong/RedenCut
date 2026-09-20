import { expect, it } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import { projectTranscript } from './transcriptProjection'
import { resolveTranscriptSelection } from './transcriptSelection'
const track = (id: string): Track => ({
  id,
  name: id,
  color: id === 'mix' ? '#445566' : '#118877',
  volume: 1,
  muted: false,
  solo: false,
  effects: [],
  clips: [
    {
      id: `clip-${id}`,
      trackId: id,
      audioSourceId: id as never,
      sourceStart: 0,
      sourceEnd: 4,
      outputStart: 0,
      gain: 1,
      muted: false,
      effects: [],
    },
  ],
})
const analysis = (id: string): RendererSpeechAnalysis =>
  ({
    audioSourceId: id,
    analysisRevisionId: 'r',
    transcript: { units: [{ id: 'word', kind: 'speech', text: id }] },
    alignment: {
      validation: { version: 1, method: 'audio-evidence' },
      acousticEditUnits: [{ id: 'a', transcriptUnitIds: ['word'], sourceStart: 1, sourceEnd: 3 }],
    },
    speakerAttribution: { attributions: [] },
    speakers: [],
    speakerLabelOverrides: [],
  }) as unknown as RendererSpeechAnalysis
function fixture() {
  const mix = track('mix'),
    stem = track('stem')
  mix.mixLink = { stemTrackIds: ['stem'] }
  return { mix, stem }
}
it('hides linked children until selected as replacement', () => {
  const { mix, stem } = fixture()
  expect(
    projectTranscript([analysis('mix'), analysis('stem')], [mix, stem]).map((x) => x.unit.text),
  ).toEqual(['mix'])
})
it('uses raw child text with master redaction and exact master edit target', () => {
  const { mix, stem } = fixture()
  mix.clips[0].sourceOverrides = [{ id: 'o', sourceStart: 0, sourceEnd: 4, stemTrackIds: ['stem'] }]
  stem.muted = true
  stem.solo = true
  stem.clips[0].redactions = [{ id: 'child-redact', sourceStart: 0, sourceEnd: 4 }]
  const units = projectTranscript([analysis('mix'), analysis('stem')], [mix, stem])
  expect(units).toHaveLength(1)
  expect(units[0]).toMatchObject({ muted: false, redaction: 'none', track: { color: '#118877' } })
  const selected = resolveTranscriptSelection(units, [mix, stem])
  expect(selected).toMatchObject({
    editable: true,
    occurrence: { track: { id: 'mix' }, clip: { id: 'clip-mix' } },
    sourceRanges: [{ start: 1, end: 3 }],
  })
  mix.clips[0].redactions = [{ id: 'master-redact', sourceStart: 1, sourceEnd: 3 }]
  expect(projectTranscript([analysis('stem')], [mix, stem])[0].redaction).toBe('full')
})
it('does not invent mix text when replacement has no analysis', () => {
  const { mix, stem } = fixture()
  mix.clips[0].sourceOverrides = [{ id: 'o', sourceStart: 0, sourceEnd: 4, stemTrackIds: ['stem'] }]
  expect(projectTranscript([analysis('mix')], [mix, stem])).toEqual([])
})
it('maps offset child acoustic ranges back to master source time', () => {
  const { mix, stem } = fixture()
  stem.clips[0].sourceStart = 1
  stem.clips[0].sourceEnd = 5
  mix.clips[0].sourceOverrides = [{ id: 'o', sourceStart: 0, sourceEnd: 4, stemTrackIds: ['stem'] }]
  const units = projectTranscript([analysis('stem')], [mix, stem])
  expect(resolveTranscriptSelection(units, [mix, stem])).toMatchObject({
    editable: true,
    sourceRanges: [{ start: 0, end: 2 }],
    occurrence: { clip: { id: 'clip-mix' } },
  })
})
it('keeps uncovered mix words and gives routed fragments independent identities', () => {
  const { mix, stem } = fixture()
  mix.clips[0].sourceOverrides = [{ id: 'o', sourceStart: 2, sourceEnd: 3, stemTrackIds: ['stem'] }]
  const units = projectTranscript([analysis('mix'), analysis('stem')], [mix, stem])
  expect(units.map((u) => [u.unit.text, u.outputStart, u.outputEnd])).toEqual([
    ['mix', 1, 2],
    ['stem', 2, 3],
  ])
  expect(new Set(units.map((u) => u.id)).size).toBe(units.length)
  expect(units.every((u) => u.partial)).toBe(true)
})
it('master mute controls substituted text while child controls do not', () => {
  const { mix, stem } = fixture()
  mix.clips[0].sourceOverrides = [{ id: 'o', sourceStart: 0, sourceEnd: 4, stemTrackIds: ['stem'] }]
  mix.muted = true
  expect(projectTranscript([analysis('stem')], [mix, stem])[0].muted).toBe(true)
})
it('redacting an original-text fragment cannot cross into a replacement interval', () => {
  const { mix, stem } = fixture()
  mix.clips[0].sourceOverrides = [{ id: 'o', sourceStart: 2, sourceEnd: 3, stemTrackIds: ['stem'] }]
  const units = projectTranscript([analysis('mix'), analysis('stem')], [mix, stem])
  expect(resolveTranscriptSelection([units[0]], [mix, stem])).toMatchObject({
    editable: true,
    sourceRanges: [{ start: 1, end: 2 }],
  })
})
