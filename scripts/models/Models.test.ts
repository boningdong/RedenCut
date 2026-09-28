import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseModelArguments } from './Models'

test('model CLI validates actions, selections and explicit paths', () => {
  assert.equal(
    parseModelArguments(['install', '--models-path', '/models with spaces']).modelsPath,
    '/models with spaces',
  )
  assert.equal(parseModelArguments(['check']).set, 'default')
  for (const args of [
    ['check', '--import-from', '/old'],
    ['path', '--model', 'x'],
    ['install', '--models-path'],
    ['install', '--model', 'x', '--set', 'text'],
    ['install', '--set', 'unknown'],
  ])
    assert.throws(() => parseModelArguments(args), /Usage/)
})
