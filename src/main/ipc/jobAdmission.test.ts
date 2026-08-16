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
    readonly import = vi.fn(() => mocks.nextImportResult)
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
  return {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn(),
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
    mocks.resolveTranscript.mockReset()
  })

  it('does not start import work when registry admission rejects', async () => {
    const controller = controllerStub()
    registerAudioIpc(controller as unknown as WorkspaceController, rejectingRegistry(), vi.fn())
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/selected.wav'] })
    const event = { sender: sender() }
    const selection = (await mocks.handlers.get('audio:select-import-file')!(event)) as {
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

    const result = await mocks.handlers.get('project:export')!(
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
    const firstSelection = (await mocks.handlers.get('audio:select-import-file')!(event)) as {
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
    const secondSelection = (await mocks.handlers.get('audio:select-import-file')!(event)) as {
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
})
