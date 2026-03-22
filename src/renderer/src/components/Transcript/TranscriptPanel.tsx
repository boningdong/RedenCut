// ─────────────────────────────────────────────────────────────────────────────
// TranscriptPanel
//
// Renders the transcript as a read-only contentEditable region so users get:
//   • A blinking text cursor (caret) on click — feels like a real text editor
//   • Native character-level text selection: click-drag, double-click word,
//     Shift+arrow to extend — works for both Latin and individual CJK chars
//   • Seeking: clicking a word seeks the playhead to that word's start time
//   • Delete/Backspace on a text selection → mutes the audio range covered by
//     all word spans that intersect the native selection
//   • Strikethrough display for muted words (with toggle to hide them)
//
// The div is contentEditable but ALL content-modifying input is prevented via
// onBeforeInput, so the DOM never changes from user typing — only from React
// re-rendering when word mute state changes.
//
// Bidirectional sync:
//   Playhead → transcript   on timeupdate, currentWord underline scrolled into view
//   Transcript → playhead   clicking a word calls ws.setTime(word.start)
//   Transcript selection → waveform   selectionchange → setSelection({ start, end })
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlaybackStore } from '../../stores/playback.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { getAudioPlayerInstance } from '@shared/player.types'
import type { Word } from '@shared/project.types'

interface TranscriptPanelProps {
  /** Called when the user clicks "Generate Transcript". Optionally scoped to a track. */
  onGenerate: (trackId?: string) => void
  /** True while transcription is running. */
  isGenerating: boolean
  /** Status message during generation. */
  generatingStatus: string
}

export function TranscriptPanel({
  onGenerate,
  isGenerating,
  generatingStatus,
}: TranscriptPanelProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration    = usePlaybackStore((s) => s.duration)

  const words              = useTranscriptStore((s) => s.words)
  const showMutedWords     = useTranscriptStore((s) => s.showMutedWords)
  const muteWords          = useTranscriptStore((s) => s.muteWords)
  const toggleShowMuted    = useTranscriptStore((s) => s.toggleShowMutedWords)
  const shiftTimestamps    = useTranscriptStore((s) => s.shiftTimestamps)
  const activeTrackFilter  = useTranscriptStore((s) => s.activeTrackFilter)
  const setActiveTrackFilter = useTranscriptStore((s) => s.setActiveTrackFilter)

  const tracks      = useTimelineStore((s) => s.tracks)
  const sourceFiles = useTimelineStore((s) => s.sourceFiles)

  const setSelection = useEditorStore((s) => s.setSelection)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null)
  const currentWordRef = useRef<HTMLSpanElement | null>(null)
  /** Map from word.id → the rendered <span> element, for selection intersection. */
  const wordEls = useRef<Map<string, HTMLSpanElement>>(new Map())

  // ── Current word (playhead → transcript) ─────────────────────────────────
  const currentWordId = useMemo(() => {
    if (words.length === 0) return null
    return words.find((w) => currentTime >= w.start && currentTime <= w.end)?.id ?? null
  }, [currentTime, words])

  // Scroll current word into view
  useEffect(() => {
    currentWordRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentWordId])

  // ── Native selection → waveform selection ─────────────────────────────────
  // When the user drags to select text we map the selected word spans to a
  // time range and push it to the editor store so the waveform region updates.
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      // Only act when the selection is inside our container
      if (!containerRef.current?.contains(range.commonAncestorContainer)) return

      const selected = words.filter((w) => {
        const el = wordEls.current.get(w.id)
        return el != null && range.intersectsNode(el)
      })
      if (selected.length === 0) { setSelection(null); return }
      setSelection({
        start: Math.min(...selected.map((w) => w.start)),
        end:   Math.max(...selected.map((w) => w.end)),
      })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [words, setSelection])

  // ── Seek on word click ────────────────────────────────────────────────────
  // Use onClick (not mousedown) so we don't interfere with drag-selection start.
  const handleWordClick = useCallback(
    (e: React.MouseEvent, word: Word) => {
      e.stopPropagation()
      if (duration > 0) getAudioPlayerInstance()?.seekTo(word.start)
    },
    [duration],
  )

  // ── Manual timestamp calibration ─────────────────────────────────────────
  // The user positions the playhead exactly where the first word starts, then
  // clicks "Sync to playhead". We shift every word's timestamps by the
  // difference so the first word aligns with the current playhead position.
  const handleCalibrateOffset = useCallback(() => {
    if (words.length === 0) return
    const firstWord = words[0]
    const offset = currentTime - firstWord.start
    if (Math.abs(offset) < 0.01) return   // already aligned — nothing to do
    shiftTimestamps(offset)
  }, [words, currentTime, shiftTimestamps])

  // ── Delete/Backspace: mute the words that intersect the native selection ──
  const handleDeleteFromSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return

    const selected = words.filter((w) => {
      const el = wordEls.current.get(w.id)
      return el != null && range.intersectsNode(el)
    })
    if (selected.length === 0) return

    const start   = Math.min(...selected.map((w) => w.start))
    const end     = Math.max(...selected.map((w) => w.end))
    const wordIds = selected.map((w) => w.id)

    // Mute via timeline.store — route to the correct source file per word.
    // If viewing a specific track, route the delete to that track's source file.
    const { sourceFiles: sfList, muteRange } = useTimelineStore.getState()
    const { tracks: tList } = useTimelineStore.getState()
    const activeTrackForDelete = activeTrackFilter ? tList.find((t) => t.id === activeTrackFilter) : null
    const sfId = activeTrackForDelete?.clips[0]?.sourceFileId
              ?? selected[0]?.sourceFileId
              ?? sfList[0]?.id
    if (sfId) muteRange(sfId, start, end, wordIds)
    muteWords(wordIds)
    sel.removeAllRanges()       // clear the native selection after muting
    setSelection(null)
  }, [words, muteWords, setSelection, activeTrackFilter])

  // ── Keyboard handler on the contentEditable container ────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let CMD+shortcuts (copy, undo, etc.) pass through to global handlers
      if (e.metaKey || e.ctrlKey) return

      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()   // don't let the global shortcut double-fire
        handleDeleteFromSelection()
        return
      }

      // Space — play/pause audio.
      // We call stopPropagation so the document-level useKeyboardShortcuts
      // handler doesn't fire a second time (it already carves out Space for
      // contentEditable, but belt-and-suspenders never hurts).
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        getAudioPlayerInstance()?.playPause().catch(console.error)
        return
      }

      // Prevent the user from actually typing into the transcript
      if (e.key.length === 1) {
        e.preventDefault()
      }
    },
    [handleDeleteFromSelection],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  // Find the active track to get its sourceFileId for word filtering.
  // activeTrackFilter now stores a trackId (not sourceFileId) for uniqueness.
  const activeTrack   = activeTrackFilter ? tracks.find((t) => t.id === activeTrackFilter) : null
  const activeSfId    = activeTrack?.clips[0]?.sourceFileId

  const visibleWords  = words
    .filter((w) => !activeTrackFilter || (activeSfId != null ? w.sourceFileId === activeSfId : false))
    .filter((w) => showMutedWords || !w.muted)

  const hasTranscript = visibleWords.length > 0

  const primarySfId = sourceFiles[0]?.id

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--color-bg-secondary)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px var(--space-3)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Transcript
        </span>
        {hasTranscript && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={handleCalibrateOffset}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: '2px 4px' }}
              title="Shift all word timestamps so the first word aligns with the current playhead position"
            >
              Sync to playhead
            </button>
            <span style={{ color: 'var(--color-border)', userSelect: 'none' }}>·</span>
            <button
              onClick={toggleShowMuted}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: '2px 4px' }}
              title={showMutedWords ? 'Hide deleted words' : 'Show deleted words'}
            >
              {showMutedWords ? 'Hide deleted' : 'Show deleted'}
            </button>
          </div>
        )}
      </div>

      {/* ── Track filter pills ───────────────────────────────────────────── */}
      {tracks.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px var(--space-3)',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {/* "All" pill */}
          <button
            onClick={() => setActiveTrackFilter(null)}
            style={{
              background: activeTrackFilter === null ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
              border: 'none',
              borderRadius: 10,
              color: activeTrackFilter === null ? '#fff' : 'var(--color-text-secondary)',
              fontSize: 10,
              padding: '2px 8px',
              cursor: 'pointer',
              letterSpacing: '0.03em',
            }}
          >
            All
          </button>

          {/* Per-track pills */}
          {tracks.map((track) => {
            const trackSfId = track.clips[0]?.sourceFileId
            const isActive  = activeTrackFilter === track.id
            const hasWords  = trackSfId != null && words.some((w) => w.sourceFileId === trackSfId)
            const dotColor  = track.color

            return (
              <button
                key={track.id}
                onClick={() => {
                  if (activeTrackFilter !== track.id) {
                    setActiveTrackFilter(track.id)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: isActive ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
                  border: 'none',
                  borderRadius: 10,
                  color: isActive ? '#fff' : 'var(--color-text-secondary)',
                  fontSize: 10,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  letterSpacing: '0.03em',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: isActive ? '#fff' : dotColor,
                    flexShrink: 0,
                  }}
                />
                {track.name}
                {!hasWords && (
                  <span style={{ opacity: 0.7, marginLeft: 2 }}>+ generate</span>
                )}
              </button>
            )
          })}

        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {isGenerating ? (
        <GeneratingState status={generatingStatus} />
      ) : !hasTranscript ? (
        <EmptyTranscriptState onGenerate={onGenerate} activeTrackId={activeTrackFilter} />
      ) : (
        // contentEditable gives a blinking text cursor and native character-
        // level text selection. onBeforeInput prevents any actual DOM edits.
        <div
          ref={containerRef}
          contentEditable
          suppressContentEditableWarning
          role="region"
          aria-label="Transcript"
          onBeforeInput={(e) => e.preventDefault()}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-3)',
            lineHeight: 1.9,
            fontSize: 'var(--text-sm)',
            outline: 'none',
            cursor: 'text',
            userSelect: 'text',
          }}
        >
          {visibleWords.map((word) => {
            const isCurrent = word.id === currentWordId

            return (
              <span
                key={word.id}
                ref={(el) => {
                  if (el) wordEls.current.set(word.id, el)
                  else wordEls.current.delete(word.id)
                  if (isCurrent) currentWordRef.current = el
                }}
                onClick={(e) => handleWordClick(e, word)}
                style={{
                  display: 'inline',
                  marginRight: word.text.match(/[\u2E80-\u9FFF]/) ? '0' : '0.25em',
                  borderRadius: 2,
                  padding: '1px 1px',
                  // Muted: strikethrough + dimmed; non-primary tracks: slightly dimmed
                  textDecoration: word.muted ? 'line-through' : 'none',
                  opacity: word.muted
                    ? 0.45
                    : (!word.sourceFileId || word.sourceFileId === primarySfId)
                      ? 1
                      : 0.6,
                  // Current word: accent underline
                  borderBottom: isCurrent
                    ? '2px solid var(--color-accent)'
                    : '2px solid transparent',
                  color: 'var(--color-text-primary)',
                }}
              >
                {word.text}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyTranscriptState({
  onGenerate,
  activeTrackId,
}: {
  onGenerate:    (trackId?: string) => void
  activeTrackId: string | null
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', textAlign: 'center' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>No transcript yet</p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', maxWidth: 180 }}>Requires whisper-cli installed via brew</p>
      <button
        onClick={() => onGenerate(activeTrackId ?? undefined)}
        style={{ marginTop: 'var(--space-1)', background: 'var(--color-accent)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 'var(--text-xs)', padding: '6px 14px', cursor: 'pointer', letterSpacing: '0.04em' }}
      >
        Generate Transcript
      </button>
      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
        {activeTrackId ? 'Generates transcript for this track' : 'Generates transcripts for all tracks'}
      </p>
    </div>
  )
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function GeneratingState({ status }: { status: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  // Extract percentage from status string to render a progress bar
  const pctMatch = status.match(/(\d+)%/)
  const pct = pctMatch ? parseInt(pctMatch[1], 10) : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', textAlign: 'center' }}>
      <SpinnerIcon />
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Generating transcript…
      </p>

      {/* Progress bar — shown once whisper starts reporting percentages */}
      {pct !== null && (
        <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ width: '100%', height: 3, backgroundColor: 'var(--color-bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--color-accent)', transition: 'width 0.4s ease' }} />
          </div>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
            {pct}%
          </span>
        </div>
      )}

      {status && !pctMatch && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', maxWidth: 200 }}>
          {status}
        </p>
      )}

      {elapsed > 0 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
          {formatElapsed(elapsed)} elapsed
        </p>
      )}
    </div>
  )
}

function SpinnerIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round"
      style={{ animation: 'spin 1s linear infinite' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
      <path d="M12 2 a10 10 0 0 1 10 10" />
    </svg>
  )
}
