// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererAudioSource } from '@shared/session.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useTimelineStore } from '../../stores/timeline.store'
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
  afterEach(cleanup)
  beforeEach(() => {
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
    useEditorStore.getState().setSelection({ start: 1, end: 2 })
    useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set(['canonical-unit']))
    render(<WaveformView duration={5} providersBySource={new Map()} onAddTrack={vi.fn()} />)
    const before = useTimelineStore.getState().tracks
    for (const name of ['Split at playhead', 'Redact selection', 'Delete selection']) {
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
    fireEvent.click(screen.getByRole('button', { name: 'Redact selection' }))
    expect(
      useTimelineStore
        .getState()
        .tracks[0].clips.some(
          (item) => item.muted && item.sourceStart === 1 && item.sourceEnd === 2,
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
    expect(useEditorStore.getState().selection).toEqual({ start: 0, end: 10 })
    transcript.remove()
  })
})
