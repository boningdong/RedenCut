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
//   • Clip blocks: absolutely positioned % within lane (auto-scales with zoom).
//   • Clip drag: pointer events → moveClip() on pointer up. Snap within 5px.
//   • The playhead overlay remains independent from static waveform pixels.
//
// Log prefix: [WaveformView]
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioSourceId, Clip } from '@shared/project.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { CanvasWaveform } from './CanvasWaveform'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { TrackHeader } from './TrackHeader'
import { calculateVisibleWaveformRange } from './waveformRange'

interface WaveformViewProps {
  duration: number
  providersBySource: ReadonlyMap<AudioSourceId, WaveformDataProvider>
  onAddTrack(): void
}

// Layout constants
const HEADER_WIDTH = 90 // px — header column width
const RULER_HEIGHT = 28 // px — ruler row height
const LANE_HEIGHT = 96 // px — clip lane height
const MIN_ZOOM = 1 / 32 // symmetrical with max zoom-in of 32×

export function WaveformView({
  duration: sourceDuration,
  providersBySource,
  onAddTrack,
}: WaveformViewProps) {
  const tracks = useTimelineStore((s) => s.tracks)
  const removeTrack = useTimelineStore((s) => s.removeTrack)
  const moveClip = useTimelineStore((s) => s.moveClip)
  const selectedClipId = useTimelineStore((s) => s.selectedClipId)
  const setSelectedClipId = useTimelineStore((s) => s.setSelectedClipId)
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId)
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

  const previewMode = useEditorStore((s) => s.previewMode)
  const setSelection = useEditorStore((s) => s.setSelection)

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
  const basePxPerSec = duration > 0 && viewport.width > 0 ? viewport.width / duration : 100
  const pxPerSec = basePxPerSec * zoomLevel

  const handleZoomIn = useCallback(() => setZoomLevel((z) => Math.min(32, z * 2)), [])
  const handleZoomOut = useCallback(() => setZoomLevel((z) => Math.max(MIN_ZOOM, z / 2)), [])

  // ── Scroll-to-zoom (imperative — must be non-passive to call preventDefault) ──
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Horizontal trackpad swipe — let native overflow-x:auto handle pan
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      // Vertical scroll / pinch → zoom
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2
      setZoomLevel((z) => Math.min(32, Math.max(MIN_ZOOM, z * factor)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // setZoomLevel is stable; MIN_ZOOM is a constant

  // scaleFactor compresses clip positions when zoomed out below 1×.
  // At zoomLevel ≥ 1 it equals 1 (no change). At zoomLevel < 1 clips scale
  // proportionally so a larger time span is visible in the full-width viewport.
  const scaleFactor = Math.min(1, zoomLevel)

  // ── Shared playhead position ──────────────────────────────────────────────
  const playheadPct = duration > 0 ? (currentTime / duration) * scaleFactor * 100 : 0

  // ── Preview mode skip ─────────────────────────────────────────────────────
  const previewModeRef = useRef(previewMode)
  useEffect(() => {
    previewModeRef.current = previewMode
  }, [previewMode])

  useEffect(() => {
    const player = getAudioPlayerInstance()
    if (!player) return
    return player.onTimeUpdate((t) => {
      if (!previewModeRef.current) return
      const { tracks: currentTracks } = useTimelineStore.getState()

      // Skip only when ALL tracks are silent at t — i.e. no track has an
      // unmuted clip whose output range covers the current time.
      const anyAudible = currentTracks.some((tr) =>
        tr.clips.some((c) => {
          if (c.muted) return false
          const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
          return t >= c.outputStart && t < outputEnd
        }),
      )
      if (anyAudible) return

      // All tracks silent — find the earliest future time any track resumes.
      let nextAudible = Infinity
      for (const tr of currentTracks) {
        for (const c of tr.clips) {
          if (!c.muted && c.outputStart > t) {
            nextAudible = Math.min(nextAudible, c.outputStart)
          }
        }
      }

      if (nextAudible < Infinity) {
        getAudioPlayerInstance()?.seekTo(nextAudible)
      }
      // If nextAudible === Infinity, no more audible content — play to end naturally.
    })
  }, [])

  // ── Seek on lane/ruler click ───────────────────────────────────────────────
  // At zoom < 1, clips occupy only scaleFactor * 100% of the content div.
  // Dividing by scaleFactor maps click position back to the correct time.
  const handleLaneClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, trackId?: string) => {
      if (trackId) setSelectedTrackId(trackId)
      const rect = e.currentTarget.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      const t = Math.min(duration, Math.max(0, (pct / scaleFactor) * duration))
      getAudioPlayerInstance()?.seekTo(t)
    },
    [duration, scaleFactor, setSelectedTrackId],
  )

  // ── Remove track ─────────────────────────────────────────────────────────
  const handleRemoveTrack = useCallback(
    (trackId: string) => {
      removeTrack(trackId)
      useTranscriptStore.getState().removeWordsForTrack(trackId)
    },
    [removeTrack],
  )

  // ── Clip drag ─────────────────────────────────────────────────────────────
  const dragRef = useRef<{
    clipId: string
    origStart: number
    ghostPct: number
    trackId: string
    startX: number
    clipDur: number
  } | null>(null)
  const [ghostState, setGhostState] = useState<{ pct: number; widthPct: number } | null>(null)

  const handleClipPointerDown = useCallback(
    (e: React.PointerEvent, clip: Clip) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const sf = Math.min(1, zoomLevel)
      dragRef.current = {
        clipId: clip.id,
        origStart: clip.outputStart,
        ghostPct: duration > 0 ? (clip.outputStart / duration) * sf * 100 : 0,
        trackId: clip.trackId,
        startX: e.clientX,
        clipDur: clip.sourceEnd - clip.sourceStart,
      }
      const widthPct =
        duration > 0 ? ((clip.sourceEnd - clip.sourceStart) / duration) * sf * 100 : 0
      setGhostState({ pct: duration > 0 ? (clip.outputStart / duration) * sf * 100 : 0, widthPct })
    },
    [duration, zoomLevel],
  )

  const handleClipPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const laneEl = (e.currentTarget as HTMLDivElement).closest('[data-lane]') as HTMLDivElement
      const laneW = laneEl?.getBoundingClientRect().width ?? 1
      const deltaPct = (delta / laneW) * 100
      const rawPct = Math.max(0, dragRef.current.ghostPct + deltaPct)

      // Convert to output-time, snap to nearby edges, convert back to pct
      const sf = Math.min(1, zoomLevel)
      const rawStart = (rawPct / 100) * (duration / sf)
      const clipDur = dragRef.current.clipDur
      const snapThreshSec = 5 / pxPerSec
      const { tracks: all } = useTimelineStore.getState()
      const allEdges = all.flatMap((t) =>
        t.clips
          .filter((c) => c.id !== dragRef.current!.clipId)
          .flatMap((c) => [c.outputStart, c.outputStart + (c.sourceEnd - c.sourceStart)]),
      )
      let snapped = rawStart
      for (const edge of allEdges) {
        if (Math.abs(rawStart - edge) < snapThreshSec) {
          snapped = edge
          break
        }
        if (Math.abs(rawStart + clipDur - edge) < snapThreshSec) {
          snapped = edge - clipDur
          break
        }
      }
      const snappedPct = (snapped / duration) * sf * 100

      setGhostState((g) => (g ? { ...g, pct: snappedPct } : null))
    },
    [duration, zoomLevel, pxPerSec],
  )

  const handleClipPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      if (!dragRef.current || !ghostState) {
        dragRef.current = null
        setGhostState(null)
        return
      }
      const sf = Math.min(1, zoomLevel)
      // Snap already applied by handleClipPointerMove — recover output time and commit.
      // Overlap resolution is handled entirely inside moveClip (slot-based, no oscillation).
      const rawStart = (ghostState.pct / 100) * (duration / sf)
      moveClip(dragRef.current.clipId, Math.max(0, rawStart))
      dragRef.current = null
      setGhostState(null)
    },
    [ghostState, duration, zoomLevel, moveClip],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Main area: fixed headers column + scrollable timeline */}
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
          {/* Ruler spacer — contains zoom controls */}
          <div
            style={{
              height: RULER_HEIGHT,
              boxSizing: 'border-box',
              borderRight: '1px solid var(--color-border)',
              borderBottom: '1px solid var(--color-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              padding: '0 4px',
              gap: 2,
              backgroundColor: 'var(--color-bg-secondary)',
            }}
          >
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= MIN_ZOOM}
              title="Zoom out"
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 2,
                color:
                  zoomLevel <= MIN_ZOOM ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                fontSize: 10,
                lineHeight: 1,
                cursor: zoomLevel <= MIN_ZOOM ? 'not-allowed' : 'pointer',
                padding: '1px 3px',
                opacity: zoomLevel <= MIN_ZOOM ? 0.4 : 1,
              }}
            >
              −
            </button>
            <span
              style={{
                fontSize: 9,
                color: 'var(--color-text-muted)',
                minWidth: 22,
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {zoomLevel === 1
                ? 'fit'
                : zoomLevel > 1
                  ? `${zoomLevel}×`
                  : `1/${Math.round(1 / zoomLevel)}×`}
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 32}
              title="Zoom in"
              style={{
                background: 'none',
                border: '1px solid var(--color-border)',
                borderRadius: 2,
                color: zoomLevel >= 32 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                fontSize: 10,
                lineHeight: 1,
                cursor: zoomLevel >= 32 ? 'not-allowed' : 'pointer',
                padding: '1px 3px',
                opacity: zoomLevel >= 32 ? 0.4 : 1,
              }}
            >
              +
            </button>
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
              width: duration > 0 ? `${pxPerSec * duration}px` : '100%',
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
              <TimelineRuler duration={duration} pxPerSec={pxPerSec} scaleFactor={scaleFactor} />
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
                    borderLeft:
                      track.id === selectedTrackId
                        ? '2px solid var(--color-accent)'
                        : '2px solid transparent',
                  }}
                  onClick={(e) => handleLaneClick(e, track.id)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerUp}
                >
                  {/* Clip blocks */}
                  {track.clips.map((clip) => {
                    const waveformProvider = providersBySource.get(clip.audioSourceId)
                    const clipDur = clip.sourceEnd - clip.sourceStart
                    const leftPct =
                      duration > 0 ? (clip.outputStart / duration) * scaleFactor * 100 : 0
                    const widthPct = duration > 0 ? (clipDur / duration) * scaleFactor * 100 : 0
                    const isDragging = dragRef.current?.clipId === clip.id
                    const visible = waveformProvider
                      ? calculateVisibleWaveformRange({
                          outputStart: clip.outputStart,
                          sourceStart: clip.sourceStart,
                          sourceEnd: clip.sourceEnd,
                          pxPerSec,
                          viewportStartPx: viewport.scrollLeft,
                          viewportWidthPx: viewport.width,
                        })
                      : null
                    return (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        data-audio-source-id={clip.audioSourceId}
                        data-source-start={clip.sourceStart}
                        data-source-end={clip.sourceEnd}
                        onPointerDown={(e) => handleClipPointerDown(e, clip)}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTrackId(track.id)
                          setSelectedClipId(clip.id === selectedClipId ? null : clip.id)
                          setSelection({ start: clip.outputStart, end: clip.outputStart + clipDur })
                        }}
                        style={{
                          position: 'absolute',
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          top: 4,
                          bottom: 4,
                          borderRadius: 3,
                          border:
                            clip.id === selectedClipId
                              ? '1px solid var(--color-accent)'
                              : '1px solid var(--color-accent-clip-border)',
                          backgroundColor: clip.muted
                            ? 'var(--color-danger-clip-bg)'
                            : 'var(--color-accent-clip-bg)',
                          opacity: isDragging ? 0.4 : 1,
                          cursor: 'grab',
                          pointerEvents: 'all',
                          zIndex: isDragging ? 0 : 5,
                          boxSizing: 'border-box',
                          overflow: 'hidden',
                        }}
                      >
                        {waveformProvider && visible && (
                          <CanvasWaveform
                            provider={waveformProvider}
                            sourceStartSeconds={visible.sourceStartSeconds}
                            sourceEndSeconds={visible.sourceEndSeconds}
                            leftInClipPx={visible.leftInClipPx}
                            widthPx={visible.widthPx}
                            heightPx={LANE_HEIGHT - 8}
                            color={track.color}
                            muted={clip.muted}
                          />
                        )}
                      </div>
                    )
                  })}

                  {/* Drag ghost */}
                  {ghostState &&
                    dragRef.current &&
                    track.clips.some((c) => c.id === dragRef.current!.clipId) && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${ghostState.pct}%`,
                          width: `${ghostState.widthPct}%`,
                          top: 4,
                          bottom: 4,
                          borderRadius: 3,
                          border: '1px dashed var(--color-accent)',
                          backgroundColor: 'var(--color-accent-ghost)',
                          pointerEvents: 'none',
                          zIndex: 20,
                        }}
                      />
                    )}

                  {/* Gap overlays — cover waveform between clips */}
                  {(() => {
                    const sorted = [...track.clips].sort((a, b) => a.outputStart - b.outputStart)
                    return sorted.slice(0, -1).flatMap((clip, i) => {
                      const clipEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
                      const nextStart = sorted[i + 1].outputStart
                      if (nextStart <= clipEnd + 0.001) return []
                      const leftPct = duration > 0 ? (clipEnd / duration) * scaleFactor * 100 : 0
                      const widthPct =
                        duration > 0 ? ((nextStart - clipEnd) / duration) * scaleFactor * 100 : 0
                      return [
                        <div
                          key={`gap-${clip.id}`}
                          style={{
                            position: 'absolute',
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
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

                  {/* Split markers */}
                  {track.clips.slice(1).map((clip) => (
                    <div
                      key={`split-${clip.id}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left:
                          duration > 0
                            ? `calc(${(clip.outputStart / duration) * scaleFactor * 100}% - 1px)`
                            : '0',
                        width: 2,
                        backgroundColor: 'var(--color-accent-split)',
                        pointerEvents: 'none',
                        zIndex: 10,
                      }}
                    />
                  ))}
                </div>
              )
            })}

            {/* Global playhead — inside scrollable content so it scrolls with clips */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${playheadPct}%`,
                width: 1,
                backgroundColor: 'var(--color-playhead)',
                pointerEvents: 'none',
                zIndex: 30,
              }}
            />
          </div>
        </div>
      </div>

      {/* + Add Track row */}
      <div
        onClick={() => {
          onAddTrack()
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 12px',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
          borderTop: '1px solid var(--color-border)',
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLDivElement).style.color = 'var(--color-accent)')
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLDivElement).style.color = 'var(--color-text-muted)')
        }
      >
        + Add Track
      </div>
    </div>
  )
}

// ── TimelineRuler ─────────────────────────────────────────────────────────────
// Uses the same scaleFactor-based positioning as clips so it works at any zoom.

interface TimelineRulerProps {
  duration: number
  pxPerSec: number
  scaleFactor: number
}

function TimelineRuler({ duration, pxPerSec, scaleFactor }: TimelineRulerProps) {
  if (duration <= 0 || pxPerSec <= 0) return null

  // Pick the smallest "nice" interval that keeps ticks ≥ 40px apart
  const MIN_PX = 40
  const rawSec = MIN_PX / pxPerSec
  const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600]
  const interval = NICE.find((n) => n >= rawSec) ?? NICE[NICE.length - 1]

  const ticks: number[] = []
  for (let t = 0; t <= duration + interval; t += interval) ticks.push(t)

  return (
    <>
      {ticks.map((t) => {
        const left = (t / duration) * scaleFactor * 100
        if (left > scaleFactor * 100 + 0.1) return null
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
              left: `${left}%`,
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
