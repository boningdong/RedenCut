import assert from 'node:assert/strict'
import test from 'node:test'

import { validateRuntimeManifest } from './RuntimeManifest.mjs'

const validManifest = {
  schemaVersion: 1,
  runtimeId: 'darwin-arm64-20260918',
  platform: 'darwin',
  arch: 'arm64',
  executables: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe' },
  components: [
    {
      name: 'ffmpeg',
      version: '7.1.5',
      license: 'LGPL-2.1-or-later',
      sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz',
      sourceSha256: 'a'.repeat(64),
    },
  ],
  files: [{ path: 'bin/ffmpeg', sha256: 'b'.repeat(64) }],
}

test('accepts the frozen schema and optional speech executables', () => {
  assert.deepEqual(validateRuntimeManifest(validManifest), validManifest)
  assert.deepEqual(
    validateRuntimeManifest({
      ...validManifest,
      executables: {
        ...validManifest.executables,
        'whisper-cli': 'bin/whisper-cli',
        python: 'python/bin/python3',
      },
    }).executables,
    {
      ffmpeg: 'bin/ffmpeg',
      ffprobe: 'bin/ffprobe',
      'whisper-cli': 'bin/whisper-cli',
      python: 'python/bin/python3',
    },
  )
})

test('rejects unknown executable keys and malformed component provenance', () => {
  assert.throws(
    () =>
      validateRuntimeManifest({
        ...validManifest,
        executables: { ...validManifest.executables, curl: 'bin/curl' },
      }),
    /unknown executable/i,
  )
  assert.throws(
    () =>
      validateRuntimeManifest({
        ...validManifest,
        components: [{ ...validManifest.components[0], sourceUrl: '' }],
      }),
    /sourceUrl/i,
  )
})
