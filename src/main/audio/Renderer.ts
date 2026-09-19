import type { ProjectFile } from '@shared/ProjectTypes'
import { buildAudioRenderPlan } from '@shared/audio/AudioRenderPlanBuilder'
import { compileFfmpegPlan } from './export/FfmpegPlanCompiler'

// Binary resolution belongs to ExportCoordinator; this module remains pure.

/** Build the ffmpeg CLI argument array for an export render. Pure function. */
export function buildRenderArgs(
  project: ProjectFile,
  sourcePaths: ReadonlyMap<string, string>,
  outputPath: string,
): string[] {
  const { audioSources, tracks } = project
  const plan = buildAudioRenderPlan(tracks, 'edited')
  if (plan.durationFrames <= 0) throw new Error('No retained timeline to export')

  // Map AudioSourceId → FFmpeg input index (0-based, in insertion order)
  const sfIndexMap = new Map<string, number>()
  const inputArgs: string[] = []
  for (const source of audioSources) {
    const sourcePath = sourcePaths.get(source.id)
    if (!sourcePath) throw new Error(`Missing resolved path for audio source: ${source.id}`)
    sfIndexMap.set(source.id, sfIndexMap.size)
    inputArgs.push('-i', sourcePath)
  }

  const filterComplex = compileFfmpegPlan(
    plan,
    sfIndexMap,
    new Map(audioSources.map((source) => [source.id, source.metadata.channels])),
  )

  // Determine format-specific encoding args
  const fmt = project.export?.format ?? 'mp3'
  const encodeArgs = formatToEncodeArgs(fmt)

  return [
    '-y',
    ...inputArgs,
    '-filter_complex',
    filterComplex,
    '-map',
    '[export]',
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
