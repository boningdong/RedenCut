import type { Clip, Track } from '@shared/ProjectTypes'

export interface ClipPlacement {
  tracks: Track[]
  clipIds: string[]
  guideTime?: number
}

interface LocatedClip {
  clip: Clip
  trackIndex: number
}

interface Interval {
  start: number
  end: number
}

const duration = (clip: Clip) => clip.sourceEnd - clip.sourceStart
const end = (clip: Clip) => clip.outputStart + duration(clip)

function nearestCandidate(value: number, minimum: number, forbidden: Interval[]): number {
  const requested = Math.max(minimum, value)
  const legal = (candidate: number) =>
    candidate >= minimum &&
    !forbidden.some((range) => candidate > range.start && candidate < range.end)
  if (legal(requested)) return requested
  const candidates = [
    minimum,
    ...forbidden
      .flatMap((range) => [range.start, range.end])
      .filter((candidate) => candidate >= minimum),
  ].filter(legal)
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(nearest - requested) ? candidate : nearest,
  )
}

function nearestSnap(
  requested: number,
  selected: LocatedClip[],
  remaining: Track[],
  threshold: number,
): { outputStart: number; guideTime?: number } {
  let best: { outputStart: number; guideTime: number; distance: number } | undefined
  const seams = remaining.flatMap((track) =>
    track.clips.flatMap((clip) => [clip.outputStart, end(clip)]),
  )
  for (const item of selected) {
    const offset = item.clip.outputStart - selected[0].clip.outputStart
    const relativeEdges = [offset, offset + duration(item.clip)]
    for (const seam of seams)
      for (const relativeEdge of relativeEdges) {
        const outputStart = seam - relativeEdge
        const distance = Math.abs(outputStart - requested)
        if (distance <= threshold && (!best || distance < best.distance))
          best = { outputStart, guideTime: seam, distance }
      }
  }
  return best ?? { outputStart: requested }
}

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((left, right) => left.outputStart - right.outputStart)
}

export function planClipPlacement(
  tracks: Track[],
  ids: string[],
  anchorId: string,
  outputStart: number,
  targetTrackId: string,
  options: { insert: boolean; snapThreshold?: number },
): ClipPlacement | null {
  if (!Number.isFinite(outputStart) || ids.length === 0) return null
  const uniqueIds = [...new Set(ids)]
  const selectedIds = new Set(uniqueIds)
  const located = new Map<string, LocatedClip>()
  tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip) => {
      if (selectedIds.has(clip.id)) located.set(clip.id, { clip, trackIndex })
    })
  })
  if (located.size !== uniqueIds.length || !located.has(anchorId)) return null
  const anchor = located.get(anchorId)!
  const targetIndex = tracks.findIndex((track) => track.id === targetTrackId)
  if (targetIndex < 0) return null
  const selected = uniqueIds.map((id) => located.get(id)!)
  const destinationIndices = new Map<string, number>()
  for (const item of selected) {
    const destinationIndex = targetIndex + item.trackIndex - anchor.trackIndex
    if (destinationIndex < 0 || destinationIndex >= tracks.length) return null
    destinationIndices.set(item.clip.id, destinationIndex)
  }

  const remaining = tracks.map((track) => {
    const clips = track.clips.filter((clip) => !selectedIds.has(clip.id))
    return clips.length === track.clips.length ? track : { ...track, clips }
  })
  const anchorRelative = selected.map((item) => ({
    item,
    offset: item.clip.outputStart - anchor.clip.outputStart,
  }))
  const minimum = Math.max(...anchorRelative.map(({ offset }) => -offset), 0)
  let plannedStart = Math.max(minimum, outputStart)
  let guideTime: number | undefined

  if (options.insert) {
    const affected = new Set(destinationIndices.values())
    const minimumOffset = Math.min(...anchorRelative.map(({ offset }) => offset))
    const requestedGroupStart = outputStart + minimumOffset
    const seams = [
      0,
      ...[...affected].flatMap((index) =>
        remaining[index].clips.flatMap((clip) => [clip.outputStart, end(clip)]),
      ),
    ]
      .filter((seam) => seam - minimumOffset >= minimum)
      .sort(
        (left, right) =>
          Math.abs(left - requestedGroupStart) - Math.abs(right - requestedGroupStart),
      )
    let inserted: Track[] | undefined
    for (const seam of seams) {
      const candidateStart = seam - minimumOffset
      const groupStart = seam
      const groupEnd = Math.max(
        ...anchorRelative.map(({ item, offset }) => candidateStart + offset + duration(item.clip)),
      )
      const span = groupEnd - groupStart
      const candidateTracks = [...remaining]
      for (const destinationIndex of affected) {
        candidateTracks[destinationIndex] = {
          ...candidateTracks[destinationIndex],
          clips: candidateTracks[destinationIndex].clips.map((clip) =>
            clip.outputStart >= groupStart
              ? { ...clip, outputStart: clip.outputStart + span }
              : clip,
          ),
        }
      }
      const valid = anchorRelative.every(({ item, offset }, selectedIndex) => {
        const destinationIndex = destinationIndices.get(item.clip.id)!
        const movedStart = candidateStart + offset
        const movedEnd = movedStart + duration(item.clip)
        const overlapsExisting = candidateTracks[destinationIndex].clips.some(
          (clip) => movedStart < end(clip) && movedEnd > clip.outputStart,
        )
        const overlapsSelected = anchorRelative.some(
          ({ item: other, offset: otherOffset }, index) => {
            if (
              index >= selectedIndex ||
              destinationIndices.get(other.clip.id) !== destinationIndex
            )
              return false
            const otherStart = candidateStart + otherOffset
            return movedStart < otherStart + duration(other.clip) && movedEnd > otherStart
          },
        )
        return !overlapsExisting && !overlapsSelected
      })
      if (valid) {
        plannedStart = candidateStart
        guideTime = seam
        inserted = candidateTracks
        break
      }
    }
    if (!inserted) return null
    remaining.splice(0, remaining.length, ...inserted)
  } else {
    if (options.snapThreshold !== undefined && options.snapThreshold >= 0) {
      const snapped = nearestSnap(
        plannedStart,
        [anchor, ...selected.filter((item) => item.clip.id !== anchorId)],
        remaining,
        options.snapThreshold,
      )
      plannedStart = Math.max(minimum, snapped.outputStart)
      guideTime = snapped.guideTime
    }
    const forbidden: Interval[] = []
    for (const { item, offset } of anchorRelative) {
      const destinationIndex = destinationIndices.get(item.clip.id)!
      for (const other of remaining[destinationIndex].clips)
        forbidden.push({
          start: other.outputStart - offset - duration(item.clip),
          end: end(other) - offset,
        })
    }
    const resolved = nearestCandidate(plannedStart, minimum, forbidden)
    if (resolved !== plannedStart) guideTime = undefined
    plannedStart = resolved
  }

  const nextTracks = [...remaining]
  for (const { item, offset } of anchorRelative) {
    const destinationIndex = destinationIndices.get(item.clip.id)!
    const moved = {
      ...item.clip,
      trackId: tracks[destinationIndex].id,
      outputStart: plannedStart + offset,
    }
    nextTracks[destinationIndex] = {
      ...nextTracks[destinationIndex],
      clips: sortClips([...nextTracks[destinationIndex].clips, moved]),
    }
  }
  return {
    tracks: nextTracks,
    clipIds: uniqueIds,
    ...(guideTime === undefined ? {} : { guideTime }),
  }
}
