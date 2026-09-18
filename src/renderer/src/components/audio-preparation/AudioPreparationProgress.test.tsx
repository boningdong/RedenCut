// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioPreparationProgress } from './AudioPreparationProgress'
import { usePreparationProgressStore as store } from '../../stores/PreparationProgressStore'
beforeEach(() => store.setState({ active: null, opening: null, importing: null }))
afterEach(cleanup)
it('hides chooser waiting and does not invent unknown percentages', () => {
  store.getState().beginOpen('open')
  const view = render(<AudioPreparationProgress onCancel={vi.fn()} />)
  expect(screen.queryByRole('progressbar')).toBeNull()
  store.getState().receiveOpen({
    operationId: 'open',
    sequence: 1,
    stage: 'reading-project',
    progress: { kind: 'indeterminate' },
  })
  view.rerender(<AudioPreparationProgress onCancel={vi.fn()} />)
  expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
  expect(screen.queryByText(/%/)).toBeNull()
})
it('shows phase fraction, full filename tooltip and cancellation', () => {
  const identity = { jobId: 'import', workspaceToken: 'workspace' as never, revision: 1 }
  store.getState().beginImport(identity, 'long voice recording.wav')
  store.getState().receiveImport({
    ...identity,
    displayName: 'long voice recording.wav',
    stage: 'building-cache',
    percent: 0.42,
  })
  const cancel = vi.fn()
  render(<AudioPreparationProgress onCancel={cancel} />)
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42')
  expect(screen.getByTitle('long voice recording.wav')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
})

it('keeps import cancellation available while an open is primary', () => {
  store
    .getState()
    .beginImport(
      { jobId: 'import', workspaceToken: 'workspace' as never, revision: 1 },
      'voice.wav',
    )
  store.getState().beginOpen('open')
  store.getState().receiveOpen({
    operationId: 'open',
    sequence: 1,
    stage: 'reading-project',
    progress: { kind: 'indeterminate' },
  })
  const cancel = vi.fn()
  render(<AudioPreparationProgress onCancel={cancel} />)
  expect(screen.getByText('Opening project')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
  expect(cancel).toHaveBeenCalledOnce()
  act(() => store.getState().cancelling('import'))
  expect(
    (screen.getByRole('button', { name: 'Cancel import' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  act(() => store.getState().prepareEditor('import'))
  expect(
    (screen.getByRole('button', { name: 'Cancel import' }) as HTMLButtonElement).disabled,
  ).toBe(true)
})
