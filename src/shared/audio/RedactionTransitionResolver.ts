import { getIndependentTracks } from '../SourceRouting'
import type { Track, Clip, ClipRedaction } from '../ProjectTypes'
import type { CrossfadeResolution } from './CrossfadeTypes'
const SAMPLE_RATE = 48000
export const toFrame = (seconds: number): number => Math.round(seconds * SAMPLE_RATE)
export interface FrameRange {
  start: number
  end: number
}
interface Group extends FrameRange {
  members: ClipRedaction[]
}
export interface FrameClip {
  clip: Clip
  track: Track
  start: number
  end: number
  offset: number
  groups: Group[]
  retained: FrameRange[]
}
export function quantizedClips(tracks: Track[]): FrameClip[] {
  tracks = getIndependentTracks(tracks)
  const solo = tracks.some((t) => t.solo)
  return tracks
    .filter((t) => !t.muted && (!solo || t.solo))
    .flatMap((track) =>
      track.clips.map((clip) => {
        const start = toFrame(clip.sourceStart),
          end = toFrame(clip.sourceEnd),
          offset = toFrame(clip.outputStart) - start
        const groups: Group[] = []
        const sorted = [...(clip.redactions ?? [])].sort(
          (a, b) =>
            a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd || a.id.localeCompare(b.id),
        )
        for (const r of sorted) {
          const a = Math.max(start, toFrame(r.sourceStart)),
            b = Math.min(end, toFrame(r.sourceEnd))
          if (b <= a) continue
          const last = groups[groups.length - 1]
          if (last && a <= last.end) {
            last.end = Math.max(last.end, b)
            last.members.push(r)
          } else groups.push({ start: a, end: b, members: [r] })
        }
        const retained: FrameRange[] = []
        let cursor = start
        for (const g of groups) {
          if (g.start > cursor) retained.push({ start: cursor, end: g.start })
          cursor = g.end
        }
        if (cursor < end) retained.push({ start: cursor, end })
        return { clip, track, start, end, offset, groups, retained }
      }),
    )
}
/** Same retained-overlap eligibility as RedactionTimeline, after boundary quantization. Muted clips still protect content. */
export function frameSkipRanges(clips: FrameClip[]): FrameRange[] {
  const events = clips
    .flatMap((c) => [
      ...c.groups.flatMap((r) => [
        { at: r.start + c.offset, d: 1, k: 0 },
        { at: r.end + c.offset, d: -1, k: 0 },
      ]),
      ...c.retained.flatMap((r) => [
        { at: r.start + c.offset, d: 0, k: 1 },
        { at: r.end + c.offset, d: 0, k: -1 },
      ]),
    ])
    .sort((a, b) => a.at - b.at)
  const ranges: FrameRange[] = []
  let i = 0,
    d = 0,
    k = 0
  while (i < events.length) {
    const start = events[i].at
    while (i < events.length && events[i].at === start) {
      d += events[i].d
      k += events[i++].k
    }
    if (i === events.length || d <= 0 || k > 0) continue
    const end = events[i].at,
      last = ranges[ranges.length - 1]
    if (last?.end === start) last.end = end
    else ranges.push({ start, end })
  }
  return ranges
}
export function resolveFrameTransitions(
  clips: FrameClip[],
  skips: FrameRange[],
): CrossfadeResolution[] {
  const candidates = clips
    .flatMap((c) => c.groups.map((g, index) => ({ c, g, index })))
    .sort(
      (a, b) =>
        a.g.start + a.c.offset - (b.g.start + b.c.offset) ||
        a.c.track.id.localeCompare(b.c.track.id) ||
        a.c.clip.id.localeCompare(b.c.clip.id) ||
        a.g.members[0].id.localeCompare(b.g.members[0].id),
    )
  const used = new Map<FrameClip, Map<number, number>>()
  return candidates.map(({ c, g, index }) => {
    const owner = { clipId: c.clip.id, redactionIds: g.members.map((r) => r.id) }
    const inactive = (
      reason: Extract<CrossfadeResolution, { status: 'inactive' }>['reason'],
    ): CrossfadeResolution => ({ owner, status: 'inactive', reason })
    if (g.members.some((r) => !r.crossfade?.enabled)) return inactive('disabled')
    if (c.clip.muted || g.start === c.start || g.end === c.end) return inactive('no-join')
    if (!skips.some((r) => r.start <= g.start + c.offset && r.end >= g.end + c.offset))
      return inactive('protected-track-content')
    const requested = Math.round(Math.min(...g.members.map((r) => r.crossfade!.durationMs)) * 48)
    const leftLength = g.start - (c.groups[index - 1]?.end ?? c.start),
      rightLength = (c.groups[index + 1]?.start ?? c.end) - g.end
    const natural = Math.min(requested, leftLength, rightLength)
    const occupied = used.get(c) ?? new Map<number, number>()
    used.set(c, occupied)
    const n = Math.min(
      natural,
      leftLength - (occupied.get(index) ?? 0),
      rightLength - (occupied.get(index + 1) ?? 0),
    )
    if (n < 2) return inactive('insufficient-content')
    const windowStart = g.start + c.offset - n,
      windowEnd = g.end + c.offset + n
    if (
      clips.some(
        (other) =>
          other !== c &&
          other.retained.some(
            (r) => r.start + other.offset < windowEnd && r.end + other.offset > windowStart,
          ),
      )
    )
      return inactive('protected-track-content')
    occupied.set(index, (occupied.get(index) ?? 0) + n)
    occupied.set(index + 1, (occupied.get(index + 1) ?? 0) + n)
    return {
      owner,
      status: 'active',
      ...(n < natural
        ? { limitedBy: 'neighbor-transition' as const }
        : natural < requested
          ? { limitedBy: 'short-content' as const }
          : {}),
      transition: {
        owner,
        left: { audioSourceId: c.clip.audioSourceId, sourceStartFrame: g.start - n, frameCount: n },
        right: { audioSourceId: c.clip.audioSourceId, sourceStartFrame: g.end, frameCount: n },
        leftTimelineStartFrame: windowStart,
        rightTimelineStartFrame: g.end + c.offset,
        outputStartFrame: 0,
        frameCount: n,
        curve: g.members[0].crossfade!.curve,
      },
    }
  })
}
export function resolveRedactionTransitions(tracks: Track[]): CrossfadeResolution[] {
  const clips = quantizedClips(tracks),
    skips = frameSkipRanges(clips),
    resolutions = resolveFrameTransitions(clips, skips)
  let extra = 0
  for (const r of resolutions) {
    if (r.status !== 'active') continue
    const t = r.transition
    t.outputStartFrame =
      t.leftTimelineStartFrame -
      skips.reduce(
        (sum, s) => sum + Math.max(0, Math.min(t.leftTimelineStartFrame, s.end) - s.start),
        0,
      ) -
      extra
    extra += t.frameCount
  }
  return resolutions
}
