// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { setAudioPlayerInstance } from '@shared/player.types'
import { TranscriptPanel } from './TranscriptPanel'
import { useLocaleStore } from '../../stores/locale.store'

const sourceId = '550e8400-e29b-41d4-a716-446655440000'

describe('canonical transcript editability', () => {
  beforeEach(() => {
    useLocaleStore.setState({ resolvedLocale: 'en' })
    useEditorStore.getState().reset()
    useTimelineStore.getState().reset()
    useTranscriptStore.getState().reset()
    useTimelineStore.setState({
      tracks: [
        {
          id: 'track',
          name: 'Track',
          volume: 1,
          muted: false,
          solo: false,
          color: '#fff',
          effects: [],
          clips: [
            {
              id: 'clip',
              trackId: 'track',
              audioSourceId: sourceId as never,
              sourceStart: 0,
              sourceEnd: 2,
              outputStart: 0,
              gain: 1,
              muted: true,
              effects: [],
            },
          ],
        },
      ],
    })
    useTranscriptStore.getState().loadAnalyses([
      {
        audioSourceId: sourceId,
        analysisRevisionId: 'revision',
        transcript: {
          id: 'transcript',
          revision: 1,
          mode: 'best-effort-verbatim',
          provenance: {},
          units: [
            { id: 'speech', text: '觉', kind: 'speech' },
            { id: 'punctuation', text: '。', kind: 'punctuation' },
            { id: 'unaligned', text: '嗯', kind: 'speech' },
          ],
        },
        alignment: {
          id: 'alignment',
          transcriptArtifactId: 'transcript',
          transcriptRevision: 1,
          provenance: {},
          acousticEditUnits: [
            {
              id: 'acoustic',
              transcriptUnitIds: ['speech'],
              audioSourceId: sourceId,
              sourceStart: 0.5,
              sourceEnd: 1,
              granularity: 'character',
            },
          ],
        },
        diarization: { id: 'diarization', provenance: {}, turns: [] },
        speakerAttribution: {
          analysisRevisionId: 'revision',
          alignmentArtifactId: 'alignment',
          diarizationArtifactId: 'diarization',
          attributions: [],
          provenance: {},
        },
        speakers: [],
        speakerLabelOverrides: [],
      } as never,
    ])
  })
  afterEach(() => {
    cleanup()
    useLocaleStore.setState({ resolvedLocale: 'en' })
    setAudioPlayerInstance(null)
    window.getSelection()?.removeAllRanges()
  })

  it('renders a complete named Generate action in both locales without changing the track', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        {
          ...track,
          name: '<My guest>',
          clips: track.clips.map((clip) => ({ ...clip, audioSourceId: 'missing-source' as never })),
        },
      ],
    })
    const generate = vi.fn()
    render(<TranscriptPanel onGenerate={generate} isGenerating={false} generatingStatus={null} />)
    const button = screen.getByRole('button', { name: 'Generate <My guest>' })
    act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
    expect(screen.getByRole('button', { name: '生成 <My guest> 的转写' })).toBe(button)
    fireEvent.click(button)
    expect(generate).toHaveBeenCalledWith(track.id)
    expect(useTimelineStore.getState().tracks[0].name).toBe('<My guest>')
  })

  it('visually distinguishes editable speech, punctuation, and unaligned speech consistently', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const speech = document.querySelector('[data-unit-id="speech"]') as HTMLElement
    const punctuation = document.querySelector('[data-unit-id="punctuation"]') as HTMLElement
    const unaligned = document.querySelector('[data-unit-id="unaligned"]') as HTMLElement
    expect(speech.dataset.acousticEditable).toBe('true')
    expect(speech.style.textDecoration).toBe('line-through')
    expect(punctuation.dataset.acousticEditable).toBe('false')
    expect(punctuation.style.textDecoration).not.toBe('line-through')
    expect(unaligned.dataset.acousticEditable).toBe('false')
    expect(unaligned.title).toContain('could not be aligned')
    expect(screen.queryByRole('button', { name: 'Sync to playhead' })).toBeNull()
  })

  it('dims track-muted speech without marking it redacted', () => {
    const original = useTimelineStore.getState().tracks[0]
    const mutedTrack = {
      ...original,
      muted: true,
      clips: original.clips.map((clip) => ({ ...clip, muted: false })),
    }
    useTimelineStore.setState({ tracks: [mutedTrack] })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const speech = document.querySelector('[data-unit-id="speech"]') as HTMLElement
    expect(speech.style.textDecoration).not.toBe('line-through')
    expect(speech.style.opacity).toBe('0.5')
    act(() => useTimelineStore.setState({ tracks: [{ ...mutedTrack, clips: original.clips }] }))
    expect(speech.style.textDecoration).toBe('line-through')
  })

  it('assigns stable per-speaker colors without underlining inactive text', () => {
    const analysis = useTranscriptStore.getState().analyses[0]
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        transcript: {
          ...analysis.transcript,
          units: [
            { id: 'speaker-a-1', text: '你', kind: 'speech' },
            { id: 'speaker-a-2', text: '好', kind: 'speech' },
            { id: 'speaker-b-1', text: '嗯', kind: 'speech' },
            { id: 'unattributed', text: '好', kind: 'speech' },
          ],
        },
        alignment: {
          ...analysis.alignment,
          acousticEditUnits: [
            {
              id: 'acoustic-a-1',
              transcriptUnitIds: ['speaker-a-1'],
              audioSourceId: sourceId,
              sourceStart: 0.1,
              sourceEnd: 0.3,
              granularity: 'character',
            },
            {
              id: 'acoustic-a-2',
              transcriptUnitIds: ['speaker-a-2'],
              audioSourceId: sourceId,
              sourceStart: 0.3,
              sourceEnd: 0.5,
              granularity: 'character',
            },
            {
              id: 'acoustic-b-1',
              transcriptUnitIds: ['speaker-b-1'],
              audioSourceId: sourceId,
              sourceStart: 0.5,
              sourceEnd: 0.7,
              granularity: 'character',
            },
            {
              id: 'acoustic-unattributed',
              transcriptUnitIds: ['unattributed'],
              audioSourceId: sourceId,
              sourceStart: 0.7,
              sourceEnd: 0.9,
              granularity: 'character',
            },
          ],
        },
        speakerAttribution: {
          ...analysis.speakerAttribution,
          attributions: [
            {
              acousticEditUnitId: 'acoustic-a-1',
              speakerId: 'speaker-a',
              ambiguous: false,
            },
            {
              acousticEditUnitId: 'acoustic-a-2',
              speakerId: 'speaker-a',
              ambiguous: false,
            },
            {
              acousticEditUnitId: 'acoustic-b-1',
              speakerId: 'speaker-b',
              ambiguous: false,
            },
          ],
        },
        speakers: [
          { id: 'speaker-a', diarizationLabel: 'SPEAKER_00', defaultDisplayName: 'Speaker 1' },
          { id: 'speaker-b', diarizationLabel: 'SPEAKER_01', defaultDisplayName: 'Speaker 2' },
        ],
      } as never,
    ])

    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const speakerA1 = document.querySelector('[data-unit-id="speaker-a-1"]') as HTMLElement
    const speakerA2 = document.querySelector('[data-unit-id="speaker-a-2"]') as HTMLElement
    const speakerB = document.querySelector('[data-unit-id="speaker-b-1"]') as HTMLElement
    const unattributed = document.querySelector('[data-unit-id="unattributed"]') as HTMLElement

    act(() => {
      const track = useTimelineStore.getState().tracks[0]
      useTimelineStore.setState({ tracks: [track, { ...track, id: 'empty', clips: [] }] })
    })
    const colorA = speakerA1.style.getPropertyValue('--track-color')
    expect(colorA).not.toBe('')
    expect(speakerA2.style.getPropertyValue('--track-color')).toBe(colorA)
    expect(speakerB.style.getPropertyValue('--track-color')).not.toBe(colorA)
    expect(unattributed.style.getPropertyValue('--track-color')).toBe('')
    expect(speakerA1.style.borderBottomStyle).toBe('')
  })
  it('renders both duplicate occurrences and generates a missing track from the header', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        {
          ...track,
          clips: [...track.clips, { ...track.clips[0], id: 'duplicate', outputStart: 8 }],
        },
        {
          ...track,
          id: 'missing',
          name: 'Guest',
          clips: [
            { ...track.clips[0], id: 'guest', audioSourceId: 'other' as never, trackId: 'missing' },
          ],
        },
      ],
    })
    const generate = vi.fn()
    render(<TranscriptPanel onGenerate={generate} isGenerating={false} generatingStatus={null} />)
    expect(document.querySelectorAll('[data-unit-id="speech"]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Generate Guest' }))
    expect(generate).toHaveBeenCalledWith('missing')
    act(() => useTimelineStore.getState().removeClip('duplicate'))
    expect(document.querySelectorAll('[data-unit-id="speech"]')).toHaveLength(1)
  })
  it('offers a local Read / Align switch only for audible overlapping tracks', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        { ...track, clips: track.clips.map((c) => ({ ...c, muted: false })) },
        {
          ...track,
          id: 'guest',
          name: 'Guest',
          clips: track.clips.map((c) => ({
            ...c,
            id: 'guest-clip',
            trackId: 'guest',
            muted: false,
          })),
        },
      ],
    })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    expect(screen.getByRole('button', { name: 'Align' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Align' }))
    expect(screen.getByRole('button', { name: 'Align' }).getAttribute('aria-pressed')).toBe('true')
    act(() => useTimelineStore.getState().updateTrack('guest', { muted: true }))
    expect(screen.queryByRole('button', { name: 'Align' })).toBeNull()
  })
  it('seeks the clicked duplicate output time and highlights simultaneous tracks', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        { ...track, clips: track.clips.map((c) => ({ ...c, muted: false, outputStart: 8 })) },
        {
          ...track,
          id: 'guest',
          clips: track.clips.map((c) => ({
            ...c,
            id: 'guest',
            trackId: 'guest',
            muted: false,
            outputStart: 8,
          })),
        },
      ],
    })
    const seekTo = vi.fn()
    setAudioPlayerInstance({ seekTo } as never)
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    window.getSelection()?.removeAllRanges()
    fireEvent.click(document.querySelector('[data-track-id="guest"][data-unit-id="speech"]')!)
    expect(seekTo).toHaveBeenCalledWith(8.5)
    act(() => usePlaybackStore.getState().setCurrentTime(8.75))
    expect(document.querySelectorAll('[data-playing="true"]')).toHaveLength(2)
    act(() => usePlaybackStore.getState().setCurrentTime(9))
    expect(document.querySelectorAll('[data-playing="true"]')).toHaveLength(0)
  })
  it('deletes only the selected duplicate occurrence and recomputes through undo and redo', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        {
          ...track,
          clips: [
            { ...track.clips[0], muted: false },
            { ...track.clips[0], id: 'duplicate', muted: false, outputStart: 8 },
          ],
        },
      ],
    })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const selected = document.querySelector('[data-clip-id="duplicate"][data-unit-id="speech"]')!
    const range = document.createRange()
    range.selectNodeContents(selected)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.keyDown(screen.getByTestId('canonical-transcript'), {
      key: 'Backspace',
      code: 'Backspace',
    })
    expect(useTimelineStore.getState().tracks[0].clips.find((c) => c.id === 'clip')?.muted).toBe(
      false,
    )
    expect(
      useTimelineStore
        .getState()
        .tracks[0].clips.filter((c) => c.muted)
        .map((c) => c.outputStart),
    ).toEqual([8.5])
    act(() => useTimelineStore.getState().undo())
    expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
    act(() => useTimelineStore.getState().redo())
    expect(document.querySelectorAll('[data-unit-id="speech"]')).toHaveLength(2)
  })
  it('rejects a native selection spanning tracks without muting either track', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        { ...track, clips: track.clips.map((c) => ({ ...c, muted: false })) },
        {
          ...track,
          id: 'guest',
          clips: track.clips.map((c) => ({ ...c, id: 'guest', trackId: 'guest', muted: false })),
        },
      ],
    })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const spans = document.querySelectorAll('[data-unit-id="speech"]')
    const range = document.createRange()
    range.setStart(spans[0].firstChild!, 0)
    range.setEnd(spans[1].firstChild!, 1)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.keyDown(screen.getByTestId('canonical-transcript'), {
      key: 'Backspace',
      code: 'Backspace',
    })
    expect(screen.getByRole('status').textContent).toContain('multiple tracks or clip occurrences')
    expect(screen.queryByRole('button', { name: 'Confirm redaction' })).toBeNull()
    expect(useTimelineStore.getState().tracks.every((t) => t.clips.every((c) => !c.muted))).toBe(
      true,
    )
  })
  it('preserves native Space activation for the local mode controls', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        { ...track, clips: track.clips.map((c) => ({ ...c, muted: false })) },
        {
          ...track,
          id: 'guest',
          clips: track.clips.map((c) => ({ ...c, id: 'guest', trackId: 'guest', muted: false })),
        },
      ],
    })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    expect(
      fireEvent.keyDown(screen.getByRole('button', { name: 'Align' }), { key: ' ', code: 'Space' }),
    ).toBe(true)
  })
  it('keeps untimed punctuation in its attributed speaker paragraph', () => {
    const analysis = useTranscriptStore.getState().analyses[0]
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        speakers: [{ id: 'speaker-a', defaultDisplayName: 'Host', diarizationLabel: 'A' }],
        speakerAttribution: {
          ...analysis.speakerAttribution,
          attributions: [
            { acousticEditUnitId: 'acoustic', speakerId: 'speaker-a', ambiguous: false },
          ],
        },
      } as never,
    ])
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const speech = document.querySelector('[data-unit-id="speech"]')!,
      punctuation = document.querySelector('[data-unit-id="punctuation"]')!
    expect(speech.closest('.transcript-paragraph')).toBe(
      punctuation.closest('.transcript-paragraph'),
    )
    expect(punctuation.getAttribute('data-speaker-id')).toBeNull()
  })
  it('rejects a pending acoustic confirmation after reopening the same project in a new workspace', () => {
    useEditorStore.setState({ session: { workspaceToken: 'first' } as never })
    const analysis = useTranscriptStore.getState().analyses[0]
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        transcript: {
          ...analysis.transcript,
          units: [
            { id: 'speech', text: 'A', kind: 'speech' },
            { id: 'other', text: 'B', kind: 'speech' },
          ],
        },
        alignment: {
          ...analysis.alignment,
          acousticEditUnits: [
            { ...analysis.alignment.acousticEditUnits[0], transcriptUnitIds: ['speech', 'other'] },
          ],
        },
      } as never,
    ])
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [{ ...track, clips: track.clips.map((c) => ({ ...c, muted: false })) }],
    })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('[data-unit-id="speech"]')!)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.keyDown(screen.getByTestId('canonical-transcript'), {
      key: 'Backspace',
      code: 'Backspace',
    })
    act(() => useEditorStore.setState({ session: { workspaceToken: 'second' } as never }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm redaction' }))
    expect(useTimelineStore.getState().tracks[0].clips.every((c) => !c.muted)).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('changed')
  })
  it('refreshes the waveform selection when selected text moves with its clip', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('[data-unit-id="speech"]')!)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent(document, new Event('selectionchange'))
    expect(useEditorStore.getState().selection).toEqual({ start: 0.5, end: 1 })
    act(() => useTimelineStore.getState().moveClip('clip', 8))
    expect(useEditorStore.getState().selection).toEqual({ start: 8.5, end: 9 })
  })
  it('routes M through acoustic confirmation and changes only its selected occurrence', () => {
    const track = useTimelineStore.getState().tracks[0]
    const chosen = { ...track.clips[0], muted: false }
    const duplicate = { ...chosen, id: 'duplicate' }
    useTimelineStore.setState({
      tracks: [{ ...track, clips: [chosen, duplicate] }],
      selectedClipId: 'duplicate',
    })
    const analysis = useTranscriptStore.getState().analyses[0]
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        transcript: {
          ...analysis.transcript,
          units: [
            { id: 'speech' as never, text: '你', kind: 'speech' },
            { id: 'second' as never, text: '好', kind: 'speech' },
          ],
        },
        alignment: {
          ...analysis.alignment,
          acousticEditUnits: [
            {
              ...analysis.alignment.acousticEditUnits[0],
              transcriptUnitIds: ['speech' as never, 'second' as never],
              granularity: 'word',
            },
          ],
        },
      },
    ])
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const element = document.querySelector('[data-clip-id="clip"][data-unit-id="speech"]')!
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.addRange(range)
    fireEvent.keyDown(screen.getByTestId('canonical-transcript'), { key: 'm', code: 'KeyM' })
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm redaction' }))
    expect(
      useTimelineStore.getState().tracks[0].clips.find((clip) => clip.id === 'duplicate'),
    ).toEqual(duplicate)
    expect(
      useTimelineStore
        .getState()
        .tracks[0].clips.filter((clip) => clip.muted)
        .map((clip) => [clip.sourceStart, clip.sourceEnd]),
    ).toEqual([[0.5, 1]])
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  })
  it('does not clear a waveform-owned range on a delayed native selectionchange', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    act(() => {
      window.getSelection()?.removeAllRanges()
      useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set())
      useEditorStore.getState().setSelection({ start: 0.2, end: 0.4 })
    })
    fireEvent(document, new Event('selectionchange'))
    expect(useEditorStore.getState().selection).toEqual({ start: 0.2, end: 0.4 })
  })
})
