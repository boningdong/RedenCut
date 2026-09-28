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
        env: {
          ...process.env,
          HOME: root,
          REDENCUT_MODELS_PATH: '',
          REDENCUT_DOCKER_BIN: docker,
          DOCKER_LOG: log,
          ...extra,
        },
      }),
    calls: () => readFileSync(log, 'utf8').trim().split('\n'),
  }
}

function assertSharedModels(call, models) {
  assert.ok(call.includes(`<type=bind,source=${models},target=/models,readonly>`))
  assert.match(call, /<REDENCUT_MODELS_PATH=\/models>/)
  assert.doesNotMatch(call, /type=volume,source=.*target=\/models|\/test-models|\/managed-models/)
  assert.doesNotMatch(
    call,
    /REDENCUT_WHISPER_MODEL_DIR|REDENCUT_SPEECH_MODEL_CACHE|REDENCUT_MODELS_ROOT/,
  )
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

test('run uses one readonly model mount and explicit path takes precedence over environment', () => {
  const f = fixture()
  const models = join(f.root, 'app models')
  mkdirSync(models)
  const result = f.run(['run', 'speech', '--models-path', models, '--', 'node', '-v'], {
    REDENCUT_MODELS_PATH: join(f.root, 'ignored'),
  })
  assert.equal(result.status, 0, result.stderr)
  assertSharedModels(f.calls().at(-1), models)
  assert.match(f.calls().at(-1), /<redencut-harness-speech:local><node><-v>/)
  assert.match(f.calls().at(-1), /<REDENCUT_SPEECH_WORKER_ROOT=\/workspace\/speech-worker>/)
})

test('run and MCP use environment model paths in both images', () => {
  const f = fixture()
  const models = join(f.root, 'models')
  mkdirSync(models)
  for (const args of [['run', 'base', '--', 'true'], ['mcp'], ['mcp', 'speech']]) {
    const result = f.run(args, { REDENCUT_MODELS_PATH: models })
    assert.equal(result.status, 0, result.stderr)
    assertSharedModels(f.calls().at(-1), models)
  }
})

test('MCP accepts an explicit path for base and speech', () => {
  const f = fixture()
  const models = join(f.root, 'models')
  mkdirSync(models)
  for (const target of ['base', 'speech']) {
    const result = f.run(['mcp', target, '--models-path', models])
    assert.equal(result.status, 0, result.stderr)
    assertSharedModels(f.calls().at(-1), models)
    assert.ok(
      f
        .calls()
        .at(-1)
        .includes(
          `<redencut-harness${target === 'speech' ? '-speech' : ''}:local><node><--import><tsx><harness/server.ts>`,
        ),
    )
  }
})

test('default platform app directory is mounted when present and absence can launch', () => {
  const f = fixture()
  const result = f.run(['run', 'base', '--', 'true'])
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(f.calls().at(-1), /target=\/models,/)
  assert.match(f.calls().at(-1), /REDENCUT_MODELS_PATH=\/models/)
  const relative =
    process.platform === 'darwin'
      ? 'Library/Application Support/RedenCut/models'
      : process.platform === 'win32'
        ? 'AppData/Roaming/RedenCut/models'
        : '.config/RedenCut/models'
  const models = join(f.root, relative)
  mkdirSync(models, { recursive: true })
  const populated = f.run(['run', 'speech', '--', 'true'], { XDG_CONFIG_HOME: '', APPDATA: '' })
  assert.equal(populated.status, 0, populated.stderr)
  assertSharedModels(f.calls().at(-1), models)
})

test('explicit missing paths fail before Docker with installation guidance', () => {
  const f = fixture()
  for (const args of [
    ['run', 'speech', '--models-path', join(f.root, 'missing'), '--', 'true'],
    ['mcp', '--models-path', join(f.root, 'missing')],
    ['test', 'e2e-base', '--models-path', join(f.root, 'missing')],
  ]) {
    const result = f.run(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /MODELS_PATH_MISSING.*npm run setup:models --/)
  }
  for (const args of [['run', 'base', '--', 'true'], ['mcp'], ['test', 'e2e-base']]) {
    const result = f.run(args, { REDENCUT_MODELS_PATH: join(f.root, 'missing-env') })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /MODELS_PATH_MISSING.*npm run setup:models --/)
  }
  assert.throws(() => f.calls(), /ENOENT/)
})

test('invalid and retired commands fail before Docker is called', () => {
  const f = fixture()
  for (const args of [
    [],
    ['build'],
    ['run', 'base', 'node'],
    ['run', 'base', '--models', '/tmp', '--', 'true'],
    ['test', 'unknown'],
    ['models', 'install'],
    ['models', 'check'],
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

test('help describes shared model resolution and the host install command', () => {
  const f = fixture()
  const result = f.run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /--models-path.*REDENCUT_MODELS_PATH.*platform app models directory/)
  assert.match(result.stdout, /read-only at \/models/)
  assert.match(result.stdout, /npm run setup:models --/)
  assert.doesNotMatch(result.stdout, /models install\|check|\/test-models|\/managed-models/)
  assert.throws(() => f.calls(), /ENOENT/)
})

test('named suites select image and speech uses the common offline default-set check', () => {
  const f = fixture()
  assert.equal(f.run(['test', 'e2e-base']).status, 0)
  assert.match(f.calls().at(-1), /<redencut-harness:local><npm><run><test:e2e:base>/)
  const models = join(f.root, 'models')
  const nodeLog = join(f.root, 'node.log')
  mkdirSync(models)
  writeFileSync(
    join(f.root, 'node'),
    '#!/bin/sh\nif [ "$4" = check ]; then\n  printf "<%s>" "$@" >> "$NODE_LOG"\n  exit "${MODEL_CHECK_STATUS:-0}"\nfi\nexec "$REAL_NODE" "$@"\n',
    { mode: 0o755 },
  )
  const env = {
    PATH: `${f.root}:${process.env.PATH}`,
    REAL_NODE: process.execPath,
    NODE_LOG: nodeLog,
    REDENCUT_MODELS_PATH: models,
  }
  for (const suite of ['e2e-speech', 'e2e-all']) {
    const result = f.run(['test', suite], env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      f.calls().at(-1),
      new RegExp(
        `<redencut-harness-speech:local><npm><run><test:${suite.replace('e2e-', 'e2e:')}>`,
      ),
    )
    assertSharedModels(f.calls().at(-1), models)
  }
  assert.ok(
    readFileSync(nodeLog, 'utf8').includes(`<check><--set><default><--models-path><${models}>`),
  )
  const before = f.calls().length
  const rejected = f.run(['test', 'e2e-speech'], { ...env, MODEL_CHECK_STATUS: '1' })
  assert.notEqual(rejected.status, 0)
  assert.equal(f.calls().length, before)
})

test('speech E2E rejects absent models before Docker', () => {
  const f = fixture()
  const result = f.run(['test', 'e2e-speech'])
  assert.notEqual(result.status, 0)
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
