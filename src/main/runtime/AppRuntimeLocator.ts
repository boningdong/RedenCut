// ─────────────────────────────────────────────────────────────────────────────
// Binary Resolution
//
// Resolves the paths to ffprobe and ffmpeg using a fallback chain:
//
//   1. System PATH — Homebrew on macOS (/opt/homebrew/bin or /usr/local/bin).
//      This is the recommended path for local development. Homebrew binaries
//      are properly signed and architecture-native (arm64 on Apple Silicon,
//      x64 on Intel). Install with: brew install ffmpeg
//
//   2. *-static npm packages — bundles platform binaries inside node_modules.
//      Useful for CI and Windows where Homebrew isn't available.
//      Caveat: ffprobe-static v3 only ships darwin/x64. On Apple Silicon,
//      macOS may refuse to run it (error -86 EBADARCH) if Rosetta is not
//      active or Gatekeeper blocks unsigned binaries.
//
// This module is called once at startup and throws a clear error if neither
// source provides a working binary, rather than failing deep inside FFmpeg code
// with a cryptic "spawn Unknown system error" message.
// ─────────────────────────────────────────────────────────────────────────────

import { statSync } from 'fs'
import { execFileSync } from 'child_process'

// Known Homebrew install locations (checked in order):
//   /opt/homebrew  — Apple Silicon Macs (M1/M2/M3/M4)
//   /usr/local     — Intel Macs (and older Homebrew)
//   /usr/bin       — Linux system package (apt/yum)
const FFPROBE_CANDIDATES = [
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/usr/bin/ffprobe',
]
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']

// whisper.cpp installed via `brew install whisper-cpp` provides `whisper-cli`.
// Older formula versions used `whisper` as the binary name.
const WHISPER_CANDIDATES = [
  '/opt/homebrew/bin/whisper-cli', // Apple Silicon (brew install whisper-cpp)
  '/usr/local/bin/whisper-cli', // Intel Mac
  '/usr/bin/whisper-cli', // Linux
  '/opt/homebrew/bin/whisper', // older whisper-cpp formula name
  '/usr/local/bin/whisper',
]

function isExecutable(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    // Check the file exists and is a regular file (not a directory)
    return stat.isFile()
  } catch {
    return false
  }
}

function findInPath(candidates: string[], whichName: string): string | null {
  // 1. Check known fixed locations (faster than spawning `which`)
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate
  }

  // 2. Fall back to `which` — catches non-standard install locations
  //    e.g. user installed via asdf, nix, or custom prefix
  try {
    const result = execFileSync('which', [whichName], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    if (result && isExecutable(result)) return result
  } catch {
    // `which` not available or binary not on PATH — fall through
  }

  return null
}

function resolveFromStaticPackage(packageName: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- The package name is selected at runtime so a missing fallback can be caught.
    const pkg = require(packageName)
    // ffprobe-static v3 exports { path, version, url }
    // ffmpeg-static exports a plain string
    const p: string = typeof pkg === 'string' ? pkg : pkg?.path
    if (p && isExecutable(p)) return p
  } catch {
    // Package not installed
  }
  return null
}

// ── Resolve & cache ───────────────────────────────────────────────────────────
// Resolved once on first call, then cached. Both functions throw if no binary
// is found so errors surface immediately with an actionable message.

let _ffprobePath: string | null = null
let _ffmpegPath: string | null = null
let _whisperPath: string | null = null

function developmentFfprobe(): string {
  if (_ffprobePath) return _ffprobePath

  // Try Homebrew / system PATH first
  const fromPath = findInPath(FFPROBE_CANDIDATES, 'ffprobe')
  if (fromPath) {
    _ffprobePath = fromPath
    return _ffprobePath
  }

  // Fall back to npm static package
  const fromStatic = resolveFromStaticPackage('ffprobe-static')
  if (fromStatic) {
    _ffprobePath = fromStatic
    return _ffprobePath
  }

  throw new Error(
    'ffprobe not found.\n' + 'Install it with: brew install ffmpeg\n' + 'Then restart the app.',
  )
}

function developmentFfmpeg(): string {
  if (_ffmpegPath) return _ffmpegPath

  const fromPath = findInPath(FFMPEG_CANDIDATES, 'ffmpeg')
  if (fromPath) {
    _ffmpegPath = fromPath
    return _ffmpegPath
  }

  const fromStatic = resolveFromStaticPackage('ffmpeg-static')
  if (fromStatic) {
    _ffmpegPath = fromStatic
    return _ffmpegPath
  }

  throw new Error(
    'ffmpeg not found.\n' + 'Install it with: brew install ffmpeg\n' + 'Then restart the app.',
  )
}

/**
 * Returns the path to the whisper-cli binary, or null if not found.
 * Unlike ffprobe/ffmpeg, whisper is optional — callers should check
 * availability via `getWhisperPath()` returning null before showing UI.
 */
function developmentWhisper(): string | null {
  if (_whisperPath !== null) return _whisperPath // cached (may be empty string = not found)

  const fromPath = findInPath(WHISPER_CANDIDATES, 'whisper-cli')
  if (fromPath) {
    _whisperPath = fromPath
    return _whisperPath
  }

  // Also try plain `whisper` name via which
  try {
    const result = execFileSync('which', ['whisper'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    if (result && isExecutable(result)) {
      _whisperPath = result
      return _whisperPath
    }
  } catch {
    /* not found */
  }

  _whisperPath = '' // cache negative result
  return null
}

import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

export interface RuntimeLocationOptions {
  packaged: boolean
  resourcesPath: string
  appPath: string
  env?: NodeJS.ProcessEnv
}
export class AppRuntimeLocator {
  constructor(private readonly options: RuntimeLocationOptions) {}
  private resolve(name: string, variable: string, development?: () => string | null): string {
    const executable = process.platform === 'win32' ? `${name}.exe` : name
    const path = this.options.packaged
      ? join(this.options.resourcesPath, 'runtime', 'bin', executable)
      : (this.options.env ?? process.env)[variable] || development?.()
    if (!path || !isExecutable(path)) throw new Error(`runtime-unavailable:${name}`)
    try {
      accessSync(path, constants.X_OK)
    } catch {
      throw new Error(`runtime-unavailable:${name}`)
    }
    return path
  }
  getFfmpegPath(): string {
    return this.resolve('ffmpeg', 'REDENCUT_FFMPEG_PATH', developmentFfmpeg)
  }
  getFfprobePath(): string {
    return this.resolve('ffprobe', 'REDENCUT_FFPROBE_PATH', developmentFfprobe)
  }
  getWhisperExecutablePath(): string {
    return this.resolve('whisper-cli', 'REDENCUT_WHISPER_PATH', developmentWhisper)
  }
  getUvPath(): string {
    return this.resolve('uv', 'REDENCUT_UV_BIN', () =>
      findInPath(
        [
          '/opt/homebrew/bin/uv',
          '/usr/local/bin/uv',
          join(process.env.HOME ?? '', '.local/bin/uv'),
        ],
        'uv',
      ),
    )
  }
  getSpeechPythonPath(): string {
    return this.resolve('python3', 'REDENCUT_SPEECH_WORKER_PYTHON', () =>
      join(this.options.appPath, 'speech-worker', '.venv', 'bin', 'python'),
    )
  }
}

let configuredLocator: AppRuntimeLocator | null = null
export function configureAppRuntime(locator: AppRuntimeLocator): void {
  configuredLocator = locator
}
export function getFfmpegPath(): string {
  return configuredLocator ? configuredLocator.getFfmpegPath() : developmentFfmpeg()
}
export function getFfprobePath(): string {
  return configuredLocator ? configuredLocator.getFfprobePath() : developmentFfprobe()
}
export function getWhisperPath(): string | null {
  try {
    return configuredLocator ? configuredLocator.getWhisperExecutablePath() : developmentWhisper()
  } catch {
    return null
  }
}
