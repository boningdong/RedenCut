// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WaveformView } from './WaveformView'
import { useTimelineStore } from '../../stores/timeline.store'
import { muteSelection, deleteSelection, unmuteSelection } from '../../actions/timelineActions'
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

it('selects a ruler range immediately and redacts across clips without removing them', async () => {
  const { container, clip } = setup()
  act(() => {
    const timeline = useTimelineStore.getState()
    const first = timeline.tracks[0].clips[0]
    timeline.loadFromProject(
      [source],
      timeline.tracks.map((track) => ({
        ...track,
        clips:
          track.id === 'one'
            ? [first, { ...first, id: 'b', sourceStart: 10, sourceEnd: 15, outputStart: 7 }]
            : [{ ...first, id: 'other', trackId: 'two' }],
      })),
    )
    timeline.setSelectedTrackId('one')
  })
  fireEvent.click(clip)
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 120 })
  fireEvent.pointerMove(window, { clientX: 360 })
  expect(useEditorStore.getState().selection).toEqual({
    origin: 'timeline',
    trackId: 'one',
    start: 3,
    end: 9,
  })
  expect(container.querySelector('[data-lane="one"] [data-range-selection]')).not.toBeNull()
  expect(container.querySelector('[data-lane="two"] [data-range-selection]')).toBeNull()
  fireEvent.pointerUp(window, { clientX: 360 })
  fireEvent.click(ruler, { clientX: 360 })
  fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))
  const timeline = useTimelineStore.getState()
  expect(timeline.tracks[0].clips).toHaveLength(2)
  expect(timeline.tracks[0].clips[0].redactions).toMatchObject([{ sourceStart: 3, sourceEnd: 5 }])
  expect(timeline.tracks[0].clips[1].redactions).toMatchObject([{ sourceStart: 10, sourceEnd: 12 }])
  expect(timeline.tracks[1].clips[0].redactions).toBeUndefined()
  expect(timeline.undoStack).toHaveLength(1)
  await act(() => timeline.undo())
  expect(useTimelineStore.getState().tracks[0].clips.every((c) => !c.redactions?.length)).toBe(true)
})

it('normalizes reverse drags, cancels on Escape, and preserves time on track changes', () => {
  const { container } = setup()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 360 })
  fireEvent.pointerMove(window, { clientX: 120 })
  expect(useEditorStore.getState().selection).toMatchObject({ start: 3, end: 9 })
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
  fireEvent.pointerUp(window, { clientX: 120 })
  expect(useEditorStore.getState().selection).toBeNull()
  fireEvent.pointerDown(ruler, { button: 0, clientX: 40 })
  fireEvent.pointerMove(window, { clientX: 120 })
  fireEvent.pointerUp(window, { clientX: 120 })
  act(() => useTimelineStore.getState().setSelectedTrackId('two'))
  expect(useEditorStore.getState().selection).toMatchObject({ start: 1, end: 3, trackId: 'two' })
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})

it('renders transcript highlights above clips without intercepting clip interaction', () => {
  const { container } = setup()
  act(() => {
    useTimelineStore.getState().setSelectedTrackId('one')
    useEditorStore
      .getState()
      .setSelection({ origin: 'transcript', trackId: 'one', start: 1, end: 3 })
  })
  const overlay = container.querySelector<HTMLElement>('[data-range-selection="transcript"]')
  expect(overlay).not.toBeNull()
  expect(overlay!.style.left).toBe('40px')
  expect(overlay!.style.width).toBe('80px')
  expect(overlay!.style.pointerEvents).toBe('none')
  act(() => useEditorStore.getState().setSelection(null))
  expect(container.querySelector('[data-range-selection]')).toBeNull()
})

it('maps zoomed scrolled ruler coordinates and clamps to the media duration', () => {
  const { container } = setup()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  const viewport = container.querySelector('#waveform-timeline')!.parentElement!.parentElement!
  Object.defineProperties(viewport, { clientWidth: { value: 800 }, scrollWidth: { value: 1600 } })
  fireEvent.click(screen.getByTitle('Zoom in'))
  const ruler = container.querySelector<HTMLElement>('#waveform-timeline')!
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({ left: -160 } as DOMRect)
  fireEvent.pointerDown(ruler, { button: 0, clientX: 0 })
  fireEvent.pointerMove(window, { clientX: 640 })
  expect(useEditorStore.getState().selection).toMatchObject({ start: 2, end: 10 })
  fireEvent.pointerMove(window, { clientX: 2000 })
  fireEvent.pointerUp(window, { clientX: 2000 })
  expect(useEditorStore.getState().selection).toMatchObject({ start: 2, end: 20 })
})

it.each(['pointercancel', 'blur'])('cancels a range on %s without editing', (event) => {
  const { container } = setup()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 40 })
  fireEvent.pointerMove(window, { clientX: 160 })
  fireEvent(window, new MouseEvent(event))
  fireEvent.pointerUp(window, { clientX: 160 })
  expect(useEditorStore.getState().selection).toBeNull()
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})

it('ignores right clicks and clears selection on project replacement', () => {
  const { container } = setup()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 2, clientX: 40 })
  fireEvent.pointerMove(window, { clientX: 160 })
  expect(useEditorStore.getState().selection).toBeNull()
  fireEvent.pointerDown(ruler, { button: 0, clientX: 40 })
  fireEvent.pointerMove(window, { clientX: 160 })
  act(() => useTimelineStore.getState().initFromAudioSource(source))
  fireEvent.pointerUp(window, { clientX: 160 })
  expect(useEditorStore.getState().selection).toBeNull()
})

it('does not create a history entry for a range entirely in empty lane space', () => {
  const { container } = setup()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 400 })
  fireEvent.pointerMove(window, { clientX: 600 })
  fireEvent.pointerUp(window, { clientX: 600 })
  fireEvent.click(screen.getByRole('button', { name: 'Redact selection' }))
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  expect(useEditorStore.getState().selection).toBeNull()
})

it('retains clip selection when a ruler gesture is only a click', () => {
  const { container, clip } = setup()
  fireEvent.click(clip)
  expect(useTimelineStore.getState().selectedClipIds).toEqual(['a'])
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 80 })
  fireEvent.pointerUp(window, { clientX: 80 })
  fireEvent.click(ruler, { clientX: 80 })
  expect(useTimelineStore.getState().selectedClipIds).toEqual(['a'])
  expect(useEditorStore.getState().selection).toBeNull()
})

it('selects time without an active track and only enables edits after assigning a target', () => {
  const { container } = setup()
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 40 })
  fireEvent.pointerMove(window, { clientX: 120 })
  fireEvent.pointerUp(window, { clientX: 120 })
  expect(useEditorStore.getState().selection).toEqual({
    origin: 'timeline',
    trackId: null,
    start: 1,
    end: 3,
  })
  expect(container.querySelector('[data-range-scope="timeline"]')).not.toBeNull()
  expect(container.querySelector('[data-range-scope="track"]')).toBeNull()
  expect(
    (screen.getByRole('button', { name: 'Redact selection' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(
    (screen.getByRole('button', { name: 'Delete selection' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  act(() => {
    muteSelection()
    deleteSelection()
    unmuteSelection()
  })
  expect(useEditorStore.getState().selection).toMatchObject({ start: 1, end: 3, trackId: null })
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  fireEvent.click(container.querySelector('.track-header')!)
  expect(useEditorStore.getState().selection).toMatchObject({ start: 1, end: 3, trackId: 'one' })
  expect(container.querySelector('[data-lane="one"] [data-range-scope="track"]')).not.toBeNull()
  expect(
    (screen.getByRole('button', { name: 'Redact selection' }) as HTMLButtonElement).disabled,
  ).toBe(false)
  act(() => useTimelineStore.getState().setSelectedTrackId(null))
  expect(useEditorStore.getState().selection).toMatchObject({ start: 1, end: 3, trackId: null })
  expect(container.querySelector('[data-range-scope="track"]')).toBeNull()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  fireEvent.click(screen.getByRole('button', { name: 'Redact selection' }))
  expect(useTimelineStore.getState().tracks[0].clips[0].redactions).toMatchObject([
    { sourceStart: 1, sourceEnd: 3 },
  ])
})

it('preserves a timeline range when its target track is removed', () => {
  const { container } = setup()
  act(() => useTimelineStore.getState().setSelectedTrackId('one'))
  const ruler = container.querySelector('#waveform-timeline')!
  fireEvent.pointerDown(ruler, { button: 0, clientX: 40 })
  fireEvent.pointerMove(window, { clientX: 120 })
  fireEvent.pointerUp(window, { clientX: 120 })
  act(() => useTimelineStore.getState().removeTrack('one'))
  expect(useEditorStore.getState().selection).toMatchObject({ start: 1, end: 3, trackId: null })
  expect(container.querySelector('[data-range-scope="track"]')).toBeNull()
})
