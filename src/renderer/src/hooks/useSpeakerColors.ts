import { useMemo } from 'react'
import { useTimelineStore } from '../stores/timeline.store'
import { useTranscriptStore } from '../stores/transcript.store'
import { buildSpeakerColors } from '../domain/speakerPresentation'

export function useSpeakerColors() {
  const analyses = useTranscriptStore((s) => s.analyses)
  const tracks = useTimelineStore((s) => s.tracks)
  return useMemo(() => buildSpeakerColors(analyses, tracks), [analyses, tracks])
}
