import { spawn, type ChildProcess } from 'child_process'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ExportJobRequest, RenderProgress, SessionJobResult } from '../../shared/ipc.types'
import { ProjectFileSchema } from '../../shared/project.types'
import { buildRenderArgs } from '../audio/renderer'
import { getFfmpegPath } from '../audio/binaries'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import { mergeProjectDraft } from '../project/sessionProjection'
import type { WorkspaceController } from '../project/WorkspaceController'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

type DiagnosticSink = (error: unknown) => void

export function registerRenderIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: DiagnosticSink = console.error,
): void {
  ipcMain.handle('project:export', (event, input: unknown) =>
    toIpcResult(async (): Promise<SessionJobResult<boolean>> => {
      const request = exportRequest(input)
      controller.assertCurrent(request)
      const authoritative = mergeProjectDraft(controller.workspace.project, request.draft)
      const project = ProjectFileSchema.parse({
        ...authoritative,
        export: { ...authoritative.export, format: request.format },
      })
      const window =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
      const destination = await dialog.showSaveDialog(window, {
        title: 'Export Audio',
        defaultPath: `export.${project.export.format}`,
        filters: [
          { name: project.export.format.toUpperCase(), extensions: [project.export.format] },
        ],
      })
      if (destination.canceled || !destination.filePath)
        return { ...requestEnvelope(request), value: false }
      let child: ChildProcess | null = null
      const operation = (async () => {
        const paths = new Map<string, string>()
        for (const source of project.audioSources)
          paths.set(source.id, await controller.resolveOriginal(source.id))
        child = spawn(getFfmpegPath(), buildRenderArgs(project, paths, destination.filePath), {
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        await waitForExport(child, project, request, event.sender)
        return { ...requestEnvelope(request), value: true }
      })()
      const unregister = jobs.register({
        kind: 'export',
        ...requestEnvelope(request),
        senderId: event.sender.id,
        cancel: () => {
          child?.kill()
        },
        settled: operation,
      })
      event.sender.once('destroyed', () => {
        void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
      })
      try {
        return await operation
      } finally {
        unregister()
      }
    }, diagnosticSink),
  )
}

function exportRequest(input: unknown): ExportJobRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = input as Partial<ExportJobRequest>
  if (!candidate.draft || !['mp3', 'wav', 'flac', 'aac'].includes(candidate.format ?? ''))
    throw new PublicIpcError('invalid-request')
  return {
    ...precondition,
    jobId: requireJobId(candidate.jobId),
    draft: candidate.draft,
    format: candidate.format!,
  }
}

async function waitForExport(
  child: ChildProcess,
  project: ReturnType<typeof ProjectFileSchema.parse>,
  request: ExportJobRequest,
  sender: Electron.WebContents,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let diagnosticTail = ''
    let progressFragment = ''
    const reportProgress = (text: string) => {
      const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
      const match = matches.at(-1)
      if (match && !sender.isDestroyed()) {
        const currentSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        const totalSeconds = project.tracks
          .flatMap((track) => track.clips)
          .reduce(
            (max, clip) => Math.max(max, clip.outputStart + clip.sourceEnd - clip.sourceStart),
            0,
          )
        const progress: RenderProgress = {
          percent: totalSeconds ? Math.min(1, currentSeconds / totalSeconds) : 0,
          currentSeconds,
          totalSeconds,
        }
        sender.send('render:progress', { ...requestEnvelope(request), ...progress })
      }
    }
    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      diagnosticTail = (diagnosticTail + text).slice(-4096)
      progressFragment += text
      const records = progressFragment.split(/[\r\n]/)
      progressFragment = records.pop()!.slice(-256)
      for (const record of records) reportProgress(record)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      reportProgress(progressFragment)
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg export failed: ${diagnosticTail.slice(-500)}`))
    })
  })
}

function requestEnvelope(request: ExportJobRequest) {
  return {
    workspaceToken: request.workspaceToken,
    revision: request.revision,
    jobId: request.jobId,
  }
}
