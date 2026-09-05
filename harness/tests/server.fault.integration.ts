import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from 'vitest'
import type { RuntimeStatus } from '../runtime/runtime.types'
import { electronEnvironment } from '../runtime/electronEnvironment'
import { inspectOrphanRuns } from '../runtime/orphanInspection'
import { readProcessIdentity, sameProcess } from '../runtime/processIdentity'

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

test('handles SIGTERM with bounded owned-application cleanup', async () => {
  const { client, transport } = await connect()
  try {
    const status = statusOf(
      (await client.callTool({ name: 'podcut_start', arguments: {} })) as CallToolResult,
    )
    process.kill(transport.pid!, 'SIGTERM')
    await expect.poll(() => alive(status.pid!), { timeout: 15_000 }).toBe(false)
    await expect.poll(() => alive(transport.pid!), { timeout: 15_000 }).toBe(false)
  } finally {
    await client.close()
  }
}, 60_000)

test('detects a surviving owned application after host SIGKILL without automatically terminating it', async () => {
  const { client, transport } = await connect()
  let application: ReturnType<typeof readProcessIdentity> = null
  try {
    const status = statusOf(
      (await client.callTool({ name: 'podcut_start', arguments: {} })) as CallToolResult,
    )
    application = readProcessIdentity(status.pid!)
    expect(application?.command).toContain(`--podcut-harness-run-id=${status.runId}`)
    const hostPid = transport.pid!
    process.kill(hostPid, 'SIGKILL')
    await expect.poll(() => alive(hostPid), { timeout: 10_000 }).toBe(false)
    if (alive(status.pid!)) {
      const orphans = inspectOrphanRuns(resolve('.harness-runs'))
      expect(
        orphans.some(
          (orphan) => orphan.runId === status.runId && orphan.application.pid === status.pid,
        ),
      ).toBe(true)
      const observer = await connect()
      try {
        const observed = (await observer.client.callTool({
          name: 'podcut_status',
          arguments: {},
        })) as CallToolResult
        expect(JSON.stringify(observed.structuredContent)).toContain(status.runId!)
        expect(alive(status.pid!)).toBe(true)
      } finally {
        await observer.client.close()
      }
    }
  } finally {
    await client.close()
    // This test created the process; even its cleanup revalidates identity to avoid PID reuse.
    if (application && sameProcess(application, readProcessIdentity(application.pid))) {
      process.kill(application.pid, 'SIGKILL')
      await expect.poll(() => alive(application!.pid), { timeout: 10_000 }).toBe(false)
    }
  }
}, 60_000)
