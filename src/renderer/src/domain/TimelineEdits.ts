import { linkedMasterForTrack } from './MixLinkEdits'
import type { Clip, Track } from '@shared/ProjectTypes'

const clipEnd = (clip: Clip) => clip.outputStart + clip.sourceEnd - clip.sourceStart
const MINIMUM_CLIP_DURATION = 1 / 48_000

export function trimClip(
  tracks: Track[],
  clipId: string,
  edge: 'start' | 'end',
  outputTime: number,
  sourceDuration: number,
): Track[] | null {
  if (
    !Number.isFinite(outputTime) ||
    !Number.isFinite(sourceDuration) ||
    sourceDuration < MINIMUM_CLIP_DURATION
  )
    return null
  const trackIndex = tracks.findIndex((track) => track.clips.some((clip) => clip.id === clipId))
  if (trackIndex < 0) return null
  const track = tracks[trackIndex]
  if (linkedMasterForTrack(tracks, track.id)) return null
  const clipIndex = track.clips.findIndex((clip) => clip.id === clipId)
  const clip = track.clips[clipIndex]
  const otherClips = track.clips.filter((item) => item.id !== clipId)

  let replacement: Clip
  if (edge === 'start') {
    const sourceLimit = clip.outputStart - clip.sourceStart
    const precedingEnd = Math.max(
      0,
      ...otherClips.filter((item) => clipEnd(item) <= clip.outputStart).map(clipEnd),
    )
    const latestOutputStart = clipEnd(clip) - MINIMUM_CLIP_DURATION
    const earliestOutputStart = Math.max(sourceLimit, precedingEnd)
    if (earliestOutputStart > latestOutputStart) return null
    const nextOutputStart = Math.min(latestOutputStart, Math.max(earliestOutputStart, outputTime))
    const nextSourceStart = clip.sourceStart + nextOutputStart - clip.outputStart
    replacement = { ...clip, sourceStart: nextSourceStart, outputStart: nextOutputStart }
  } else {
    const followingStart = Math.min(
      clip.outputStart + sourceDuration - clip.sourceStart,
      ...otherClips
        .filter((item) => item.outputStart >= clipEnd(clip))
        .map((item) => item.outputStart),
    )
    const earliestOutputEnd = clip.outputStart + MINIMUM_CLIP_DURATION
    if (followingStart < earliestOutputEnd) return null
    const nextOutputEnd = Math.max(earliestOutputEnd, Math.min(followingStart, outputTime))
    replacement = {
      ...clip,
      sourceEnd: clip.sourceStart + nextOutputEnd - clip.outputStart,
    }
  }
  if (
    replacement.sourceStart === clip.sourceStart &&
    replacement.sourceEnd === clip.sourceEnd &&
    replacement.outputStart === clip.outputStart
  )
    return tracks
  const nextTracks = [...tracks]
  nextTracks[trackIndex] = {
    ...track,
    clips: track.clips.map((item) => (item.id === clipId ? replacement : item)),
  }
  return nextTracks
}
