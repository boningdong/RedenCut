// @vitest-environment jsdom
import React, { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import { SourceOverridePopover } from './SourceOverridePopover'
vi.mock('./UseAnchoredPopover', () => ({ useAnchoredPopover: () => ({ left: 100, top: 50 }) }))
const base: Track = {
  id: 'mix',
  name: 'Mix',
  color: '#aaa',
  clips: [],
  effects: [],
  muted: false,
  solo: false,
  volume: 1,
}
const tracks = [
  { ...base, mixLink: { stemTrackIds: ['a', 'b'] } },
  { ...base, id: 'a', name: 'Alice' },
  { ...base, id: 'b', name: 'Bob' },
]
afterEach(cleanup)
function setup(track: Track = tracks[0], start = 1, end = 3) {
  const apply = vi.fn(() => true),
    close = vi.fn(),
    restore = vi.fn(() => true)
  const anchor = createRef<HTMLButtonElement>()
  render(
    <>
      <button ref={anchor}>Anchor</button>
      <SourceOverridePopover
        anchor={anchor}
        track={track}
        tracks={tracks}
        start={start}
        end={end}
        duration={10}
        onRangeChange={vi.fn()}
        onApply={apply}
        onClose={close}
        onRestore={restore}
      />
    </>,
  )
  return { apply, close, restore }
}
it('applies multiple choices only after explicit Apply', () => {
  const { apply, close } = setup()
  fireEvent.click(screen.getByLabelText('Alice'))
  fireEvent.click(screen.getByLabelText('Bob'))
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Apply replacement'))
  expect(apply).toHaveBeenCalledExactlyOnceWith(['a', 'b'], 1, 3)
  expect(close).toHaveBeenCalledOnce()
})
it.each(['cancel', 'escape', 'outside'])('discards draft on %s', (method) => {
  const { apply, close } = setup()
  fireEvent.click(screen.getByLabelText('Alice'))
  if (method === 'cancel') fireEvent.click(screen.getByText('Cancel'))
  if (method === 'escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  if (method === 'outside') fireEvent.pointerDown(document.body)
  expect(close).toHaveBeenCalledOnce()
  expect(apply).not.toHaveBeenCalled()
})
it('does not restore an original interval', () => {
  const { restore, close } = setup()
  fireEvent.click(screen.getByText('Restore Mix'))
  expect(restore).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('provides editable bounds and refuses invalid ranges', () => {
  const { apply } = setup()
  fireEvent.click(screen.getByLabelText('Alice'))
  fireEvent.change(screen.getByLabelText('Start (seconds)'), { target: { value: '4' } })
  fireEvent.click(screen.getByText('Apply replacement'))
  expect(apply).not.toHaveBeenCalled()
})
it('never preselects the union of mixed replacements', () => {
  const track: Track = {
    ...tracks[0],
    clips: [
      {
        id: 'clip',
        trackId: 'mix',
        audioSourceId: 'audio' as Track['clips'][number]['audioSourceId'],
        sourceStart: 0,
        sourceEnd: 10,
        outputStart: 0,
        gain: 1,
        muted: false,
        effects: [],
        sourceOverrides: [
          { id: 'x', sourceStart: 1, sourceEnd: 2, stemTrackIds: ['a'] },
          { id: 'y', sourceStart: 2, sourceEnd: 3, stemTrackIds: ['b'] },
        ],
      },
    ],
  }
  setup(track)
  expect((screen.getByLabelText('Alice') as HTMLInputElement).checked).toBe(false)
  expect((screen.getByLabelText('Bob') as HTMLInputElement).checked).toBe(false)
  expect(screen.getByText(/Multiple source settings/)).toBeTruthy()
})

it('shows two decimals without silently rounding stored bounds', () => {
  const { apply } = setup(tracks[0], 1.234567, 3.987654)
  expect((screen.getByLabelText('Start (seconds)') as HTMLInputElement).value).toBe('1.23')
  expect((screen.getByLabelText('End (seconds)') as HTMLInputElement).value).toBe('3.99')
  fireEvent.click(screen.getByLabelText('Alice'))
  fireEvent.click(screen.getByText('Apply replacement'))
  expect(apply).toHaveBeenCalledWith(['a'], 1.234567, 3.987654)
})
