import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ToolBackend } from './ToolBackend'

export function createMcpFacade(backend: ToolBackend): Server {
  const server = new Server(
    { name: 'riffcut-harness', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await backend.listTools(),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    backend.callTool(request.params.name, request.params.arguments ?? {}, extra.signal),
  )
  return server
}
