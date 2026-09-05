import { expect, test, vi } from 'vitest'
import { harnessWindowOptions, presentHarnessWindow } from './harnessWindow'
import { parseHarnessWindowMode } from '../shared/harnessWindowMode'

test('normal launches retain Electron defaults and no extra show action', () => {
  const window = { show: vi.fn(), showInactive: vi.fn() }
  expect(harnessWindowOptions(undefined)).toEqual({})
  presentHarnessWindow(window, undefined)
  expect(window.show).not.toHaveBeenCalled()
  expect(window.showInactive).not.toHaveBeenCalled()
})

test('background is visible without activation and foreground is explicit', () => {
  const window = { show: vi.fn(), showInactive: vi.fn() }
  expect(parseHarnessWindowMode()).toBe('background')
  expect(harnessWindowOptions('background')).toMatchObject({ show: false, focusable: false })
  presentHarnessWindow(window, 'background')
  expect(window.showInactive).toHaveBeenCalledOnce()
  expect(window.show).not.toHaveBeenCalled()
  presentHarnessWindow(window, 'foreground')
  expect(window.show).toHaveBeenCalledOnce()
  expect(() => parseHarnessWindowMode('hidden')).toThrow('INVALID_WINDOW_MODE')
})
