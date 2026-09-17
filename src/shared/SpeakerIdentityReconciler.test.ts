import { expect, it } from 'vitest'
import { reconcileSpeakerIdentities, isPersonEditable } from './SpeakerIdentityReconciler'
import type { RendererSpeechAnalysis } from './speech.types'
const analysis = {
  audioSourceId: '00000000-0000-4000-8000-000000000001',
  analysisRevisionId: '00000000-0000-4000-8000-000000000002',
  diarizationStatus: 'completed',
  speakers: [{ id: '00000000-0000-4000-8000-000000000003', defaultDisplayName: 'Speaker 1' }],
  speakerLabelOverrides: [
    { speakerId: '00000000-0000-4000-8000-000000000003', displayName: 'Alice', color: '#123456' },
  ],
} as unknown as RendererSpeechAnalysis
it('migrates overrides deterministically, retaining same-revision edits and stale identities', () => {
  const first = reconcileSpeakerIdentities(undefined, [analysis])
  expect(first.people[0]).toMatchObject({ displayName: 'Alice', color: '#123456' })
  expect(reconcileSpeakerIdentities(undefined, [analysis])).toEqual(first)
  first.people[0].displayName = 'Edited'
  expect(reconcileSpeakerIdentities(first, [analysis])).toEqual(first)
  const next = {
    ...analysis,
    analysisRevisionId: '00000000-0000-4000-8000-000000000004',
    speakerLabelOverrides: [],
  } as unknown as RendererSpeechAnalysis
  const regenerated = reconcileSpeakerIdentities(first, [next])
  expect(regenerated.people).toHaveLength(2)
  expect(isPersonEditable(first.people[0], [next])).toBe(false)
  expect(regenerated.people[1].displayName).toBe('Speaker 1')
})
it('never fabricates people or editing permission for pending or disabled diarization', () => {
  for (const diarizationStatus of ['pending', 'skipped-disabled'] as const) {
    const unavailable = { ...analysis, diarizationStatus }
    expect(reconcileSpeakerIdentities(undefined, [unavailable]).people).toEqual([])
    expect(
      isPersonEditable(reconcileSpeakerIdentities(undefined, [analysis]).people[0], [unavailable]),
    ).toBe(false)
  }
  expect(
    reconcileSpeakerIdentities(undefined, [{ ...analysis, diarizationStatus: undefined }]).people,
  ).toEqual([])
})
