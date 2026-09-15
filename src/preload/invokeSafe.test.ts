import { describe, expect, it } from 'vitest'
import { invokeSafe, unwrapIpcResult } from './invokeSafe'

describe('preload IPC result unwrapping', () => {
  it('throws only the sanitized code and message', () => {
    const result = {
      ok: false as const,
      error: {
        code: 'operation-failed' as const,
        reason: 'operation-failed' as const,
        message: 'The operation could not be completed.',
      },
    }

    expect(() => unwrapIpcResult(result)).toThrow('The operation could not be completed.')
    try {
      unwrapIpcResult(result)
    } catch (error) {
      expect(error).toMatchObject({ code: 'operation-failed' })
      expect(JSON.stringify(error)).not.toContain('/Users/private')
    }
  })
})

it('rejects with a plain whitelisted descriptor that contextBridge can copy', async () => {
  const safe = {
    code: 'operation-failed' as const,
    reason: 'speech-aligning' as const,
    message: 'Speech alignment failed.',
    failureKind: 'protocol' as const,
  }
  const result = {
    ok: false as const,
    error: { ...safe, cause: '/private/audio.wav', internalDiagnostic: '/private/model.bin' },
  }
  const received = await invokeSafe(async () => result, 'speech-analysis:start').catch(
    (error: unknown) => error,
  )
  expect(Object.getPrototypeOf(received)).toBe(Object.prototype)
  expect(received).toEqual(safe)
  expect(JSON.stringify(received)).not.toContain('/private')
})
