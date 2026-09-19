import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/TimelineStore'

export function splitAtPlayhead(): void {
  const player = getAudioPlayerInstance()
  const timeline = useTimelineStore.getState()
  if (player && timeline.selectedClipIds.length <= 1) timeline.splitAt(player.getCurrentTime())
}

export function muteSelection(): void {
  const { selection, setSelection } = useEditorStore.getState()
  const timeline = useTimelineStore.getState()
  const selectedClipIds = timeline.selectedClipIds.length
    ? timeline.selectedClipIds
    : timeline.selectedClipId
      ? [timeline.selectedClipId]
      : []
  if (selectedClipIds.length) {
    const clip = timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === (timeline.selectedClipId ?? selectedClipIds[0]))
    if (clip) timeline.setClipsMuted(selectedClipIds, !clip.muted)
    return
  }
  if (!selection?.trackId) return
  const trackId = selection.trackId
  if (!trackId) return
  timeline.redactRange(trackId, selection.start, selection.end)
  setSelection(null)
}

export function deleteSelection(): void {
  const timeline = useTimelineStore.getState()
  if (timeline.timelineSelection?.kind === 'redaction') {
    timeline.removeRedaction(
      timeline.timelineSelection.clipId,
      timeline.timelineSelection.redactionId,
    )
    return
  }
  const selectedClipIds = timeline.selectedClipIds.length
    ? timeline.selectedClipIds
    : timeline.selectedClipId
      ? [timeline.selectedClipId]
      : []
  if (selectedClipIds.length) {
    timeline.removeClips(selectedClipIds)
    useEditorStore.getState().setSelection(null)
    return
  }
  const { selection, setSelection } = useEditorStore.getState()
  if (!selection?.trackId) return
  const trackId = selection.trackId
  if (!trackId) return
  const hits = (timeline.tracks.find((track) => track.id === trackId)?.clips ?? []).some(
    (clip) =>
      clip.outputStart < selection.end &&
      clip.outputStart + clip.sourceEnd - clip.sourceStart > selection.start,
  )
  if (hits) muteSelection()
  else setSelection(null)
}

export function unmuteSelection(): void {
  const timeline = useTimelineStore.getState()
  const selectedClipIds = timeline.selectedClipIds.length
    ? timeline.selectedClipIds
    : timeline.selectedClipId
      ? [timeline.selectedClipId]
      : []
  if (selectedClipIds.length) {
    timeline.setClipsMuted(selectedClipIds, false)
    return
  }

  const { selection, setSelection } = useEditorStore.getState()
  if (!selection?.trackId) return
  const overlappingIds = timeline.tracks
    .filter((track) => track.id === selection.trackId)
    .flatMap((track) => track.clips)
    .filter((clip) => {
      if (!clip.muted) return false
      const outputEnd = clip.outputStart + clip.sourceEnd - clip.sourceStart
      return clip.outputStart < selection.end && outputEnd > selection.start
    })
    .map((clip) => clip.id)
  timeline.setClipsMuted(overlappingIds, false)
  setSelection(null)
}
