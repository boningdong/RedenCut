import type { SpeechBatchScope } from '@shared/speechBatch.types'
import type { SpeechTaskSelection } from '@shared/SpeechTaskPlanner'
import { SpeechTaskPopover } from './SpeechTaskPopover'
import { TranscriptDisplaySwitch } from './TranscriptDisplaySwitch'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import { useTranslation } from '../../i18n/useTranslation'
import type { SpeechProgress, TranscriptionProgress } from '@shared/publicMessages'
import { TranscriptStatusFooter } from './TranscriptStatusFooter'
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

import { togglePlayback } from '../../actions/PlaybackActions'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePlaybackStore } from '../../stores/PlaybackStore'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useEditorStore, type EditorSelection } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import { seekFromTranscript } from '../../actions/PlaybackActions'
import type { Word } from '@shared/ProjectTypes'
import { getWordClipState, type WordClipState } from '../../utils/wordClipState'
import { getWordOutputTime } from '../../utils/wordOutputTime'
import { trackPresentationColor } from '../../themes/trackColors'
import { CanonicalTranscriptPanel } from './CanonicalTranscriptPanel'

export interface TranscriptPanelProps {
  onSaveSpeakerIdentities?: (
    expected: SpeakerIdentityCatalog,
    next: SpeakerIdentityCatalog,
  ) => Promise<void>
  workspaceControls?: React.ReactNode
  /** Called when the user clicks "Generate Transcript". Optionally scoped to a track. */
  onGenerate: (trackId?: string) => void
  onRegenerate?: () => void
  onRun?: (scope: SpeechBatchScope, tasks: SpeechTaskSelection) => void
  /** True while transcription is running. */
  isGenerating: boolean
  onCancel?: () => void
  /** Status message during generation. */
  generatingStatus: SpeechProgress | TranscriptionProgress | null
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const analyses = useTranscriptStore((state) => state.analyses)
  return analyses.length > 0 ? (
    <CanonicalTranscriptPanel {...props} analyses={analyses} />
  ) : (
    <LegacyTranscriptPanel {...props} />
  )
}

function LegacyTranscriptPanel({
  workspaceControls,
  onGenerate,
  onRun,
  isGenerating,
  generatingStatus,
  onCancel,
}: TranscriptPanelProps) {
  const { t } = useTranslation()
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration = usePlaybackStore((s) => s.duration)

  const words = useTranscriptStore((s) => s.words)
  const showMutedWords = useTranscriptStore((s) => s.showMutedWords)
  const toggleShowMuted = useTranscriptStore((s) => s.toggleShowMutedWords)
  const shiftTimestamps = useTranscriptStore((s) => s.shiftTimestamps)
  const visibleTrackIds = useTranscriptStore((s) => s.visibleTrackIds)
  const toggleTrackVisibility = useTranscriptStore((s) => s.toggleTrackVisibility)

  const tracks = useTimelineStore((s) => s.tracks)

  const setSelection = useEditorStore((s) => s.setSelection)
  const markEdited = useEditorStore((s) => s.markEdited)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const currentWordRef = useRef<HTMLSpanElement | null>(null)
  /** Map from word.id → the rendered <span> element, for selection intersection. */
  const wordEls = useRef<Map<string, HTMLSpanElement>>(new Map())
  const ownedSelection = useRef<EditorSelection | null>(null)

  // ── Track color map — used for per-track underlines in "All" view ────────
  const trackColorMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tracks) m.set(t.id, trackPresentationColor(t.color))
    return m
  }, [tracks])

  // Convert to Set once — O(1) lookups in the visibleWords filter
  const visibleSet = useMemo(() => new Set(visibleTrackIds), [visibleTrackIds])

  // Tracks that have at least one word (pill is shown for these)
  const tracksWithTranscript = useMemo(
    () => tracks.filter((t) => words.some((w) => w.trackId === t.id)),
    [tracks, words],
  )

  // True when any words exist, regardless of visibility filter — guards empty-state copy
  const hasAnyWords = words.length > 0

  // ── Current word (playhead → transcript) ─────────────────────────────────
  // Compare against output-timeline time (not source timestamps) so reordered
  // clips highlight the correct word.
  const currentWordId = useMemo(() => {
    if (words.length === 0) return null
    return (
      words.find((w) => {
        const outputStart = getWordOutputTime(w, tracks)
        const outputEnd = outputStart + (w.end - w.start)
        return currentTime >= outputStart && currentTime <= outputEnd
      })?.id ?? null
    )
  }, [currentTime, words, tracks])

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
        if (
          ownedSelection.current &&
          useEditorStore.getState().selection === ownedSelection.current
        )
          setSelection(null)
        ownedSelection.current = null
        return
      }
      const range = sel.getRangeAt(0)
      // Only act when the selection is inside our container
      if (!containerRef.current?.contains(range.commonAncestorContainer)) return

      const selected = words.filter((w) => {
        const el = wordEls.current.get(w.id)
        return el != null && range.intersectsNode(el)
      })
      if (selected.length === 0) {
        setSelection(null)
        return
      }
      const trackId = selected[0].trackId ?? useTimelineStore.getState().selectedTrackId
      if (!trackId || selected.some((word) => word.trackId && word.trackId !== trackId)) {
        setSelection(null)
        return
      }
      const next: EditorSelection = {
        origin: 'transcript',
        trackId,
        start: Math.min(...selected.map((w) => w.start)),
        end: Math.max(...selected.map((w) => w.end)),
      }
      ownedSelection.current = next
      setSelection(next)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [words, setSelection])

  // ── Seek on word click ────────────────────────────────────────────────────
  // Use onClick (not mousedown) so we don't interfere with drag-selection start.
  const handleWordClick = useCallback(
    (e: React.MouseEvent, word: Word) => {
      e.stopPropagation()
      // Seek to the word's output-timeline position so the playhead lands at
      // the correct time even when clips have been repositioned.
      if (duration > 0) seekFromTranscript(getWordOutputTime(word, tracks))
    },
    [duration, tracks],
  )

  // ── Manual timestamp calibration ─────────────────────────────────────────
  // The user positions the playhead exactly where the first word starts, then
  // clicks "Sync to playhead". We shift every word's timestamps by the
  // difference so the first word aligns with the current playhead position.
  const handleCalibrateOffset = useCallback(() => {
    if (words.length === 0) return
    const firstWord = words[0]
    const offset = currentTime - firstWord.start
    if (Math.abs(offset) < 0.01) return // already aligned — nothing to do
    shiftTimestamps(offset)
    markEdited()
  }, [words, currentTime, shiftTimestamps, markEdited])

  // ── Clip state map — computed once per words+tracks change ───────────────
  // Declared here (before handleDeleteFromSelection) to avoid temporal dead zone.
  const clipStateMap = useMemo(() => {
    const m = new Map<string, WordClipState>()
    for (const w of words) m.set(w.id, getWordClipState(w, tracks))
    return m
  }, [words, tracks])

  // ── Delete/Backspace: mute the words that intersect the native selection ──
  const handleDeleteFromSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return

    const selected = words.filter((w) => {
      const el = wordEls.current.get(w.id)
      const cs = clipStateMap.get(w.id)
      // Exclude no-clip words — their clip is gone so they cannot be muted
      return el != null && range.intersectsNode(el) && cs !== 'no-clip'
    })
    if (selected.length === 0) return

    // Group by trackId — redactRange is track-scoped so each track gets its own call.
    // This correctly handles mixed-track selections and prevents a mute on track 2
    // from landing on track 1 (which happened when routing by source identity, since
    // multiple tracks can share the same source file).
    const byTrack = new Map<string, typeof selected>()
    for (const w of selected) {
      if (!w.trackId) continue // legacy words without trackId — skip
      const arr = byTrack.get(w.trackId) ?? []
      arr.push(w)
      byTrack.set(w.trackId, arr)
    }

    const { redactRange } = useTimelineStore.getState()
    for (const [trackId, tWords] of byTrack) {
      const tStart = Math.min(...tWords.map((w) => w.start))
      const tEnd = Math.max(...tWords.map((w) => w.end))
      redactRange(trackId, tStart, tEnd)
    }
    sel.removeAllRanges()
    setSelection(null)
  }, [words, setSelection, clipStateMap])

  // ── Keyboard handler on the contentEditable container ────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let CMD+shortcuts (copy, undo, etc.) pass through to global handlers
      if (e.metaKey || e.ctrlKey) return

      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault()
        e.stopPropagation() // don't let the global shortcut double-fire
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
        togglePlayback().catch(console.error)
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
  const visibleWords = useMemo(
    () =>
      words
        .filter((w) => !w.trackId || visibleSet.has(w.trackId))
        .filter((w) => {
          if (!showMutedWords) {
            const cs = clipStateMap.get(w.id)
            if (cs === 'clip-muted' || cs === 'no-clip' || cs === 'redacted') return false
          }
          return true
        })
        .sort((a, b) => getWordOutputTime(a, tracks) - getWordOutputTime(b, tracks)),
    [words, visibleSet, showMutedWords, clipStateMap, tracks],
  )

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
      <div className="feature-toolbar legacy-transcript-toolbar">
        {workspaceControls}
        <span className="feature-title">{t('transcript.title')}</span>
        <span className="panel-count">{t('common.trackCount', { count: tracks.length })}</span>
        <div className="toolbar-spacer" />
        {hasAnyWords && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={handleCalibrateOffset}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title={t('transcript.syncHint')}
            >
              {t('transcript.sync')}
            </button>
            <span style={{ color: 'var(--color-border)', userSelect: 'none' }}>·</span>
            <button
              onClick={toggleShowMuted}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                padding: '2px 4px',
              }}
              title={
                showMutedWords
                  ? t('transcript.hideRedactedWords')
                  : t('transcript.showRedactedWords')
              }
            >
              {showMutedWords ? t('transcript.hideRedacted') : t('transcript.showRedacted')}
            </button>
          </div>
        )}
        {tracks.length > 0 && (
          <div className="legacy-transcript-actions">
            {/* Left: visibility pills OR placeholder */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexWrap: 'wrap',
                minHeight: 22,
              }}
            >
              {tracksWithTranscript.length > 0 && (
                <>
                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>
                    {t('transcript.view')}
                  </span>
                  {tracksWithTranscript.map((track) => {
                    const isOn = visibleSet.has(track.id)
                    return (
                      <button
                        key={track.id}
                        onClick={() => toggleTrackVisibility(track.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: isOn
                            ? `${trackPresentationColor(track.color)}28`
                            : 'var(--color-bg-elevated)',
                          border: `1px solid ${isOn ? trackPresentationColor(track.color) + '88' : 'var(--color-border)'}`,
                          borderRadius: 10,
                          color: isOn
                            ? trackPresentationColor(track.color)
                            : 'var(--color-text-muted)',
                          fontSize: 10,
                          padding: '2px 8px',
                          cursor: 'pointer',
                          letterSpacing: '0.03em',
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            backgroundColor: isOn
                              ? trackPresentationColor(track.color)
                              : 'var(--color-text-muted)',
                            flexShrink: 0,
                          }}
                        />
                        {track.name}
                      </button>
                    )
                  })}
                </>
              )}
            </div>

            <TranscriptDisplaySwitch />
            <SpeechTaskPopover
              tracks={tracks}
              analyses={[]}
              isGenerating={isGenerating}
              onRun={
                onRun ?? ((scope) => onGenerate(scope.kind === 'track' ? scope.trackId : undefined))
              }
            />
          </div>
        )}
      </div>
      {/* ── Body ────────────────────────────────────────────────────────── */}
      {!hasAnyWords && tracks.length === 0 ? (
        <EmptyTranscriptState noTracks />
      ) : !hasAnyWords ? (
        <EmptyTranscriptState />
      ) : (
        // contentEditable gives a blinking text cursor and native character-
        // level text selection. onBeforeInput prevents any actual DOM edits.
        <div
          ref={containerRef}
          contentEditable
          suppressContentEditableWarning
          role="region"
          aria-label={t('transcript.title')}
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
            const clipState = clipStateMap.get(word.id) ?? 'normal'
            const isCurrent = clipState === 'normal' && word.id === currentWordId
            // In merged view (multiple tracks visible), show a colored underline per track
            const trackColor =
              visibleSet.size > 1 ? (trackColorMap.get(word.trackId ?? '') ?? null) : null

            // Word edits and clip redactions share strikethrough; track mute is not redaction.
            let bg = 'transparent'
            let wordColor = 'var(--color-text-primary)'
            let decoration = 'none'
            let borderBot = '2px solid transparent'
            let opacity = 1

            if (isCurrent) {
              bg = 'var(--color-accent)'
              wordColor = 'var(--color-text-on-accent)'
            } else if (clipState === 'redacted') {
              decoration = 'line-through'
              opacity = 0.45
              wordColor = 'var(--color-danger-word)'
            } else if (clipState === 'clip-muted') {
              opacity = 0.45
            } else if (clipState === 'partially-redacted') {
              borderBot = '2px dashed var(--color-accent)'
            } else if (clipState === 'no-clip') {
              // Type c: clip was deleted — word produces no audio at all
              decoration = 'line-through'
              opacity = 0.3
              wordColor = 'var(--color-text-muted)'
            } else if (trackColor) {
              // Normal in All view: colored underline per track
              borderBot = `2px solid ${trackColor}`
            }

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
                  padding: '1px 2px',
                  backgroundColor: bg,
                  color: wordColor,
                  textDecoration: decoration,
                  borderBottom: borderBot,
                  opacity,
                }}
              >
                {word.text}
              </span>
            )
          })}
        </div>
      )}
      <TranscriptStatusFooter
        isGenerating={isGenerating}
        status={generatingStatus}
        onCancel={onCancel}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyTranscriptState({ noTracks = false }: { noTracks?: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        textAlign: 'center',
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        {t('transcript.empty')}
      </p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', maxWidth: 180 }}>
        {noTracks ? t('transcript.addTrackHint') : t('transcript.generateHint')}
      </p>
    </div>
  )
}
