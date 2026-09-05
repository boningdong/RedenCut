import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from 'vitest'
import type { RuntimeStatus } from '../runtime/runtime.types'
import { electronEnvironment } from '../runtime/electronEnvironment'

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', resolve('harness/server.ts')],
    cwd: resolve('.'),
    env: electronEnvironment(process.env),
    stderr: 'pipe',
  })
  const client = new Client({ name: 'podcut-stdio-test', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport }
}

function statusOf(result: CallToolResult): RuntimeStatus {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
  return result.structuredContent as unknown as RuntimeStatus
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('exposes real lifecycle and UI tools through one stdio MCP and closes Electron on client disconnect', async () => {
  const { client } = await connect()
  let status: RuntimeStatus | undefined
  try {
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain('podcut_start')
    expect(tools.tools.map((tool) => tool.name)).toContain('browser_snapshot')
    status = statusOf(
      (await client.callTool({ name: 'podcut_start', arguments: {} })) as CallToolResult,
    )
    const identity = { runId: status.runId!, generation: status.generation }
    const snapshot = (await client.callTool({
      name: 'browser_snapshot',
      arguments: identity,
    })) as CallToolResult
    expect(snapshot.isError).not.toBe(true)
    const screenshot = (await client.callTool({
      name: 'browser_take_screenshot',
      arguments: { ...identity, type: 'png' },
    })) as CallToolResult
    expect(screenshot.content.some((item) => item.type === 'image')).toBe(true)
    const restarted = statusOf(
      (await client.callTool({ name: 'podcut_restart', arguments: identity })) as CallToolResult,
    )
    expect(restarted.generation).toBe(status.generation + 1)
    status = restarted
  } finally {
    await client.close()
  }
  if (status?.pid) {
    await expect.poll(() => alive(status!.pid!), { timeout: 10_000 }).toBe(false)
    const manifest = JSON.parse(await readFile(join(status.runDirectory!, 'manifest.json'), 'utf8'))
    expect(manifest.status.state).toBe('stopped')
  }
}, 90_000)
