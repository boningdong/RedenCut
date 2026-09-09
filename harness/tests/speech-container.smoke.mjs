import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repository = resolve(import.meta.dirname, '../..')

test('provision resolves the current user token and mounts it read-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'podcut-speech-launcher-'))
  const home = join(root, 'developer-home')
  const token = join(home, '.cache', 'huggingface', 'token')
  const fakeDocker = join(root, 'docker')
  await mkdir(resolve(token, '..'), { recursive: true })
  await writeFile(token, 'not-a-real-token')
  await writeFile(fakeDocker, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', { mode: 0o755 })

  const result = spawnSync('sh', ['harness/container/run-speech.sh', 'provision'], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      HF_HOME: '',
      HF_TOKEN_PATH: '',
      PODCUT_DOCKER_BIN: fakeDocker,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /source=.*developer-home\/\.cache\/huggingface\/token/)
  assert.match(result.stdout, /target=\/run\/secrets\/hf_token/)
  assert.match(result.stdout, /readonly/)
  assert.doesNotMatch(result.stdout, /not-a-real-token/)
})
