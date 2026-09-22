import { expect, it } from 'vitest'
import { hasSpeakerRerunImpact } from './SpeakerRerunImpact'
import type { SpeakerIdentityCatalog } from './SpeakerIdentityTypes'

it('limits catalog reset warnings to source identities in the requested scope', () => {
  const catalog: SpeakerIdentityCatalog = {
    version: 1,
    people: [
      {
        id: 'host',
        displayName: 'Host',
        color: '#112233',
        binding: {
          audioSourceId: 'source-a' as never,
          analysisRevisionId: 'revision' as never,
          speakerId: 'speaker' as never,
        },
      },
    ],
    associations: [],
  }
  expect(hasSpeakerRerunImpact(catalog, new Set(['source-a']))).toBe(true)
  expect(hasSpeakerRerunImpact(catalog, new Set(['source-b']))).toBe(false)
  expect(hasSpeakerRerunImpact(undefined, new Set(['source-a']))).toBe(false)
})
