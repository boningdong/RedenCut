import { appendFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Page } from 'playwright'
import { vi } from 'vitest'
import { HarnessRuntime } from '../../harness/runtime/HarnessRuntime'
import { RuntimeToolBackend } from '../../harness/mcp/RuntimeToolBackend'
import { createMcpFacade } from '../../harness/mcp/createMcpFacade'
import { PlaywrightMcpAdapter } from '../../harness/ui/PlaywrightMcpAdapter'
import type { RuntimeStatus } from '../../harness/runtime/runtime.types'

/** Real MCP actions; the same Page is observed only for visible UI assertions. */
export class McpTestSession {
  private readonly runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
  })
  private readonly server = createMcpFacade(new RuntimeToolBackend(this.runtime))
  private readonly client = new Client({ name: 'podcut-visible-e2e', version: '1.0.0' })
  private observer: ReturnType<typeof vi.spyOn> | undefined
  private currentPage: Page | undefined
  private identity: { runId: string; generation: number } | undefined
  directory = ''

  get page(): Page {
    if (!this.currentPage) throw new Error('UI_NOT_ATTACHED')
    return this.currentPage
  }

  async start(): Promise<void> {
    const create = PlaywrightMcpAdapter.create.bind(PlaywrightMcpAdapter)
    // Observe the existing shared Context without replacing the real adapter or opening CDP.
    this.observer = vi
      .spyOn(PlaywrightMcpAdapter, 'create')
      .mockImplementation(async (getContext, outputDir) => {
        this.currentPage = (await getContext()).pages()[0]
        return create(getContext, outputDir)
      })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await this.server.connect(serverTransport)
    await this.client.connect(clientTransport)
    this.adopt((await this.call('podcut_start')).structuredContent as unknown as RuntimeStatus)
    console.error(`Visible UI E2E evidence: ${this.directory}`)
    await this.call('browser_snapshot')
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    const result = (await this.client.callTool(
      { name, arguments: { ...this.identity, ...args } },
      undefined,
      { timeout: 60_000 },
    )) as CallToolResult
    if (this.directory)
      appendFileSync(
        join(this.directory, 'ui-actions.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), name, args, failed: result.isError ?? false })}\n`,
      )
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`)
    return result
  }

  async restart(): Promise<void> {
    this.adopt((await this.call('podcut_restart')).structuredContent as unknown as RuntimeStatus)
    await this.call('browser_snapshot')
  }

  private adopt(status: RuntimeStatus): void {
    this.identity = { runId: status.runId!, generation: status.generation }
    this.directory = status.runDirectory!
  }

  async screenshot(label: string): Promise<void> {
    const result = await this.call('browser_take_screenshot', { type: 'png' })
    const image = result.content.find((item) => item.type === 'image')
    if (!image) throw new Error('SCREENSHOT_MISSING')
    writeFileSync(join(this.directory, `${label}.png`), Buffer.from(image.data, 'base64'))
  }

  async close(): Promise<void> {
    try {
      await this.runtime.shutdown()
    } finally {
      try {
        await this.client.close()
      } finally {
        try {
          await this.server.close()
        } finally {
          this.observer?.mockRestore()
        }
      }
    }
  }
}
