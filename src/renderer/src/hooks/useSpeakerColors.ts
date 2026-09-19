import { useMemo } from 'react'
import { useTimelineStore } from '../stores/TimelineStore'
import { useTranscriptStore } from '../stores/transcript.store'
import { useEditorStore } from '../stores/editor.store'
import { buildSpeakerColors, linkedSpeakerPresentation } from '../domain/speakerPresentation'

export function useSpeakerColors() {
  const analyses = useTranscriptStore((s) => s.analyses)
  const tracks = useTimelineStore((s) => s.tracks)
  const catalog = useEditorStore((s) => s.session?.speakerIdentities)
  return useMemo(() => {
    const colors = buildSpeakerColors(analyses, tracks)
    for (const analysis of analyses)
      for (const speaker of analysis.speakers) {
        const display = linkedSpeakerPresentation(catalog, analysis, speaker.id)
        if (display)
          colors.set(
            `${analysis.audioSourceId}:${analysis.analysisRevisionId}:${speaker.id}`,
            display.solidColor,
          )
      }
    return colors
  }, [analyses, tracks, catalog])
}
