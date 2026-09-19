import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppRuntimeLocator } from './AppRuntimeLocator'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'redencut-runtime-'))
  roots.push(root)
  mkdirSync(join(root, 'bin'))
  const executable = '#!/bin/sh\nexit 0\n'
  writeFileSync(join(root, 'bin', 'ffmpeg'), executable, { mode: 0o755 })
  const manifest = {
    schemaVersion: 1,
    runtimeId: 'test-runtime-1',
    platform: process.platform,
    arch: process.arch,
    executables: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffmpeg' },
    components: [
      {
        name: 'ffmpeg',
        version: '7.1',
        license: 'LGPL-2.1-or-later',
        sourceUrl: 'https://ffmpeg.org/',
      },
    ],
    files: [{ path: 'bin/ffmpeg', sha256: createHash('sha256').update(executable).digest('hex') }],
  }
  const save = () => writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  save()
  const locator = (packaged = false) =>
    new AppRuntimeLocator({
      packaged,
      resourcesPath: join(root, 'resources'),
      appPath: root,
      env: {
        REDENCUT_RUNTIME_ROOT: root,
        REDENCUT_FFMPEG_PATH: process.execPath,
        PATH: process.env.PATH,
      },
    })
  return { root, manifest, save, locator }
}
it('selects only the managed executable, ignoring legacy individual overrides', () => {
  const f = fixture()
  expect(f.locator().getFfmpegPath()).toBe(join(f.root, 'bin/ffmpeg'))
})
it('fails without a managed manifest even when a legacy executable is valid', () => {
  const f = fixture()
  rmSync(join(f.root, 'manifest.json'))
  expect(() => f.locator().getFfmpegPath()).toThrow('runtime-unavailable:ffmpeg:missing')
})
it('packaged resolution ignores all developer overrides', () => {
  const f = fixture()
  expect(() => f.locator(true).getFfmpegPath()).toThrow('runtime-unavailable:ffmpeg:missing')
})
it('rejects a runtime for a different architecture', () => {
  const f = fixture()
  f.manifest.arch = process.arch === 'arm64' ? 'x64' : 'arm64'
  f.save()
  expect(() => f.locator().getFfmpegPath()).toThrow('wrong-architecture')
})
it('rejects an executable whose contents changed after installation', () => {
  const f = fixture()
  writeFileSync(join(f.root, 'bin/ffmpeg'), '#!/bin/sh\necho tampered\n')
  expect(() => f.locator().getFfmpegPath()).toThrow('integrity-failed')
})
it('rechecks an executable removed after its first successful resolution', () => {
  const f = fixture()
  const locator = f.locator()
  locator.getFfmpegPath()
  rmSync(join(f.root, 'bin/ffmpeg'))
  expect(() => locator.getFfmpegPath()).toThrow('missing')
})
it('rejects parent traversal in a manifest entrypoint', () => {
  const f = fixture()
  f.manifest.executables.ffmpeg = '../outside'
  f.save()
  expect(() => f.locator().getFfmpegPath()).toThrow('invalid-manifest')
})
it('rejects an entrypoint symlink escaping the runtime root', () => {
  const f = fixture()
  rmSync(join(f.root, 'bin/ffmpeg'))
  symlinkSync(process.execPath, join(f.root, 'bin/ffmpeg'))
  expect(() => f.locator().getFfmpegPath()).toThrow('invalid-path')
})
it('requires the executable to be included in the integrity inventory', () => {
  const f = fixture()
  f.manifest.files[0].path = 'bin/other'
  f.save()
  expect(() => f.locator().getFfmpegPath()).toThrow('invalid-manifest')
})
it('reports missing optional speech without disabling valid audio tools', () => {
  const f = fixture()
  const locator = f.locator()
  expect(locator.getFfmpegPath()).toBe(join(f.root, 'bin/ffmpeg'))
  expect(() => locator.getSpeechPythonPath()).toThrow('runtime-unavailable:python:missing')
})
it('accepts a validated replacement manifest without restarting the application', () => {
  const f = fixture()
  const locator = f.locator()
  locator.getFfmpegPath()
  const replacement = '#!/bin/sh\necho repaired\n'
  writeFileSync(join(f.root, 'bin/ffmpeg'), replacement)
  f.manifest.runtimeId = 'test-runtime-2'
  f.manifest.files[0].sha256 = createHash('sha256').update(replacement).digest('hex')
  f.save()
  expect(locator.getFfmpegPath()).toBe(join(f.root, 'bin/ffmpeg'))
})

it('describes the selected root without requiring an installed runtime', () => {
  const appPath = join(tmpdir(), 'runtime-display-project')
  const runtime = new AppRuntimeLocator({ packaged: false, resourcesPath: '', appPath, env: {} })
  expect(runtime.getLocation()).toEqual({
    root: join(appPath, '.runtime', `${process.platform}-${process.arch}`),
    displayPath: `.runtime/${process.platform}-${process.arch}`,
  })
  const overridden = new AppRuntimeLocator({
    packaged: false,
    resourcesPath: '',
    appPath,
    env: { REDENCUT_RUNTIME_ROOT: '/opt/custom-runtime' },
  })
  expect(overridden.getLocation().displayPath).toBe('/opt/custom-runtime')
})
