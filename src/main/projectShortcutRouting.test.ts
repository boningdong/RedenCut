import { EventEmitter } from 'node:events'
import type { Input, WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
import { routeProjectShortcuts } from './projectShortcutRouting'

it.each([
  [{ meta: true, code: 'KeyS' }, true],
  [{ control: true, code: 'KeyS' }, true],
  [{ meta: true, code: 'KeyZ' }, true],
  [{ control: true, shift: true, code: 'KeyZ' }, true],
  [{ meta: true, shift: true, code: 'KeyS' }, false],
  [{ meta: true, alt: true, code: 'KeyZ' }, false],
  [{ meta: true, isComposing: true, code: 'KeyZ' }, false],
  [{ meta: true, code: 'KeyC' }, false],
  [{ code: 'KeyS' }, false],
  [{ type: 'keyUp', meta: true, code: 'KeyZ' }, false],
])('routes only project keydown chords past native menu accelerators: %j', (patch, expected) => {
  const contents = Object.assign(new EventEmitter(), { setIgnoreMenuShortcuts: vi.fn() })
  routeProjectShortcuts(contents as unknown as Pick<WebContents, 'on' | 'setIgnoreMenuShortcuts'>)
  const event = { preventDefault: vi.fn() }
  const input = {
    type: 'keyDown',
    meta: false,
    control: false,
    shift: false,
    alt: false,
    isComposing: false,
    ...patch,
  } as Input
  contents.emit('before-input-event', event, input)
  expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(expected)
  expect(event.preventDefault).not.toHaveBeenCalled()
  contents.emit('before-input-event', event, { ...input, code: 'KeyC', meta: true })
  expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false)
})
