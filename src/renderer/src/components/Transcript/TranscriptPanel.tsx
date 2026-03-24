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
import { getWordClipState, type WordClipState } from '../../utils/wordClipState'
import { getWordOutputTime } from '../../utils/wordOutputTime'

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
  const toggleShowMuted    = useTranscriptStore((s) => s.toggleShowMutedWords)
  const shiftTimestamps    = useTranscriptStore((s) => s.shiftTimestamps)
  const visibleTrackIds        = useTranscriptStore((s) => s.visibleTrackIds)
  const toggleTrackVisibility  = useTranscriptStore((s) => s.toggleTrackVisibility)

  const tracks      = useTimelineStore((s) => s.tracks)
  const sourceFiles = useTimelineStore((s) => s.sourceFiles)

  const setSelection = useEditorStore((s) => s.setSelection)

  // ── Refs ──────────────────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null)
  const currentWordRef = useRef<HTMLSpanElement | null>(null)
  /** Map from word.id → the rendered <span> element, for selection intersection. */
  const wordEls = useRef<Map<string, HTMLSpanElement>>(new Map())

  // ── Track color map — used for per-track underlines in "All" view ────────
  const trackColorMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tracks) m.set(t.id, t.color)
    return m
  }, [tracks])

  // Convert to Set once — O(1) lookups in the visibleWords filter
  const visibleSet = useMemo(() => new Set(visibleTrackIds), [visibleTrackIds])

  // Tracks that have at least one word (pill is shown for these)
  const tracksWithTranscript = useMemo(
    () => tracks.filter((t) => words.some((w) => w.trackId === t.id)),
    [tracks, words],
  )

  // Tracks with no words yet — these appear in the Generate dropdown
  const ungeneratedTracks = useMemo(
    () => tracks.filter((t) => !words.some((w) => w.trackId === t.id)),
    [tracks, words],
  )

  // True when all tracks are generated (generate button becomes inactive)
  const allGenerated = ungeneratedTracks.length === 0

  // Dropdown state at component level — NEVER inside an IIFE or conditional (Rules of Hooks)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // True when any words exist, regardless of visibility filter — guards empty-state copy
  const hasAnyWords = words.length > 0

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
      // Seek to the word's output-timeline position so the playhead lands at
      // the correct time even when clips have been repositioned.
      if (duration > 0) getAudioPlayerInstance()?.seekTo(getWordOutputTime(word, tracks))
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
      const cs = clipStateMap.get(w.id)
      // Exclude no-clip words — their clip is gone so they cannot be muted
      return el != null && range.intersectsNode(el) && cs !== 'no-clip'
    })
    if (selected.length === 0) return

    const start   = Math.min(...selected.map((w) => w.start))
    const end     = Math.max(...selected.map((w) => w.end))
    const wordIds = selected.map((w) => w.id)

    // Mute via timeline.store — route to the correct source file using the
    // word's own sourceFileId. Using routingTrack?.clips[0]?.sourceFileId was
    // wrong: a clip's sourceFileId may be shared across tracks, causing the
    // mute to land on the wrong track.
    const { sourceFiles: sfList, muteRange } = useTimelineStore.getState()
    const sfId = selected[0]?.sourceFileId ?? sfList[0]?.id
    if (sfId) muteRange(sfId, start, end, wordIds)
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

  // ── Clip state map — computed once per words+tracks change ───────────────
  const clipStateMap = useMemo(() => {
    const m = new Map<string, WordClipState>()
    for (const w of words) m.set(w.id, getWordClipState(w, tracks))
    return m
  }, [words, tracks])

  // ── Render ────────────────────────────────────────────────────────────────
  const visibleWords = useMemo(() => words
    .filter((w) => !w.trackId || visibleSet.has(w.trackId))
    .filter((w) => {
      if (!showMutedWords) {
        if (w.muted) return false
        const cs = clipStateMap.get(w.id)
        if (cs === 'clip-muted' || cs === 'no-clip') return false
      }
      return true
    })
    .sort((a, b) => getWordOutputTime(a, tracks) - getWordOutputTime(b, tracks)),
  [words, visibleSet, showMutedWords, clipStateMap, tracks])

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
        {hasAnyWords && (
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

      {/* ── Track visibility pills + Generate button ──────────────────────── */}
      {tracks.length > 0 && (
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            gap:            6,
            padding:        '4px var(--space-3)',
            borderBottom:   '1px solid var(--color-border)',
            flexShrink:     0,
            flexWrap:       'wrap',
            position:       'relative',
          }}
        >
          {/* Left: visibility pills OR placeholder */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minHeight: 22 }}>
            {tracksWithTranscript.length === 0 ? (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                No transcripts yet
              </span>
            ) : (
              <>
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>View:</span>
                {tracksWithTranscript.map((track) => {
                  const isOn = visibleSet.has(track.id)
                  return (
                    <button
                      key={track.id}
                      onClick={() => toggleTrackVisibility(track.id)}
                      style={{
                        display:       'inline-flex',
                        alignItems:    'center',
                        gap:           4,
                        background:    isOn ? `${track.color}28` : 'var(--color-bg-elevated)',
                        border:        `1px solid ${isOn ? track.color + '88' : 'var(--color-border)'}`,
                        borderRadius:  10,
                        color:         isOn ? track.color : 'var(--color-text-muted)',
                        fontSize:      10,
                        padding:       '2px 8px',
                        cursor:        'pointer',
                        letterSpacing: '0.03em',
                      }}
                    >
                      <span
                        style={{
                          width:           5,
                          height:          5,
                          borderRadius:    '50%',
                          backgroundColor: isOn ? track.color : 'var(--color-text-muted)',
                          flexShrink:      0,
                        }}
                      />
                      {track.name}
                    </button>
                  )
                })}
              </>
            )}
          </div>

          {/* Right: Generate dropdown button */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              disabled={allGenerated}
              onClick={() => !allGenerated && setDropdownOpen((o) => !o)}
              style={{
                display:      'inline-flex',
                alignItems:   'center',
                gap:          4,
                padding:      '2px 8px',
                borderRadius: 4,
                fontSize:     10,
                border:       `1px solid ${allGenerated ? 'var(--color-border)' : 'rgba(99,102,241,0.45)'}`,
                background:   allGenerated ? 'var(--color-bg-elevated)' : 'rgba(99,102,241,0.12)',
                color:        allGenerated ? 'var(--color-text-muted)' : '#a5b4fc',
                cursor:       allGenerated ? 'not-allowed' : 'pointer',
                opacity:      allGenerated ? 0.5 : 1,
              }}
            >
              🤖 Generate ▾
            </button>

            {dropdownOpen && !allGenerated && (
              <>
                {/* Click-away backdrop */}
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                  onClick={() => setDropdownOpen(false)}
                />
                <div
                  style={{
                    position:     'absolute',
                    right:        0,
                    top:          '100%',
                    marginTop:    3,
                    background:   'var(--color-bg-elevated)',
                    border:       '1px solid var(--color-border)',
                    borderRadius: 5,
                    padding:      '3px 0',
                    zIndex:       50,
                    minWidth:     140,
                    boxShadow:    '0 4px 12px rgba(0,0,0,0.35)',
                  }}
                >
                  {ungeneratedTracks.map((track) => (
                    <button
                      key={track.id}
                      onClick={() => { setDropdownOpen(false); onGenerate(track.id) }}
                      style={{
                        display:    'flex',
                        alignItems: 'center',
                        gap:        6,
                        width:      '100%',
                        padding:    '4px 10px',
                        background: 'none',
                        border:     'none',
                        color:      'var(--color-text-secondary)',
                        fontSize:   10,
                        cursor:     'pointer',
                        textAlign:  'left',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: track.color, flexShrink: 0 }} />
                      {track.name}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--color-border)', margin: '2px 0' }} />
                  <button
                    onClick={() => { setDropdownOpen(false); onGenerate() }}
                    style={{
                      display:    'block',
                      width:      '100%',
                      padding:    '4px 10px',
                      background: 'none',
                      border:     'none',
                      color:      '#a5b4fc',
                      fontSize:   10,
                      cursor:     'pointer',
                      textAlign:  'left',
                      fontWeight: 500,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                  >
                    🤖 {tracksWithTranscript.length === 0 ? 'All tracks' : 'All remaining'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {isGenerating ? (
        <GeneratingState status={generatingStatus} />
      ) : !hasAnyWords && tracks.length === 0 ? (
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
            const isCurrent  = word.id === currentWordId
            const clipState  = clipStateMap.get(word.id) ?? 'normal'
            // In merged view (multiple tracks visible), show a colored underline per track
            const trackColor = visibleSet.size > 1
              ? (trackColorMap.get(word.trackId ?? '') ?? null)
              : null

            // Style precedence:
            //   isCurrent → terminal highlight
            //   word.muted (type a, text-edit) → red strikethrough
            //   clip-muted (type b, 'M' on clip) → amber tint, no strikethrough
            //   no-clip    (type c, clip deleted) → gray dim strikethrough
            //   normal     → track color underline in All view
            let bg         = 'transparent'
            let wordColor  = 'var(--color-text-primary)'
            let decoration = 'none'
            let borderBot  = '2px solid transparent'
            let opacity    = 1

            if (isCurrent) {
              bg        = 'var(--color-accent)'
              wordColor = '#fff'
            } else if (word.muted) {
              // Type a: explicitly deleted via transcript editing
              decoration = 'line-through'
              opacity    = 0.45
              wordColor  = 'rgba(239, 68, 68, 0.9)'
            } else if (clipState === 'clip-muted') {
              // Type b: whole clip muted via 'M' key — audio is silenced as a block
              bg        = 'rgba(251, 146, 60, 0.12)'
              wordColor = 'rgba(251, 146, 60, 0.85)'
            } else if (clipState === 'no-clip') {
              // Type c: clip was deleted — word produces no audio at all
              decoration = 'line-through'
              opacity    = 0.3
              wordColor  = 'var(--color-text-muted)'
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
                  display:         'inline',
                  marginRight:     word.text.match(/[\u2E80-\u9FFF]/) ? '0' : '0.25em',
                  borderRadius:    2,
                  padding:         '1px 2px',
                  backgroundColor: bg,
                  color:           wordColor,
                  textDecoration:  decoration,
                  borderBottom:    borderBot,
                  opacity,
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

function EmptyTranscriptState({ noTracks = false }: { noTracks?: boolean }) {
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
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', maxWidth: 180 }}>
        {noTracks
          ? 'Add a track to get started'
          : 'Use 🤖 Generate above to transcribe a track'}
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
