// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { TranscriptPanel } from './TranscriptPanel'

const sourceId = '550e8400-e29b-41d4-a716-446655440000'

describe('canonical transcript editability', () => {
  beforeEach(() => {
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
  afterEach(cleanup)

  it('visually distinguishes editable speech, punctuation, and unaligned speech consistently', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus="" />)
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

  it('underlines attributed transcript units with stable per-speaker colors', () => {
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

    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus="" />)
    const speakerA1 = document.querySelector('[data-unit-id="speaker-a-1"]') as HTMLElement
    const speakerA2 = document.querySelector('[data-unit-id="speaker-a-2"]') as HTMLElement
    const speakerB = document.querySelector('[data-unit-id="speaker-b-1"]') as HTMLElement
    const unattributed = document.querySelector('[data-unit-id="unattributed"]') as HTMLElement

    expect(speakerA1.style.borderBottomStyle).toBe('solid')
    expect(speakerA1.style.borderBottomWidth).toBe('2px')
    expect(speakerA1.style.borderBottomColor).not.toBe('')
    expect(speakerA2.style.borderBottomColor).toBe(speakerA1.style.borderBottomColor)
    expect(speakerB.style.borderBottomColor).not.toBe(speakerA1.style.borderBottomColor)
    expect(unattributed.style.borderBottomStyle).toBe('')
    expect(screen.getByTestId('speaker-swatch-speaker-a').style.color).toBe(
      speakerA1.style.borderBottomColor,
    )
  })
})
