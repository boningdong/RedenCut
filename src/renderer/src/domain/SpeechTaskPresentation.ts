import type { Track } from '@shared/project.types'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import type { SpeechBatchScope } from '@shared/speechBatch.types'
import type { AudioSourceId } from '@shared/source.types'
import type { SpeechSourceState } from '@shared/SpeechTaskPlanner'

export function speechSourceStates(
  tracks: Track[],
  analyses: RendererSpeechAnalysis[],
  scope: SpeechBatchScope,
): SpeechSourceState[] {
  const selected = tracks.filter((track) => scope.kind === 'all' || track.id === scope.trackId)
  const ids = [
    ...new Set(selected.flatMap((track) => track.clips.map((clip) => clip.audioSourceId))),
  ]
  return ids.map((audioSourceId) => {
    const analysis = analyses.find((item) => item.audioSourceId === audioSourceId)
    return {
      audioSourceId,
      text: !!analysis,
      speakers: !!analysis?.diarization || analysis?.diarizationStatus === 'completed',
    }
  })
}

/** Include other occurrences of shared sources: analysis is source-scoped, not track-scoped. */
export function speechTargetTracks(tracks: Track[], sourceIds: AudioSourceId[]) {
  return tracks.flatMap((track, index) =>
    track.clips.some((clip) => sourceIds.includes(clip.audioSourceId))
      ? [{ id: track.id, label: `T${index + 1}`, name: track.name }]
      : [],
  )
}
