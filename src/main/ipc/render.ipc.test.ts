import { EventEmitter } from 'events'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportJobId } from '../../shared/ipc.types'
import {
  AudioSourceSchema,
  createEmptyProject,
  type AudioSourceId,
} from '../../shared/project.types'
import type { WorkspaceToken } from '../../shared/session.types'
import { ExportCoordinator, type ExportChild } from '../audio/export/ExportCoordinator'
import { SessionJobRegistry } from '../project/SessionJobRegistry'

type IpcHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getFocusedWindow: vi.fn(() => ({})),
  },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler),
  },
}))

import { registerRenderIpc } from './render.ipc'
import type { WorkspaceController } from '../project/WorkspaceController'

const TOKEN = 'workspace-a' as WorkspaceToken
const SOURCE_ID = '00000000-0000-4000-8000-000000000001' as AudioSourceId
const roots: string[] = []

class FakeChild extends EventEmitter implements ExportChild {
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

function project() {
  const value = createEmptyProject('2026-01-01T00:00:00.000Z')
  value.audioSources = [
    AudioSourceSchema.parse({
      id: SOURCE_ID,
      displayName: 'voice.wav',
      location: { mode: 'reference', path: '/outside/voice.wav' },
      fingerprint: { byteLength: 1, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
      metadata: {
        durationSeconds: 30,
        sampleRate: 48_000,
        channels: 2,
        codec: 'wav',
        bitrateKbps: 1536,
      },
    }),
  ]
  value.tracks = [
    {
      id: 'track-a',
      name: 'Voice',
      volume: 1,
      muted: false,
      solo: false,
      color: '#fff',
      effects: [],
      clips: [
        {
          id: 'clip-a',
          trackId: 'track-a',
          audioSourceId: SOURCE_ID,
          sourceStart: 0,
          sourceEnd: 30,
          outputStart: 0,
          gain: 1,
          muted: false,
          effects: [],
        },
      ],
    },
  ]
  return value
}

function request(jobId = 'export-a', revision = 7) {
  const authoritative = project()
  return {
    jobId: jobId as ExportJobId,
    workspaceToken: TOKEN,
    revision,
    draft: {
      tracks: authoritative.tracks,
      export: authoritative.export,
    },
    format: 'mp3' as const,
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function sender(id = 1) {
  const destroyed = new Set<() => void>()
  let isDestroyed = false
  return {
    id,
    isDestroyed: vi.fn(() => isDestroyed),
    send: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.add(listener)
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.delete(listener)
    }),
    destroy: () => {
      isDestroyed = true
      const listeners = [...destroyed]
      destroyed.clear()
      listeners.forEach((listener) => listener())
    },
    destroyedListenerCount: () => destroyed.size,
  }
}

function controllerStub() {
  let revision = 7
  const authoritative = project()
  const resolveOriginal = vi.fn(async () => '/main-only/voice.wav')
  return {
    workspace: { project: authoritative },
    setRevision(value: number) {
      revision = value
    },
    assertCurrent: vi.fn((expected: { workspaceToken: WorkspaceToken; revision: number }) => {
      if (expected.workspaceToken !== TOKEN) throw new Error('Stale workspace token')
      if (expected.revision !== revision) throw new Error('Stale workspace revision')
    }),
    captureOriginalResolver: vi.fn(() => resolveOriginal),
    resolveOriginal,
  }
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'riffcut-render-ipc-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

beforeEach(() => {
  mocks.handlers.clear()
  mocks.showSaveDialog.mockReset()
})

describe('render IPC', () => {
  it('admits the job before opening a dialog and settles dialog cancellation with its exact identity', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    const coordinator = new ExportCoordinator({ spawn: vi.fn(), createId: () => 'unique-a' })
    mocks.showSaveDialog.mockResolvedValue({ canceled: true })
    registerRenderIpc(controller as unknown as WorkspaceController, jobs, vi.fn(), coordinator)

    await expect(
      mocks.handlers.get('render:start-export')!({ sender: sender() }, request()),
    ).resolves.toEqual({
      ok: true,
      value: {
        jobId: 'export-a',
        workspaceToken: TOKEN,
        revision: 7,
        value: false,
      },
    })
    expect(controller.captureOriginalResolver).toHaveBeenCalledWith(request())
  })

  it('rejects a closing token and a stale session before dialog, resolver, or spawn side effects', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    const spawn = vi.fn()
    const coordinator = new ExportCoordinator({ spawn, createId: () => 'unique-a' })
    registerRenderIpc(controller as unknown as WorkspaceController, jobs, vi.fn(), coordinator)
    jobs.beginClosing(TOKEN)

    await expect(
      mocks.handlers.get('render:start-export')!({ sender: sender() }, request()),
    ).resolves.toMatchObject({ ok: false })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    expect(controller.captureOriginalResolver).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()

    jobs.reopen(TOKEN)
    controller.setRevision(8)
    await expect(
      mocks.handlers.get('render:start-export')!({ sender: sender() }, request()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'stale-session' } })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    expect(controller.captureOriginalResolver).not.toHaveBeenCalled()
  })

  it('forwards progress only while its exact starting session remains current', async () => {
    const root = await temporaryRoot()
    const controller = controllerStub()
    const child = new FakeChild()
    const coordinator = new ExportCoordinator({
      spawn: () => child,
      createId: () => 'unique-a',
    })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'episode.mp3') })
    registerRenderIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
      coordinator,
    )
    const ownedSender = sender()
    const exporting = mocks.handlers.get('render:start-export')!({ sender: ownedSender }, request())
    await vi.waitFor(() => expect(controller.resolveOriginal).toHaveBeenCalled())

    child.stderr.write('time=00:00:03.00\r')
    await vi.waitFor(() => expect(ownedSender.send).toHaveBeenCalledTimes(1))
    expect(ownedSender.send).toHaveBeenCalledWith('render:progress', {
      jobId: 'export-a',
      workspaceToken: TOKEN,
      revision: 7,
      percent: 0.1,
      currentSeconds: 3,
      totalSeconds: 30,
    })
    controller.setRevision(8)
    child.stderr.write('time=00:00:06.00\r')
    expect(ownedSender.send).toHaveBeenCalledTimes(1)

    child.emit('close', 1, null)
    await exporting
  })

  it('cancels by the exact admitted revision after current revision advances and awaits reaping', async () => {
    const root = await temporaryRoot()
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    const child = new FakeChild()
    const coordinator = new ExportCoordinator({
      spawn: () => child,
      createId: () => 'unique-a',
    })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'episode.mp3') })
    registerRenderIpc(controller as unknown as WorkspaceController, jobs, vi.fn(), coordinator)
    const event = { sender: sender() }
    const exporting = mocks.handlers.get('render:start-export')!(event, request())
    await vi.waitFor(() => expect(controller.resolveOriginal).toHaveBeenCalled())
    controller.setRevision(8)

    await expect(
      mocks.handlers.get('render:cancel-export')!(event, request('export-a', 8)),
    ).resolves.toEqual({ ok: true, value: 'not-found' })
    expect(child.kill).not.toHaveBeenCalled()
    const cancelling = mocks.handlers.get('render:cancel-export')!(event, request())
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
    let acknowledged = false
    void Promise.resolve(cancelling).then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)

    child.emit('close', null, 'SIGKILL')
    await expect(cancelling).resolves.toEqual({ ok: true, value: 'cancelled' })
    await expect(exporting).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('sender destruction cancels and settles its process and removes the listener', async () => {
    const root = await temporaryRoot()
    const controller = controllerStub()
    const child = new FakeChild()
    const coordinator = new ExportCoordinator({
      spawn: () => child,
      createId: () => 'unique-a',
    })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'episode.mp3') })
    registerRenderIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
      coordinator,
    )
    const ownedSender = sender()
    const exporting = mocks.handlers.get('render:start-export')!({ sender: ownedSender }, request())
    await vi.waitFor(() => expect(controller.resolveOriginal).toHaveBeenCalled())

    ownedSender.destroy()
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
    child.emit('close', null, 'SIGKILL')
    await exporting
    expect(ownedSender.destroyedListenerCount()).toBe(0)
    expect(ownedSender.removeListener).toHaveBeenCalledTimes(1)
  })

  it('session closing cancels and settles the exact token process', async () => {
    const root = await temporaryRoot()
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    const child = new FakeChild()
    const coordinator = new ExportCoordinator({
      spawn: () => child,
      createId: () => 'unique-a',
    })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(root, 'episode.mp3') })
    registerRenderIpc(controller as unknown as WorkspaceController, jobs, vi.fn(), coordinator)
    const exporting = mocks.handlers.get('render:start-export')!({ sender: sender() }, request())
    await vi.waitFor(() => expect(controller.resolveOriginal).toHaveBeenCalled())

    jobs.beginClosing(TOKEN)
    const settlement = jobs.cancelAndSettleToken(TOKEN)
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
    child.emit('close', null, 'SIGKILL')

    await expect(settlement).resolves.toBeUndefined()
    await expect(exporting).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('reports commit-won only after a cancellation racing with replacement settles backup cleanup', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    await writeFile(destination, 'original')
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    const child = new FakeChild()
    const backupCleanup = deferred<void>()
    const removeStarted = deferred<void>()
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        void writeFile(arguments_.at(-1)!, 'new-export').then(() => child.emit('close', 0, null))
        return child
      },
      createId: () => 'unique-a',
      remove: async () => {
        removeStarted.resolve()
        await backupCleanup.promise
      },
    })
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
    registerRenderIpc(controller as unknown as WorkspaceController, jobs, vi.fn(), coordinator)
    const event = { sender: sender() }
    const exporting = mocks.handlers.get('render:start-export')!(event, request())
    await removeStarted.promise
    expect(await readFile(destination, 'utf8')).toBe('new-export')

    const cancelling = mocks.handlers.get('render:cancel-export')!(event, request())
    let acknowledged = false
    void Promise.resolve(cancelling).then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()

    backupCleanup.resolve()
    await expect(cancelling).resolves.toEqual({ ok: true, value: 'commit-won' })
    await expect(exporting).resolves.toMatchObject({ ok: true, value: { value: true } })
  })
})
