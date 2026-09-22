// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import type { CanvasWaveformProps } from './CanvasWaveform'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { LinkedClipWaveform } from './LinkedClipWaveform'
const waveform = vi.fn()
vi.mock('./CanvasWaveform', () => ({
  CanvasWaveform: (props: CanvasWaveformProps) => {
    waveform(props)
    return null
  },
}))
afterEach(() => {
  cleanup()
  waveform.mockClear()
})
it('fits compact waveform and highlights only supplied Mix intervals despite child mute', () => {
  const clip = {
    id: 'c',
    trackId: 'child',
    audioSourceId: 'audio' as Track['clips'][number]['audioSourceId'],
    sourceStart: 0,
    sourceEnd: 10,
    outputStart: 0,
    gain: 1,
    muted: true,
    effects: [],
  }
  const child: Track = {
    id: 'child',
    name: 'Mic',
    color: '#aaa',
    clips: [clip],
    effects: [],
    muted: true,
    solo: false,
    volume: 1,
  }
  const mix: Track = {
    ...child,
    id: 'mix',
    mixLink: { stemTrackIds: ['child'] },
    clips: [
      {
        ...clip,
        id: 'm',
        trackId: 'mix',
        sourceOverrides: [{ id: 'o', sourceStart: 2, sourceEnd: 5, stemTrackIds: ['child'] }],
      },
    ],
  }
  const { container } = render(
    <LinkedClipWaveform
      clip={clip}
      track={child}
      tracks={[mix, child]}
      provider={{} as WaveformDataProvider}
      pxPerSec={10}
      viewport={{ scrollLeft: 0, width: 100 }}
    />,
  )
  expect(
    [...container.querySelectorAll('[data-source-enabled]')].map((node) =>
      node.getAttribute('data-source-enabled'),
    ),
  ).toEqual(['false', 'true', 'false'])
  expect(
    waveform.mock.calls.map(([props]) => [props.sourceStartSeconds, props.sourceEndSeconds]),
  ).toEqual([
    [0, 2],
    [2, 5],
    [5, 10],
  ])
  expect(
    waveform.mock.calls.every(
      ([props]) =>
        props.heightPx === undefined && props.topPx === undefined && props.muted === false,
    ),
  ).toBe(true)
})
