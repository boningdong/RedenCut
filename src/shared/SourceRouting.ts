import type { AudioSourceId, Clip, Track } from './ProjectTypes'

type RoutingTrack = Pick<Track, 'id' | 'clips' | 'mixLink'>
export interface ResolvedSourceSpan {
  trackId: string
  clipId: string
  audioSourceId: AudioSourceId
  sourceStart: number
  sourceEnd: number
  masterSourceStart: number
  masterSourceEnd: number
}
const frame = (seconds: number): number => Math.round(seconds * 48000)

function getLinkedStemTrackIds(tracks: readonly RoutingTrack[]): Set<string> {
  return new Set(tracks.flatMap((track) => track.mixLink?.stemTrackIds ?? []))
}
export function getIndependentTracks<T extends RoutingTrack>(tracks: readonly T[]): T[] {
  const linked = getLinkedStemTrackIds(tracks)
  return tracks.filter((track) => !linked.has(track.id))
}

/** Resolve in original timeline coordinates, before redaction/crossfade contraction.
 * Child controls and redactions intentionally do not participate in raw-source routing.
 */
export function resolveSourceSpans(
  tracks: readonly RoutingTrack[],
  masterClip: Clip,
  sourceStart: number,
  sourceEnd: number,
): ResolvedSourceSpan[] {
  const start = frame(sourceStart),
    end = frame(sourceEnd)
  if (end <= start) return []
  const master = tracks.find((track) => track.id === masterClip.trackId)
  const overrides = (masterClip.sourceOverrides ?? []).filter(
    (range) => frame(range.sourceStart) < end && frame(range.sourceEnd) > start,
  )
  const boundaries = [
    ...new Set([
      start,
      end,
      ...overrides.flatMap((range) => [
        Math.max(start, frame(range.sourceStart)),
        Math.min(end, frame(range.sourceEnd)),
      ]),
    ]),
  ].sort((a, b) => a - b)
  const spans: ResolvedSourceSpan[] = []
  const offset = frame(masterClip.outputStart) - frame(masterClip.sourceStart)
  for (let index = 0; index < boundaries.length - 1; index++) {
    const a = boundaries[index],
      b = boundaries[index + 1]
    const matching = overrides.filter(
      (range) => frame(range.sourceStart) <= a && frame(range.sourceEnd) >= b,
    )
    if (matching.length > 1) throw new Error('Overlapping source override coverage')
    const override = matching[0]
    if (!override) {
      spans.push({
        trackId: masterClip.trackId,
        clipId: masterClip.id,
        audioSourceId: masterClip.audioSourceId,
        sourceStart: a / 48000,
        sourceEnd: b / 48000,
        masterSourceStart: a / 48000,
        masterSourceEnd: b / 48000,
      })
      continue
    }
    if (
      !override.stemTrackIds.length ||
      new Set(override.stemTrackIds).size !== override.stemTrackIds.length
    )
      throw new Error('Source coverage requires a nonempty unique source selection')
    for (const trackId of override.stemTrackIds) {
      const child = tracks.find((track) => track.id === trackId)
      if (!child || !master?.mixLink?.stemTrackIds.includes(trackId))
        throw new Error(`Source coverage references an unlinked track: ${trackId}`)
      const candidates = child.clips
        .map((clip) => ({
          clip,
          start: frame(clip.outputStart) - offset,
          end: frame(clip.outputStart) - offset + frame(clip.sourceEnd) - frame(clip.sourceStart),
        }))
        .filter((clip) => clip.start < b && clip.end > a)
      const childBoundaries = [
        ...new Set([
          a,
          b,
          ...candidates.flatMap((clip) => [Math.max(a, clip.start), Math.min(b, clip.end)]),
        ]),
      ].sort((x, y) => x - y)
      for (let part = 0; part < childBoundaries.length - 1; part++) {
        const left = childBoundaries[part],
          right = childBoundaries[part + 1]
        const covering = candidates.filter(
          (candidate) => candidate.start <= left && candidate.end >= right,
        )
        if (covering.length !== 1)
          throw new Error(
            `Source coverage ${covering.length ? 'overlaps' : 'has a gap'} on track ${trackId} at ${(left + offset) / 48000}s`,
          )
        const candidate = covering[0]
        const childStart = frame(candidate.clip.sourceStart) + left - candidate.start
        spans.push({
          trackId,
          clipId: candidate.clip.id,
          audioSourceId: candidate.clip.audioSourceId,
          sourceStart: childStart / 48000,
          sourceEnd: (childStart + right - left) / 48000,
          masterSourceStart: left / 48000,
          masterSourceEnd: right / 48000,
        })
      }
    }
  }
  return spans
}
