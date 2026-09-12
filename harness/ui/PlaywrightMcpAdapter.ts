import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createConnection } from '@playwright/mcp'
import type { BrowserContext } from 'playwright'
import type { ToolBackend } from '../mcp/ToolBackend'

export class PlaywrightMcpAdapter implements ToolBackend {
  private closed = false

  private constructor(
    private readonly client: Client,
    private readonly server: Server,
  ) {}

  static async create(
    getContext: () => Promise<BrowserContext>,
    outputDir: string,
  ): Promise<PlaywrightMcpAdapter> {
    const server = await createConnection(
      {
        browser: { isolated: false },
        outputDir,
        imageResponses: 'allow',
        saveSession: false,
        capabilities: ['core', 'vision'],
        timeouts: { action: 5000, navigation: 10_000 },
      },
      getContext,
    )
    const client = new Client({ name: 'redencut-ui-adapter', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      return new PlaywrightMcpAdapter(client, server)
    } catch (error) {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
      throw error
    }
  }

  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = []
    let cursor: string | undefined
    do {
      const page = await this.client.listTools({ cursor })
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    return CallToolResultSchema.parse(
      await this.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 15_000 }),
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.client.close()
    await this.server.close()
  }
}
