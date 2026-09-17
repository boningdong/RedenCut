import type { CSSProperties } from 'react'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { Track } from '@shared/project.types'
export type IdentityTarget = { kind: 'person' | 'association'; id: string }
export type Person = SpeakerIdentityCatalog['people'][number]
export function personIsOnTimeline(person: Person, tracks: Track[]): boolean {
  return tracks.some((track) =>
    track.clips.some((clip) => clip.audioSourceId === person.binding.audioSourceId),
  )
}
export function membersFor(catalog: SpeakerIdentityCatalog, target: IdentityTarget): Person[] {
  const ids =
    target.kind === 'person'
      ? [target.id]
      : (catalog.associations.find((a) => a.id === target.id)?.memberPersonIds ?? [])
  return ids.flatMap((id) => catalog.people.find((p) => p.id === id) ?? [])
}
export function identityColor(catalog: SpeakerIdentityCatalog, target: IdentityTarget): string {
  if (target.kind === 'person')
    return catalog.people.find((p) => p.id === target.id)?.color ?? '#aaa'
  const group = catalog.associations.find((a) => a.id === target.id)
  if (group?.color.mode === 'custom') return group.color.value
  const colors = membersFor(catalog, target).map((p) => p.color)
  return colors.length > 1 ? `linear-gradient(135deg, ${colors.join(', ')})` : (colors[0] ?? '#aaa')
}
export function SourceBadges({
  people,
  tracks,
  collapsible = false,
}: {
  people: Person[]
  tracks: Track[]
  collapsible?: boolean
}) {
  return (
    <span className={collapsible ? 'identity-track-strips' : 'identity-source-badges'}>
      {tracks.map((track, index) =>
        people.some((p) => track.clips.some((c) => c.audioSourceId === p.binding.audioSourceId)) ? (
          <span
            key={track.id}
            title={track.name}
            style={
              collapsible
                ? ({ '--identity-track-color': track.color } as CSSProperties)
                : {
                    color: track.color,
                    background: `color-mix(in srgb, ${track.color} 10%, transparent)`,
                  }
            }
          >
            T{index + 1}
          </span>
        ) : null,
      )}
    </span>
  )
}
export function EditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5" />
    </svg>
  )
}
