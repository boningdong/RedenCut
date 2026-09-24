import type { IpcError, IpcResult } from '../shared/ipc.types'

export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value
  // contextBridge drops custom Error properties. Copy only the public scalar fields
  // into a plain rejection value so renderer control flow and localization survive.
  const error: IpcError = {
    code: result.error.code,
    reason: result.error.reason,
    message: result.error.message,
    ...(result.error.failureKind ? { failureKind: result.error.failureKind } : {}),
    ...(typeof result.error.diagnosticId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      result.error.diagnosticId,
    )
      ? { diagnosticId: result.error.diagnosticId }
      : {}),
  }
  throw error
}

export async function invokeSafe<T>(
  invoke: (channel: string, ...args: unknown[]) => Promise<IpcResult<T>>,
  channel: string,
  ...args: unknown[]
): Promise<T> {
  return unwrapIpcResult(await invoke(channel, ...args))
}
