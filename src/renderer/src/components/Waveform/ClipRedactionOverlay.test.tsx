// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Clip, Track } from '@shared/project.types'
import { ClipRedactionOverlay } from './ClipRedactionOverlay'
import { useTimelineStore } from '../../stores/timeline.store'

const clip: Clip = {
  id: 'c',
  trackId: 't',
  audioSourceId: 'source' as never,
  sourceStart: 10,
  sourceEnd: 20,
  outputStart: 30,
  muted: false,
  gain: 1,
  effects: [],
  redactions: [{ id: 'r', sourceStart: 12, sourceEnd: 15 }],
}
const track: Track = {
  id: 't',
  name: 'Voice',
  color: '#fff',
  volume: 1,
  muted: false,
  solo: false,
  effects: [],
  clips: [clip],
}
const state = () => useTimelineStore.getState()
function View({ onFocusTimeline = () => {} }: { onFocusTimeline?: () => void }) {
  const current = useTimelineStore((s) => s.tracks[0].clips[0])
  return (
    <ClipRedactionOverlay
      clip={current}
      redaction={current.redactions![0]}
      pxPerSec={10}
      onFocusTimeline={onFocusTimeline}
    />
  )
}
beforeEach(() => {
  state().reset()
  state().loadFromProject([], [track])
  vi.stubGlobal('PointerEvent', MouseEvent)
  HTMLElement.prototype.setPointerCapture = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps focus on the handle for repeated keyboard nudges after transferring editor scope', () => {
  const panel = document.createElement('div')
  panel.tabIndex = -1
  document.body.append(panel)
  render(<View onFocusTimeline={() => panel.focus()} />)
  const handle = screen.getByRole('button', { name: 'Adjust redaction start' })
  handle.focus()
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(handle)
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
  expect(state().tracks[0].clips[0].redactions![0].sourceStart).toBeCloseTo(12.02)
  panel.remove()
})

it('preserves the hidden opposite boundary while resizing a trimmed overlay', () => {
  state().loadFromProject([], [{ ...track, clips: [{ ...clip, sourceStart: 13 }] }])
  render(<View />)
  const endHandle = screen.getByRole('button', { name: 'Adjust redaction end' })
  fireEvent.pointerDown(endHandle, { button: 0, clientX: 100 })
  fireEvent.pointerMove(endHandle, { clientX: 110 })
  fireEvent.pointerUp(endHandle)
  expect(state().tracks[0].clips[0].redactions![0]).toMatchObject({
    sourceStart: 12,
    sourceEnd: 16,
  })
  fireEvent.keyDown(endHandle, { key: 'ArrowRight', shiftKey: true })
  expect(state().tracks[0].clips[0].redactions![0]).toMatchObject({
    sourceStart: 12,
    sourceEnd: 16.1,
  })
  const startHandle = screen.getByRole('button', { name: 'Adjust redaction start' })
  fireEvent.pointerDown(startHandle, { button: 0, clientX: 100 })
  fireEvent.pointerMove(startHandle, { clientX: 110 })
  fireEvent.pointerUp(startHandle)
  expect(state().tracks[0].clips[0].redactions![0].sourceStart).toBe(14)
})

it('previews a boundary drag without mutating history; commits once and undoes once', () => {
  render(<View />)
  const handle = screen.getByRole('button', { name: 'Adjust redaction end' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
  fireEvent.pointerMove(handle, { clientX: 110 })
  fireEvent.pointerMove(handle, { clientX: 120 })
  expect(state().undoStack).toHaveLength(0)
  expect(state().tracks[0].clips[0].redactions![0].sourceEnd).toBe(15)
  expect(document.querySelector('.clip-redaction')?.getAttribute('data-source-end')).toBe('17')
  fireEvent.pointerUp(handle)
  expect(state().undoStack).toHaveLength(1)
  expect(state().tracks[0].clips[0].redactions![0].sourceEnd).toBe(17)
  expect(state().selectedClipId).toBeNull()
  expect(state().timelineSelection).toBeNull()
  void act(() => state().undo())
  expect(state().tracks[0].clips[0].redactions![0].sourceEnd).toBe(15)
})

it.each(['Escape', 'pointercancel', 'lostpointercapture'])(
  'cancels a drag with %s without creating an edit',
  (cancel) => {
    render(<View />)
    const handle = screen.getByRole('button', { name: 'Adjust redaction start' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
    fireEvent.pointerMove(handle, { clientX: 90 })
    if (cancel === 'Escape') fireEvent.keyDown(handle, { key: 'Escape' })
    else if (cancel === 'pointercancel') fireEvent.pointerCancel(handle)
    else fireEvent.lostPointerCapture(handle)
    fireEvent.pointerUp(handle)
    expect(state().tracks[0].clips[0]).toBe(clip)
    expect(state().undoStack).toHaveLength(0)
    expect(document.querySelector('.clip-redaction')?.getAttribute('data-source-start')).toBe('12')
  },
)

it('rejects a stale drag if its clip moves before the gesture finishes', () => {
  render(<View />)
  const handle = screen.getByRole('button', { name: 'Adjust redaction end' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
  fireEvent.pointerMove(handle, { clientX: 120 })
  act(() => state().moveClip('c', 50))
  fireEvent.pointerUp(handle)
  expect(state().tracks[0].clips[0].redactions![0].sourceEnd).toBe(15)
  expect(state().undoStack).toHaveLength(1)
})

it('supports fine keyboard adjustment and clamps to clip bounds', () => {
  render(<View />)
  const handle = screen.getByRole('button', { name: 'Adjust redaction start' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(state().tracks[0].clips[0].redactions![0].sourceStart).toBeCloseTo(12.01)
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
  fireEvent.pointerMove(handle, { clientX: -1000 })
  fireEvent.pointerUp(handle)
  expect(state().tracks[0].clips[0].redactions![0].sourceStart).toBe(10)
})

it('moves the whole overlay with a single undo and without moving its clip', () => {
  render(<View />)
  const body = screen.getByRole('button', { name: 'Redaction 12.00–15.00 s' })
  fireEvent.pointerDown(body, { button: 0, clientX: 100 })
  fireEvent.pointerMove(body, { clientX: 110 })
  fireEvent.pointerMove(body, { clientX: 120, altKey: true })
  expect(state().undoStack).toHaveLength(0)
  expect(document.querySelector('.clip-redaction')?.getAttribute('data-source-start')).toBe('14')
  fireEvent.pointerUp(body)
  expect(state().tracks[0].clips[0]).toMatchObject({
    outputStart: 30,
    redactions: [{ id: 'r', sourceStart: 14, sourceEnd: 17 }],
  })
  expect(state().undoStack).toHaveLength(1)
  void act(() => state().undo())
  expect(state().tracks[0].clips[0].redactions).toEqual(clip.redactions)
})

it.each([
  [-1000, 10, 13],
  [1000, 17, 20],
])('clamps whole movement at clip bounds (%s)', (x, start, end) => {
  render(<View />)
  const body = screen.getByRole('button', { name: 'Redaction 12.00–15.00 s' })
  fireEvent.pointerDown(body, { button: 0, clientX: 100 })
  fireEvent.pointerMove(body, { clientX: x })
  fireEvent.pointerUp(body)
  expect(state().tracks[0].clips[0].redactions![0]).toMatchObject({
    sourceStart: start,
    sourceEnd: end,
  })
})

it('lets an Alt pointer gesture reach the underlying clip without selecting the overlay', () => {
  let received = false
  render(
    <div
      onPointerDown={() => {
        received = true
      }}
    >
      <View />
    </div>,
  )
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Redaction 12.00–15.00 s' }), {
    button: 0,
    clientX: 100,
    altKey: true,
  })
  expect(received).toBe(true)
  expect(state().timelineSelection).toBeNull()
})

it('exposes a way to select another overlapping overlay', () => {
  const other = { id: 'other', sourceStart: 13, sourceEnd: 16 }
  state().loadFromProject(
    [],
    [{ ...track, clips: [{ ...clip, redactions: [...clip.redactions!, other] }] }],
  )
  render(<View />)
  fireEvent.click(screen.getByRole('button', { name: 'Select next overlapping redaction' }))
  expect(state().timelineSelection).toEqual({
    kind: 'redaction',
    clipId: 'c',
    redactionId: 'other',
  })
  expect(state().undoStack).toHaveLength(0)
})

it('preserves hidden trim metadata when moving the visible overlay', () => {
  state().loadFromProject([], [{ ...track, clips: [{ ...clip, sourceStart: 13 }] }])
  render(<View />)
  const body = screen.getByRole('button', { name: 'Redaction 13.00–15.00 s' })
  fireEvent.pointerDown(body, { button: 0, clientX: 100 })
  fireEvent.pointerMove(body, { clientX: 110 })
  fireEvent.pointerUp(body)
  expect(state().tracks[0].clips[0].redactions![0]).toMatchObject({
    sourceStart: 13,
    sourceEnd: 16,
  })
})

it('does not transfer a started overlay gesture to its parent when Alt is pressed', () => {
  let clickedParent = false
  render(
    <div
      onClick={() => {
        clickedParent = true
      }}
    >
      <View />
    </div>,
  )
  const body = screen.getByRole('button', { name: 'Redaction 12.00–15.00 s' })
  fireEvent.pointerDown(body, { button: 0, clientX: 100 })
  fireEvent.pointerMove(body, { clientX: 110, altKey: true })
  fireEvent.pointerUp(body, { altKey: true })
  fireEvent.click(body, { altKey: true })
  expect(clickedParent).toBe(false)
  expect(state().timelineSelection?.kind).toBe('redaction')
})

it('cycles through an overlap-connected group and preserves keyboard focus', () => {
  state().loadFromProject(
    [],
    [
      {
        ...track,
        clips: [
          {
            ...clip,
            redactions: [
              { id: 'a', sourceStart: 11, sourceEnd: 19 },
              { id: 'b', sourceStart: 12, sourceEnd: 13 },
              { id: 'c', sourceStart: 16, sourceEnd: 17 },
            ],
          },
        ],
      },
    ],
  )
  const panel = document.createElement('div')
  panel.tabIndex = -1
  document.body.append(panel)
  function Group() {
    const current = useTimelineStore((s) => s.tracks[0].clips[0])
    return (
      <>
        {current.redactions!.map((r) => (
          <ClipRedactionOverlay
            key={r.id}
            clip={current}
            redaction={r}
            pxPerSec={10}
            onFocusTimeline={() => panel.focus()}
          />
        ))}
      </>
    )
  }
  render(<Group />)
  const button = screen.getAllByRole('button', { name: 'Select next overlapping redaction' })[0]
  fireEvent.click(button)
  expect(document.activeElement).not.toBe(panel)
  expect(state().timelineSelection).toMatchObject({ redactionId: 'b' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Select next overlapping redaction' })[1])
  expect(state().timelineSelection).toMatchObject({ redactionId: 'c' })
  panel.remove()
})

it('finishes pointer edge resizing without leaving selection or handle focus', () => {
  render(<View />)
  const handle = screen.getByRole('button', { name: 'Adjust redaction end' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 })
  fireEvent.pointerMove(handle, { clientX: 120 })
  fireEvent.pointerUp(handle)
  fireEvent.click(handle)
  expect(state().tracks[0].clips[0].redactions![0].sourceEnd).toBe(17)
  expect(state().timelineSelection).toBeNull()
  expect(document.activeElement).not.toBe(handle)
  expect(state().undoStack).toHaveLength(1)
})
