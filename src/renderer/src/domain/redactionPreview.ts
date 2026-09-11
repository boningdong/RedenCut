import type { Track } from '@shared/project.types'

export interface RedactionRange {
  start: number
  end: number
}

/** Clip.muted is the persisted redaction marker; track.muted is ordinary mix muting. */
export function redactionPreviewRanges(tracks: Track[]): RedactionRange[] {
  const solo = tracks.some((track) => track.solo)
  const events = tracks
    .filter((track) => !track.muted && (!solo || track.solo))
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const end = clip.outputStart + clip.sourceEnd - clip.sourceStart
        if (end <= clip.outputStart) return []
        return [
          { time: clip.outputStart, redacted: clip.muted ? 1 : 0, retained: clip.muted ? 0 : 1 },
          { time: end, redacted: clip.muted ? -1 : 0, retained: clip.muted ? 0 : -1 },
        ]
      }),
    )
    .sort((a, b) => a.time - b.time)
  const ranges: RedactionRange[] = []
  let redacted = 0,
    retained = 0,
    index = 0
  while (index < events.length) {
    const start = events[index].time
    while (index < events.length && events[index].time === start) {
      redacted += events[index].redacted
      retained += events[index++].retained
    }
    if (index === events.length || redacted === 0 || retained > 0) continue
    const end = events[index].time,
      previous = ranges[ranges.length - 1]
    if (previous?.end === start) previous.end = end
    else ranges.push({ start, end })
  }
  return ranges
}
