import type { Word, Track } from '@shared/project.types'

/**
 * Describes the relationship between a transcript word and its clip on the timeline.
 *
 *  normal     — the word falls within a retained clip (track audibility is separate).
 *  clip-muted — the word's covering clip has clip.muted=true (pressed 'M' on the
 *               waveform). This is a clip redaction even when word.muted is false.
 *  no-clip    — no clip on the word's track covers word.start. The clip was deleted
 *               (Delete key) or the track was removed. The word produces no audio.
 */
export type WordClipState = 'normal' | 'clip-muted' | 'no-clip'

/**
 * Compute the clip relationship for a single word.
 *
 * Falls back to 'normal' for legacy words that have no trackId, so old projects
 * don't show every word as grayed-out.
 */
export function getWordClipState(word: Word, tracks: Track[]): WordClipState {
  // Legacy words pre-date trackId — assume normal so they remain fully visible.
  if (!word.trackId) return 'normal'

  const track = tracks.find((t) => t.id === word.trackId)
  if (!track) return 'no-clip' // track deleted

  // Find a clip on this track that covers word.start in source-file time.
  const coveringClip = track.clips.find(
    (c) =>
      (!word.audioSourceId || c.audioSourceId === word.audioSourceId) &&
      c.sourceStart <= word.start &&
      word.start < c.sourceEnd,
  )

  if (!coveringClip) return 'no-clip'
  if (coveringClip.muted) return 'clip-muted'
  return 'normal'
}
