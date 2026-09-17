import { getAudioPlayerInstance } from '@shared/player.types'
import type { Clip, Track } from '@shared/project.types'
import { planClipPlacement } from '../domain/TimelinePlacement'
import { useEditorStore } from '../stores/editor.store'
import { usePlaybackStore } from '../stores/playback.store'
import {
  useTimelineClipboardStore,
  type TimelineClipboardClip,
  type TimelineClipboardContents,
} from '../stores/TimelineClipboardStore'
import { useTimelineStore } from '../stores/timeline.store'

function cloneClipMetadata(clip: Clip): Clip {
  return {
    ...clip,
    effects: clip.effects.map((effect) => ({ ...effect, params: { ...effect.params } })),
    redactions: clip.redactions?.map((redaction) => ({ ...redaction })),
  }
}

function cloneClipForPaste(clip: Clip, trackId: string): Clip {
  return {
    ...cloneClipMetadata(clip),
    id: crypto.randomUUID(),
    trackId,
    effects: clip.effects.map((effect) => ({
      ...effect,
      id: crypto.randomUUID(),
      params: { ...effect.params },
    })),
    redactions: clip.redactions?.map((redaction) => ({
      ...redaction,
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
      .filter((clip) => selected.has(clip.id))
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
    if (!track) return false
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

  return timeline.commitTracks(expected, planned.tracks, label, planned.clipIds)
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
