import { appendFile, mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AppLogEventSchema, type AppLogEvent } from '../../shared/diagnostics.types'

interface Options {
  maxBytes?: number
  maxFiles?: number
  maxAgeDays?: number
  fallback?: (message: string) => void
  append?: typeof appendFile
}

const ACTIVE = 'application.jsonl'

export class DiagnosticLog {
  private queue: Promise<void> = Promise.resolve()
  private fallbackUsed = false
  private rolloverSequence = 0
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly maxAgeDays: number
  private readonly fallback: (message: string) => void
  private readonly append: typeof appendFile

  private constructor(
    private readonly directory: string,
    options: Options,
  ) {
    this.maxBytes = options.maxBytes ?? 4 * 1024 * 1024
    this.maxFiles = options.maxFiles ?? 5
    this.maxAgeDays = options.maxAgeDays ?? 14
    this.fallback = options.fallback ?? console.error
    this.append = options.append ?? appendFile
  }

  static async create(directory: string, options: Options = {}): Promise<DiagnosticLog> {
    const log = new DiagnosticLog(directory, options)
    try {
      await mkdir(directory, { recursive: true })
      await log.prune()
    } catch {
      log.warnFallback()
    }
    return log
  }

  async write(input: AppLogEvent): Promise<void> {
    let event: AppLogEvent
    try {
      // Caller IDs may originate in project metadata or IPC. Persist only an opaque correlation key.
      event = AppLogEventSchema.parse({
        ...input,
        operationId: createHash('sha256').update(input.operationId).digest('hex').slice(0, 32),
      })
    } catch {
      this.warnFallback()
      return
    }
    const line = `${JSON.stringify(event)}\n`
    this.queue = this.queue.then(async () => {
      try {
        await this.rotateIfNeeded(Buffer.byteLength(line))
        await this.append(join(this.directory, ACTIVE), line, 'utf8')
      } catch {
        this.warnFallback()
      }
    })
    await this.queue
  }

  async flush(): Promise<void> {
    await this.queue
  }

  async readRecent(): Promise<AppLogEvent[]> {
    await this.flush()
    try {
      await this.prune()
      const files = await this.logFiles()
      const events: AppLogEvent[] = []
      for (const file of files) {
        const lines = (await readFile(join(this.directory, file), 'utf8')).split('\n')
        for (const line of lines) {
          if (!line) continue
          try {
            events.push(AppLogEventSchema.parse(JSON.parse(line)))
          } catch {
            // A torn or older record does not make the report unavailable.
          }
        }
      }
      return events
    } catch {
      this.warnFallback()
      return []
    }
  }

  async dispose(): Promise<void> {
    await this.flush()
  }

  private async rotateIfNeeded(incoming: number): Promise<void> {
    await this.prune()
    const active = join(this.directory, ACTIVE)
    const size = await stat(active).then(
      (value) => value.size,
      () => 0,
    )
    if (size > 0 && size + incoming > this.maxBytes) {
      await rename(
        active,
        join(
          this.directory,
          `application-${Date.now()}-${String(this.rolloverSequence++).padStart(6, '0')}-${crypto.randomUUID()}.jsonl`,
        ),
      )
      await this.prune()
    }
  }

  private async logFiles(): Promise<string[]> {
    return (await readdir(this.directory))
      .filter((name) => name === ACTIVE || /^application-.*\.jsonl$/.test(name))
      .sort((a, b) => {
        if (a === ACTIVE) return 1
        if (b === ACTIVE) return -1
        return a.localeCompare(b)
      })
  }

  private async prune(): Promise<void> {
    const files = await this.logFiles()
    const limit = Date.now() - this.maxAgeDays * 86400_000
    const retained: string[] = []
    for (const file of files) {
      const path = join(this.directory, file)
      const fileStat = await stat(path)
      const firstTime = await this.firstEventTime(path)
      if ((firstTime ?? fileStat.mtimeMs) < limit) await unlink(path)
      else retained.push(file)
    }
    // A rollover creates a new active file immediately after pruning.
    const allowed = retained.includes(ACTIVE) ? this.maxFiles : this.maxFiles - 1
    for (const file of retained.slice(0, Math.max(0, retained.length - allowed))) {
      if (file !== ACTIVE) await unlink(join(this.directory, file))
    }
  }

  private async firstEventTime(path: string): Promise<number | null> {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(2048)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0]
      const time = JSON.parse(firstLine) as { time?: unknown }
      return typeof time.time === 'string' && Number.isFinite(Date.parse(time.time))
        ? Date.parse(time.time)
        : null
    } catch {
      return null
    } finally {
      await handle.close()
    }
  }

  private warnFallback(): void {
    if (this.fallbackUsed) return
    this.fallbackUsed = true
    try {
      this.fallback('Application diagnostic logging is unavailable.')
    } catch {
      // The fallback cannot affect the user's operation.
    }
  }
}
