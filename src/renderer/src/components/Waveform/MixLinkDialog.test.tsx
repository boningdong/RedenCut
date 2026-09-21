// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import { MixLinkDialog } from './MixLinkDialog'

const mix: Track = {
  id: 'mix',
  name: 'Mix',
  color: '#abc',
  muted: false,
  solo: false,
  volume: 1,
  clips: [],
  effects: [],
}
const child: Track = { ...mix, id: 'child', name: 'Microphone' }
afterEach(cleanup)
it('requires timing acknowledgement and applies a draft atomically', () => {
  const apply = vi.fn(() => true)
  render(<MixLinkDialog track={mix} tracks={[mix, child]} onApply={apply} onClose={vi.fn()} />)
  fireEvent.click(screen.getByLabelText('Microphone'))
  expect((screen.getByRole('button', { name: 'Link to Mix' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  fireEvent.click(
    screen.getByLabelText('These recordings are already aligned. Preserve their current timing.'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Link to Mix' }))
  expect(apply).toHaveBeenCalledWith(['child'])
})
it('discards the draft on Escape', () => {
  const close = vi.fn(),
    apply = vi.fn()
  render(<MixLinkDialog track={mix} tracks={[mix, child]} onApply={apply} onClose={close} />)
  fireEvent.click(screen.getByLabelText('Microphone'))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  expect(apply).not.toHaveBeenCalled()
})

it('requires confirmation when detaching an involved source', () => {
  const apply = vi.fn(() => true)
  const linked: Track = {
    ...mix,
    mixLink: { stemTrackIds: [child.id] },
    clips: [
      {
        id: 'clip',
        trackId: mix.id,
        audioSourceId: 'audio' as Track['clips'][number]['audioSourceId'],
        sourceStart: 0,
        sourceEnd: 10,
        outputStart: 0,
        gain: 1,
        muted: false,
        effects: [],
        sourceOverrides: [
          { id: 'override', sourceStart: 1, sourceEnd: 3, stemTrackIds: [child.id] },
        ],
      },
    ],
  }
  render(
    <MixLinkDialog track={linked} tracks={[linked, child]} onApply={apply} onClose={vi.fn()} />,
  )
  fireEvent.click(screen.getByLabelText('Microphone'))
  expect((screen.getByText('Save links') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(
    screen.getByLabelText(
      'Removing a recording restores the entire affected replacement interval to Mix, including other selected recordings in that interval.',
    ),
  )
  fireEvent.click(screen.getByText('Save links'))
  expect(apply).toHaveBeenCalledExactlyOnceWith([])
})

it('limits linking to six and identifies the master', () => {
  const children = Array.from({ length: 7 }, (_, i) => ({
    ...child,
    id: `child-${i}`,
    name: `Mic ${i}`,
  }))
  render(
    <MixLinkDialog track={mix} tracks={[mix, ...children]} onApply={vi.fn()} onClose={vi.fn()} />,
  )
  children.slice(0, 6).forEach((c) => fireEvent.click(screen.getByLabelText(c.name)))
  expect((screen.getByLabelText('Mic 6') as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByText('Master Mix')).toBeTruthy()
})
it('manages existing links without repeating alignment acknowledgment', () => {
  const linked = { ...mix, mixLink: { stemTrackIds: [child.id] } }
  render(
    <MixLinkDialog track={linked} tracks={[linked, child]} onApply={vi.fn()} onClose={vi.fn()} />,
  )
  expect((screen.getByText('Save links') as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByText('Unlink all')).toBeTruthy()
})
