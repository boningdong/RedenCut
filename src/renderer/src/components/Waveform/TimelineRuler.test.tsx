// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TimelineRuler } from './TimelineRuler'

afterEach(cleanup)

it('shows precise distinct timecodes near minute and hour boundaries', () => {
  const view = render(
    <TimelineRuler duration={7200} pxPerSec={1000} scrollLeft={59900} viewportWidth={800} />,
  )
  expect(view.getByText('0:59.90')).toBeTruthy()
  expect(view.getByText('1:00.00')).toBeTruthy()
  view.rerender(
    <TimelineRuler duration={7200} pxPerSec={1000} scrollLeft={3599900} viewportWidth={800} />,
  )
  expect(view.getByText('59:59.90')).toBeTruthy()
  expect(view.getByText('1:00:00.00')).toBeTruthy()
})

it('bounds rendered ticks to the viewport even near the end of a long recording', () => {
  const view = render(
    <TimelineRuler duration={7200} pxPerSec={1000} scrollLeft={7199200} viewportWidth={800} />,
  )
  const labels = [...view.container.querySelectorAll('span')]
  expect(labels.length).toBeLessThanOrEqual(12)
  expect(view.getByText('2:00:00.00')).toBeTruthy()
  expect(
    labels.every((label) => Number.parseFloat(label.parentElement!.style.left) >= 7199100),
  ).toBe(true)
})

it.each([77, 80, 100, 159])('preserves whole-second ticks at %s px/s', (scale) => {
  const view = render(
    <TimelineRuler duration={13.5} pxPerSec={scale} scrollLeft={0} viewportWidth={1047} />,
  )
  expect(view.getByText('1s')).toBeTruthy()
  expect(view.getByText('2s')).toBeTruthy()
})
