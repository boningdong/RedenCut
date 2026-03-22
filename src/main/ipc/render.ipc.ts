// ─────────────────────────────────────────────────────────────────────────────
// Render IPC Handler
//
// Handles project:export — builds the FFmpeg filter graph from the project
// snapshot, spawns FFmpeg, streams progress events to the renderer.
// ─────────────────────────────────────────────────────────────────────────────

import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import type { ProjectFile } from '@shared/project.types'
import { ProjectFileSchema } from '@shared/project.types'
import type { RenderProgress } from '@shared/ipc.types'
import { buildRenderArgs } from '../audio/renderer'
import { getFfmpegPath } from '../audio/binaries'

ipcMain.handle('project:export', async (event, project: ProjectFile, outputPath: string) => {
  const validated = ProjectFileSchema.parse(project)
  const args = buildRenderArgs(validated, outputPath)
  const ffmpeg = spawn(getFfmpegPath(), args)

  console.log(`[RenderIPC] spawning ffmpeg: ${getFfmpegPath()} ${args.join(' ')}`)

  await new Promise<void>((resolve, reject) => {
    let stderr = ''

    // Parse duration once from stderr header
    let totalSeconds = 0

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text

      // Extract total duration (appears once near the start)
      if (totalSeconds === 0) {
        const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
        if (durationMatch) {
          totalSeconds =
            parseInt(durationMatch[1], 10) * 3600 +
            parseInt(durationMatch[2], 10) * 60 +
            parseFloat(durationMatch[3])
        }
      }

      // Parse current progress: "time=HH:MM:SS.ss"
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/)
      if (timeMatch && totalSeconds > 0) {
        const currentSeconds =
          parseInt(timeMatch[1], 10) * 3600 +
          parseInt(timeMatch[2], 10) * 60 +
          parseFloat(timeMatch[3])
        const percent = Math.min(1, currentSeconds / totalSeconds)
        const progress: RenderProgress = { percent, currentSeconds, totalSeconds }
        if (!event.sender.isDestroyed()) {
          event.sender.send('render:progress', progress)
        }
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        if (!event.sender.isDestroyed()) {
          event.sender.send('render:progress', { percent: 1, currentSeconds: totalSeconds, totalSeconds })
        }
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-500)}`))
      }
    })

    ffmpeg.on('error', reject)
  })
})
