// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TranscriptDialogue } from './TranscriptDialogue'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
function occurrence(
  id: string,
  track: string,
  start: number,
  end: number,
  text = id,
): TranscriptOccurrence {
  return {
    id,
    scopeId: track,
    track: { id: track, name: track, color: '#fff' },
    unit: { id, text, kind: 'speech' },
    analysis: { speakers: [], speakerLabelOverrides: [] },
    outputStart: start,
    outputEnd: end,
    orderTime: start,
    muted: false,
  } as unknown as TranscriptOccurrence
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('wraps shared measured columns inside each speaker lane and preserves every unit through resize', () => {
  let resize: ((entries: unknown[]) => void) | undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: unknown[]) => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  const units = [
    occurrence('long', 'a', 0, 6, 'A long acoustic phrase'),
    occurrence('one', 'b', 1, 2, 'First interjection'),
    occurrence('two', 'b', 4, 5, 'Second interjection'),
  ]
  render(
    <TranscriptDialogue
      units={units}
      renderUnit={(u) => <span data-rendered-unit={u.id}>{u.unit.text}</span>}
      currentTime={1.5}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Align' }))
  act(() => resize?.([{ contentRect: { width: 260 } }]))
  const lanes = document.querySelectorAll('[data-aligned-track]')
  expect([...lanes].map((l) => l.getAttribute('data-aligned-track'))).toEqual(['a', 'b'])
  expect(lanes[0].querySelectorAll('.transcript-content-line').length).toBeGreaterThan(1)
  expect(lanes[1].querySelectorAll('.transcript-content-line').length).toBe(
    lanes[0].querySelectorAll('.transcript-content-line').length,
  )
  expect(
    [...document.querySelectorAll('[data-rendered-unit]')].map((u) =>
      u.getAttribute('data-rendered-unit'),
    ),
  ).toEqual(['long', 'one', 'two'])
  expect(screen.getAllByLabelText('Speech continues').length).toBeGreaterThan(0)
  act(() => resize?.([{ contentRect: { width: 1000 } }]))
  expect(
    document.querySelectorAll('[data-aligned-track="a"] .transcript-content-line'),
  ).toHaveLength(1)
  expect(document.querySelectorAll('[data-rendered-unit]')).toHaveLength(3)
})
