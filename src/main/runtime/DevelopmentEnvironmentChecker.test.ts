import type { DevelopmentEnvironment } from '../../shared/developmentEnvironment.types'
import { expect, test, vi } from 'vitest'
import { DevelopmentEnvironmentChecker } from './DevelopmentEnvironmentChecker'
import { AppRuntimeLocator } from './AppRuntimeLocator'
function locator() {
  const runtime = new AppRuntimeLocator({ packaged: false, resourcesPath: '', appPath: '' })
  for (const [method, path] of Object.entries({
    getFfmpegPath: 'ffmpeg',
    getFfprobePath: 'ffprobe',
    getWhisperExecutablePath: 'whisper',
    getUvPath: 'uv',
    getSpeechPythonPath: 'python',
  }))
    vi.spyOn(runtime, method as keyof AppRuntimeLocator).mockReturnValue(path)
  return runtime
}
test('missing setup tool does not disable an already usable runtime', async () => {
  const checker = new DevelopmentEnvironmentChecker(locator(), async (file) => {
    if (file === 'uv') throw Error('missing')
  })
  expect(await checker.check()).toMatchObject({
    uv: false,
    python: true,
    libraries: true,
    ready: true,
  })
})
test('checks actual imports, detects missing libraries, and supports explicit revalidation', async () => {
  let installed = false
  const probe = vi.fn(async (_file: string, args: string[]) => {
    if (args.join(' ').includes('whisperx') && !installed) throw Error('missing library')
  })
  const checker = new DevelopmentEnvironmentChecker(locator(), probe)
  expect(await checker.check()).toMatchObject({ python: true, libraries: false, ready: false })
  installed = true
  expect(await checker.check()).toMatchObject({ libraries: true, ready: true })
})
test('reports individual tool failure without concealing the remaining checks', async () => {
  const checker = new DevelopmentEnvironmentChecker(locator(), async (file) => {
    if (file === 'whisper') throw Error('bad executable')
  })
  expect(await checker.check()).toMatchObject({
    whisper: false,
    ffmpeg: true,
    libraries: true,
    ready: false,
  })
})

test('publishes completed rows while speech library imports are still running', async () => {
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => {
    finish = resolve
  })
  const updates: DevelopmentEnvironment[] = []
  const checker = new DevelopmentEnvironmentChecker(locator(), async (_file, args) => {
    if (args.join(' ').includes('whisperx')) await waiting
  })
  const checking = checker.check((state) => updates.push(state))
  await vi.waitFor(() =>
    expect(
      updates.some(
        (state) =>
          state.python &&
          state.checking?.includes('libraries') &&
          !state.checking.includes('python'),
      ),
    ).toBe(true),
  )
  finish()
  expect(await checking).toMatchObject({ ready: true, checking: [] })
})
