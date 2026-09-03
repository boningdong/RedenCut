import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'

export interface ToolBackend {
  listTools(): Promise<Tool[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>
}
