import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { ElectronSession } from '../runtime/ElectronSession'
import { RunArtifacts } from '../artifacts/RunArtifacts'

const options = { repositoryRoot: resolve('.'), outputRoot: resolve('.harness-runs') }

test('uses upstream built-app automation defaults rather than bypassing initialization with an executable override', async () => {
  const artifacts = new RunArtifacts(options.outputRoot, options.repositoryRoot)
  const session = await ElectronSession.launch(
    options.repositoryRoot,
    artifacts,
    1,
    10_000,
    () => {},
  )
  try {
    const switches = await session.application.evaluate(({ app }) => ({
      backgroundTimersDisabled: app.commandLine.hasSwitch('disable-background-timer-throttling'),
      backgroundWindowsDisabled: app.commandLine.hasSwitch(
        'disable-backgrounding-occluded-windows',
      ),
    }))
    expect(switches).toEqual({ backgroundTimersDisabled: true, backgroundWindowsDisabled: true })
    await session.waitUntilReady(5000)
  } finally {
    await session.close(5000)
  }
})
