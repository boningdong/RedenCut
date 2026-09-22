import type { ProjectFile } from '../../../shared/ProjectTypes'
import { buildAudioRenderPlan } from '../../../shared/audio/AudioRenderPlanBuilder'
import { PreparedTrackService } from '../effects/PreparedTrackService'
import { formatToEncodeArgs } from '../Renderer'

/** Export the same leveled PCM as preview, with post-effect levels applied exactly once. */
export async function prepareAutoLevelExport(
  project: ProjectFile,
  sourcePaths: ReadonlyMap<string, string>,
  signal: AbortSignal,
): Promise<{ args(outputPath: string): string[]; dispose(): Promise<void> }> {
  signal.throwIfAborted()
  const plan = buildAudioRenderPlan(project.tracks, 'edited')
  if (plan.durationFrames <= 0) throw new Error('No retained timeline to export')
  const service = new PreparedTrackService()
  let cleanup: Promise<void> | undefined
  const dispose = () => {
    signal.removeEventListener('abort', abort)
    return (cleanup ??= service.dispose())
  }
  const abort = () => {
    void dispose().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const inputs: string[] = []
    const tracks: { channels: number; gain: number }[] = []
    for (const track of plan.tracks) {
      signal.throwIfAborted()
      const descriptor = await service.prepare(
        { ...plan, tracks: [track] },
        'edited',
        project.audioSources,
        async (id) => {
          const path = sourcePaths.get(id)
          if (!path) throw new Error(`Missing resolved path for audio source: ${id}`)
          return path
        },
      )
      inputs.push(
        '-f',
        'f32le',
        '-ar',
        '48000',
        '-ac',
        String(descriptor.channels),
        '-i',
        service.preparedPath(descriptor.handle),
      )
      tracks.push({
        channels: descriptor.channels,
        gain: track.volume * 10 ** ((track.gainDb ?? 0) / 20),
      })
    }
    signal.throwIfAborted()
    const stereo = tracks.some((track) => track.channels >= 2)
    const graph = tracks.map(
      (track, i) =>
        `[${i}:a]${stereo && track.channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : ''}volume=${track.gain}[t${i}]`,
    )
    if (tracks.length) {
      graph.push(
        `${tracks.map((_, i) => `[t${i}]`).join('')}${tracks.length > 1 ? `amix=inputs=${tracks.length}:normalize=0:duration=longest,` : ''}apad=whole_len=${plan.durationFrames},atrim=end_sample=${plan.durationFrames}[export]`,
      )
    } else {
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=end_sample=${plan.durationFrames}[export]`)
    }
    return {
      args: (outputPath) => [
        '-y',
        ...inputs,
        '-filter_complex',
        graph.join(';'),
        '-map',
        '[export]',
        ...formatToEncodeArgs(project.export?.format ?? 'mp3'),
        outputPath,
      ],
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
