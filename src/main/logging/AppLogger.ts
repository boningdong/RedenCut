import { createHash, randomUUID } from 'node:crypto'
import {
  AppLogMessageSchema,
  type emptyLogLosses,
  type AppLogMessage,
  type LogLevel,
  type LogSource,
} from '../../shared/AppLogMessageTypes'
import { LogSanitizer, type SanitizerOptions } from './LogSanitizer'
import { RotatingLogWriter } from './RotatingLogWriter'

export interface AppLogContext {
  source?: LogSource
  component?: string
  operationId?: string
  helperInstanceId?: string
  stream?: 'stdout' | 'stderr'
}
interface LogState {
  writer?: RotatingLogWriter
  buffer: AppLogMessage[]
  bytes: number
  sequence: number
  sessionId: string
  dropped: ReturnType<typeof emptyLogLosses>['droppedRecords']
  closed: boolean
}
export class AppLogger {
  private readonly state: LogState
  private readonly sanitizer: LogSanitizer
  constructor(
    writer?: RotatingLogWriter,
    options: SanitizerOptions = {},
    private readonly context: AppLogContext = {},
    state?: LogState,
    sanitizer?: LogSanitizer,
  ) {
    this.state = state ?? {
      writer,
      buffer: [],
      bytes: 0,
      sequence: 0,
      sessionId: randomUUID(),
      closed: false,
      dropped: { info: 0, warn: 0, error: 0 },
    }
    this.sanitizer = sanitizer ?? new LogSanitizer(options)
  }
  withContext(context: AppLogContext): AppLogger {
    return new AppLogger(undefined, {}, { ...this.context, ...context }, this.state, this.sanitizer)
  }
  async initialize(directory: string) {
    if (this.state.writer) return
    this.state.writer = await RotatingLogWriter.create(directory)
    for (const record of this.state.buffer) this.state.writer.enqueue(record)
    for (const level of ['info', 'warn', 'error'] as const)
      this.state.writer.recordDropped(level, this.state.dropped[level])
    this.state.buffer = []
    this.state.bytes = 0
    this.info('Application logging initialized')
  }
  info(message: string, error?: unknown) {
    this.log('info', message, error)
  }
  warn(message: string, error?: unknown) {
    this.log('warn', message, error)
  }
  error(message: string, error?: unknown) {
    this.log('error', message, error)
  }
  readonly reportError = (error: unknown) => this.error('Operation failed', error)
  get writer() {
    return this.state.writer
  }
  async dispose() {
    this.state.closed = true
    await this.state.writer?.dispose()
  }
  log(level: LogLevel, message: string, error?: unknown, truncated = false) {
    if (this.state.closed) return
    try {
      const details = error === undefined ? undefined : this.sanitizer.error(error)
      const record = AppLogMessageSchema.parse({
        schemaVersion: 1,
        time: new Date().toISOString(),
        sessionId: this.state.sessionId,
        sequence: this.state.sequence++,
        level,
        source: this.context.source ?? 'main',
        component: this.context.component
          ? this.sanitizer.text(this.context.component).slice(0, 96)
          : undefined,
        stream: this.context.stream,
        helperInstanceId: this.context.helperInstanceId,
        operationId: this.context.operationId
          ? createHash('sha256').update(this.context.operationId).digest('hex').slice(0, 32)
          : undefined,
        message: (
          this.sanitizer.text(message) + (details?.message ? ' — ' + details.message : '')
        ).slice(0, 16384),
        stack: details?.stack,
        truncated:
          truncated ||
          message.length > 16384 ||
          (details?.message.length ?? 0) > 16384 ||
          undefined,
      })
      if (this.state.writer) this.state.writer.enqueue(record)
      else {
        const bytes = Buffer.byteLength(JSON.stringify(record))
        if (this.state.bytes + bytes <= (level === 'info' ? 384 : 512) * 1024) {
          this.state.buffer.push(record)
          this.state.bytes += bytes
        } else this.state.dropped[level]++
      }
    } catch {
      process.stderr.write('Application logging could not record a message.\n')
    }
  }
}
export const appLogger = new AppLogger(undefined, {
  secrets: Object.entries(process.env)
    .filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key))
    .map(([, value]) => value ?? ''),
})
