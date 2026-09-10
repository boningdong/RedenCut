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
})
