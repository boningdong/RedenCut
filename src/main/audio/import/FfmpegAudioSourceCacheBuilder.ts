import { spawn } from 'child_process'
import { once } from 'events'
import { createWriteStream } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type {
  AudioSourceId,
  AudioMetadata,
  ProjectRelativePath,
} from '../../../shared/project.types'
import { getFfmpegPath } from '../binaries'
import {
  AudioSourceCacheManifestSchema,
  CACHE_GENERATOR_VERSION,
  WAVEFORM_LEVELS,
  type AudioSourceCacheManifest,
} from '../cache/cacheManifest'
import { PcmWaveformAccumulator } from './PcmWaveformAccumulator'

export interface CacheBuildRequest {
  projectRoot: string
  stagingRoot: string
  sourcePath: string
  audioSourceId: AudioSourceId
  sourceSha256: string
  metadata: AudioMetadata
  processingSampleRate: 48_000
}

export class FfmpegAudioSourceCacheBuilder {
  async build(
    request: CacheBuildRequest,
    signal: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<AudioSourceCacheManifest> {
    const finalRoot = join(request.projectRoot, 'cache', request.audioSourceId)
    const stageRoot = join(request.stagingRoot, 'cache')
    const waveformRoot = join(stageRoot, 'waveform')
    await mkdir(waveformRoot, { recursive: true })

    const pcmPath = join(stageRoot, 'audio.f32le')
    const pcm = createWriteStream(pcmPath)
    const waveformWriters = new Map(
      WAVEFORM_LEVELS.map((level) => [
        level,
        createWriteStream(join(waveformRoot, `level-${level}.minmax-f32le`)),
      ]),
    )
    const bucketCounts = new Map(WAVEFORM_LEVELS.map((level) => [level, 0]))
    const drains = new Set<NodeJS.WritableStream>()
    const accumulator = new PcmWaveformAccumulator(
      request.metadata.channels,
      WAVEFORM_LEVELS,
      (level, bucket) => {
        const writer = waveformWriters.get(level as (typeof WAVEFORM_LEVELS)[number])!
        if (!writer.write(bucket)) drains.add(writer)
        bucketCounts.set(
          level as (typeof WAVEFORM_LEVELS)[number],
          (bucketCounts.get(level as (typeof WAVEFORM_LEVELS)[number]) ?? 0) + 1,
        )
      },
    )

    const child = spawn(
      getFfmpegPath(),
      [
        '-v',
        'error',
        '-i',
        request.sourcePath,
        '-f',
        'f32le',
        '-acodec',
        'pcm_f32le',
        '-ar',
        String(request.processingSampleRate),
        '-ac',
        String(request.metadata.channels),
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const abort = () => child.kill('SIGKILL')
    signal.addEventListener('abort', abort, { once: true })
    const heartbeat = setInterval(() => {
      const expected = request.metadata.durationSeconds * request.processingSampleRate
      onProgress?.(expected > 0 ? Math.min(0.99, accumulator.frameCount / expected) : 0)
    }, 200)

    try {
      for await (const value of child.stdout) {
        if (signal.aborted) throw new DOMException('Cache build aborted', 'AbortError')
        const chunk = value as Buffer
        if (!pcm.write(chunk)) drains.add(pcm)
        accumulator.push(chunk)
        if (drains.size > 0) {
          await Promise.all([...drains].map((writer) => once(writer, 'drain')))
          drains.clear()
        }
      }
      const [code] = (await once(child, 'close')) as [number]
      if (signal.aborted) throw new DOMException('Cache build aborted', 'AbortError')
      if (code !== 0) throw new Error(`FFmpeg cache decode failed: ${stderr.trim()}`)
      accumulator.finish()
      pcm.end()
      for (const writer of waveformWriters.values()) writer.end()
      await Promise.all([
        once(pcm, 'close'),
        ...[...waveformWriters.values()].map((w) => once(w, 'close')),
      ])

      const base = `cache/${request.audioSourceId}`
      const manifest = AudioSourceCacheManifestSchema.parse({
        version: 1,
        audioSourceId: request.audioSourceId,
        sourceSha256: request.sourceSha256,
        generatorVersion: CACHE_GENERATOR_VERSION,
        pcm: {
          file: `${base}/audio.f32le` as ProjectRelativePath,
          sampleFormat: 'f32le',
          layout: 'interleaved',
          sampleRate: request.processingSampleRate,
          channels: request.metadata.channels,
          frameCount: accumulator.frameCount,
          byteLength: accumulator.frameCount * request.metadata.channels * 4,
        },
        waveform: {
          representation: 'min-max-f32le',
          levels: WAVEFORM_LEVELS.map((level) => ({
            file: `${base}/waveform/level-${level}.minmax-f32le` as ProjectRelativePath,
            samplesPerBucket: level,
            bucketCount: bucketCounts.get(level) ?? 0,
          })),
        },
      })
      await writeFile(join(stageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await mkdir(join(request.projectRoot, 'cache'), { recursive: true })
      await rm(finalRoot, { recursive: true, force: true })
      await rename(stageRoot, finalRoot)
      onProgress?.(1)
      return manifest
    } catch (error) {
      pcm.destroy()
      for (const writer of waveformWriters.values()) writer.destroy()
      await rm(request.stagingRoot, { recursive: true, force: true }).catch(() => {})
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC' || stderr.includes('No space left')) {
        throw new Error(`Not enough disk space while caching ${basename(request.sourcePath)}`, {
          cause: error,
        })
      }
      throw error
    } finally {
      clearInterval(heartbeat)
      signal.removeEventListener('abort', abort)
      await rm(request.stagingRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}
