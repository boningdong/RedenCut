import type { SpeakerIdentityCatalog } from './SpeakerIdentityTypes'

/** Re-analysis replaces source bindings, including the names, colors and group membership they carry. */
export function hasSpeakerRerunImpact(
  catalog: SpeakerIdentityCatalog | undefined,
  sourceIds: ReadonlySet<string>,
): boolean {
  return catalog?.people.some((person) => sourceIds.has(person.binding.audioSourceId)) ?? false
}
