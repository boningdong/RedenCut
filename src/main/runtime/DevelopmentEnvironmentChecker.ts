import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  DevelopmentEnvironment,
  DevelopmentCheck,
} from '../../shared/developmentEnvironment.types'
import type { AppRuntimeLocator } from './AppRuntimeLocator'
import { offlineEnvironment } from '../speech/inferenceEnvironment'
const execute = promisify(execFile)
type Probe = (file: string, args: string[], signal: AbortSignal) => Promise<void>
/** Read-only checks: installation stays an explicit developer terminal action. */
export class DevelopmentEnvironmentChecker {
  private active: Promise<DevelopmentEnvironment> | null = null
  private readonly lifetime = new AbortController()
  constructor(
    private runtime: AppRuntimeLocator,
    private probe: Probe = async (file, args, signal) => {
      await execute(file, args, {
        signal,
        env: offlineEnvironment({ ...process.env, PYTHONPATH: '' }),
        timeout: 60_000,
        killSignal: 'SIGKILL',
        maxBuffer: 512 * 1024,
      })
    },
  ) {}
  check(onProgress?: (state: DevelopmentEnvironment) => void): Promise<DevelopmentEnvironment> {
    this.active ??= this.inspect(onProgress).finally(() => {
      this.active = null
    })
    return this.active
  }
  async shutdown(): Promise<void> {
    this.lifetime.abort()
    await this.active
  }
  private async inspect(
    onProgress?: (state: DevelopmentEnvironment) => void,
  ): Promise<DevelopmentEnvironment> {
    const state: DevelopmentEnvironment = {
      platform: process.platform,
      ffmpeg: false,
      ffprobe: false,
      whisper: false,
      uv: false,
      python: false,
      libraries: false,
      ready: false,
      checking: ['ffmpeg', 'ffprobe', 'whisper', 'uv', 'python', 'libraries'],
    }
    const signal = this.lifetime.signal
    const emit = () => {
      if (!signal.aborted) onProgress?.({ ...state, checking: [...state.checking!] })
    }
    emit()
    const check = async (key: DevelopmentCheck, resolve: () => string, args: string[]) => {
      try {
        signal.throwIfAborted()
        await this.probe(resolve(), args, signal)
        signal.throwIfAborted()
        state[key] = true
        return true
      } catch {
        return false
      } finally {
        state.checking = state.checking!.filter((item) => item !== key)
        emit()
      }
    }
    const [ffmpeg, ffprobe, whisper, uv, python] = await Promise.all([
      check('ffmpeg', () => this.runtime.getFfmpegPath(), ['-version']),
      check('ffprobe', () => this.runtime.getFfprobePath(), ['-version']),
      check('whisper', () => this.runtime.getWhisperExecutablePath(), ['--help']),
      check('uv', () => this.runtime.getUvPath(), ['--version']),
      check('python', () => this.runtime.getSpeechPythonPath(), [
        '-c',
        'import sys; assert sys.version_info[:2] == (3, 11)',
      ]),
    ])
    const libraries =
      python &&
      (await check('libraries', () => this.runtime.getSpeechPythonPath(), [
        '-c',
        'import av, torch, torchaudio, sys, platform; from whisperx import load_align_model; from pyannote.audio import Pipeline; ' +
          "exec('from torchcodec.decoders import AudioDecoder' if not (sys.platform == 'linux' and platform.machine() == 'aarch64') else '')",
      ]))
    // uv is a setup tool, not an inference dependency once Python is ready.
    return {
      checking: [],
      platform: process.platform,
      ffmpeg,
      ffprobe,
      whisper,
      uv,
      python,
      libraries,
      ready: ffmpeg && ffprobe && whisper && python && libraries,
    }
  }
}
