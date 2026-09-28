import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import {
  AppLogMessageSchema,
  emptyLogLosses,
  type LogLosses,
} from '../../shared/AppLogMessageTypes'
import { AppLogEventSchema } from '../../shared/diagnostics.types'
import { LogSanitizer } from '../logging/LogSanitizer'

interface FileSummary {
  bytes: number
  from?: string
  to?: string
  failures: Set<string>
  invalid: boolean
  losses: Map<string, LogLosses>
}
/** Validate snapshots incrementally; a damaged or oversized JSONL record is omitted explicitly. */
export async function normalizeSnapshotFile(
  root: string,
  name: string,
  kind: 'events' | 'runtime',
): Promise<FileSummary> {
  const path = join(root, name)
  const temp = path + '.validated'
  const output = createWriteStream(temp, { mode: 0o600, flags: 'wx' })
  const result: FileSummary = { bytes: 0, failures: new Set(), invalid: false, losses: new Map() }
  const sanitizer = new LogSanitizer()
  const decoder = new StringDecoder('utf8')
  let line = ''
  let tooLong = false
  let outputError: Error | undefined
  const completed = finished(output).catch((error) => {
    outputError = error as Error
  })
  const accept = async () => {
    if (tooLong) {
      result.invalid = true
      line = ''
      tooLong = false
      return
    }
    if (!line.trim()) {
      line = ''
      return
    }
    let encoded: string | undefined
    try {
      const value = JSON.parse(line)
      if (kind === 'events') {
        const record = AppLogEventSchema.parse(value)
        if (record.diagnosticId) result.failures.add(record.diagnosticId)
        encoded = JSON.stringify(record) + '\n'
      } else {
        const record = AppLogMessageSchema.parse(value)
        record.message = sanitizer.text(record.message)
        if (record.stack) record.stack = sanitizer.text(record.stack)
        if (record.losses) result.losses.set(record.sessionId, record.losses)
        else if (!result.losses.has(record.sessionId))
          result.losses.set(record.sessionId, { ...emptyLogLosses(), countersComplete: false })
        encoded = JSON.stringify(record) + '\n'
      }
      if (typeof value.time === 'string') {
        if (!result.from || value.time < result.from) result.from = value.time
        if (!result.to || value.time > result.to) result.to = value.time
      }
    } catch {
      result.invalid = true
    }
    line = ''
    if (encoded) {
      if (outputError) throw outputError
      if (!output.write(encoded)) await once(output, 'drain')
      result.bytes += Buffer.byteLength(encoded)
    }
  }
  try {
    for await (const chunk of createReadStream(path)) {
      const text = decoder.write(chunk as Buffer)
      for (const fragment of text.split(/(\n)/)) {
        if (fragment === '\n') await accept()
        else if (!tooLong) {
          if (line.length + fragment.length > 32768) {
            tooLong = true
            line = ''
          } else line += fragment
        }
      }
    }
    const remainder = decoder.end()
    if (remainder) line += remainder
    if (line || tooLong) {
      result.invalid = true
    } // A torn final record is never silently repaired.
    output.end()
    await completed
    if (outputError) throw outputError
    await rename(temp, path)
    result.bytes = (await stat(path)).size
    return result
  } catch (error) {
    output.destroy()
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
