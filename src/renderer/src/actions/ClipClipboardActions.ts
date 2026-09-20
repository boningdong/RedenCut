import { linkedMasterForTrack, sliceLinkedClip, synchronizeMixEdits } from '../domain/MixLinkEdits'
import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import type { Clip, Track } from '@shared/ProjectTypes'
import { planClipPlacement } from '../domain/TimelinePlacement'
import { useEditorStore } from '../stores/editor.store'
import { usePlaybackStore } from '../stores/PlaybackStore'
import {
  useTimelineClipboardStore,
  type TimelineClipboardClip,
  type TimelineClipboardContents,
} from '../stores/TimelineClipboardStore'
import { useTimelineStore } from '../stores/TimelineStore'

function cloneClipMetadata(clip: Clip): Clip {
  return {
    ...clip,
    sourceOverrides: clip.sourceOverrides?.map((override) => ({
      ...override,
      stemTrackIds: [...override.stemTrackIds],
    })),
    effects: clip.effects.map((effect) => ({ ...effect, params: { ...effect.params } })),
    redactions: clip.redactions?.map((redaction) => ({
      ...redaction,
      crossfade: redaction.crossfade ? { ...redaction.crossfade } : undefined,
    })),
  }
}

function cloneClipForPaste(clip: Clip, trackId: string): Clip {
  return {
    ...cloneClipMetadata(clip),
    id: crypto.randomUUID(),
    trackId,
    sourceOverrides: clip.sourceOverrides?.map((override) => ({
      ...override,
      id: crypto.randomUUID(),
      stemTrackIds: [...override.stemTrackIds],
    })),
    effects: clip.effects.map((effect) => ({
      ...effect,
      id: crypto.randomUUID(),
      params: { ...effect.params },
    })),
    redactions: clip.redactions?.map((redaction) => ({
      ...redaction,
      crossfade: redaction.crossfade ? { ...redaction.crossfade } : undefined,
      id: crypto.randomUUID(),
    })),
  }
}

function selectedClipboardContents(): TimelineClipboardContents | null {
  const timeline = useTimelineStore.getState()
  const selectedIds = timeline.selectedClipIds.length
    ? timeline.selectedClipIds
    : timeline.selectedClipId
      ? [timeline.selectedClipId]
      : []
  if (!selectedIds.length) return null

  const selected = new Set(selectedIds)
  const located = timeline.tracks.flatMap((track, trackIndex) =>
    track.clips
      .filter((clip) => selected.has(clip.id) && !linkedMasterForTrack(timeline.tracks, track.id))
      .map((clip) => ({ clip, sourceTrackId: track.id, trackIndex })),
  )
  if (!located.length) return null

  const primaryId = selected.has(timeline.selectedClipId ?? '')
    ? timeline.selectedClipId!
    : located[0].clip.id
  const anchor = located.find(({ clip }) => clip.id === primaryId)
  if (!anchor) return null

  const byId = new Map(located.map((item) => [item.clip.id, item]))
  const clips = selectedIds.flatMap<TimelineClipboardClip>((id) => {
    const item = byId.get(id)
    return item
      ? [
          {
            clip: cloneClipMetadata(item.clip),
            sourceTrackId: item.sourceTrackId,
            trackOffset: item.trackIndex - anchor.trackIndex,
            linkedSources: timeline.tracks[item.trackIndex].mixLink
              ? {
                  stemTrackIds: [...timeline.tracks[item.trackIndex].mixLink!.stemTrackIds],
                  hiddenSegments: timeline.tracks[item.trackIndex]
                    .mixLink!.hiddenSegments?.filter(
                      (segment) => segment.masterClipId === item.clip.id,
                    )
                    .map((segment) => ({ ...segment, clip: cloneClipMetadata(segment.clip) })),
                  clips: timeline.tracks
                    .filter((track) =>
                      timeline.tracks[item.trackIndex].mixLink!.stemTrackIds.includes(track.id),
                    )
                    .flatMap((track) =>
                      track.clips.flatMap((child) => {
                        const start = Math.max(child.outputStart, item.clip.outputStart)
                        const end = Math.min(
                          child.outputStart + child.sourceEnd - child.sourceStart,
                          item.clip.outputStart + item.clip.sourceEnd - item.clip.sourceStart,
                        )
                        return end > start ? [sliceLinkedClip(child, start, end)] : []
                      }),
                    ),
                }
              : undefined,
          },
        ]
      : []
  })

  return {
    workspaceToken: useEditorStore.getState().session?.workspaceToken ?? null,
    clips,
    anchorClipId: primaryId,
    sourceAnchorTrackId: anchor.sourceTrackId,
  }
}

function placeClipboardContents(
  contents: TimelineClipboardContents,
  outputStart: number,
  targetTrackId: string,
  insert: boolean,
  label: string,
): boolean {
  const timeline = useTimelineStore.getState()
  const expected = timeline.tracks
  const targetTrackIndex = expected.findIndex((track) => track.id === targetTrackId)
  if (targetTrackIndex < 0) return false

  const clones: Clip[] = []
  const cloneBySourceId = new Map<string, Clip>()
  for (const item of contents.clips) {
    const track = expected[targetTrackIndex + item.trackOffset]
    if (!track || linkedMasterForTrack(expected, track.id)) return false
    if (
      item.linkedSources &&
      (track.id !== item.sourceTrackId ||
        JSON.stringify(track.mixLink?.stemTrackIds) !==
          JSON.stringify(item.linkedSources.stemTrackIds))
    )
      return false
    if (!item.linkedSources && track.mixLink) return false
    const clone = cloneClipForPaste(item.clip, track.id)
    clones.push(clone)
    cloneBySourceId.set(item.clip.id, clone)
  }
  const anchor = cloneBySourceId.get(contents.anchorClipId)
  if (!anchor) return false

  const clonesByTrack = new Map<string, Clip[]>()
  for (const clone of clones) {
    const trackClones = clonesByTrack.get(clone.trackId) ?? []
    trackClones.push(clone)
    clonesByTrack.set(clone.trackId, trackClones)
  }
  const proposed: Track[] = expected.map((track) => ({
    ...track,
    clips: [...track.clips, ...(clonesByTrack.get(track.id) ?? [])],
  }))
  const planned = planClipPlacement(
    proposed,
    clones.map((clip) => clip.id),
    anchor.id,
    outputStart,
    targetTrackId,
    { insert },
  )
  if (!planned) return false

  let next = synchronizeMixEdits(
    expected,
    planned.tracks,
    clones.map((clip) => clip.id),
  )
  for (const item of contents.clips) {
    const pasted = next
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === cloneBySourceId.get(item.clip.id)?.id)!
    const shift = pasted.outputStart - item.clip.outputStart
    if (item.linkedSources?.hiddenSegments?.length)
      next = next.map((track) =>
        track.id === pasted.trackId
          ? {
              ...track,
              mixLink: {
                ...track.mixLink!,
                hiddenSegments: [
                  ...(track.mixLink?.hiddenSegments ?? []),
                  ...item.linkedSources!.hiddenSegments!.map((segment) => ({
                    ...segment,
                    masterClipId: pasted.id,
                    clip: cloneClipForPaste(segment.clip, segment.clip.trackId),
                  })),
                ],
              },
            }
          : track,
      )
    for (const child of item.linkedSources?.clips ?? []) {
      const clone = cloneClipForPaste(child, child.trackId)
      clone.outputStart += shift
      const target = next.find((track) => track.id === child.trackId)!
      if (
        target.clips.some(
          (existing) =>
            existing.outputStart < clone.outputStart + clone.sourceEnd - clone.sourceStart &&
            existing.outputStart + existing.sourceEnd - existing.sourceStart > clone.outputStart,
        )
      )
        return false
      next = next.map((track) =>
        track.id === child.trackId
          ? {
              ...track,
              clips: [...track.clips, clone].sort((a, b) => a.outputStart - b.outputStart),
            }
          : track,
      )
    }
  }
  return timeline.commitTracks(expected, next, label, planned.clipIds, true)
}

export function copyClips(): boolean {
  const contents = selectedClipboardContents()
  if (!contents) return false
  useTimelineClipboardStore.getState().setContents(contents)
  return true
}

export function cutClips(): boolean {
  const contents = selectedClipboardContents()
  if (!contents) return false
  useTimelineClipboardStore.getState().setContents(contents)
  useTimelineStore.getState().removeClips(contents.clips.map(({ clip }) => clip.id))
  useEditorStore.getState().setSelection(null)
  return true
}

export function pasteClips(): boolean {
  const contents = useTimelineClipboardStore.getState().contents
  if (!contents) return false
  const workspaceToken = useEditorStore.getState().session?.workspaceToken ?? null
  if (contents.workspaceToken !== workspaceToken) return false

  const timeline = useTimelineStore.getState()
  const targetTrackId = timeline.tracks.some((track) => track.id === timeline.selectedTrackId)
    ? timeline.selectedTrackId!
    : contents.sourceAnchorTrackId
  const outputStart =
    getAudioPlayerInstance()?.getCurrentTime() ?? usePlaybackStore.getState().currentTime
  return placeClipboardContents(
    contents,
    outputStart,
    targetTrackId,
    timeline.insertMode,
    'Paste clips',
  )
}

export function duplicateClips(): boolean {
  const contents = selectedClipboardContents()
  if (!contents) return false
  const starts = contents.clips.map(({ clip }) => clip.outputStart)
  const ends = contents.clips.map(
    ({ clip }) => clip.outputStart + clip.sourceEnd - clip.sourceStart,
  )
  const selectionStart = Math.min(...starts)
  const selectionEnd = Math.max(...ends)
  const anchor = contents.clips.find(({ clip }) => clip.id === contents.anchorClipId)
  if (!anchor) return false
  const anchorOutputStart = selectionEnd + anchor.clip.outputStart - selectionStart
  return placeClipboardContents(
    contents,
    anchorOutputStart,
    contents.sourceAnchorTrackId,
    true,
    'Duplicate clips',
  )
}
