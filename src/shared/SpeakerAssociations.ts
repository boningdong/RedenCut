import {
  SpeakerIdentityCatalogSchema,
  type SpeakerIdentityCatalog,
  type SpeakerAssociation,
  type SpeakerIdentityTarget,
} from './SpeakerIdentityTypes'
function target(catalog: SpeakerIdentityCatalog, value: SpeakerIdentityTarget) {
  const association = catalog.associations.find((group) =>
    value.kind === 'association' ? group.id === value.id : group.memberPersonIds.includes(value.id),
  )
  if (association)
    return {
      displayName: association.displayName,
      members: association.memberPersonIds,
      association,
    }
  const person = value.kind === 'person' && catalog.people.find((person) => person.id === value.id)
  if (!person) throw new Error('Unknown speaker identity')
  return { displayName: person.displayName, members: [person.id], association: undefined }
}
function removeMembers(catalog: SpeakerIdentityCatalog, members: string[]): SpeakerAssociation[] {
  return catalog.associations
    .map((group) => ({
      ...group,
      memberPersonIds: group.memberPersonIds.filter((id) => !members.includes(id)),
    }))
    .filter((group) => group.memberPersonIds.length >= 2)
}
export function associateSpeakers(
  catalog: SpeakerIdentityCatalog,
  receiver: SpeakerIdentityTarget,
  incoming: SpeakerIdentityTarget,
  newAssociationId: string,
): SpeakerIdentityCatalog {
  const receiving = target(catalog, receiver),
    added = target(catalog, incoming)
  const members = [...new Set([...receiving.members, ...added.members])]
  if (members.length < 2) return catalog
  return SpeakerIdentityCatalogSchema.parse({
    ...catalog,
    associations: [
      ...removeMembers(catalog, members),
      {
        id: receiving.association?.id ?? newAssociationId,
        displayName: receiving.displayName,
        color: receiving.association?.color ?? { mode: 'automatic' },
        memberPersonIds: members,
      },
    ],
  })
}
export function setAssociationMembers(
  catalog: SpeakerIdentityCatalog,
  associationId: string,
  personIds: string[],
): SpeakerIdentityCatalog {
  const group = catalog.associations.find((group) => group.id === associationId)
  if (!group) throw new Error('Unknown speaker association')
  const other = {
    ...catalog,
    associations: catalog.associations.filter((candidate) => candidate.id !== associationId),
  }
  return SpeakerIdentityCatalogSchema.parse({
    ...catalog,
    associations: [
      ...removeMembers(other, personIds),
      ...(personIds.length >= 2 ? [{ ...group, memberPersonIds: personIds }] : []),
    ],
  })
}
export function setPersonAssociations(
  catalog: SpeakerIdentityCatalog,
  personId: string,
  otherPersonIds: string[],
  newAssociationId: string,
): SpeakerIdentityCatalog {
  const person = catalog.people.find((person) => person.id === personId)
  if (!person) throw new Error('Unknown speaker person')
  const members = [personId, ...otherPersonIds.filter((id) => id !== personId)]
  const old = catalog.associations.find((group) => group.memberPersonIds.includes(personId))
  if (
    old &&
    old.memberPersonIds.length === members.length &&
    old.memberPersonIds.every((id) => members.includes(id))
  )
    return catalog
  const residual = removeMembers(catalog, members)
  const canReuse = old && !residual.some((group) => group.id === old.id)
  return SpeakerIdentityCatalogSchema.parse({
    ...catalog,
    associations: [
      ...residual,
      ...(members.length >= 2
        ? [
            {
              id: canReuse ? old.id : newAssociationId,
              displayName: old?.displayName ?? person.displayName,
              color: old?.color ?? { mode: 'automatic' },
              memberPersonIds: members,
            },
          ]
        : []),
    ],
  })
}
