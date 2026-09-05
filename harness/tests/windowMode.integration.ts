import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { HarnessRuntime } from '../runtime/HarnessRuntime'
import { ElectronSession } from '../runtime/ElectronSession'
import { RuntimeToolBackend } from '../mcp/RuntimeToolBackend'

test('MCP background mode stays visible and unfocused through actions and restart', async () => {
  const runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
  })
  const backend = new RuntimeToolBackend(runtime)
  let session!: ElectronSession
  const launch = ElectronSession.launch
  vi.spyOn(ElectronSession, 'launch').mockImplementation(async (...args) => {
    session = await launch(...args)
    return session
  })
  const observe = async () => {
    expect(
      await session.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          visible: w.isVisible(),
          focused: w.isFocused(),
          focusable: w.isFocusable(),
        })),
      ),
    ).toEqual([{ visible: true, focused: false, focusable: false }])
  }
  try {
    const start = await backend.callTool('podcut_start', { windowMode: 'background' })
    expect(start.isError).not.toBe(true)
    expect(runtime.status().windowMode).toBe('background')
    for (let generation = 1; generation <= 2; generation++) {
      const identity = { runId: runtime.status().runId, generation }
      await observe()
      for (const [name, args] of [
        ['browser_snapshot', {}],
        ['browser_click', { target: 'button:has-text("☀"), button:has-text("🌙")' }],
        ['browser_press_key', { key: 'Tab' }],
        ['browser_take_screenshot', { type: 'png' }],
      ] as const) {
        const result = await backend.callTool(name, { ...identity, ...args })
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
        await observe()
      }
      if (generation === 1) {
        expect((await backend.callTool('podcut_restart', identity)).isError).not.toBe(true)
        expect(runtime.status().windowMode).toBe('background')
      }
    }
    const identity = { runId: runtime.status().runId, generation: runtime.status().generation }
    for (const label of ['Open Project', 'Import Audio', 'Save As']) {
      const page = await session.application.firstWindow()
      await page.reload()
      await backend.callTool('browser_snapshot', identity)
      expect(await page.locator('body').textContent()).not.toContain('FOREGROUND_REQUIRED')
      expect(
        (
          await backend.callTool('browser_click', {
            ...identity,
            target: `button:text-is("${label}")`,
          })
        ).isError,
      ).not.toBe(true)
      await expect
        .poll(async () =>
          (await page.locator('body').textContent())?.includes('FOREGROUND_REQUIRED'),
        )
        .toBe(true)
      await observe()
    }
  } finally {
    vi.restoreAllMocks()
    await runtime.shutdown()
  }
})
