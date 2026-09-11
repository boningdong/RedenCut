import { describe, expect, it } from 'vitest'
import { unwrapIpcResult } from './invokeSafe'

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
