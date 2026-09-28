import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repository = resolve(import.meta.dirname, '../..')

test('speech MCP uses the shared app models read-only without mounting credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-speech-launcher-'))
  const models = join(root, 'app models')
  const fakeDocker = join(root, 'docker')
  await mkdir(models)
  await writeFile(fakeDocker, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n', { mode: 0o755 })
  const result = spawnSync(
    'sh',
    ['harness/container/docker-harness.sh', 'mcp', 'speech', '--models-path', models],
    {
      cwd: repository,
      encoding: 'utf8',
      env: {
        ...process.env,
        REDENCUT_MODELS_PATH: join(root, 'ignored'),
        HF_TOKEN: 'private-test-token',
        HF_TOKEN_PATH: join(root, 'token'),
        REDENCUT_DOCKER_BIN: fakeDocker,
      },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes(`type=bind,source=${models},target=/models,readonly`))
  assert.match(result.stdout, /REDENCUT_MODELS_PATH=\/models/)
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /private-test-token|hf_token|HF_TOKEN|target=\/test-models|target=\/managed-models|type=volume,source=.*target=\/models/,
  )
})
