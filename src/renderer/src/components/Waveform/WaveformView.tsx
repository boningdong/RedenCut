import { useTranslation } from '../../i18n/useTranslation'
// ─────────────────────────────────────────────────────────────────────────────
// WaveformView — multi-track
//
// Layout:
//   ┌─ [90px headers column] ─ [scrollable timeline viewport] ──────────────┐
//   │  zoom controls           ruler (#waveform-timeline)                    │
//   │  TrackHeader 1           clip lane 1                                   │
//   │  TrackHeader 2           clip lane 2                                   │
//   │                          global playhead (abs, inside content)         │
//   └──────────────────────────────────────────────────────────────────────── ┘
//   └─ + Add Track ─────────────────────────────────────────────────────────── ┘
//
// Zoom:
//   At zoomLevel=1 the content exactly fills the viewport (minWidth:100%).
//   At zoomLevel>1 the content is zoomLevel× wider and the viewport scrolls.
//
// Architecture:
//   • One shared binary waveform provider for each AudioSourceId.
//   • Only the source interval intersecting the viewport is drawn to canvas.
//   • Clips, ruler and previews share pixel-per-second geometry.
//   • Gesture previews remain transient until one guarded timeline commit.
//   • The playhead overlay remains independent from static waveform pixels.
//
// Log prefix: [WaveformView]
// ─────────────────────────────────────────────────────────────────────────────

import { splitAtPlayhead, muteSelection, deleteSelection } from '../../actions/timelineActions'
import { Icon } from '../ui/Icon'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioSourceId } from '@shared/project.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { ClipView } from './ClipView'
import { ClipDragPreview } from './ClipDragPreview'
import { useClipInteraction } from './UseClipInteraction'
import { useTimelineClipboardStore } from '../../stores/TimelineClipboardStore'
import { copyClips, cutClips, pasteClips, duplicateClips } from '../../actions/ClipClipboardActions'
import './ClipEditing.css'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { TrackHeader } from './TrackHeader'

interface WaveformViewProps {
  workspaceControls?: React.ReactNode
  audioDetails?: React.ReactNode
  duration: number
  providersBySource: ReadonlyMap<AudioSourceId, WaveformDataProvider>
  isImporting?: boolean
  onAddTrack(): void
}

// Layout constants
const HEADER_WIDTH = 190 // px — header column width
const RULER_HEIGHT = 28 // px — ruler row height
const LANE_HEIGHT = 64 // px — clip lane height
const MIN_ZOOM = 1 / 32 // symmetrical with max zoom-in of 32×

export function WaveformView({
  workspaceControls,
  audioDetails,
  duration: sourceDuration,
  providersBySource,
  onAddTrack,
  isImporting = false,
}: WaveformViewProps) {
  const { t } = useTranslation()
  const clipboardAvailable = useTimelineClipboardStore((state) => state.contents !== null)
  const [actionFailed, setActionFailed] = useState(false)
  const tracks = useTimelineStore((s) => s.tracks)
  const projectGeneration = useTimelineStore((s) => s.projectGeneration)
  const audioSources = useTimelineStore((s) => s.audioSources)
  const removeTrack = useTimelineStore((s) => s.removeTrack)
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds)
  const snappingEnabled = useTimelineStore((s) => s.snappingEnabled)
  const insertMode = useTimelineStore((s) => s.insertMode)
  const selectedClipId = useTimelineStore((s) => s.selectedClipId)
  const timelineSelection = useTimelineStore((s) => s.timelineSelection)
  const setSelectedTrackId = useTimelineStore((s) => s.setSelectedTrackId)

  const currentTime = usePlaybackStore((s) => s.currentTime)

  // Duration = furthest output end across all clips on all tracks.
  // Falls back to the source duration when there are no clips.
  // This ensures the ruler and seek mapping always cover the full timeline,
  // even after the original track is removed or a longer clip is added.
  const maxClipEnd = tracks
    .flatMap((t) => t.clips)
    .reduce((max, c) => Math.max(max, c.outputStart + (c.sourceEnd - c.sourceStart)), 0)
  const duration = Math.max(sourceDuration, maxClipEnd)
  const fitKey = `${projectGeneration}:${audioSources.map((source) => source.id).join(',')}`
  const initialExtent = duration
  const [fitBasis, setFitBasis] = useState({ key: fitKey, duration: initialExtent })
  if (fitBasis.key !== fitKey || (fitBasis.duration === 0 && initialExtent > 0)) {
    setFitBasis({ key: fitKey, duration: initialExtent })
  }

  const hasTranscriptSelection = useTranscriptStore(
    (state) => state.selectedTranscriptUnitIds.size > 0,
  )
  const transcriptEditHint = t('waveform.transcriptHint')
  const audioPanel = useRef<HTMLDivElement>(null)
  const focusTimeline = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set())
    useEditorStore.getState().setSelection(null)
    audioPanel.current?.focus({ preventScroll: true })
  }, [])
  const selection = useEditorStore((s) => s.selection)
  const selectedClip = tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selectedClipId)
  const canSplit = Boolean(
    getAudioPlayerInstance() &&
    selectedClipIds.length === 1 &&
    selectedClip &&
    currentTime > selectedClip.outputStart &&
    currentTime < selectedClip.outputStart + selectedClip.sourceEnd - selectedClip.sourceStart,
  )

  const [altPressed, setAltPressed] = useState(false)
  const [pointerOwner, setPointerOwner] = useState<'clip' | 'redaction' | null>(null)
  useEffect(() => {
    const key = (event: KeyboardEvent) => setAltPressed(event.altKey)
    const blur = () => {
      setAltPressed(false)
      setPointerOwner(null)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const [zoomLevel, setZoomLevel] = useState(1.0)
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 800 })
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  // Keep waveform requests bounded to the scrolling viewport. Scroll events are
  // coalesced so they can trigger at most one React update per browser frame.
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    let scrollFrame: number | null = null
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth
      setViewport((current) => {
        const next = { scrollLeft: el.scrollLeft, width }
        return current.scrollLeft === next.scrollLeft && current.width === next.width
          ? current
          : next
      })
    })
    const onScroll = () => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        setViewport((current) => {
          const next = { scrollLeft: el.scrollLeft, width: current.width }
          return current.scrollLeft === next.scrollLeft ? current : next
        })
      })
    }
    ro.observe(el)
    el.addEventListener('scroll', onScroll)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    }
  }, [])

  // basePxPerSec: fills viewport at zoom=1. Falls back to 100 when duration unknown.
  const basePxPerSec =
    fitBasis.duration > 0 && viewport.width > 0 ? viewport.width / fitBasis.duration : 100
  const pxPerSec = basePxPerSec * zoomLevel

  const interaction = useClipInteraction({
    containerRef: audioPanel,
    viewportRef: scrollViewportRef,
    pxPerSec,
    focusTimeline,
  })
  const isInteracting = interaction.isActive

  const handleZoomIn = useCallback(() => {
    if (!isInteracting()) setZoomLevel((z) => Math.min(32, z * 2))
  }, [isInteracting])
  const handleZoomOut = useCallback(() => {
    if (!isInteracting()) setZoomLevel((z) => Math.max(MIN_ZOOM, z / 2))
  }, [isInteracting])

  // ── Scroll-to-zoom (imperative — must be non-passive to call preventDefault) ──
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (isInteracting()) {
        e.preventDefault()
        return
      }
      // Horizontal trackpad swipe — let native overflow-x:auto handle pan
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      // Vertical scroll / pinch → zoom
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2
      setZoomLevel((z) => Math.min(32, Math.max(MIN_ZOOM, z * factor)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [isInteracting])

  // ── Shared playhead position ──────────────────────────────────────────────
  const playheadLeft = currentTime * pxPerSec

  // ── Seek on lane/ruler click ───────────────────────────────────────────────
  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, trackId?: string) => {
      focusTimeline()
      if (trackId) setSelectedTrackId(trackId)
      const rect = e.currentTarget.getBoundingClientRect()
      const t = Math.min(duration, Math.max(0, (e.clientX - rect.left) / pxPerSec))
      getAudioPlayerInstance()?.seekTo(t)
    },
    [duration, focusTimeline, pxPerSec, setSelectedTrackId],
  )

  // ── Remove track ─────────────────────────────────────────────────────────
  const handleRemoveTrack = useCallback(
    (trackId: string) => {
      removeTrack(trackId)
      useTranscriptStore.getState().removeWordsForTrack(trackId)
    },
    [removeTrack],
  )

  const previewClips = new Map(
    interaction.preview?.tracks.flatMap((track) =>
      track.clips.map((clip) => [clip.id, clip] as const),
    ) ?? [],
  )
  const previewEnd =
    interaction.preview?.tracks
      .flatMap((track) => track.clips)
      .reduce(
        (end, clip) => Math.max(end, clip.outputStart + clip.sourceEnd - clip.sourceStart),
        duration,
      ) ?? duration

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="audio-panel-view"
      ref={audioPanel}
      tabIndex={-1}
      data-redaction-bypass={pointerOwner ? pointerOwner === 'clip' : altPressed}
      onPointerDownCapture={(e) => {
        setActionFailed(false)
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest('.waveform-clip'))
          setPointerOwner(!e.altKey && target.closest('.clip-redaction') ? 'redaction' : 'clip')
      }}
      onPointerUpCapture={() => setPointerOwner(null)}
      onPointerCancelCapture={() => setPointerOwner(null)}
      onLostPointerCapture={() => setPointerOwner(null)}
    >
      <div className="feature-toolbar">
        {workspaceControls}
        <span className="feature-title">{t('waveform.audio')}</span>
        <span className="panel-count">{t('common.trackCount', { count: tracks.length })}</span>
        <span className="transport-separator" />
        <button
          aria-label={t('waveform.split')}
          title={hasTranscriptSelection ? transcriptEditHint : t('waveform.splitHint')}
          disabled={hasTranscriptSelection || !canSplit}
          onClick={splitAtPlayhead}
        >
          <Icon name="split" />
        </button>
        <button
          aria-label={t(selectedClipId ? 'waveform.mute' : 'waveform.redact')}
          title={
            hasTranscriptSelection
              ? transcriptEditHint
              : t(selectedClipId ? 'waveform.mute' : 'waveform.redactHint')
          }
          disabled={hasTranscriptSelection || (!selection && !selectedClipId)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={muteSelection}
        >
          <Icon name="mute" />
        </button>
        <button
          aria-label={t('waveform.delete')}
          title={hasTranscriptSelection ? transcriptEditHint : t('waveform.deleteHint')}
          disabled={hasTranscriptSelection || (!timelineSelection && !selectedClipId && !selection)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={deleteSelection}
        >
          <Icon name="trash" />
        </button>
        <details
          className="clip-actions"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.open = false
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              event.currentTarget.open = false
          }}
        >
          <summary aria-label={t('waveform.clipActions')} title={t('waveform.clipActions')}>
            ···
          </summary>
          <div className="clip-actions-menu">
            {(
              [
                ['copyClips', 'C', copyClips],
                ['cutClips', 'X', cutClips],
                ['pasteClips', 'V', pasteClips],
                ['duplicateClips', 'D', duplicateClips],
              ] as const
            ).map(([key, shortcut, action]) => (
              <button
                key={key}
                disabled={
                  hasTranscriptSelection ||
                  (key === 'pasteClips' ? !clipboardAvailable : !selectedClipIds.length)
                }
                onClick={(event) => {
                  setActionFailed(!action())
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  audioPanel.current?.focus()
                }}
              >
                <span>{t(`waveform.${key}`)}</span>
                <kbd>
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}
                  {shortcut}
                </kbd>
              </button>
            ))}
          </div>
        </details>
        <span className="transport-separator" />
        <button
          className="clip-mode"
          aria-label={t('waveform.snapping')}
          title={t('waveform.snappingHint')}
          aria-pressed={snappingEnabled}
          onClick={() => useTimelineStore.getState().setSnappingEnabled(!snappingEnabled)}
        >
          <Icon name="magnet" />
        </button>
        <button
          className="clip-mode"
          aria-label={t('waveform.insertMode')}
          title={t('waveform.insertModeHint')}
          aria-pressed={insertMode}
          onClick={() => useTimelineStore.getState().setInsertMode(!insertMode)}
        >
          <Icon name="insert" />
        </button>
        <div className="toolbar-spacer" />
        <button
          onClick={handleZoomOut}
          disabled={zoomLevel <= MIN_ZOOM}
          title={t('waveform.zoomOut')}
        >
          −
        </button>
        <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
        <button onClick={handleZoomIn} disabled={zoomLevel >= 32} title={t('waveform.zoomIn')}>
          +
        </button>
      </div>
      {/* Main area: fixed headers column + scrollable timeline */}
      <div className="audio-scroll-body">
        <div style={{ display: 'flex', flexDirection: 'row' }}>
          {/* ── Fixed headers column ──────────────────────────────────────── */}
          <div
            style={{
              width: HEADER_WIDTH,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="ruler-caption" style={{ height: RULER_HEIGHT }}>
              {t('waveform.volume')}
            </div>

            {/* Track headers */}
            {tracks.map((track) => (
              <div
                key={track.id}
                style={{ height: LANE_HEIGHT, display: 'flex', alignItems: 'stretch' }}
              >
                <TrackHeader track={track} onRemove={handleRemoveTrack} />
              </div>
            ))}
          </div>

          {/* ── Scrollable timeline viewport ──────────────────────────────── */}
          <div ref={scrollViewportRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
            {/* Timeline content — width = zoomLevel × viewport width (min 100%) */}
            <div
              style={{
                minWidth: '100%',
                width:
                  duration > 0
                    ? `${pxPerSec * previewEnd + (interaction.preview ? 40 : 0)}px`
                    : '100%',
                position: 'relative',
              }}
            >
              {/* Ruler row */}
              <div
                id="waveform-timeline"
                onClick={handleLaneClick}
                style={{
                  height: RULER_HEIGHT,
                  width: '100%',
                  position: 'relative',
                  boxSizing: 'border-box',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  cursor: 'crosshair',
                  overflow: 'hidden',
                }}
              >
                <TimelineRuler
                  duration={duration || 60}
                  pxPerSec={duration ? pxPerSec : (viewport.width || 900) / 60}
                  empty={duration === 0}
                />
              </div>

              {/* Track lanes */}
              {tracks.map((track) => {
                return (
                  <div
                    key={track.id}
                    data-lane={track.id}
                    data-trackid={track.id}
                    data-track-name={track.name}
                    style={{
                      height: LANE_HEIGHT,
                      position: 'relative',
                      cursor: 'crosshair',
                      overflow: 'hidden',
                      borderBottom: '1px solid var(--color-border)',
                      borderLeft: '2px solid transparent',
                    }}
                    data-drop-target={interaction.preview?.targetTrackId === track.id}
                    data-drop-invalid={
                      interaction.preview?.targetTrackId === track.id && interaction.preview.invalid
                    }
                    onClick={(e) => {
                      if (!interaction.consumeClick()) handleLaneClick(e, track.id)
                    }}
                    onPointerDown={(e) => interaction.begin(e)}
                  >
                    {track.clips.map((clip) => {
                      const proposed = previewClips.get(clip.id)
                      const dimmed =
                        !!interaction.preview &&
                        (interaction.preview.clipIds.includes(clip.id) ||
                          proposed?.outputStart !== clip.outputStart)
                      return (
                        <ClipView
                          key={clip.id}
                          clip={clip}
                          track={track}
                          provider={providersBySource.get(clip.audioSourceId)}
                          pxPerSec={pxPerSec}
                          viewport={viewport}
                          selected={selectedClipIds.includes(clip.id)}
                          dimmed={dimmed}
                          onBegin={interaction.begin}
                          onClick={interaction.clickClip}
                          onTrimKey={interaction.trimKey}
                          onFocusTimeline={focusTimeline}
                        />
                      )
                    })}
                    {interaction.preview && (
                      <ClipDragPreview
                        original={track}
                        track={
                          interaction.preview.tracks.find((item) => item.id === track.id) ?? track
                        }
                        preview={interaction.preview}
                        pxPerSec={pxPerSec}
                      />
                    )}

                    {/* Gap overlays — cover waveform between clips */}
                    {(() => {
                      const sorted = [...track.clips].sort((a, b) => a.outputStart - b.outputStart)
                      return sorted.slice(0, -1).flatMap((clip, i) => {
                        const clipEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
                        const nextStart = sorted[i + 1].outputStart
                        if (nextStart <= clipEnd + 0.001) return []
                        const left = clipEnd * pxPerSec
                        const width = (nextStart - clipEnd) * pxPerSec
                        return [
                          <div
                            key={`gap-${clip.id}`}
                            style={{
                              position: 'absolute',
                              left,
                              width,
                              top: 0,
                              bottom: 0,
                              backgroundColor: 'var(--color-bg-secondary)',
                              pointerEvents: 'none',
                              zIndex: 6,
                            }}
                          />,
                        ]
                      })
                    })()}
                  </div>
                )
              })}

              {/* Global playhead — inside scrollable content so it scrolls with clips */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: playheadLeft,
                  width: 1,
                  backgroundColor: 'var(--color-playhead)',
                  pointerEvents: 'none',
                  zIndex: 30,
                }}
              />
            </div>
          </div>
        </div>
        <button className="audio-add-track" disabled={isImporting} onClick={onAddTrack}>
          {t('waveform.addTrack')}
        </button>
      </div>
      {interaction.marquee && <div className="clip-marquee" style={interaction.marquee} />}
      <div className="audio-footer">
        <span>
          {timelineSelection?.kind === 'redaction'
            ? t('waveform.redactionSelected')
            : selectedClipId
              ? t('waveform.clipsSelected', { count: selectedClipIds.length })
              : t('waveform.noClipSelected')}
        </span>
        <span className="audio-footer-hint">
          {interaction.preview?.invalid || actionFailed
            ? t('waveform.invalidDrop')
            : t(
                timelineSelection?.kind === 'redaction'
                  ? 'waveform.redactionHint'
                  : 'waveform.editHint',
              )}
        </span>
        {audioDetails}
      </div>
    </div>
  )
}

// ── TimelineRuler ─────────────────────────────────────────────────────────────
// Uses the same pixel-per-second positions as clips at every zoom level.

interface TimelineRulerProps {
  duration: number
  pxPerSec: number
  empty?: boolean
}

function TimelineRuler({ duration, pxPerSec, empty }: TimelineRulerProps) {
  if (duration <= 0 || pxPerSec <= 0) return null

  // Pick the smallest "nice" interval that keeps ticks ≥ 40px apart
  const MIN_PX = 40
  const rawSec = MIN_PX / pxPerSec
  const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600]
  const interval = empty ? 5 : (NICE.find((n) => n >= rawSec) ?? NICE[NICE.length - 1])

  const ticks: number[] = []
  for (let t = 0; t <= duration + interval; t += interval) ticks.push(t)

  return (
    <>
      {ticks.map((t) => {
        const left = t * pxPerSec
        if (t > duration) return null
        const label =
          t >= 3600
            ? `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`
            : t >= 60
              ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
              : `${t}s`
        return (
          <div
            key={t}
            style={{
              position: 'absolute',
              left,
              top: 0,
              bottom: 0,
              borderLeft: '1px solid var(--color-border-subtle)',
              paddingLeft: 3,
              display: 'flex',
              alignItems: 'flex-end',
              paddingBottom: 2,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{label}</span>
          </div>
        )
      })}
    </>
  )
}
