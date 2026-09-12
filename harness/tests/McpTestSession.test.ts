import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { expect, test, vi } from 'vitest'
import { McpTestSession } from '../../e2e/support/McpTestSession'
import { PlaywrightMcpAdapter } from '../ui/PlaywrightMcpAdapter'

test('failed connection cleanup restores the shared-context factory even if client close fails', async () => {
  const original = PlaywrightMcpAdapter.create
  const ui = new McpTestSession()
  // Fail before riffcut_start: this regression must never launch host Electron.
  vi.spyOn(Client.prototype, 'connect').mockRejectedValueOnce(new Error('CONNECT_FAILED'))
  try {
    await expect(ui.start()).rejects.toThrow('CONNECT_FAILED')
    vi.spyOn(Client.prototype, 'close').mockRejectedValueOnce(new Error('CLOSE_FAILED'))
    await expect(ui.close()).rejects.toThrow('CLOSE_FAILED')
    expect(PlaywrightMcpAdapter.create).toBe(original)
  } finally {
    vi.restoreAllMocks()
    await ui.close()
  }
})
