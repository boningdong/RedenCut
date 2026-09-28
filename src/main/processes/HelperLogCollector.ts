import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { PythonLogMessageSchema } from '../../shared/AppLogMessageTypes'
import { appLogger, type AppLogger, type AppLogContext } from '../logging/AppLogger'

/** Consumes diagnostic pipes only; stdout protocols and media remain with their adapters. */
export class HelperLogCollector {
  private decoder = new StringDecoder('utf8')
  private line = ''
  private truncated = false
  private progress = ''
  private finished = false
  private afterCarriageReturn = false
  constructor(
    private readonly logger: AppLogger,
    private readonly format: 'python' | 'text' = 'text',
  ) {}
  write(chunk: Buffer | string) {
    if (!this.finished) this.consume(typeof chunk === 'string' ? chunk : this.decoder.write(chunk))
  }
  private consume(text: string) {
    for (const fragment of text.split(/([\r\n])/)) {
      if (fragment === '\r' || fragment === '\n') {
        if (fragment === '\n' && this.afterCarriageReturn) {
          this.afterCarriageReturn = false
          continue
        }
        if (this.line) this.emit(this.line, this.truncated)
        this.line = ''
        this.truncated = false
        this.afterCarriageReturn = fragment === '\r'
      } else if (fragment) {
        this.afterCarriageReturn = false
        const space = 16384 - this.line.length
        if (fragment.length > space) this.truncated = true
        if (space > 0) this.line += fragment.slice(0, space)
      }
    }
  }
  private emit(text: string, truncated: boolean) {
    if (/^(?:\s*(?:progress\s*=|\d+%\||frame=|size=))/.test(text)) {
      this.progress = text
      return
    }
    this.emitProgress()
    if (this.format === 'python' && !truncated) {
      try {
        const parsed = PythonLogMessageSchema.safeParse(JSON.parse(text))
        if (parsed.success) {
          const r = parsed.data
          const error = r.stack ? new Error('') : undefined
          if (error) error.stack = r.stack
          this.logger.withContext({ component: r.logger }).log(r.level, r.message, error)
          return
        }
      } catch {
        /* Third-party text is not required to be JSON. */
      }
    }
    this.logger.log('info', text, undefined, truncated)
  }
  private emitProgress() {
    if (this.progress) {
      this.logger.info(this.progress)
      this.progress = ''
    }
  }
  finish() {
    if (this.finished) return
    this.consume(this.decoder.end())
    if (this.line) this.emit(this.line, this.truncated)
    this.emitProgress()
    this.finished = true
    this.line = ''
  }
}
export function collectHelperLogs(
  child: EventEmitter & { stderr?: EventEmitter | null },
  context: AppLogContext,
  format: 'python' | 'text' = 'text',
) {
  const logger = appLogger.withContext({
    ...context,
    stream: 'stderr',
    helperInstanceId: randomUUID(),
  })
  const collector = new HelperLogCollector(logger, format)
  logger.info('Helper started')
  const receive = (chunk: Buffer | string) => collector.write(chunk)
  child.stderr?.on('data', receive)
  child.once('close', (code: number | null, signal: string | null) => {
    collector.finish()
    child.stderr?.removeListener('data', receive)
    logger.info(`Helper exited: code=${code ?? 'none'}, signal=${signal ?? 'none'}`)
  })
  return collector
}
