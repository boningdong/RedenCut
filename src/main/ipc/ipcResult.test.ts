import { describe, expect, it, vi } from 'vitest'
import { PublicIpcError, toIpcResult } from './ipcResult'

describe('IPC result sanitization', () => {
  it('reports an unknown nested filesystem error only to the diagnostic sink', async () => {
    const cause = new Error('ENOENT /Users/private/episode.podcut/project.json')
    const original = new Error('Project open failed', { cause })
    const diagnostics = vi.fn()

    const result = await toIpcResult(async () => {
      throw original
    }, diagnostics)

    expect(diagnostics).toHaveBeenCalledWith(original)
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'operation-failed',
        reason: 'operation-failed',
        message: 'The operation could not be completed.',
      },
    })
    expect(JSON.stringify(result)).not.toContain('/Users/private')
    expect(JSON.stringify(result)).not.toContain('ENOENT')
  })

  it('maps only preapproved public error codes and messages', async () => {
    const result = await toIpcResult(async () => {
      throw new PublicIpcError('stale-session')
    }, vi.fn())

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'stale-session',
        reason: 'stale-session',
        message: 'This project session is no longer current.',
      },
    })
  })
})
