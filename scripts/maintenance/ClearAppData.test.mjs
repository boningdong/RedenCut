import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import test from 'node:test'

const command = new URL('../clear-app-data.mjs', import.meta.url)
const preferences = {
  version: 1,
  onboardingDisposition: 'completed',
  language: 'zh-CN',
  customPreference: { keep: true },
}

async function fixture(context) {
  const home = await mkdtemp(join(tmpdir(), 'redencut-clear-data-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const config = join(home, 'config')
  const appData =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? join(home, 'AppData', 'Roaming')
        : config
  const root = join(appData, 'redencut')
  const productRoot = join(appData, 'RedenCut')
  await mkdir(root, { recursive: true })
  const run = (...args) =>
    spawnSync(process.execPath, [command.pathname, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        APPDATA: appData,
        XDG_CONFIG_HOME: config,
        REDENCUT_MODELS_PATH: '',
      },
    })
  return { home, root, productRoot, run }
}

async function savePreferences(root) {
  await mkdir(root, { recursive: true })
  const path = join(root, 'app-preferences.json')
  await writeFile(path, JSON.stringify(preferences))
  return path
}

test('default onboarding resets the development preference file and preserves other keys', async (context) => {
  const { root, productRoot, run } = await fixture(context)
  const path = await savePreferences(root)
  await mkdir(productRoot, { recursive: true })
  const distinctDirectories = (await stat(root)).ino !== (await stat(productRoot)).ino
  const sibling = distinctDirectories ? await savePreferences(productRoot) : undefined
  const result = run('onboarding')
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes(`Target: ${root}\n`), result.stdout)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    ...preferences,
    onboardingDisposition: 'pending',
  })
  if (sibling) assert.deepEqual(JSON.parse(await readFile(sibling, 'utf8')), preferences)
})

test('default model cleanup removes shared product models and preserves preferences', async (context) => {
  const { root, productRoot, run } = await fixture(context)
  const path = await savePreferences(root)
  const models = join(productRoot, 'models')
  await mkdir(models, { recursive: true })
  await writeFile(join(models, 'weights'), 'model')
  const result = run('models')
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.includes(`Remove: ${models}\n`), result.stdout)
  await assert.rejects(stat(models), { code: 'ENOENT' })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), preferences)
})

test('onboarding accepts an explicit data directory containing spaces', async (context) => {
  const { home, root, run } = await fixture(context)
  const defaultPath = await savePreferences(root)
  const explicit = join(home, 'custom app data')
  const path = await savePreferences(explicit)
  const result = run('onboarding', '--user-data-dir', explicit)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    ...preferences,
    onboardingDisposition: 'pending',
  })
  assert.deepEqual(JSON.parse(await readFile(defaultPath, 'utf8')), preferences)
})

test('onboarding refuses a linked data directory without changing its preferences', async (context) => {
  const { home, root, run } = await fixture(context)
  const path = await savePreferences(root)
  const linked = join(home, 'linked-data')
  await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir')
  const result = run('onboarding', '--user-data-dir', linked)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Refusing symbolic link/)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), preferences)
})

test('onboarding refuses a linked preference file without changing its target', async (context) => {
  const { home, root, run } = await fixture(context)
  const target = await savePreferences(join(home, 'saved-data'))
  await symlink(target, join(root, 'app-preferences.json'))
  const result = run('onboarding', '--user-data-dir', root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Refusing symbolic link/)
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), preferences)
})

test('model cleanup refuses the home directory as an explicit models path', async (context) => {
  const { home, root, run } = await fixture(context)
  const path = await savePreferences(root)
  const result = run('models', '--models-path', home)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Refusing broad models path/)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), preferences)
})

for (const target of ['home', 'user-data']) {
  test(`model cleanup refuses an ancestor-linked alias of ${target}`, async (context) => {
    const { home, root, run } = await fixture(context)
    const linked = await mkdtemp(join(tmpdir(), 'redencut-clear-alias-'))
    context.after(() => rm(linked, { recursive: true, force: true }))
    await symlink(
      dirname(home),
      join(linked, 'parent'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const preferencesPath = await savePreferences(root)
    const marker = join(home, 'preserve-project')
    await writeFile(marker, 'unrelated project')
    const alias = join(
      linked,
      'parent',
      basename(home),
      target === 'home' ? '' : relative(home, root),
    )
    const result = run('models', '--models-path', alias, '--user-data-dir', root)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /Refusing broad models path/)
    assert.equal(await readFile(marker, 'utf8'), 'unrelated project')
    assert.deepEqual(JSON.parse(await readFile(preferencesPath, 'utf8')), preferences)
  })
}

test('model cleanup accepts an ordinary model directory below a linked parent', async (context) => {
  const { home, root, run } = await fixture(context)
  const linked = await mkdtemp(join(tmpdir(), 'redencut-clear-alias-'))
  context.after(() => rm(linked, { recursive: true, force: true }))
  await symlink(home, join(linked, 'parent'), process.platform === 'win32' ? 'junction' : 'dir')
  const models = join(home, 'custom-models')
  await mkdir(models)
  await writeFile(join(models, 'weights'), 'model')
  const preferencesPath = await savePreferences(root)
  const result = run('models', '--models-path', join(linked, 'parent', 'custom-models'))
  assert.equal(result.status, 0, result.stderr)
  await assert.rejects(stat(models), { code: 'ENOENT' })
  assert.deepEqual(JSON.parse(await readFile(preferencesPath, 'utf8')), preferences)
})
