import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { basename } from 'node:path'
import { collectHelperLogs } from './HelperLogCollector'
import type { LogSource } from '../../shared/AppLogMessageTypes'

/** Resource probes keep stdout as results while stderr feeds application diagnostics. */
export function executeLogged(
  file: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  const name = basename(file).toLowerCase()
  const source: LogSource = name.includes('ffprobe')
    ? 'ffprobe'
    : name.includes('ffmpeg')
      ? 'ffmpeg'
      : name.includes('whisper')
        ? 'whisper'
        : name.includes('python')
          ? 'python'
          : 'main'
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
    collectHelperLogs(
      child,
      { source, component: 'resource-check' },
      source === 'python' ? 'python' : 'text',
    )
  })
}
