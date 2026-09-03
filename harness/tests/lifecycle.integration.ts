import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { ElectronSession } from '../runtime/ElectronSession'
import { readProcessIdentity, sameProcess } from '../runtime/processIdentity'

const options = { repositoryRoot: resolve('.'), outputRoot: resolve('.harness-runs') }

test('runs real isolated Podcut, rebuilds the UI session on restart, and retains trace and logs', async () => {
  const runtime = new HarnessRuntime(options)
  await expect(
    runtime.callUiTool('browser_snapshot', {}, { runId: 'absent', generation: 0 }),
  ).rejects.toThrow('APPLICATION_NOT_READY')
  try {
    const first = await runtime.start()
    expect(first.state).toBe('ready')
    const listeners = execFileSync(
      'lsof',
      ['-nP', '-a', '-p', String(first.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'],
      { encoding: 'utf8' },
    )
    const addresses = listeners.split('\n').filter((line) => line.startsWith('n'))
    expect(addresses.length).toBeGreaterThan(0)
    expect(addresses.every((address) => /^n(127\.0\.0\.1|\[::1\]):/.test(address))).toBe(true)
    const identity = { runId: first.runId!, generation: first.generation }
    const diagnostics = await runtime.readDiagnostics(identity)
    expect(diagnostics.main.hasSingleInstanceLock).toBe(true)
    expect(diagnostics.main.userData).toBe(join(first.runDirectory!, 'user-data'))
    expect(diagnostics.main.temporary).toBe(join(first.runDirectory!, 'temporary'))
    expect(diagnostics.renderer.ready).toBe(true)
    expect(diagnostics.renderer.dirty).toBe(false)
    await expect(runtime.callUiTool('browser_click', { target: 'e1' }, identity)).rejects.toThrow(
      'SNAPSHOT_REQUIRED',
    )
    const snapshot = await runtime.callUiTool('browser_snapshot', {}, identity)
    expect(snapshot.isError).not.toBe(true)
    const text = snapshot.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n')
    expect(text).toContain('Import your first audio file')
    const themeRef = text.match(/button "☀"[^\n]*\[ref=([^\]]+)\]/)?.[1]
    expect(themeRef).toBeTruthy()
    const clicked = await runtime.callUiTool('browser_click', { target: themeRef }, identity)
    expect(clicked.isError, JSON.stringify(clicked.content)).not.toBe(true)
    const screen = await runtime.callUiTool('browser_take_screenshot', { type: 'png' }, identity)
    expect(screen.content.some((item) => item.type === 'image')).toBe(true)
    const second = await runtime.restart({ rebuild: true })
    expect(second.state).toBe('ready')
    expect(second.runId).toBe(first.runId)
    expect(second.generation).toBe(first.generation + 1)
    expect(second.pid).not.toBe(first.pid)
    await expect(runtime.callUiTool('browser_snapshot', {}, identity)).rejects.toThrow(
      'STALE_GENERATION',
    )
    const current = { runId: second.runId!, generation: second.generation }
    await expect(
      runtime.callUiTool('browser_click', { target: themeRef }, current),
    ).rejects.toThrow('SNAPSHOT_REQUIRED')
    expect((await runtime.callUiTool('browser_snapshot', {}, current)).isError).not.toBe(true)
    expect((await runtime.stop()).state).toBe('stopped')
    const artifacts = runtime.listArtifacts()
    expect(artifacts.some((item) => item.path.endsWith('trace.zip'))).toBe(true)
    const manifest = JSON.parse(await readFile(join(first.runDirectory!, 'manifest.json'), 'utf8'))
    expect(manifest.status.state).toBe('stopped')
    const firstBuild = manifest.generations?.['1']
    const rebuilt = manifest.generations?.['2']
    expect(firstBuild).toBeDefined()
    expect(rebuilt).toBeDefined()
    expect(firstBuild.versions.electron).toBe('40.8.0')
    expect(rebuilt.checkout.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(Date.parse(rebuilt.observedAt)).toBeGreaterThan(Date.parse(firstBuild.observedAt))
    console.error(`Gate B evidence: ${first.runDirectory}`)
  } finally {
    await runtime.shutdown()
  }
}, 90_000)

test('independent isolated runs keep their own single-instance locks and closing one leaves the other alive', async () => {
  const first = new HarnessRuntime(options)
  const second = new HarnessRuntime(options)
  try {
    const a = await first.start()
    const b = await second.start()
    expect(a.runDirectory).not.toBe(b.runDirectory)
    expect(a.pid).not.toBe(b.pid)
    await first.stop()
    expect(
      (await second.readDiagnostics({ runId: b.runId!, generation: b.generation })).main
        .hasSingleInstanceLock,
    ).toBe(true)
    expect(second.status().state).toBe('ready')
  } finally {
    await first.shutdown()
    await second.shutdown()
  }
}, 90_000)

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
