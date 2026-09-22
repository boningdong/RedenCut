import { useEffect, useRef, useState } from 'react'
import type { PreparedAudioProgress } from '@shared/PreparedAudioTypes'
import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import { getNormalizeEffect } from '@shared/TrackEffects'
import { useEditorStore } from '../../stores/editor.store'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { PreparedWaveformProvider } from './PreparedWaveformProvider'
import { useWaveformDisplayStore } from './WaveformDisplayState'

export interface TrackWaveformDisplay {
  provider?: WaveformDataProvider
  progress?: PreparedAudioProgress
  updating: boolean
  failed: boolean
  peak?: number
}
interface Entry extends TrackWaveformDisplay {
  key: string
  pending?: PreparedWaveformProvider
  provider?: PreparedWaveformProvider
}
/** Strip display/monitor changes out of cache identity: Gain auditions only repaint. */
function waveformProcessingTracks(tracks: Track[]): Track[] {
  return tracks.map((track) => ({
    ...track,
    name: '',
    color: '',
    volume: 1,
    gainDb: 0,
    muted: false,
    solo: false,
    clips: track.clips.map((clip) => ({ ...clip, muted: false })),
  }))
}
export function useTrackWaveformDisplays(
  tracks: Track[],
  providers: ReadonlyMap<AudioSourceId, WaveformDataProvider>,
): ReadonlyMap<string, TrackWaveformDisplay> {
  const workspace = useEditorStore((state) => state.session?.workspaceToken ?? null)
  const entries = useRef(new Map<string, Entry>())
  const [displays, setDisplays] = useState<ReadonlyMap<string, TrackWaveformDisplay>>(new Map())
  const peakJobs = useRef(new Set<string>())
  const publish = () => setDisplays(new Map(entries.current))
  useEffect(() => {
    useWaveformDisplayStore.getState().resetWorkspace(workspace)
    peakJobs.current.clear()
    setDisplays((current) => (current.size ? new Map() : current))
    const ownedEntries = entries.current
    return () => {
      for (const entry of ownedEntries.values()) {
        void entry.pending?.dispose()
        void entry.provider?.dispose()
      }
      ownedEntries.clear()
    }
  }, [workspace])
  useEffect(() => {
    for (const track of tracks) {
      if (
        useWaveformDisplayStore.getState().scales[track.id] !== undefined ||
        peakJobs.current.has(track.id)
      )
        continue
      const sources = [...new Set(track.clips.map((clip) => clip.audioSourceId))]
      const available = sources.map((id) => providers.get(id)).filter((p) => p?.getPeak)
      if (!available.length) continue
      peakJobs.current.add(track.id)
      void Promise.all(available.map((p) => p!.getPeak!()))
        .then((peaks) => {
          if (useEditorStore.getState().session?.workspaceToken === workspace)
            useWaveformDisplayStore.getState().initialize(track.id, Math.max(0, ...peaks))
        })
        .catch(() => {})
        .finally(() => peakJobs.current.delete(track.id))
    }
  }, [tracks, providers, workspace])
  useEffect(() => {
    const session = useEditorStore.getState().session
    if (!session || !window.electronAPI?.preparedAudio?.waveform) return
    const processingTracks = waveformProcessingTracks(tracks)
    const children = new Set(tracks.flatMap((track) => track.mixLink?.stemTrackIds ?? []))
    const desired = new Set<string>()
    let changed = false
    for (const track of processingTracks) {
      if (
        children.has(track.id) ||
        !track.clips.length ||
        (!getNormalizeEffect(track) && !track.clips.some((clip) => clip.sourceOverrides?.length))
      )
        continue
      desired.add(track.id)
      const related = new Set([track.id, ...(track.mixLink?.stemTrackIds ?? [])])
      const key = JSON.stringify(processingTracks.filter((item) => related.has(item.id)))
      const old = entries.current.get(track.id)
      if (old?.key === key) continue
      void old?.pending?.dispose()
      const pending = new PreparedWaveformProvider(session)
      const entry: Entry = {
        key,
        pending,
        provider: old?.provider,
        peak: old?.peak,
        updating: true,
        failed: false,
      }
      entries.current.set(track.id, entry)
      changed = true
      // Ignore unrelated track extent and effects while retaining every linked source.
      const relevant = processingTracks.filter((item) => related.has(item.id))
      void pending
        .prepare(relevant, track.id, (progress) => {
          if (entries.current.get(track.id) !== entry) return
          entry.progress = progress
          publish()
        })
        .then(async () => {
          const peak = await pending.getPeak()
          if (entries.current.get(track.id) !== entry) {
            await pending.dispose()
            return
          }
          void entry.provider?.dispose()
          entries.current.set(track.id, {
            key,
            provider: pending,
            peak,
            updating: false,
            failed: false,
          })
          publish()
        })
        .catch(() => {
          void pending.dispose()
          if (entries.current.get(track.id) !== entry) return
          entries.current.set(track.id, {
            key,
            provider: entry.provider,
            peak: entry.peak,
            updating: false,
            failed: true,
          })
          publish()
        })
    }
    for (const [id, entry] of entries.current) {
      if (desired.has(id)) continue
      void entry.pending?.dispose()
      void entry.provider?.dispose()
      entries.current.delete(id)
      changed = true
    }
    if (changed) publish()
  }, [tracks, workspace])
  return displays
}
