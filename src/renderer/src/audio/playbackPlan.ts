import type { AudioSourceId, Track } from '@shared/project.types'

export type PlaybackSegment =
  | { kind: 'silence'; outputFrame: number; frameCount: number }
  | {
      kind: 'samples'
      audioSourceId: AudioSourceId
      sourceFrame: number
      outputFrame: number
      frameCount: number
      gain: number
    }

export function buildTrackPlaybackPlan(
  track: Track,
  startSeconds: number,
  durationSeconds: number,
  sampleRate: number,
  anyTrackSoloed: boolean,
): PlaybackSegment[] {
  const startFrame = Math.max(0, Math.round(startSeconds * sampleRate))
  const endFrame = Math.max(startFrame, Math.round(durationSeconds * sampleRate))
  if (track.muted || (anyTrackSoloed && !track.solo)) {
    return endFrame > startFrame
      ? [{ kind: 'silence', outputFrame: startFrame, frameCount: endFrame - startFrame }]
      : []
  }

  const result: PlaybackSegment[] = []
  let cursor = startFrame
  const clips = [...track.clips]
    .filter((clip) => !clip.muted)
    .sort((a, b) => a.outputStart - b.outputStart)

  for (const clip of clips) {
    const clipOutputStart = Math.round(clip.outputStart * sampleRate)
    const clipFrames = Math.max(0, Math.round((clip.sourceEnd - clip.sourceStart) * sampleRate))
    const clipOutputEnd = clipOutputStart + clipFrames
    if (clipOutputEnd <= startFrame || clipOutputStart >= endFrame) continue

    const outputFrame = Math.max(cursor, clipOutputStart, startFrame)
    if (outputFrame > cursor) {
      result.push({ kind: 'silence', outputFrame: cursor, frameCount: outputFrame - cursor })
    }
    const frameCount = Math.min(clipOutputEnd, endFrame) - outputFrame
    if (frameCount > 0) {
      result.push({
        kind: 'samples',
        audioSourceId: clip.audioSourceId,
        sourceFrame: Math.round(clip.sourceStart * sampleRate) + (outputFrame - clipOutputStart),
        outputFrame,
        frameCount,
        gain: clip.gain,
      })
      cursor = outputFrame + frameCount
    }
  }

  if (cursor < endFrame) {
    result.push({ kind: 'silence', outputFrame: cursor, frameCount: endFrame - cursor })
  }
  return result
}
