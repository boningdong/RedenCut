import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { AudioRenderPlan } from '../../../shared/audio/AudioRenderPlan'
import type { AudioSource, AudioSourceId } from '../../../shared/ProjectTypes'
import type { AudioSampleChunk, PlaybackMode } from '../../../shared/PlayerTypes'
import {
  MAX_PREPARED_READ_FRAMES,
  type PreparedTrackDescriptor,
} from '../../../shared/PreparedAudioTypes'
import { compileFfmpegPlan } from '../export/FfmpegPlanCompiler'
import { getFfmpegPath } from '../../runtime/AppRuntimeLocator'
import { runtimeEnvironment } from '../../runtime/RuntimeEnvironment'

export function preparedTrackKey(
  plan: AudioRenderPlan,
  mode: PlaybackMode,
  identities: unknown[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        algorithm: 1,
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
  private files = new Map<string, { path: string; channels: number; frameCount: number }>()
  private controller = new AbortController()

  async prepare(
    plan: AudioRenderPlan,
    mode: PlaybackMode,
    sources: AudioSource[],
    resolveOriginal: (id: AudioSourceId) => Promise<string>,
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
      const trackId = plan.tracks[0].trackId
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
            if (file) await rm(file.path, { force: true })
          }
        }
        signal.throwIfAborted()
        return this.render(plan, inputs, resolveOriginal, signal)
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
    const channels = Array.from({ length: file.channels }, (_, channel) => {
      const samples = new Float32Array(frameCount)
      for (let frame = 0; frame < frameCount; frame++)
        samples[frame] = bytes.readFloatLE((frame * file.channels + channel) * 4)
      return samples
    })
    return { startFrame, frameCount, channels }
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
    try {
      await new Promise<void>((resolve, reject) => {
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
            path,
          ],
          { stdio: ['ignore', 'ignore', 'pipe'], env: runtimeEnvironment(process.env) },
        )
        let failure: Error | undefined
        let diagnostic = ''
        const abort = () => child.kill('SIGKILL')
        signal.addEventListener('abort', abort, { once: true })
        child.stderr.on('data', (chunk) => {
          diagnostic = (diagnostic + String(chunk)).slice(-4096)
        })
        child.once('error', (error) => {
          failure = error
        })
        child.once('close', (code) => {
          signal.removeEventListener('abort', abort)
          if (signal.aborted) reject(new DOMException('Normalization cancelled', 'AbortError'))
          else if (failure || code !== 0)
            reject(failure ?? new Error(`Normalization failed: ${diagnostic}`))
          else resolve()
        })
        if (signal.aborted) abort()
      })
      signal.throwIfAborted()
      const size = (await stat(path)).size
      if (size !== plan.durationFrames * channels * 4)
        throw new Error('Prepared PCM duration mismatch')
      this.files.set(handle, { path, channels, frameCount: plan.durationFrames })
      return { handle, channels, frameCount: plan.durationFrames }
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
  }
}
