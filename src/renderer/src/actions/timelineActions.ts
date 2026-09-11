import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'
import { useTranscriptStore } from '../stores/transcript.store'

export function splitAtPlayhead(): void {
  const player = getAudioPlayerInstance()
  if (player) useTimelineStore.getState().splitAt(player.getCurrentTime())
}

export function muteSelection(): void {
  const { selection, setSelection } = useEditorStore.getState()
  if (!selection) return
  const timeline = useTimelineStore.getState()
  const trackId = timeline.selectedTrackId ?? timeline.tracks[0]?.id
  if (!trackId) return
  timeline.muteRange(trackId, selection.start, selection.end, [
    ...useTranscriptStore.getState().selectedWordIds,
  ])
  setSelection(null)
}

export function deleteSelection(): void {
  const timeline = useTimelineStore.getState()
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
      !clip.muted &&
      clip.outputStart < selection.end &&
      clip.outputStart + clip.sourceEnd - clip.sourceStart > selection.start,
  )
  if (hits) muteSelection()
  else setSelection(null)
}
