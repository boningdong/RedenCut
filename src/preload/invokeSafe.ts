import type { IpcError, IpcResult } from '../shared/ipc.types'

class RendererIpcError extends Error {
  constructor(
    readonly code: IpcError['code'],
    message: string,
    readonly reason: IpcError['reason'],
  ) {
    super(message)
    this.name = 'RendererIpcError'
  }
}

export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value
  throw new RendererIpcError(result.error.code, result.error.message, result.error.reason)
}

export async function invokeSafe<T>(
  invoke: (channel: string, ...args: unknown[]) => Promise<IpcResult<T>>,
  channel: string,
  ...args: unknown[]
): Promise<T> {
  return unwrapIpcResult(await invoke(channel, ...args))
}
