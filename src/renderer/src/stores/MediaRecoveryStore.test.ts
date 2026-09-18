import { expect, it } from 'vitest'
import { useMediaRecoveryStore } from './MediaRecoveryStore'
it('ignores out-of-order progress and does not reopen a closed recovery', () => {
  const receive = useMediaRecoveryStore.getState().receive
  receive({
    recoveryId: 'first',
    revision: 2,
    status: 'closed',
    projectDisplayName: 'project',
    items: [],
  })
  receive({
    recoveryId: 'first',
    revision: 1,
    status: 'active',
    projectDisplayName: 'project',
    items: [],
  })
  expect(useMediaRecoveryStore.getState().snapshot?.status).toBe('closed')
  receive({
    recoveryId: 'next',
    revision: 1,
    status: 'active',
    projectDisplayName: 'next',
    items: [],
  })
  expect(useMediaRecoveryStore.getState().snapshot?.recoveryId).toBe('next')
})
