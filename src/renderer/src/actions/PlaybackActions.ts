import { getAudioPlayerInstance, type RenderAudioPlayer } from '@shared/PlayerTypes'
import { usePlaybackStore } from '../stores/PlaybackStore'
import { useEditorStore } from '../stores/editor.store'

export function seekFromTranscript(time: number): void {
  const player = getAudioPlayerInstance()
  if (!player) return
  player.seekTo(time)
  usePlaybackStore.getState().revealTimelineTime(time)
}

/** Mode updates rebuild the engine plan; no UI-time polling or boundary seeks. */
export function attachRedactionPreview(
  player: Pick<RenderAudioPlayer, 'setPlaybackMode'>,
): () => void {
  player.setPlaybackMode(useEditorStore.getState().previewMode ? 'edited' : 'timeline')
  return useEditorStore.subscribe((state, previous) => {
    if (state.previewMode !== previous.previewMode)
      player.setPlaybackMode(state.previewMode ? 'edited' : 'timeline')
  })
}

export async function togglePlayback(): Promise<void> {
  await getAudioPlayerInstance()?.playPause()
}
