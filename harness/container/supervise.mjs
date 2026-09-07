import { spawn } from 'node:child_process'

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('CONTAINER_COMMAND_REQUIRED')

// Playwright also handles SIGTERM inside the MCP process. Deliver EOF instead,
// so only Runtime owns the trace/dispose/quit sequence on container shutdown.
const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'] })
let timer
let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  process.stdin.unpipe(child.stdin)
  process.stdin.pause()
  child.stdin.end()
  timer = setTimeout(() => {
    console.error('CONTAINER_SHUTDOWN_TIMEOUT: command did not exit after EOF.')
    process.exit(1)
  }, 15_000)
}

process.stdin.pipe(child.stdin, { end: false })
// Non-interactive commands such as test runners may keep working after EOF.
// Only an explicit stop request imposes the supervisor's shutdown deadline.
process.stdin.once('end', () => child.stdin.end())
process.stdin.once('error', shutdown)
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
child.stdin.on('error', (error) => {
  if (error.code !== 'EPIPE') console.error('Container input error:', error.message)
})
child.once('error', (error) => {
  console.error('Container command failed:', error.message)
  process.exit(1)
})
child.once('close', (code, signal) => {
  clearTimeout(timer)
  if (signal) console.error('Container command exited by signal:', signal)
  process.exit(code ?? 1)
})
