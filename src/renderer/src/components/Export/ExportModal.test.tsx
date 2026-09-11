// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExportCancellationResult,
  ExportJobId,
  IElectronAPI,
  RenderProgressEvent,
  SessionJobResult,
} from '@shared/ipc.types'
import { createEmptyProject } from '@shared/project.types'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { ExportModal } from './ExportModal'
import { useLocaleStore } from '../../stores/locale.store'

const TOKEN_A = 'workspace-a' as WorkspaceToken
const TOKEN_B = 'workspace-b' as WorkspaceToken

function session(token = TOKEN_A, revision = 7): RendererSession {
  const project = createEmptyProject('2026-01-01T00:00:00.000Z')
  return {
    workspaceToken: token,
    revision,
    workspace: { kind: 'saved', displayName: 'Episode', portable: true },
    sources: [],
    speechAnalyses: [],
    draft: {
      tracks: project.tracks,
      export: project.export,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installApi() {
  let progress!: (value: RenderProgressEvent) => void
  const exports: Array<{
    request: Parameters<IElectronAPI['render']['startExport']>[0]
    result: ReturnType<typeof deferred<SessionJobResult<boolean, ExportJobId>>>
  }> = []
  const cancellations: Array<{
    request: Parameters<IElectronAPI['render']['cancelExport']>[0]
    result: ReturnType<typeof deferred<ExportCancellationResult>>
  }> = []
  const renderApi = {
    startExport: vi.fn((request: Parameters<IElectronAPI['render']['startExport']>[0]) => {
      const result = deferred<SessionJobResult<boolean, ExportJobId>>()
      exports.push({ request, result })
      return result.promise
    }),
    cancelExport: vi.fn((request: Parameters<IElectronAPI['render']['cancelExport']>[0]) => {
      const result = deferred<ExportCancellationResult>()
      cancellations.push({ request, result })
      return result.promise
    }),
  }
  const api = {
    render: renderApi,
    on: {
      renderProgress: vi.fn((callback: (value: RenderProgressEvent) => void) => {
        progress = callback
        return vi.fn()
      }),
    },
  } as unknown as IElectronAPI
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  return { renderApi, exports, cancellations, progress: () => progress }
}

function result(
  jobId: string,
  workspaceToken: WorkspaceToken,
  revision: number,
  value: boolean,
): SessionJobResult<boolean, ExportJobId> {
  return { jobId: jobId as ExportJobId, workspaceToken, revision, value }
}

describe('ExportModal', () => {
  beforeEach(() => {
    useLocaleStore.setState({ preference: 'en', resolvedLocale: 'en' })
    const ids = ['export-a', 'export-b']
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => ids.shift()! as `${string}-${string}-${string}-${string}-${string}`,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('switches an open modal without losing its chosen format or restarting an active export', async () => {
    const installed = installApi()
    render(<ExportModal session={session()} draft={session().draft} onClose={vi.fn()} />)
    const format = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(format, { target: { value: 'flac' } })
    act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
    expect(screen.getByRole('heading', { name: '导出音频' })).toBeTruthy()
    expect(screen.getByRole('combobox')).toBe(format)
    expect(format.value).toBe('flac')
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))
    act(() => {
      installed.progress()({
        jobId: 'export-a' as ExportJobId,
        workspaceToken: TOKEN_A,
        revision: 7,
        percent: 0.5,
        currentSeconds: 15,
        totalSeconds: 30,
      })
      useLocaleStore.setState({ resolvedLocale: 'en' })
    })
    expect(screen.getByRole('heading', { name: 'Export Audio' })).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(installed.exports).toHaveLength(1)
    expect(installed.exports[0].request).toMatchObject({
      format: 'flac',
      jobId: 'export-a',
      workspaceToken: TOKEN_A,
      revision: 7,
    })
    expect(installed.cancellations).toHaveLength(0)
  })

  it('filters progress and results by the complete active job and session identity', async () => {
    const installed = installApi()
    render(<ExportModal session={session()} draft={session().draft} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))
    expect(installed.exports[0].request).toMatchObject({
      jobId: 'export-a',
      workspaceToken: TOKEN_A,
      revision: 7,
    })

    act(() => {
      installed.progress()({
        jobId: 'export-a' as ExportJobId,
        workspaceToken: TOKEN_A,
        revision: 8,
        percent: 0.9,
        currentSeconds: 27,
        totalSeconds: 30,
      })
    })
    expect(screen.getByText('0%')).toBeTruthy()
    act(() => {
      installed.progress()({
        jobId: 'export-a' as ExportJobId,
        workspaceToken: TOKEN_A,
        revision: 7,
        percent: 0.5,
        currentSeconds: 15,
        totalSeconds: 30,
      })
    })
    expect(screen.getByText('50%')).toBeTruthy()
    act(() => {
      installed.progress()({
        jobId: 'export-a' as ExportJobId,
        workspaceToken: TOKEN_A,
        revision: 7,
        percent: 1,
        currentSeconds: 30,
        totalSeconds: 30,
      })
    })
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.queryByText('Done!')).toBeNull()
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeTruthy()

    await act(async () => {
      installed.exports[0].result.resolve(result('another-job', TOKEN_A, 7, true))
      await Promise.resolve()
    })
    expect(screen.queryByText('Done!')).toBeNull()
  })

  it('keeps the modal open until visible cancellation is acknowledged and settled', async () => {
    const installed = installApi()
    const onClose = vi.fn()
    render(<ExportModal session={session()} draft={session().draft} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(installed.cancellations[0].request).toEqual({
      jobId: 'export-a',
      workspaceToken: TOKEN_A,
      revision: 7,
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      installed.cancellations[0].result.resolve('cancelled')
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps cancellation ownership when start rejects before the cancel acknowledgement', async () => {
    const installed = installApi()
    const onClose = vi.fn()
    render(<ExportModal session={session()} draft={session().draft} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(installed.cancellations).toHaveLength(1))

    await act(async () => {
      installed.exports[0].result.reject(
        Object.assign(new Error('The operation was cancelled.'), { code: 'cancelled' }),
      )
      await Promise.resolve()
    })

    expect(screen.queryByText('The operation was cancelled.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Exporting…' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Exporting…' }))
    expect(installed.exports).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      installed.cancellations[0].result.resolve('cancelled')
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed cancellation recoverable for an exact-session retry', async () => {
    const installed = installApi()
    const onClose = vi.fn()
    render(<ExportModal session={session()} draft={session().draft} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(installed.cancellations).toHaveLength(1))

    await act(async () => {
      installed.cancellations[0].result.reject(new Error('Cancellation could not be completed.'))
      await Promise.resolve()
    })

    expect(screen.getByText('Cancellation could not be completed.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(installed.cancellations).toHaveLength(2))
    await act(async () => {
      installed.cancellations[1].result.resolve('cancelled')
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a cancellation rejection after a successor session loads', async () => {
    const installed = installApi()
    const onClose = vi.fn()
    const view = render(
      <ExportModal
        session={session(TOKEN_A, 7)}
        draft={session(TOKEN_A, 7).draft}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(installed.cancellations).toHaveLength(1))

    view.rerender(
      <ExportModal
        session={session(TOKEN_B, 8)}
        draft={session(TOKEN_B, 8).draft}
        onClose={onClose}
      />,
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    await act(async () => {
      installed.cancellations[0].result.reject(new Error('old cancellation failed'))
      await Promise.resolve()
    })

    expect(screen.queryByText('old cancellation failed')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prevents an old session rejection and finally block from altering its successor job', async () => {
    const installed = installApi()
    const view = render(
      <ExportModal
        session={session(TOKEN_A, 7)}
        draft={session(TOKEN_A, 7).draft}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(1))

    view.rerender(
      <ExportModal
        session={session(TOKEN_B, 8)}
        draft={session(TOKEN_B, 8).draft}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(installed.exports).toHaveLength(2))

    await act(async () => {
      installed.exports[0].result.reject(new Error('old export failed'))
      await Promise.resolve()
    })
    expect(screen.queryByText('old export failed')).toBeNull()
    expect((screen.getByRole('button', { name: 'Exporting…' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await act(async () => {
      installed.exports[1].result.resolve(result('export-b', TOKEN_B, 8, true))
      await Promise.resolve()
    })
    expect(screen.getByText('Done!')).toBeTruthy()
  })
})
