import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { _electron } from 'playwright'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from 'vitest'
import { createMcpFacade } from '../mcp/createMcpFacade'
import { PlaywrightMcpAdapter } from '../ui/PlaywrightMcpAdapter'
import { electronEnvironment } from '../runtime/electronEnvironment'
import { deadline } from '../runtime/deadline'
import { quitElectronOnEventLoop } from '../runtime/quitElectronOnEventLoop'

function resultText(result: CallToolResult): string {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

test('forwards official MCP UI actions and images without transferring Electron ownership', async () => {
  const outputRoot = resolve('.harness-runs')
  await mkdir(outputRoot, { recursive: true })
  const outputDir = await mkdtemp(join(outputRoot, 'compatibility-'))
  const env = electronEnvironment({ ...process.env, SECRET_TOKEN: 'sentinel-do-not-record' })
  env.REDENCUT_HARNESS_RUN_DIRECTORY = outputDir
  const application = await _electron.launch({
    args: [resolve('harness/tests/fixtures/minimal-electron.cjs')],
    env,
    timeout: 20_000,
  })
  const child = application.process()
  let adapter: PlaywrightMcpAdapter | undefined
  let failure: unknown
  const client = new Client({ name: 'redencut-gate-a', version: '1.0.0' })
  try {
    expect(
      await deadline(
        application.evaluate(async ({ app }) => {
          await app.whenReady()
          return app.isReady()
        }),
        10_000,
        'MAIN_READY_TIMEOUT',
      ),
    ).toBe(true)
    const page = await application.firstWindow({ timeout: 10_000 })
    await page.getByRole('heading', { name: 'Harness probe' }).waitFor()
    await application.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    adapter = await PlaywrightMcpAdapter.create(async () => application.context(), outputDir)
    const facade = createMcpFacade(adapter)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await facade.connect(serverTransport)
    await client.connect(clientTransport)
    const catalog = await client.listTools()
    expect(catalog.tools.map((tool) => tool.name)).toContain('browser_snapshot')
    const snapshot = resultText(
      (await client.callTool({ name: 'browser_snapshot', arguments: {} })) as CallToolResult,
    )
    const reference = snapshot.match(/button "Increment"[^\n]*\[ref=([^\]]+)\]/)?.[1]
    expect(reference).toBeTruthy()
    const clicked = (await client.callTool({
      name: 'browser_click',
      arguments: { target: reference, element: 'Increment button' },
    })) as CallToolResult
    resultText(clicked)
    expect(await page.locator('output').textContent()).toBe('1')
    const screenshot = (await client.callTool({
      name: 'browser_take_screenshot',
      arguments: { type: 'png' },
    })) as CallToolResult
    resultText(screenshot)
    const image = screenshot.content.find((item) => item.type === 'image')
    expect(image?.mimeType).toBe('image/png')
    expect(Buffer.from(image!.data, 'base64').subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    )
    expect(await application.evaluate(() => process.pid)).toBe(child.pid)
    const tracePath = join(outputDir, 'trace.zip')
    await application.context().tracing.stop({ path: tracePath })
    expect((await readFile(tracePath)).byteLength).toBeGreaterThan(1000)
    const trace = execFileSync('unzip', ['-p', tracePath, 'trace.trace'], { encoding: 'utf8' })
    expect(trace).toContain('click')
    expect(trace).not.toContain('sentinel-do-not-record')
    expect(execFileSync('unzip', ['-Z1', tracePath], { encoding: 'utf8' })).toMatch(
      /screencast\/.*\.jpeg/,
    )
    await client.close()
    await adapter.close()
    expect(await application.evaluate(({ app }) => app.isReady())).toBe(true)
    expect(await page.locator('output').textContent()).toBe('1')
    console.error(`Gate A evidence: ${outputDir}`)
  } catch (error) {
    failure = error
    console.error('Gate A failure:', error)
    console.error('Gate A observed windows:', application.windows().length)
    console.error(
      'Gate A Main state:',
      await deadline(
        application.evaluate(({ app, BrowserWindow }) => ({
          ready: app.isReady(),
          windows: BrowserWindow.getAllWindows().length,
        })),
        1000,
        'MAIN_DIAGNOSTICS_TIMEOUT',
      ).catch(String),
    )
  } finally {
    const disposal = await Promise.allSettled([
      deadline(client.close(), 5000, 'GATE_A_CLIENT_CLOSE_TIMEOUT'),
      deadline(adapter?.close() ?? Promise.resolve(), 5000, 'GATE_A_ADAPTER_CLOSE_TIMEOUT'),
    ])
    for (const result of disposal) {
      if (result.status === 'rejected') failure ??= result.reason
    }
    try {
      await quitElectronOnEventLoop(application, child, 5000)
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      failure ??= error
    }
  }
  if (failure) throw failure
  expect(child.signalCode).toBeNull()
  expect(child.exitCode).toBe(0)
}, 60_000)
