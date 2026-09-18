#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import {
  createManagedPythonEnvironment,
  createSanitizedRuntimeEnvironment,
} from './RuntimeEnvironment.mjs'
import { validateRuntimeDirectory } from './RuntimeVerifier.mjs'

const execFileAsync = promisify(execFile)

async function run(file, arguments_, options = {}) {
  return execFileAsync(file, arguments_, {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
}

async function findPythonExtension(directory, prefix) {
  return join(
    directory,
    (await readdir(directory)).find((name) => name.startsWith(prefix) && name.endsWith('.so')),
  )
}

function assertPortableDarwinDependencies(serialized, binary) {
  const dependencies = serialized
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter(Boolean)
  for (const dependency of dependencies) {
    if (
      !dependency.startsWith('@rpath/') &&
      !dependency.startsWith('@loader_path/') &&
      !dependency.startsWith('/usr/lib/') &&
      !dependency.startsWith('/System/Library/')
    ) {
      throw new Error(`${binary} has non-portable dependency ${dependency}`)
    }
  }
  return dependencies
}

export async function verifyRuntimeOperations(runtimeRoot) {
  const root = resolve(runtimeRoot)
  const manifest = await validateRuntimeDirectory(root)
  const ffmpeg = join(root, manifest.executables.ffmpeg)
  const ffprobe = join(root, manifest.executables.ffprobe)
  const python = join(root, manifest.executables.python)
  const nativeEnvironment = createSanitizedRuntimeEnvironment()
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-operations-'))
  try {
    const inputA = join(temporaryRoot, 'tone-a.wav')
    const inputB = join(temporaryRoot, 'tone-b.wav')
    const mixed = join(temporaryRoot, 'trimmed-mixed-resampled.wav')
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-ar',
        '48000',
        inputA,
      ],
      { env: nativeEnvironment },
    )
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=660:duration=1',
        '-ar',
        '48000',
        inputB,
      ],
      { env: nativeEnvironment },
    )
    await run(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputA,
        '-i',
        inputB,
        '-filter_complex',
        '[0:a]atrim=start=0.1:end=0.8,asetpts=PTS-STARTPTS,aresample=16000[a0];' +
          '[1:a]atrim=start=0.2:end=0.9,asetpts=PTS-STARTPTS,aresample=16000[a1];' +
          '[a0][a1]amix=inputs=2:duration=shortest[out]',
        '-map',
        '[out]',
        '-c:a',
        'pcm_s16le',
        mixed,
      ],
      { env: nativeEnvironment },
    )

    const exports = [
      ['wav', join(temporaryRoot, 'export.wav'), ['-c:a', 'pcm_s16le']],
      ['mp3', join(temporaryRoot, 'export.mp3'), ['-c:a', 'libmp3lame', '-q:a', '3']],
      ['aac', join(temporaryRoot, 'export.m4a'), ['-c:a', 'aac', '-b:a', '128k']],
      ['flac', join(temporaryRoot, 'export.flac'), ['-c:a', 'flac']],
    ]
    const formats = {}
    for (const [name, output, codecArguments] of exports) {
      await run(
        ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-i', mixed, ...codecArguments, output],
        {
          env: nativeEnvironment,
        },
      )
      const { stdout } = await run(
        ffprobe,
        ['-v', 'error', '-show_entries', 'format=format_name,duration', '-of', 'json', output],
        { env: nativeEnvironment },
      )
      formats[name] = JSON.parse(stdout).format
    }

    const pythonProbe = [
      'import json, sys',
      'from torchcodec.decoders import AudioDecoder',
      'decoded = AudioDecoder(sys.argv[1]).get_all_samples()',
      "assert decoded.data.numel() > 0, 'TorchCodec decoded no samples'",
      'import av',
      'container = av.open(sys.argv[1])',
      "assert next(container.decode(audio=0), None) is not None, 'PyAV decoded no frames'",
      'import whisperx',
      'audio = whisperx.load_audio(sys.argv[1])',
      "assert audio.size > 0, 'WhisperX decoded no samples'",
      "print(json.dumps({'torchcodecSamples': decoded.data.numel(), 'whisperxSamples': int(audio.size)}))",
    ].join('; ')
    const { stdout: pythonOutput } = await run(
      python,
      ['-B', '-I', '-s', '-E', '-c', pythonProbe, mixed],
      { env: createManagedPythonEnvironment(root) },
    )

    const sitePackages = join(root, 'python', 'lib', 'python3.11', 'site-packages')
    const binaries = [
      ffmpeg,
      ffprobe,
      ...['libavcodec.61.dylib', 'libavformat.61.dylib', 'libmp3lame.0.dylib'].map((name) =>
        join(root, 'lib', name),
      ),
      await findPythonExtension(join(sitePackages, 'av'), '_core.'),
      join(sitePackages, 'torchcodec', 'libtorchcodec_core7.dylib'),
    ]
    const dependencies = {}
    for (const binary of binaries) {
      const { stdout } = await run('/usr/bin/otool', ['-L', binary], { env: nativeEnvironment })
      dependencies[binary.slice(root.length + 1)] = assertPortableDarwinDependencies(stdout, binary)
    }
    const { stdout: buildConfiguration } = await run(ffmpeg, ['-hide_banner', '-buildconf'], {
      env: nativeEnvironment,
    })
    for (const flag of [
      '--disable-autodetect',
      '--disable-gpl',
      '--disable-nonfree',
      '--disable-version3',
    ]) {
      if (!buildConfiguration.includes(flag)) throw new Error(`FFmpeg build is missing ${flag}`)
    }
    return {
      runtimeId: manifest.runtimeId,
      formats,
      python: JSON.parse(pythonOutput.trim()),
      dependencies,
      ffmpegBuildConfiguration: buildConfiguration.trim().split('\n'),
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function parseArguments(arguments_) {
  const options = {}
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === '--runtime-root') options.runtimeRoot = arguments_[++index]
    else if (arguments_[index] === '--output') options.output = arguments_[++index]
    else throw new Error(`Unknown VerifyRuntimeOperations argument: ${arguments_[index]}`)
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const result = await verifyRuntimeOperations(
    options.runtimeRoot ?? join('.runtime', `${process.platform}-${process.arch}`),
  )
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (options.output) {
    await writeFile(resolve(options.output), serialized)
    process.stdout.write(`${resolve(options.output)}\n`)
  } else process.stdout.write(serialized)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
