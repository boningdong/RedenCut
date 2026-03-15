// ─────────────────────────────────────────────────────────────────────────────
// WaveformView
//
// Wraps wavesurfer.js v7 and connects it to the editor + playback stores.
//
// Key decisions:
//   1. Peaks + duration only — wavesurfer never decodes the raw audio.
//      Critical for files > 100 MB.
//   2. HTMLMediaElement backend — streams large files without loading into RAM.
//   3. RegionsPlugin handles both:
//        • Mute edit regions (persisted) — red, IDs prefixed with 'edit-'
//        • Drag-to-select region (ephemeral) — amber, ID assigned by wavesurfer
//   4. Preview Mode — on timeupdate, if a muted region is hit, seek to its end.
//      If playhead starts inside a muted region on Play, skip forward immediately.
//   5. Clicking an edit region sets selectedEditId so Delete/U can remove it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
import type { PeakData } from '@shared/project.types'
import { usePlaybackStore } from '../../stores/playback.store'
import { useEditorStore } from '../../stores/editor.store'

interface WaveformViewProps {
  /** podcut:// URL served by the custom protocol handler in main */
  audioUrl: string
  /** Pre-generated peaks from the main process */
  peaks: PeakData
}

export function WaveformView({ audioUrl, peaks }: WaveformViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef   = useRef<HTMLDivElement>(null)
  const audioRef     = useRef<HTMLAudioElement>(null)
  const wsRef        = useRef<WaveSurfer | null>(null)
  const regionsRef   = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)

  // Track the ID of the ephemeral drag-selection region
  const selectionRegionIdRef = useRef<string | null>(null)

  const setPlaying     = usePlaybackStore((s) => s.setPlaying)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setDuration    = usePlaybackStore((s) => s.setDuration)

  const edits           = useEditorStore((s) => s.edits)
  const selection       = useEditorStore((s) => s.selection)
  const previewMode     = useEditorStore((s) => s.previewMode)
  const selectedEditId  = useEditorStore((s) => s.selectedEditId)
  const setSelection    = useEditorStore((s) => s.setSelection)
  const setSelectedEditId = useEditorStore((s) => s.setSelectedEditId)

  // ── Create / destroy wavesurfer instance ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !minimapRef.current || !audioRef.current) return

    const wsRegions = RegionsPlugin.create()
    regionsRef.current = wsRegions

    // Set src on the audio element before handing it to WaveSurfer.
    // Do NOT pass `url` to WaveSurfer.create() — when WaveSurfer receives
    // a url it triggers its own internal load/fetch path which can race
    // with the custom protocol handler and produce "no supported sources".
    // Setting src here and passing only `media` keeps WaveSurfer out of
    // the loading loop: it renders from peaks immediately and plays via
    // the element whose src is already set.
    audioRef.current.src = audioUrl

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
      media: audioRef.current,
      peaks: peaks.data,
      duration: peaks.durationSeconds,
      plugins: [
        TimelinePlugin.create({
          container: '#waveform-timeline',
          timeInterval: 10,
          primaryLabelInterval: 60,
          style: { fontSize: '10px', color: 'var(--color-text-muted)' },
        }),
        MinimapPlugin.create({
          container: minimapRef.current,
          height: 20,
          waveColor: '#3730a3',
          progressColor: '#6366f1',
        }),
        wsRegions,
      ],
    })

    // Enable drag-to-select a time range on the waveform
    wsRegions.enableDragSelection({ color: 'rgba(245, 158, 11, 0.15)' })

    // ── Region events ──────────────────────────────────────────────────────
    wsRegions.on('region-created', (region) => {
      // Edit regions are added programmatically with 'edit-' IDs — ignore them here
      if (region.id.startsWith('edit-')) return

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

    // Clicking an edit region selects it for Delete/U; clicking background clears all
    wsRegions.on('region-clicked', (region, e) => {
      e.stopPropagation()
      if (region.id.startsWith('edit-')) {
        // Select this edit region; clear any drag-selection
        if (selectionRegionIdRef.current) {
          const sel = wsRegions.getRegions().find((r) => r.id === selectionRegionIdRef.current)
          sel?.remove()
          selectionRegionIdRef.current = null
        }
        setSelectedEditId(region.id)
        setSelection({ start: region.start, end: region.end })
      }
    })

    // Clicking the waveform background clears drag-selection and edit selection
    ws.on('interaction', () => {
      if (selectionRegionIdRef.current) {
        const r = wsRegions.getRegions().find((r) => r.id === selectionRegionIdRef.current)
        r?.remove()
        selectionRegionIdRef.current = null
        setSelection(null)
      }
      setSelectedEditId(null)
    })

    // ── Playback events ────────────────────────────────────────────────────
    ws.on('ready',      () => setDuration(ws.getDuration()))
    ws.on('play',       () => setPlaying(true))
    ws.on('pause',      () => setPlaying(false))
    ws.on('finish',     () => setPlaying(false))
    ws.on('timeupdate', (time) => setCurrentTime(time))

    wsRef.current = ws
    setWaveSurferInstance(ws)
    setRegionsPluginInstance(wsRegions)

    return () => {
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
      selectionRegionIdRef.current = null
      setWaveSurferInstance(null)
      setRegionsPluginInstance(null)
    }
  }, [audioUrl, peaks]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync edit regions → WaveSurfer ────────────────────────────────────────
  // Re-runs whenever edits or selectedEditId changes. Wipes and re-adds all
  // edit regions so the selected one can render with a different colour.
  useEffect(() => {
    const wsRegions = regionsRef.current
    if (!wsRegions) return

    wsRegions.getRegions().forEach((r) => {
      if (r.id.startsWith('edit-')) r.remove()
    })

    edits.forEach((edit) => {
      const isSelected = edit.id === selectedEditId
      wsRegions.addRegion({
        id: edit.id,
        start: edit.start,
        end: edit.end,
        color: isSelected
          ? 'rgba(239, 68, 68, 0.45)'   // brighter when selected
          : edit.type === 'mute'
            ? 'rgba(239, 68, 68, 0.22)'
            : 'rgba(99, 102, 241, 0.22)',
        drag: false,
        resize: false,
      })
    })
  }, [edits, selectedEditId])

  // ── Preview Mode — skip muted regions on timeupdate ───────────────────────
  // Use refs so the listener always sees the latest values without re-registering.
  const previewModeRef = useRef(previewMode)
  const editsRef       = useRef(edits)
  useEffect(() => { previewModeRef.current = previewMode }, [previewMode])
  useEffect(() => { editsRef.current = edits }, [edits])

  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const skip = (time: number) => {
      if (!previewModeRef.current) return
      const muted = editsRef.current.filter((e) => e.type === 'mute')
      const hit = muted.find((e) => time >= e.start && time < e.end)
      if (hit) ws.setTime(hit.end)
    }

    ws.on('timeupdate', skip)
    return () => { ws.un('timeupdate', skip) }
  }, [audioUrl, peaks]) // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* Minimap — scrollable overview */}
      <div
        ref={minimapRef}
        style={{
          borderBottom: '1px solid var(--color-border-subtle)',
          backgroundColor: 'var(--color-bg-primary)',
        }}
      />

      {/* Main waveform canvas */}
      <div ref={containerRef} style={{ padding: '8px 0', cursor: 'crosshair' }} />

      {/* Timeline ruler */}
      <div
        id="waveform-timeline"
        style={{ borderTop: '1px solid var(--color-border-subtle)', paddingBottom: 4 }}
      />

      {/* Hidden audio element — wavesurfer uses this for streaming playback */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  )
}

// ── Module-level imperative handles ───────────────────────────────────────────
// Exposed so TransportBar and keyboard shortcuts can control playback/regions
// without prop drilling.

let _wsInstance: WaveSurfer | null = null
let _regionsInstance: ReturnType<typeof RegionsPlugin.create> | null = null

export function getWaveSurferInstance(): WaveSurfer | null { return _wsInstance }
export function setWaveSurferInstance(ws: WaveSurfer | null): void { _wsInstance = ws }

export function getRegionsPluginInstance() { return _regionsInstance }
export function setRegionsPluginInstance(r: typeof _regionsInstance): void { _regionsInstance = r }
