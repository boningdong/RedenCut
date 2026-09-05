import { expect, test } from 'vitest'
import { assertNativeDialogAllowed } from './harnessDialogPolicy'
import { toIpcResult } from './ipc/ipcResult'

test('blocks background native dialogs with an actionable public IPC error', async () => {
  const result = await toIpcResult(
    () =>
      assertNativeDialogAllowed({
        PODCUT_HARNESS_RUN_ID: 'test-run',
        PODCUT_HARNESS_RUN_DIRECTORY: '/test-run',
      }),
    () => {},
  )
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'foreground-required', message: expect.stringContaining('FOREGROUND_REQUIRED') },
  })
})

test('ordinary launches and explicit foreground retain native dialogs', () => {
  expect(() => assertNativeDialogAllowed({})).not.toThrow()
  expect(() =>
    assertNativeDialogAllowed({ PODCUT_HARNESS_WINDOW_MODE: 'background' }),
  ).not.toThrow()
  expect(() =>
    assertNativeDialogAllowed({
      PODCUT_HARNESS_RUN_ID: 'test-run',
      PODCUT_HARNESS_RUN_DIRECTORY: '/test-run',
      PODCUT_HARNESS_WINDOW_MODE: 'foreground',
    }),
  ).not.toThrow()
})
