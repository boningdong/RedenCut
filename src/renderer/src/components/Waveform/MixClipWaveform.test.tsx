// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { MixClipWaveform } from './MixClipWaveform'
vi.mock('./CanvasWaveform', () => ({
  CanvasWaveform: (props: {
    sourceStartSeconds: number
    amplitudeScale?: number
    gain?: number
  }) => (
    <div
      data-canvas-start={props.sourceStartSeconds}
      data-canvas-scale={props.amplitudeScale}
      data-canvas-gain={props.gain}
    />
  ),
}))
afterEach(cleanup)
function setup(
  count: number,
  scale = 40,
  fractional = false,
  selectedCount = 2,
  displayProvider?: WaveformDataProvider,
) {
  const clip: Track['clips'][number] = {
    id: 'clip',
    trackId: 'mix',
    audioSourceId: 'audio' as Track['clips'][number]['audioSourceId'],
    sourceStart: 10,
    sourceEnd: 20,
    outputStart: 5,
    gain: 1,
    muted: false,
    effects: [],
    sourceOverrides: [
      {
        id: 'replace',
        sourceStart: fractional ? 11.123459 : 11,
        sourceEnd: fractional ? 13.987651 : 13,
        stemTrackIds: Array.from({ length: selectedCount }, (_, i) => 's' + i),
      },
    ],
  }
  const master: Track = {
    id: 'mix',
    name: 'Mix',
    color: '#aaa',
    clips: [clip],
    muted: false,
    solo: false,
    volume: 1,
    effects: [],
    mixLink: { stemTrackIds: Array.from({ length: count }, (_, i) => 's' + i) },
  }
  const tracks = [
    master,
    ...master.mixLink!.stemTrackIds.map((id) => ({
      ...master,
      id,
      name: id,
      mixLink: undefined,
      clips: [{ ...clip, id: id + '-clip', trackId: id, sourceOverrides: undefined }],
    })),
  ]
  const onEdit = vi.fn()
  const view = render(
    <MixClipWaveform
      clip={clip}
      displayProvider={displayProvider}
      waveformScale={1.7}
      waveformGain={2}
      tracks={tracks}
      providers={new Map([[clip.audioSourceId, {} as WaveformDataProvider]])}
      pxPerSec={scale}
      viewport={{ scrollLeft: 0, width: 1000 }}
      onEdit={onEdit}
    />,
  )
  return { ...view, onEdit }
}
it('opens the exact output bounds without bubbling into clip actions', () => {
  const { onEdit } = setup(3)
  fireEvent.click(screen.getByRole('button', { name: /Sources: s0/ }))
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(6, 8)
})
it('keeps two selected sources layered even with six linked tracks', () => {
  const { container } = setup(6)
  expect(container.querySelector('[data-mix-presentation="layered"]')).not.toBeNull()
  expect(screen.getByText('2 sources')).toBeTruthy()
})
it('keeps small groups layered with names when space allows', () => {
  const { container } = setup(3, 200)
  expect(container.querySelector('[data-mix-presentation="layered"]')).not.toBeNull()
  expect(screen.getByText('s0')).toBeTruthy()
  expect(screen.getByText('s1')).toBeTruthy()
})

it('keeps fractional replacement boundaries on separate parallel rows', () => {
  const { container } = setup(3, 40, true)
  const rows = container.querySelectorAll('[data-source-override="replace"]')
  expect(rows).toHaveLength(2)
  expect((rows[0] as HTMLElement).style.top).not.toBe((rows[1] as HTMLElement).style.top)
})

it.each([1, 3, 6])('fills available replacement height with %i real source rows', (count) => {
  const { container } = setup(count, 40, false, count)
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>('[data-source-override="replace"]'),
  )
  expect(rows).toHaveLength(count)
  for (const row of rows) {
    expect(parseFloat(row.style.height.slice(5))).toBeCloseTo(100 / count, 3)
    expect(row.style.height).toContain('px)')
  }
  expect(new Set(rows.map((row) => row.style.top)).size).toBe(count)
  expect(container.querySelector('svg')).toBeNull()
})

it('draws the processed composite in output coordinates while preserving six source overlays', () => {
  const provider = {} as WaveformDataProvider
  const { container } = setup(6, 40, false, 6, provider)
  const waveform = container.querySelector('[data-processed-waveform] [data-canvas-start]')!
  expect(waveform.getAttribute('data-canvas-start')).toBe('5')
  expect(waveform.getAttribute('data-canvas-scale')).toBe('1.7')
  expect(waveform.getAttribute('data-canvas-gain')).toBe('2')
  expect(container.querySelectorAll('[data-canvas-start]')).toHaveLength(1)
  expect(container.querySelectorAll('[data-source-override="replace"]')).toHaveLength(6)
})
