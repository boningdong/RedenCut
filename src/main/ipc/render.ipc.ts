import { spawn } from 'child_process'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { RenderProgress } from '@shared/ipc.types'
import { ProjectFileSchema } from '@shared/project.types'
import { buildRenderArgs } from '../audio/renderer'
import { getFfmpegPath } from '../audio/binaries'
import type { WorkspaceController } from '../project/WorkspaceController'

export function registerRenderIpc(controller: WorkspaceController): void {
  ipcMain.handle('project:export', async (event, projectInput: unknown, format: string) => {
    const input = ProjectFileSchema.parse(projectInput)
    const project = ProjectFileSchema.parse({
      ...input,
      export: { ...input.export, format },
    })
    const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
    const destination = await dialog.showSaveDialog(window, {
      title: 'Export Audio',
      defaultPath: `export.${project.export.format}`,
      filters: [{ name: project.export.format.toUpperCase(), extensions: [project.export.format] }],
    })
    if (destination.canceled || !destination.filePath) return false
    const paths = new Map<string, string>()
    for (const source of project.audioSources)
      paths.set(source.id, await controller.resolveOriginal(source.id))
    const child = spawn(getFfmpegPath(), buildRenderArgs(project, paths, destination.filePath))
    await new Promise<void>((resolve, reject) => {
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        const match = stderr
          .match(/time=(\d+):(\d+):(\d+\.\d+)/g)
          ?.at(-1)
          ?.match(/(\d+):(\d+):(\d+\.\d+)/)
        if (match && !event.sender.isDestroyed()) {
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
          event.sender.send('render:progress', progress)
        }
      })
      child.once('error', reject)
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`FFmpeg export failed: ${stderr.slice(-500)}`)),
      )
    })
    return true
  })
}
