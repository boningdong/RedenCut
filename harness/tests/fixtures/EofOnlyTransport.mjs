import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'

// Test transport: unlike SDK close(), EOF never escalates to TERM/KILL.
export class EofOnlyTransport {
  constructor(command, args, env) {
    this.command = command
    this.args = args
    this.env = env
    this.stderr = ''
  }

  async start() {
    this.child = spawn(this.command, this.args, { env: this.env, stdio: 'pipe' })
    this.exit = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        this.exitResult = { code, signal }
        resolve()
        this.onclose?.()
      }),
    )
    const buffer = new ReadBuffer()
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk
    })
    this.child.stdout.on('data', (chunk) => {
      try {
        buffer.append(chunk)
        let message
        while ((message = buffer.readMessage()) !== null) this.onmessage?.(message)
      } catch (error) {
        this.onerror?.(error)
      }
    })
    this.child.on('error', (error) => this.onerror?.(error))
    this.child.stdin.on('error', (error) => this.onerror?.(error))
    await once(this.child, 'spawn')
  }

  send(message) {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(serializeMessage(message), (error) =>
        error ? reject(error) : resolve(),
      )
    })
  }

  async close() {
    if (!this.child) return
    this.child.stdin.end()
    let timer
    try {
      await Promise.race([
        this.exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('EOF_CLEANUP_TIMEOUT')), 20_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
