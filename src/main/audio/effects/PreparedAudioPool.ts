import { createHash } from 'node:crypto'
import type { AudioRenderPlan } from '../../../shared/audio/AudioRenderPlan'
import type { AudioSource, AudioSourceId } from '../../../shared/ProjectTypes'
import type { PlaybackMode } from '../../../shared/PlayerTypes'
import type {
  PreparedAudioProgress,
  PreparedTrackDescriptor,
} from '../../../shared/PreparedAudioTypes'
import { PreparedTrackService } from './PreparedTrackService'

/** Only immutable sample composition belongs in this key, never UI IDs or playback gain. */
export function preparedAudioKey(plan: AudioRenderPlan, sources: AudioSource[]): string {
  const used = new Set(
    plan.tracks.flatMap((t) => t.contributions.map((c) => c.source.audioSourceId)),
  )
  const inputs = sources.filter((s) => used.has(s.id)).sort((a, b) => a.id.localeCompare(b.id))
  if (inputs.length !== used.size) throw new Error('Unknown preparation source')
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        sampleRate: plan.sampleRate,
        durationFrames: plan.durationFrames,
        sources: inputs.map((s) => [s.id, s.fingerprint, s.metadata.channels]),
        tracks: plan.tracks.map((t) => ({
          normalize: t.normalize,
          contributions: t.contributions.map(({ source, outputStartFrame, gain, envelope }) => ({
            source,
            outputStartFrame,
            gain,
            envelope,
          })),
        })),
      }),
    )
    .digest('hex')
}

interface Entry {
  key: string
  service: PreparedTrackService
  result: Promise<PreparedTrackDescriptor>
  descriptor?: PreparedTrackDescriptor
  progress: PreparedAudioProgress
  consumers: number
  lastUsed: number
  retired: boolean
  disposal?: Promise<void>
}

export class PreparedAudioPool {
  private entries = new Map<string, Entry>()
  private retiring = new Set<Promise<void>>()
  private closed = false
  private clock = 0
  private disposal?: Promise<void>

  constructor(
    private readonly createService = () => new PreparedTrackService(),
    private readonly maxIdleEntries = 2,
    private readonly maxIdleBytes = 2 * 1024 ** 3,
  ) {}

  acquire(
    plan: AudioRenderPlan,
    mode: PlaybackMode,
    sources: AudioSource[],
    resolveOriginal: (id: AudioSourceId) => Promise<string>,
  ) {
    if (this.closed) throw new Error('Prepared audio pool is closed')
    const key = preparedAudioKey(plan, sources)
    let entry = this.entries.get(key)
    if (!entry) {
      const service = this.createService()
      entry = {
        key,
        service,
        result: undefined!,
        progress: { phase: 'processing', completed: 0, total: plan.durationFrames },
        consumers: 0,
        lastUsed: ++this.clock,
        retired: false,
      }
      this.entries.set(key, entry)
      const created = entry
      try {
        created.result = service.prepare(plan, mode, sources, resolveOriginal, (progress) => {
          created.progress = { ...progress }
        })
      } catch (error) {
        created.result = Promise.reject(error)
      }
      void created.result.then(
        (descriptor) => {
          created.descriptor = descriptor
          created.progress = {
            phase: 'waveform',
            completed: descriptor.frameCount,
            total: descriptor.frameCount,
          }
        },
        () => {
          void this.retire(created).catch(console.error)
        },
      )
    }
    const owned = entry
    owned.consumers++
    let released = false
    const assertActive = (handle?: string) => {
      if (released || owned.retired || this.closed)
        throw new DOMException('Preparation lease released', 'AbortError')
      if (handle !== undefined && owned.descriptor?.handle !== handle)
        throw new Error('Unknown prepared audio handle')
    }
    const result = owned.result.then((descriptor) => {
      assertActive()
      return descriptor
    })
    void result.catch(() => {})
    return {
      key,
      result,
      progress: () => {
        assertActive()
        return { ...owned.progress }
      },
      read: (handle: string, startFrame: number, frameCount: number) => {
        assertActive(handle)
        return owned.service.read(handle, startFrame, frameCount)
      },
      waveform: (handle: string, startFrame: number, endFrame: number, targetBuckets: number) => {
        assertActive(handle)
        return owned.service.waveform(handle, startFrame, endFrame, targetBuckets)
      },
      release: async () => {
        if (released) return
        released = true
        owned.consumers--
        owned.lastUsed = ++this.clock
        if (!owned.consumers && !owned.descriptor) await this.retire(owned)
        else await this.evict()
      },
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.closed = true
    this.disposal = (async () => {
      const pending = [...this.entries.values()].map((entry) => this.retire(entry))
      const results = await Promise.allSettled([...pending, ...this.retiring])
      const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      if (errors.length) throw new AggregateError(errors, 'Prepared audio disposal failed')
    })()
    return this.disposal
  }

  private retire(entry: Entry): Promise<void> {
    if (entry.disposal) return entry.disposal
    entry.retired = true
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    const disposal = Promise.resolve().then(() => entry.service.dispose())
    entry.disposal = disposal
    this.retiring.add(disposal)
    void disposal.then(
      () => this.retiring.delete(disposal),
      () => this.retiring.delete(disposal),
    )
    return disposal
  }

  private async evict(): Promise<void> {
    const idle = [...this.entries.values()]
      .filter((e) => !e.consumers && e.descriptor)
      .sort((a, b) => a.lastUsed - b.lastUsed)
    // Reserve the full bounded waveform pyramid as well as the disk PCM.
    const size = (entry: Entry) =>
      entry.descriptor!.frameCount * entry.descriptor!.channels * 4 + 1024 ** 2
    let bytes = idle.reduce((sum, entry) => sum + size(entry), 0)
    const pending: Promise<void>[] = []
    while (idle.length > this.maxIdleEntries || bytes > this.maxIdleBytes) {
      const oldest = idle.shift()!
      bytes -= size(oldest)
      pending.push(this.retire(oldest))
    }
    await Promise.all(pending)
  }
}
export type PreparedAudioLease = ReturnType<PreparedAudioPool['acquire']>
