import assert from 'node:assert/strict'
import test from 'node:test'

import { parseArguments } from '../PackageMac.mjs'

test('mac packaging accepts a shared model source and directory target', () => {
  assert.deepEqual(parseArguments(['--models-path', '/shared/models', '--dir']), {
    directory: true,
    modelsPath: '/shared/models',
  })
  assert.deepEqual(parseArguments([]), { directory: false })
})

test('mac packaging rejects missing model paths and unknown flags', () => {
  for (const args of [['--models-path'], ['--models-path', '--dir'], ['--models-root', '/old']])
    assert.throws(() => parseArguments(args), /Usage/)
})
