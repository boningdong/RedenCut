import { expect, test } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import { timelineValuesEqual } from './TimelineSnapshot'

type Strategy = 'deep-copy-json' | 'shared-track-json' | 'shared-branch-compare'
const strategies: Strategy[] = ['deep-copy-json', 'shared-track-json', 'shared-branch-compare']

function project(trackCount: number, clipsPerTrack: number): Track[] {
  return Array.from({ length: trackCount }, (_, t) => ({
    id: `track-${t}`,
    name: `Track ${t}`,
    volume: 1,
    muted: false,
    solo: false,
    color: '#aabbcc',
    effects: [],
    clips: Array.from({ length: clipsPerTrack }, (_, c) => ({
      id: `clip-${t}-${c}`,
      trackId: `track-${t}`,
      audioSourceId:
        '00000000-0000-4000-8000-000000000001' as Track['clips'][number]['audioSourceId'],
      sourceStart: c * 5,
      sourceEnd: c * 5 + 5,
      outputStart: c * 5,
      gain: 1,
      muted: false,
      effects: [],
      redactions: [
        {
          id: `redact-${t}-${c}`,
          sourceStart: c * 5 + 1,
          sourceEnd: c * 5 + 2,
          crossfade: { enabled: true, durationMs: 30, curve: 'equal-power' as const },
        },
      ],
    })),
  }))
}

function measure(strategy: Strategy, trackCount: number, clipsPerTrack: number, edits: number) {
  let tracks = project(trackCount, clipsPerTrack)
  const initial = tracks
  const history: Track[][] = []
  const samples: number[] = []
  globalThis.gc?.()
  const initialHeap = process.memoryUsage().heapUsed
  for (let index = 0; index < edits; index++) {
    const start = performance.now()
    const changedTrack = index % trackCount
    const changedClip = (index * 137 + clipsPerTrack - 1) % clipsPerTrack
    const next = tracks.map((track, t) =>
      t !== changedTrack
        ? track
        : {
            ...track,
            clips: track.clips.map((clip, c) =>
              c !== changedClip
                ? clip
                : {
                    ...clip,
                    muted: !clip.muted,
                  },
            ),
          },
    )
    const equal =
      strategy === 'deep-copy-json'
        ? JSON.stringify(tracks) === JSON.stringify(next)
        : strategy === 'shared-track-json'
          ? tracks.every(
              (track, t) => track === next[t] || JSON.stringify(track) === JSON.stringify(next[t]),
            )
          : timelineValuesEqual(tracks, next)
    if (equal) throw new Error('Benchmark edit unexpectedly had no effect')
    history.push(strategy === 'deep-copy-json' ? structuredClone(tracks) : tracks)
    tracks = next
    samples.push(performance.now() - start)
  }
  globalThis.gc?.()
  const retainedHeap = process.memoryUsage().heapUsed - initialHeap
  const uniqueClips = new Set(
    history.flatMap((snapshot) => snapshot.flatMap((track) => track.clips)),
  )
  for (const track of tracks) for (const clip of track.clips) uniqueClips.add(clip)
  const sorted = samples.sort((a, b) => a - b)
  const result = {
    strategy,
    trackCount,
    clipsPerTrack,
    edits,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    retainedHeapMiB: retainedHeap / 1024 ** 2,
    uniqueClips: uniqueClips.size,
  }
  // Keep all snapshots live through the heap measurement and verify real history isolation.
  expect(history).toHaveLength(edits)
  expect(history[0][0].clips[0].muted).toBe(false)
  if (strategy !== 'deep-copy-json') {
    expect(history[0]).toBe(initial)
    expect(uniqueClips.size).toBe(trackCount * clipsPerTrack + edits)
  } else {
    expect(uniqueClips.size).toBe(trackCount * clipsPerTrack * (edits + 1))
  }
  return result
}

for (const [trackCount, clipsPerTrack, edits] of [
  [16, 100, 60],
  [64, 300, 40],
]) {
  test(`profiles history with ${trackCount} tracks and ${clipsPerTrack} clips per track`, () => {
    if (!globalThis.gc)
      throw new Error('Use npm run profile:timeline so retained heap can be measured')
    // These isolate snapshot retention/comparison, excluding rendering, Mix synchronization and PCM.
    // Time/heap are observations, not machine-dependent CI gates; object counts are deterministic.
    for (const strategy of strategies) {
      // Warm the comparison/JIT on a small independent project; exclude it from the report.
      measure(strategy, 2, 10, 10)
      console.warn(JSON.stringify(measure(strategy, trackCount, clipsPerTrack, edits)))
    }
  }, 60_000)
}
