// @vitest-environment jsdom
import React, { createRef } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TimelineScrollbar } from './TimelineScrollbar'
afterEach(cleanup)
it('synchronizes timeline pan in both directions without moving the vertical track scroll', () => {
  const viewport = createRef<HTMLDivElement>()
  const { container } = render(
    <>
      <div className="audio-scroll-body">
        <div ref={viewport} />
      </div>
      <TimelineScrollbar
        viewport={viewport}
        contentWidth={2400}
        viewportWidth={800}
        headerWidth={190}
      />
    </>,
  )
  const bar = container.querySelector('.audio-horizontal-scrollbar') as HTMLElement
  const vertical = container.querySelector('.audio-scroll-body') as HTMLElement
  expect(bar.closest('.audio-scroll-body')).toBeNull()
  vertical.scrollTop = 120
  bar.scrollLeft = 300
  fireEvent.scroll(bar)
  expect(viewport.current!.scrollLeft).toBe(300)
  viewport.current!.scrollLeft = 650
  fireEvent.scroll(viewport.current!)
  expect(bar.scrollLeft).toBe(650)
  expect(vertical.scrollTop).toBe(120)
})

it('preserves project commands while keeping native scrollbar navigation local', async () => {
  const { useKeyboardShortcuts } = await import('../../hooks/useKeyboardShortcuts')
  const { useTimelineStore } = await import('../../stores/TimelineStore')
  const { TrackSchema } = await import('@shared/ProjectTypes')
  const { act, screen } = await import('@testing-library/react')
  useTimelineStore.getState().reset()
  useTimelineStore.setState({ tracks: [TrackSchema.parse({ id: 'track', name: 'Voice' })] })
  useTimelineStore.getState().setTrackGain('track', 6)
  function Editor() {
    const [saved, setSaved] = React.useState(false)
    useKeyboardShortcuts({ onSave: () => setSaved(true) })
    return (
      <>
        <output>{saved ? 'saved' : 'unsaved'}</output>
        <TimelineScrollbar
          viewport={createRef()}
          contentWidth={2400}
          viewportWidth={800}
          headerWidth={190}
        />
      </>
    )
  }
  render(<Editor />)
  const bar = screen.getByRole('region')
  fireEvent.keyDown(bar, { key: 's', code: 'KeyS', metaKey: true })
  expect(screen.getByText('saved')).toBeTruthy()
  await act(() => fireEvent.keyDown(bar, { key: 'z', code: 'KeyZ', ctrlKey: true }))
  expect(useTimelineStore.getState().tracks[0].gainDb ?? 0).toBe(0)
  await act(() => fireEvent.keyDown(bar, { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true }))
  expect(useTimelineStore.getState().tracks[0].gainDb).toBe(6)
  let navigated = false
  const backgroundNavigation = () => {
    navigated = true
  }
  document.addEventListener('keydown', backgroundNavigation)
  fireEvent.keyDown(bar, { key: 'ArrowLeft', code: 'ArrowLeft' })
  document.removeEventListener('keydown', backgroundNavigation)
  expect(navigated).toBe(false)
})
