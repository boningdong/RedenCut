import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from '../stores/transcript.store'

beforeEach(() => useTranscriptStore.getState().reset())

describe('toggleTrackVisibility', () => {
  it('adds a track that is not yet visible', () => {
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).toContain('t1')
  })

  it('removes a track that is already visible', () => {
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).not.toContain('t1')
  })

  it('toggling one track does not affect another', () => {
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    useTranscriptStore.getState().toggleTrackVisibility('t2')
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    const ids = useTranscriptStore.getState().visibleTrackIds
    expect(ids).not.toContain('t1')
    expect(ids).toContain('t2')
  })
})

describe('ensureTrackVisible', () => {
  it('adds track when absent', () => {
    useTranscriptStore.getState().ensureTrackVisible('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).toContain('t1')
  })

  it('is idempotent — calling twice does not duplicate the id', () => {
    useTranscriptStore.getState().ensureTrackVisible('t1')
    useTranscriptStore.getState().ensureTrackVisible('t1')
    const ids = useTranscriptStore.getState().visibleTrackIds
    expect(ids.filter((id) => id === 't1')).toHaveLength(1)
  })
})

describe('removeWordsForTrack', () => {
  it('removes words belonging to the track', () => {
    useTranscriptStore.getState().setWords([
      { id: 'w1', text: 'a', start: 0, end: 1, muted: false, trackId: 't1' },
      { id: 'w2', text: 'b', start: 1, end: 2, muted: false, trackId: 't2' },
    ])
    useTranscriptStore.getState().removeWordsForTrack('t1')
    const words = useTranscriptStore.getState().words
    expect(words).toHaveLength(1)
    expect(words[0].id).toBe('w2')
  })

  it('removes both the track id from visibleTrackIds and its words atomically', () => {
    useTranscriptStore.getState().setWords([
      { id: 'w1', text: 'a', start: 0, end: 1, muted: false, trackId: 't1' },
      { id: 'w2', text: 'b', start: 1, end: 2, muted: false, trackId: 't2' },
    ])
    useTranscriptStore.getState().ensureTrackVisible('t1')
    useTranscriptStore.getState().ensureTrackVisible('t2')
    useTranscriptStore.getState().removeWordsForTrack('t1')
    const ids   = useTranscriptStore.getState().visibleTrackIds
    const words = useTranscriptStore.getState().words
    expect(ids).not.toContain('t1')
    expect(ids).toContain('t2')
    expect(words.some((w) => w.trackId === 't1')).toBe(false)
  })

  it('leaves other words untouched', () => {
    useTranscriptStore.getState().setWords([
      { id: 'w1', text: 'a', start: 0, end: 1, muted: false, trackId: 't1' },
      { id: 'w2', text: 'b', start: 1, end: 2, muted: false, trackId: 't2' },
    ])
    useTranscriptStore.getState().removeWordsForTrack('t1')
    expect(useTranscriptStore.getState().words[0].trackId).toBe('t2')
  })
})
