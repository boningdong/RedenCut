// @vitest-environment jsdom

import React from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererAudioSource } from '@shared/session.types'
import { useTimelineStore } from '../../stores/timeline.store'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { WaveformView } from './WaveformView'

const canvasSpy = vi.fn()
vi.mock('./CanvasWaveform', () => ({
  CanvasWaveform: (props: { provider: WaveformDataProvider }) => {
    canvasSpy(props.provider)
    return <div data-testid="waveform" />
  },
}))

const source: RendererAudioSource = {
  id: '00000000-0000-4000-8000-000000000001' as RendererAudioSource['id'],
  displayName: 'shared.mp3',
  metadata: {
    durationSeconds: 10,
    sampleRate: 48_000,
    channels: 2,
    codec: 'mp3',
    bitrateKbps: 192,
  },
  cache: {
    audioSourceId: '00000000-0000-4000-8000-000000000001' as RendererAudioSource['id'],
    sampleRate: 48_000,
    channels: 2,
    frameCount: 480_000,
    waveformLevels: [],
  },
}

describe('WaveformView managed providers', () => {
  beforeEach(() => {
    canvasSpy.mockClear()
    useTimelineStore.getState().reset()
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    })
  })

  it('reuses the provider selected by each clip audioSourceId', () => {
    const clip = {
      id: 'clip-1',
      trackId: 'track-1',
      audioSourceId: source.id,
      sourceStart: 0,
      sourceEnd: 5,
      outputStart: 0,
      gain: 1,
      muted: false,
      effects: [],
    }
    useTimelineStore.getState().loadFromProject(
      [source],
      [
        {
          id: 'track-1',
          name: 'One',
          clips: [clip],
          volume: 1,
          muted: false,
          solo: false,
          color: '#f00',
          effects: [],
        },
        {
          id: 'track-2',
          name: 'Two',
          clips: [{ ...clip, id: 'clip-2', trackId: 'track-2' }],
          volume: 1,
          muted: false,
          solo: false,
          color: '#0f0',
          effects: [],
        },
      ],
    )
    const provider: WaveformDataProvider = { readRange: vi.fn(async () => ({ buckets: [] })) }
    render(
      <WaveformView
        duration={10}
        providersBySource={new Map([[source.id, provider]])}
        onAddTrack={vi.fn()}
      />,
    )
    expect(canvasSpy).toHaveBeenCalledTimes(2)
    expect(canvasSpy.mock.calls.every(([actual]) => actual === provider)).toBe(true)
  })
})
