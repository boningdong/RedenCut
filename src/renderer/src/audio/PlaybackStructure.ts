import type { Track } from '@shared/ProjectTypes'

/** Immutable clip arrays make volume updates independent of clip/redaction count. */
export function hasSamePlaybackStructure(previous: Track[], next: Track[]): boolean {
  return (
    previous === next ||
    (previous.length === next.length &&
      previous.every((track, index) => {
        const candidate = next[index]
        return (
          track.id === candidate.id &&
          track.muted === candidate.muted &&
          track.solo === candidate.solo &&
          track.clips === candidate.clips
        )
      }))
  )
}
