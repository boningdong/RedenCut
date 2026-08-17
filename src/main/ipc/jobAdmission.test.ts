import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject, type ProjectFile } from '../../shared/project.types'
import type { ProjectDraft, RendererSession, WorkspaceToken } from '../../shared/session.types'
import { SessionJobRegistry } from '../project/SessionJobRegistry'

type IpcHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  importInstances: [] as Array<{
    import: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }>,
  nextImportResult: undefined as Promise<{ project: ProjectFile }> | undefined,
  nextImportImplementation: undefined as
    ((...args: unknown[]) => Promise<{ project: ProjectFile }>) | undefined,
  resolveTranscript: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getFocusedWindow: vi.fn(() => ({})),
  },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialog: mocks.showSaveDialog,
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler),
  },
}))

vi.mock('../audio/import/ImportCoordinator', () => ({
  ImportCoordinator: class {
    readonly import = vi.fn((...args: unknown[]) =>
      mocks.nextImportImplementation
        ? mocks.nextImportImplementation(...args)
        : mocks.nextImportResult,
    )
    readonly cancel = vi.fn()

    constructor() {
      mocks.importInstances.push(this)
    }
  },
}))

vi.mock('../transcriber/whisper', () => ({
  whisperTranscriber: {
    unavailableReason: vi.fn(async () => null),
    transcribe: mocks.resolveTranscript,
  },
}))

import { registerAudioIpc } from './audio.ipc'
import { registerRenderIpc } from './render.ipc'
import { registerTranscriptIpc } from './transcript.ipc'
import type { WorkspaceController } from '../project/WorkspaceController'

const TOKEN_A = 'token-a' as WorkspaceToken
const TOKEN_B = 'token-b' as WorkspaceToken

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function session(token: WorkspaceToken, revision: number): RendererSession {
  return {
    workspaceToken: token,
    revision,
    workspace: { kind: 'saved', displayName: 'Episode', portable: true },
    sources: [],
    draft: emptyDraft(),
  }
}

function emptyDraft(): ProjectDraft {
  const project = createEmptyProject()
  return { tracks: project.tracks, transcript: project.transcript, export: project.export }
}

function sender(id = 1) {
  const destroyedListeners = new Set<() => void>()
  return {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.add(listener)
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyedListeners.delete(listener)
    }),
    listenerCount: () => destroyedListeners.size,
    destroy: () => [...destroyedListeners].forEach((listener) => listener()),
  }
}

function controllerStub() {
  let workspace = {
    root: '/workspace-a',
    descriptor: { kind: 'saved' as const, displayName: 'A', portable: true },
    project: createEmptyProject(),
  }
  const resolveOriginal = vi.fn(async () => '/main-only/source.wav')
  return {
    get workspace() {
      return workspace
    },
    setWorkspace(root: string) {
      workspace = { ...workspace, root }
    },
    assertCurrent: vi.fn(),
    resolveOriginal,
    captureOriginalResolver: vi.fn(() => resolveOriginal),
    runTransition: vi.fn(async (expected, operation) =>
      operation({
        commitImport: vi.fn(async (_project: ProjectFile) =>
          session(expected.workspaceToken, expected.revision + 1),
        ),
      }),
    ),
  }
}

function rejectingRegistry() {
  return {
    register: vi.fn(() => {
      throw new Error('Session is closing')
    }),
  } as unknown as SessionJobRegistry
}

describe('IPC job admission', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.showOpenDialog.mockReset()
    mocks.showSaveDialog.mockReset()
    mocks.importInstances.splice(0)
    mocks.nextImportResult = undefined
    mocks.nextImportImplementation = undefined
    mocks.resolveTranscript.mockReset()
  })

  it('does not start import work when registry admission rejects', async () => {
    const controller = controllerStub()
    registerAudioIpc(controller as unknown as WorkspaceController, rejectingRegistry(), vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as {
      value: { token: string }
    }
    mocks.importInstances[0].import.mockReturnValue(new Promise(() => {}))

    const result = await mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })

    expect(result).toMatchObject({ ok: false })
    expect(mocks.importInstances[0].import).not.toHaveBeenCalled()
  })

  it('keeps one sender-scoped selection listener across repeated selections', async () => {
    const controller = controllerStub()
    registerAudioIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
    )
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const ownedSender = sender()
    const event = { sender: ownedSender }

    await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })
    await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })

    expect(ownedSender.listenerCount()).toBe(1)
  })

  it('owns selection cleanup by sender object even when a numeric sender ID is reused', async () => {
    const controller = controllerStub()
    registerAudioIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
    )
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const firstSender = sender(7)
    const replacementSender = sender(7)

    await mocks.handlers.get('audio:select-import-file')!(
      { sender: firstSender },
      { workspaceToken: TOKEN_A, revision: 1 },
    )
    const replacementSelection = (await mocks.handlers.get('audio:select-import-file')!(
      { sender: replacementSender },
      { workspaceToken: TOKEN_A, revision: 1 },
    )) as { value: { token: string } }

    expect(firstSender.listenerCount()).toBe(1)
    expect(replacementSender.listenerCount()).toBe(1)

    firstSender.destroy()
    mocks.nextImportResult = Promise.resolve({ project: createEmptyProject() })
    const result = await mocks.handlers.get('audio:start-import')!(
      { sender: replacementSender },
      {
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'replacement-sender-job',
        selectionToken: replacementSelection.value.token,
        mode: 'copy',
        draft: emptyDraft(),
      },
    )

    expect(result).toMatchObject({ ok: true })
  })

  it.each(['success', 'failure', 'cancel'] as const)(
    'removes the per-import destroyed listener after %s settlement',
    async (outcome) => {
      const controller = controllerStub()
      const jobs = new SessionJobRegistry()
      registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
      const ownedSender = sender()
      const event = { sender: ownedSender }
      const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
        workspaceToken: TOKEN_A,
        revision: 1,
      })) as { value: { token: string } }
      const pending = deferred<{ project: ProjectFile }>()
      mocks.nextImportResult = pending.promise
      mocks.importInstances[0].cancel.mockReturnValue('cancelled')
      const importing = mocks.handlers.get('audio:start-import')!(event, {
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'listener-job',
        selectionToken: selection.value.token,
        mode: 'copy',
        draft: emptyDraft(),
      })
      await vi.waitFor(() => expect(ownedSender.listenerCount()).toBe(2))

      if (outcome === 'success') pending.resolve({ project: createEmptyProject() })
      else if (outcome === 'failure') pending.reject(new Error('import failed'))
      else {
        const cancelling = mocks.handlers.get('audio:cancel-import')!(event, {
          workspaceToken: TOKEN_A,
          revision: 1,
          jobId: 'listener-job',
        })
        await vi.waitFor(() => expect(mocks.importInstances[0].cancel).toHaveBeenCalledTimes(1))
        pending.reject(new DOMException('cancelled', 'AbortError'))
        await cancelling
      }
      await importing

      expect(ownedSender.listenerCount()).toBe(1)
    },
  )

  it('does not start transcription when registry admission rejects', async () => {
    const controller = controllerStub()
    registerTranscriptIpc(
      controller as unknown as WorkspaceController,
      rejectingRegistry(),
      vi.fn(),
    )

    const result = await mocks.handlers.get('transcript:generate')!(
      { sender: sender() },
      {
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'job-1',
        audioSourceId: '00000000-0000-4000-8000-000000000001',
      },
    )

    expect(result).toMatchObject({ ok: false })
    expect(controller.resolveOriginal).not.toHaveBeenCalled()
    expect(mocks.resolveTranscript).not.toHaveBeenCalled()
  })

  it('does not open the export dialog when registry admission rejects', async () => {
    const controller = controllerStub()
    registerRenderIpc(controller as unknown as WorkspaceController, rejectingRegistry(), vi.fn())
    mocks.showSaveDialog.mockResolvedValue({ canceled: true })

    const result = await mocks.handlers.get('render:start-export')!(
      { sender: sender() },
      {
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'job-1',
        draft: emptyDraft(),
        format: 'mp3',
      },
    )

    expect(result).toMatchObject({ ok: false })
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
    expect(controller.captureOriginalResolver).not.toHaveBeenCalled()
  })

  it('binds late import cancellation to the coordinator admitted for that session', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    const event = { sender: sender() }
    const firstImport = deferred<{ project: ProjectFile }>()
    const secondImport = deferred<{ project: ProjectFile }>()

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/first.wav'] })
    const firstSelection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as {
      value: { token: string }
    }
    mocks.importInstances[0].import.mockReturnValueOnce(firstImport.promise)
    const firstResult = mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'shared-job-id',
      selectionToken: firstSelection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await Promise.resolve()

    controller.setWorkspace('/workspace-b')
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/second.wav'] })
    const secondSelection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_B,
      revision: 2,
    })) as {
      value: { token: string }
    }
    mocks.nextImportResult = secondImport.promise
    const secondResult = mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_B,
      revision: 2,
      jobId: 'shared-job-id',
      selectionToken: secondSelection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    const secondCoordinator = mocks.importInstances[1]
    await Promise.resolve()

    const cancellingFirst = jobs.cancelAndSettleJob({
      kind: 'import',
      jobId: 'shared-job-id',
      senderId: event.sender.id,
      workspaceToken: TOKEN_A,
      revision: 1,
    })
    await Promise.resolve()
    expect(mocks.importInstances[0].cancel).toHaveBeenCalledWith('shared-job-id')
    expect(secondCoordinator.cancel).not.toHaveBeenCalled()

    firstImport.resolve({ project: createEmptyProject() })
    await cancellingFirst
    await firstResult
    secondImport.resolve({ project: createEmptyProject() })
    await secondResult
  })

  it('binds a selection token to the exact sender, workspace token, and revision', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const owner = { sender: sender(1) }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(owner, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }

    const wrongRevision = await mocks.handlers.get('audio:start-import')!(owner, {
      workspaceToken: TOKEN_A,
      revision: 2,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })

    expect(wrongRevision).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(mocks.importInstances[0].import).not.toHaveBeenCalled()
  })

  it('returns cancelled only after the admitted import has settled', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }
    const pending = deferred<{ project: ProjectFile }>()
    mocks.nextImportResult = pending.promise
    mocks.importInstances[0].cancel.mockReturnValue('cancelled')
    const importing = mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].import).toHaveBeenCalled())

    let acknowledged = false
    const cancelling = (
      mocks.handlers.get('audio:cancel-import')!(event, {
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'job-1',
      }) as Promise<unknown>
    ).then((result: unknown) => {
      acknowledged = true
      return result
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)

    pending.reject(new DOMException('cancelled', 'AbortError'))
    await expect(cancelling).resolves.toMatchObject({ ok: true, value: 'cancelled' })
    await importing
  })

  it('returns one immutable terminal outcome to overlapping cancel callers', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }
    const pending = deferred<{ project: ProjectFile }>()
    mocks.nextImportResult = pending.promise
    mocks.importInstances[0].cancel.mockReturnValue('cancelled')
    const importing = mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].import).toHaveBeenCalled())

    const cancellationRequest = {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
    }
    const first = mocks.handlers.get('audio:cancel-import')!(event, cancellationRequest)
    const second = mocks.handlers.get('audio:cancel-import')!(event, cancellationRequest)
    pending.reject(new DOMException('cancelled', 'AbortError'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, value: 'cancelled' },
      { ok: true, value: 'cancelled' },
    ])
    expect(mocks.importInstances[0].cancel).toHaveBeenCalledTimes(1)
    await importing
  })

  it('returns not-found for an unknown or expired import identity', async () => {
    const controller = controllerStub()
    registerAudioIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
    )

    await expect(
      mocks.handlers.get('audio:cancel-import')!(
        { sender: sender() },
        {
          workspaceToken: TOKEN_A,
          revision: 1,
          jobId: 'missing',
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: 'not-found' })
  })

  it('cancels an admitted import by its starting revision after current revision advances', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }
    const pending = deferred<{ project: ProjectFile }>()
    mocks.nextImportResult = pending.promise
    mocks.importInstances[0].cancel.mockReturnValue('cancelled')
    const importing = mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].import).toHaveBeenCalled())
    controller.assertCurrent.mockImplementation((expected: unknown) => {
      if ((expected as { revision: number }).revision !== 2)
        throw new Error('Stale workspace revision')
    })

    const cancelling = mocks.handlers.get('audio:cancel-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].cancel).toHaveBeenCalledTimes(1))
    pending.reject(new DOMException('cancelled', 'AbortError'))

    await expect(cancelling).resolves.toEqual({ ok: true, value: 'cancelled' })
    await importing
  })

  it('does not cancel an admitted import through a different revision', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }
    const pending = deferred<{ project: ProjectFile }>()
    mocks.nextImportResult = pending.promise
    mocks.importInstances[0].cancel.mockReturnValue('cancelled')
    const importing = mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].import).toHaveBeenCalled())

    const wrongRevision = mocks.handlers.get('audio:cancel-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 2,
      jobId: 'job-1',
    })
    await Promise.resolve()
    await Promise.resolve()
    const incorrectlyCancelled = mocks.importInstances[0].cancel.mock.calls.length > 0
    if (incorrectlyCancelled) pending.reject(new DOMException('cancelled', 'AbortError'))
    const result = await wrongRevision

    expect(mocks.importInstances[0].cancel).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, value: 'not-found' })
    if (!incorrectlyCancelled) {
      const cleanupCancellation = mocks.handlers.get('audio:cancel-import')!(event, {
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'job-1',
      })
      await vi.waitFor(() => expect(mocks.importInstances[0].cancel).toHaveBeenCalledTimes(1))
      pending.reject(new DOMException('cancelled', 'AbortError'))
      await cleanupCancellation
    }
    await importing
  })

  it('drops progress after the request envelope becomes stale', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    let current = true
    controller.assertCurrent.mockImplementation(() => {
      if (!current) throw new Error('Stale workspace token')
    })
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }
    mocks.nextImportResult = new Promise(() => {})
    void mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].import).toHaveBeenCalled())
    const progress = mocks.importInstances[0].import.mock.calls[0][5] as (value: {
      displayName: string
      stage: string
      percent: number
    }) => void

    progress({ displayName: 'selected.wav', stage: 'copying', percent: 0.5 })
    current = false
    progress({ displayName: 'selected.wav', stage: 'building-cache', percent: 0.75 })

    expect(event.sender.send).toHaveBeenCalledTimes(1)
  })

  it('sender destruction cancels through the admitted job and awaits its settlement', async () => {
    const controller = controllerStub()
    const jobs = new SessionJobRegistry()
    registerAudioIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const ownedSender = sender()
    const event = { sender: ownedSender }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
    })) as { value: { token: string } }
    const pending = deferred<{ project: ProjectFile }>()
    mocks.nextImportResult = pending.promise
    void mocks.handlers.get('audio:start-import')!(event, {
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-1',
      selectionToken: selection.value.token,
      mode: 'copy',
      draft: emptyDraft(),
    })
    await vi.waitFor(() => expect(mocks.importInstances[0].import).toHaveBeenCalled())

    ownedSender.destroy()
    await vi.waitFor(() => expect(mocks.importInstances[0].cancel).toHaveBeenCalledTimes(1))
    pending.resolve({ project: createEmptyProject() })
  })
})
