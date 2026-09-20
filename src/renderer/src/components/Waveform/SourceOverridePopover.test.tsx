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
function setup() {
  const apply = vi.fn(() => true),
    close = vi.fn(),
    restore = vi.fn(() => true)
  const anchor = createRef<HTMLButtonElement>()
  render(
    <>
      <button ref={anchor}>Anchor</button>
      <SourceOverridePopover
        anchor={anchor}
        track={tracks[0]}
        tracks={tracks}
        start={1}
        end={3}
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
  fireEvent.click(screen.getByText('Apply'))
  expect(apply).toHaveBeenCalledExactlyOnceWith(['a', 'b'])
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
it('restores the selected interval', () => {
  const { restore, close } = setup()
  fireEvent.click(screen.getByText('Restore Mix'))
  expect(restore).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})
