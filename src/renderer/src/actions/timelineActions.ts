import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'

export function splitAtPlayhead(): void {
  const player = getAudioPlayerInstance()
  if (player) useTimelineStore.getState().splitAt(player.getCurrentTime())
}

export function muteSelection(): void {
  const { selection, setSelection } = useEditorStore.getState()
  const timeline = useTimelineStore.getState()
  if (timeline.selectedClipId) {
    const clip = timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === timeline.selectedClipId)
    if (clip) timeline.setClipMuted(clip.id, !clip.muted)
    return
  }
  if (!selection) return
  const trackId = timeline.selectedTrackId ?? timeline.tracks[0]?.id
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
  if (timeline.selectedClipId) {
    timeline.removeClip(timeline.selectedClipId)
    return
  }
  const { selection, setSelection } = useEditorStore.getState()
  if (!selection) return
  const trackId = timeline.selectedTrackId ?? timeline.tracks[0]?.id
  if (!trackId) return
  const hits = (timeline.tracks.find((track) => track.id === trackId)?.clips ?? []).some(
    (clip) =>
      clip.outputStart < selection.end &&
      clip.outputStart + clip.sourceEnd - clip.sourceStart > selection.start,
  )
  if (hits) muteSelection()
  else setSelection(null)
}
