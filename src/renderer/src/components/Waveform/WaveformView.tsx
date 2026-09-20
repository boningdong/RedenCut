import { useTimelineContextMenu } from './UseTimelineContextMenu'
import { TimelineRuler } from './TimelineRuler'
import { trackPresentationColor } from '../../themes/trackColors'
import { useRangeSelection } from './UseRangeSelection'
import { TimelineSelectionOverlay } from './TimelineSelectionOverlay'
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
//   At zoomLevel=1 the audio extent fills the viewport.
//   Overview fits the current timeline plus a fixed source-based margin; trailing scroll space remains.
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
import type { AudioSourceId } from '@shared/ProjectTypes'
import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/PlaybackStore'
import { ClipView } from './ClipView'
import { ClipDragPreview } from './ClipDragPreview'
import { useClipInteraction } from './UseClipInteraction'
import { useTimelineClipboardStore } from '../../stores/TimelineClipboardStore'
import { copyClips, cutClips, pasteClips, duplicateClips } from '../../actions/ClipClipboardActions'
import './ClipEditing.css'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { TrackHeader } from './TrackHeader'
import { getTimelineContentWidth } from './TimelineViewportGeometry'
import { useTimelineZoom } from './UseTimelineZoom'

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
  const contextMenu = useTimelineContextMenu(focusTimeline, () => setActionFailed(true))
  const selection = useEditorStore((s) => s.selection)
  const hasTrackRange = Boolean(
    selection?.trackId && tracks.some((track) => track.id === selection.trackId),
  )
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

  const [rulerHoverX, setRulerHoverX] = useState<number | null>(null)
  const [altPressed, setAltPressed] = useState(false)
  const [pointerOwner, setPointerOwner] = useState<'clip' | 'redaction' | null>(null)
  useEffect(() => {
    const key = (event: KeyboardEvent) => setAltPressed(event.altKey)
    const blur = () => {
      setRulerHoverX(null)
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
  const handleZoomScroll = useCallback((scrollLeft: number) => {
    setViewport((current) =>
      current.scrollLeft === scrollLeft ? current : { ...current, scrollLeft },
    )
  }, [])
  const { zoomLevel, zoomBy, canZoomIn, canZoomOut } = useTimelineZoom({
    viewportRef: scrollViewportRef,
    basePxPerSec,
    duration,
    audioDuration: audioSources.reduce(
      (longest, source) => Math.max(longest, source.metadata.durationSeconds),
      0,
    ),
    viewportWidth: viewport.width,
    onScrollChange: handleZoomScroll,
  })
  const pxPerSec = basePxPerSec * zoomLevel

  useEffect(
    () =>
      usePlaybackStore.subscribe((state, previous) => {
        const request = state.timelineRevealRequest
        const viewport = scrollViewportRef.current
        if (
          !request ||
          request === previous.timelineRevealRequest ||
          !viewport ||
          viewport.clientWidth <= 0
        )
          return
        const x = request.time * pxPerSec
        const left = viewport.scrollLeft
        if (x >= left && x < left + viewport.clientWidth - 2) return
        viewport.scrollLeft = Math.max(
          0,
          Math.min(viewport.scrollWidth - viewport.clientWidth, x - viewport.clientWidth / 2),
        )
        handleZoomScroll(viewport.scrollLeft)
      }),
    [pxPerSec, handleZoomScroll],
  )

  const interaction = useClipInteraction({
    containerRef: audioPanel,
    viewportRef: scrollViewportRef,
    pxPerSec,
    focusTimeline,
  })
  const rangeInteraction = useRangeSelection({ pxPerSec, duration, focusTimeline })
  const isClipActive = interaction.isActive
  const isRangeActive = rangeInteraction.isActive
  const isInteracting = useCallback(
    () => isClipActive() || isRangeActive(),
    [isClipActive, isRangeActive],
  )

  const handleZoomIn = useCallback(() => {
    if (!isInteracting()) zoomBy(2)
  }, [isInteracting, zoomBy])
  const handleZoomOut = useCallback(() => {
    if (!isInteracting()) zoomBy(1 / 2)
  }, [isInteracting, zoomBy])

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
      if (e.deltaY === 0) return
      const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2
      zoomBy(factor, e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [isInteracting, zoomBy])

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

  const contentWidth = getTimelineContentWidth(previewEnd, pxPerSec, viewport.width)
  const rulerDuration = duration > 0 ? contentWidth / pxPerSec : 60

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
      {contextMenu.menu}
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
          disabled={hasTranscriptSelection || (!hasTrackRange && !selectedClipId)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={muteSelection}
        >
          <Icon name="mute" />
        </button>
        <button
          aria-label={t('waveform.delete')}
          title={hasTranscriptSelection ? transcriptEditHint : t('waveform.deleteHint')}
          disabled={
            hasTranscriptSelection || (!timelineSelection && !selectedClipId && !hasTrackRange)
          }
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
        <button onClick={handleZoomOut} disabled={!canZoomOut} title={t('waveform.zoomOut')}>
          −
        </button>
        <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
        <button onClick={handleZoomIn} disabled={!canZoomIn} title={t('waveform.zoomIn')}>
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
          <div
            ref={scrollViewportRef}
            onScroll={() => setRulerHoverX(null)}
            style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}
          >
            {/* Audio extent plus one viewport of scrollable trailing time. */}
            <div
              style={{
                minWidth: '100%',
                width: duration > 0 ? `${contentWidth}px` : '100%',
                position: 'relative',
              }}
            >
              {/* Ruler row */}
              <div
                id="waveform-timeline"
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setRulerHoverX(
                    event.clientY >= rect.top &&
                      event.clientY < rect.bottom &&
                      event.clientX >= rect.left &&
                      event.clientX < rect.right
                      ? event.clientX - rect.left
                      : null,
                  )
                }}
                onPointerLeave={() => setRulerHoverX(null)}
                onPointerCancel={() => setRulerHoverX(null)}
                onPointerDown={rangeInteraction.begin}
                onClick={(event) => {
                  if (!rangeInteraction.consumeClick()) handleLaneClick(event)
                }}
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
                  scrollLeft={viewport.scrollLeft}
                  viewportWidth={viewport.width}
                  duration={rulerDuration}
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
                    }}
                    data-drop-target={interaction.preview?.targetTrackId === track.id}
                    data-drop-invalid={
                      interaction.preview?.targetTrackId === track.id && interaction.preview.invalid
                    }
                    onClick={(e) => {
                      if (!interaction.consumeClick()) handleLaneClick(e, track.id)
                    }}
                    onContextMenu={(event) => contextMenu.open(event, track.id)}
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

                    {selection && selection.trackId === track.id && (
                      <TimelineSelectionOverlay
                        selection={selection}
                        pxPerSec={pxPerSec}
                        trackColor={trackPresentationColor(track.color)}
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

              {selection && <TimelineSelectionOverlay selection={selection} pxPerSec={pxPerSec} />}
              {rulerHoverX !== null && (
                <div
                  aria-hidden="true"
                  data-ruler-hover
                  style={{
                    position: 'absolute',
                    left: rulerHoverX,
                    top: 0,
                    bottom: 0,
                    borderLeft:
                      '1px dashed color-mix(in srgb, var(--color-accent) 70%, transparent)',
                    pointerEvents: 'none',
                    zIndex: 28,
                  }}
                />
              )}

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
