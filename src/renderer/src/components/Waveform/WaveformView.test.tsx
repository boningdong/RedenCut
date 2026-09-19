// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererAudioSource } from '@shared/session.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { WaveformView } from './WaveformView'
import { TranscriptPanel } from '../Transcript/TranscriptPanel'

const canvasSpy = vi.fn()
vi.mock('./CanvasWaveform', () => ({
  CanvasWaveform: (props: { provider: WaveformDataProvider }) => {
    canvasSpy(props.provider)
    return <div data-testid="waveform" />
  },
}))

const source: RendererAudioSource = {
  id: '00000000-0000-4000-8000-000000000001' as RendererAudioSource['id'],
  displayName: 'shared.mp3',
  metadata: {
    durationSeconds: 10,
    sampleRate: 48_000,
    channels: 2,
    codec: 'mp3',
    bitrateKbps: 192,
  },
  cache: {
    audioSourceId: '00000000-0000-4000-8000-000000000001' as RendererAudioSource['id'],
    sampleRate: 48_000,
    channels: 2,
    frameCount: 480_000,
    waveformLevels: [],
  },
}

describe('WaveformView managed providers', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    useEditorStore.getState().reset()
    useTranscriptStore.getState().reset()
    canvasSpy.mockClear()
    useTimelineStore.getState().reset()
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    })
  })

  it('shows a ruler hover guide across lanes and clears it on leave and blur', () => {
    useTimelineStore.getState().initFromAudioSource(source)
    const { container } = render(
      <WaveformView duration={10} providersBySource={new Map()} onAddTrack={vi.fn()} />,
    )
    const ruler = container.querySelector('#waveform-timeline')!
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      left: 190,
      top: 20,
      bottom: 48,
      right: 1790,
    } as DOMRect)
    fireEvent.pointerMove(ruler, { clientX: 430, clientY: 30 })
    const guide = container.querySelector('[data-ruler-hover]') as HTMLElement
    expect(guide).not.toBeNull()
    expect(guide.style.left).toBe('240px')
    expect(guide.parentElement).toBe(ruler.parentElement)
    expect(useEditorStore.getState().selection).toBeNull()
    fireEvent.pointerLeave(ruler)
    expect(container.querySelector('[data-ruler-hover]')).toBeNull()
    fireEvent.pointerMove(ruler, { clientX: 450, clientY: 30 })
    fireEvent(window, new Event('blur'))
    expect(container.querySelector('[data-ruler-hover]')).toBeNull()
    vi.restoreAllMocks()
  })

  it('shows a shared time reference with emphasis only on the owning track', () => {
    useTimelineStore.getState().initFromAudioSource(source)
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({ tracks: [track, { ...track, id: 'other', clips: [] }] })
    const { container } = render(
      <WaveformView duration={10} providersBySource={new Map()} onAddTrack={vi.fn()} />,
    )
    act(() =>
      useEditorStore
        .getState()
        .setSelection({ origin: 'timeline', trackId: track.id, start: 2, end: 4 }),
    )
    const ruler = container.querySelector('#waveform-timeline')!
    const shared = container.querySelector('[data-range-scope="timeline"]') as HTMLElement
    expect(shared).not.toBeNull()
    expect(shared.parentElement).toBe(ruler.parentElement)
    const active = container.querySelector('[data-range-scope="track"]') as HTMLElement
    expect(active.closest('[data-lane]')?.getAttribute('data-lane')).toBe(track.id)
    expect(active.style.width).toBe(shared.style.width)
    expect(container.querySelectorAll('[data-range-scope="track"]')).toHaveLength(1)
    act(() =>
      useEditorStore
        .getState()
        .setSelection({ origin: 'clip', trackId: track.id, start: 2, end: 4 }),
    )
    expect(container.querySelector('[data-range-selection]')).toBeNull()
  })

  it('keeps the time under the mouse fixed while zooming a scrolled timeline', () => {
    useTimelineStore.getState().initFromAudioSource(source)
    const { container } = render(
      <WaveformView duration={10} providersBySource={new Map()} onAddTrack={vi.fn()} />,
    )
    const content = container.querySelector('#waveform-timeline')!.parentElement!
    const viewport = content.parentElement!
    Object.defineProperties(viewport, {
      clientWidth: { value: 800 },
      scrollWidth: { get: () => Math.max(800, Number.parseFloat(content.style.width)) },
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 190 } as DOMRect)
    fireEvent.click(screen.getByTitle('Zoom in'))
    viewport.scrollLeft = 200
    // At 160 px/s, viewport x=300 points to 3.125 seconds.
    fireEvent.wheel(viewport, { clientX: 490, deltaY: -100 })
    expect(viewport.scrollLeft).toBeCloseTo(300)
    fireEvent.wheel(viewport, { clientX: 490, deltaY: 100 })
    expect(viewport.scrollLeft).toBeCloseTo(200)
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('keeps the audio tail anchored while zooming below fit and extends the ruler into trailing space', () => {
    useTimelineStore.getState().initFromAudioSource(source)
    const { container } = render(
      <WaveformView duration={10} providersBySource={new Map()} onAddTrack={vi.fn()} />,
    )
    const ruler = container.querySelector('#waveform-timeline')!
    const content = ruler.parentElement!
    const viewport = content.parentElement!
    Object.defineProperties(viewport, {
      clientWidth: { value: 800 },
      scrollWidth: { get: () => Math.max(800, Number.parseFloat(content.style.width)) },
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 190 } as DOMRect)
    fireEvent.click(screen.getByTitle('Zoom out'))
    // 9 seconds is at x=540 within the viewport at the 75% overview.
    fireEvent.wheel(viewport, { clientX: 730, deltaY: -100 })
    expect(viewport.scrollLeft).toBeCloseTo(108)
    expect(Number.parseFloat(content.style.width)).toBe(1520)
    // Visible trailing space ends at 12.61s; offscreen ticks are culled.
    expect(ruler.textContent).toContain('12s')
    expect(ruler.textContent).not.toContain('20s')
    // Two wheel events before React commits must accumulate against the padded extent.
    act(() => {
      viewport.dispatchEvent(new WheelEvent('wheel', { clientX: 730, deltaY: -100 }))
      viewport.dispatchEvent(new WheelEvent('wheel', { clientX: 730, deltaY: -100 }))
    })
    expect(viewport.scrollLeft).toBeCloseTo(393.12)
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('derives overview blank time from source metadata when opening moved clips', () => {
    useTimelineStore.getState().initFromAudioSource(source)
    const tracks = useTimelineStore.getState().tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({ ...clip, outputStart: 10 })),
    }))
    useTimelineStore.setState({ tracks })
    const { container } = render(
      <WaveformView duration={20} providersBySource={new Map()} onAddTrack={vi.fn()} />,
    )
    const content = container.querySelector('#waveform-timeline')!.parentElement!
    const viewport = content.parentElement!
    Object.defineProperties(viewport, {
      clientWidth: { value: 800 },
      scrollWidth: { get: () => Math.max(800, Number.parseFloat(content.style.width)) },
    })
    fireEvent.click(screen.getByTitle('Zoom out'))
    // 20s timeline + 10/3s blank, while retaining a full viewport of scroll room.
    expect(Number.parseFloat(content.style.width)).toBeCloseTo(800 + (800 * 20) / (20 + 10 / 3))
    expect((screen.getByTitle('Zoom out') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reuses the provider selected by each clip audioSourceId', () => {
    const clip = {
      id: 'clip-1',
      trackId: 'track-1',
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
      [
        {
          id: 'track-1',
          name: 'One',
          clips: [clip],
          volume: 1,
          muted: false,
          solo: false,
          color: '#f00',
          effects: [],
        },
        {
          id: 'track-2',
          name: 'Two',
          clips: [{ ...clip, id: 'clip-2', trackId: 'track-2' }],
          volume: 1,
          muted: false,
          solo: false,
          color: '#0f0',
          effects: [],
        },
      ],
    )
    const provider: WaveformDataProvider = { readRange: vi.fn(async () => ({ buckets: [] })) }
    render(
      <WaveformView
        duration={10}
        providersBySource={new Map([[source.id, provider]])}
        onAddTrack={vi.fn()}
      />,
    )
    expect(canvasSpy).toHaveBeenCalledTimes(2)
    expect(canvasSpy.mock.calls.every(([actual]) => actual === provider)).toBe(true)
  })

  it('keeps canonical text selection out of waveform actions even with a stale selected clip', () => {
    const clip = {
      id: 'clip',
      trackId: 'track',
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
      [
        {
          id: 'track',
          name: 'One',
          color: '#cf7ba6',
          volume: 1,
          muted: false,
          solo: false,
          effects: [],
          clips: [clip, { ...clip, id: 'duplicate' }],
        },
      ],
    )
    useTimelineStore.getState().setSelectedClipId('clip')
    useEditorStore
      .getState()
      .setSelection({ origin: 'timeline', trackId: 'track', start: 1, end: 2 })
    useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set(['canonical-unit']))
    render(<WaveformView duration={5} providersBySource={new Map()} onAddTrack={vi.fn()} />)
    const before = useTimelineStore.getState().tracks
    for (const name of ['Split at playhead', 'Mute', 'Delete selection']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toContain('transcript')
      fireEvent.click(button)
    }
    expect(useTimelineStore.getState().tracks).toBe(before)
    act(() => useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set()))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))
    expect(useTimelineStore.getState().tracks[0].clips.map((item) => item.id)).toEqual([
      'duplicate',
    ])
    expect(useEditorStore.getState().selection).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Redact selection' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    act(() =>
      useEditorStore
        .getState()
        .setSelection({ origin: 'timeline', trackId: 'track', start: 1, end: 2 }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Redact selection' }))
    expect(
      useTimelineStore
        .getState()
        .tracks[0].clips.some((item) =>
          item.redactions?.some((r) => r.sourceStart === 1 && r.sourceEnd === 2),
        ),
    ).toBe(true)
  })
  it('transfers keyboard ownership from transcript to an explicitly clicked waveform', () => {
    useTimelineStore.getState().initFromAudioSource(source)
    const transcript = document.createElement('div')
    transcript.contentEditable = 'true'
    transcript.tabIndex = 0
    transcript.textContent = 'selected transcript'
    document.body.append(transcript)
    transcript.focus()
    const range = document.createRange()
    range.selectNodeContents(transcript)
    window.getSelection()!.addRange(range)
    useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set(['unit']))
    render(
      <>
        <TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />
        <WaveformView duration={10} providersBySource={new Map()} onAddTrack={vi.fn()} />
      </>,
    )
    const clip = document.querySelector<HTMLElement>('.waveform-clip')!
    clip.setPointerCapture = vi.fn()
    fireEvent.pointerDown(clip, { pointerId: 1, button: 0, clientX: 5 })
    expect(document.activeElement).toBe(document.querySelector('.audio-panel-view'))
    expect(window.getSelection()!.isCollapsed).toBe(true)
    expect(useTranscriptStore.getState().selectedTranscriptUnitIds.size).toBe(0)
    fireEvent.click(clip)
    fireEvent(document, new Event('selectionchange'))
    expect(useEditorStore.getState().selection).toEqual({
      origin: 'clip',
      trackId: useTimelineStore.getState().tracks[0].id,
      start: 0,
      end: 10,
    })
    transcript.remove()
  })
})
