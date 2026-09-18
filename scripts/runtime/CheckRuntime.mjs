#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

import { createManagedPythonEnvironment } from './RuntimeEnvironment.mjs'
import { validateRuntimeDirectory } from './RuntimeVerifier.mjs'

const execFileAsync = promisify(execFile)

function classifyVerificationError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/missing runtime manifest/i.test(message)) return 'missing'
  if (/schemaVersion|schema version/i.test(message)) return 'version-mismatch'
  return 'integrity-failed'
}

async function loadExecutable(name, executablePath, root) {
  let args
  switch (name) {
    case 'python':
      args = ['-B', '-c', 'import sys; print(sys.version)']
      break
    case 'whisper-cli':
      args = ['--help']
      break
    default:
      args = ['-version']
  }
  try {
    await execFileAsync(executablePath, args, {
      cwd: root,
      env: createManagedPythonEnvironment(root),
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(`${name} failed to load from ${executablePath}: ${error.message}`)
  }
}

async function probeManagedPython(manifest, root) {
  const python = join(root, manifest.executables.python)
  const ffmpeg = join(root, manifest.executables.ffmpeg)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-probe-'))
  const audioPath = join(temporaryRoot, 'probe.wav')
  const environment = createManagedPythonEnvironment(root)
  try {
    await execFileAsync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.2',
        audioPath,
      ],
      { cwd: root, env: environment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    )

    const torchCodecFirst = [
      'import sys',
      'from torchcodec.decoders import AudioDecoder',
      'samples = AudioDecoder(sys.argv[1]).get_all_samples()',
      "assert samples.data.numel() > 0, 'TorchCodec decoded no samples'",
      "print('torchcodec-first-ok')",
    ].join('; ')
    await execFileAsync(python, ['-B', '-I', '-s', '-E', '-c', torchCodecFirst, audioPath], {
      cwd: root,
      env: environment,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    })

    const avFirst = [
      'import av, sys',
      'container = av.open(sys.argv[1])',
      "assert next(container.decode(audio=0), None) is not None, 'PyAV decoded no frames'",
      'import torchcodec, torch, whisperx, pyannote.audio',
      'audio = whisperx.load_audio(sys.argv[1])',
      "assert audio.size > 0, 'WhisperX decoded no samples'",
      "print('av-first-whisperx-ok')",
    ].join('; ')
    await execFileAsync(python, ['-B', '-I', '-s', '-E', '-c', avFirst, audioPath], {
      cwd: root,
      env: environment,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(`managed Python dependency probe failed: ${error.stderr || error.message}`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

export async function checkRuntime(
  root,
  { platform = process.platform, arch = process.arch, loadExecutables = true } = {},
) {
  let manifest
  try {
    manifest = await validateRuntimeDirectory(root)
  } catch (error) {
    return {
      status: classifyVerificationError(error),
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (manifest.platform !== platform || manifest.arch !== arch) {
    return {
      status: 'wrong-architecture',
      message: `Runtime targets ${manifest.platform}-${manifest.arch}; expected ${platform}-${arch}`,
      runtimeId: manifest.runtimeId,
    }
  }

  if (loadExecutables) {
    for (const [name, relativePath] of Object.entries(manifest.executables)) {
      try {
        await loadExecutable(name, join(root, relativePath), root)
      } catch (error) {
        return {
          status: 'load-failed',
          message: error instanceof Error ? error.message : String(error),
          runtimeId: manifest.runtimeId,
        }
      }
    }
    if (manifest.executables.python) {
      try {
        await probeManagedPython(manifest, root)
      } catch (error) {
        return {
          status: 'load-failed',
          message: error instanceof Error ? error.message : String(error),
          runtimeId: manifest.runtimeId,
        }
      }
    }
  }

  return { status: 'ready', runtimeId: manifest.runtimeId, manifest }
}

async function main() {
  const arguments_ = process.argv.slice(2)
  let runtimeRoot
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--runtime-root') runtimeRoot = arguments_[++index]
    else if (!runtimeRoot && !argument.startsWith('-')) runtimeRoot = argument
    else throw new Error(`Unknown CheckRuntime argument: ${argument}`)
  }
  const root = resolve(runtimeRoot ?? join('.runtime', `${process.platform}-${process.arch}`))
  const result = await checkRuntime(root)
  const { manifest: _manifest, ...summary } = result
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (result.status !== 'ready') process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
