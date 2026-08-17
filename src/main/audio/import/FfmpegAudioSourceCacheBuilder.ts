import { spawn } from 'child_process'
import { once } from 'events'
import type { EventEmitter } from 'events'
import { createWriteStream } from 'fs'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { Readable } from 'stream'
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

const MAX_DIAGNOSTIC_BYTES = 4096

interface FfmpegChild extends EventEmitter {
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals | number): boolean
}

interface CacheBuilderDependencies {
  spawn: (
    command: string,
    arguments_: string[],
    options: { stdio: ['ignore', 'pipe', 'pipe'] },
  ) => FfmpegChild
  createWriteStream: typeof createWriteStream
  remove?: typeof rm
}

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
  constructor(
    private readonly dependencies: CacheBuilderDependencies = {
      spawn: (command, arguments_, options) => spawn(command, arguments_, options) as FfmpegChild,
      createWriteStream,
      remove: rm,
    },
  ) {}

  async build(
    request: CacheBuildRequest,
    signal: AbortSignal,
    onProgress?: (progress: number) => void,
  ): Promise<AudioSourceCacheManifest> {
    if (signal.aborted) throw new DOMException('Cache build aborted', 'AbortError')
    const finalRoot = join(request.projectRoot, 'cache', request.audioSourceId)
    const stageRoot = join(request.stagingRoot, 'cache')
    const waveformRoot = join(stageRoot, 'waveform')
    await mkdir(waveformRoot, { recursive: true })

    let child: FfmpegChild | null = null
    let childClosed = false
    let killed = false
    let firstFailure: unknown = null
    let resolveChildClose!: (result: [number | null, NodeJS.Signals | null]) => void
    const childClose = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      resolveChildClose = resolve
    })
    const killOnce = () => {
      if (killed || childClosed || !child) return
      killed = true
      child.kill('SIGKILL')
    }
    const recordFailure = (error: unknown) => {
      if (firstFailure) return
      firstFailure = error
      killOnce()
    }
    const pcmPath = join(stageRoot, 'audio.f32le')
    const pcm = this.dependencies.createWriteStream(pcmPath)
    pcm.once('error', recordFailure)
    const waveformWriters = new Map(
      WAVEFORM_LEVELS.map((level) => [
        level,
        this.dependencies.createWriteStream(join(waveformRoot, `level-${level}.minmax-f32le`)),
      ]),
    )
    for (const writer of waveformWriters.values()) writer.once('error', recordFailure)
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

    let diagnosticTail: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    try {
      child = this.dependencies.spawn(
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
      child.once('error', recordFailure)
      child.stdout.once('error', recordFailure)
      child.stderr.once('error', recordFailure)
      child.stderr.on('data', (chunk: Buffer | string) => {
        diagnosticTail = appendDiagnosticTail(diagnosticTail, chunk)
      })
      child.once('close', (code: number | null, childSignal: NodeJS.Signals | null) => {
        childClosed = true
        resolveChildClose([code, childSignal])
      })
    } catch (error) {
      recordFailure(error)
      childClosed = true
      resolveChildClose([null, null])
    }
    const abort = () => recordFailure(new DOMException('Cache build aborted', 'AbortError'))
    if (signal.aborted) abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const heartbeat = setInterval(() => {
      const expected = request.metadata.durationSeconds * request.processingSampleRate
      onProgress?.(expected > 0 ? Math.min(0.99, accumulator.frameCount / expected) : 0)
    }, 200)
    let stagingCleanupAttempted = false

    try {
      if (!child) throw firstFailure
      for await (const value of child.stdout) {
        if (firstFailure) throw firstFailure
        const chunk = value as Buffer
        if (!pcm.write(chunk)) drains.add(pcm)
        accumulator.push(chunk)
        if (drains.size > 0) {
          await Promise.all([...drains].map((writer) => once(writer, 'drain')))
          drains.clear()
        }
      }
      const [code] = await childClose
      if (firstFailure) throw firstFailure
      if (code !== 0)
        throw new Error(
          `FFmpeg cache decode failed: ${decodeDiagnosticTail(diagnosticTail).trim()}`,
        )
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
      killOnce()
      await childClose
      const teardownResults = await Promise.allSettled([
        ...(child ? [destroyAndClose(child.stdout), destroyAndClose(child.stderr)] : []),
        destroyAndClose(pcm),
        ...[...waveformWriters.values()].map(destroyAndClose),
      ])
      const diagnostic = diagnosticTail.toString()
      const initiatingError = firstFailure ?? error
      let primaryError = initiatingError
      if (
        (initiatingError as NodeJS.ErrnoException).code === 'ENOSPC' ||
        diagnostic.includes('No space left')
      ) {
        primaryError = new Error(
          `Not enough disk space while caching ${basename(request.sourcePath)}`,
          {
            cause: initiatingError,
          },
        )
      }
      const cleanupErrors = teardownResults.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      stagingCleanupAttempted = true
      try {
        await (this.dependencies.remove ?? rm)(request.stagingRoot, {
          recursive: true,
          force: true,
        })
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length)
        throw new AggregateError([primaryError, ...cleanupErrors], 'Cache build cleanup failed', {
          cause: error,
        })
      throw primaryError
    } finally {
      clearInterval(heartbeat)
      signal.removeEventListener('abort', abort)
      if (!stagingCleanupAttempted)
        await (this.dependencies.remove ?? rm)(request.stagingRoot, {
          recursive: true,
          force: true,
        })
    }
  }
}

function appendDiagnosticTail(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer | string,
): Buffer<ArrayBufferLike> {
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  if (incoming.byteLength >= MAX_DIAGNOSTIC_BYTES)
    return incoming.subarray(incoming.byteLength - MAX_DIAGNOSTIC_BYTES)
  const excess = current.byteLength + incoming.byteLength - MAX_DIAGNOSTIC_BYTES
  return Buffer.concat([excess > 0 ? current.subarray(excess) : current, incoming])
}

function decodeDiagnosticTail(tail: Buffer<ArrayBufferLike>): string {
  const decoded = tail.toString('utf8')
  let byteLength = 0
  let start = decoded.length
  for (let index = decoded.length; index > 0;) {
    let next = index - 1
    const trailing = decoded.charCodeAt(next)
    if (trailing >= 0xdc00 && trailing <= 0xdfff && next > 0) {
      const leading = decoded.charCodeAt(next - 1)
      if (leading >= 0xd800 && leading <= 0xdbff) next -= 1
    }
    const characterBytes = Buffer.byteLength(decoded.slice(next, index), 'utf8')
    if (byteLength + characterBytes > MAX_DIAGNOSTIC_BYTES) break
    byteLength += characterBytes
    start = next
    index = next
  }
  return decoded.slice(start)
}

async function destroyAndClose(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream,
): Promise<void> {
  const target = stream as unknown as EventEmitter & {
    closed?: boolean
    destroyed?: boolean
    destroy: (error?: Error) => void
  }
  if (!target.destroyed) target.destroy()
  if (target.closed) return
  await once(target, 'close')
}
