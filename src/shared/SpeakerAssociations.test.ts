import { describe, expect, it } from 'vitest'
import {
  associateSpeakers,
  setAssociationMembers,
  setPersonAssociations,
} from './SpeakerAssociations'
import { SpeakerIdentityCatalogSchema, type SpeakerIdentityCatalog } from './SpeakerIdentityTypes'
const catalog = (): SpeakerIdentityCatalog => ({
  version: 1,
  people: ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    displayName: id.toUpperCase(),
    color: '#123456',
    binding: {
      audioSourceId: `00000000-0000-4000-8000-00000000000${id}`,
      analysisRevisionId: '00000000-0000-4000-8000-000000000010',
      speakerId: '00000000-0000-4000-8000-000000000011',
    },
  })) as SpeakerIdentityCatalog['people'],
  associations: [],
})
describe('speaker associations', () => {
  it('creates and merges flat groups preserving receiver information', () => {
    let value = associateSpeakers(
      catalog(),
      { kind: 'person', id: 'a' },
      { kind: 'person', id: 'b' },
      'ab',
    )
    value = associateSpeakers(value, { kind: 'person', id: 'c' }, { kind: 'person', id: 'd' }, 'cd')
    value = associateSpeakers(
      value,
      { kind: 'association', id: 'ab' },
      { kind: 'association', id: 'cd' },
      'unused',
    )
    expect(value.associations).toEqual([
      {
        id: 'ab',
        displayName: 'A',
        color: { mode: 'automatic' },
        memberPersonIds: ['a', 'b', 'c', 'd'],
      },
    ])
  })
  it('distinguishes removing a member from detaching the edited person', () => {
    const value = setPersonAssociations(catalog(), 'a', ['b', 'c'], 'abc')
    expect(setPersonAssociations(value, 'a', [], 'unused').associations[0].memberPersonIds).toEqual(
      ['b', 'c'],
    )
    expect(setAssociationMembers(value, 'abc', ['a', 'c']).associations[0].memberPersonIds).toEqual(
      ['a', 'c'],
    )
    expect(setAssociationMembers(value, 'abc', ['a']).associations).toEqual([])
    expect(value.associations[0].memberPersonIds).toEqual(['a', 'b', 'c'])
  })
  it('rejects duplicate bindings, duplicate memberships and unknown members', () => {
    const value = catalog()
    value.people[1].binding = value.people[0].binding
    expect(SpeakerIdentityCatalogSchema.safeParse(value).success).toBe(false)
    const linked = setPersonAssociations(catalog(), 'a', ['b'], 'ab')
    expect(
      SpeakerIdentityCatalogSchema.safeParse({
        ...linked,
        associations: [...linked.associations, { ...linked.associations[0], id: 'other' }],
      }).success,
    ).toBe(false)
    expect(() => setPersonAssociations(catalog(), 'a', ['unknown'], 'bad')).toThrow()
  })
})

it('partial person edits leave remaining peers together and dissolve singletons', () => {
  const original = setPersonAssociations(catalog(), 'a', ['b', 'c', 'd'], 'abcd')
  const changed = setPersonAssociations(original, 'a', ['b'], 'ab')
  expect(changed.associations.map((group) => group.memberPersonIds)).toEqual([
    ['c', 'd'],
    ['a', 'b'],
  ])
  expect(new Set(changed.associations.map((group) => group.id)).size).toBe(2)
  expect(original.associations[0].memberPersonIds).toEqual(['a', 'b', 'c', 'd'])
})
