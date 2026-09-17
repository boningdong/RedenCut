import { expect, it } from 'vitest'
import { validateSpeakerIdentityChange } from './SpeakerIdentityService'
import { reconcileSpeakerIdentities } from '../../shared/SpeakerIdentityReconciler'
import type { RendererSpeechAnalysis } from '../../shared/speech.types'
const analysis = {
  audioSourceId: '00000000-0000-4000-8000-000000000001',
  analysisRevisionId: '00000000-0000-4000-8000-000000000002',
  diarizationStatus: 'completed',
  speakers: [{ id: '00000000-0000-4000-8000-000000000003', defaultDisplayName: 'Speaker 1' }],
  speakerLabelOverrides: [],
} as unknown as RendererSpeechAnalysis
it('guards catalog expectations and allows retained stale identities without editing them', () => {
  const current = reconcileSpeakerIdentities(undefined, [analysis])
  const next = structuredClone(current)
  next.people[0].displayName = 'Alice'
  expect(validateSpeakerIdentityChange(current, current, next, [analysis])).toEqual(next)
  expect(() => validateSpeakerIdentityChange(next, current, next, [analysis])).toThrow('changed')
  expect(() => validateSpeakerIdentityChange(current, current, next, [])).toThrow('unavailable')
  expect(validateSpeakerIdentityChange(current, current, current, [])).toEqual(current)
  const deleted = { ...current, people: [] }
  expect(() => validateSpeakerIdentityChange(current, current, deleted, [])).toThrow()
  const rebound = structuredClone(next)
  rebound.people[0].binding.speakerId = '00000000-0000-4000-8000-000000000004' as never
  expect(() => validateSpeakerIdentityChange(current, current, rebound, [analysis])).toThrow()
})
