import { expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import { PlaybackTimelineAdapter } from './PlaybackTimelineAdapter'
import type { RenderAudioPlayer } from '@shared/PlayerTypes'
const tracks = [
  {
    id: 't',
    volume: 1,
    muted: false,
    solo: false,
    clips: [
      {
        id: 'c',
        audioSourceId: 's',
        sourceStart: 0,
        sourceEnd: 2,
        outputStart: 0,
        gain: 1,
        muted: false,
        redactions: [
          {
            id: 'r',
            sourceStart: 0.8,
            sourceEnd: 1.04,
            crossfade: { enabled: true, durationMs: 30, curve: 'linear' },
          },
        ],
      },
    ],
  },
] as Track[]
function fixture() {
  let time = 0
  const callbacks = new Set<(n: number) => void>()
  const raw = {
    getCurrentTime: () => time,
    getDuration: () => 2,
    setTracks: vi.fn(),
    setPlaybackMode: vi.fn(),
    seekTo: vi.fn((n: number) => {
      time = n
      callbacks.forEach((c) => c(n))
    }),
    onTimeUpdate: (c: (n: number) => void) => {
      callbacks.add(c)
      return () => callbacks.delete(c)
    },
    onDurationChange: () => () => {},
    destroy: vi.fn(async () => {}),
    isPlaying: () => false,
  } as unknown as RenderAudioPlayer
  return { raw, player: new PlaybackTimelineAdapter(raw) }
}
it('converts UI timeline seeks to edited output and keeps edit layout duration', () => {
  const { raw, player } = fixture()
  player.setTracks(tracks)
  player.setPlaybackMode('edited')
  player.seekTo(1.5)
  expect(raw.seekTo).toHaveBeenLastCalledWith(1.23)
  expect(player.getCurrentTime()).toBe(1.5)
  expect(player.getDuration()).toBe(2)
  expect(player.getOutputDuration()).toBe(1.73)
})
it('preserves timeline location across mode changes and avoids seek on volume-only changes', () => {
  const { raw, player } = fixture()
  player.setTracks(tracks)
  player.seekTo(1.5)
  player.setPlaybackMode('edited')
  expect(raw.seekTo).toHaveBeenLastCalledWith(1.23)
  player.setPlaybackMode('timeline')
  expect(raw.seekTo).toHaveBeenLastCalledWith(1.5)
  vi.mocked(raw.seekTo).mockClear()
  player.setTracks(tracks.map((t) => ({ ...t, volume: 0.5 })))
  expect(raw.seekTo).not.toHaveBeenCalled()
})
it('maps time notifications and releases the raw subscriptions', async () => {
  const { raw, player } = fixture()
  player.setTracks(tracks)
  player.setPlaybackMode('edited')
  const update = vi.fn()
  const stop = player.onTimeUpdate(update)
  raw.seekTo(1.23)
  expect(update).toHaveBeenLastCalledWith(1.5)
  stop()
  update.mockClear()
  raw.seekTo(1.24)
  expect(update).not.toHaveBeenCalled()
  await player.destroy()
  expect(raw.destroy).toHaveBeenCalledOnce()
})
