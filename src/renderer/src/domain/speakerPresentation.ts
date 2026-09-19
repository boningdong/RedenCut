import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { RendererSpeechAnalysis, SpeakerId } from '@shared/speech.types'
import type { TrackContent } from '@shared/ProjectTypes'
import { TRACK_COLORS, trackPresentationColor } from '@shared/trackColors'

/** Unassigned is a visibility category, never a synthetic speaker identity. */
export function unassignedSpeakerKey(analysis: RendererSpeechAnalysis): string {
  return `${analysis.audioSourceId}:unassigned`
}

export function speakerKey(analysis: RendererSpeechAnalysis, id: SpeakerId): string {
  return `${analysis.audioSourceId}:${analysis.analysisRevisionId}:${id}`
}
export function speakerName(
  analysis: RendererSpeechAnalysis,
  id?: SpeakerId,
  defaultName?: (number: number) => string,
): string | undefined {
  if (!id) return undefined
  const override = analysis.speakerLabelOverrides.find((speaker) => speaker.speakerId === id)
  if (override) return override.displayName
  const index = analysis.speakers.findIndex((speaker) => speaker.id === id)
  const storedDefault = analysis.speakers[index]?.defaultDisplayName
  // Only our generated defaults are presentation copy. Preserve imported or historical names.
  return defaultName && storedDefault === `Speaker ${index + 1}`
    ? defaultName(index + 1)
    : storedDefault
}

/** Stable identity-derived colors, with project-wide collision avoidance.
 * Reserve all track colors before allocating secondary speakers, including tracks added later. */
export function buildSpeakerColors(
  analyses: RendererSpeechAnalysis[],
  tracks: TrackContent[],
): Map<string, string> {
  const colors = new Map<string, string>()
  const used = new Set(
    [...TRACK_COLORS, ...tracks.map((t) => trackPresentationColor(t.color))].map((c) =>
      c.toLowerCase(),
    ),
  )
  for (const analysis of analyses)
    for (const override of analysis.speakerLabelOverrides) {
      if (override.color) {
        colors.set(speakerKey(analysis, override.speakerId), override.color)
        used.add(override.color.toLowerCase())
      }
    }
  const anchored = new Set<string>()
  for (const analysis of analyses) {
    const track = tracks.find((t) =>
      t.clips.some((c) => c.audioSourceId === analysis.audioSourceId),
    )
    for (const speaker of analysis.speakers) {
      const key = speakerKey(analysis, speaker.id)
      const anchor = track && !anchored.has(track.id)
      if (anchor) anchored.add(track.id)
      if (colors.has(key)) continue
      if (anchor) {
        colors.set(key, trackPresentationColor(track.color))
        continue
      }
      let hash = 2166136261
      for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
      // Keep channels in the readable, softened range used by the editor palette.
      let candidate: string
      do {
        candidate =
          '#' +
          [0, 8, 16]
            .map((shift) => (100 + ((hash >>> shift) % 120)).toString(16).padStart(2, '0'))
            .join('')
        hash = (hash + 0x9e3779b9) >>> 0
      } while (used.has(candidate))
      used.add(candidate)
      colors.set(key, candidate)
    }
  }
  return colors
}

/** Resolve display identity without altering recognition or transcript timing. */
export function linkedSpeakerPresentation(
  catalog: SpeakerIdentityCatalog | undefined,
  analysis: RendererSpeechAnalysis,
  id?: SpeakerId,
) {
  const person = catalog?.people.find(
    (p) =>
      p.binding.audioSourceId === analysis.audioSourceId &&
      p.binding.analysisRevisionId === analysis.analysisRevisionId &&
      p.binding.speakerId === id,
  )
  if (!person) return undefined
  const association = catalog?.associations.find((a) => a.memberPersonIds.includes(person.id))
  const memberColors =
    association?.memberPersonIds.flatMap(
      (member) => catalog?.people.find((p) => p.id === member)?.color ?? [],
    ) ?? []
  return {
    name: association?.displayName ?? person.displayName,
    solidColor: association?.color.mode === 'custom' ? association.color.value : person.color,
    background: association
      ? association.color.mode === 'custom'
        ? association.color.value
        : `linear-gradient(135deg, ${memberColors.join(', ')})`
      : person.color,
    associated: !!association,
  }
}
