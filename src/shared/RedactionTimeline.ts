import type { Track } from './ProjectTypes'
import { clipRedactionRanges, clipRetainedRanges } from './ClipRedactions'

export interface RedactionRange {
  start: number
  end: number
}

/** Only overlays contract time; ordinary mute never creates a deletion interval. */
export function redactionSkipRanges(tracks: Track[]): RedactionRange[] {
  const solo = tracks.some((track) => track.solo)
  const events = tracks
    .filter((track) => !track.muted && (!solo || track.solo))
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        const offset = clip.outputStart - clip.sourceStart
        return [
          ...clipRedactionRanges(clip).flatMap((r) => [
            { time: r.start + offset, redacted: 1, retained: 0 },
            { time: r.end + offset, redacted: -1, retained: 0 },
          ]),
          ...clipRetainedRanges(clip).flatMap((r) => [
            { time: r.start + offset, redacted: 0, retained: 1 },
            { time: r.end + offset, redacted: 0, retained: -1 },
          ]),
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
