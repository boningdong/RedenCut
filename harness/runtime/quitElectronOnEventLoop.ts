import type { ChildProcess } from 'node:child_process'
import type { ElectronApplication } from 'playwright'
import { deadline } from './deadline'

export async function quitElectronOnEventLoop(
  application: ElectronApplication,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  await deadline(
    application.evaluate(({ app }) => {
      // Inspector evaluation can interrupt native BrowserWindow construction on macOS.
      // Let native initialization unwind before quitting on the normal event loop.
      setImmediate(() => app.quit())
    }),
    timeoutMs,
    'ELECTRON_QUIT_REQUEST_TIMEOUT',
  )
  if (child.exitCode === null && child.signalCode === null) {
    await deadline(
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      timeoutMs,
      'ELECTRON_CLOSE_TIMEOUT',
    )
  }
}
