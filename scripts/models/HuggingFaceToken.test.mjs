import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveHuggingFaceToken } from './HuggingFaceToken.mjs'

async function root(context) {
  const directory = await mkdtemp(join(tmpdir(), 'redencut-model-token-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('environment credentials take precedence and trim whitespace', async () => {
  assert.equal(
    await resolveHuggingFaceToken({
      environment: { HF_TOKEN: ' first ', HUGGING_FACE_HUB_TOKEN: 'second' },
    }),
    'first',
  )
  assert.equal(
    await resolveHuggingFaceToken({
      environment: { HF_TOKEN: ' ', HUGGING_FACE_HUB_TOKEN: ' second ' },
    }),
    'second',
  )
  assert.equal(
    await resolveHuggingFaceToken({ environment: { HUGGINGFACE_TOKEN: 'third' } }),
    'third',
  )
})

test('an explicit missing credential path does not fall through to unrelated credentials', async (context) => {
  const directory = await root(context)
  const cache = join(directory, 'xdg')
  await mkdir(join(cache, 'huggingface'), { recursive: true })
  await writeFile(join(cache, 'huggingface/token'), 'unrelated')
  assert.equal(
    await resolveHuggingFaceToken({
      environment: { HF_TOKEN_PATH: join(directory, 'missing'), XDG_CACHE_HOME: cache },
    }),
    undefined,
  )
  assert.equal(
    await resolveHuggingFaceToken({ environment: { XDG_CACHE_HOME: cache } }),
    'unrelated',
  )
})

test('reads explicit token paths and HF_HOME before cache defaults', async (context) => {
  const directory = await root(context)
  await writeFile(join(directory, 'explicit-token'), ' explicit ')
  await writeFile(join(directory, 'token'), ' home ')
  assert.equal(
    await resolveHuggingFaceToken({
      environment: { HF_TOKEN_PATH: join(directory, 'explicit-token'), HF_HOME: directory },
    }),
    'explicit',
  )
  assert.equal(await resolveHuggingFaceToken({ environment: { HF_HOME: directory } }), 'home')
})
