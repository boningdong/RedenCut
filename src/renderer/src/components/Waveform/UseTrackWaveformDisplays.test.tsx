// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track, AudioSourceId } from '@shared/ProjectTypes'
import type { RendererSession } from '@shared/session.types'
import { useEditorStore } from '../../stores/editor.store'
import { useWaveformDisplayStore } from './WaveformDisplayState'
import { useTrackWaveformDisplays } from './UseTrackWaveformDisplays'
import type { WaveformDataProvider } from './WaveformDataProvider'
const instances: { prepare: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
let finish: (() => void)[] = []
vi.mock('./PreparedWaveformProvider', () => ({
  PreparedWaveformProvider: class {
    prepare = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)))
    dispose = vi.fn().mockResolvedValue(undefined)
    getPeak = vi.fn().mockResolvedValue(0.4)
    constructor() {
      instances.push(this)
    }
  },
}))
const id = 'source' as AudioSourceId
const track = {
  id: 'a',
  name: 'A',
  color: '#fff',
  volume: 1,
  gainDb: 0,
  muted: false,
  solo: false,
  effects: [
    {
      id: 'n',
      type: 'normalize',
      enabled: true,
      params: { targetLufs: -16, truePeakDbtp: -1.5, loudnessRange: 7 },
    },
  ],
  clips: [
    {
      id: 'c',
      trackId: 'a',
      audioSourceId: id,
      sourceStart: 0,
      sourceEnd: 1,
      outputStart: 0,
      gain: 1,
      muted: false,
    },
  ],
} as Track
const session = (token: string) => ({ workspaceToken: token, revision: 0 }) as RendererSession
const providers = new Map<AudioSourceId, WaveformDataProvider>([
  [id, { getPeak: async () => 0.2, readRange: vi.fn() }],
])
beforeEach(() => {
  instances.length = 0
  finish = []
  useEditorStore.setState({ session: session('one') })
  vi.stubGlobal(
    'window',
    Object.assign(window, { electronAPI: { preparedAudio: { waveform: vi.fn() } } }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('locks source scale and reuses processing for Gain, Volume, names and viewport-independent rerenders', async () => {
  const view = renderHook(({ tracks }) => useTrackWaveformDisplays(tracks, providers), {
    initialProps: { tracks: [track] },
  })
  await waitFor(() => expect(instances).toHaveLength(1))
  await act(async () => finish[0]())
  await waitFor(() => expect(view.result.current.get('a')?.peak).toBe(0.4))
  expect(useWaveformDisplayStore.getState().scales.a).toBe(4.25)
  view.rerender({ tracks: [{ ...track, gainDb: -12, volume: 0.1, name: 'renamed' }] })
  expect(instances).toHaveLength(1)
  expect(useWaveformDisplayStore.getState().scales.a).toBe(4.25)
})
it('keeps old waveform while updating and rejects stale completed effects', async () => {
  const view = renderHook(({ tracks }) => useTrackWaveformDisplays(tracks, providers), {
    initialProps: { tracks: [track] },
  })
  await act(async () => finish[0]())
  const old = view.result.current.get('a')?.provider
  const changed = { ...track, clips: [{ ...track.clips[0], sourceEnd: 0.8 }] }
  view.rerender({ tracks: [changed] })
  expect(view.result.current.get('a')?.provider).toBe(old)
  expect(view.result.current.get('a')?.updating).toBe(true)
  view.rerender({ tracks: [{ ...changed, effects: [] }] })
  await act(async () => finish[1]())
  expect(view.result.current.has('a')).toBe(false)
  expect(instances[1].dispose).toHaveBeenCalled()
})
it('releases old project waveforms and fits fresh project independently', async () => {
  const view = renderHook(() => useTrackWaveformDisplays([track], providers))
  await act(async () => finish[0]())
  act(() => useEditorStore.setState({ session: session('two') }))
  expect(instances[0].dispose).toHaveBeenCalled()
  await act(async () => finish[1]())
  await waitFor(() => expect(view.result.current.get('a')?.updating).toBe(false))
})
