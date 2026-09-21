import type { Track } from '@shared/ProjectTypes'

/** Compare every audible interval, including original Mix between overrides. */
export function getMixRangeState(
  track: Track,
  start: number,
  end: number,
): {
  kind: 'original' | 'uniform' | 'mixed'
  ids: string[]
  hasReplacement: boolean
} {
  const spans = track.clips
    .flatMap((clip) =>
      (clip.sourceOverrides ?? []).flatMap((override) => {
        const left = Math.max(
          start,
          clip.outputStart,
          clip.outputStart + override.sourceStart - clip.sourceStart,
        )
        const right = Math.min(
          end,
          clip.outputStart + clip.sourceEnd - clip.sourceStart,
          clip.outputStart + override.sourceEnd - clip.sourceStart,
        )
        return right > left
          ? [{ start: left, end: right, ids: [...override.stemTrackIds].sort() }]
          : []
      }),
    )
    .sort((a, b) => a.start - b.start)
  if (!spans.length) return { kind: 'original', ids: [], hasReplacement: false }
  const ids = spans[0].ids
  let cursor = start
  for (const span of spans) {
    if (Math.abs(span.start - cursor) > 1e-8 || span.ids.join('\0') !== ids.join('\0'))
      return { kind: 'mixed', ids: [], hasReplacement: true }
    cursor = span.end
  }
  return Math.abs(cursor - end) < 1e-8
    ? { kind: 'uniform', ids, hasReplacement: true }
    : { kind: 'mixed', ids: [], hasReplacement: true }
}
