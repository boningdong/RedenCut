// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { MixClipWaveform } from './MixClipWaveform'
vi.mock('./CanvasWaveform', () => ({ CanvasWaveform: () => <div /> }))
afterEach(cleanup)
function setup(count: number, scale = 40, fractional = false) {
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
        stemTrackIds: ['s0', 's1'],
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
