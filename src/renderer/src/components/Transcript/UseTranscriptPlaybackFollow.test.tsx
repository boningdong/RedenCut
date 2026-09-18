// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
import { usePlaybackStore } from '../../stores/playback.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useTranscriptPlaybackFollow } from './UseTranscriptPlaybackFollow'

beforeEach(() => {
  usePlaybackStore.getState().reset()
  useTranscriptStore.getState().reset()
})
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
function setup() {
  const container = document.createElement('div')
  const first = document.createElement('span')
  const second = document.createElement('span')
  first.textContent = 'first'
  second.textContent = 'second'
  container.append(first, second)
  document.body.append(container)
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 400,
    height: 400,
  } as DOMRect)
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({
    top: 600,
    bottom: 620,
    height: 20,
  } as DOMRect)
  vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({
    top: 800,
    bottom: 820,
    height: 20,
  } as DOMRect)
  const scroll = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    container.scrollTop = typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0)
  })
  container.scrollTo = scroll
  const units = [
    { id: 'a', unit: { kind: 'speech' }, outputStart: 1, outputEnd: 3, muted: false },
    { id: 'b', unit: { kind: 'speech' }, outputStart: 2, outputEnd: 4, muted: false },
  ] as TranscriptOccurrence[]
  const refs = {
    container: { current: container },
    elements: {
      current: new Map([
        ['a', first],
        ['b', second],
      ]),
    },
  }
  const hook = renderHook(
    ({ visible }) =>
      useTranscriptPlaybackFollow(visible, refs.container, refs.elements, 'speakers'),
    { initialProps: { visible: units } },
  )
  return { ...hook, container, first, second, scroll, units }
}
it('jumps while paused without enabling follow or seeking; filtered text does not jump', () => {
  const { result, scroll, rerender } = setup()
  act(() => usePlaybackStore.getState().setCurrentTime(1.5))
  expect(result.current()).toBe(true)
  expect(scroll).toHaveBeenLastCalledWith({ top: 410, behavior: 'smooth' })
  expect(usePlaybackStore.getState().currentTime).toBe(1.5)
  expect(useTranscriptStore.getState().followPlayback).toBe(false)
  rerender({ visible: [] })
  expect(result.current()).toBe(false)
  expect(scroll).toHaveBeenCalledTimes(1)
})
it('follows at boundaries, retains an overlapping target and ignores programmatic scroll', () => {
  const { scroll, first, container } = setup()
  act(() => usePlaybackStore.getState().setCurrentTime(1.5))
  act(() => useTranscriptStore.getState().setFollowPlayback(true))
  expect(scroll).toHaveBeenCalledTimes(1)
  vi.mocked(first.getBoundingClientRect).mockReturnValue({
    top: 180,
    bottom: 200,
    height: 20,
  } as DOMRect)
  fireEvent.scroll(container)
  expect(useTranscriptStore.getState().followPlayback).toBe(true)
  act(() => usePlaybackStore.getState().setCurrentTime(2.5))
  expect(scroll).toHaveBeenCalledTimes(1)
  act(() => usePlaybackStore.getState().setCurrentTime(3.5))
  expect(scroll).toHaveBeenCalledTimes(2)
  fireEvent.wheel(container, { deltaY: 20 })
  expect(useTranscriptStore.getState().followPlayback).toBe(false)
})
it('stays still in the visible safe area and exits follow for text selection', () => {
  const { first, container, scroll } = setup()
  vi.mocked(first.getBoundingClientRect).mockReturnValue({
    top: 180,
    bottom: 200,
    height: 20,
  } as DOMRect)
  act(() => usePlaybackStore.getState().setCurrentTime(1.5))
  act(() => useTranscriptStore.getState().setFollowPlayback(true))
  expect(scroll).not.toHaveBeenCalled()
  const range = document.createRange()
  range.selectNodeContents(first)
  window.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(useTranscriptStore.getState().followPlayback).toBe(false)
  window.getSelection()!.removeAllRanges()
  act(() => useTranscriptStore.getState().setFollowPlayback(true))
  fireEvent.keyDown(container, { key: 'PageDown' })
  expect(useTranscriptStore.getState().followPlayback).toBe(false)
})

it.each([
  [3, 410],
  [3.4, 410],
  [4, 410],
  [4.8, 610],
  [0, 410],
  [10, 610],
])('uses the nearest timed word when jumping at %s', (time, top) => {
  const { units, rerender, result, scroll } = setup()
  rerender({ visible: [units[0], { ...units[1], outputStart: 5, outputEnd: 6 }] })
  act(() => usePlaybackStore.getState().setCurrentTime(time))
  expect(result.current()).toBe(true)
  expect(scroll).toHaveBeenLastCalledWith({ top, behavior: 'smooth' })
  expect(usePlaybackStore.getState().currentTime).toBe(time)
  expect(useTranscriptStore.getState().followPlayback).toBe(false)
})
it('uses visible timed words only for nearest-word fallback', () => {
  const { units, rerender, result, scroll } = setup()
  rerender({ visible: [units[0]] })
  act(() => usePlaybackStore.getState().setCurrentTime(4))
  expect(result.current()).toBe(true)
  expect(scroll).toHaveBeenLastCalledWith({ top: 410, behavior: 'smooth' })
})
