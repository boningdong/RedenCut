import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { RuntimeToolBackend } from '../mcp/RuntimeToolBackend'
import { HarnessRuntime } from '../runtime/HarnessRuntime'

function backend() {
  const runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
  })
  // Orphan inspection has dedicated tests; catalog tests must not scan retained local runs.
  vi.spyOn(runtime, 'inspectOrphans').mockReturnValue([])
  return new RuntimeToolBackend(runtime)
}

test('publishes lifecycle and curated official UI schemas before launch without a browser', async () => {
  const tools = await backend().listTools()
  expect(tools.map((tool) => tool.name)).toContain('podcut_start')
  expect(tools.map((tool) => tool.name)).toContain('browser_click')
  expect(tools.map((tool) => tool.name)).not.toContain('browser_evaluate')
  expect(tools.map((tool) => tool.name)).not.toContain('browser_close')
  expect(tools.map((tool) => tool.name)).not.toContain('browser_navigate')
  const screenshot = tools.find((tool) => tool.name === 'browser_take_screenshot')!
  expect(screenshot.inputSchema.required).toEqual(expect.arrayContaining(['runId', 'generation']))
  expect(screenshot.inputSchema.properties).not.toHaveProperty('filename')
})

test('rejects unlisted tools and hidden upstream overrides instead of forwarding them', async () => {
  const service = backend()
  for (const [name, args] of [
    ['browser_evaluate', { function: '() => process.env' }],
    ['browser_snapshot', { runId: 'run', generation: 1, _meta: { cwd: '/' } }],
    ['browser_take_screenshot', { runId: 'run', generation: 1, filename: '/tmp/unowned.png' }],
    ['podcut_start', { outputRoot: '/tmp/unowned' }],
  ] as const) {
    expect((await service.callTool(name, args)).isError).toBe(true)
  }
})

test('returns actionable not-ready state rather than launching implicitly', async () => {
  const service = backend()
  const result = await service.callTool('browser_snapshot', { runId: 'run', generation: 1 })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('APPLICATION_NOT_READY')
  const status = await service.callTool('podcut_status', {})
  expect(status.structuredContent).toMatchObject({ state: 'idle' })
})
