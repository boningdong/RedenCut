import { appendFile, mkdir, readdir, stat, rename, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emptyLogLosses, type AppLogMessage, type LogLosses } from '../../shared/AppLogMessageTypes'

export interface LogWriterOptions {
  maxRecordBytes: number
  maxQueueBytes: number
  priorityReserveBytes: number
  flushIntervalMs: number
  batchBytes: number
  maxFileBytes: number
  maxFiles: number
  maxAgeDays: number
  shutdownFlushTimeoutMs: number
  append?: typeof appendFile
}
const defaults: LogWriterOptions = {
  maxRecordBytes: 16384,
  maxQueueBytes: 512 * 1024,
  priorityReserveBytes: 128 * 1024,
  flushIntervalMs: 500,
  batchBytes: 64 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 5,
  maxAgeDays: 14,
  shutdownFlushTimeoutMs: 2000,
}
export interface LogSnapshotSummary {
  files: string[]
  losses: LogLosses
  sessionIds: string[]
}
export class RotatingLogWriter {
  private queue: string[] = []
  private queuedBytes = 0
  private inFlightBytes = 0
  private tail: Promise<void> = Promise.resolve()
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private activeBytes = 0
  private lastPrune = 0
  private dirtyLosses = false
  private lastRecord?: AppLogMessage
  private readonly sessionIds = new Set<string>()
  private readonly lossSessionId = randomUUID()
  private lossSequence = 0
  private readonly options: LogWriterOptions
  readonly losses = emptyLogLosses()
  get pendingBytes() {
    return this.queuedBytes + this.inFlightBytes
  }
  private constructor(
    private readonly directory: string,
    options: Partial<LogWriterOptions>,
  ) {
    this.options = { ...defaults, ...options }
  }
  static async create(directory: string, options: Partial<LogWriterOptions> = {}) {
    const writer = new RotatingLogWriter(directory, options)
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writer.prune()
      writer.activeBytes = await stat(join(directory, 'runtime.jsonl')).then(
        (s) => s.size,
        () => 0,
      )
    } catch {
      writer.losses.writeFailures++
      writer.losses.countersComplete = false
    }
    return writer
  }
  recordDropped(level: AppLogMessage['level'], count: number) {
    if (count) {
      this.losses.droppedRecords[level] += count
      this.dirtyLosses = true
    }
  }
  enqueue(record: AppLogMessage): void {
    if (this.closed) return
    this.lastRecord = record
    this.sessionIds.add(record.sessionId)
    const recordLimit = Math.min(this.options.maxRecordBytes, this.options.maxFileBytes)
    let text = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(text) > recordLimit) {
      record = { ...record, truncated: true }
      let message = record.message
      let stack = record.stack ?? ''
      do {
        if (stack.length > message.length) stack = stack.slice(0, Math.floor(stack.length / 2))
        else message = message.slice(0, Math.floor(message.length / 2))
        text =
          JSON.stringify({ ...record, message, ...(stack ? { stack } : { stack: undefined }) }) +
          '\n'
      } while (
        Buffer.byteLength(text) > this.options.maxRecordBytes &&
        (message.length || stack.length)
      )
      this.losses.truncatedRecords++
      this.dirtyLosses = true
    } else if (record.truncated) {
      this.losses.truncatedRecords++
      this.dirtyLosses = true
    }
    const bytes = Buffer.byteLength(text)
    if (bytes > recordLimit) {
      this.losses.droppedRecords[record.level]++
      this.dirtyLosses = true
      return
    }
    const limit =
      record.level === 'info'
        ? this.options.maxQueueBytes - this.options.priorityReserveBytes
        : this.options.maxQueueBytes
    if (this.pendingBytes + bytes > limit) {
      this.losses.droppedRecords[record.level]++
      this.dirtyLosses = true
      return
    }
    this.queue.push(text)
    this.queuedBytes += bytes
    if (this.queuedBytes >= this.options.batchBytes) this.drain()
    else if (!this.timer) {
      this.timer = setTimeout(() => this.drain(), this.options.flushIntervalMs)
      this.timer.unref()
    }
  }
  private drain() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.queue.length && !this.dirtyLosses) return
    const text = this.queue.join('')
    const bytes = this.queuedBytes
    this.queue = []
    this.queuedBytes = 0
    this.inFlightBytes += bytes
    this.tail = this.tail.then(async () => {
      try {
        const marker =
          this.dirtyLosses && this.lastRecord
            ? JSON.stringify({
                schemaVersion: 1,
                time: new Date().toISOString(),
                sessionId: this.lossSessionId,
                sequence: this.lossSequence++,
                level: 'warn',
                source: 'main',
                component: 'logging',
                message: 'logging/loss',
                losses: structuredClone(this.losses),
              }) + '\n'
            : ''
        this.dirtyLosses = false
        const output = text + marker
        if (!output) return
        if (Date.now() - this.lastPrune > 60_000) await this.prune()
        // Split batches on record boundaries, keeping both records and files bounded.
        let batch = ''
        for (const line of output.split('\n')) {
          if (!line) continue
          const record = line + '\n'
          if (Buffer.byteLength(record) > this.options.maxFileBytes) {
            this.losses.countersComplete = false
            this.dirtyLosses = true
            continue
          }
          if (
            batch &&
            this.activeBytes + Buffer.byteLength(batch) + Buffer.byteLength(record) >
              this.options.maxFileBytes
          ) {
            await this.append(batch)
            batch = ''
          }
          if (
            this.activeBytes &&
            this.activeBytes + Buffer.byteLength(batch) + Buffer.byteLength(record) >
              this.options.maxFileBytes
          ) {
            await rename(
              join(this.directory, 'runtime.jsonl'),
              join(this.directory, `runtime-${Date.now()}-${randomUUID()}.jsonl`),
            )
            this.activeBytes = 0
            await this.prune()
          }
          batch += record
        }
        if (batch) await this.append(batch)
      } catch {
        this.losses.writeFailures++
        this.losses.countersComplete = false
        this.dirtyLosses = true
      } finally {
        this.inFlightBytes -= bytes
      }
    })
  }
  private async append(text: string) {
    await (this.options.append ?? appendFile)(join(this.directory, 'runtime.jsonl'), text, {
      encoding: 'utf8',
      mode: 0o600,
    })
    this.activeBytes += Buffer.byteLength(text)
  }
  async flush() {
    this.drain()
    await this.tail
  }
  async snapshot(destination: string): Promise<LogSnapshotSummary> {
    this.drain()
    const result: LogSnapshotSummary = {
      files: [],
      losses: structuredClone(this.losses),
      sessionIds: [...this.sessionIds, this.lossSessionId],
    }
    const job = this.tail.then(async () => {
      await mkdir(destination, { recursive: true, mode: 0o700 })
      for (const name of await this.files()) {
        await copyFile(join(this.directory, name), join(destination, name))
        result.files.push(name)
      }
      result.losses = structuredClone(this.losses)
    })
    this.tail = job.catch(() => {
      this.losses.countersComplete = false
    })
    await job
    return result
  }
  async dispose() {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.timer)
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.options.shutdownFlushTimeoutMs)
      }),
    ])
    clearTimeout(timeout)
  }
  private async files() {
    return (await readdir(this.directory))
      .filter((n) => n === 'runtime.jsonl' || /^runtime-\d+-[0-9a-f-]+\.jsonl$/.test(n))
      .sort((a, b) => (a === 'runtime.jsonl' ? 1 : b === 'runtime.jsonl' ? -1 : a.localeCompare(b)))
  }
  private async prune() {
    this.lastPrune = Date.now()
    const names = await this.files()
    const retained: string[] = []
    for (const name of names) {
      const path = join(this.directory, name)
      const s = await stat(path)
      if (s.mtimeMs < Date.now() - this.options.maxAgeDays * 86400000) {
        await rm(path, { force: true })
        if (name === 'runtime.jsonl') this.activeBytes = 0
      } else retained.push(name)
    }
    const allowed = retained.includes('runtime.jsonl')
      ? this.options.maxFiles
      : this.options.maxFiles - 1
    for (const name of retained.slice(0, Math.max(0, retained.length - allowed)))
      if (name !== 'runtime.jsonl') await rm(join(this.directory, name), { force: true })
  }
}
