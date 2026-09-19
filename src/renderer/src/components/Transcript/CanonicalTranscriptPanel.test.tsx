import { WaveformView } from '../Waveform/WaveformView'
// @vitest-environment jsdom

import React from 'react'
import type { TranscriptUnitId, AcousticEditUnitId } from '@shared/speech.types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/PlaybackStore'
import { setAudioPlayerInstance } from '@shared/PlayerTypes'
import { TranscriptPanel } from './TranscriptPanel'
import { useSpeechBatchStore } from '../../stores/speechBatch.store'
import { useLocaleStore } from '../../stores/locale.store'

const sourceId = '550e8400-e29b-41d4-a716-446655440000'

describe('canonical transcript editability', () => {
  beforeEach(() => {
    useLocaleStore.setState({ resolvedLocale: 'en' })
    useSpeechBatchStore.getState().reset()
    usePlaybackStore.getState().reset()
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
          validation: { version: 1, method: 'audio-evidence' },
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

  it.each(['idle', 'running', 'cancelled', 'failed', 'complete'] as const)(
    'shows timing review only inside successful completion details: %s',
    (state) => {
      if (state !== 'idle' && state !== 'running') {
        useSpeechBatchStore.getState().finish({
          sourceCount: 1,
          completedCount: state === 'complete' ? 1 : 0,
          reusedCount: 0,
          cancelled: state === 'cancelled',
          failures:
            state === 'failed'
              ? [
                  {
                    audioSourceId: sourceId as never,
                    displayName: 'Voice.wav',
                    phase: 'text',
                    error: { reason: 'operation-failed' },
                  },
                ]
              : [],
        })
      }
      render(
        <TranscriptPanel
          onGenerate={vi.fn()}
          isGenerating={state === 'running'}
          generatingStatus={null}
        />,
      )
      if (state !== 'complete') {
        expect(screen.queryByText(/Needs review/)).toBeNull()
        return
      }
      expect(screen.getByText('Analysis complete')).toBeTruthy()
      expect(screen.queryByRole('note')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Details' }))
      expect(screen.getByRole('note').textContent).toContain('Needs review')
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss analysis status' }))
      expect(screen.queryByText(/Needs review/)).toBeNull()
    },
  )

  it('offers transient follow and jump feedback without seeking or changing modes', () => {
    vi.useFakeTimers()
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const follow = screen.getByRole('button', { name: 'Follow playback' })
    const jump = screen.getByRole('button', { name: 'Jump to playhead' })
    expect(follow.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(follow)
    void act(() => vi.advanceTimersByTime(599))
    expect(screen.queryByRole('tooltip')).toBeNull()
    void act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip').textContent).toBe('Follow playback')
    fireEvent.click(follow)
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Follow playback: On')).toBeTruthy()
    void act(() => vi.advanceTimersByTime(1200))
    expect(screen.queryByText('Follow playback: On')).toBeNull()
    fireEvent.click(jump)
    expect(screen.getByText('No transcript at the current position')).toBeTruthy()
    expect(usePlaybackStore.getState().currentTime).toBe(0)
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    void act(() => vi.advanceTimersByTime(1200))
    expect(screen.queryByText('No transcript at the current position')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continuous text' }))
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    fireEvent.wheel(screen.getByTestId('canonical-transcript'), { deltaY: 30 })
    expect(follow.getAttribute('aria-pressed')).toBe('false')
    act(() => useTranscriptStore.getState().reset())
    expect(useTranscriptStore.getState().followPlayback).toBe(false)
    vi.useRealTimers()
  })

  it('announces a successful paused jump for 1.2 seconds without changing playback', () => {
    vi.useFakeTimers()
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [{ ...track, clips: [{ ...track.clips[0], muted: false }] }],
    })
    usePlaybackStore.getState().setCurrentTime(0.75)
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const viewport = screen.getByTestId('canonical-transcript')
    const unit = document.querySelector('[data-unit-id="speech"]')!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 400,
      height: 400,
    } as DOMRect)
    vi.spyOn(unit, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      bottom: 620,
      height: 20,
    } as DOMRect)
    const scroll = vi.fn()
    viewport.scrollTo = scroll
    fireEvent.click(screen.getByRole('button', { name: 'Jump to playhead' }))
    expect(scroll).toHaveBeenCalledWith({ top: 410, behavior: 'smooth' })
    expect(screen.getByRole('status').textContent).toBe('Jumped to current playback position')
    expect(usePlaybackStore.getState().currentTime).toBe(0.75)
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(useTranscriptStore.getState().followPlayback).toBe(false)
    void act(() => vi.advanceTimersByTime(1200))
    expect(screen.queryByText('Jumped to current playback position')).toBeNull()
    vi.useRealTimers()
  })

  it('keeps toolbar controls mounted and puts unassigned speech in the speaker tag row', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const manage = screen.getByRole('button', { name: 'Manage people' }) as HTMLButtonElement
    const modes = screen.getByRole('group', { name: 'Transcript display' })
    const unassigned = screen.getByRole('button', { name: 'Show Unassigned speaker' })
    expect(unassigned.closest('.identity-tags')).not.toBeNull()
    fireEvent.click(manage)
    expect(screen.getByRole('complementary', { name: 'Manage people' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continuous text' }))
    expect(screen.getByRole('button', { name: 'Manage people' })).toBe(manage)
    expect(manage.disabled).toBe(true)
    expect(screen.queryByRole('complementary', { name: 'Manage people' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Transcript display' })).toBe(modes)
    expect(screen.queryByRole('button', { name: 'Show Unassigned speaker' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'By speaker' }))
    expect(manage.disabled).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'Manage people' })).toBeNull()
  })

  it('shows hidden text in continuous mode and restores speaker filters on switching back', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show Unassigned speaker' }))
    expect(document.querySelector('[data-unit-id="speech"]')).toBeNull()
    const tracks = useTimelineStore.getState().tracks
    fireEvent.click(screen.getByRole('button', { name: 'Continuous text' }))
    expect(document.querySelector('[data-unit-id="speech"]')).toBeTruthy()
    expect(document.querySelector('.transcript-speaker')).toBeNull()
    expect(useTimelineStore.getState().tracks).toBe(tracks)
    fireEvent.click(screen.getByRole('button', { name: 'By speaker' }))
    expect(document.querySelector('[data-unit-id="speech"]')).toBeNull()
  })

  it('updates playback highlighting without rerendering a long transcript or disturbing selection', () => {
    const analysis = useTranscriptStore.getState().analyses[0]
    let textReads = 0
    const units = Array.from({ length: 2000 }, (_, index) => ({
      id: `word-${index}` as TranscriptUnitId,
      kind: 'speech' as const,
      get text() {
        textReads++
        return '字'
      },
    }))
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        transcript: { ...analysis.transcript, units },
        alignment: {
          ...analysis.alignment,
          acousticEditUnits: units.map((unit, index) => ({
            ...analysis.alignment.acousticEditUnits[0],
            id: `acoustic-${index}` as AcousticEditUnitId,
            transcriptUnitIds: [unit.id],
            sourceStart: index,
            sourceEnd: index + 0.5,
          })),
        },
      },
    ])
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [{ ...track, clips: [{ ...track.clips[0], muted: false, sourceEnd: 2000 }] }],
    })
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const first = document.querySelector('[data-unit-id="word-0"]')!
    const second = document.querySelector('[data-unit-id="word-1"]')!
    const range = document.createRange()
    range.setStart(first.firstChild!, 0)
    range.setEnd(second.firstChild!, 1)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    textReads = 0

    for (let tick = 1; tick <= 20; tick++) {
      act(() => usePlaybackStore.getState().setCurrentTime(tick / 100))
    }
    act(() => usePlaybackStore.getState().setCurrentTime(1000.25))
    expect(document.querySelector('[data-playing="true"]')?.getAttribute('data-unit-id')).toBe(
      'word-1000',
    )
    act(() => usePlaybackStore.getState().setCurrentTime(0.25))
    expect(first.getAttribute('data-playing')).toBe('true')
    act(() => usePlaybackStore.getState().setCurrentTime(0.5))
    expect(document.querySelectorAll('[data-playing="true"]')).toHaveLength(0)
    expect(window.getSelection()?.toString()).toBe('字字')
    expect(document.querySelector('[data-unit-id="word-0"]')).toBe(first)
    // Only words entering/leaving the playhead may need their display content again.
    expect(textReads).toBeLessThan(50)
  })

  it('hides recognized people without timeline clips from management', () => {
    const analysis = useTranscriptStore.getState().analyses[0]
    const detached = {
      ...analysis,
      audioSourceId: 'detached' as never,
      speakers: [
        {
          id: 'guest' as never,
          analysisRevisionId: analysis.analysisRevisionId,
          diarizationLabel: 'SPEAKER_00',
          defaultDisplayName: 'Detached guest',
        },
      ],
    }
    useTranscriptStore.getState().loadAnalyses([analysis, detached])
    render(<TranscriptPanel onGenerate={() => {}} isGenerating={false} generatingStatus={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
    expect(screen.queryByRole('button', { name: 'Edit Detached guest' })).toBeNull()
  })
  afterEach(() => {
    cleanup()
    useLocaleStore.setState({ resolvedLocale: 'en' })
    setAudioPlayerInstance(null)
    window.getSelection()?.removeAllRanges()
  })

  it('filters unassigned speech explicitly and distinguishes all hidden from an empty timeline', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const toggle = screen.getByRole('button', { name: 'Show Unassigned speaker' })
    expect(document.querySelector('[data-unit-id="speech"]')).toBeTruthy()
    fireEvent.click(toggle)
    expect(document.querySelector('[data-unit-id="speech"]')).toBeNull()
    expect(screen.getByText('All speakers hidden')).toBeTruthy()
    fireEvent.click(toggle)
    expect(document.querySelector('[data-unit-id="speech"]')).toBeTruthy()
  })

  it('keeps pending text visible when identified speakers are hidden', () => {
    const analysis = useTranscriptStore.getState().analyses[0]
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        diarizationStatus: 'pending',
        speakers: [
          {
            id: 'speaker' as never,
            analysisRevisionId: analysis.analysisRevisionId,
            diarizationLabel: 'SPEAKER_00',
            defaultDisplayName: 'Guest',
          },
        ],
      },
    ])
    useTranscriptStore.getState().toggleSpeakerVisibility(`${sourceId}:revision:speaker`)
    render(
      <TranscriptPanel
        onGenerate={vi.fn()}
        isGenerating
        generatingStatus={{ stage: 'diarizing' }}
      />,
    )
    expect(document.querySelector('[data-unit-id="speech"]')).toBeTruthy()
    expect(screen.queryByText('All speakers hidden')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByText(/Text ready to edit/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show Unassigned speaker' }))
    expect(screen.getByText('All speakers hidden')).toBeTruthy()
  })

  it('keeps old text readable but prevents seek and redaction until timing is validated', () => {
    const analysis = useTranscriptStore.getState().analyses[0]
    const legacy = { ...analysis, alignment: { ...analysis.alignment, validation: undefined } }
    useTranscriptStore.getState().loadAnalyses([legacy])
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [{ ...track, clips: track.clips.map((c) => ({ ...c, muted: false })) }],
    })
    const seekTo = vi.fn()
    setAudioPlayerInstance({ seekTo } as never)
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const speech = document.querySelector('[data-unit-id="speech"]')!
    expect(speech.textContent).toBe('觉')
    expect(speech.getAttribute('data-acoustic-editable')).toBe('false')
    fireEvent.click(speech)
    expect(seekTo).not.toHaveBeenCalled()
    const range = document.createRange()
    range.selectNodeContents(speech)
    window.getSelection()?.addRange(range)
    fireEvent.keyDown(screen.getByTestId('canonical-transcript'), { code: 'Delete', key: 'Delete' })
    expect(screen.queryByRole('button', { name: 'Confirm redaction' })).toBeNull()
    expect(useTimelineStore.getState().tracks[0].clips[0].muted).toBe(false)
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
    const button = screen.getByRole('button', { name: 'Generate' })
    act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
    expect(screen.getByRole('button', { name: '生成' })).toBe(button)
    fireEvent.click(button)
    fireEvent.change(screen.getByLabelText('处理范围'), { target: { value: track.id } })
    expect(screen.getByRole('option', { name: 'T1 · <My guest>' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始处理' }))
    expect(generate).toHaveBeenCalledWith(track.id)
    expect(useTimelineStore.getState().tracks[0].name).toBe('<My guest>')
  })

  it('visually distinguishes editable speech, punctuation, and unaligned speech consistently', () => {
    useTimelineStore.setState({
      tracks: useTimelineStore.getState().tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          redactions: [{ id: 'r', sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd }],
        })),
      })),
    })
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
    expect(speech.style.textDecoration).not.toBe('line-through')
    expect(speech.style.opacity).toBe('0.5')
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
          validation: { version: 1, method: 'audio-evidence' },
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
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    fireEvent.change(screen.getByLabelText('Tracks to process'), { target: { value: 'missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start processing' }))
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
  it('reveals offscreen transcript seeks at the current zoom without following ordinary playback', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [
        { ...track, clips: track.clips.map((clip) => ({ ...clip, muted: false, outputStart: 8 })) },
      ],
    })
    setAudioPlayerInstance({
      seekTo: (time: number) => usePlaybackStore.getState().setCurrentTime(time),
    } as never)
    render(
      <>
        <TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />
        <WaveformView duration={10} providersBySource={new Map()} onAddTrack={vi.fn()} />
      </>,
    )
    const content = document.querySelector('#waveform-timeline')!.parentElement!
    const viewport = content.parentElement!
    Object.defineProperties(viewport, {
      clientWidth: { value: 800 },
      scrollWidth: { get: () => Number.parseFloat(content.style.width) },
    })
    fireEvent.click(screen.getByTitle('Zoom in'))
    viewport.scrollLeft = 0
    const zoomedWidth = content.style.width
    const word = document.querySelector('[data-unit-id="speech"]')!
    window.getSelection()?.removeAllRanges()
    fireEvent.click(word)
    // Output 8.5s at 160px/s is centered in the 800px viewport.
    expect(viewport.scrollLeft).toBe(960)
    expect(content.style.width).toBe(zoomedWidth)
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    viewport.scrollLeft = 1000
    fireEvent.click(word)
    expect(viewport.scrollLeft).toBe(1000)
    viewport.scrollLeft = 0
    fireEvent.click(word)
    expect(viewport.scrollLeft).toBe(960)
    act(() => usePlaybackStore.getState().setCurrentTime(0))
    expect(viewport.scrollLeft).toBe(960)
    // Drag selection must not navigate or scroll.
    viewport.scrollLeft = 0
    const range = document.createRange()
    range.selectNodeContents(word)
    window.getSelection()?.addRange(range)
    fireEvent.click(word)
    expect(viewport.scrollLeft).toBe(0)
    expect(usePlaybackStore.getState().currentTime).toBe(0)
    // Seeking toward the beginning reveals a target to the left, clamped at zero.
    window.getSelection()?.removeAllRanges()
    act(() =>
      useTimelineStore.setState({
        tracks: [{ ...track, clips: track.clips.map((clip) => ({ ...clip, muted: false })) }],
      }),
    )
    viewport.scrollLeft = 1000
    fireEvent.click(document.querySelector('[data-unit-id="speech"]')!)
    expect(viewport.scrollLeft).toBe(0)
    vi.unstubAllGlobals()
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
        .tracks[0].clips.flatMap((c) =>
          (c.redactions ?? []).map((r) => c.outputStart + r.sourceStart - c.sourceStart),
        ),
    ).toEqual([8.5])
    void act(() => useTimelineStore.getState().undo())
    expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
    void act(() => useTimelineStore.getState().redo())
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
    expect(screen.getByRole('status').textContent).toContain('continuous audio range on one track')
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
          validation: { version: 1, method: 'audio-evidence' },
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
  it('keeps native text selection while publishing a highlight to its waveform track', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    render(
      <>
        <TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />
        <WaveformView duration={2} providersBySource={new Map()} onAddTrack={vi.fn()} />
      </>,
    )
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('[data-unit-id="speech"]')!)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent(document, new Event('selectionchange'))
    expect(window.getSelection()?.isCollapsed).toBe(false)
    expect(
      document.querySelector('[data-lane="track"] [data-range-selection="transcript"]'),
    ).not.toBeNull()
    act(() => window.getSelection()?.removeAllRanges())
    fireEvent(document, new Event('selectionchange'))
    expect(document.querySelector('[data-range-selection]')).toBeNull()
    vi.unstubAllGlobals()
  })
  it('refreshes the waveform selection when selected text moves with its clip', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('[data-unit-id="speech"]')!)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent(document, new Event('selectionchange'))
    expect(useEditorStore.getState().selection).toEqual({
      origin: 'transcript',
      trackId: 'track',
      start: 0.5,
      end: 1,
    })
    act(() => useTimelineStore.getState().moveClip('clip', 8))
    expect(useEditorStore.getState().selection).toEqual({
      origin: 'transcript',
      trackId: 'track',
      start: 8.5,
      end: 9,
    })
  })
  it('confirms exact grouped text and limits a partial acoustic edit to its selected occurrence', () => {
    const track = useTimelineStore.getState().tracks[0]
    const chosen = { ...track.clips[0], sourceStart: 0.75, muted: false }
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
          validation: { version: 1, method: 'audio-evidence' },
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
    expect(screen.getByRole('status').textContent).toContain(
      'Redacting “你” requires including “你好”',
    )
    expect(element.getAttribute('data-partial')).toBe('true')
    expect(element.getAttribute('title')).toContain('only the retained audio is editable')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm redaction' }))
    expect(
      useTimelineStore.getState().tracks[0].clips.find((clip) => clip.id === 'duplicate'),
    ).toEqual(duplicate)
    expect(
      useTimelineStore
        .getState()
        .tracks[0].clips.flatMap((clip) =>
          (clip.redactions ?? []).map((r) => [r.sourceStart, r.sourceEnd]),
        ),
    ).toEqual([[0.75, 1]])
    expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  })
  it('redacts a whole sentence around unmapped internal text while speakers are still generating', () => {
    const track = useTimelineStore.getState().tracks[0]
    useTimelineStore.setState({
      tracks: [{ ...track, clips: track.clips.map((clip) => ({ ...clip, muted: false })) }],
    })
    const analysis = useTranscriptStore.getState().analyses[0]
    useTranscriptStore.getState().loadAnalyses([
      {
        ...analysis,
        diarizationStatus: 'pending',
        transcript: {
          ...analysis.transcript,
          units: [
            { id: 'speech' as never, text: '我', kind: 'speech' },
            { id: 'middle' as never, text: '嗯', kind: 'speech' },
            { id: 'end' as never, text: '好', kind: 'speech' },
          ],
        },
        alignment: {
          ...analysis.alignment,
          acousticEditUnits: [
            { ...analysis.alignment.acousticEditUnits[0], sourceStart: 0.2, sourceEnd: 0.5 },
            {
              ...analysis.alignment.acousticEditUnits[0],
              id: 'end-audio' as never,
              transcriptUnitIds: ['end' as never],
              sourceStart: 1,
              sourceEnd: 1.5,
            },
          ],
        },
      },
    ])
    render(
      <TranscriptPanel
        onGenerate={vi.fn()}
        isGenerating
        generatingStatus={{ stage: 'diarizing' }}
      />,
    )
    const range = document.createRange()
    range.setStart(document.querySelector('[data-unit-id="speech"]')!.firstChild!, 0)
    range.setEnd(document.querySelector('[data-unit-id="end"]')!.firstChild!, 1)
    window.getSelection()!.addRange(range)
    fireEvent.keyDown(screen.getByTestId('canonical-transcript'), { key: 'Delete', code: 'Delete' })
    expect(
      useTimelineStore
        .getState()
        .tracks[0].clips.flatMap((clip) =>
          (clip.redactions ?? []).map((r) => [r.sourceStart, r.sourceEnd]),
        ),
    ).toEqual([[0.2, 1.5]])
    expect(screen.queryByRole('button', { name: 'Confirm redaction' })).toBeNull()
    expect(
      useTranscriptStore
        .getState()
        .analyses[0].transcript.units.map((unit) => unit.text)
        .join(''),
    ).toBe('我嗯好')
  })
  it('does not clear a waveform-owned range on a delayed native selectionchange', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus={null} />)
    act(() => {
      window.getSelection()?.removeAllRanges()
      useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set())
      useEditorStore
        .getState()
        .setSelection({ origin: 'timeline', trackId: 'track', start: 0.2, end: 0.4 })
    })
    fireEvent(document, new Event('selectionchange'))
    expect(useEditorStore.getState().selection).toEqual({
      origin: 'timeline',
      trackId: 'track',
      start: 0.2,
      end: 0.4,
    })
  })
})
