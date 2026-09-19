import type { Word, Track } from '@shared/ProjectTypes'

/**
 * Returns the output-timeline position (seconds) at which this word will be heard.
 *
 * Formula: clip.outputStart + (word.start − clip.sourceStart)
 *
 * Falls back to word.start for legacy words with no trackId (they are assumed
 * to be positioned at their source-file timestamp).
 */
export function getWordOutputTime(word: Word, tracks: Track[]): number {
  if (!word.trackId) return word.start // legacy fallback

  const track = tracks.find((t) => t.id === word.trackId)
  if (!track) return word.start

  const clip = track.clips.find(
    (c) =>
      (!word.audioSourceId || c.audioSourceId === word.audioSourceId) &&
      c.sourceStart <= word.start &&
      word.start < c.sourceEnd,
  )
  if (!clip) return word.start

  return clip.outputStart + (word.start - clip.sourceStart)
}
