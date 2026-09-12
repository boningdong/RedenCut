import { expect, test } from 'vitest'
import { electronEnvironment } from '../runtime/electronEnvironment'

test('never forwards unrelated credentials or Node/Electron injection variables into launch traces', () => {
  const env = electronEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/test',
    LANG: 'en_US.UTF-8',
    SECRET_TOKEN: 'sentinel-do-not-record',
    NODE_OPTIONS: '--require malicious',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'https://unrelated.example',
  })
  expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/test', LANG: 'en_US.UTF-8' })
})

test('forwards only the fixed private container audio endpoint, never arbitrary host endpoints', () => {
  expect(
    electronEnvironment({
      RIFFCUT_CONTAINER_AUDIO: '1',
      PULSE_SERVER: 'unix:/tmp/riffcut-audio/native',
      PULSE_SINK: 'riffcut_test',
    }),
  ).toMatchObject({
    PULSE_SERVER: 'unix:/tmp/riffcut-audio/native',
    PULSE_SINK: 'riffcut_test',
  })
  expect(electronEnvironment({ PULSE_SERVER: 'tcp:host.example', PULSE_SINK: 'speakers' })).toEqual(
    {},
  )
})

test('forwards non-secret speech paths but never Hugging Face credentials', () => {
  expect(
    electronEnvironment({
      RIFFCUT_SPEECH_WORKER_ROOT: '/opt/riffcut-speech-worker',
      RIFFCUT_SPEECH_WORKER_PYTHON: '/opt/riffcut-speech-worker/.venv/bin/python',
      RIFFCUT_SPEECH_MANIFEST: '/opt/riffcut-speech-worker/models.json',
      RIFFCUT_SPEECH_MODEL_CACHE: '/models',
      RIFFCUT_WHISPER_MODEL_DIR: '/models/whisper',
      HF_TOKEN: 'do-not-forward',
      HF_TOKEN_PATH: '/run/secrets/hf_token',
    }),
  ).toEqual({
    RIFFCUT_SPEECH_WORKER_ROOT: '/opt/riffcut-speech-worker',
    RIFFCUT_SPEECH_WORKER_PYTHON: '/opt/riffcut-speech-worker/.venv/bin/python',
    RIFFCUT_SPEECH_MANIFEST: '/opt/riffcut-speech-worker/models.json',
    RIFFCUT_SPEECH_MODEL_CACHE: '/models',
    RIFFCUT_WHISPER_MODEL_DIR: '/models/whisper',
  })
})
