import type { Word, TrackContent } from '@shared/ProjectTypes'
import { redactionCoverage } from '@shared/ClipRedactions'

/**
 * Describes the relationship between a transcript word and its clip on the timeline.
 *
 *  normal     — the word falls within a retained clip (track audibility is separate).
 *  clip-muted — the word's covering clip has clip.muted=true (pressed 'M' on the
 *               waveform). Ordinary mute preserves duration.
 *  no-clip    — no clip on the word's track covers word.start. The clip was deleted
 *               (Delete key) or the track was removed. The word produces no audio.
 */
export type WordClipState = 'normal' | 'clip-muted' | 'no-clip' | 'redacted' | 'partially-redacted'

/**
 * Compute the clip relationship for a single word.
 *
 * Falls back to 'normal' for legacy words that have no trackId, so old projects
 * don't show every word as grayed-out.
 */
export function getWordClipState(word: Word, tracks: TrackContent[]): WordClipState {
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
  const coverage = redactionCoverage(coveringClip, word.start, word.end)
  if (coverage === 'full') return 'redacted'
  if (coveringClip.muted) return 'clip-muted'
  if (coverage === 'partial') return 'partially-redacted'
  return 'normal'
}
