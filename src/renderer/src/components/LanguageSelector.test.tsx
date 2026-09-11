// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLocaleStore } from '../stores/locale.store'
import { LanguageSelector } from './LanguageSelector'
import { LocaleNotice } from './LocaleNotice'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useEditorStore } from '../stores/editor.store'

const player = vi.hoisted(() => ({
  seek: vi.fn(),
  getCurrentTime: () => 2,
  getDuration: () => 10,
  playPause: vi.fn(),
}))
vi.mock('@shared/player.types', () => ({ getAudioPlayerInstance: () => player }))
const onSave = vi.fn()
function Controls() {
  useKeyboardShortcuts({ onSave })
  return (
    <>
      <LanguageSelector />
      <LocaleNotice />
    </>
  )
}
beforeEach(() => {
  useLocaleStore.setState({
    preference: 'system',
    resolvedLocale: 'en',
    pending: false,
    error: null,
    warning: null,
    revision: 0,
  })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      appPreferences: {
        setLocale: vi.fn(async () => ({
          preference: 'zh-CN',
          resolvedLocale: 'zh-CN',
          revision: 1,
          warning: null,
        })),
      },
    },
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('labels stable choices and follows a successfully committed selection', async () => {
  render(<Controls />)
  const select = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement
  expect([...select.options].map((option) => [option.value, option.text])).toEqual([
    ['system', 'Follow System'],
    ['en', 'English'],
    ['zh-CN', '简体中文'],
  ])
  await act(async () => fireEvent.change(select, { target: { value: 'zh-CN' } }))
  expect(screen.getByRole('combobox', { name: '语言' })).toBe(select)
  expect(select.value).toBe('zh-CN')
  expect(screen.getByRole('option', { name: '跟随系统' })).toBeTruthy()
})
it.each([
  'Space',
  'KeyS',
  'KeyM',
  'KeyU',
  'ArrowLeft',
  'ArrowRight',
  'Delete',
  'Backspace',
  'Escape',
])('keeps %s native to the selector without editing or seeking', (code) => {
  render(<Controls />)
  const editor = useEditorStore.getState()
  const select = screen.getByRole('combobox')
  select.focus()
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })
  fireEvent(select, event)
  expect(event.defaultPrevented).toBe(false)
  expect(player.seek).not.toHaveBeenCalled()
  expect(player.playPause).not.toHaveBeenCalled()
  expect(useEditorStore.getState()).toBe(editor)
})
it.each(['ctrlKey', 'metaKey'])(
  'preserves %s+S project saving while the selector is focused',
  (modifier) => {
    render(<Controls />)
    fireEvent.keyDown(screen.getByRole('combobox'), { code: 'KeyS', [modifier]: true })
    expect(onSave).toHaveBeenCalledOnce()
  },
)
it('shows a safe, translated save failure and retains the committed choice', async () => {
  window.electronAPI.appPreferences.setLocale = vi
    .fn()
    .mockRejectedValue(new Error('/private/secret'))
  render(<Controls />)
  await act(async () =>
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-CN' } }),
  )
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('system')
  expect(screen.getByRole('alert').textContent).toBe(
    'Language could not be saved. Please try again.',
  )
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByRole('alert').textContent).toBe('无法保存语言设置。请重试。')
})
it('offers recovery for an initial read failure', async () => {
  const hydrate = vi.spyOn(useLocaleStore.getState(), 'hydrate').mockResolvedValue()
  useLocaleStore.setState({ error: { reason: 'load-preferences' } })
  render(<Controls />)
  expect(screen.getByRole('alert').textContent).toContain('Language settings could not be loaded.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(hydrate).toHaveBeenCalledOnce()
  hydrate.mockRestore()
})
