import { isDeepStrictEqual } from 'node:util'
import {
  SpeakerIdentityCatalogSchema,
  type SpeakerIdentityCatalog,
} from '../../shared/SpeakerIdentityTypes'
import { isPersonEditable } from '../../shared/SpeakerIdentityReconciler'
import type { RendererSpeechAnalysis } from '../../shared/speech.types'
export function validateSpeakerIdentityChange(
  current: SpeakerIdentityCatalog,
  expected: SpeakerIdentityCatalog,
  input: SpeakerIdentityCatalog,
  analyses: RendererSpeechAnalysis[],
): SpeakerIdentityCatalog {
  const next = SpeakerIdentityCatalogSchema.parse(input)
  if (!isDeepStrictEqual(current, SpeakerIdentityCatalogSchema.parse(expected)))
    throw new Error('Speaker identities changed; reopen the editor')
  if (next.people.length !== current.people.length)
    throw new Error('Person identities cannot be added or removed')
  const affected = new Set<string>()
  for (const person of current.people) {
    const changed = next.people.find((candidate) => candidate.id === person.id)
    if (!changed || !isDeepStrictEqual(person.binding, changed.binding))
      throw new Error('Person source bindings are immutable')
    if (!isDeepStrictEqual(person, changed)) affected.add(person.id)
  }
  for (const group of [...current.associations, ...next.associations]) {
    const before = current.associations.find((candidate) => candidate.id === group.id)
    const after = next.associations.find((candidate) => candidate.id === group.id)
    if (!isDeepStrictEqual(before, after)) for (const id of group.memberPersonIds) affected.add(id)
  }
  for (const person of current.people)
    if (affected.has(person.id) && !isPersonEditable(person, analyses))
      throw new Error('Speaker source is unavailable or needs review')
  return next
}
