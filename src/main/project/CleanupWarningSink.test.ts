import { describe, expect, it } from 'vitest'
import { CleanupWarningStore, recordCleanupWarning } from './CleanupWarningSink'

describe('CleanupWarningSink', () => {
  it('retains the exact owned path, operation, and kind for a later retry', async () => {
    const store = new CleanupWarningStore()
    const warning = {
      path: '/private/tmp/.episode.redencut-backup-owned',
      operation: 'save-as-publication' as const,
      kind: 'destination-backup' as const,
      cause: new Error('busy'),
    }

    await recordCleanupWarning(store, warning)

    expect(store.pending()).toEqual([warning])
  })

  it('does not let a failing warning sink change an already committed operation', async () => {
    const warning = {
      path: '/private/tmp/redencut-owned-workspace',
      operation: 'workspace-switch' as const,
      kind: 'temporary-workspace' as const,
      cause: new Error('permission denied'),
    }

    await expect(
      recordCleanupWarning(
        {
          record: async () => {
            throw new Error('warning persistence failed')
          },
        },
        warning,
      ),
    ).resolves.toBeUndefined()
  })
})
