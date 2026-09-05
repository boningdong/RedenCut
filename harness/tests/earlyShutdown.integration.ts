import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { RunArtifacts } from '../artifacts/RunArtifacts'
import { ElectronSession } from '../runtime/ElectronSession'

test('closes during startup without a native crash or forced termination', async () => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const artifacts = new RunArtifacts(resolve('.harness-runs'), resolve('.'))
    const session = await ElectronSession.launch(resolve('.'), artifacts, 1, 10_000, () => {})
    try {
      await session.close(5000)
      expect(session.child.signalCode, artifacts.directory).toBeNull()
      expect(session.child.exitCode, artifacts.directory).toBe(0)
    } finally {
      await session.close(5000)
    }
  }
}, 60_000)
