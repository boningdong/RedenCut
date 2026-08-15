// ─────────────────────────────────────────────────────────────────────────────
// Audio Renderer — FFmpeg filter-graph builder
//
// Pure function: takes a ProjectFile snapshot and output path, returns the
// ffmpeg argument array. No I/O, no side effects — unit-testable.
//
// Filter graph shape (see spec §6):
//   Step 1: Per track, collect non-muted clips sorted by outputStart.
//           Skip tracks where all clips are muted.
//   Step 2: Per clip: trim, reset timestamps, apply gain, and delay to outputStart.
//   Step 3: Mix positioned clips within each track and apply track volume.
//   Step 4: [track0][track1]...amix=inputs=T:normalize=0[out]
//           (if T=1, skip amix and use [track0] directly)
//
// ─────────────────────────────────────────────────────────────────────────────

import type { ProjectFile } from '@shared/project.types'

// NOTE: No import of `binaries.ts` here — this module is a pure function so it
// can be unit-tested in the Vitest node environment without Homebrew being present.
// The ffmpeg binary path is resolved in render.ipc.ts (the call site), not here.

/** Build the ffmpeg CLI argument array for an export render. Pure function. */
export function buildRenderArgs(
  project: ProjectFile,
  sourcePaths: ReadonlyMap<string, string>,
  outputPath: string,
): string[] {
  const { audioSources, tracks } = project

  // Map AudioSourceId → FFmpeg input index (0-based, in insertion order)
  const sfIndexMap = new Map<string, number>()
  const inputArgs: string[] = []
  for (const source of audioSources) {
    const sourcePath = sourcePaths.get(source.id)
    if (!sourcePath) throw new Error(`Missing resolved path for audio source: ${source.id}`)
    sfIndexMap.set(source.id, sfIndexMap.size)
    inputArgs.push('-i', sourcePath)
  }

  // Collect active tracks (tracks with at least one non-muted clip)
  type ActiveTrack = { trackIdx: number; clips: (typeof tracks)[0]['clips'] }
  const activeTrackClips: ActiveTrack[] = []
  const anySolo = tracks.some((track) => track.solo)
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].muted || (anySolo && !tracks[i].solo)) continue
    const nonMuted = tracks[i].clips
      .filter((c) => !c.muted)
      .sort((a, b) => a.outputStart - b.outputStart)
    if (nonMuted.length > 0) {
      activeTrackClips.push({ trackIdx: i, clips: nonMuted })
    }
  }

  if (activeTrackClips.length === 0) {
    throw new Error('No non-muted clips to export')
  }

  // Build filter_complex string
  const parts: string[] = []
  let segIndex = 0
  const trackLabels: string[] = []

  for (let ti = 0; ti < activeTrackClips.length; ti++) {
    const { clips, trackIdx } = activeTrackClips[ti]
    const segLabels: string[] = []

    for (const clip of clips) {
      const srcIdx = sfIndexMap.get(clip.audioSourceId)
      if (srcIdx === undefined) throw new Error(`Unknown audioSourceId: ${clip.audioSourceId}`)
      const label = `seg${segIndex++}`
      const delayMilliseconds = Math.max(0, Math.round(clip.outputStart * 1000))
      parts.push(
        `[${srcIdx}:a]atrim=start=${clip.sourceStart}:end=${clip.sourceEnd},asetpts=PTS-STARTPTS,volume=${clip.gain},adelay=${delayMilliseconds}:all=1[${label}]`,
      )
      segLabels.push(`[${label}]`)
    }

    const trackLabel = `track${ti}`
    if (clips.length === 1) {
      parts.push(`${segLabels[0]}volume=${tracks[trackIdx].volume}[${trackLabel}]`)
    } else {
      parts.push(
        `${segLabels.join('')}amix=inputs=${clips.length}:normalize=0:duration=longest,volume=${tracks[trackIdx].volume}[${trackLabel}]`,
      )
    }
    trackLabels.push(`[${trackLabel}]`)
  }

  let outLabel: string
  if (trackLabels.length === 1) {
    // Single active track — use its label directly; no amix needed
    outLabel = trackLabels[0]
  } else {
    parts.push(`${trackLabels.join('')}amix=inputs=${trackLabels.length}:normalize=0[out]`)
    outLabel = '[out]'
  }

  const filterComplex = parts.join(';')

  // Determine format-specific encoding args
  const fmt = project.export?.format ?? 'mp3'
  const encodeArgs = formatToEncodeArgs(fmt)

  return [
    '-y',
    ...inputArgs,
    '-filter_complex',
    filterComplex,
    '-map',
    outLabel,
    ...encodeArgs,
    outputPath,
  ]
}

function formatToEncodeArgs(format: string): string[] {
  switch (format) {
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'aac':
      return ['-c:a', 'aac', '-b:a', '192k']
    case 'flac':
      return ['-c:a', 'flac']
    case 'mp3':
    default:
      return ['-c:a', 'libmp3lame', '-q:a', '2']
  }
}
