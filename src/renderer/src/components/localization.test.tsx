// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TransportBar } from './Transport/TransportBar'
import { FileInfoPanel } from './FileInfoPanel'
import { TranscriptPanel } from './Transcript/TranscriptPanel'
import { useLocaleStore } from '../stores/locale.store'
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useLocaleStore.setState({ resolvedLocale: 'en' })
})
it('switches complete transport, file details and empty transcript copy in place', () => {
  useLocaleStore.setState({ resolvedLocale: 'en' })
  render(
    <>
      <TransportBar />
      <FileInfoPanel
        displayName="My recording.wav"
        metadata={{
          durationSeconds: 20,
          sampleRate: 48000,
          channels: 2,
          codec: 'wav',
          bitrateKbps: 100,
        }}
      />
      <TranscriptPanel onGenerate={() => {}} isGenerating={false} generatingStatus={null} />
    </>,
  )
  const undo = screen.getByRole('button', { name: 'Undo' })
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByRole('button', { name: '撤销' })).toBe(undo)
  expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
  expect(screen.getByText('音频详情')).toBeTruthy()
  expect(screen.getByText('立体声')).toBeTruthy()
  expect(screen.getByText('My recording.wav')).toBeTruthy()
  expect(screen.getByText('暂无转写')).toBeTruthy()
})

it('retranslates active structured progress without restarting its elapsed clock', () => {
  vi.useFakeTimers()
  useLocaleStore.setState({ resolvedLocale: 'en' })
  const status = { stage: 'aligning' as const, percent: undefined }
  render(<TranscriptPanel onGenerate={() => {}} isGenerating={true} generatingStatus={status} />)
  expect(screen.getByText('Aligning transcript')).toBeTruthy()
  act(() => {
    vi.advanceTimersByTime(2000)
  })
  expect(screen.getByText('2s elapsed')).toBeTruthy()
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByText('正在对齐')).toBeTruthy()
  expect(screen.getByText('已用时 2秒')).toBeTruthy()
  expect(screen.getAllByRole('status')).toHaveLength(1)
})
