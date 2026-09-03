import { expect, test } from 'vitest'
import { assertCloseAllowed } from '../runtime/closePreconditions'

test('requires explicit discard for unsaved state and never treats discard as job cancellation', () => {
  expect(() => assertCloseAllowed({ dirty: true, busy: false }, false)).toThrow('UNSAVED_CHANGES')
  expect(() => assertCloseAllowed({ dirty: true, busy: false }, true)).not.toThrow()
  expect(() => assertCloseAllowed({ dirty: false, busy: true }, true)).toThrow('APPLICATION_BUSY')
  expect(() => assertCloseAllowed({ dirty: false, busy: false }, false)).not.toThrow()
})
