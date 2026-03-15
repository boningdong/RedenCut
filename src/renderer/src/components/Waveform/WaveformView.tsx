// ─────────────────────────────────────────────────────────────────────────────
// WaveformView
//
// WaveSurfer is used PURELY as a visual renderer. It owns no audio element
// and never calls play/pause. All audio is managed by IAudioPlayer (see
// player.types.ts / SimpleAudioPlayer.ts).
//
// Architecture:
//   • WaveSurfer is created with peaks + duration only — no media, no url.
//     It renders from pre-computed peaks immediately.
//   • Cursor position is driven by player.onTimeUpdate → ws.setTime(t)
//   • User clicks the waveform: ws.on('interaction', t) → player.seekTo(t)
//   • Muted clip regions are rendered from timeline.store.tracks (not edits[])
//   • Preview Mode skip: when onTimeUpdate fires inside a muted clip, seekTo
//     the clip's output end.
//   • Drag-to-select creates ephemeral amber regions stored in editor.store.selection
//
// Log prefix: [WaveformView]
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import type { PeakData, Clip } from '@shared/project.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/timeline.store'

interface WaveformViewProps {
  /** Pre-generated peaks from the main process */
  peaks: PeakData
}

export function WaveformView({ peaks }: WaveformViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef        = useRef<WaveSurfer | null>(null)
  const regionsRef   = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)

  // Track the ID of the ephemeral drag-selection region
  const selectionRegionIdRef = useRef<string | null>(null)

  // Store subscriptions
  const selection         = useEditorStore((s) => s.selection)
  const previewMode       = useEditorStore((s) => s.previewMode)
  const setSelection      = useEditorStore((s) => s.setSelection)

  // Timeline store — muted clips drive the red regions on the waveform
  const tracks            = useTimelineStore((s) => s.tracks)
  const selectedClipId    = useTimelineStore((s) => s.selectedClipId)
  const setSelectedClipId = useTimelineStore((s) => s.setSelectedClipId)

  // Keep a ref so the player callback always sees the latest previewMode value
  // without needing to re-subscribe when previewMode changes
  const previewModeRef = useRef(previewMode)
  useEffect(() => { previewModeRef.current = previewMode }, [previewMode])

  // ── Create / destroy WaveSurfer instance ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    console.log('[WaveformView] Creating WaveSurfer instance (peaks-only, no media)')

    const wsRegions = RegionsPlugin.create()
    regionsRef.current = wsRegions

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4f46e5',
      progressColor: '#818cf8',
      cursorColor: 'rgba(255,255,255,0.6)',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,
      // No 'media' and no 'url' — WaveSurfer is purely visual.
      // All audio playback is handled by IAudioPlayer (SimpleAudioPlayer / WebCodecsPlayer).
      peaks: peaks.data,
      duration: peaks.durationSeconds,
      plugins: [
        TimelinePlugin.create({
          container: '#waveform-timeline',
          timeInterval: 10,
          primaryLabelInterval: 60,
          style: { fontSize: '10px', color: 'var(--color-text-muted)' },
        }),
        wsRegions,
      ],
    })

    // Enable drag-to-select a time range on the waveform
    wsRegions.enableDragSelection({ color: 'rgba(245, 158, 11, 0.15)' })

    // ── Region events ──────────────────────────────────────────────────────

    wsRegions.on('region-created', (region) => {
      // Clip mute regions are added programmatically with 'clip-' IDs — ignore
      if (region.id.startsWith('clip-')) return

      // Remove any previous selection region
      if (selectionRegionIdRef.current && selectionRegionIdRef.current !== region.id) {
        const prev = wsRegions.getRegions().find((r) => r.id === selectionRegionIdRef.current)
        prev?.remove()
      }
      selectionRegionIdRef.current = region.id
      setSelection({ start: region.start, end: region.end })
    })

    wsRegions.on('region-updated', (region) => {
      if (region.id === selectionRegionIdRef.current) {
        setSelection({ start: region.start, end: region.end })
      }
    })

    // Clicking a clip mute region selects it for Delete/U key
    wsRegions.on('region-clicked', (region, e) => {
      e.stopPropagation()
      if (region.id.startsWith('clip-')) {
        const clipId = region.id.slice(5)  // 'clip-{clipId}'
        // Clear any drag-selection
        if (selectionRegionIdRef.current) {
          const sel = wsRegions.getRegions().find((r) => r.id === selectionRegionIdRef.current)
          sel?.remove()
          selectionRegionIdRef.current = null
        }
        setSelectedClipId(clipId)
        setSelection({ start: region.start, end: region.end })
        console.log(`[WaveformView] clip region clicked id=${clipId}`)
      }
    })

    // Clicking the waveform background clears selections and seeks the player
    ws.on('interaction', (newTime: number) => {
      console.log(`[WaveformView] interaction newTime=${newTime.toFixed(2)}s`)
      if (selectionRegionIdRef.current) {
        const r = wsRegions.getRegions().find((r) => r.id === selectionRegionIdRef.current)
        r?.remove()
        selectionRegionIdRef.current = null
        setSelection(null)
      }
      setSelectedClipId(null)
      // Move cursor immediately (snappy feel)
      ws.setTime(newTime)
      // Seek the player — triggers onTimeUpdate which will also call ws.setTime (idempotent)
      getAudioPlayerInstance()?.seekTo(newTime)
    })

    // ── Player → cursor bridge ─────────────────────────────────────────────
    // Subscribe to the player's time ticks to drive the WaveSurfer cursor.
    // Also implements Preview Mode: if playhead enters a muted clip, skip to end.
    const player = getAudioPlayerInstance()
    let unsubTimeUpdate: (() => void) | null = null

    if (player) {
      console.log('[WaveformView] Subscribing to player.onTimeUpdate')
      unsubTimeUpdate = player.onTimeUpdate((t) => {
        ws.setTime(t)

        if (previewModeRef.current) {
          const { tracks: currentTracks } = useTimelineStore.getState()
          const hit = currentTracks
            .flatMap((tr) => tr.clips as Clip[])
            .find((c) => {
              if (!c.muted) return false
              const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
              return t >= c.outputStart && t < outputEnd
            })
          if (hit) {
            const outputEnd = hit.outputStart + (hit.sourceEnd - hit.sourceStart)
            console.log(`[WaveformView] preview skip t=${t.toFixed(2)}s → ${outputEnd.toFixed(2)}s`)
            getAudioPlayerInstance()?.seekTo(outputEnd)
          }
        }
      })
    } else {
      console.warn('[WaveformView] player not yet available at mount — cursor will not move until file opens')
    }

    wsRef.current = ws
    setWaveSurferInstance(ws)
    setRegionsPluginInstance(wsRegions)

    console.log(`[WaveformView] WaveSurfer ready — duration=${peaks.durationSeconds.toFixed(2)}s`)

    return () => {
      console.log('[WaveformView] Destroying WaveSurfer instance')
      unsubTimeUpdate?.()
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
      selectionRegionIdRef.current = null
      setWaveSurferInstance(null)
      setRegionsPluginInstance(null)
    }
  }, [peaks]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync muted clip regions → WaveSurfer ──────────────────────────────────
  // Re-runs whenever tracks or selectedClipId change.
  // Only muted clips get a red region overlay; unmuted clips are invisible.
  useEffect(() => {
    const wsRegions = regionsRef.current
    if (!wsRegions) return

    // Remove all previously rendered clip regions
    wsRegions.getRegions().forEach((r) => {
      if (r.id.startsWith('clip-')) r.remove()
    })

    tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        if (!clip.muted) return
        const outputEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
        const isSelected = clip.id === selectedClipId
        wsRegions.addRegion({
          id: `clip-${clip.id}`,
          start: clip.outputStart,
          end: outputEnd,
          color: isSelected
            ? 'rgba(239, 68, 68, 0.45)'  // brighter when selected
            : 'rgba(239, 68, 68, 0.22)',
          drag: false,
          resize: false,
        })
      })
    })
  }, [tracks, selectedClipId])

  // ── Sync selection removal from outside (e.g. after a keyboard shortcut) ─
  useEffect(() => {
    if (selection !== null) return
    if (!selectionRegionIdRef.current || !regionsRef.current) return
    const r = regionsRef.current.getRegions().find(
      (r) => r.id === selectionRegionIdRef.current,
    )
    r?.remove()
    selectionRegionIdRef.current = null
  }, [selection])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Main waveform canvas */}
      <div ref={containerRef} style={{ padding: '8px 0', cursor: 'crosshair' }} />

      {/* Timeline ruler */}
      <div
        id="waveform-timeline"
        style={{ borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 4 }}
      />
    </div>
  )
}

// ── Module-level imperative handles ───────────────────────────────────────────
// Exposed so keyboard shortcuts can call ws.setTime() for nudge operations.
// In the new design, these are less critical (use player.seekTo() instead),
// but keeping them avoids breaking existing call sites.

let _wsInstance: WaveSurfer | null = null
let _regionsInstance: ReturnType<typeof RegionsPlugin.create> | null = null

export function getWaveSurferInstance(): WaveSurfer | null { return _wsInstance }
export function setWaveSurferInstance(ws: WaveSurfer | null): void { _wsInstance = ws }

export function getRegionsPluginInstance() { return _regionsInstance }
export function setRegionsPluginInstance(r: typeof _regionsInstance): void { _regionsInstance = r }
