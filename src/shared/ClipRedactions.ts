import type { Clip } from './ProjectTypes'

export interface SourceInterval {
  start: number
  end: number
}

/** Effective source coverage, without changing independently editable overlay identities. */
export function clipRedactionRanges(clip: Clip): SourceInterval[] {
  const ranges = (clip.redactions ?? [])
    .map((r) => ({
      start: Math.max(clip.sourceStart, r.sourceStart),
      end: Math.min(clip.sourceEnd, r.sourceEnd),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start)
  const merged: SourceInterval[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

export function clipRetainedRanges(clip: Clip): SourceInterval[] {
  const retained: SourceInterval[] = []
  let start = clip.sourceStart
  for (const range of clipRedactionRanges(clip)) {
    if (range.start > start) retained.push({ start, end: range.start })
    start = range.end
  }
  if (start < clip.sourceEnd) retained.push({ start, end: clip.sourceEnd })
  return retained
}

export function redactionCoverage(
  clip: Clip,
  start: number,
  end: number,
): 'none' | 'partial' | 'full' {
  if (end <= start) return 'none'
  const covered = clipRedactionRanges(clip).reduce(
    (sum, range) => sum + Math.max(0, Math.min(end, range.end) - Math.max(start, range.start)),
    0,
  )
  return covered <= 0 ? 'none' : covered >= end - start - 1e-9 ? 'full' : 'partial'
}
