// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OnboardingDialog } from './OnboardingDialog'
import { useLocaleStore } from '../../stores/locale.store'
import { useResourcesStore } from '../../stores/resources.store'
const preferences = useLocaleStore.getState()
const resources = useResourcesStore.getState()
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  useLocaleStore.setState({
    ...preferences,
    resolvedLocale: 'en',
    textEditingEnabled: false,
    setOnboardingDisposition: vi.fn(async () => {}),
  })
  useResourcesStore.setState({ ...resources, hydrate: vi.fn(async () => {}) })
})
afterEach(() => {
  cleanup()
  useLocaleStore.setState(preferences)
  useResourcesStore.setState(resources)
})
it('persists an explicit close as skipped without treating unmount as skipping', () => {
  const view = render(<OnboardingDialog onStart={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(useLocaleStore.getState().setOnboardingDisposition).toHaveBeenCalledWith('skipped')
  vi.mocked(useLocaleStore.getState().setOnboardingDisposition).mockClear()
  view.unmount()
  expect(useLocaleStore.getState().setOnboardingDisposition).not.toHaveBeenCalled()
})
it('completes only after a successful project transition, leaving cancellation reviewable', async () => {
  const onStart = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<OnboardingDialog onStart={onStart} />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: /Start an empty project/ }))
  await waitFor(() => expect(onStart).toHaveBeenCalledWith('empty'))
  expect(useLocaleStore.getState().setOnboardingDisposition).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: /Start an empty project/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: /Start an empty project/ }))
  await waitFor(() =>
    expect(useLocaleStore.getState().setOnboardingDisposition).toHaveBeenCalledWith('completed'),
  )
})
