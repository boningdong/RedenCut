import assert from 'node:assert/strict'
import test from 'node:test'

import { parseArguments, prepareApplicationBuild } from '../PackageMac.mjs'

test('mac packaging accepts a shared model source and directory target', () => {
  assert.deepEqual(parseArguments(['--models-path', '/shared/models', '--dir']), {
    directory: true,
    modelsPath: '/shared/models',
  })
  assert.deepEqual(parseArguments([]), { directory: false })
})

test('prebuilt packaging verifies the record and never runs the application compiler', async () => {
  const verified = []
  await prepareApplicationBuild({
    root: '/checkout',
    buildRecord: '/record.json',
    verify: async (options) => verified.push(options),
    run: () => assert.fail('Prebuilt packaging must not compile'),
  })
  assert.deepEqual(verified, [{ root: '/checkout', recordPath: '/record.json' }])
  await assert.rejects(
    prepareApplicationBuild({
      buildRecord: '/bad',
      verify: async () => {
        throw new Error('invalid record')
      },
      run: () => assert.fail('Must not compile invalid build'),
    }),
    /invalid record/,
  )
})

test('local packaging still builds by default', async () => {
  const calls = []
  await prepareApplicationBuild({
    root: '/checkout',
    run: (...args) => calls.push(args),
    verify: () => assert.fail('No supplied record'),
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][1], [
    '/checkout/node_modules/electron-vite/bin/electron-vite.js',
    'build',
  ])
  assert.deepEqual(parseArguments(['--build-record', '/record.json']), {
    directory: false,
    buildRecord: '/record.json',
  })
})

test('mac packaging rejects missing model paths and unknown flags', () => {
  for (const args of [['--models-path'], ['--models-path', '--dir'], ['--models-root', '/old']])
    assert.throws(() => parseArguments(args), /Usage/)
})
