import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { deadline } from '../runtime/deadline'
import { ElectronSession } from '../runtime/ElectronSession'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { PlaywrightMcpAdapter } from '../ui/PlaywrightMcpAdapter'
import { readProcessIdentity } from '../runtime/processIdentity'
import { RunArtifacts } from '../artifacts/RunArtifacts'

const options = { repositoryRoot: resolve('.'), outputRoot: resolve('.harness-runs') }

test('bounds renderer readiness including a Main diagnostic that never settles', async () => {
  const artifacts = new RunArtifacts(options.outputRoot, options.repositoryRoot)
  const session = await ElectronSession.launch(
    options.repositoryRoot,
    artifacts,
    1,
    10_000,
    () => {},
  )
  try {
    await session.waitUntilReady(10_000)
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const diagnostics = ElectronSession.prototype.diagnostics
    const observation = vi
      .spyOn(ElectronSession.prototype, 'diagnostics')
      .mockImplementationOnce(async function (this: ElectronSession) {
        await blocked
        return diagnostics.call(this)
      })
    try {
      await expect(deadline(session.waitUntilReady(50), 1000, 'TEST_DEADLINE')).rejects.toThrow(
        'READINESS_TIMEOUT',
      )
    } finally {
      release()
      observation.mockRestore()
    }
  } finally {
    await session.close(5000)
  }
})

test('does not report ready when Electron crashes while the UI adapter is being created', async () => {
  const runtime = new HarnessRuntime(options)
  let session!: ElectronSession
  let reportCrash!: () => void
  const crashed = new Promise<void>((resolve) => {
    reportCrash = resolve
  })
  const launch = ElectronSession.launch
  const launching = vi.spyOn(ElectronSession, 'launch').mockImplementation(async (...args) => {
    const onCrash = args[4]
    args[4] = () => {
      onCrash()
      reportCrash()
    }
    session = await launch(...args)
    return session
  })
  const create = PlaywrightMcpAdapter.create
  const creating = vi
    .spyOn(PlaywrightMcpAdapter, 'create')
    .mockImplementationOnce(async (...args) => {
      const adapter = await create(...args)
      session.child.kill('SIGKILL')
      await crashed
      return adapter
    })
  try {
    await expect(runtime.start()).rejects.toThrow('APPLICATION_CRASHED')
    expect(runtime.status().state).toBe('failed')
  } finally {
    launching.mockRestore()
    creating.mockRestore()
    await runtime.shutdown()
  }
})

test('bounds UI adapter creation and disposes an adapter that completes after the timeout', async () => {
  const runtime = new HarnessRuntime({ ...options, startupTimeoutMs: 1000 })
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let adapter!: PlaywrightMcpAdapter
  const create = PlaywrightMcpAdapter.create
  const creating = vi
    .spyOn(PlaywrightMcpAdapter, 'create')
    .mockImplementationOnce(async (...args) => {
      adapter = await create(...args)
      await blocked
      return adapter
    })
  const starting = runtime.start()
  try {
    await expect(deadline(starting, 3000, 'TEST_DEADLINE')).rejects.toThrow('UI_ADAPTER_TIMEOUT')
    expect(runtime.status().state).toBe('failed')
    expect(readProcessIdentity(runtime.status().pid!)).toBeNull()
    release()
    await expect
      .poll(async () => {
        try {
          await adapter.listTools()
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
  } finally {
    release()
    await starting.catch(() => {})
    creating.mockRestore()
    await adapter?.close()
    await runtime.shutdown()
  }
})
