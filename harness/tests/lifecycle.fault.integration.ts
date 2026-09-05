import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { ElectronSession } from '../runtime/ElectronSession'
import { readProcessIdentity, sameProcess } from '../runtime/processIdentity'

const options = { repositoryRoot: resolve('.'), outputRoot: resolve('.harness-runs') }

test('reports an owned application crash and keeps evidence available for an explicit restart', async () => {
  const runtime = new HarnessRuntime(options)
  try {
    const first = await runtime.start()
    process.kill(first.pid!, 'SIGKILL')
    await expect.poll(() => runtime.status().state, { timeout: 10_000 }).toBe('failed')
    await expect(
      runtime.callUiTool(
        'browser_snapshot',
        {},
        { runId: first.runId!, generation: first.generation },
      ),
    ).rejects.toThrow('APPLICATION_NOT_READY')
    const restarted = await runtime.restart({ discardUnsaved: true })
    expect(restarted.state).toBe('ready')
    expect(restarted.generation).toBe(first.generation + 1)
    expect(runtime.listArtifacts().some((item) => item.path.endsWith('events.jsonl'))).toBe(true)
  } finally {
    await runtime.shutdown()
  }
}, 90_000)

test('fails bounded renderer readiness with its startup stage and closes the unready application', async () => {
  const runtime = new HarnessRuntime({
    ...options,
    readinessTimeoutMs: 50,
    applicationEntry: resolve('harness/tests/fixtures/minimal-electron.cjs'),
  })
  try {
    await expect(runtime.start()).rejects.toThrow()
    expect(runtime.status().state).toBe('failed')
    expect(runtime.status().stage).toBe('renderer-ready')
    expect(runtime.status().error).toBeTruthy()
  } finally {
    await runtime.shutdown()
  }
})

test('joins a launch already in flight when the host shuts down', async () => {
  const runtime = new HarnessRuntime(options)
  const starting = runtime.start().catch((error: unknown) => error)
  await expect.poll(() => runtime.status().stage, { timeout: 5000 }).toBe('launch')
  await runtime.shutdown()
  await starting
  expect(runtime.status().state).toBe('stopped')
  expect(runtime.status().pid).toBeUndefined()
})

test('quarantines an uncertain UI timeout instead of replaying the call or accepting more UI work', async () => {
  const runtime = new HarnessRuntime({ ...options, uiTimeoutMs: 200 })
  try {
    const started = await runtime.start()
    const identity = { runId: started.runId!, generation: started.generation }
    await runtime.callUiTool('browser_snapshot', {}, identity)
    await expect(
      runtime.callUiTool('browser_click', { target: 'button:has-text("Export")' }, identity),
    ).rejects.toThrow('UI_CALL_TIMEOUT')
    expect(runtime.status().state).toBe('failed')
    await expect(runtime.callUiTool('browser_snapshot', {}, identity)).rejects.toThrow(
      'APPLICATION_NOT_READY',
    )
    await expect(runtime.restart({})).rejects.toThrow('UNSAVED_STATE_UNKNOWN')
    const events = await readFile(
      join(started.runDirectory!, 'generation-1', 'events.jsonl'),
      'utf8',
    )
    expect(
      events
        .split('\n')
        .filter((line) => line.includes('tool-start') && line.includes('browser_click')),
    ).toHaveLength(1)
  } finally {
    await runtime.shutdown()
  }
}, 60_000)

test('retains ownership after a close failure so an explicit retry can clean up the same application', async () => {
  const runtime = new HarnessRuntime(options)
  const started = await runtime.start()
  const processIdentity = readProcessIdentity(started.pid!)
  const close = vi
    .spyOn(ElectronSession.prototype, 'close')
    .mockRejectedValueOnce(new Error('simulated-close-failure'))
  try {
    await expect(runtime.stop()).rejects.toThrow('simulated-close-failure')
    expect(runtime.status().state).toBe('failed')
    close.mockRestore()
    await runtime.stop({ discardUnsaved: true })
    expect(readProcessIdentity(started.pid!)).toBeNull()
  } finally {
    close.mockRestore()
    await runtime.shutdown()
    if (processIdentity && sameProcess(processIdentity, readProcessIdentity(processIdentity.pid)))
      process.kill(processIdentity.pid, 'SIGKILL')
  }
}, 60_000)
