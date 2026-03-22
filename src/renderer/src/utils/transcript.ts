import type { Word } from '@shared/project.types'

/**
 * Merge incoming words for a track into the existing word list.
 * Removes all existing words for `trackId` (or for `legacySourceFileId` if
 * the existing words pre-date the trackId field) and inserts the incoming
 * words sorted by start time.
 */
export function mergeTrackWords(
  existing:            Word[],
  incoming:            Word[],
  trackId:             string,
  legacySourceFileId?: string,
): Word[] {
  return [
    ...existing.filter((w) => {
      // Remove words belonging to this track
      if (w.trackId) return w.trackId !== trackId
      // Legacy words (no trackId): remove by sourceFileId if provided
      if (legacySourceFileId) return w.sourceFileId !== legacySourceFileId
      return true
    }),
    ...incoming,
  ].sort((a, b) => a.start - b.start)
}
