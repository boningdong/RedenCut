import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const repository = resolve(import.meta.dirname, '../..')
const command = join(repository, 'harness/container/docker-harness.sh')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'redencut-docker-cli-'))
  const docker = join(root, 'docker')
  const log = join(root, 'docker.log')
  writeFileSync(docker, '#!/bin/sh\nprintf "<%s>" "$@" >> "$DOCKER_LOG"\nprintf "\\n" >> "$DOCKER_LOG"\n', { mode: 0o755 })
  return {
    root,
    log,
    run: (args, extra = {}) => spawnSync('sh', [command, ...args], {
      cwd: repository,
      encoding: 'utf8',
      env: { ...process.env, REDENCUT_DOCKER_BIN: docker, DOCKER_LOG: log, ...extra },
    }),
    calls: () => readFileSync(log, 'utf8').trim().split('\n'),
  }
}

test('build speech builds base first and passes selected base tag', () => {
  const f = fixture()
  const result = f.run(['build', 'speech'], { REDENCUT_HARNESS_IMAGE: 'custom-base:dev' })
  assert.equal(result.status, 0, result.stderr)
  const calls = f.calls()
  assert.equal(calls.length, 2)
  assert.match(calls[0], /<build>.*<custom-base:dev>/)
  assert.match(calls[1], /<build>.*<REDENCUT_HARNESS_BASE=custom-base:dev>.*Dockerfile\.speech/)
})

test('run speech selects speech image and mounts one model path with spaces', () => {
  const f = fixture()
  const models = join(f.root, 'app models')
  mkdirSync(models)
  const result = f.run(['run', 'speech', '--models', models, '--', 'node', '-v'])
  assert.equal(result.status, 0, result.stderr)
  const calls = f.calls()
  assert.match(calls.at(-1), /<type=bind,source=.*app models,target=\/test-models,readonly>/)
  assert.match(calls.at(-1), /<redencut-harness-speech:local><node><-v>/)
})

test('invalid commands fail before Docker is called', () => {
  const f = fixture()
  for (const args of [[], ['build'], ['run', 'base', 'node'], ['run', 'base', '--models', '/tmp', '--', 'true']]) {
    const result = f.run(args)
    assert.notEqual(result.status, 0, args.join(' '))
    assert.match(result.stderr, /Usage|usage|requires|invalid/i)
  }
  assert.throws(() => f.calls(), /ENOENT/)
})
