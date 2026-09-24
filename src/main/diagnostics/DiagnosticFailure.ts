import { randomUUID } from 'node:crypto'
import type { PublicMessage, PublicReason } from '../../shared/publicMessages'
import { AppDiagnosticCodes, AppLogEvents, type AppLogEvent } from '../../shared/diagnostics.types'

export interface AppFailure {
  code: `${string}/${string}`
  reason: PublicReason
  stage?: string
  cause?: unknown
}

interface Context {
  operationId: string
  stage?: string
  validation?: boolean
  classify?: (error: unknown) => Pick<AppFailure, 'code' | 'reason'>
}

interface Writer {
  write(event: AppLogEvent): Promise<void>
}

/** Record only at the terminal boundary; an exception and its causes stay in main memory. */
export function recordTerminalFailure(
  error: unknown,
  context: Context,
  log: Writer,
): PublicMessage {
  if (error instanceof DOMException && error.name === 'AbortError') return { reason: 'cancelled' }
  if (context.validation) return { reason: 'invalid-request' }
  const classified = context.classify?.(error) ?? {
    code: AppDiagnosticCodes.OperationFailed,
    reason: 'operation-failed',
  }
  const diagnosticId = randomUUID()
  void log
    .write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'error',
      event: AppLogEvents.OperationFailed,
      operationId: context.operationId,
      diagnosticId,
      facts: { code: classified.code, stage: context.stage ?? 'operation' },
    })
    .catch(() => {})
  return { reason: classified.reason, diagnosticId }
}
