// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WaveformView } from './WaveformView'
import { useTimelineStore } from '../../stores/timeline.store'
import { useEditorStore } from '../../stores/editor.store'
import type { RendererAudioSource } from '@shared/session.types'

vi.mock('./CanvasWaveform', () => ({ CanvasWaveform: () => null }))
const source: RendererAudioSource = {
  id: '00000000-0000-4000-8000-000000000001' as RendererAudioSource['id'],
  displayName: 'Dialogue',
  metadata: { durationSeconds: 20, sampleRate: 48000, channels: 1, codec: 'wav', bitrateKbps: 768 },
  cache: {
    audioSourceId: '00000000-0000-4000-8000-000000000001' as RendererAudioSource['id'],
    sampleRate: 48000,
    channels: 1,
    frameCount: 960000,
    waveformLevels: [],
  },
}
function setup() {
  const clip = {
    id: 'a',
    trackId: 'one',
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
    ['one', 'two'].map((id, index) => ({
      id,
      name: id,
      clips: index ? [] : [clip],
      volume: 1,
      muted: false,
      solo: false,
      color: '#508080',
      effects: [],
    })),
  )
  const view = render(
    <WaveformView duration={20} providersBySource={new Map()} onAddTrack={() => {}} />,
  )
  return { ...view, clip: view.container.querySelector('[data-clip-id="a"]')! }
}
beforeEach(() => {
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = this.dataset.lane === 'two' ? 92 : this.dataset.lane === 'one' ? 28 : 0
    return {
      left: 0,
      right: 800,
      top,
      bottom: top + 64,
      width: 800,
      height: 64,
      x: 0,
      y: top,
      toJSON() {},
    }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('previews the destination lane then commits a cross-track move once', () => {
  const { container, clip } = setup()
  fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerMove(clip, { clientX: 120, clientY: 115 })
  const ghost = container.querySelector('[data-lane="two"] [data-clip-preview="a"]')
  expect(ghost).not.toBeNull()
  expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(1)
  fireEvent.pointerUp(clip, { clientX: 120, clientY: 115 })
  expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(0)
  expect(useTimelineStore.getState().tracks[1].clips[0]).toMatchObject({
    id: 'a',
    trackId: 'two',
    outputStart: 2,
  })
  expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  void act(() => useTimelineStore.getState().undo())
  expect(useTimelineStore.getState().tracks[0].clips[0].outputStart).toBe(0)
})
it('Escape cancels an active move without creating history', () => {
  const { container, clip } = setup()
  fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerMove(clip, { clientX: 120, clientY: 115 })
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
  fireEvent.pointerUp(clip, { clientX: 120, clientY: 115 })
  expect(container.querySelector('[data-clip-preview]')).toBeNull()
  expect(useTimelineStore.getState().tracks[0].clips[0].outputStart).toBe(0)
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})
it('trims and restores clip edges without deleting hidden redactions', () => {
  setup()
  const handle = screen.getByRole('button', { name: 'Trim clip end' })
  fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 50 })
  fireEvent.pointerMove(handle, { clientX: 120, clientY: 50 })
  fireEvent.pointerUp(handle, { clientX: 120, clientY: 50 })
  expect(useTimelineStore.getState().tracks[0].clips[0].sourceEnd).toBe(3)
  fireEvent.pointerDown(handle, { button: 0, clientX: 120, clientY: 50 })
  fireEvent.pointerMove(handle, { clientX: 240, clientY: 50 })
  fireEvent.pointerUp(handle, { clientX: 240, clientY: 50 })
  expect(useTimelineStore.getState().tracks[0].clips[0].sourceEnd).toBe(6)
})
it('a click without dragging does not create a move history entry', () => {
  const { clip } = setup()
  fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerUp(clip, { clientX: 40, clientY: 50 })
  fireEvent.click(clip)
  expect(useTimelineStore.getState().selectedClipId).toBe('a')
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})
it('Shift-selects two clips and moves them together without changing their gap', () => {
  const { container } = setup()
  act(() => {
    const state = useTimelineStore.getState()
    const first = state.tracks[0].clips[0]
    state.loadFromProject(
      [source],
      [
        {
          ...state.tracks[0],
          clips: [first, { ...first, id: 'b', sourceStart: 5, sourceEnd: 7, outputStart: 7 }],
        },
        state.tracks[1],
      ],
    )
  })
  const a = container.querySelector('[data-clip-id="a"]')!
  const b = container.querySelector('[data-clip-id="b"]')!
  fireEvent.click(a)
  fireEvent.click(b, { shiftKey: true })
  expect(useTimelineStore.getState().selectedClipIds).toEqual(['a', 'b'])
  fireEvent.pointerDown(a, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerMove(a, { clientX: 120, clientY: 115 })
  expect(container.querySelectorAll('[data-lane="two"] [data-clip-preview]')).toHaveLength(2)
  fireEvent.pointerUp(a, { clientX: 120, clientY: 115 })
  expect(useTimelineStore.getState().tracks[1].clips.map((clip) => clip.outputStart)).toEqual([
    2, 9,
  ])
  expect(useTimelineStore.getState().undoStack).toHaveLength(1)
})
it('an outside drop cancels instead of committing the last valid preview', () => {
  const { clip } = setup()
  fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerMove(clip, { clientX: 120, clientY: 115 })
  fireEvent.pointerMove(clip, { clientX: 120, clientY: 400 })
  fireEvent.pointerUp(clip, { clientX: 120, clientY: 400 })
  expect(useTimelineStore.getState().tracks[0].clips[0].outputStart).toBe(0)
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})
it('marquee-selects clips from blank lane space without moving them', () => {
  const { container } = setup()
  const lane = container.querySelector('[data-lane="one"]')!
  fireEvent.pointerDown(lane, { button: 0, clientX: 250, clientY: 80 })
  fireEvent.pointerMove(lane, { clientX: 10, clientY: 32 })
  fireEvent.pointerUp(lane, { clientX: 10, clientY: 32 })
  expect(useTimelineStore.getState().selectedClipIds).toEqual(['a'])
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})
it('keyboard users can adjust a focused trim handle', () => {
  setup()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Trim clip end' }), {
    key: 'ArrowLeft',
    code: 'ArrowLeft',
    shiftKey: true,
  })
  expect(useTimelineStore.getState().tracks[0].clips[0].sourceEnd).toBeCloseTo(4.9)
  expect(useTimelineStore.getState().undoStack).toHaveLength(1)
})
it('keeps the preview pixel position when a move extends the timeline', () => {
  const { container, clip } = setup()
  fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerMove(clip, { clientX: 780, clientY: 115 })
  const previewLeft = (container.querySelector('[data-clip-preview="a"]') as HTMLElement).style.left
  fireEvent.pointerUp(clip, { clientX: 780, clientY: 115 })
  expect((container.querySelector('[data-clip-id="a"]') as HTMLElement).style.left).toBe(
    previewLeft,
  )
})
it('ignores wheel zoom until the active pointer gesture ends', () => {
  const { container, clip } = setup()
  fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
  fireEvent.pointerMove(clip, { clientX: 120, clientY: 115 })
  const before = (container.querySelector('[data-clip-preview="a"]') as HTMLElement).style.left
  fireEvent.wheel(clip, { deltaY: -100 })
  expect((container.querySelector('[data-clip-preview="a"]') as HTMLElement).style.left).toBe(
    before,
  )
})
it('fits a reopened short edit rather than the hidden full source recording', () => {
  const longSource = { ...source, metadata: { ...source.metadata, durationSeconds: 3600 } }
  useTimelineStore.getState().initFromAudioSource(longSource)
  const state = useTimelineStore.getState()
  state.loadFromProject(
    [longSource],
    [{ ...state.tracks[0], clips: [{ ...state.tracks[0].clips[0], sourceEnd: 10 }] }],
  )
  const { container } = render(
    <WaveformView duration={10} providersBySource={new Map()} onAddTrack={() => {}} />,
  )
  expect((container.querySelector('[data-clip-id]') as HTMLElement).style.width).toBe('800px')
})
it('a second ordinary click deselects a clip but retains its range for redaction', () => {
  const { clip } = setup()
  for (let i = 0; i < 2; i++) {
    fireEvent.pointerDown(clip, { button: 0, clientX: 40, clientY: 50 })
    fireEvent.pointerUp(clip, { clientX: 40, clientY: 50 })
    fireEvent.click(clip)
  }
  expect(useTimelineStore.getState().selectedClipId).toBeNull()
  expect(useEditorStore.getState().selection).toEqual({
    origin: 'clip',
    trackId: 'one',
    start: 0,
    end: 5,
  })
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})
