import { EventEmitter } from 'events'
import { access, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExportJobId } from '../../../shared/ipc.types'
import {
  AudioSourceSchema,
  createEmptyProject,
  type AudioSourceId,
  type ProjectFile,
} from '../../../shared/project.types'
import type { WorkspaceToken } from '../../../shared/session.types'
import { ExportCoordinator, type ExportChild } from './ExportCoordinator'

const TOKEN = 'workspace-a' as WorkspaceToken
const SOURCE_ID = '00000000-0000-4000-8000-000000000001' as AudioSourceId
const roots: string[] = []

function project(): ProjectFile {
  const value = createEmptyProject('2026-01-01T00:00:00.000Z')
  value.audioSources = [
    AudioSourceSchema.parse({
      id: SOURCE_ID,
      displayName: 'voice.mp3',
      location: { mode: 'reference', path: '/outside/voice.mp3' },
      fingerprint: { byteLength: 10, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
      metadata: {
        durationSeconds: 30,
        sampleRate: 48_000,
        channels: 2,
        codec: 'mp3',
        bitrateKbps: 192,
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

function identity(jobId = 'export-a', senderId = 1) {
  return {
    jobId: jobId as ExportJobId,
    workspaceToken: TOKEN,
    revision: 7,
    senderId,
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

class FakeChild extends EventEmitter implements ExportChild {
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'podcut-export-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ExportCoordinator', () => {
  it('settles a cancelled destination dialog without resolving sources or spawning FFmpeg', async () => {
    const spawn = vi.fn()
    const resolveOriginal = vi.fn(async () => '/outside/voice.mp3')
    const coordinator = new ExportCoordinator({ spawn, createId: () => 'unique-a' })

    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: vi.fn(async () => null),
      resolveOriginal,
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).resolves.toEqual({
      jobId: 'export-a',
      workspaceToken: TOKEN,
      revision: 7,
      value: false,
    })
    expect(resolveOriginal).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('renders to a unique sibling and atomically publishes it without passing the final path to FFmpeg', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    const child = new FakeChild()
    const spawn = vi.fn((_command: string, arguments_: string[]) => {
      const temporaryOutput = arguments_.at(-1)!
      void writeFile(temporaryOutput, 'new-export').then(() => child.emit('close', 0, null))
      return child
    })
    const coordinator = new ExportCoordinator({
      spawn,
      createId: () => 'unique-a',
      ffmpegPath: () => '/tools/ffmpeg',
    })

    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).resolves.toMatchObject({ value: true })
    const arguments_ = spawn.mock.calls[0][1]
    expect(arguments_).not.toContain(destination)
    expect(arguments_.at(-1)).toBe(join(root, '.episode.podcut-export-unique-a.mp3'))
    expect(await readFile(destination, 'utf8')).toBe('new-export')
  })

  it('rejects a duplicate sender before its dialog or process side effects', async () => {
    const firstDialog = deferred<string | null>()
    const coordinator = new ExportCoordinator({ spawn: vi.fn(), createId: () => 'unique-a' })
    const first = coordinator.start({
      identity: identity('export-a'),
      project: project(),
      selectDestination: () => firstDialog.promise,
      resolveOriginal: vi.fn(),
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })
    const secondDialog = vi.fn(async () => null)

    expect(() =>
      coordinator.start({
        identity: identity('export-b'),
        project: project(),
        selectDestination: secondDialog,
        resolveOriginal: vi.fn(),
        revalidate: vi.fn(),
        onProgress: vi.fn(),
      }),
    ).toThrow('Another export is already active')
    expect(secondDialog).not.toHaveBeenCalled()

    firstDialog.resolve(null)
    await first.settled
  })

  it('tags bounded FFmpeg progress with the exact admitted identity', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    const child = new FakeChild()
    const progress = vi.fn()
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        const temporaryOutput = arguments_.at(-1)!
        queueMicrotask(() => {
          child.stderr.write(`ignored=${'x'.repeat(600)} time=00:00:15.00\r`)
          void writeFile(temporaryOutput, 'audio').then(() => child.emit('close', 0, null))
        })
        return child
      },
      createId: () => 'unique-a',
    })

    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: progress,
    })

    await execution.settled
    expect(progress).toHaveBeenCalledWith({
      jobId: 'export-a',
      workspaceToken: TOKEN,
      revision: 7,
      percent: 0.5,
      currentSeconds: 15,
      totalSeconds: 30,
    })
  })

  it('cancellation kills once, waits for close, removes its partial output, and preserves the destination', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    await writeFile(destination, 'original')
    const child = new FakeChild()
    let temporaryOutput = ''
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        temporaryOutput = arguments_.at(-1)!
        return child
      },
      createId: () => 'unique-a',
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })
    await vi.waitFor(() => expect(temporaryOutput).not.toBe(''))
    await writeFile(temporaryOutput, 'partial')

    const cancellation = execution.requestCancel()
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
    let acknowledged = false
    void cancellation.then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)

    child.emit('close', null, 'SIGKILL')
    await expect(cancellation).resolves.toBe('cancelled')
    await expect(execution.settled).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.kill).toHaveBeenCalledTimes(1)
    await expect(access(temporaryOutput)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(destination, 'utf8')).toBe('original')
  })

  it.each(['child', 'stderr'] as const)(
    'kills and reaps after a %s stream failure before cleaning its temporary output',
    async (origin) => {
      const root = await temporaryRoot()
      const destination = join(root, 'episode.mp3')
      const child = new FakeChild()
      let temporaryOutput = ''
      const coordinator = new ExportCoordinator({
        spawn: (_command, arguments_) => {
          temporaryOutput = arguments_.at(-1)!
          return child
        },
        createId: () => 'unique-a',
      })
      const execution = coordinator.start({
        identity: identity(),
        project: project(),
        selectDestination: async () => destination,
        resolveOriginal: async () => '/outside/voice.mp3',
        revalidate: vi.fn(),
        onProgress: vi.fn(),
      })
      await vi.waitFor(() => expect(temporaryOutput).not.toBe(''))
      await writeFile(temporaryOutput, 'partial')

      if (origin === 'child') child.emit('error', new Error('spawn failed'))
      else child.stderr.emit('error', new Error('stderr failed'))
      await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
      let settled = false
      void execution.settled.catch(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      child.emit('close', null, 'SIGKILL')
      await expect(execution.settled).rejects.toThrow(
        origin === 'child' ? 'spawn failed' : 'stderr failed',
      )
      expect(child.kill).toHaveBeenCalledTimes(1)
      await expect(access(temporaryOutput)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('reports only a bounded diagnostic tail for a nonzero exit and removes no unrelated files', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    const unrelated = join(root, '.unrelated.mp3')
    await writeFile(destination, 'original')
    await writeFile(unrelated, 'keep')
    const child = new FakeChild()
    let temporaryOutput = ''
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        temporaryOutput = arguments_.at(-1)!
        queueMicrotask(() => {
          child.stderr.write(`discard-me-${'a'.repeat(5_000)}-tail-marker`)
          child.emit('close', 3, null)
        })
        return child
      },
      createId: () => 'unique-a',
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    const error = (await execution.settled.catch((reason: Error) => reason)) as Error
    expect(error.message).toContain('tail-marker')
    expect(error.message).not.toContain('discard-me')
    expect(error.message.length).toBeLessThan(4_300)
    await expect(access(temporaryOutput)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(destination, 'utf8')).toBe('original')
    expect(await readFile(unrelated, 'utf8')).toBe('keep')
  })

  it('keeps a post-commit backup when its first cleanup attempt fails without retrying or failing export', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    const backup = join(root, '.episode.podcut-backup-unique-a.mp3')
    await writeFile(destination, 'original')
    const child = new FakeChild()
    const remove = vi.fn(async (path: string) => {
      if (remove.mock.calls.length === 1) throw new Error('backup cleanup failed')
      await rm(path, { force: true })
    })
    const warningSink = {
      record: vi.fn(async () => {
        throw new Error('warning sink unavailable')
      }),
    }
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        void writeFile(arguments_.at(-1)!, 'new-export').then(() => child.emit('close', 0, null))
        return child
      },
      createId: () => 'unique-a',
      remove,
      cleanupWarningSink: warningSink,
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).resolves.toMatchObject({ value: true })
    expect(await readFile(destination, 'utf8')).toBe('new-export')
    expect(await readFile(backup, 'utf8')).toBe('original')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(backup)
    expect(warningSink.record).toHaveBeenCalledWith({
      path: backup,
      operation: 'export-publication',
      kind: 'destination-backup',
      cause: expect.objectContaining({ message: 'backup cleanup failed' }),
    })
  })

  it('removes an existing-destination backup after ordinary successful publication', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    await writeFile(destination, 'original')
    const child = new FakeChild()
    const warningSink = { record: vi.fn() }
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        void writeFile(arguments_.at(-1)!, 'new-export').then(() => child.emit('close', 0, null))
        return child
      },
      createId: () => 'unique-a',
      cleanupWarningSink: warningSink,
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).resolves.toMatchObject({ value: true })
    expect(await readFile(destination, 'utf8')).toBe('new-export')
    expect(await readdir(root)).toEqual(['episode.mp3'])
    expect(warningSink.record).not.toHaveBeenCalled()
  })

  it('revalidates after code zero and preserves an existing destination when the session is stale', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    await writeFile(destination, 'original')
    const child = new FakeChild()
    let temporaryOutput = ''
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        temporaryOutput = arguments_.at(-1)!
        void writeFile(temporaryOutput, 'new-export').then(() => child.emit('close', 0, null))
        return child
      },
      createId: () => 'unique-a',
    })
    const revalidate = vi.fn(() => {
      throw new Error('Stale workspace revision')
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate,
      onProgress: vi.fn(),
    })

    await expect(execution.settled).rejects.toThrow('Stale workspace revision')
    expect(revalidate).toHaveBeenCalledTimes(1)
    await expect(access(temporaryOutput)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(destination, 'utf8')).toBe('original')
  })

  it('backs up and restores an existing destination when publication fails', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    await writeFile(destination, 'original', { mode: 0o640 })
    const child = new FakeChild()
    const renameDependency = vi.fn(async (source: string, target: string) => {
      if (source.includes('podcut-export')) throw new Error('publish rename failed')
      await rename(source, target)
    })
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        void writeFile(arguments_.at(-1)!, 'new-export').then(() => child.emit('close', 0, null))
        return child
      },
      createId: () => 'unique-a',
      rename: renameDependency,
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).rejects.toThrow('publish rename failed')
    expect(await readFile(destination, 'utf8')).toBe('original')
    expect((await stat(destination)).mode & 0o777).toBe(0o640)
    expect(await readdir(root)).toEqual(['episode.mp3'])
  })

  it('retains a failed rollback backup and aggregates publication and rollback causes', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    const unrelated = join(root, 'unrelated.mp3')
    await writeFile(destination, 'original')
    await writeFile(unrelated, 'keep')
    const child = new FakeChild()
    let renameCalls = 0
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        void writeFile(arguments_.at(-1)!, 'new-export').then(() => child.emit('close', 0, null))
        return child
      },
      createId: () => 'unique-a',
      rename: async (source, target) => {
        renameCalls += 1
        if (renameCalls === 1) return rename(source, target)
        if (renameCalls === 2) throw new Error('publication failed')
        throw new Error('rollback failed')
      },
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    const error = await execution.settled.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map((item) => (item as Error).message)).toEqual([
      'publication failed',
      'rollback failed',
    ])
    expect(await readFile(join(root, '.episode.podcut-backup-unique-a.mp3'), 'utf8')).toBe(
      'original',
    )
    expect(await readFile(unrelated, 'utf8')).toBe('keep')
  })

  it('keeps the sender occupied until failed-export cleanup settles', async () => {
    const root = await temporaryRoot()
    const child = new FakeChild()
    const cleanupStarted = deferred<void>()
    const cleanupFinished = deferred<void>()
    const coordinator = new ExportCoordinator({
      spawn: () => child,
      createId: () => 'unique-a',
      remove: async () => {
        cleanupStarted.resolve()
        await cleanupFinished.promise
      },
    })
    const first = coordinator.start({
      identity: identity('export-a'),
      project: project(),
      selectDestination: async () => join(root, 'episode.mp3'),
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })
    await vi.waitFor(() => expect(child.listenerCount('close')).toBeGreaterThan(0))
    child.emit('close', 2, null)
    await cleanupStarted.promise

    expect(() =>
      coordinator.start({
        identity: identity('export-b'),
        project: project(),
        selectDestination: async () => null,
        resolveOriginal: vi.fn(),
        revalidate: vi.fn(),
        onProgress: vi.fn(),
      }),
    ).toThrow('Another export is already active')

    cleanupFinished.resolve()
    await expect(first.settled).rejects.toThrow('exit code 2')
    const second = coordinator.start({
      identity: identity('export-b'),
      project: project(),
      selectDestination: async () => null,
      resolveOriginal: vi.fn(),
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })
    await expect(second.settled).resolves.toMatchObject({ value: false })
  })

  it('does not spawn when cancellation wins while destination selection is pending', async () => {
    const root = await temporaryRoot()
    const selected = deferred<string | null>()
    const spawn = vi.fn()
    const coordinator = new ExportCoordinator({ spawn, createId: () => 'unique-a' })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: () => selected.promise,
      resolveOriginal: vi.fn(),
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    const cancellation = execution.requestCancel()
    selected.resolve(join(root, 'episode.mp3'))

    await expect(cancellation).resolves.toBe('cancelled')
    await expect(execution.settled).rejects.toMatchObject({ name: 'AbortError' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('cleans its sibling artifact when spawning throws synchronously', async () => {
    const root = await temporaryRoot()
    const destination = join(root, 'episode.mp3')
    const coordinator = new ExportCoordinator({
      spawn: () => {
        throw new Error('spawn threw')
      },
      createId: () => 'unique-a',
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => destination,
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).rejects.toThrow('spawn threw')
    expect(await readdir(root)).toEqual([])
  })

  it('uses an error delivered immediately after close as the primary failure without killing a reaped child', async () => {
    const root = await temporaryRoot()
    const child = new FakeChild()
    const coordinator = new ExportCoordinator({
      spawn: (_command, arguments_) => {
        void writeFile(arguments_.at(-1)!, 'rendered').then(() => {
          child.emit('close', 0, null)
          child.emit('error', new Error('late process error'))
        })
        return child
      },
      createId: () => 'unique-a',
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => join(root, 'episode.mp3'),
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    await expect(execution.settled).rejects.toThrow('late process error')
    expect(child.kill).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('aggregates cleanup failure after a render failure without masking the render cause', async () => {
    const root = await temporaryRoot()
    const child = new FakeChild()
    const warningSink = { record: vi.fn() }
    const coordinator = new ExportCoordinator({
      spawn: () => {
        queueMicrotask(() => child.emit('close', 9, null))
        return child
      },
      createId: () => 'unique-a',
      remove: async () => {
        throw new Error('temporary cleanup failed')
      },
      cleanupWarningSink: warningSink,
    })
    const execution = coordinator.start({
      identity: identity(),
      project: project(),
      selectDestination: async () => join(root, 'episode.mp3'),
      resolveOriginal: async () => '/outside/voice.mp3',
      revalidate: vi.fn(),
      onProgress: vi.fn(),
    })

    const error = await execution.settled.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map((item) => (item as Error).message)).toEqual([
      'FFmpeg export failed with exit code 9',
      'temporary cleanup failed',
    ])
    expect(warningSink.record).not.toHaveBeenCalled()
  })
})
