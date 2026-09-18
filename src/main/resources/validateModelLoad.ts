import { offlineEnvironment } from '../speech/inferenceEnvironment'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
import type { AppRuntimeLocator } from '../runtime/AppRuntimeLocator'
const execute = promisify(execFile)

export function createModelLoadValidator(runtime: AppRuntimeLocator, manifest: string) {
  const validate = async (
    model: ModelDefinition,
    directory: string,
    signal: AbortSignal,
  ): Promise<void> => {
    const env = offlineEnvironment({
      ...process.env,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
      PYTHONPATH: join(dirname(manifest), 'src'),
    })
    for (const key of Object.keys(env))
      if (/TOKEN|SECRET|PASSWORD/i.test(key)) delete (env as NodeJS.ProcessEnv)[key]
    env.HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
    if (model.capability !== 'transcription') {
      await execute(
        runtime.getSpeechPythonPath(),
        [
          '-m',
          'redencut_speech_worker.validate_model',
          '--manifest',
          manifest,
          '--model-id',
          model.id,
          '--path',
          directory,
        ],
        { env, signal, timeout: 180_000, maxBuffer: 1024 * 1024 },
      )
      return
    }
    const probe = join(directory, `.load-check-${randomUUID()}.wav`)
    const wav = Buffer.alloc(44 + 32000)
    wav.write('RIFF')
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16000, 24)
    wav.writeUInt32LE(32000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(32000, 40)
    try {
      await writeFile(probe, wav)
      await execute(
        runtime.getWhisperExecutablePath(),
        ['-m', join(directory, model.files[0].path), '-f', probe, '-l', 'en', '-nt'],
        { env, signal, timeout: 180_000, maxBuffer: 1024 * 1024 },
      )
    } finally {
      await rm(probe, { force: true })
    }
  }
  return Object.assign(validate, {
    preflight: async (models: ModelDefinition[], signal: AbortSignal): Promise<void> => {
      signal.throwIfAborted()
      runtime.getFfmpegPath()
      if (models.some((model) => model.capability === 'transcription'))
        runtime.getWhisperExecutablePath()
      if (models.some((model) => model.capability !== 'transcription')) {
        const env: NodeJS.ProcessEnv = offlineEnvironment({
          ...process.env,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          PYTHONPATH: '',
        })
        for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD/i.test(key)) delete env[key]
        env.HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
        const imports = models.some((model) => model.capability === 'diarization')
          ? 'import torch, pyannote.audio'
          : 'import torch; from whisperx import load_align_model'
        await execute(runtime.getSpeechPythonPath(), ['-c', imports], {
          env,
          signal,
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        })
      }
    },
  })
}
