import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'clear-app-test-'))
  roots.push(root)
  for (const directory of ['models', 'staging', 'secrets', 'projects']) {
    await mkdir(join(root, directory))
    await writeFile(join(root, directory, 'keep'), 'fixture')
  }
  await writeFile(
    join(root, 'app-preferences.json'),
    JSON.stringify({
      version: 1,
      onboardingDisposition: 'completed',
      themeId: 'light',
      localePreference: 'zh-CN',
    }),
  )
  return root
}
function run(root: string, mode: string, ...extra: string[]) {
  return execFileSync(
    process.execPath,
    [resolve('scripts/clear-app-data.mjs'), mode, '--user-data-dir', root, ...extra],
    { encoding: 'utf8' },
  )
}
it('resets only onboarding and preserves other preferences and resources', async () => {
  const root = await fixture()
  run(root, 'onboarding')
  expect(JSON.parse(await readFile(join(root, 'app-preferences.json'), 'utf8'))).toEqual({
    version: 1,
    onboardingDisposition: 'pending',
    themeId: 'light',
    localePreference: 'zh-CN',
  })
  await expect(access(join(root, 'models/keep'))).resolves.toBeUndefined()
})
it('removes models and staging, preserves credentials and projects, and is repeatable', async () => {
  const root = await fixture()
  const before = await readFile(join(root, 'app-preferences.json'), 'utf8')
  run(root, 'models')
  run(root, 'models')
  for (const name of ['models', 'staging']) await expect(access(join(root, name))).rejects.toThrow()
  for (const name of ['secrets', 'projects'])
    await expect(access(join(root, name, 'keep'))).resolves.toBeUndefined()
  expect(await readFile(join(root, 'app-preferences.json'), 'utf8')).toBe(before)
})
it('dry-run and unknown modes leave data untouched', async () => {
  const root = await fixture()
  run(root, 'models', '--dry-run')
  run(root, 'onboarding', '--dry-run')
  expect(() => run(root, 'everything')).toThrow()
  await expect(access(join(root, 'models/keep'))).resolves.toBeUndefined()
  expect(
    JSON.parse(await readFile(join(root, 'app-preferences.json'), 'utf8')).onboardingDisposition,
  ).toBe('completed')
})
it('preserves malformed preferences instead of resetting the whole file', async () => {
  const root = await fixture()
  await writeFile(join(root, 'app-preferences.json'), '{broken')
  expect(() => run(root, 'onboarding')).toThrow()
  expect(await readFile(join(root, 'app-preferences.json'), 'utf8')).toBe('{broken')
})
