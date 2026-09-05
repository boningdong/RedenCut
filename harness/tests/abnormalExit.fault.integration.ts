import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { RunArtifacts } from '../artifacts/RunArtifacts'
import { ElectronSession } from '../runtime/ElectronSession'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { TraceRecorder } from '../artifacts/TraceRecorder'

test.each(['before-close', 'during-close'] as const)(
  'reports a nonzero Electron exit %s instead of a successful stop',
  async (timing) => {
    const artifacts = new RunArtifacts(resolve('.harness-runs'), resolve('.'))
    const session = await ElectronSession.launch(resolve('.'), artifacts, 1, 10_000, () => {})
    const evaluate = session.application.evaluate.bind(session.application)
    try {
      await session.waitUntilReady(10_000)
      const exit = () =>
        evaluate(({ app }) => {
          setImmediate(() => app.exit(17))
        })
      if (timing === 'before-close') {
        await exit()
        await expect.poll(() => session.child.exitCode).toBe(17)
      } else {
        vi.spyOn(session.application, 'evaluate').mockImplementationOnce(exit)
      }
      await expect(session.close(5000)).rejects.toThrow('ELECTRON_ABNORMAL_EXIT: 17')
      await expect(session.close(5000, true)).resolves.toBeUndefined()
    } finally {
      vi.restoreAllMocks()
      await session.close(5000, true)
    }
  },
)

test('does not report stopped when Electron exits abnormally during trace cleanup', async () => {
  const runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
  })
  const launch = ElectronSession.launch
  let session!: ElectronSession
  vi.spyOn(ElectronSession, 'launch').mockImplementationOnce(async (...args) => {
    session = await launch(...args)
    return session
  })
  try {
    await runtime.start()
    const stopTrace = TraceRecorder.prototype.stop
    vi.spyOn(TraceRecorder.prototype, 'stop').mockImplementationOnce(async function (
      this: TraceRecorder,
      timeoutMs,
    ) {
      await session.application.evaluate(({ app }) => {
        setImmediate(() => app.exit(17))
      })
      await expect.poll(() => session.child.exitCode).toBe(17)
      await stopTrace.call(this, timeoutMs)
    })
    await expect(runtime.stop()).rejects.toThrow('ELECTRON_ABNORMAL_EXIT: 17')
    expect(runtime.status().state).toBe('failed')
    await expect(runtime.stop({ discardUnsaved: true })).resolves.toMatchObject({
      state: 'stopped',
    })
  } finally {
    vi.restoreAllMocks()
    await runtime.shutdown()
  }
})
