import type { Word } from '@shared/ProjectTypes'

/**
 * Merge incoming words for a track into the existing word list.
 * Removes all existing words for `trackId` (or for `audioSourceId` when a word
 * is not track-associated) and inserts the incoming
 * words sorted by start time.
 */
export function mergeTrackWords(
  existing: Word[],
  incoming: Word[],
  trackId: string,
  audioSourceId?: string,
): Word[] {
  return [
    ...existing.filter((w) => {
      // Remove words belonging to this track
      if (w.trackId) return w.trackId !== trackId
      if (audioSourceId) return w.audioSourceId !== audioSourceId
      return true
    }),
    ...incoming,
  ].sort((a, b) => a.start - b.start)
}
