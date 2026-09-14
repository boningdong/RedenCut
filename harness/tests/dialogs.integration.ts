import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, test } from 'vitest'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { RuntimeToolBackend } from '../mcp/RuntimeToolBackend'

test('dialog preparation is generation-bound, recorded on rejection and cleared on restart', async () => {
  const runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
  })
  const backend = new RuntimeToolBackend(runtime)
  try {
    const started = await runtime.start()
    const identity = { runId: started.runId!, generation: started.generation }
    const request = { purpose: 'import-audio', selection: { type: 'cancel' } } as const
    await runtime.prepareDialog(request, identity)
    const pending = join(started.runDirectory!, 'generation-1/dialogs/pending.json')
    expect(existsSync(pending)).toBe(true)
    await expect(runtime.prepareDialog(request, identity)).rejects.toThrow(
      'DIALOG_ALREADY_PREPARED',
    )
    const events = readFileSync(join(started.runDirectory!, 'generation-1/events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      events.some(
        (event) =>
          event.kind === 'dialog-preparation-rejected' &&
          event.data.error.includes('DIALOG_ALREADY_PREPARED'),
      ),
    ).toBe(true)
    const restarted = await runtime.restart({})
    expect(existsSync(pending)).toBe(false)
    const stale = await backend.callTool('redencut_prepare_dialog', { ...identity, request })
    expect(stale.structuredContent).toMatchObject({ error: { code: 'STALE_GENERATION' } })
    const current = { runId: restarted.runId!, generation: restarted.generation }
    await runtime.callUiTool('browser_snapshot', {}, current)
    await runtime.callUiTool('browser_click', { target: 'button:text-is("Set up later")' }, current)
    await runtime.callUiTool('browser_click', { target: 'button:text-is("+ Add Track")' }, current)
    await expect
      .poll(
        async () =>
          (await runtime.readDiagnostics(current)).dialogs?.some(
            (event) => event.state === 'rejected' && event.error?.includes('DIALOG_NOT_PREPARED'),
          ),
        { timeout: 5000 },
      )
      .toBe(true)
    expect((await runtime.readDiagnostics(current)).renderer.tracks).toEqual([])
    await runtime.prepareDialog(request, current)
    await runtime.callUiTool('browser_click', { target: 'button:text-is("+ Add Track")' }, current)
    await expect
      .poll(
        async () =>
          (await runtime.readDiagnostics(current)).dialogs?.some(
            (event) => event.state === 'consumed',
          ),
        { timeout: 5000 },
      )
      .toBe(true)
    expect((await runtime.readDiagnostics(current)).renderer.dirty).toBe(false)
    await runtime.stop()
  } finally {
    await runtime.shutdown()
  }
})
