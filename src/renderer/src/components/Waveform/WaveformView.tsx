// ─────────────────────────────────────────────────────────────────────────────
// WaveformView — multi-track
//
// Layout:
//   ┌─ Timeline ruler ──────────────────────────────────────────────────────┐
//   ├─ [TrackHeader 90px] ── [ClipLane, one WaveSurfer] ───────────────────┤
//   │   (repeats per track)                                                 │
//   ├─ + Add Track ─────────────────────────────────────────────────────────┤
//   └───────────────────────────────────────────────────────────────────────┘
//
// Architecture:
//   • One WaveSurfer instance per track, peaks-only (no media element).
//   • All WaveSurfer instances share the same onSeek callback.
//   • Shared playhead = an absolutely-positioned div rendered per lane.
//   • Per-track loading state: Map<trackId, 'loading' | PeakData> (local state,
//     NOT in the global loadingState — that controls the full-page skeleton).
//   • Clip blocks are absolutely-positioned <div>s: left = outputStart/duration * 100%,
//     width = clipDuration/duration * 100%. Muted = red background.
//   • Clip drag: pointer events on clip block → moveClip() on pointer up.
//     Ghost copy shown at drag position. Snap within 5px of adjacent clip edges.
//
// Preview mode (muted-clip skip) is handled here via onTimeUpdate, same as before.
// Split markers are rendered as absolutely-positioned 2px lines, same as before.
//
// Log prefix: [WaveformView]
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import type { PeakData, Clip } from '@shared/project.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { TrackHeader } from './TrackHeader'

interface WaveformViewProps {
  /** Primary track's peaks (loaded before WaveformView mounts). */
  peaks: PeakData
}

// ── Track loading state ────────────────────────────────────────────────────────
type TrackPeakState = 'loading' | PeakData

export function WaveformView({ peaks }: WaveformViewProps) {
  const tracks            = useTimelineStore((s) => s.tracks)
  const addSourceFile     = useTimelineStore((s) => s.addSourceFile)
  const addTrack          = useTimelineStore((s) => s.addTrack)
  const removeTrack       = useTimelineStore((s) => s.removeTrack)
  const moveClip          = useTimelineStore((s) => s.moveClip)
  const selectedClipId    = useTimelineStore((s) => s.selectedClipId)
  const setSelectedClipId = useTimelineStore((s) => s.setSelectedClipId)

  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration    = peaks.durationSeconds  // primary peaks duration as timeline length

  const previewMode  = useEditorStore((s) => s.previewMode)
  const setSelection = useEditorStore((s) => s.setSelection)

  // Per-track peak loading state (secondary tracks only; primary uses `peaks` prop)
  const [trackPeaks, setTrackPeaks] = useState<Map<string, TrackPeakState>>(() => {
    const m = new Map<string, TrackPeakState>()
    if (tracks.length > 0) m.set(tracks[0].id, peaks)  // primary track pre-loaded
    return m
  })

  // Sync primary peaks if they change (e.g. new file opened)
  useEffect(() => {
    if (tracks.length > 0) {
      setTrackPeaks((prev) => new Map(prev).set(tracks[0].id, peaks))
    }
  }, [peaks, tracks])

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

  // ── Seek on lane click ────────────────────────────────────────────────────
  const handleLaneClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    const t    = pct * duration
    getAudioPlayerInstance()?.seekTo(t)
  }, [duration])

  // ── Add Track ────────────────────────────────────────────────────────────
  const handleAddTrack = useCallback(async () => {
    const result = await window.electronAPI.audio.openFile()
    if (!result) return
    const sfId    = addSourceFile(result.filePath, result.metadata.durationSeconds)
    const trackId = addTrack(`Track ${tracks.length + 1}`, sfId)
    // Register the new source in the active player
    try {
      await getAudioPlayerInstance()?.loadSourceFile(sfId, result.filePath)
    } catch (err) {
      console.warn('[WaveformView] Could not register source with player:', err)
    }
    // Generate peaks for the new track (per-track loading — not full-page skeleton)
    setTrackPeaks((prev) => new Map(prev).set(trackId, 'loading'))
    try {
      const pd = await window.electronAPI.audio.generatePeaks(result.filePath)
      setTrackPeaks((prev) => new Map(prev).set(trackId, pd))
    } catch (err) {
      console.error('[WaveformView] Failed to generate peaks for new track:', err)
      setTrackPeaks((prev) => { const m = new Map(prev); m.delete(trackId); return m })
    }
  }, [addSourceFile, addTrack, tracks.length])

  // ── Remove track ─────────────────────────────────────────────────────────
  const handleRemoveTrack = useCallback((trackId: string) => {
    removeTrack(trackId)
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
    // deltaPct relative to lane width
    const deltaPct = (delta / laneW) * 100
    const newPct   = Math.max(0, dragRef.current.ghostPct + deltaPct)
    setGhostState((g) => g ? { ...g, pct: newPct } : null)
  }, [])

  const handleClipPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !ghostState) { dragRef.current = null; setGhostState(null); return }
    const laneEl = (e.currentTarget as HTMLDivElement).closest('[data-lane]') as HTMLDivElement
    const laneW  = laneEl?.getBoundingClientRect().width ?? 1
    const newOutputStart = (ghostState.pct / 100) * duration

    // Snap: find if leading/trailing edge is within 5px of another clip's edge
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
        position:        'relative',
      }}
    >
      {/* Shared timeline ruler (spans the clip lanes only, not the headers) */}
      <div style={{ display: 'flex' }}>
        <div style={{ width: 90, flexShrink: 0, borderRight: '1px solid var(--color-border)' }} />
        <div
          id="waveform-timeline"
          onClick={handleLaneClick}
          style={{
            flex:         1,
            borderBottom: '1px solid var(--color-border-subtle)',
            cursor:       'crosshair',
          }}
        />
      </div>

      {/* Track rows */}
      {tracks.map((track, trackIndex) => {
        const peakState     = trackPeaks.get(track.id)
        const trackPeakData = peakState === 'loading' || peakState === undefined ? null : peakState
        return (
          <div
            key={track.id}
            style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}
          >
            <TrackHeader track={track} onRemove={handleRemoveTrack} />

            {/* Clip lane */}
            <div
              data-lane={track.id}
              data-trackid={track.id}
              style={{
                flex:         1,
                position:     'relative',
                height:       96,
                cursor:       'crosshair',
                overflow:     'hidden',
              }}
              onClick={handleLaneClick}
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

              {/* Gap overlays — cover waveform in regions between clips */}
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
                        opacity:         1,
                        pointerEvents:   'none',
                        zIndex:          6,
                      }}
                    />
                  )]
                })
              })()}

              {/* Split markers — lines at the start of each clip after the first */}
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

              {/* Shared playhead line */}
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
        )
      })}

      {/* + Add Track row */}
      <div
        onClick={handleAddTrack}
        style={{
          display:     'flex',
          alignItems:  'center',
          padding:     '6px 12px',
          cursor:      'pointer',
          color:       'var(--color-text-muted)',
          fontSize:    'var(--text-xs)',
          borderTop:   '1px solid var(--color-border)',
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
// Isolated component so each track gets its own WaveSurfer lifecycle.

interface TrackWaveformProps {
  trackId:    string
  peaks:      PeakData
  color:      string
  trackIndex: number
}

function TrackWaveform({ trackId, peaks, color, trackIndex }: TrackWaveformProps) {
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
      height:        88,
      peaks:         peaks.data,
      duration:      peaks.durationSeconds,
      plugins,
    })

    ws.on('interaction', (t: number) => {
      getAudioPlayerInstance()?.seekTo(t)
    })

    console.log(`[WaveformView] WaveSurfer ready for track ${trackId}`)

    return () => {
      ws.destroy()
    }
  }, [peaks, color, trackId, trackIndex])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        // Hide the waveform canvas — per-clip SVG handles visualization.
        // Keep the component mounted so TimelinePlugin (track 0) continues
        // rendering into #waveform-timeline.
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  )
}

// ── ClipWaveform — per-clip waveform using peaks data ─────────────────────────
// Renders the correct source range of the peaks data inside a clip block.
// This ensures the waveform shown in the clip matches the actual audio
// regardless of clip repositioning on the output timeline.

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
  const viewW = clipPeaks.length * 3   // 2px bar + 1px gap

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

// ── Module-level handles (kept for backward-compat with existing call sites) ───
// These are stubs — the multi-track design has no single global WaveSurfer instance.
// Callers that previously used ws.setTime() should use player.seekTo() instead.

let _wsInstance: WaveSurfer | null = null
let _regionsInstance: ReturnType<typeof RegionsPlugin.create> | null = null

export function getWaveSurferInstance(): WaveSurfer | null { return _wsInstance }
export function setWaveSurferInstance(ws: WaveSurfer | null): void { _wsInstance = ws }
export function getRegionsPluginInstance() { return _regionsInstance }
export function setRegionsPluginInstance(r: typeof _regionsInstance): void { _regionsInstance = r }
