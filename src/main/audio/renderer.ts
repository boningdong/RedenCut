// ─────────────────────────────────────────────────────────────────────────────
// Audio Renderer — FFmpeg filter-graph builder
//
// Pure function: takes a ProjectFile snapshot and output path, returns the
// ffmpeg argument array. No I/O, no side effects — unit-testable.
//
// Filter graph shape (see spec §6):
//   Step 1: Per track, collect non-muted clips sorted by outputStart.
//           Skip tracks where all clips are muted.
//   Step 2: Per clip: [SRC:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[segI]
//   Step 3: Per active track: [segA][segB]...concat=n=K:v=0:a=1[trackT]
//   Step 4: [track0][track1]...amix=inputs=T:normalize=0[out]
//           (if T=1, skip amix and use [track0] directly)
//
// Note: clip.gain is intentionally ignored (deferred to Phase 4).
// ─────────────────────────────────────────────────────────────────────────────

import type { ProjectFile } from '@shared/project.types'

// NOTE: No import of `binaries.ts` here — this module is a pure function so it
// can be unit-tested in the Vitest node environment without Homebrew being present.
// The ffmpeg binary path is resolved in render.ipc.ts (the call site), not here.

/** Build the ffmpeg CLI argument array for an export render. Pure function. */
export function buildRenderArgs(project: ProjectFile, outputPath: string): string[] {
  const { sourceFiles, tracks } = project

  // Map sourceFile.id → FFmpeg input index (0-based, in insertion order)
  const sfIndexMap = new Map<string, number>()
  const inputArgs: string[] = []
  for (const sf of sourceFiles) {
    sfIndexMap.set(sf.id, sfIndexMap.size)
    inputArgs.push('-i', sf.filePath)
  }

  // Collect active tracks (tracks with at least one non-muted clip)
  type ActiveTrack = { trackIdx: number; clips: typeof tracks[0]['clips'] }
  const activeTrackClips: ActiveTrack[] = []
  for (let i = 0; i < tracks.length; i++) {
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
    const { clips } = activeTrackClips[ti]
    const segLabels: string[] = []

    for (const clip of clips) {
      const srcIdx = sfIndexMap.get(clip.sourceFileId)
      if (srcIdx === undefined) throw new Error(`Unknown sourceFileId: ${clip.sourceFileId}`)
      const label = `seg${segIndex++}`
      parts.push(
        `[${srcIdx}:a]atrim=start=${clip.sourceStart}:end=${clip.sourceEnd},asetpts=PTS-STARTPTS[${label}]`
      )
      segLabels.push(`[${label}]`)
    }

    const trackLabel = `track${ti}`
    if (clips.length === 1) {
      // Single clip — rename label directly via anull
      parts.push(`${segLabels[0]}anull[${trackLabel}]`)
    } else {
      parts.push(`${segLabels.join('')}concat=n=${clips.length}:v=0:a=1[${trackLabel}]`)
    }
    trackLabels.push(`[${trackLabel}]`)
  }

  let outLabel: string
  if (trackLabels.length === 1) {
    // Single active track — use its label directly; no amix needed
    outLabel = trackLabels[0]
  } else {
    parts.push(
      `${trackLabels.join('')}amix=inputs=${trackLabels.length}:normalize=0[out]`
    )
    outLabel = '[out]'
  }

  const filterComplex = parts.join(';')

  // Determine format-specific encoding args
  const fmt = project.export?.format ?? 'mp3'
  const encodeArgs = formatToEncodeArgs(fmt)

  return [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', outLabel,
    ...encodeArgs,
    outputPath,
  ]
}

function formatToEncodeArgs(format: string): string[] {
  switch (format) {
    case 'wav':  return ['-c:a', 'pcm_s16le']
    case 'aac':  return ['-c:a', 'aac', '-b:a', '192k']
    case 'mp3':
    default:     return ['-c:a', 'libmp3lame', '-q:a', '2']
  }
}
