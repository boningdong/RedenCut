import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  writeFileSync(
    docker,
    '#!/bin/sh\nprintf "<%s>" "$@" >> "$DOCKER_LOG"\nprintf "\\n" >> "$DOCKER_LOG"\n',
    { mode: 0o755 },
  )
  return {
    root,
    docker,
    log,
    run: (args, extra = {}) =>
      spawnSync('sh', [command, ...args], {
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
  assert.match(calls.at(-1), /<REDENCUT_SPEECH_WORKER_ROOT=\/workspace\/speech-worker>/)
})

test('invalid commands fail before Docker is called', () => {
  const f = fixture()
  for (const args of [
    [],
    ['build'],
    ['run', 'base', 'node'],
    ['run', 'base', '--models', '/tmp', '--', 'true'],
    ['test', 'unknown'],
    ['models'],
    ['mcp', 'unknown'],
  ]) {
    const result = f.run(args)
    assert.notEqual(result.status, 0, args.join(' '))
    assert.match(result.stderr, /Usage|usage|requires|invalid/i)
  }
  assert.throws(() => f.calls(), /ENOENT/)
})

test('a missing image gives the matching build command', () => {
  const f = fixture()
  writeFileSync(f.docker, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const result = f.run(['run', 'speech', '--', 'true'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HARNESS_IMAGE_MISSING.*build speech/)
})

test('help names the actions and distinct model stores', () => {
  const f = fixture()
  const result = f.run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /build base|build speech/)
  assert.match(result.stdout, /\/models.*\/test-models.*\.runtime\/models/s)
  assert.throws(() => f.calls(), /ENOENT/)
})

test('named E2E suites select the correct image and npm script', () => {
  const f = fixture()
  assert.equal(f.run(['test', 'e2e-base']).status, 0)
  assert.match(f.calls().at(-1), /<redencut-harness:local><npm><run><test:e2e:base>/)
  const models = join(f.root, 'models')
  mkdirSync(join(models, 'transcription-default'), { recursive: true })
  writeFileSync(join(models, 'transcription-default', 'installation.json'), '{}')
  writeFileSync(join(f.root, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  assert.equal(
    f.run(['test', 'e2e-speech', '--models', models], { PATH: `${f.root}:${process.env.PATH}` })
      .status,
    0,
  )
  assert.match(f.calls().at(-1), /<redencut-harness-speech:local><npm><run><test:e2e:speech>/)
  assert.match(f.calls().at(-1), /target=\/test-models,readonly/)
})

test('speech E2E refuses a missing or empty model fixture before Docker', () => {
  const f = fixture()
  const empty = join(f.root, 'empty')
  mkdirSync(empty)
  for (const args of [
    ['test', 'e2e-speech'],
    ['test', 'e2e-all', '--models', empty],
  ]) {
    const result = f.run(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /MODEL_FIXTURE_REQUIRED|MODEL_FIXTURE_INVALID/)
  }
  assert.throws(() => f.calls(), /ENOENT/)
})

test('source validation rejects stale speech dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'redencut-speech-check-'))
  const source = join(root, 'source')
  const installed = join(root, 'installed')
  for (const directory of [source, installed]) mkdirSync(directory)
  for (const file of ['pyproject.toml', 'uv.lock', 'models.json']) {
    writeFileSync(join(source, file), 'same')
    writeFileSync(join(installed, file), 'same')
  }
  const check = join(repository, 'harness/container/config/VerifySpeechSource.sh')
  assert.equal(spawnSync('sh', [check, source, installed], { encoding: 'utf8' }).status, 0)
  writeFileSync(join(source, 'uv.lock'), 'changed')
  const result = spawnSync('sh', [check, source, installed], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SPEECH_IMAGE_STALE/)
  writeFileSync(join(source, 'uv.lock'), 'same')
  writeFileSync(join(source, 'models.json'), 'new')
  writeFileSync(join(installed, 'models.json'), 'old')
  const manifestResult = spawnSync('sh', [check, source, installed], { encoding: 'utf8' })
  assert.notEqual(manifestResult.status, 0)
  assert.match(manifestResult.stderr, /models\.json/)
})

test('app model validator checks marker identity and file digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'redencut-app-models-'))
  const models = join(root, 'models')
  const manifest = join(root, 'models.json')
  const data = Buffer.from('model bytes')
  const digest = createHash('sha256').update(data).digest('hex')
  const definition = {
    id: 'transcription-default',
    repository: 'example/model',
    revision: 'abc',
    capability: 'transcription',
    files: [{ path: 'model.bin', size: data.length, sha256: digest }],
  }
  writeFileSync(manifest, JSON.stringify({ models: [definition] }))
  const installed = join(models, 'transcription', definition.id, definition.revision)
  mkdirSync(installed, { recursive: true })
  writeFileSync(join(installed, 'model.bin'), data)
  writeFileSync(join(installed, 'installation.json'), JSON.stringify({ ...definition }))
  const validator = join(repository, 'harness/container/test/ValidateAppModels.mjs')
  const invoke = () => spawnSync('node', [validator, models, manifest], { encoding: 'utf8' })
  assert.equal(invoke().status, 0)
  writeFileSync(join(installed, 'model.bin'), Buffer.from('model bytez'))
  assert.notEqual(invoke().status, 0)
})

test('models install mounts a token read-only without printing its contents', () => {
  const f = fixture()
  const home = join(f.root, 'developer home')
  const token = join(home, '.cache', 'huggingface', 'token')
  mkdirSync(resolve(token, '..'), { recursive: true })
  writeFileSync(token, 'private-test-token')
  const result = f.run(['models', 'install'], { HOME: home, HF_HOME: '', HF_TOKEN_PATH: '' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(f.calls().at(-1), /target=\/run\/secrets\/hf_token,readonly/)
  assert.match(f.calls().at(-1), /source=.*developer home/)
  assert.doesNotMatch(result.stdout + result.stderr + f.calls().join(''), /private-test-token/)
})

test('models check requires no token and MCP defaults to base image', () => {
  const f = fixture()
  assert.equal(f.run(['models', 'check'], { HF_TOKEN_PATH: join(f.root, 'missing') }).status, 0)
  assert.doesNotMatch(f.calls().at(-1), /hf_token/)
  assert.equal(f.run(['mcp']).status, 0)
  assert.match(
    f.calls().at(-1),
    /<redencut-harness:local><node><--import><tsx><harness\/server.ts>/,
  )
  assert.equal(f.run(['mcp', 'speech']).status, 0)
  assert.match(
    f.calls().at(-1),
    /<redencut-harness-speech:local><node><--import><tsx><harness\/server.ts>/,
  )
})

test('models install rejects an unavailable token before Docker', () => {
  const f = fixture()
  const result = f.run(['models', 'install'], { HOME: f.root, HF_HOME: '', HF_TOKEN_PATH: '' })
  assert.equal(result.status, 20)
  assert.match(result.stderr, /HF_TOKEN_UNAVAILABLE/)
  assert.throws(() => f.calls(), /ENOENT/)
})
