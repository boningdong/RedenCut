import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { ElectronSession } from '../runtime/ElectronSession'

test('explicit foreground mode shows an activatable window and persists after restart', async () => {
  const runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
  })
  let session!: ElectronSession
  const launch = ElectronSession.launch
  vi.spyOn(ElectronSession, 'launch').mockImplementation(async (...args) => {
    session = await launch(...args)
    return session
  })
  try {
    await runtime.start({ windowMode: 'foreground' })
    for (let generation = 1; generation <= 2; generation++) {
      expect(runtime.status().windowMode).toBe('foreground')
      await expect
        .poll(() =>
          session.application.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0]
            return w.isVisible() && w.isFocusable() && w.isFocused()
          }),
        )
        .toBe(true)
      if (generation === 1) await runtime.restart({})
    }
  } finally {
    vi.restoreAllMocks()
    await runtime.shutdown()
  }
})
