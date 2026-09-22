import * as renderPlans from '@shared/audio/AudioRenderPlanBuilder'
import { expect, it, vi } from 'vitest'
import type { Track, AudioSourceId } from '@shared/ProjectTypes'
import { PlaybackTimelineAdapter } from './PlaybackTimelineAdapter'
import type { RenderAudioPlayer } from '@shared/PlayerTypes'
const tracks: Track[] = [
  {
    id: 't',
    name: 'Voice',
    color: '#a393ee',
    effects: [],
    volume: 1,
    muted: false,
    solo: false,
    clips: [
      {
        id: 'c',
        trackId: 't',
        effects: [],
        audioSourceId: 's' as AudioSourceId,
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
]
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

it('updates volume on an hour-long track without rebuilding its time map or notifying duration', () => {
  const { raw, player } = fixture()
  const hour = tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, sourceEnd: 3600 })) }))
  player.setTracks(hour)
  const build = vi.spyOn(renderPlans, 'buildAudioRenderPlan')
  const duration = vi.fn()
  player.onDurationChange(duration)
  for (let i = 0; i < 100; i++) player.setTracks(hour.map((t) => ({ ...t, volume: i / 100 })))
  expect(build).not.toHaveBeenCalled()
  expect(duration).not.toHaveBeenCalled()
  expect(raw.setTracks).toHaveBeenLastCalledWith([{ ...hour[0], volume: 0.99 }])
  expect(player.getDuration()).toBe(3600)
  build.mockRestore()
})
