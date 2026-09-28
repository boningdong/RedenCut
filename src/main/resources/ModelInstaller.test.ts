import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ModelRegistry } from './ModelRegistry'
import { ModelInstaller } from './ModelInstaller'
import { ModelDownloader } from './ModelDownloader'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
const bytes = Buffer.from('pinned model')
const model: ModelDefinition = {
  id: 'example',
  capability: 'diarization',
  repository: 'a/b',
  revision: 'a'.repeat(40),
  expectedFiles: ['weights'],
  files: [
    {
      path: 'weights',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
  license: 'MIT',
  access: 'gated-auto',
  profiles: [],
  supportedLanguages: [],
}
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'shared-install-'))
  roots.push(root)
  const registry = new ModelRegistry(root, undefined, join(root, 'shared'))
  const source = join(root, 'legacy')
  await mkdir(source)
  await writeFile(join(source, 'weights'), bytes)
  return { root, registry, source }
}
it('imports verified weights into the common layout and reuses valid installations', async () => {
  const { registry, source } = await fixture()
  const downloader = new ModelDownloader(vi.fn())
  const installer = new ModelInstaller(registry, downloader)
  const validate = vi.fn(async () => {})
  const path = await installer.install(model, {
    source,
    signal: new AbortController().signal,
    validateLoad: validate,
  })
  expect(path).toBe(join(registry.modelsRoot, 'diarization', model.id, model.revision))
  expect(JSON.parse(await readFile(join(path, 'installation.json'), 'utf8')).id).toBe(model.id)
  expect(await installer.install(model, { signal: new AbortController().signal })).toBe(path)
  expect(validate).toHaveBeenCalledOnce()
})
it('failed offline load never publishes and a corrected retry can reuse staging', async () => {
  const { registry, source } = await fixture()
  const installer = new ModelInstaller(registry)
  await expect(
    installer.install(model, {
      source,
      signal: new AbortController().signal,
      validateLoad: async () => {
        throw new Error('cannot load')
      },
    }),
  ).rejects.toThrow('cannot load')
  expect(await registry.resolve(model)).toBeNull()
  await installer.install(model, { source, signal: new AbortController().signal })
  expect(await registry.resolve(model)).not.toBeNull()
})
it('rejects corrupt imports and a concurrent installation lock', async () => {
  const { registry, source } = await fixture()
  const installer = new ModelInstaller(registry)
  await writeFile(join(source, 'weights'), Buffer.alloc(bytes.length))
  await expect(
    installer.install(model, { source, signal: new AbortController().signal }),
  ).rejects.toThrow('integrity-failed')
  const lock = join(registry.modelsRoot, '.locks', model.capability, model.id, model.revision)
  await mkdir(lock, { recursive: true })
  await expect(
    installer.install(model, { source, signal: new AbortController().signal }),
  ).rejects.toThrow('model-install-in-progress')
})

it('copies imported cache symlinks into independent regular model files', async () => {
  const { registry, source, root } = await fixture()
  const original = join(root, 'cached-weights')
  await writeFile(original, bytes)
  await rm(join(source, 'weights'))
  await symlink(original, join(source, 'weights'))
  const path = await new ModelInstaller(registry).install(model, {
    source,
    signal: new AbortController().signal,
  })
  await rm(original)
  expect((await lstat(join(path, 'weights'))).isSymbolicLink()).toBe(false)
  expect(await registry.resolve(model)).toBe(path)
})

it('removes interrupted download bookkeeping before publishing an imported diarization model', async () => {
  const { registry, source } = await fixture()
  const staging = registry.paths(model).staging
  await mkdir(staging, { recursive: true })
  await writeFile(join(staging, 'weights.download.json'), '{}')
  const path = await new ModelInstaller(registry).install(model, {
    source,
    signal: new AbortController().signal,
  })
  await expect(readFile(join(path, 'weights.download.json'))).rejects.toThrow()
})
