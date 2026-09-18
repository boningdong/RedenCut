// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DevelopmentEnvironmentPanel } from './DevelopmentEnvironmentPanel'
import { useResourcesStore } from '../../stores/resources.store'
import { useLocaleStore } from '../../stores/locale.store'

const originalResources = useResourcesStore.getState()
const originalLocale = useLocaleStore.getState()
beforeEach(() => {
  useLocaleStore.setState({ ...originalLocale, resolvedLocale: 'en' })
  useResourcesStore.setState({
    ...originalResources,
    pending: false,
    snapshot: {
      revision: 1,
      resources: [],
      baseReady: false,
      development: {
        platform: 'linux',
        ffmpeg: true,
        ffprobe: true,
        whisper: true,
        uv: false,
        python: false,
        libraries: false,
        ready: false,
      },
    },
    refresh: vi.fn(async () => {
      useResourcesStore.setState({ pending: true })
    }),
  })
})
afterEach(() => {
  cleanup()
  useResourcesStore.setState(originalResources)
  useLocaleStore.setState(originalLocale)
})

it('keeps Validate focusable while pending and blocks repeated activation', () => {
  render(<DevelopmentEnvironmentPanel />)
  const validate = screen.getAllByRole('button', { name: 'Validate' })[1] as HTMLButtonElement
  validate.focus()
  fireEvent.click(validate)
  expect(validate.disabled).toBe(false)
  expect(validate.getAttribute('aria-disabled')).toBe('true')
  expect(document.activeElement).toBe(validate)
  fireEvent.click(validate)
  expect(useResourcesStore.getState().refresh).toHaveBeenCalledTimes(1)
})

it('keeps an explicitly validated section open after it becomes ready', () => {
  render(<DevelopmentEnvironmentPanel />)
  const validate = screen.getAllByRole('button', { name: 'Validate' })[1]
  validate.focus()
  fireEvent.click(validate)
  act(() => {
    const snapshot = useResourcesStore.getState().snapshot!
    useResourcesStore.setState({
      pending: false,
      snapshot: {
        ...snapshot,
        development: { ...snapshot.development!, python: true, libraries: true, ready: true },
      },
    })
  })
  expect(screen.getAllByRole('button', { name: 'Validate' })[1]).toBe(validate)
  expect(document.activeElement).toBe(validate)
})
