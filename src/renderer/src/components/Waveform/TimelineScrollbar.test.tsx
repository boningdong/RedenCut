// @vitest-environment jsdom
import { createRef } from 'react'
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
