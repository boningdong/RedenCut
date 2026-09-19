import type { ResolvedCrossfade } from './CrossfadeTypes'
import type { FrameRange } from './RedactionTransitionResolver'
interface TimelineMapSegment {
  timelineStartFrame: number
  timelineEndFrame: number
  outputStartFrame: number
  kind: 'normal' | 'deleted' | 'wing'
}
interface OutputMapSegment {
  outputStartFrame: number
  frameCount: number
  timelineStartFrames: number[]
}
export interface TimelineTimeMap {
  timelineDurationFrames: number
  durationFrames: number
  timelineSegments: TimelineMapSegment[]
  outputSegments: OutputMapSegment[]
}
function floorIndex<T>(list: T[], frame: number, start: (value: T) => number): number {
  let lo = 0,
    hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (start(list[mid]) <= frame) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}
export function timelineToOutputFrame(map: TimelineTimeMap, frame: number): number {
  const f = Math.max(0, Math.min(map.timelineDurationFrames, Math.round(frame)))
  if (f === map.timelineDurationFrames) return map.durationFrames
  const s = map.timelineSegments[floorIndex(map.timelineSegments, f, (s) => s.timelineStartFrame)]
  return s ? s.outputStartFrame + (s.kind === 'deleted' ? 0 : f - s.timelineStartFrame) : 0
}
export function outputToTimelinePositions(map: TimelineTimeMap, frame: number): number[] {
  const f = Math.max(0, Math.min(map.durationFrames, Math.round(frame)))
  if (f === map.durationFrames) return [map.timelineDurationFrames]
  const s = map.outputSegments[floorIndex(map.outputSegments, f, (s) => s.outputStartFrame)]
  return s ? s.timelineStartFrames.map((start) => start + f - s.outputStartFrame) : [0]
}
export function outputToTimelineFrame(map: TimelineTimeMap, frame: number): number {
  const normalizedFrame = Math.max(0, Math.min(map.durationFrames, Math.round(frame)))
  const positions = outputToTimelinePositions(map, normalizedFrame)
  if (positions.length < 2) return positions[0]
  const s =
    map.outputSegments[floorIndex(map.outputSegments, normalizedFrame, (s) => s.outputStartFrame)]
  return positions[normalizedFrame - s.outputStartFrame < s.frameCount / 2 ? 0 : 1]
}
export function createTimelineTimeMap(
  duration: number,
  skips: FrameRange[],
  transitions: ResolvedCrossfade[],
): TimelineTimeMap {
  const timelineSegments: TimelineMapSegment[] = [],
    outputSegments: OutputMapSegment[] = []
  const operations: { start: number; end: number; transition?: ResolvedCrossfade }[] = [
    ...transitions.map((t) => ({
      start: t.leftTimelineStartFrame,
      end: t.rightTimelineStartFrame + t.frameCount,
      transition: t,
    })),
  ]
  for (const skip of skips) {
    let start = skip.start
    for (const t of transitions) {
      const a = t.leftTimelineStartFrame,
        b = t.rightTimelineStartFrame + t.frameCount
      if (b <= start || a >= skip.end) continue
      if (a > start) operations.push({ start, end: a })
      start = Math.max(start, b)
    }
    if (start < skip.end) operations.push({ start, end: skip.end })
  }
  operations.sort((a, b) => a.start - b.start)
  let timeline = 0,
    output = 0
  const ordinary = (end: number): void => {
    if (end <= timeline) return
    timelineSegments.push({
      timelineStartFrame: timeline,
      timelineEndFrame: end,
      outputStartFrame: output,
      kind: 'normal',
    })
    outputSegments.push({
      outputStartFrame: output,
      frameCount: end - timeline,
      timelineStartFrames: [timeline],
    })
    output += end - timeline
    timeline = end
  }
  for (const op of operations) {
    ordinary(op.start)
    const t = op.transition
    if (t) {
      t.outputStartFrame = output
      timelineSegments.push(
        {
          timelineStartFrame: op.start,
          timelineEndFrame: op.start + t.frameCount,
          outputStartFrame: output,
          kind: 'wing',
        },
        {
          timelineStartFrame: op.start + t.frameCount,
          timelineEndFrame: t.rightTimelineStartFrame,
          outputStartFrame: output,
          kind: 'deleted',
        },
        {
          timelineStartFrame: t.rightTimelineStartFrame,
          timelineEndFrame: op.end,
          outputStartFrame: output,
          kind: 'wing',
        },
      )
      outputSegments.push({
        outputStartFrame: output,
        frameCount: t.frameCount,
        timelineStartFrames: [op.start, t.rightTimelineStartFrame],
      })
      output += t.frameCount
    } else
      timelineSegments.push({
        timelineStartFrame: op.start,
        timelineEndFrame: op.end,
        outputStartFrame: output,
        kind: 'deleted',
      })
    timeline = op.end
  }
  ordinary(duration)
  return {
    timelineDurationFrames: duration,
    durationFrames: output,
    timelineSegments,
    outputSegments,
  }
}
