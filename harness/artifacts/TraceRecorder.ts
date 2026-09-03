import { join } from 'node:path'
import type { BrowserContext } from 'playwright'
import { deadline } from '../runtime/deadline'
import type { RunArtifacts } from './RunArtifacts'

export class TraceRecorder {
  private context: BrowserContext | undefined

  constructor(
    private readonly artifacts: RunArtifacts,
    private readonly generation: number,
  ) {}

  async start(context: BrowserContext): Promise<void> {
    if (this.context) throw new Error('TRACE_ALREADY_STARTED')
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    this.context = context
    this.artifacts.record(this.generation, 'trace', { state: 'recording' })
  }

  async stop(timeoutMs: number): Promise<void> {
    const context = this.context
    this.context = undefined
    if (!context) return
    try {
      const path = join(this.artifacts.generationDirectory(this.generation), 'trace.zip')
      await deadline(context.tracing.stop({ path }), timeoutMs, 'TRACE_FLUSH_TIMEOUT')
      this.artifacts.record(this.generation, 'trace', { state: 'complete', path })
    } catch (error) {
      this.artifacts.record(this.generation, 'trace', { state: 'incomplete', error: String(error) })
    }
  }
}
