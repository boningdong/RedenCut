import { describe, expect, it, vi } from 'vitest'
import type { AudioRenderPlan } from '../../../shared/audio/AudioRenderPlan'
import type { AudioSource } from '../../../shared/ProjectTypes'
import type {
  PreparedAudioProgress,
  PreparedTrackDescriptor,
} from '../../../shared/PreparedAudioTypes'
import { PreparedAudioPool, preparedAudioKey } from './PreparedAudioPool'
import type { PreparedTrackService } from './PreparedTrackService'

const source = {
  id: 'source',
  fingerprint: { sha256: 'abc', byteLength: 10, modifiedTimeMs: 0 },
  metadata: { channels: 1 },
} as AudioSource
const plan = {
  sampleRate: 48000,
  durationFrames: 48000,
  tracks: [
    {
      trackId: 'track',
      volume: 1,
      contributions: [
        {
          clipId: 'clip',
          source: { audioSourceId: source.id, sourceStartFrame: 0, frameCount: 48000 },
          outputStartFrame: 0,
          gain: 1,
          envelope: { kind: 'constant' },
        },
      ],
    },
  ],
  timeMap: {},
  resolutions: [],
} as unknown as AudioRenderPlan
const descriptor = { handle: 'handle', channels: 1, frameCount: 48000 }
function setup(maxIdleEntries = 2, maxIdleBytes = 2 * 1024 ** 3) {
  const instances: ReturnType<typeof create>[] = []
  function create() {
    let finish!: (value: PreparedTrackDescriptor) => void
    let fail!: (error: Error) => void
    let progress!: (progress: PreparedAudioProgress) => void
    const pending = new Promise<PreparedTrackDescriptor>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    const service = {
      prepare: vi.fn((_plan, _mode, _sources, _resolve, onProgress) => {
        progress = onProgress
        return pending
      }),
      read: vi.fn().mockResolvedValue({}),
      waveform: vi.fn().mockResolvedValue({}),
      dispose: vi.fn().mockResolvedValue(undefined),
    }
    return { service, finish, fail, progress: (value: PreparedAudioProgress) => progress(value) }
  }
  const pool = new PreparedAudioPool(
    () => {
      const instance = create()
      instances.push(instance)
      return instance.service as unknown as PreparedTrackService
    },
    maxIdleEntries,
    maxIdleBytes,
  )
  const acquire = (value = plan, mode: 'timeline' | 'edited' = 'timeline') =>
    pool.acquire(value, mode, [source], vi.fn())
  return { pool, instances, acquire }
}
function shifted(frame: number): AudioRenderPlan {
  const copy = structuredClone(plan)
  copy.tracks[0].contributions[0].source.sourceStartFrame = frame
  return copy
}

describe('shared prepared audio jobs', () => {
  it('shares simultaneous requests and identical samples across mode labels, with independent leases', async () => {
    const f = setup()
    const a = f.acquire()
    const b = f.acquire(plan, 'edited')
    expect(f.instances).toHaveLength(1)
    f.instances[0].progress({ phase: 'processing', completed: 50, total: 100 })
    expect(b.progress()).toEqual({ phase: 'processing', completed: 50, total: 100 })
    await a.release()
    expect(f.instances[0].service.dispose).not.toHaveBeenCalled()
    f.instances[0].finish(descriptor)
    await expect(a.result).rejects.toMatchObject({ name: 'AbortError' })
    await expect(b.result).resolves.toEqual(descriptor)
    expect(() => b.read('other-handle', 0, 10)).toThrow('Unknown prepared audio handle')
    await b.read('handle', 0, 10)
    await b.release()
    const reused = f.acquire()
    await reused.result
    expect(f.instances).toHaveLength(1)
    await f.pool.dispose()
    expect(f.instances[0].service.dispose).toHaveBeenCalledTimes(1)
  })

  it('cancels the last pending lease, allows immediate reentry, and rejects late completion', async () => {
    const f = setup()
    const a = f.acquire()
    const release = a.release()
    const b = f.acquire()
    expect(f.instances).toHaveLength(2)
    f.instances[0].finish(descriptor)
    f.instances[1].finish({ ...descriptor, handle: 'new' })
    await release
    await expect(a.result).rejects.toMatchObject({ name: 'AbortError' })
    await expect(b.result).resolves.toMatchObject({ handle: 'new' })
    expect(f.instances[0].service.dispose).toHaveBeenCalledTimes(1)
    expect(f.instances[1].service.dispose).not.toHaveBeenCalled()
    await f.pool.dispose()
  })

  it('ignores display IDs and track gain but separates differing composition and routing', async () => {
    const f = setup()
    const a = f.acquire()
    const renamed = structuredClone(plan)
    renamed.tracks[0].trackId = 'another-track'
    renamed.tracks[0].contributions[0].clipId = 'another-clip'
    renamed.tracks[0].volume = 0.1
    renamed.tracks[0].gainDb = 12
    f.acquire(renamed)
    expect(f.instances).toHaveLength(1)
    f.acquire(shifted(1), 'edited')
    const routed = structuredClone(plan)
    routed.tracks.push({ ...routed.tracks[0], contributions: [] })
    f.acquire(routed)
    const normalized = structuredClone(plan)
    normalized.tracks[0].normalize = { targetLufs: -16, truePeakDbtp: -1.5, loudnessRange: 7 }
    f.acquire(normalized)
    expect(f.instances).toHaveLength(4)
    expect(preparedAudioKey(plan, [source])).not.toBe(
      preparedAudioKey(plan, [{ ...source, metadata: { ...source.metadata, channels: 2 } }]),
    )
    expect(preparedAudioKey(plan, [source])).not.toBe(
      preparedAudioKey(plan, [
        { ...source, fingerprint: { ...source.fingerprint, sha256: 'def' } },
      ]),
    )
    for (const instance of f.instances) instance.finish(descriptor)
    await a.result
    await f.pool.dispose()
  })

  it('evicts least recently used idle entries without evicting active jobs', async () => {
    const f = setup(1)
    const active = f.acquire(shifted(1))
    const b = f.acquire(shifted(2))
    const c = f.acquire(shifted(3))
    for (const instance of f.instances) instance.finish(descriptor)
    await Promise.all([active.result, b.result, c.result])
    await b.release()
    await c.release()
    expect(f.instances[0].service.dispose).not.toHaveBeenCalled()
    expect(f.instances[1].service.dispose).toHaveBeenCalledTimes(1)
    expect(f.instances[2].service.dispose).not.toHaveBeenCalled()
    const reused = f.acquire(shifted(3))
    await reused.result
    expect(f.instances).toHaveLength(3)
    await f.pool.dispose()
  })

  it('enforces idle byte bounds and closes idle and pending jobs once', async () => {
    const f = setup(2, 1)
    const a = f.acquire()
    f.instances[0].finish(descriptor)
    await a.result
    await a.release()
    expect(f.instances[0].service.dispose).toHaveBeenCalledTimes(1)
    const pending = f.acquire(shifted(1))
    await Promise.all([f.pool.dispose(), f.pool.dispose()])
    f.instances[1].finish(descriptor)
    await expect(pending.result).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.instances[1].service.dispose).toHaveBeenCalledTimes(1)
    expect(() => f.acquire()).toThrow('closed')
  })

  it('retires rejected jobs and permits retry without unhandled rejection', async () => {
    const f = setup()
    const a = f.acquire()
    f.instances[0].fail(new Error('render failed'))
    await expect(a.result).rejects.toThrow('render failed')
    const b = f.acquire()
    expect(f.instances).toHaveLength(2)
    f.instances[1].finish(descriptor)
    await b.result
    await f.pool.dispose()
  })
})
