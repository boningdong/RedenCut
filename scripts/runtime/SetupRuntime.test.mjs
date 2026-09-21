import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import test from 'node:test'

import { assertSafeInstallDestination, parseArguments, setupRuntime } from './SetupRuntime.mjs'

test('setup accepts an explicit nested release runtime and rejects broad destructive targets', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-release-'))
  assert.doesNotThrow(() => assertSafeInstallDestination(join(stagingRoot, 'resources', 'runtime')))
  assert.throws(
    () => assertSafeInstallDestination(parse(stagingRoot).root),
    /unsafe runtime destination/i,
  )
  assert.throws(() => assertSafeInstallDestination(process.cwd()), /project root/i)
})

test('parses the model provisioning flags on the existing runtime setup command', () => {
  assert.deepEqual(
    parseArguments([
      '--models-only',
      '--models-root',
      '/models',
      '--import-model',
      '/legacy',
      '--skip-models',
    ]),
    { modelsOnly: true, modelsRoot: '/models', importModel: '/legacy', skipModels: true },
  )
})

test('rejects missing path flag values before setup can start a build', () => {
  for (const flag of ['--bundle', '--runtime-root', '--models-root', '--import-model']) {
    assert.throws(() => parseArguments([flag]), new RegExp(`${flag} requires`))
    assert.throws(() => parseArguments([flag, '--models-only']), new RegExp(`${flag} requires`))
  }
})

test('models-only reuses the native runtime path without building or installing it', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-models-only-'))
  let received
  const result = await setupRuntime({
    modelsOnly: true,
    runtimeRoot: join(stagingRoot, 'runtime'),
    modelsRoot: join(stagingRoot, 'models'),
    skipModels: true,
    installModel: async (options) => {
      received = options
      return { status: 'skipped' }
    },
  })
  assert.equal(result.runtimeManifest, undefined)
  assert.equal(result.model.status, 'skipped')
  assert.equal(received.skip, true)
  assert.equal(received.modelsRoot, join(stagingRoot, 'models'))
})

test('uses explicit runtime and model roots from the environment', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-environment-roots-'))
  let received
  await setupRuntime({
    modelsOnly: true,
    skipModels: true,
    environment: {
      REDENCUT_RUNTIME_ROOT: join(stagingRoot, 'native'),
      REDENCUT_MODELS_ROOT: join(stagingRoot, 'models'),
    },
    installModel: async (options) => {
      received = options
      return { status: 'skipped' }
    },
  })
  assert.equal(received.modelsRoot, join(stagingRoot, 'models'))
  assert.equal(received.runtimeRoot, join(stagingRoot, 'native'))
})

test('offline load validation uses an isolated cwd and child-only environment overrides', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-load-isolation-'))
  const originalTelemetry = process.env.ORT_DISABLE_TELEMETRY
  const originalMatplotlib = process.env.MPLCONFIGDIR
  let invocation
  await setupRuntime({
    modelsOnly: true,
    runtimeRoot: join(stagingRoot, 'runtime'),
    modelsRoot: join(stagingRoot, 'models'),
    runPython: async (options) => {
      invocation = options
      return 0
    },
    installModel: async (options) => {
      await options.validateLoad(join(stagingRoot, 'staged-model'))
      return { status: 'installed' }
    },
  })
  assert.notEqual(invocation.cwd, process.cwd())
  assert.equal(invocation.environment.ORT_DISABLE_TELEMETRY, '1')
  assert.match(invocation.environment.MPLCONFIGDIR, /redencut-model-validation-/)
  assert.equal(invocation.environment.HF_TOKEN, undefined)
  assert.equal(process.env.ORT_DISABLE_TELEMETRY, originalTelemetry)
  assert.equal(process.env.MPLCONFIGDIR, originalMatplotlib)
})

test('model validation captures successful output and retains bounded failure diagnostics', async () => {
  const { writeSync } = await import('node:fs')
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-quiet-validation-'))
  for (const exitCode of [0, 1]) {
    const pending = setupRuntime({
      modelsOnly: true,
      runtimeRoot: join(stagingRoot, 'runtime'),
      runPython: async (options) => {
        assert.ok(Array.isArray(options.stdio), 'Validation must not inherit terminal output')
        writeSync(options.stdio[1], 'x'.repeat(9000) + '\nmodel diagnostic\n')
        return exitCode
      },
      installModel: async (options) => {
        await options.validateLoad(join(stagingRoot, 'model'))
        return { status: 'installed' }
      },
    })
    if (exitCode === 0) assert.equal((await pending).model.status, 'installed')
    else
      await assert.rejects(pending, (error) => {
        assert.match(error.message, /model diagnostic/)
        assert.ok(error.message.length < 8200)
        return true
      })
  }
})
