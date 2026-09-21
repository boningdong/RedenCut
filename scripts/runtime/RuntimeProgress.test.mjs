import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntimeProgress } from './RuntimeProgress.mjs'

function output(isTTY) {
  const chunks = []
  return { isTTY, columns: 100, write: (value) => chunks.push(value), chunks }
}

test('TTY updates one line with measured percentages and clears it before prompting', () => {
  const stream = output(true)
  const progress = createRuntimeProgress({ stream })
  try {
    progress.update({ label: 'Downloading model', completed: 25, total: 100 })
    assert.match(stream.chunks.at(-1), /25%/)
    assert.match(stream.chunks.at(-1), /\r\x1b\[2K/)
    progress.pause()
    assert.equal(stream.chunks.at(-1), '\r\x1b[2K')
    progress.update({ label: 'Validating model' })
    assert.doesNotMatch(stream.chunks.at(-1), /%/)
    progress.finish('Setup complete')
    assert.match(stream.chunks.at(-1), /Setup complete\n$/)
  } finally {
    progress.pause()
  }
})

test('redirected output reports stages without escape sequences or per-chunk noise', () => {
  const stream = output(false)
  const progress = createRuntimeProgress({ stream })
  for (let i = 0; i <= 100; i++) progress.update({ label: 'Downloading', completed: i, total: 100 })
  progress.update({ label: 'Compiling' })
  progress.finish('Setup failed', false)
  assert.equal(stream.chunks.length, 13)
  assert.doesNotMatch(stream.chunks.join(''), /\x1b|\r/)
  assert.match(stream.chunks.at(-1), /Setup failed/)
})
