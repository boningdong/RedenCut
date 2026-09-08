import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { deadline } from '../runtime/deadline'

export function requireContainerAudio(env: NodeJS.ProcessEnv = process.env): void {
  if (
    process.platform !== 'linux' ||
    !existsSync('/.dockerenv') ||
    env.PODCUT_CONTAINER_AUDIO !== '1' ||
    env.PULSE_SERVER !== 'unix:/tmp/podcut-audio/native' ||
    env.PULSE_SINK !== 'podcut_test'
  )
    throw new Error(
      'CONTAINER_AUDIO_REQUIRED: run with Docker: sh harness/container/run.sh npm run test:e2e',
    )
}

export class AudioCapture {
  private static active: ChildProcess | undefined
  private stopped: Promise<string> | undefined

  private constructor(
    private readonly child: ChildProcess,
    private readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
    readonly path: string,
  ) {}

  static async start(directory: string, label: string): Promise<AudioCapture> {
    requireContainerAudio()
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error('INVALID_CAPTURE_LABEL')
    if (AudioCapture.active) throw new Error('AUDIO_CAPTURE_ALREADY_ACTIVE')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${label}.wav`)
    const log = openSync(join(directory, `${label}.capture.log`), 'wx', 0o600)
    const child = spawn(
      'ffmpeg',
      [
        '-nostdin',
        '-n',
        '-hide_banner',
        '-loglevel',
        'info',
        '-f',
        'pulse',
        '-fragment_size',
        '3840',
        '-i',
        'podcut_test.monitor',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-c:a',
        'pcm_s16le',
        '-t',
        '120',
        '-stats_period',
        '0.1',
        '-progress',
        'pipe:1',
        path,
      ],
      { stdio: ['ignore', 'pipe', log] },
    )
    closeSync(log)
    AudioCapture.active = child
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }))
        child.once('error', () => resolve({ code: -1, signal: null }))
      },
    )
    void exited.then(() => {
      if (AudioCapture.active === child) AudioCapture.active = undefined
    })
    const capture = new AudioCapture(child, exited, path)
    try {
      await deadline(
        new Promise<void>((resolve, reject) => {
          let progress = ''
          child.stdout!.on('data', (data: Buffer) => {
            progress += data.toString()
            if (/out_time_us=[1-9]\d*/.test(progress)) resolve()
            if (progress.length > 8192) progress = progress.slice(-4096)
          })
          void exited.then((result) =>
            reject(new Error(`AUDIO_CAPTURE_EXITED: ${JSON.stringify(result)}`)),
          )
        }),
        10_000,
        'AUDIO_CAPTURE_NOT_READY',
      )
      return capture
    } catch (error) {
      await capture.stop().catch(() => {})
      throw error
    }
  }

  stop(): Promise<string> {
    return (this.stopped ??= this.finish())
  }

  private async finish(): Promise<string> {
    if (this.child.exitCode !== null || this.child.signalCode !== null)
      throw new Error('AUDIO_CAPTURE_EXITED_EARLY')
    this.child.kill('SIGINT')
    let result: { code: number | null; signal: NodeJS.Signals | null }
    try {
      result = await deadline(this.exited, 5000, 'AUDIO_CAPTURE_STOP_TIMEOUT')
    } catch (error) {
      this.child.kill('SIGKILL')
      await deadline(this.exited, 5000, 'AUDIO_CAPTURE_KILL_TIMEOUT')
      throw error
    }
    // FFmpeg finalizes the WAV and exits 255 on a handled SIGINT.
    if (result.signal !== null || (result.code !== 0 && result.code !== 255))
      throw new Error(`AUDIO_CAPTURE_FAILED: ${JSON.stringify(result)}`)
    return this.path
  }
}
