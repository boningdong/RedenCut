import { join, resolve, relative, isAbsolute } from 'node:path'
import { RuntimeValidator } from './RuntimeValidator'

export interface RuntimeLocationOptions {
  packaged: boolean
  resourcesPath: string
  appPath: string
  env?: NodeJS.ProcessEnv
}

/** All application consumers use one managed root; system discovery is intentionally absent. */
export class AppRuntimeLocator {
  private readonly validator: RuntimeValidator
  private readonly location: { root: string; displayPath: string }
  constructor(options: RuntimeLocationOptions) {
    const root = options.packaged
      ? join(options.resourcesPath, 'runtime')
      : (options.env ?? process.env).REDENCUT_RUNTIME_ROOT ||
        join(options.appPath, '.runtime', `${process.platform}-${process.arch}`)
    const absoluteRoot = resolve(root)
    const fromProject = relative(resolve(options.appPath), absoluteRoot)
    this.location = {
      root: absoluteRoot,
      displayPath:
        !options.packaged &&
        fromProject &&
        !fromProject.startsWith('..') &&
        !isAbsolute(fromProject)
          ? fromProject.split('\\').join('/')
          : absoluteRoot,
    }
    this.validator = new RuntimeValidator(absoluteRoot)
  }
  getLocation(): { root: string; displayPath: string } {
    return { ...this.location }
  }
  getFfmpegPath(): string {
    return this.validator.resolve('ffmpeg')
  }
  getFfprobePath(): string {
    return this.validator.resolve('ffprobe')
  }
  getWhisperExecutablePath(): string {
    return this.validator.resolve('whisper-cli')
  }
  getUvPath(): string {
    return this.validator.resolve('uv')
  }
  getSpeechPythonPath(): string {
    return this.validator.resolve('python')
  }
}

let configuredLocator: AppRuntimeLocator | undefined
export function configureAppRuntime(locator: AppRuntimeLocator): void {
  configuredLocator = locator
}
function runtime(): AppRuntimeLocator {
  return (configuredLocator ??= new AppRuntimeLocator({
    packaged: false,
    resourcesPath: '',
    appPath: process.cwd(),
  }))
}
export function getFfmpegPath(): string {
  return runtime().getFfmpegPath()
}
export function getFfprobePath(): string {
  return runtime().getFfprobePath()
}
export function getWhisperPath(): string | null {
  try {
    return runtime().getWhisperExecutablePath()
  } catch {
    return null
  }
}
