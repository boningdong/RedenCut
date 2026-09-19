import { afterEach, expect, it, vi } from 'vitest'
import { setAudioPlayerInstance, type IAudioPlayer } from '@shared/PlayerTypes'
import { attachRedactionPreview, togglePlayback } from './PlaybackActions'
import { useEditorStore } from '../stores/editor.store'

afterEach(() => {
  setAudioPlayerInstance(null)
  useEditorStore.getState().reset()
})

it('sets explicit preview modes without installing a UI-time boundary seek loop', () => {
  useEditorStore.setState({ previewMode: true })
  const player = { setPlaybackMode: vi.fn() }
  const stop = attachRedactionPreview(player)
  expect(player.setPlaybackMode).toHaveBeenLastCalledWith('edited')
  useEditorStore.setState({ previewMode: false })
  expect(player.setPlaybackMode).toHaveBeenLastCalledWith('timeline')
  useEditorStore.setState({ previewMode: true })
  expect(player.setPlaybackMode).toHaveBeenLastCalledWith('edited')
  stop()
  player.setPlaybackMode.mockClear()
  useEditorStore.setState({ previewMode: false })
  expect(player.setPlaybackMode).not.toHaveBeenCalled()
})
it('routes play/pause to the timeline adapter without boundary seeks', async () => {
  const player = { playPause: vi.fn(async () => {}), seekTo: vi.fn() } as unknown as IAudioPlayer
  setAudioPlayerInstance(player)
  await togglePlayback()
  expect(player.playPause).toHaveBeenCalledOnce()
  expect(player.seekTo).not.toHaveBeenCalled()
})
