import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { RuntimeToolBackend } from '../mcp/RuntimeToolBackend'
import { HarnessRuntime } from '../runtime/HarnessRuntime'

const outputRoots: string[] = []
afterEach(() => {
  for (const directory of outputRoots.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function backend() {
  // Real status inspection must not depend on accumulated developer run artifacts.
  const outputRoot = mkdtempSync(join(tmpdir(), 'redencut-backend-test-'))
  outputRoots.push(outputRoot)
  return new RuntimeToolBackend(new HarnessRuntime({ repositoryRoot: resolve('.'), outputRoot }))
}

test('publishes lifecycle and curated official UI schemas before launch without a browser', async () => {
  const tools = await backend().listTools()
  expect(tools.map((tool) => tool.name)).toContain('redencut_start')
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
    ['redencut_start', { outputRoot: '/tmp/unowned' }],
  ] as const) {
    expect((await service.callTool(name, args)).isError).toBe(true)
  }
})

test('returns actionable not-ready state rather than launching implicitly', async () => {
  const service = backend()
  const result = await service.callTool('browser_snapshot', { runId: 'run', generation: 1 })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('APPLICATION_NOT_READY')
  const status = await service.callTool('redencut_status', {})
  expect(status.structuredContent).toMatchObject({ state: 'idle' })
})

test('rejects stale dialog identities and mismatched selection shapes without starting', async () => {
  const service = backend()
  const stale = await service.callTool('redencut_prepare_dialog', {
    runId: 'old',
    generation: 1,
    request: { purpose: 'import-audio', selection: { type: 'file', filename: 'voice.wav' } },
  })
  expect(stale.structuredContent).toMatchObject({ error: { code: 'STALE_GENERATION' } })
  const wrongShape = await service.callTool('redencut_prepare_dialog', {
    runId: 'old',
    generation: 1,
    request: { purpose: 'import-audio', selection: { type: 'project', name: 'project.redencut' } },
  })
  expect(wrongShape.isError).toBe(true)
  expect((await service.callTool('redencut_status', {})).structuredContent).toMatchObject({
    state: 'idle',
  })
})
