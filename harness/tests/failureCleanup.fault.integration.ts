import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { RunArtifacts } from '../artifacts/RunArtifacts'
import { ElectronSession } from '../runtime/ElectronSession'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { readProcessIdentity, sameProcess } from '../runtime/processIdentity'
import type { ProcessIdentity } from '../runtime/processIdentity'

const options = { repositoryRoot: resolve('.'), outputRoot: resolve('.harness-runs') }

function cleanUpTestProcess(identity: ProcessIdentity | null): void {
  if (identity && sameProcess(identity, readProcessIdentity(identity.pid)))
    process.kill(identity.pid, 'SIGKILL')
}

test('closes a launched application if persisting its ownership fails before returning the session', async () => {
  const runtime = new HarnessRuntime(options)
  let application: ProcessIdentity | null = null
  const update = RunArtifacts.prototype.update
  const writing = vi.spyOn(RunArtifacts.prototype, 'update').mockImplementation(function (
    this: RunArtifacts,
    patch,
  ) {
    if (patch.application) {
      application = patch.application as ProcessIdentity
      throw new Error('simulated-ownership-write-failure')
    }
    update.call(this, patch)
  })
  try {
    await expect(runtime.start()).rejects.toThrow('simulated-ownership-write-failure')
    expect(application).not.toBeNull()
    await expect.poll(() => readProcessIdentity(application!.pid), { timeout: 2000 }).toBeNull()
  } finally {
    writing.mockRestore()
    await runtime.shutdown()
    cleanUpTestProcess(application)
  }
})

test('host shutdown still closes its application when all artifact writes fail', async () => {
  const runtime = new HarnessRuntime(options)
  const started = await runtime.start()
  const application = readProcessIdentity(started.pid!)
  const writing = vi.spyOn(RunArtifacts.prototype, 'update').mockImplementation(() => {
    throw new Error('simulated-disk-full')
  })
  const recording = vi.spyOn(RunArtifacts.prototype, 'record').mockImplementation(() => {
    throw new Error('simulated-disk-full')
  })
  try {
    await runtime.shutdown()
    expect(runtime.status().state).toBe('stopped')
    expect(readProcessIdentity(started.pid!)).toBeNull()
  } finally {
    writing.mockRestore()
    recording.mockRestore()
    await runtime.shutdown()
    cleanUpTestProcess(application)
  }
})

test('forced Electron close is not prevented by a failed evidence write', async () => {
  const artifacts = new RunArtifacts(options.outputRoot, options.repositoryRoot)
  const session = await ElectronSession.launch(
    options.repositoryRoot,
    artifacts,
    1,
    10_000,
    () => {},
  )
  const identity = readProcessIdentity(session.child.pid!)
  const closing = vi
    .spyOn(session.application, 'evaluate')
    .mockRejectedValue(new Error('simulated-close-timeout'))
  const recording = vi.spyOn(artifacts, 'record').mockImplementation(() => {
    throw new Error('simulated-disk-full')
  })
  try {
    await session.close(2000)
    expect(readProcessIdentity(session.child.pid!)).toBeNull()
  } finally {
    closing.mockRestore()
    recording.mockRestore()
    await session.close(2000)
    cleanUpTestProcess(identity)
  }
})
