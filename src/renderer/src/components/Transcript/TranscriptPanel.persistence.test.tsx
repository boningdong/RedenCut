// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { useEditorStore } from '../../stores/editor.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { TranscriptPanel } from './TranscriptPanel'

const SESSION: RendererSession = {
  workspaceToken: 'workspace-a' as WorkspaceToken,
  revision: 1,
  workspace: { kind: 'saved', displayName: 'Episode', portable: true },
  sources: [],
  speechAnalyses: [],
  draft: {
    tracks: [],
    transcript: {
      engine: 'whisper',
      speakers: {},
      words: [
        {
          id: 'word-1',
          text: 'hello',
          start: 1,
          end: 2,
          muted: false,
        },
      ],
    },
    export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48_000 },
  },
}

describe('TranscriptPanel persisted timestamp edits', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    useEditorStore.getState().reset()
    usePlaybackStore.getState().reset()
    useTimelineStore.getState().reset()
    useTranscriptStore.getState().reset()
    useEditorStore.getState().loadSession(SESSION)
    useTranscriptStore.getState().setWords(SESSION.draft.transcript!.words)
    usePlaybackStore.getState().setCurrentTime(5)
  })

  afterEach(() => {
    cleanup()
  })

  it('marks the current editor revision dirty in the same action that shifts timestamps', () => {
    render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus="" />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync to playhead' }))

    expect(useTranscriptStore.getState().words[0]).toMatchObject({ start: 5, end: 6 })
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, localEditRevision: 1 })
  })
})
