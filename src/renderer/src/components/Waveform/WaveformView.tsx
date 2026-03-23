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
//   WaveSurfer on track-0 is called with ws.zoom(pxPerSec) on zoom changes so
//   the TimelinePlugin ruler re-renders at the correct scale.
//
// Architecture:
//   • One WaveSurfer instance per track, peaks-only (no media element).
//   • WaveSurfer containers: opacity:0, pointerEvents:none — kept alive so
//     track-0's TimelinePlugin renders into #waveform-timeline.
//   • Clip blocks: absolutely positioned % within lane (auto-scales with zoom).
//   • Clip drag: pointer events → moveClip() on pointer up. Snap within 5px.
//   • Per-clip SVG waveform rendered from the correct peaks subset.
//
// Log prefix: [WaveformView]
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import type { PeakData, Clip } from '@shared/project.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { TrackHeader } from './TrackHeader'

interface WaveformViewProps {
  /** Primary track's peaks (loaded before WaveformView mounts). */
  peaks: PeakData
}

// Layout constants
const HEADER_WIDTH = 90    // px — header column width
const RULER_HEIGHT = 28    // px — ruler row height (matches TimelinePlugin canvas)
const LANE_HEIGHT  = 96    // px — clip lane height

// ── Track loading state ────────────────────────────────────────────────────────
type TrackPeakState = 'loading' | PeakData

export function WaveformView({ peaks }: WaveformViewProps) {
  const tracks             = useTimelineStore((s) => s.tracks)
  const addSourceFile      = useTimelineStore((s) => s.addSourceFile)
  const addTrack           = useTimelineStore((s) => s.addTrack)
  const removeTrack        = useTimelineStore((s) => s.removeTrack)
  const moveClip           = useTimelineStore((s) => s.moveClip)
  const selectedClipId     = useTimelineStore((s) => s.selectedClipId)
  const setSelectedClipId  = useTimelineStore((s) => s.setSelectedClipId)
  const selectedTrackId    = useTimelineStore((s) => s.selectedTrackId)
  const setSelectedTrackId = useTimelineStore((s) => s.setSelectedTrackId)

  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration    = peaks.durationSeconds

  const previewMode  = useEditorStore((s) => s.previewMode)
  const setSelection = useEditorStore((s) => s.setSelection)

  // Per-track peak loading state (secondary tracks only; primary uses `peaks` prop)
  const [trackPeaks, setTrackPeaks] = useState<Map<string, TrackPeakState>>(() => {
    const m = new Map<string, TrackPeakState>()
    if (tracks.length > 0) m.set(tracks[0].id, peaks)
    return m
  })

  // Sync primary peaks if they change (e.g. new file opened)
  useEffect(() => {
    if (tracks.length > 0) {
      setTrackPeaks((prev) => new Map(prev).set(tracks[0].id, peaks))
    }
  }, [peaks, tracks])

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const [zoomLevel, setZoomLevel]     = useState(1.0)
  const [viewportWidth, setViewportWidth] = useState(800)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const wsTrack0Ref       = useRef<WaveSurfer | null>(null)

  // Track scroll viewport width for basePxPerSec computation
  useEffect(() => {
    const el = scrollViewportRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setViewportWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // basePxPerSec: fills viewport at zoom=1. Falls back to 100 when duration unknown.
  const basePxPerSec = duration > 0 && viewportWidth > 0 ? viewportWidth / duration : 100
  const pxPerSec     = basePxPerSec * zoomLevel

  // Call ws.zoom() whenever pxPerSec changes, skipping the first render
  // (WaveSurfer already fills its container by default).
  const isFirstZoom = useRef(true)
  useEffect(() => {
    if (isFirstZoom.current) { isFirstZoom.current = false; return }
    wsTrack0Ref.current?.zoom(pxPerSec)
  }, [pxPerSec])

  const handleZoomIn  = useCallback(() => setZoomLevel((z) => Math.min(32, z * 2)), [])
  const handleZoomOut = useCallback(() => setZoomLevel((z) => Math.max(1, z / 2)), [])

  // ── Shared playhead position ──────────────────────────────────────────────
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0

  // ── Preview mode skip ─────────────────────────────────────────────────────
  const previewModeRef = useRef(previewMode)
  useEffect(() => { previewModeRef.current = previewMode }, [previewMode])

  useEffect(() => {
    const player = getAudioPlayerInstance()
    if (!player) return
    return player.onTimeUpdate((t) => {
      if (!previewModeRef.current) return
      const { tracks: currentTracks } = useTimelineStore.getState()
      const hit = currentTracks.flatMap((tr) => tr.clips as Clip[]).find((c) => {
        if (!c.muted) return false
        const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
        return t >= c.outputStart && t < outputEnd
      })
      if (hit) {
        const outputEnd = hit.outputStart + (hit.sourceEnd - hit.sourceStart)
        console.log(`[WaveformView] preview skip t=${t.toFixed(2)}s → ${outputEnd.toFixed(2)}s`)
        getAudioPlayerInstance()?.seekTo(outputEnd)
      }
    })
  }, [])

  // ── Seek on lane/ruler click ───────────────────────────────────────────────
  const handleLaneClick = useCallback((e: React.MouseEvent<HTMLDivElement>, trackId?: string) => {
    if (trackId) setSelectedTrackId(trackId)
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    const t    = pct * duration
    getAudioPlayerInstance()?.seekTo(t)
  }, [duration, setSelectedTrackId])

  // ── Add Track ────────────────────────────────────────────────────────────
  const handleAddTrack = useCallback(async () => {
    const result = await window.electronAPI.audio.openFile()
    if (!result) return
    const sfId    = addSourceFile(result.filePath, result.metadata.durationSeconds)
    const trackId = addTrack(undefined, sfId)
    try {
      await getAudioPlayerInstance()?.loadSourceFile(sfId, result.filePath)
    } catch (err) {
      console.warn('[WaveformView] Could not register source with player:', err)
    }
    setTrackPeaks((prev) => new Map(prev).set(trackId, 'loading'))
    try {
      const pd = await window.electronAPI.audio.generatePeaks(result.filePath)
      setTrackPeaks((prev) => new Map(prev).set(trackId, pd))
    } catch (err) {
      console.error('[WaveformView] Failed to generate peaks for new track:', err)
      setTrackPeaks((prev) => { const m = new Map(prev); m.delete(trackId); return m })
    }
  }, [addSourceFile, addTrack])

  // ── Remove track ─────────────────────────────────────────────────────────
  const handleRemoveTrack = useCallback((trackId: string) => {
    removeTrack(trackId)
    useTranscriptStore.getState().removeWordsForTrack(trackId)
    setTrackPeaks((prev) => { const m = new Map(prev); m.delete(trackId); return m })
  }, [removeTrack])

  // ── Clip drag ─────────────────────────────────────────────────────────────
  const dragRef = useRef<{
    clipId:    string
    origStart: number
    ghostPct:  number
    trackId:   string
    startX:    number
  } | null>(null)
  const [ghostState, setGhostState] = useState<{ pct: number; widthPct: number } | null>(null)

  const handleClipPointerDown = useCallback((
    e: React.PointerEvent,
    clip: Clip,
  ) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      clipId:    clip.id,
      origStart: clip.outputStart,
      ghostPct:  duration > 0 ? (clip.outputStart / duration) * 100 : 0,
      trackId:   clip.trackId,
      startX:    e.clientX,
    }
    const widthPct = duration > 0 ? ((clip.sourceEnd - clip.sourceStart) / duration) * 100 : 0
    setGhostState({ pct: duration > 0 ? (clip.outputStart / duration) * 100 : 0, widthPct })
  }, [duration])

  const handleClipPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    const delta  = e.clientX - dragRef.current.startX
    const laneEl = (e.currentTarget as HTMLDivElement).closest('[data-lane]') as HTMLDivElement
    const laneW  = laneEl?.getBoundingClientRect().width ?? 1
    const deltaPct = (delta / laneW) * 100
    const newPct   = Math.max(0, dragRef.current.ghostPct + deltaPct)
    setGhostState((g) => g ? { ...g, pct: newPct } : null)
  }, [])

  const handleClipPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !ghostState) { dragRef.current = null; setGhostState(null); return }
    const laneEl = (e.currentTarget as HTMLDivElement).closest('[data-lane]') as HTMLDivElement
    const laneW  = laneEl?.getBoundingClientRect().width ?? 1
    const newOutputStart = (ghostState.pct / 100) * duration

    const { tracks: allTracks } = useTimelineStore.getState()
    const allEdges = allTracks.flatMap((t) =>
      t.clips
        .filter((c) => c.id !== dragRef.current!.clipId)
        .flatMap((c) => [
          c.outputStart,
          c.outputStart + (c.sourceEnd - c.sourceStart),
        ])
    )
    const snapThresholdSec = (5 / laneW) * duration
    const clipped = allTracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === dragRef.current!.clipId)
    const clipDur = clipped ? clipped.sourceEnd - clipped.sourceStart : 0
    let snapped = newOutputStart
    for (const edge of allEdges) {
      if (Math.abs(newOutputStart - edge) < snapThresholdSec) { snapped = edge; break }
      if (Math.abs(newOutputStart + clipDur - edge) < snapThresholdSec) { snapped = edge - clipDur; break }
    }

    moveClip(dragRef.current.clipId, Math.max(0, snapped))
    dragRef.current = null
    setGhostState(null)
  }, [ghostState, duration, moveClip])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display:         'flex',
        flexDirection:   'column',
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom:    '1px solid var(--color-border)',
      }}
    >
      {/* Main area: fixed headers column + scrollable timeline */}
      <div style={{ display: 'flex', flexDirection: 'row' }}>

        {/* ── Fixed headers column ──────────────────────────────────────── */}
        <div
          style={{
            width:     HEADER_WIDTH,
            flexShrink: 0,
            display:   'flex',
            flexDirection: 'column',
          }}
        >
          {/* Ruler spacer — contains zoom controls */}
          <div
            style={{
              height:          RULER_HEIGHT,
              boxSizing:       'border-box',
              borderRight:     '1px solid var(--color-border)',
              borderBottom:    '1px solid var(--color-border-subtle)',
              display:         'flex',
              alignItems:      'center',
              justifyContent:  'flex-end',
              padding:         '0 4px',
              gap:             2,
              backgroundColor: 'var(--color-bg-secondary)',
            }}
          >
            <button
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1}
              title="Zoom out"
              style={{
                background: 'none',
                border:     '1px solid var(--color-border)',
                borderRadius: 2,
                color:      zoomLevel <= 1 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                fontSize:   10,
                lineHeight:  1,
                cursor:     zoomLevel <= 1 ? 'not-allowed' : 'pointer',
                padding:    '1px 3px',
                opacity:    zoomLevel <= 1 ? 0.4 : 1,
              }}
            >
              −
            </button>
            <span
              style={{
                fontSize:  9,
                color:     'var(--color-text-muted)',
                minWidth:  22,
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {zoomLevel === 1 ? 'fit' : `${zoomLevel}×`}
            </span>
            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 32}
              title="Zoom in"
              style={{
                background: 'none',
                border:     '1px solid var(--color-border)',
                borderRadius: 2,
                color:      zoomLevel >= 32 ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                fontSize:   10,
                lineHeight:  1,
                cursor:     zoomLevel >= 32 ? 'not-allowed' : 'pointer',
                padding:    '1px 3px',
                opacity:    zoomLevel >= 32 ? 0.4 : 1,
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
        <div
          ref={scrollViewportRef}
          style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}
        >
          {/* Timeline content — width = zoomLevel × viewport width (min 100%) */}
          <div
            style={{
              minWidth:  '100%',
              width:     duration > 0 ? `${pxPerSec * duration}px` : '100%',
              position:  'relative',
            }}
          >
            {/* Ruler row */}
            <div
              id="waveform-timeline"
              onClick={handleLaneClick}
              style={{
                height:       RULER_HEIGHT,
                width:        '100%',
                boxSizing:    'border-box',
                borderBottom: '1px solid var(--color-border-subtle)',
                cursor:       'crosshair',
              }}
            />

            {/* Track lanes */}
            {tracks.map((track, trackIndex) => {
              const peakState     = trackPeaks.get(track.id)
              const trackPeakData = peakState === 'loading' || peakState === undefined ? null : peakState
              return (
                <div
                  key={track.id}
                  data-lane={track.id}
                  data-trackid={track.id}
                  style={{
                    height:       LANE_HEIGHT,
                    position:     'relative',
                    cursor:       'crosshair',
                    overflow:     'hidden',
                    borderBottom: '1px solid var(--color-border)',
                    borderLeft:   track.id === selectedTrackId
                      ? '2px solid var(--color-accent)'
                      : '2px solid transparent',
                  }}
                  onClick={(e) => handleLaneClick(e, track.id)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerUp}
                >
                  {peakState === 'loading' && (
                    <div
                      style={{
                        position:       'absolute',
                        inset:          0,
                        display:        'flex',
                        alignItems:     'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        Generating waveform…
                      </span>
                    </div>
                  )}

                  {/* WaveSurfer canvas for this track */}
                  {trackPeakData && (
                    <TrackWaveform
                      key={track.id}
                      trackId={track.id}
                      peaks={trackPeakData}
                      color={track.color}
                      trackIndex={trackIndex}
                      onWsReady={trackIndex === 0
                        ? (ws) => { wsTrack0Ref.current = ws }
                        : undefined
                      }
                    />
                  )}

                  {/* Clip blocks */}
                  {track.clips.map((clip) => {
                    const clipDur    = clip.sourceEnd - clip.sourceStart
                    const leftPct    = duration > 0 ? (clip.outputStart / duration) * 100 : 0
                    const widthPct   = duration > 0 ? (clipDur / duration) * 100 : 0
                    const isDragging = dragRef.current?.clipId === clip.id
                    return (
                      <div
                        key={clip.id}
                        onPointerDown={(e) => handleClipPointerDown(e, clip)}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTrackId(track.id)
                          setSelectedClipId(clip.id === selectedClipId ? null : clip.id)
                          setSelection({ start: clip.outputStart, end: clip.outputStart + clipDur })
                        }}
                        style={{
                          position:        'absolute',
                          left:            `${leftPct}%`,
                          width:           `${widthPct}%`,
                          top:             4,
                          bottom:          4,
                          borderRadius:    3,
                          border:          clip.id === selectedClipId
                            ? '1px solid var(--color-accent)'
                            : '1px solid rgba(99, 102, 241, 0.25)',
                          backgroundColor: clip.muted
                            ? 'rgba(239, 68, 68, 0.22)'
                            : 'rgba(99, 102, 241, 0.08)',
                          opacity:         isDragging ? 0.4 : 1,
                          cursor:          'grab',
                          pointerEvents:   'all',
                          zIndex:          isDragging ? 0 : 5,
                          boxSizing:       'border-box',
                          overflow:        'hidden',
                        }}
                      >
                        {trackPeakData && (
                          <ClipWaveform
                            peaks={trackPeakData}
                            sourceStart={clip.sourceStart}
                            sourceEnd={clip.sourceEnd}
                            color={track.color}
                            muted={clip.muted}
                          />
                        )}
                      </div>
                    )
                  })}

                  {/* Drag ghost */}
                  {ghostState && dragRef.current && track.clips.some((c) => c.id === dragRef.current!.clipId) && (
                    <div
                      style={{
                        position:        'absolute',
                        left:            `${ghostState.pct}%`,
                        width:           `${ghostState.widthPct}%`,
                        top:             4,
                        bottom:          4,
                        borderRadius:    3,
                        border:          '1px dashed var(--color-accent)',
                        backgroundColor: 'rgba(99,102,241,0.2)',
                        pointerEvents:   'none',
                        zIndex:          20,
                      }}
                    />
                  )}

                  {/* Gap overlays — cover waveform between clips */}
                  {(() => {
                    const sorted = [...track.clips].sort((a, b) => a.outputStart - b.outputStart)
                    return sorted.slice(0, -1).flatMap((clip, i) => {
                      const clipEnd   = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
                      const nextStart = sorted[i + 1].outputStart
                      if (nextStart <= clipEnd + 0.001) return []
                      const leftPct  = duration > 0 ? (clipEnd / duration) * 100 : 0
                      const widthPct = duration > 0 ? ((nextStart - clipEnd) / duration) * 100 : 0
                      return [(
                        <div
                          key={`gap-${clip.id}`}
                          style={{
                            position:        'absolute',
                            left:            `${leftPct}%`,
                            width:           `${widthPct}%`,
                            top:             0,
                            bottom:          0,
                            backgroundColor: 'var(--color-bg-secondary)',
                            pointerEvents:   'none',
                            zIndex:          6,
                          }}
                        />
                      )]
                    })
                  })()}

                  {/* Split markers */}
                  {track.clips
                    .slice(1)
                    .map((clip) => (
                      <div
                        key={`split-${clip.id}`}
                        style={{
                          position:        'absolute',
                          top:             0,
                          bottom:          0,
                          left:            duration > 0
                            ? `calc(${(clip.outputStart / duration) * 100}% - 1px)`
                            : '0',
                          width:           2,
                          backgroundColor: 'rgba(99, 102, 241, 0.85)',
                          pointerEvents:   'none',
                          zIndex:          10,
                        }}
                      />
                    ))}

                </div>
              )
            })}

            {/* Global playhead — inside scrollable content so it scrolls with clips */}
            <div
              style={{
                position:        'absolute',
                top:             0,
                bottom:          0,
                left:            `${playheadPct}%`,
                width:           1,
                backgroundColor: 'rgba(255,255,255,0.7)',
                pointerEvents:   'none',
                zIndex:          30,
              }}
            />

          </div>
        </div>
      </div>

      {/* + Add Track row */}
      <div
        onClick={handleAddTrack}
        style={{
          display:    'flex',
          alignItems: 'center',
          padding:    '6px 12px',
          cursor:     'pointer',
          color:      'var(--color-text-muted)',
          fontSize:   'var(--text-xs)',
          borderTop:  '1px solid var(--color-border)',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.color = 'var(--color-accent)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.color = 'var(--color-text-muted)')}
      >
        + Add Track
      </div>
    </div>
  )
}

// ── TrackWaveform — per-track WaveSurfer instance ─────────────────────────────

interface TrackWaveformProps {
  trackId:    string
  peaks:      PeakData
  color:      string
  trackIndex: number
  /** Called once WaveSurfer is ready, with the WaveSurfer instance. */
  onWsReady?: (ws: WaveSurfer) => void
}

function TrackWaveform({ trackId, peaks, color, trackIndex, onWsReady }: TrackWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const timelinePluginOptions = trackIndex === 0
      ? {
          container:            '#waveform-timeline',
          timeInterval:         10,
          primaryLabelInterval: 60,
          style: { fontSize: '10px', color: 'var(--color-text-muted)' },
        }
      : undefined

    const plugins = timelinePluginOptions
      ? [TimelinePlugin.create(timelinePluginOptions)]
      : []

    const ws = WaveSurfer.create({
      container:     containerRef.current,
      waveColor:     color,
      progressColor: color + '99',
      cursorWidth:   0,
      barWidth:      2,
      barGap:        1,
      barRadius:     2,
      height:        LANE_HEIGHT - 8,
      peaks:         peaks.data,
      duration:      peaks.durationSeconds,
      plugins,
    })

    ws.on('interaction', (t: number) => {
      getAudioPlayerInstance()?.seekTo(t)
    })

    onWsReady?.(ws)
    console.log(`[WaveformView] WaveSurfer ready for track ${trackId}`)

    return () => {
      ws.destroy()
    }
  // onWsReady intentionally excluded — changing the callback shouldn't recreate WaveSurfer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks, color, trackId, trackIndex])

  return (
    <div
      ref={containerRef}
      style={{
        position:      'absolute',
        inset:         0,
        opacity:       0,
        pointerEvents: 'none',
      }}
    />
  )
}

// ── ClipWaveform — per-clip waveform SVG ──────────────────────────────────────

interface ClipWaveformProps {
  peaks:       PeakData
  sourceStart: number
  sourceEnd:   number
  color:       string
  muted:       boolean
}

const ClipWaveform = React.memo(function ClipWaveform({ peaks, sourceStart, sourceEnd, color, muted }: ClipWaveformProps) {
  const channel = peaks.data[0]
  if (!channel?.length) return null

  const totalLen  = channel.length
  const dur       = peaks.durationSeconds
  const startIdx  = Math.floor((sourceStart / dur) * totalLen)
  const endIdx    = Math.ceil((sourceEnd / dur) * totalLen)
  const clipPeaks = channel.slice(startIdx, endIdx)
  if (clipPeaks.length === 0) return null

  const H    = 80
  const viewW = clipPeaks.length * 3

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox={`0 0 ${viewW} ${H}`}
      preserveAspectRatio="none"
    >
      <g fill={muted ? 'rgba(239,68,68,0.6)' : (color + 'cc')}>
        {clipPeaks.map((v, i) => {
          const bh = Math.max(2, v * H)
          const y  = (H - bh) / 2
          return <rect key={i} x={i * 3} y={y} width={2} height={bh} />
        })}
      </g>
    </svg>
  )
})
