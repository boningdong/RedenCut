import type { RendererSpeechAnalysis, SpeakerId } from '@shared/speech.types'
import type { Track } from '@shared/project.types'
import { TRACK_COLORS, trackPresentationColor } from '@shared/trackColors'

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
  tracks: Track[],
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
