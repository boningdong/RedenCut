import type { Track } from '../ProjectTypes'
import type { AudioRenderPlan, AudioContribution } from './AudioRenderPlan'
import {
  quantizedClips,
  frameSkipRanges,
  resolveFrameTransitions,
  toFrame,
} from './RedactionTransitionResolver'
import { createTimelineTimeMap, timelineToOutputFrame } from './TimelineTimeMap'
export function buildAudioRenderPlan(
  tracks: Track[],
  mode: 'timeline' | 'edited' = 'edited',
): AudioRenderPlan {
  const clips = quantizedClips(tracks),
    skips = frameSkipRanges(clips),
    resolutions = resolveFrameTransitions(clips, skips)
  const activeTransitions = resolutions.flatMap((r) =>
    r.status === 'active' ? [r.transition] : [],
  )
  const transitions = mode === 'edited' ? activeTransitions : []
  const duration = tracks
    .flatMap((t) => t.clips)
    .reduce(
      (end, c) =>
        Math.max(end, toFrame(c.outputStart) + toFrame(c.sourceEnd) - toFrame(c.sourceStart)),
      0,
    )
  const editedTimeMap = createTimelineTimeMap(duration, skips, activeTransitions)
  const timeMap = mode === 'edited' ? editedTimeMap : createTimelineTimeMap(duration, [], [])
  const result = tracks.map((track) => {
    const contributions: AudioContribution[] = []
    for (const c of clips.filter((c) => c.track === track && !c.clip.muted)) {
      const wings = transitions
        .filter((t) => t.owner.clipId === c.clip.id)
        .flatMap((t) => [
          {
            start: t.left.sourceStartFrame,
            end: t.left.sourceStartFrame + t.frameCount,
            t,
            direction: 'out' as const,
          },
          {
            start: t.right.sourceStartFrame,
            end: t.right.sourceStartFrame + t.frameCount,
            t,
            direction: 'in' as const,
          },
        ])
        .sort((a, b) => a.start - b.start)
      const add = (start: number, end: number): void => {
        if (end <= start) return
        contributions.push({
          clipId: c.clip.id,
          source: {
            audioSourceId: c.clip.audioSourceId,
            sourceStartFrame: start,
            frameCount: end - start,
          },
          outputStartFrame: timelineToOutputFrame(timeMap, start + c.offset),
          gain: c.clip.gain,
          envelope: { kind: 'constant' },
        })
      }
      for (const r of c.retained) {
        let cursor = r.start
        for (const wing of wings) {
          if (wing.end <= r.start || wing.start >= r.end) continue
          add(cursor, wing.start)
          contributions.push({
            clipId: c.clip.id,
            source: {
              audioSourceId: c.clip.audioSourceId,
              sourceStartFrame: wing.start,
              frameCount: wing.end - wing.start,
            },
            outputStartFrame: wing.t.outputStartFrame,
            gain: c.clip.gain,
            envelope: {
              kind: 'fade',
              direction: wing.direction,
              curve: wing.t.curve,
              startOutputFrame: wing.t.outputStartFrame,
              frameCount: wing.t.frameCount,
            },
          })
          cursor = wing.end
        }
        add(cursor, r.end)
      }
    }
    contributions.sort(
      (a, b) =>
        a.outputStartFrame - b.outputStartFrame ||
        a.source.sourceStartFrame - b.source.sourceStartFrame,
    )
    return { trackId: track.id, volume: track.volume, contributions }
  })
  return {
    sampleRate: 48000,
    durationFrames: timeMap.durationFrames,
    tracks: result,
    timeMap,
    resolutions,
  }
}
