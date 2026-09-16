import { afterEach, expect, it, vi } from 'vitest'
import { setAudioPlayerInstance, type IAudioPlayer } from '@shared/player.types'
import type { Track } from '@shared/project.types'
import { attachRedactionPreview, togglePlayback } from './playbackActions'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'

function fixture() {
  const listeners = new Set<(time: number) => void>()
  let time = 0,
    playing = false
  const player = {
    onTimeUpdate: (listener: (time: number) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isPlaying: () => playing,
    getCurrentTime: () => time,
    getDuration: () => 10,
    seekTo: vi.fn((value: number) => {
      time = value
      listeners.forEach((listener) => listener(time))
    }),
    playPause: vi.fn(async () => {
      playing = !playing
    }),
  } as unknown as IAudioPlayer
  const tracks = [
    {
      id: 'a',
      muted: false,
      solo: false,
      clips: [
        { outputStart: 0, sourceStart: 0, sourceEnd: 2, muted: false },
        {
          outputStart: 2,
          sourceStart: 2,
          sourceEnd: 5,
          muted: false,
          redactions: [{ id: 'r', sourceStart: 2, sourceEnd: 5 }],
        },
        { outputStart: 5, sourceStart: 5, sourceEnd: 10, muted: false },
      ],
    },
  ] as Track[]
  useTimelineStore.setState({ tracks })
  useEditorStore.setState({ previewMode: true })
  setAudioPlayerInstance(player)
  return {
    player,
    tracks,
    listeners,
    tick: (value: number) => {
      time = value
      listeners.forEach((listener) => listener(time))
    },
  }
}
afterEach(() => {
  setAudioPlayerInstance(null)
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
})

it('skips while crossing a redaction, but preserves paused inspection and Preview-off playback', async () => {
  const { player, tick } = fixture()
  const stop = attachRedactionPreview(player)
  tick(3)
  expect(player.seekTo).not.toHaveBeenCalled()
  await togglePlayback()
  expect(player.seekTo).toHaveBeenCalledWith(5)
  vi.mocked(player.seekTo).mockClear()
  tick(2.01)
  expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(5)
  useEditorStore.setState({ previewMode: false })
  vi.mocked(player.seekTo).mockClear()
  tick(3)
  expect(player.seekTo).not.toHaveBeenCalled()
  stop()
})

it('follows current clip edits and protects a retained overlapping track at playback start', async () => {
  const { player, tick, tracks } = fixture()
  const stop = attachRedactionPreview(player)
  useTimelineStore.setState({
    tracks: [
      ...tracks,
      {
        id: 'b',
        muted: false,
        solo: false,
        clips: [{ outputStart: 0, sourceStart: 0, sourceEnd: 10, muted: false }],
      } as Track,
    ],
  })
  tick(3)
  await togglePlayback()
  expect(player.seekTo).not.toHaveBeenCalled()
  tick(3.1)
  expect(player.seekTo).not.toHaveBeenCalled()
  useTimelineStore.setState({ tracks })
  tick(3.2)
  expect(player.seekTo).toHaveBeenCalledWith(5)
  stop()
})

it('attaches to replacement players and unsubscribes when their session is released', async () => {
  const first = fixture()
  const stop = attachRedactionPreview(first.player)
  expect(first.listeners.size).toBe(1)
  stop()
  expect(first.listeners.size).toBe(0)
  const next = fixture()
  const stopNext = attachRedactionPreview(next.player)
  await togglePlayback()
  next.tick(2.2)
  expect(next.player.seekTo).toHaveBeenCalledWith(5)
  expect(first.player.seekTo).not.toHaveBeenCalled()
  stopNext()
})
