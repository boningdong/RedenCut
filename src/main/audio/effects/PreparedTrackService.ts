import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { AudioRenderPlan } from '../../../shared/audio/AudioRenderPlan'
import type { AudioSource, AudioSourceId } from '../../../shared/ProjectTypes'
import type { AudioSampleChunk, PlaybackMode } from '../../../shared/PlayerTypes'
import {
  MAX_PREPARED_READ_FRAMES,
  type PreparedTrackDescriptor,
  type PreparedAudioProgress,
} from '../../../shared/PreparedAudioTypes'
import { compileFfmpegPlan } from '../export/FfmpegPlanCompiler'
import { getFfmpegPath } from '../../runtime/AppRuntimeLocator'
import { PreparedWaveform } from './PreparedWaveform'
import { preparePcmStream } from './PreparedPcmStream'
import { runtimeEnvironment } from '../../runtime/RuntimeEnvironment'

export function preparedTrackKey(
  plan: AudioRenderPlan,
  mode: PlaybackMode,
  identities: unknown[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        algorithm: 2,
        mode,
        durationFrames: plan.durationFrames,
        identities,
        tracks: plan.tracks.map((track) => ({
          trackId: track.trackId,
          contributions: track.contributions,
          normalize: track.normalize,
        })),
      }),
    )
    .digest('hex')
}

export function validatePreparedRead(start: number, count: number, total: number): void {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_PREPARED_READ_FRAMES ||
    start + count > total
  )
    throw new Error('Invalid prepared PCM range')
}

/** One session lease owns its disk artifacts and child processes. No renderer paths enter here. */
export class PreparedTrackService {
  private directory = mkdtemp(join(tmpdir(), 'redencut-effects-'))
  private entries = new Map<string, Promise<PreparedTrackDescriptor>>()
  private slots = new Map<
    string,
    { key: string; controller: AbortController; result: Promise<PreparedTrackDescriptor> }
  >()
  private files = new Map<
    string,
    {
      path: string
      channels: number
      frameCount: number
      signal: AbortSignal
      waveform: PreparedWaveform
    }
  >()
  private controller = new AbortController()

  async prepare(
    plan: AudioRenderPlan,
    mode: PlaybackMode,
    sources: AudioSource[],
    resolveOriginal: (id: AudioSourceId) => Promise<string>,
    onProgress?: (progress: PreparedAudioProgress) => void,
  ): Promise<PreparedTrackDescriptor> {
    this.controller.signal.throwIfAborted()
    const used = new Set(
      plan.tracks.flatMap((track) => track.contributions.map((c) => c.source.audioSourceId)),
    )
    const inputs = sources.filter((source) => used.has(source.id))
    if (inputs.length !== used.size) throw new Error('Unknown normalization source')
    const key = preparedTrackKey(
      plan,
      mode,
      inputs.map((source) => [source.id, source.fingerprint, source.metadata.channels]),
    )
    let entry = this.entries.get(key)
    if (!entry) {
      const trackId = JSON.stringify([plan.tracks[0].trackId, mode])
      const previous = this.slots.get(trackId)
      previous?.controller.abort()
      const controller = new AbortController()
      const signal = AbortSignal.any([this.controller.signal, controller.signal])
      entry = (async () => {
        if (previous) {
          this.entries.delete(previous.key)
          const descriptor = await previous.result.catch(() => null)
          if (descriptor) {
            const file = this.files.get(descriptor.handle)
            this.files.delete(descriptor.handle)
            if (file) {
              await rm(file.path, { force: true })
            }
          }
        }
        signal.throwIfAborted()
        return this.render(plan, inputs, resolveOriginal, signal, onProgress)
      })()
      this.slots.set(trackId, { key, controller, result: entry })
      this.entries.set(key, entry)
      void entry.catch(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key)
      })
    }
    return entry
  }

  async read(handle: string, startFrame: number, frameCount: number): Promise<AudioSampleChunk> {
    this.controller.signal.throwIfAborted()
    const file = this.files.get(handle)
    if (!file) throw new Error('Unknown prepared audio handle')
    validatePreparedRead(startFrame, frameCount, file.frameCount)
    const bytes = Buffer.alloc(frameCount * file.channels * 4)
    const input = await open(file.path, 'r')
    try {
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await input.read(
          bytes,
          offset,
          bytes.length - offset,
          startFrame * file.channels * 4 + offset,
        )
        if (!bytesRead) throw new Error('Prepared PCM ended unexpectedly')
        offset += bytesRead
      }
    } finally {
      await input.close()
    }
    this.controller.signal.throwIfAborted()
    if (this.files.get(handle) !== file) throw new Error('Unknown prepared audio handle')
    const channels = Array.from({ length: file.channels }, (_, channel) => {
      const samples = new Float32Array(frameCount)
      for (let frame = 0; frame < frameCount; frame++)
        samples[frame] = bytes.readFloatLE((frame * file.channels + channel) * 4)
      return samples
    })
    return { startFrame, frameCount, channels }
  }

  async waveform(handle: string, startFrame: number, endFrame: number, targetBuckets: number) {
    this.controller.signal.throwIfAborted()
    const file = this.files.get(handle)
    if (!file) throw new Error('Unknown prepared audio handle')
    PreparedWaveform.validate(startFrame, endFrame, targetBuckets, file.frameCount)
    const waveform = file.waveform
    file.signal.throwIfAborted()
    if (this.files.get(handle) !== file) throw new Error('Unknown prepared audio handle')
    const result = await waveform.read(startFrame, endFrame, targetBuckets)
    file.signal.throwIfAborted()
    if (this.files.get(handle) !== file) throw new Error('Unknown prepared audio handle')
    return result
  }

  preparedPath(handle: string): string {
    this.controller.signal.throwIfAborted()
    const file = this.files.get(handle)
    if (!file) throw new Error('Unknown prepared audio handle')
    file.signal.throwIfAborted()
    return file.path
  }

  async dispose(): Promise<void> {
    this.controller.abort()
    await Promise.allSettled(this.entries.values())
    this.entries.clear()
    this.slots.clear()
    this.files.clear()
    await rm(await this.directory, { recursive: true, force: true })
  }

  private async render(
    plan: AudioRenderPlan,
    sources: AudioSource[],
    resolveOriginal: (id: AudioSourceId) => Promise<string>,
    signal: AbortSignal,
    onProgress?: (progress: PreparedAudioProgress) => void,
  ): Promise<PreparedTrackDescriptor> {
    const inputs: string[] = []
    for (const source of sources) {
      inputs.push('-i', await resolveOriginal(source.id))
      signal.throwIfAborted()
    }
    const handle = randomUUID()
    const path = join(await this.directory, `${handle}.f32`)
    const channels = Math.max(1, ...sources.map((source) => source.metadata.channels))
    const processingPlan = {
      ...plan,
      tracks: plan.tracks.map((track) => ({ ...track, gainDb: 0, volume: 1 })),
    }
    const graph = compileFfmpegPlan(
      processingPlan,
      new Map(sources.map((source, index) => [source.id, index])),
      new Map(sources.map((source) => [source.id, source.metadata.channels])),
    )
    signal.throwIfAborted()
    const child = spawn(
      getFfmpegPath(),
      [
        '-v',
        'error',
        '-y',
        ...inputs,
        '-filter_complex',
        graph,
        '-map',
        '[export]',
        '-ac',
        String(channels),
        '-ar',
        '48000',
        '-f',
        'f32le',
        '-c:a',
        'pcm_f32le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: runtimeEnvironment(process.env) },
    )
    let diagnostic = ''
    const abort = () => {
      child.kill('SIGKILL')
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + String(chunk)).slice(-4096)
    })
    const exited = new Promise<void>((resolve, reject) => {
      let failure: Error | undefined
      child.once('error', (error) => {
        failure = error
      })
      child.once('close', (code) => {
        if (signal.aborted) reject(new DOMException('Preparation cancelled', 'AbortError'))
        else if (failure || code !== 0)
          reject(failure ?? new Error(`Preparation failed: ${diagnostic}`))
        else resolve()
      })
    })
    // Observe early spawn failures while the stream pipeline is still unwinding.
    void exited.catch(() => {})
    if (signal.aborted) abort()
    try {
      const waveform = await preparePcmStream(
        child.stdout,
        path,
        channels,
        plan.durationFrames,
        plan.tracks.find((track) => track.normalize)?.normalize,
        signal,
        onProgress,
      )
      await exited
      signal.throwIfAborted()
      this.files.set(handle, { path, channels, frameCount: plan.durationFrames, signal, waveform })
      return { handle, channels, frameCount: plan.durationFrames }
    } catch (error) {
      abort()
      await exited.catch(() => {})
      await rm(path, { force: true })
      signal.throwIfAborted()
      if (diagnostic.trim()) throw new Error(`Preparation failed: ${diagnostic}`, { cause: error })
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
}
