import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { join, resolve } from 'node:path'
import { createMcpFacade } from './mcp/createMcpFacade'
import { RuntimeToolBackend } from './mcp/RuntimeToolBackend'
import { HarnessRuntime } from './runtime/HarnessRuntime'

const repositoryRoot = resolve(__dirname, '..')
const runtime = new HarnessRuntime({
  repositoryRoot,
  outputRoot: join(repositoryRoot, '.harness-runs'),
})
const server = createMcpFacade(new RuntimeToolBackend(runtime))
let closing: Promise<void> | undefined

function shutdown(exitCode = 0): Promise<void> {
  closing ??= (async () => {
    try {
      await runtime.shutdown()
      await server.close()
    } catch (error) {
      console.error('Harness shutdown failed:', String(error))
      exitCode = 1
    } finally {
      process.exit(exitCode)
    }
  })()
  return closing
}

server.onclose = () => {
  void shutdown()
}
server.onerror = (error) => console.error('MCP protocol error:', error.message)
process.stdin.once('end', () => {
  void shutdown()
})
process.stdin.once('error', () => {
  void shutdown(1)
})
process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})
void server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error('Harness MCP startup failed:', String(error))
  void shutdown(1)
})
