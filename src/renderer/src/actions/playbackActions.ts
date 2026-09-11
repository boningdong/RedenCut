import { getAudioPlayerInstance, type IAudioPlayer } from '@shared/player.types'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'
import { redactionSkipRanges } from '@shared/redactionTimeline'

function previewTarget(
  time: number,
  ranges: ReturnType<typeof redactionSkipRanges>,
): number | undefined {
  return ranges.find((range) => time >= range.start && time < range.end)?.end
}

/** Own this subscription with the player, never with a panel that can mount before it. */
export function attachRedactionPreview(player: IAudioPlayer): () => void {
  let tracks = useTimelineStore.getState().tracks
  let ranges = redactionSkipRanges(tracks)
  let seeking = false
  return player.onTimeUpdate((time) => {
    if (seeking || !player.isPlaying() || !useEditorStore.getState().previewMode) return
    const latest = useTimelineStore.getState().tracks
    if (latest !== tracks) {
      tracks = latest
      ranges = redactionSkipRanges(tracks)
    }
    const target = previewTarget(time, ranges)
    if (target === undefined) return
    seeking = true
    try {
      player.seekTo(Math.min(target, player.getDuration()))
    } finally {
      seeking = false
    }
  })
}

/** Both the transport button and Space share start-inside-redaction behavior. */
export async function togglePlayback(): Promise<void> {
  const player = getAudioPlayerInstance()
  if (!player) return
  if (!player.isPlaying() && useEditorStore.getState().previewMode) {
    const target = previewTarget(
      player.getCurrentTime(),
      redactionSkipRanges(useTimelineStore.getState().tracks),
    )
    if (target !== undefined) player.seekTo(Math.min(target, player.getDuration()))
  }
  await player.playPause()
}
