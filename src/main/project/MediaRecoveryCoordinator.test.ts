import { EventEmitter } from 'events'
import { describe, it, expect, vi } from 'vitest'
import type { AudioSource } from '../../shared/ProjectTypes'
import type { MediaRecoverySnapshot } from '../../shared/MediaRecoveryTypes'
import { MediaRecoveryCoordinator } from './MediaRecoveryCoordinator'
const source = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  displayName: 'voice.wav',
  location: { mode: 'copy', path: 'media/550e8400-e29b-41d4-a716-446655440000/voice.wav' },
  fingerprint: { sha256: 'a'.repeat(64), byteLength: 10, modifiedTimeMs: 1 },
  metadata: { durationSeconds: 1, sampleRate: 48000, channels: 1, codec: 'pcm_s16le' },
} as AudioSource
function setup() {
  const emitter = new EventEmitter()
  const sender = Object.assign(emitter, { id: 1, isDestroyed: () => false, send: vi.fn() })
  const snapshots: MediaRecoverySnapshot[] = []
  const service = { findMissing: vi.fn(async () => [source]), restore: vi.fn(async () => {}) }
  const choose = vi.fn(async () => '/private/voice.wav')
  const coordinator = new MediaRecoveryCoordinator(service, choose, (_id, s) =>
    snapshots.push(structuredClone(s)),
  )
  return { sender, snapshots, service, choose, coordinator }
}
describe('MediaRecoveryCoordinator', () => {
  it('waits for explicit continue and binds commands to window and task', async () => {
    const h = setup()
    const done = h.coordinator.recover(h.sender, '/project', [source])
    await vi.waitFor(() => expect(h.snapshots.length).toBe(1))
    const id = h.snapshots[0].recoveryId
    expect(() => h.coordinator.continue(1, id)).toThrow()
    await expect(h.coordinator.locate(2, id, source.id)).rejects.toThrow()
    await h.coordinator.locate(1, id, source.id)
    expect(h.snapshots.at(-1)?.items[0].state.status).toBe('restored')
    h.coordinator.continue(1, id)
    await expect(done).resolves.toBe(true)
    expect(h.snapshots.at(-1)?.status).toBe('closed')
    expect(JSON.stringify(h.snapshots)).not.toContain('/private')
    expect(() => h.coordinator.continue(1, id)).toThrow()
  })
  it('cancels selection without losing missing state, and cancels open on window destruction', async () => {
    const h = setup()
    h.choose.mockResolvedValueOnce(null as unknown as string)
    const done = h.coordinator.recover(h.sender, '/project', [source])
    await vi.waitFor(() => expect(h.snapshots.length).toBe(1))
    await h.coordinator.locate(1, h.snapshots[0].recoveryId, source.id)
    expect(h.snapshots.at(-1)?.items[0].state.status).toBe('missing')
    h.sender.emit('destroyed')
    await expect(done).resolves.toBe(false)
  })
  it('does not require interaction when no copy media are missing', async () => {
    const h = setup()
    h.service.findMissing.mockResolvedValue([])
    await expect(h.coordinator.recover(h.sender, '/project', [])).resolves.toBe(true)
    expect(h.snapshots).toEqual([])
  })
})

it.each(['did-start-loading', 'render-process-gone'])(
  'cancels recovery on %s without retaining the open transaction',
  async (event) => {
    const h = setup()
    const done = h.coordinator.recover(h.sender, '/project', [source])
    await vi.waitFor(() => expect(h.snapshots.length).toBe(1))
    h.sender.emit(event)
    await expect(done).resolves.toBe(false)
  },
)
it('shutdown joins an already-running copy cancellation', async () => {
  const h = setup()
  let release!: () => void
  const cleanup = new Promise<void>((resolve) => {
    release = resolve
  })
  h.service.restore.mockImplementationOnce(() => cleanup)
  const done = h.coordinator.recover(h.sender, '/project', [source])
  await vi.waitFor(() => expect(h.snapshots.length).toBe(1))
  const id = h.snapshots[0].recoveryId
  const copying = h.coordinator.locate(1, id, source.id)
  await vi.waitFor(() => expect(h.service.restore).toHaveBeenCalled())
  const cancelling = h.coordinator.cancel(1, id)
  let shut = false
  const shutting = h.coordinator.shutdown().then(() => {
    shut = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(shut).toBe(false)
  release()
  await Promise.all([copying, cancelling, shutting])
  await expect(done).resolves.toBe(false)
})
it('does not create a recovery after shutdown during inspection', async () => {
  const h = setup()
  let release!: (sources: AudioSource[]) => void
  h.service.findMissing.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const opening = h.coordinator.recover(h.sender, '/project', [source])
  await h.coordinator.shutdown()
  release([source])
  await expect(opening).resolves.toBe(false)
  expect(h.snapshots).toEqual([])
})

it.each(['did-start-loading', 'render-process-gone'])(
  'does not begin recovery after %s during inspection',
  async (event) => {
    const h = setup()
    let release!: (sources: AudioSource[]) => void
    h.service.findMissing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const opening = h.coordinator.recover(h.sender, '/project', [source])
    h.sender.emit(event)
    release([source])
    await expect(opening).resolves.toBe(false)
    expect(h.snapshots).toEqual([])
  },
)
