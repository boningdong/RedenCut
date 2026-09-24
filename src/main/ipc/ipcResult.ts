import { RuntimeValidationError } from '../runtime/RuntimeValidator'
import { TranscriberUnavailableError } from '../speech/transcriber/TranscriberUnavailableError'
import type { IpcError, IpcResult } from '../../shared/ipc.types'
import type { SessionPrecondition, WorkspaceToken } from '../../shared/session.types'
import { ZodError } from 'zod'
import { SpeechAnalysisError } from '../speech/SpeechAnalysisError'
import { recordTerminalFailure } from '../diagnostics/DiagnosticFailure'
import type { DiagnosticLog } from '../diagnostics/DiagnosticLog'
import type { AppFailure } from '../diagnostics/DiagnosticFailure'
import { ReportSaveError } from '../diagnostics/DiagnosticReport'

type IpcErrorCode = IpcError['code']

const SAFE_MESSAGES: Record<IpcErrorCode, string> = {
  'stale-session': 'This project session is no longer current.',
  cancelled: 'The operation was cancelled.',
  'invalid-request': 'The request was invalid.',
  'operation-failed': 'The operation could not be completed.',
}

export class PublicIpcError extends Error {
  constructor(readonly code: Exclude<IpcErrorCode, 'operation-failed'>) {
    super(SAFE_MESSAGES[code])
    this.name = 'PublicIpcError'
  }
}

export async function toIpcResult<T>(
  operation: () => Promise<T> | T,
  diagnosticSink: (error: unknown) => void = console.error,
  failureContext?: {
    log: Pick<DiagnosticLog, 'write'>
    operationId: string
    stage: string
    classify?: (error: unknown) => Pick<AppFailure, 'code' | 'reason'>
  },
): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    diagnosticSink(error)
    const mapped = mapError(error)
    if (failureContext && mapped.code === 'operation-failed') {
      const publicFailure = recordTerminalFailure(
        error,
        {
          ...failureContext,
          classify: (failure) => {
            const classified = failureContext.classify?.(failure) ?? {
              code: 'app/operation-failed' as const,
              reason: 'operation-failed' as const,
            }
            const stageReason =
              error instanceof SpeechAnalysisError ? `speech-${error.stage}` : null
            return mapped.reason !== 'operation-failed' && mapped.reason !== stageReason
              ? { ...classified, reason: mapped.reason }
              : classified
          },
        },
        failureContext.log,
      )
      return { ok: false, error: { ...mapped, ...publicFailure } }
    }
    return { ok: false, error: mapped }
  }
}

function mapError(error: unknown): IpcError {
  if (error instanceof ReportSaveError)
    return {
      code: 'operation-failed',
      reason: 'report-save-failed',
      message: 'The diagnostic report could not be saved.',
    }
  if (error instanceof RuntimeValidationError)
    return {
      code: 'operation-failed',
      reason: 'runtime-unavailable',
      message: 'The managed runtime is missing or invalid.',
    }
  if (error instanceof TranscriberUnavailableError)
    return { code: 'operation-failed', reason: error.reason, message: error.message }
  if (error instanceof SpeechAnalysisError)
    return {
      code: 'operation-failed',
      reason: `speech-${error.stage}`,
      message: error.message,
      ...(error.failureKind ? { failureKind: error.failureKind } : {}),
    }
  if (error instanceof PublicIpcError)
    return { code: error.code, reason: error.code, message: SAFE_MESSAGES[error.code] }
  if (error instanceof DOMException && error.name === 'AbortError')
    return { code: 'cancelled', reason: 'cancelled', message: SAFE_MESSAGES.cancelled }
  if (error instanceof ZodError)
    return {
      code: 'invalid-request',
      reason: 'invalid-request',
      message: SAFE_MESSAGES['invalid-request'],
    }
  if (
    error instanceof Error &&
    (error.message === 'Stale workspace token' || error.message === 'Stale workspace revision')
  )
    return {
      code: 'stale-session',
      reason: 'stale-session',
      message: SAFE_MESSAGES['stale-session'],
    }
  return {
    code: 'operation-failed',
    reason: 'operation-failed',
    message: SAFE_MESSAGES['operation-failed'],
  }
}

export function requireSessionPrecondition(value: unknown): SessionPrecondition {
  if (!value || typeof value !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.workspaceToken !== 'string' ||
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision as number) < 1
  )
    throw new PublicIpcError('invalid-request')
  return {
    workspaceToken: candidate.workspaceToken as WorkspaceToken,
    revision: candidate.revision as number,
  }
}

export function requireJobId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new PublicIpcError('invalid-request')
  return value
}
