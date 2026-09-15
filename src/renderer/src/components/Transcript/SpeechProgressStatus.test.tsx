// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLocaleStore } from '../../stores/locale.store'
import { SpeechProgressStatus } from './SpeechProgressStatus'
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  useLocaleStore.setState({ resolvedLocale: 'en' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it('shows stage elapsed without invented percentage and resets on transition', () => {
  const { rerender } = render(
    <SpeechProgressStatus status={{ stage: 'diarizing', stageStartedAtMs: 5000 }} />,
  )
  expect(screen.getByText(/5s/)).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
  act(() => {
    vi.advanceTimersByTime(2000)
  })
  expect(screen.getByText(/7s/)).toBeTruthy()
  rerender(
    <SpeechProgressStatus status={{ stage: 'aligning', stageStartedAtMs: 12000, percent: 25 }} />,
  )
  expect(screen.getByText(/0s/)).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')
})
it('keeps cancellation available past advisory estimate and localizes retained status', () => {
  const cancel = vi.fn()
  render(
    <SpeechProgressStatus
      status={{ stage: 'diarizing', stageStartedAtMs: 10000, estimatedDurationMs: 1000 }}
      onCancel={cancel}
    />,
  )
  expect(screen.queryByText(/longer than estimated/)).toBeNull()
  act(() => {
    vi.advanceTimersByTime(2000)
  })
  expect(screen.getByText(/longer than estimated/)).toBeTruthy()
  expect(screen.getByText(/longer than estimated/).closest('details')).toBeNull()
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByText(/超出预计时间/)).toBeTruthy()
})

it('rounds display percentages while retaining the measured accessible value', () => {
  render(<SpeechProgressStatus status={{ stage: 'aligning', percent: 11.570247933 }} />)
  const progress = screen.getByRole('progressbar')
  expect(progress.textContent).toContain('12%')
  expect(progress.getAttribute('aria-valuenow')).toBe('11.570247933')
})

it('shows an advisory rounded stage estimate before overrun and retranslates it', () => {
  const { rerender } = render(
    <SpeechProgressStatus
      status={{ stage: 'diarizing', stageStartedAtMs: 10000, estimatedDurationMs: 324359 }}
    />,
  )
  expect(screen.getByText('Estimated stage duration: about 5 min')).toBeTruthy()
  expect(screen.queryByText(/longer than estimated/)).toBeNull()
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByText('本阶段预计约 5 分钟')).toBeTruthy()
  rerender(<SpeechProgressStatus status={{ stage: 'aligning', stageStartedAtMs: 10000 }} />)
  expect(screen.queryByText(/本阶段预计/)).toBeNull()
})
