import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRunPythonArguments } from './RunPython.mjs'

test('parses the managed runtime, explicit development source path, and Python arguments', () => {
  assert.deepEqual(
    parseRunPythonArguments([
      '--runtime-root',
      '/runtime',
      '--python-path',
      '/worker/src',
      '--',
      '-m',
      'speech_worker',
    ]),
    {
      runtimeRoot: '/runtime',
      pythonPath: '/worker/src',
      pythonArguments: ['-m', 'speech_worker'],
    },
  )
})

test('rejects unrecognized launcher arguments before the Python separator', () => {
  assert.throws(() => parseRunPythonArguments(['--external-python', '/usr/bin/python3']), /Unknown/)
})
