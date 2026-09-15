import type { Track } from '../../shared/project.types'
import type { SpeechBatchScope } from '../../shared/speechBatch.types'
import type { AudioSourceId } from '../../shared/source.types'

/** Capture complete source identities from the requested timeline scope, in display order. */
export function planSpeechSources(
  scope: SpeechBatchScope,
  tracks: readonly Track[],
): AudioSourceId[] {
  const selected =
    scope.kind === 'all' ? tracks : tracks.filter((track) => track.id === scope.trackId)
  if (scope.kind === 'track' && selected.length === 0) throw new Error('Unknown speech batch track')
  return [...new Set(selected.flatMap((track) => track.clips.map((clip) => clip.audioSourceId)))]
}
