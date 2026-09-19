import type { Track } from './ProjectTypes'
import type { RendererSpeechAnalysis } from './speech.types'
import type { SpeakerIdentityCatalog, SpeakerPerson } from './SpeakerIdentityTypes'
import { TRACK_COLORS, trackPresentationColor } from './trackColors'
function completed(analysis: RendererSpeechAnalysis): boolean {
  return (
    analysis.diarizationStatus === 'completed' ||
    (analysis.diarizationStatus === undefined && !!analysis.diarization)
  )
}
export function isPersonEditable(
  person: SpeakerPerson,
  analyses: RendererSpeechAnalysis[],
): boolean {
  return analyses.some(
    (analysis) =>
      completed(analysis) &&
      analysis.audioSourceId === person.binding.audioSourceId &&
      analysis.analysisRevisionId === person.binding.analysisRevisionId &&
      analysis.speakers.some((speaker) => speaker.id === person.binding.speakerId),
  )
}
export function reconcileSpeakerIdentities(
  existing: SpeakerIdentityCatalog | undefined,
  analyses: RendererSpeechAnalysis[],
  tracks: Track[] = [],
): SpeakerIdentityCatalog {
  const people = [...(existing?.people ?? [])]
  const used = new Set(
    [
      ...TRACK_COLORS,
      ...tracks.map((track) => trackPresentationColor(track.color)),
      ...people.map((person) => person.color),
      ...analyses.flatMap((analysis) =>
        analysis.speakerLabelOverrides.flatMap((override) =>
          override.color ? [override.color] : [],
        ),
      ),
    ].map((color) => color.toLowerCase()),
  )
  const anchored = new Set<string>()
  for (const analysis of analyses) {
    if (!completed(analysis)) continue
    const track = tracks.find((track) =>
      track.clips.some((clip) => clip.audioSourceId === analysis.audioSourceId),
    )
    for (const speaker of analysis.speakers) {
      const binding = {
        audioSourceId: analysis.audioSourceId,
        analysisRevisionId: analysis.analysisRevisionId,
        speakerId: speaker.id,
      }
      const anchor = track && !anchored.has(track.id)
      if (anchor) anchored.add(track.id)
      if (
        people.some(
          (person) =>
            person.binding.audioSourceId === binding.audioSourceId &&
            person.binding.analysisRevisionId === binding.analysisRevisionId &&
            person.binding.speakerId === binding.speakerId,
        )
      )
        continue
      const key = `${binding.audioSourceId}:${binding.analysisRevisionId}:${binding.speakerId}`
      const override = analysis.speakerLabelOverrides.find(
        (override) => override.speakerId === speaker.id,
      )
      let color = override?.color ?? (anchor ? trackPresentationColor(track.color) : undefined)
      if (color && /^#[0-9a-fA-F]{3}$/.test(color))
        color =
          '#' +
          color
            .slice(1)
            .split('')
            .map((channel) => channel + channel)
            .join('')
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) color = undefined
      if (!color) {
        let hash = 2166136261
        for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
        do {
          color =
            '#' +
            [0, 8, 16]
              .map((shift) => (100 + ((hash >>> shift) % 120)).toString(16).padStart(2, '0'))
              .join('')
          hash = (hash + 0x9e3779b9) >>> 0
        } while (used.has(color))
      }
      used.add(color.toLowerCase())
      people.push({
        id: `person:${key}`,
        binding,
        displayName: override?.displayName ?? speaker.defaultDisplayName,
        color,
      })
    }
  }
  return { version: 1, people, associations: existing?.associations ?? [] }
}
