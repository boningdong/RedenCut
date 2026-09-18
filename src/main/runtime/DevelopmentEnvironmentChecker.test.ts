import type { DevelopmentEnvironment } from '../../shared/developmentEnvironment.types'
import { expect, test, vi } from 'vitest'
import { DevelopmentEnvironmentChecker } from './DevelopmentEnvironmentChecker'
import { AppRuntimeLocator } from './AppRuntimeLocator'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('shutdown aborts an in-flight library probe and settles the check', async () => {
  let librarySignal: AbortSignal | undefined
  const checker = new DevelopmentEnvironmentChecker(locator(), async (_file, args, signal) => {
    if (!args.join(' ').includes('whisperx')) return
    librarySignal = signal
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const checking = checker.check()
  await vi.waitFor(() => expect(librarySignal).toBeDefined())
  await checker.shutdown()
  expect(librarySignal!.aborted).toBe(true)
  expect(await checking).toMatchObject({ ready: false, libraries: false, checking: [] })
})

test('a late resource read after shutdown never starts new runtime probes', async () => {
  const probe = vi.fn(async () => {})
  const checker = new DevelopmentEnvironmentChecker(locator(), probe)
  await checker.shutdown()
  expect(await checker.check()).toMatchObject({ ready: false, checking: [] })
  expect(probe).not.toHaveBeenCalled()
})

test('shutdown terminates real child processes owned by the default probe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'redencut-runtime-probes-'))
  const executable = join(directory, 'probe')
  await writeFile(
    executable,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(directory)} + '/' + process.pid, ''); setInterval(() => {}, 1000)\n`,
    { mode: 0o755 },
  )
  const runtime = locator()
  for (const method of [
    'getFfmpegPath',
    'getFfprobePath',
    'getWhisperExecutablePath',
    'getUvPath',
    'getSpeechPythonPath',
  ] as const)
    vi.mocked(runtime[method]).mockReturnValue(executable)
  const checker = new DevelopmentEnvironmentChecker(runtime)
  const checking = checker.check()
  const childPids = async () =>
    (await readdir(directory)).filter((name) => /^\d+$/.test(name)).map(Number)
  try {
    await vi.waitFor(async () => expect(await childPids()).toHaveLength(5))
    await checker.shutdown()
    expect(await checking).toMatchObject({ ready: false })
    await vi.waitFor(async () => {
      for (const pid of await childPids()) expect(() => process.kill(pid, 0)).toThrow()
    })
  } finally {
    for (const pid of await childPids()) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* The owned child already exited. */
      }
    }
    await checking
    await rm(directory, { recursive: true, force: true })
  }
})
