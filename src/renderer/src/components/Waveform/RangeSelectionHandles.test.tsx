// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RangeSelectionHandles } from './RangeSelectionHandles'
import { useEditorStore } from '../../stores/editor.store'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('resizes a range without moving clips and restores it on Escape', () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const selection = { origin: 'timeline' as const, trackId: 'mix', start: 2, end: 4 }
  useEditorStore.getState().setSelection(selection)
  render(<RangeSelectionHandles selection={selection} pxPerSec={100} duration={10} />)
  fireEvent.pointerDown(screen.getByLabelText('Adjust selection start'), {
    button: 0,
    clientX: 200,
  })
  fireEvent.pointerMove(window, { clientX: 250 })
  expect(useEditorStore.getState().selection?.start).toBe(2.5)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(useEditorStore.getState().selection).toEqual(selection)
})
it('supports precise keyboard range adjustment', () => {
  const selection = { origin: 'timeline' as const, trackId: 'mix', start: 2, end: 4 }
  render(<RangeSelectionHandles selection={selection} pxPerSec={100} duration={10} />)
  fireEvent.keyDown(screen.getByLabelText('Adjust selection end'), {
    key: 'ArrowRight',
    shiftKey: true,
  })
  expect(useEditorStore.getState().selection?.end).toBeCloseTo(4.1)
})

it('commits the resized interval once on release with its original bounds', () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const selection = { origin: 'timeline' as const, trackId: 'mix', start: 2, end: 4 }
  const onCommit = vi.fn(() => true)
  render(
    <RangeSelectionHandles
      selection={selection}
      pxPerSec={100}
      duration={10}
      onCommit={onCommit}
    />,
  )
  fireEvent.pointerDown(screen.getByLabelText('Adjust selection end'), { button: 0, clientX: 400 })
  fireEvent.pointerMove(window, { clientX: 500 })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.pointerUp(window, { clientX: 500 })
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ ...selection, end: 5 }, selection)
})
