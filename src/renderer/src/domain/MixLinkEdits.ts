import type { Clip, Track } from '@shared/ProjectTypes'

const end = (clip: Clip) => clip.outputStart + clip.sourceEnd - clip.sourceStart
export const linkedMasterForTrack = (tracks: Track[], trackId: string) =>
  tracks.find((track) => track.mixLink?.stemTrackIds.includes(trackId))
export const isLinkedClip = (tracks: Track[], clipId: string) =>
  tracks.some(
    (track) =>
      linkedMasterForTrack(tracks, track.id) && track.clips.some((clip) => clip.id === clipId),
  )

export function changeMixLink(
  tracks: Track[],
  mixTrackId: string,
  stemTrackIds: string[],
): Track[] | null {
  const master = tracks.find((track) => track.id === mixTrackId)
  if (
    !master ||
    linkedMasterForTrack(tracks, mixTrackId) ||
    new Set(stemTrackIds).size !== stemTrackIds.length
  )
    return null
  if (
    stemTrackIds.some(
      (id) =>
        id === mixTrackId ||
        !tracks.some((track) => track.id === id) ||
        tracks.find((track) => track.id === id)?.mixLink ||
        (linkedMasterForTrack(tracks, id)?.id ?? mixTrackId) !== mixTrackId,
    )
  )
    return null
  const detached = new Set(master.mixLink?.stemTrackIds.filter((id) => !stemTrackIds.includes(id)))
  return tracks.map((track) =>
    track.id === mixTrackId
      ? {
          ...track,
          mixLink: stemTrackIds.length
            ? {
                stemTrackIds: [...stemTrackIds],
                hiddenSegments: track.mixLink?.hiddenSegments?.filter(
                  (segment) => !detached.has(segment.clip.trackId),
                ),
              }
            : undefined,
          clips: track.clips.map((clip) => ({
            ...clip,
            sourceOverrides: clip.sourceOverrides?.filter(
              (override) => !override.stemTrackIds.some((id) => detached.has(id)),
            ),
          })),
        }
      : detached.has(track.id)
        ? { ...track, muted: true, solo: false }
        : track,
  )
}

function covers(clips: Clip[], start: number, finish: number): boolean {
  const spans = clips
    .map((clip) => ({ start: Math.max(start, clip.outputStart), end: Math.min(finish, end(clip)) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start)
  let cursor = start
  for (const span of spans) {
    if (Math.abs(span.start - cursor) > 1e-8) return false
    cursor = span.end
  }
  return Math.abs(cursor - finish) < 1e-8
}

export function changeMixSources(
  tracks: Track[],
  mixTrackId: string,
  start: number,
  finish: number,
  stemTrackIds?: string[],
): Track[] | null {
  const master = tracks.find((track) => track.id === mixTrackId)
  if (!master?.mixLink || !Number.isFinite(start) || !Number.isFinite(finish) || finish <= start)
    return null
  const affected = master.clips.filter((clip) => clip.outputStart < finish && end(clip) > start)
  if (!affected.length) return null
  if (
    stemTrackIds &&
    (!stemTrackIds.length ||
      new Set(stemTrackIds).size !== stemTrackIds.length ||
      stemTrackIds.some(
        (id) =>
          !master.mixLink!.stemTrackIds.includes(id) ||
          affected.some(
            (clip) =>
              !covers(
                tracks.find((track) => track.id === id)!.clips,
                Math.max(start, clip.outputStart),
                Math.min(finish, end(clip)),
              ),
          ),
      ))
  )
    return null
  return tracks.map((track) =>
    track !== master
      ? track
      : {
          ...track,
          clips: track.clips.map((clip) => {
            if (!affected.includes(clip)) return clip
            const sourceStart =
              clip.sourceStart + Math.max(start, clip.outputStart) - clip.outputStart
            const sourceEnd = clip.sourceStart + Math.min(finish, end(clip)) - clip.outputStart
            const sourceOverrides = (clip.sourceOverrides ?? []).flatMap((override) => {
              if (override.sourceStart >= sourceEnd || override.sourceEnd <= sourceStart)
                return [override]
              return [
                ...(override.sourceStart < sourceStart
                  ? [
                      {
                        ...override,
                        id: crypto.randomUUID(),
                        sourceEnd: sourceStart,
                        stemTrackIds: [...override.stemTrackIds],
                      },
                    ]
                  : []),
                ...(override.sourceEnd > sourceEnd
                  ? [
                      {
                        ...override,
                        id: crypto.randomUUID(),
                        sourceStart: sourceEnd,
                        stemTrackIds: [...override.stemTrackIds],
                      },
                    ]
                  : []),
              ]
            })
            if (stemTrackIds)
              sourceOverrides.push({
                id: crypto.randomUUID(),
                sourceStart,
                sourceEnd,
                stemTrackIds: [...stemTrackIds],
              })
            return {
              ...clip,
              sourceOverrides: sourceOverrides.sort((a, b) => a.sourceStart - b.sourceStart),
            }
          }),
        },
  )
}

/** Slice timing while retaining hidden overlays; explicit splits receive independent identities. */
export function sliceLinkedClip(
  clip: Clip,
  start: number,
  finish: number,
  outputStart = start,
  independent = false,
): Clip {
  return {
    ...clip,
    id: independent ? crypto.randomUUID() : clip.id,
    sourceStart: clip.sourceStart + start - clip.outputStart,
    sourceEnd: clip.sourceStart + finish - clip.outputStart,
    outputStart,
    effects: clip.effects.map((effect) => ({
      ...effect,
      params: { ...effect.params },
      ...(independent ? { id: crypto.randomUUID() } : {}),
    })),
    redactions: clip.redactions?.map((redaction) => ({
      ...redaction,
      id: independent ? crypto.randomUUID() : redaction.id,
      crossfade: redaction.crossfade ? { ...redaction.crossfade } : undefined,
    })),
    sourceOverrides: clip.sourceOverrides?.map((override) => ({
      ...override,
      id: independent ? crypto.randomUUID() : override.id,
      stemTrackIds: [...override.stemTrackIds],
    })),
  }
}

type HiddenSegment = NonNullable<NonNullable<Track['mixLink']>['hiddenSegments']>[number]

function sourceSegments(master: Track, original: Clip, stem: Track): HiddenSegment[] {
  const segments = (master.mixLink?.hiddenSegments ?? [])
    .filter((segment) => segment.masterClipId === original.id && segment.clip.trackId === stem.id)
    .map((segment) => ({
      ...segment,
      clip: sliceLinkedClip(segment.clip, segment.clip.outputStart, end(segment.clip)),
    }))
  for (const child of stem.clips) {
    const start = Math.max(child.outputStart, original.outputStart)
    const finish = Math.min(end(child), end(original))
    if (finish > start)
      segments.push({
        masterClipId: original.id,
        masterSourceStart: original.sourceStart + start - original.outputStart,
        clip: sliceLinkedClip(child, start, finish),
      })
  }
  segments.sort((a, b) => a.masterSourceStart - b.masterSourceStart)
  // Rejoin fragments from one source occurrence after revealing a previously hidden edge.
  const merged: HiddenSegment[] = []
  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.clip.id === segment.clip.id &&
      previous.clip.audioSourceId === segment.clip.audioSourceId &&
      Math.abs(previous.clip.sourceEnd - segment.clip.sourceStart) < 1e-8 &&
      Math.abs(
        previous.masterSourceStart +
          previous.clip.sourceEnd -
          previous.clip.sourceStart -
          segment.masterSourceStart,
      ) < 1e-8
    )
      previous.clip.sourceEnd = segment.clip.sourceEnd
    else merged.push(segment)
  }
  return merged
}

/** Derive child timing from pre-edit occurrences and persisted hidden source fragments. */
export function synchronizeMixEdits(
  before: Track[],
  next: Track[],
  copiedClipIds: string[] = [],
): Track[] {
  let result = next
  for (const master of before.filter((track) => track.mixLink)) {
    const updated = next.find((track) => track.id === master.id)
    if (
      !updated?.mixLink ||
      JSON.stringify(master.clips.map((c) => [c.id, c.sourceStart, c.sourceEnd, c.outputStart])) ===
        JSON.stringify(updated.clips.map((c) => [c.id, c.sourceStart, c.sourceEnd, c.outputStart]))
    )
      continue
    const mappings = updated.clips
      .filter((clip) => !copiedClipIds.includes(clip.id))
      .map((clip) => ({
        clip,
        original:
          master.clips.find((old) => old.id === clip.id) ??
          master.clips.find(
            (old) =>
              old.audioSourceId === clip.audioSourceId &&
              old.sourceStart <= clip.sourceStart &&
              old.sourceEnd >= clip.sourceEnd &&
              Math.abs(old.outputStart + clip.sourceStart - old.sourceStart - clip.outputStart) <
                1e-8,
          ),
      }))
    const hiddenSegments: HiddenSegment[] = []
    for (const stemId of updated.mixLink.stemTrackIds) {
      const stem = before.find((track) => track.id === stemId)
      if (!stem) continue
      const clips: Clip[] = []
      const occurrenceOwners = new Map<string, string>()
      const occurrenceIds = new Map<string, string>()
      for (const child of stem.clips) {
        let outside = [{ start: child.outputStart, end: end(child) }]
        for (const original of master.clips)
          outside = outside.flatMap((span) =>
            end(original) <= span.start || original.outputStart >= span.end
              ? [span]
              : [
                  ...(span.start < original.outputStart
                    ? [{ start: span.start, end: original.outputStart }]
                    : []),
                  ...(span.end > end(original) ? [{ start: end(original), end: span.end }] : []),
                ],
          )
        for (const span of outside)
          clips.push(
            sliceLinkedClip(
              child,
              span.start,
              span.end,
              span.start,
              span.start !== child.outputStart || span.end !== end(child),
            ),
          )
      }
      for (const { clip, original } of mappings) {
        if (!original) continue
        const siblings = mappings
          .filter((mapping) => mapping.original?.id === original.id)
          .map((mapping) => mapping.clip)
          .sort((a, b) => a.sourceStart - b.sourceStart)
        const isSplit =
          !siblings.some((sibling) => sibling.id === original.id) && siblings.length > 1
        const lower = isSplit && clip !== siblings[0] ? clip.sourceStart : -Infinity
        const upper = isSplit && clip !== siblings[siblings.length - 1] ? clip.sourceEnd : Infinity
        for (const segment of sourceSegments(master, original, stem)) {
          const start = Math.max(lower, segment.masterSourceStart)
          const finish = Math.min(
            upper,
            segment.masterSourceStart + segment.clip.sourceEnd - segment.clip.sourceStart,
          )
          if (finish <= start) continue
          const piece = sliceLinkedClip(
            segment.clip,
            segment.clip.outputStart + start - segment.masterSourceStart,
            segment.clip.outputStart + finish - segment.masterSourceStart,
            Math.max(0, clip.outputStart + start - clip.sourceStart),
            isSplit,
          )
          // A pre-edited master may divide a single child occurrence across several owners.
          // Keep visible/hidden fragments of one owner together, but give each owner its own ID.
          const occurrenceKey = JSON.stringify([clip.id, piece.id])
          let occurrenceId = occurrenceIds.get(occurrenceKey)
          if (!occurrenceId) {
            occurrenceId =
              occurrenceOwners.has(piece.id) && occurrenceOwners.get(piece.id) !== clip.id
                ? crypto.randomUUID()
                : piece.id
            occurrenceIds.set(occurrenceKey, occurrenceId)
            occurrenceOwners.set(piece.id, clip.id)
          }
          piece.id = occurrenceId
          if (isSplit)
            piece.redactions = piece.redactions?.flatMap((redaction) => {
              const sourceStart =
                lower > segment.masterSourceStart
                  ? Math.max(redaction.sourceStart, piece.sourceStart)
                  : redaction.sourceStart
              const sourceEnd =
                upper <
                segment.masterSourceStart + segment.clip.sourceEnd - segment.clip.sourceStart
                  ? Math.min(redaction.sourceEnd, piece.sourceEnd)
                  : redaction.sourceEnd
              return sourceEnd > sourceStart ? [{ ...redaction, sourceStart, sourceEnd }] : []
            })
          const fragment = (from: number, to: number): Clip =>
            sliceLinkedClip(
              piece,
              piece.outputStart + from - start,
              piece.outputStart + to - start,
              Math.max(0, clip.outputStart + from - clip.sourceStart),
            )
          const visibleStart = Math.max(start, clip.sourceStart),
            visibleEnd = Math.min(finish, clip.sourceEnd)
          if (visibleEnd > visibleStart) clips.push(fragment(visibleStart, visibleEnd))
          if (start < clip.sourceStart)
            hiddenSegments.push({
              masterClipId: clip.id,
              masterSourceStart: start,
              clip: fragment(start, Math.min(finish, clip.sourceStart)),
            })
          if (finish > clip.sourceEnd)
            hiddenSegments.push({
              masterClipId: clip.id,
              masterSourceStart: Math.max(start, clip.sourceEnd),
              clip: fragment(Math.max(start, clip.sourceEnd), finish),
            })
        }
      }
      result = result.map((track) =>
        track.id === stemId
          ? { ...track, clips: clips.sort((a, b) => a.outputStart - b.outputStart) }
          : track,
      )
    }
    result = result.map((track) =>
      track.id === master.id
        ? { ...track, mixLink: { ...updated.mixLink!, hiddenSegments } }
        : track,
    )
  }
  return result
}
