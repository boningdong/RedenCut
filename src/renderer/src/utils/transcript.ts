import type { Word } from '@shared/project.types'

/**
 * Merges a new set of words for a specific source file into the existing flat
 * word array. All existing words for `sourceFileId` are replaced by `incoming`.
 * Words with `sourceFileId === undefined` are never removed (legacy compatibility).
 * Result is sorted by `word.start`.
 *
 * Precondition: all existing words that should be kept already have `sourceFileId` set.
 */
export function mergeTrackWords(
  existing: Word[],
  incoming: Word[],
  sourceFileId: string,
): Word[] {
  return [
    ...existing.filter((w) => w.sourceFileId !== sourceFileId),
    ...incoming,
  ].sort((a, b) => a.start - b.start)
}
