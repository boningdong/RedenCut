import assert from 'node:assert/strict'
import test from 'node:test'
import { runPythonUnitTests } from './RunPythonUnitTests.mjs'

test('rejects missing or unsupported Python before discovery', () => {
  for (const version of [{ status: 1 }, { status: 0, stdout: '3.14' }])
    assert.throws(() => runPythonUnitTests({ run: () => version }), /prepared Python 3.11/)
})

test('runs only unittest discovery in the selected environment and propagates failures', () => {
  const calls = []
  const status = runPythonUnitTests({
    root: '/checkout',
    environment: {
      REDENCUT_TEST_PYTHON: '/venv/python',
      PYTHONHOME: '/wrong',
      PYTHONPATH: '/wrong',
    },
    run: (python, args, options) => {
      calls.push({ python, args, options })
      return calls.length === 1 ? { status: 0, stdout: '3.11\n' } : { status: 2 }
    },
  })
  assert.equal(status, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].python, '/venv/python')
  assert.equal(calls[1].options.cwd, '/checkout/speech-worker')
  assert.equal(calls[1].options.env.PYTHONPATH, '/checkout/speech-worker/src')
  assert.equal(calls[1].options.env.PYTHONHOME, undefined)
  assert.deepEqual(calls[1].args, [
    '-B',
    '-m',
    'unittest',
    'discover',
    '-s',
    'tests',
    '-p',
    'test_*.py',
    '-v',
  ])
})
