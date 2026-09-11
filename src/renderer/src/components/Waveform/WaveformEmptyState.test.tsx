// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../../stores/timeline.store'
import { useEditorStore } from '../../stores/editor.store'
import { WaveformView } from './WaveformView'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps the normal audio chrome and provides Add Track below the empty ruler', () => {
  useTimelineStore.getState().reset()
  useEditorStore.getState().reset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const addTrack = vi.fn()
  const { container } = render(
    <WaveformView duration={0} providersBySource={new Map()} onAddTrack={addTrack} />,
  )
  const add = screen.getByRole('button', { name: /Add Track/ })
  expect(container.querySelector('.feature-toolbar')?.textContent).toContain('Audio')
  expect(container.querySelector('#waveform-timeline')).toBeTruthy()
  expect(container.querySelector('.audio-footer')).toBeTruthy()
  expect(add.closest('.feature-toolbar')).toBeNull()
  expect(add.closest('.audio-scroll-body')).toBeTruthy()
  expect(container.querySelectorAll('[data-lane]')).toHaveLength(0)
  fireEvent.click(add)
  expect(addTrack).toHaveBeenCalledOnce()
})
