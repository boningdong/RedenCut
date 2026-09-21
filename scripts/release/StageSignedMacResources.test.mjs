import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { rm } from 'node:fs/promises'
import { stageSignedMacResources } from './StageSignedMacResources.mjs'

const roots = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('copies staged resources after the Electron signing pass and reseals the outer app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-signed-resources-'))
  roots.push(root)
  const resources = join(root, 'staging')
  const app = join(root, 'RedenCut.app')
  await mkdir(join(resources, 'runtime'), { recursive: true })
  await mkdir(join(app, 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(resources, 'runtime', 'executable'), 'native')
  await symlink('executable', join(resources, 'runtime', 'native-link'))
  await writeFile(join(app, 'Contents', 'Resources', 'icon.icns'), 'icon')
  const signatures = []
  await stageSignedMacResources({
    appPath: app,
    resourcesPath: resources,
    entitlementsPath: join(root, 'entitlements.plist'),
    sign: async (path, entitlements) => {
      assert.equal(path, app)
      assert.equal(entitlements, join(root, 'entitlements.plist'))
      assert.equal(
        await readFile(join(app, 'Contents', 'Resources', 'runtime', 'executable'), 'utf8'),
        'native',
      )
      signatures.push(path)
    },
  })
  assert.deepEqual(signatures, [app])
  assert.equal(await readFile(join(app, 'Contents', 'Resources', 'icon.icns'), 'utf8'), 'icon')
  assert.equal(
    await readlink(join(app, 'Contents', 'Resources', 'runtime', 'native-link')),
    'executable',
  )
  assert.equal(
    await readFile(join(app, 'Contents', 'Resources', 'runtime', 'native-link'), 'utf8'),
    'native',
  )
})
