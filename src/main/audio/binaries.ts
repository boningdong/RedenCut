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

import { existsSync, statSync } from 'fs'
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
const FFMPEG_CANDIDATES = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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

export function getFfprobePath(): string {
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
    'ffprobe not found.\n' +
    'Install it with: brew install ffmpeg\n' +
    'Then restart the app.',
  )
}

export function getFfmpegPath(): string {
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
    'ffmpeg not found.\n' +
    'Install it with: brew install ffmpeg\n' +
    'Then restart the app.',
  )
}
